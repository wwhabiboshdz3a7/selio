import { extensionAutoNext, type CloudInboxConversation, type CloudRunCode, type ExtensionAutoNext } from "@selio/contracts";
import { isSupportedUrl, type ToContent } from "../shared/messages";

/**
 * Automatisation complète dans le navigateur du vendeur (D64) — partie « service worker ». À chaque réveil
 * (`chrome.alarms`, aucun processus permanent) :
 * 1. demander au serveur la prochaine action (`GET /api/ext/auto/next`) : c'est lui qui décide (heures
 *    actives, pause, coupe-circuit, plafonds, délai humain) ;
 * 2. l'exécuter dans un onglet INACTIF que l'extension ouvre elle-même sur Vinted, par son content script
 *    (lecture de la page ou envoi), sans jamais lire un cookie ni appeler Vinted depuis le service worker ;
 * 3. en rendre compte (`POST /api/ext/auto/report`), refermer l'onglet, et se réveiller au délai donné.
 * Une action à la fois ; au premier signal de Vinted, arrêt et compte rendu (le serveur met en pause).
 */

export const AUTO_ALARM = "selio-auto";

export interface AutoDeps {
  /** Appel à l'API Selio avec le jeton de l'extension (lève une erreur si l'API refuse). */
  api<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T>;
  /** Ouvre un onglet INACTIF sur l'adresse et attend son chargement ; null si impossible (aucune fenêtre…). */
  openTab(url: string): Promise<number | null>;
  /** Navigue dans l'onglet ouvert par l'extension et attend le chargement. */
  navigate(tabId: number, url: string): Promise<boolean>;
  /** Question au content script de l'onglet (null : pas de réponse). */
  ask<T>(tabId: number, msg: ToContent): Promise<T | null>;
  closeTab(tabId: number): Promise<void>;
  /** Prochain réveil, en minutes. */
  schedule(minutes: number): void;
  now(): number;
}

export type AutoTickOutcome = { kind: "wait"; reason: string } | { kind: "sync_inbox" | "send"; code: CloudRunCode } | { kind: "error"; message: string };

type Failure = { ok: false; code: CloudRunCode; sideEffects?: "none" | "unknown" };
type InboxAnswer = { ok: true; listSource: "dom" | "none"; listed: number; chosen: string[]; diagnostic?: Record<string, string | number> } | Failure;
type ConversationAnswer = { ok: true; conversation: CloudInboxConversation } | Failure;
type SendAnswer = { ok: true; code: "ok" } | Failure;

/** Adresse d'une page Vinted que l'extension accepte d'ouvrir : https, domaine pris en charge, messagerie ou conversation. */
export function autoTargetAllowed(url: string, kind: "inbox" | "conversation"): boolean {
  if (!isSupportedUrl(url)) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port || u.search || u.hash) return false;
  return kind === "inbox" ? /^\/inbox\/?$/.test(u.pathname) : /^\/inbox\/\d{1,20}$/.test(u.pathname);
}

async function report(deps: AutoDeps, body: Record<string, unknown>): Promise<void> {
  await deps.api("POST", "/api/ext/auto/report", body);
}

/** Lecture de la messagerie : liste, puis chaque conversation retenue, dans le même onglet, sans aucun clic. */
async function syncInbox(deps: AutoDeps, next: Extract<ExtensionAutoNext, { action: "sync_inbox" }>, started: number): Promise<CloudRunCode> {
  const done = (code: CloudRunCode, extra: Record<string, unknown> = {}) => report(deps, { jobId: next.jobId, code, sideEffects: "none", durationMs: Math.max(0, Math.round(deps.now() - started)), ...extra }).then(() => code);
  if (!autoTargetAllowed(next.inboxUrl, "inbox")) return done("error");
  const tabId = await deps.openTab(next.inboxUrl);
  if (tabId === null) return done("unavailable");
  try {
    const list = await deps.ask<InboxAnswer>(tabId, { type: "autoReadInbox", max: next.maxConversations });
    if (!list) return done("error");
    if (!list.ok) return done(list.code);
    const conversations: CloudInboxConversation[] = [];
    const origin = new URL(next.inboxUrl).origin;
    for (const ref of list.chosen.slice(0, next.maxConversations)) {
      const url = `${origin}/inbox/${ref}`;
      if (!autoTargetAllowed(url, "conversation") || !(await deps.navigate(tabId, url))) continue;
      const read = await deps.ask<ConversationAnswer>(tabId, { type: "autoReadConversation", ref });
      if (!read) continue;
      // Premier signal de Vinted : arrêt immédiat, rien de plus n'est ouvert.
      if (!read.ok) {
        if (read.code === "selector_missing") continue;
        return done(read.code);
      }
      conversations.push(read.conversation);
    }
    return done("ok", { inbox: { conversations, listSource: list.listSource, listed: list.listed, ...(list.diagnostic ? { diagnostic: list.diagnostic } : {}) } });
  } finally {
    await deps.closeTab(tabId).catch(() => {});
  }
}

