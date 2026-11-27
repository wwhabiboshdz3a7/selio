import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { AUTO_ALARM, autoTargetAllowed, autoTick, chromeAutoDeps, type AutoDeps, type ChromeLike } from "../src/background/auto";
import { readConversation, readInbox, sendMessage, type AutoEnv } from "../src/content/auto";
import type { ToContent } from "../src/shared/messages";
import manifest from "../manifest.json";
import pkg from "../package.json";

/**
 * Automatisation complète dans le navigateur (D64), sur des pages SYNTHÉTIQUES (happy-dom) et une API
 * `chrome` simulée : le service worker n'agit que sur ordre du serveur, dans un onglet inactif qu'il a
 * ouvert, et rend compte ; le script de page lit sans cliquer, n'envoie qu'après avoir reconnu la
 * conversation, confirme l'envoi, et s'arrête au premier signal de Vinted.
 */
const conversationFixture = readFileSync(new URL("../../../packages/connectors/src/vinted/fixtures/conversation-page.v1.html", import.meta.url), "utf8");

function page(url: string, html: string): { win: Window; env: AutoEnv } {
  const win = new Window({ url });
  win.document.write(html);
  let t = 0;
  const env: AutoEnv = { doc: win.document as unknown as Document, url: () => win.location.href, wait: async (ms) => { t += ms; await new Promise((r) => setTimeout(r, 0)); }, now: () => t };
  return { win, env };
}

/** La page « répond » à l'envoi en affichant le message (comme le ferait Vinted). */
function withEcho(win: Window) {
  const doc = win.document;
  doc.querySelector("form")!.addEventListener("submit", (e) => {
    e.preventDefault();
    const ta = doc.querySelector("textarea") as unknown as HTMLTextAreaElement;
    const li = doc.createElement("li");
    li.setAttribute("data-testid", "message-own-9");
    li.setAttribute("data-direction", "outbound");
    const p = doc.createElement("p");
    p.setAttribute("data-testid", "message-own-9-body");
    p.textContent = ta.value;
    li.appendChild(p);
    doc.querySelector("ul")!.appendChild(li);
  });
}

const CAPTCHA = `<!doctype html><html lang="fr"><head><title>Un instant…</title></head><body><div id="challenge-running"></div><h1>Vérifiez que vous êtes humain</h1></body></html>`;
const INBOX = `<!doctype html><html><body><ul>
  <li><a href="/inbox/1001"><span>Léa</span><span data-testid="inbox-unread-badge">1</span></a></li>
  <li><a href="/inbox/1002"><span>Paul</span></a></li>
  <li><a href="https://evil.example.com/inbox/6666">Faux</a></li>
</ul></body></html>`;

describe("extension 0.2.0 : manifeste", () => {
  it("version 0.2.0, permission « alarms », aucune permission « cookies »", () => {
    expect(manifest.version).toBe("0.2.0");
    expect(pkg.version).toBe("0.2.0");
    expect(manifest.permissions).toContain("alarms");
    expect(JSON.stringify(manifest.permissions)).not.toMatch(/cookies|webRequest|debugger/);
  });
});

describe("script de page : lecture et envoi (pages synthétiques)", () => {
  it("messagerie : non lues seulement, liens d'un autre site ignorés", async () => {
    const { env } = page("https://www.vinted.fr/inbox", INBOX);
    expect(await readInbox(env, 5)).toEqual({ ok: true, listSource: "dom", listed: 2, chosen: ["1001"] });
  });

  it("messagerie non reconnue : aucune conversation, diagnostic de structure sans texte", async () => {
    const { env } = page("https://www.vinted.fr/inbox", `<!doctype html><html><body><div data-testid="fil-42">Texte privé</div></body></html>`);
    const r = await readInbox(env, 5);
    expect(r).toMatchObject({ ok: true, listSource: "none", chosen: [] });
    expect(JSON.stringify(r)).not.toContain("Texte privé");
  });

  it("conversation : lue par l'adaptateur v1 ; une autre conversation que celle demandée est refusée", async () => {
    const { env } = page("https://www.vinted.fr/inbox/987", conversationFixture);
    const r = await readConversation(env, "987");
    expect(r).toMatchObject({ ok: true, conversation: { ref: "987", buyerHandle: "lea_m" } });
    if (r.ok) expect(r.conversation.messages.map((m) => m.direction)).toEqual(["inbound", "outbound"]);
    expect(await readConversation(env, "988")).toMatchObject({ ok: false, code: "selector_missing" });
  });

  it("envoi : conversation reconnue, texte écrit, clic, confirmation quand le message apparaît", async () => {
    const { win, env } = page("https://www.vinted.fr/inbox/987", conversationFixture);
    withEcho(win);
    expect(await sendMessage(env, "Oui, toujours disponible.")).toEqual({ ok: true, code: "ok" });
    expect(win.document.querySelectorAll('[data-direction="outbound"]').length).toBe(2);
  });

  it("envoi sans confirmation : délai dépassé, effets « inconnus » (jamais renvoyé)", async () => {
    const { win, env } = page("https://www.vinted.fr/inbox/987", conversationFixture);
    win.document.querySelector("form")!.addEventListener("submit", (e) => e.preventDefault());
    expect(await sendMessage(env, "Bonjour", 2_000)).toEqual({ ok: false, code: "timeout", sideEffects: "unknown" });
  });

  it("page non reconnue : rien n'est écrit ni cliqué ; CAPTCHA : arrêt avec le code", async () => {
    const { win, env } = page("https://www.vinted.fr/inbox/987", `<!doctype html><html><body><form><textarea name="message"></textarea><button type="submit">Envoyer</button></form></body></html>`);
    let clicked = 0;
    win.document.querySelector("button")!.addEventListener("click", () => clicked++);
    expect(await sendMessage(env, "Bonjour")).toEqual({ ok: false, code: "selector_missing", sideEffects: "none" });
    expect(clicked).toBe(0);
    expect((win.document.querySelector("textarea") as unknown as HTMLTextAreaElement).value).toBe("");
    const captcha = page("https://www.vinted.fr/inbox/987", CAPTCHA);
    expect(await sendMessage(captcha.env, "Bonjour")).toMatchObject({ ok: false, code: "captcha", sideEffects: "none" });
    expect(await readInbox(page("https://www.vinted.fr/inbox", CAPTCHA).env, 5)).toMatchObject({ ok: false, code: "captcha" });
  });
});

/** Dépendances simulées : chaque appel est enregistré. */
function fakeDeps(next: unknown, answers: Partial<Record<ToContent["type"], unknown[]>> = {}) {
  const calls: { api: { method: string; path: string; body?: unknown }[]; opened: string[]; navigated: string[]; asked: ToContent[]; closed: number[]; scheduled: number[] } = { api: [], opened: [], navigated: [], asked: [], closed: [], scheduled: [] };
  const deps: AutoDeps = {
    async api<T>(method: "GET" | "POST", path: string, body?: unknown) {
      calls.api.push({ method, path, body });
      return (path === "/api/ext/auto/next" ? next : { status: "recorded" }) as T;
    },
    async openTab(url) { calls.opened.push(url); return 7; },
    async navigate(_tab, url) { calls.navigated.push(url); return true; },
    async ask<T>(_tab: number, msg: ToContent) { calls.asked.push(msg); return ((answers[msg.type] ?? []).shift() ?? null) as T | null; },
    async closeTab(tab) { calls.closed.push(tab); },
    schedule(m) { calls.scheduled.push(m); },
    now: () => 1000,
  };
  return { deps, calls };
}

const JOB = "11111111-1111-4111-8111-111111111111";