/** Envoi d'un message préparé et décidé par le serveur, dans l'onglet de la conversation. */
async function send(deps: AutoDeps, next: Extract<ExtensionAutoNext, { action: "send" }>, started: number): Promise<CloudRunCode> {
  const done = (code: CloudRunCode, sideEffects: "none" | "unknown") => report(deps, { jobId: next.jobId, code, sideEffects, durationMs: Math.max(0, Math.round(deps.now() - started)) }).then(() => code);
  if (!autoTargetAllowed(next.conversationUrl, "conversation")) return done("error", "none");
  const tabId = await deps.openTab(next.conversationUrl);
  if (tabId === null) return done("unavailable", "none");
  try {
    const res = await deps.ask<SendAnswer>(tabId, { type: "autoSend", text: next.text });
    // Pas de réponse du script : on ne sait pas si le clic a eu lieu, jamais renvoyé.
    if (!res) return done("error", "unknown");
    return res.ok ? done("ok", "unknown") : done(res.code, res.sideEffects ?? "unknown");
  } finally {
    await deps.closeTab(tabId).catch(() => {});
  }
}

/** Un réveil : une action au plus, puis le prochain réveil au délai donné par le serveur. */
export async function autoTick(deps: AutoDeps): Promise<AutoTickOutcome> {
  let next: ExtensionAutoNext;
  try {
    const parsed = extensionAutoNext.safeParse(await deps.api("GET", "/api/ext/auto/next"));
    if (!parsed.success) {
      deps.schedule(15);
      return { kind: "error", message: "Réponse du serveur illisible." };
    }
    next = parsed.data;
  } catch (e) {
    deps.schedule(10);
    return { kind: "error", message: e instanceof Error ? e.message : "Serveur injoignable." };
  }
  if (next.action === "wait") {
    deps.schedule(next.retryInMinutes);
    return { kind: "wait", reason: next.reason };
  }
  const started = deps.now();
  try {
    const code = next.action === "sync_inbox" ? await syncInbox(deps, next, started) : await send(deps, next, started);
    return { kind: next.action, code };
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : "Erreur" };
  } finally {
    deps.schedule(next.retryInMinutes);
  }
}

/** Dépendances réelles (API `chrome`), séparées pour être testées avec une API simulée. */
export interface ChromeLike {
  tabs: {
    create(props: { url: string; active: boolean }): Promise<{ id?: number; status?: string }>;
    update(tabId: number, props: { url: string }): Promise<unknown>;
    get(tabId: number): Promise<{ status?: string; url?: string }>;
    remove(tabId: number): Promise<void>;
    sendMessage(tabId: number, msg: unknown): Promise<unknown>;
    onUpdated: { addListener(cb: (tabId: number, info: { status?: string }) => void): void; removeListener(cb: (tabId: number, info: { status?: string }) => void): void };
  };
  alarms: { create(name: string, info: { delayInMinutes: number }): void };
}

export function chromeAutoDeps(c: ChromeLike, api: AutoDeps["api"], opts: { loadTimeoutMs?: number; askTries?: number; sleep?: (ms: number) => Promise<void> } = {}): AutoDeps {
  const loadTimeoutMs = opts.loadTimeoutMs ?? 30_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const owned = new Set<number>();
  const loaded = (tabId: number) =>
    new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (v: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        c.tabs.onUpdated.removeListener(listener);
        resolve(v);
      };
      const listener = (id: number, info: { status?: string }) => {
        if (id === tabId && info.status === "complete") finish(true);
      };
      const timer = setTimeout(() => finish(false), loadTimeoutMs);
      c.tabs.onUpdated.addListener(listener);
      // Déjà chargé avant l'écoute.
      void c.tabs.get(tabId).then((t) => { if (t.status === "complete") finish(true); }, () => finish(false));
    });
  return {
    api,
    async openTab(url) {
      let tab: { id?: number };
      try {
        // Onglet en arrière-plan : jamais au premier plan, jamais à la place de celui du vendeur.
        tab = await c.tabs.create({ url, active: false });
      } catch {
        return null;
      }
      if (tab.id === undefined) return null;
      owned.add(tab.id);
      if (!(await loaded(tab.id))) {
        await c.tabs.remove(tab.id).catch(() => {});
        owned.delete(tab.id);
        return null;
      }
      return tab.id;
    },
    async navigate(tabId, url) {
      if (!owned.has(tabId)) return false;
      await c.tabs.update(tabId, { url });
      await sleep(300);
      return loaded(tabId);
    },
    async ask<T>(tabId: number, msg: ToContent): Promise<T | null> {
      if (!owned.has(tabId)) return null;
      // Le script de la page peut arriver un peu après la fin du chargement : nouvel essai SEULEMENT si le
      // message n'a pas été remis (« Receiving end does not exist »). Remis sans réponse : jamais renvoyé
      // (un envoi a pu avoir lieu).
      for (let i = 0; i < (opts.askTries ?? 10); i++) {
        try {
          const res = await c.tabs.sendMessage(tabId, msg);
          return res === undefined ? null : (res as T);
        } catch (e) {
          if (!/receiving end does not exist|could not establish connection/i.test(e instanceof Error ? e.message : String(e))) return null;
        }
        await sleep(500);
      }
      return null;
    },
    async closeTab(tabId) {
      if (!owned.has(tabId)) return;
      owned.delete(tabId);
      await c.tabs.remove(tabId).catch(() => {});
    },
    schedule(minutes) {
      c.alarms.create(AUTO_ALARM, { delayInMinutes: Math.min(240, Math.max(0.5, minutes)) });
    },
    now: () => Date.now(),
  };
}