describe("service worker : un réveil, une action décidée par le serveur", () => {
  it("attendre : rien n'est ouvert, réveil au délai du serveur", async () => {
    const { deps, calls } = fakeDeps({ action: "wait", reason: "outside_active_hours", retryInMinutes: 30 });
    expect(await autoTick(deps)).toEqual({ kind: "wait", reason: "outside_active_hours" });
    expect(calls.opened).toEqual([]);
    expect(calls.scheduled).toEqual([30]);
  });

  it("lecture : onglet sur la messagerie, conversations retenues lues, compte rendu, onglet refermé", async () => {
    const conversation = { ref: "1001", buyerHandle: "lea", itemExternalRef: null, messages: [{ direction: "inbound", body: "Bonjour", at: null, offerCents: null }] };
    const { deps, calls } = fakeDeps(
      { action: "sync_inbox", jobId: JOB, inboxUrl: "https://www.vinted.fr/inbox", maxConversations: 5, retryInMinutes: 3 },
      { autoReadInbox: [{ ok: true, listSource: "dom", listed: 2, chosen: ["1001"] }], autoReadConversation: [{ ok: true, conversation }] },
    );
    expect(await autoTick(deps)).toEqual({ kind: "sync_inbox", code: "ok" });
    expect(calls.opened).toEqual(["https://www.vinted.fr/inbox"]);
    expect(calls.navigated).toEqual(["https://www.vinted.fr/inbox/1001"]);
    expect(calls.closed).toEqual([7]);
    const report = calls.api.find((c) => c.path === "/api/ext/auto/report")!;
    expect(report.body).toMatchObject({ jobId: JOB, code: "ok", sideEffects: "none", inbox: { listSource: "dom", listed: 2, conversations: [conversation] } });
    expect(calls.scheduled).toEqual([3]);
  });

  it("CAPTCHA pendant la lecture : arrêt immédiat, compte rendu du code, conversations suivantes jamais ouvertes", async () => {
    const { deps, calls } = fakeDeps(
      { action: "sync_inbox", jobId: JOB, inboxUrl: "https://www.vinted.fr/inbox", maxConversations: 5, retryInMinutes: 3 },
      { autoReadInbox: [{ ok: true, listSource: "dom", listed: 2, chosen: ["1001", "1002"] }], autoReadConversation: [{ ok: false, code: "captcha", sideEffects: "none" }] },
    );
    expect(await autoTick(deps)).toEqual({ kind: "sync_inbox", code: "captcha" });
    expect(calls.navigated).toEqual(["https://www.vinted.fr/inbox/1001"]);
    expect(calls.api.find((c) => c.path === "/api/ext/auto/report")!.body).toMatchObject({ code: "captcha" });
    expect(calls.closed).toEqual([7]);
  });

  it("envoi : texte du serveur transmis à la page, compte rendu ; pas de réponse du script → effets inconnus", async () => {
    const send = { action: "send", jobId: JOB, conversationUrl: "https://www.vinted.fr/inbox/1001", text: "Bonjour, oui !", retryInMinutes: 3 };
    const ok = fakeDeps(send, { autoSend: [{ ok: true, code: "ok" }] });
    expect(await autoTick(ok.deps)).toEqual({ kind: "send", code: "ok" });
    expect(ok.calls.asked).toEqual([{ type: "autoSend", text: "Bonjour, oui !" }]);
    const silent = fakeDeps(send, {});
    expect(await autoTick(silent.deps)).toEqual({ kind: "send", code: "error" });
    expect(silent.calls.api.find((c) => c.path === "/api/ext/auto/report")!.body).toMatchObject({ code: "error", sideEffects: "unknown" });
  });

  it("adresse hors Vinted ou hors messagerie : jamais ouverte", async () => {
    for (const url of ["https://evil.example.com/inbox/1", "https://www.vinted.fr/items/1", "http://www.vinted.fr/inbox/1", "https://www.vinted.de/inbox/1", "https://www.vinted.fr/inbox/1?x=1"]) expect(autoTargetAllowed(url, "conversation"), url).toBe(false);
    const { deps, calls } = fakeDeps({ action: "send", jobId: JOB, conversationUrl: "https://evil.example.com/inbox/1", text: "x", retryInMinutes: 3 });
    expect(await autoTick(deps)).toEqual({ kind: "send", code: "error" });
    expect(calls.opened).toEqual([]);
  });

  it("API chrome : onglet INACTIF, attente du chargement, message non remis réessayé, remis sans réponse jamais renvoyé, réveil programmé", async () => {
    const created: { url: string; active: boolean }[] = [];
    const sent: unknown[] = [];
    const alarms: { name: string; delay: number }[] = [];
    let sendCalls = 0;
    const listeners = new Set<(id: number, info: { status?: string }) => void>();
    const chromeMock: ChromeLike = {
      tabs: {
        async create(props) { created.push(props); setTimeout(() => { for (const l of listeners) l(42, { status: "complete" }); }, 5); return { id: 42, status: "loading" }; },
        async update() { return {}; },
        async get() { return { status: "loading" }; },
        async remove() {},
        async sendMessage(_id, msg) {
          sendCalls++;
          sent.push(msg);
          if (sendCalls === 1) throw new Error("Could not establish connection. Receiving end does not exist.");
          if (sendCalls === 2) throw new Error("The message port closed before a response was received.");
          return { ok: true };
        },
        onUpdated: { addListener: (l) => listeners.add(l), removeListener: (l) => listeners.delete(l) },
      },
      alarms: { create: (name, info) => alarms.push({ name, delay: info.delayInMinutes }) },
    };
    const deps = chromeAutoDeps(chromeMock, async () => ({}) as never, { sleep: async () => {} });
    const tab = await deps.openTab("https://www.vinted.fr/inbox/1");
    expect(tab).toBe(42);
    expect(created).toEqual([{ url: "https://www.vinted.fr/inbox/1", active: false }]);
    // 1er essai non remis → nouvel essai ; 2e remis sans réponse → null, jamais un 3e envoi.
    expect(await deps.ask(42, { type: "autoSend", text: "Bonjour" })).toBeNull();
    expect(sent).toHaveLength(2);
    // Un onglet que l'extension n'a pas ouvert n'est jamais piloté.
    expect(await deps.ask(99, { type: "autoReadInbox", max: 5 })).toBeNull();
    deps.schedule(0.1);
    deps.schedule(3);
    expect(alarms).toEqual([{ name: AUTO_ALARM, delay: 0.5 }, { name: AUTO_ALARM, delay: 3 }]);
  });
});
