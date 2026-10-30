import { parseHtmlDocument } from "@selio/connectors/vinted-adapter";
import { filterStorageState } from "../session";
import type { RunFailureCode, StorageState } from "../types";
import { TargetRefusedError, type BrowsingPage, type BrowsingSession, type ClickIntent, type ClickTarget, type FetchPageInput, type FetchPageOutcome } from "./types";
import { resolveRadarUrl } from "./urls";

/**
 * Doublures de Selio Radar pour les tests (aucun navigateur) : pages servies depuis des fixtures,
 * clics scriptés, appels enregistrés. Utilisées par `FakeRunner` (`fetchPage`, `openBrowsing`).
 */

/** Page de vérification anti-robot (CAPTCHA) rendue par le scénario « blocked » : le lecteur doit s'arrêter. */
export const FAKE_BLOCK_PAGE_HTML = `<!doctype html><html lang="fr"><head><title>vinted.fr</title></head><body><h1>Vérification de sécurité</h1><iframe src="https://geo.captcha-delivery.com/captcha/?initialCid=FAKE" title="Vérification"></iframe></body></html>`;
/** Réponse « trop de requêtes » (statut 429) rendue par le scénario « rate_limited ». */
export const FAKE_RATE_LIMIT_HTML = `<!doctype html><html lang="fr"><head><title>Vinted</title></head><body><h1>Trop de requêtes</h1><p>Réessaie plus tard.</p></body></html>`;

/**
 * Scénarios de `FakeRunner.fetchPage` :
 * - `ok` : la page de `pageHtml` (fixture), statut 200 ;
 * - `blocked` : une page de CAPTCHA (statut 200) — c'est le lecteur qui la reconnaît ;
 * - `rate_limited` : une page « trop de requêtes » avec le statut 429 ;
 * - `timeout`, `error` : le navigateur a été lancé, aucune page lue ;
 * - `unavailable` : aucun navigateur libre, rien n'est lancé ;
 * - une page `{ html, status?, finalUrl? }`, une issue complète, ou une fonction de l'entrée.
 * Sans session du compte Achat, la doublure refuse comme le vrai exécuteur (`not_logged_in`, rien n'est lancé).
 */
export type FakeFetchScenarioName = "ok" | "blocked" | "rate_limited" | "timeout" | "error" | "unavailable";
export type FakeFetchScenario =
  | FakeFetchScenarioName
  | { html: string; status?: number | null; finalUrl?: string; challenge?: boolean }
  | FetchPageOutcome
  | ((input: FetchPageInput) => FetchPageOutcome | Promise<FetchPageOutcome>);

export interface FakeFetchCall {
  url: string;
  hadSession: boolean;
  timeoutMs?: number;
}

const FAILURE_MESSAGES: Record<"timeout" | "error" | "unavailable", string> = {
  timeout: "Délai dépassé : la page n'a pas été lue (simulé).",
  error: "Erreur du navigateur pendant la lecture (simulée).",
  unavailable: "Aucun navigateur libre : la lecture est reportée (simulé).",
};

function hasSession(session: StorageState | null): session is StorageState {
  if (!session) return false;
  const f = filterStorageState(session);
  return f.cookies.length > 0 || f.origins.length > 0;
}

/** Issue de `fetchPage` pour un scénario (exportée pour les tests d'autres paquets). */
export async function fakeFetchOutcome(scenario: FakeFetchScenario, input: FetchPageInput, pageHtml: (url: string) => string): Promise<FetchPageOutcome> {
  if (!hasSession(input.session)) {
    return { ok: false, code: "not_logged_in", message: "Aucune session enregistrée pour le compte Achat (simulé).", launched: false, durationMs: 0 };
  }
  const session = filterStorageState(input.session);
  if (typeof scenario === "function") return scenario(input);
  if (typeof scenario === "object" && "ok" in scenario) return scenario;
  if (typeof scenario === "object") {
    return { ok: true, html: scenario.html, finalUrl: scenario.finalUrl ?? input.url, status: scenario.status === undefined ? 200 : scenario.status, ...(scenario.challenge ? { challenge: true } : {}), durationMs: 0, session };
  }
  switch (scenario) {
    case "ok":
      return { ok: true, html: pageHtml(input.url), finalUrl: input.url, status: 200, durationMs: 0, session };
    case "blocked":
      return { ok: true, html: FAKE_BLOCK_PAGE_HTML, finalUrl: input.url, status: 200, durationMs: 0, session };
    case "rate_limited":
      return { ok: true, html: FAKE_RATE_LIMIT_HTML, finalUrl: input.url, status: 429, durationMs: 0, session };
    case "unavailable":
      return { ok: false, code: "unavailable", message: FAILURE_MESSAGES.unavailable, launched: false, durationMs: 0 };
    default:
      return { ok: false, code: scenario, message: FAILURE_MESSAGES[scenario], launched: true, durationMs: 0 };
  }
}

// ---------------------------------------------------------------------------
// Navigation d'achat factice

/** Effet d'un clic : adresse de la page affichée ensuite, fonction sur la page, ou `null` (élément absent). */
export type FakeClickEffect = string | ((page: FakeBrowsingPage) => void) | null;

export interface FakeSite {
  /** Pages servies, par adresse complète ou par chemin (`/items/1-veste`, `/checkout`). */
  pages: Record<string, string | { html: string; status?: number }>;
  /** Effet de chaque intention de clic. Une intention absente : rien n'est cliqué (faux). */
  clicks?: Partial<Record<ClickIntent, FakeClickEffect>>;
}

/** Scénarios de `FakeRunner.openBrowsing` : un site scripté, ou un refus (rien n'est lancé sauf `error`). */
export type FakeBrowsingScenario = FakeSite | "unavailable" | "error" | (() => FakeSite);

const NOT_FOUND = `<!doctype html><html><head><title>Introuvable</title></head><body><h1>Page introuvable</h1></body></html>`;

/**
 * Page factice : sert les pages du site, joue les clics scriptés, lit l'état coché dans le HTML.
 * Comme la vraie, elle n'a aucune méthode de saisie ; elle refuse les adresses hors Vinted.
 */
export class FakeBrowsingPage implements BrowsingPage {
  readonly visited: string[] = [];
  readonly clicks: ClickIntent[] = [];
  waits = 0;
  private currentUrl = "about:blank";
  private html = "<html><body></body></html>";

  constructor(private readonly site: FakeSite) {}

  /** Affiche une page du site (ou un HTML donné) : simule une navigation faite par Vinted ou par le client. */
  show(url: string, html?: string): void {
    this.currentUrl = url;
    this.html = html ?? this.lookup(url).html;
  }

  /** Remplace le HTML affiché (ex. : la case du porte-monnaie cochée). */
  setHtml(html: string): void {
    this.html = html;
  }

  private lookup(url: string): { html: string; status: number } {
    const direct = this.site.pages[url];
    let entry = direct;
    if (entry === undefined) {
      try {
        entry = this.site.pages[new URL(url).pathname];
      } catch {
        entry = undefined;
      }
    }
    if (entry === undefined) return { html: NOT_FOUND, status: 404 };
    return typeof entry === "string" ? { html: entry, status: 200 } : { html: entry.html, status: entry.status ?? 200 };
  }

  async goto(url: string): Promise<{ status: number | null }> {
    const target = resolveRadarUrl(url, ["item", "catalog"]);
    if (!target) throw new TargetRefusedError();
    const page = this.lookup(target.toString());
    this.visited.push(target.toString());
    this.currentUrl = target.toString();
    this.html = page.html;
    return { status: page.status };
  }

  async content(): Promise<string> {
    return this.html;
  }

  url(): string {
    return this.currentUrl;
  }

  async click(target: ClickTarget): Promise<boolean> {
    const effect = this.site.clicks?.[target.intent];
    if (effect === undefined || effect === null) return false;
    this.clicks.push(target.intent);
    if (typeof effect === "string") this.show(new URL(effect, this.currentUrl.startsWith("http") ? this.currentUrl : "https://www.vinted.fr").toString());
    else effect(this);
    return true;
  }

  async isChecked(selectors: readonly string[]): Promise<boolean | null> {
    const doc = parseHtmlDocument(this.html);
    for (const s of selectors) {
      let el;
      try {
        el = doc.querySelector(s);
      } catch {
        continue;
      }
      if (!el) continue;
      if (el.getAttribute("type") === "radio" || el.getAttribute("type") === "checkbox") return el.getAttribute("checked") !== null;
    }
    return null;
  }

  async settle(): Promise<void> {}

  async wait(): Promise<void> {
    this.waits++;
  }
}

export class FakeBrowsingSession implements BrowsingSession {
  readonly page: FakeBrowsingPage;
  extendedMs: number[] = [];
  private isClosed = false;

  constructor(
    site: FakeSite,
    private readonly session: StorageState,
  ) {
    this.page = new FakeBrowsingPage(site);
  }

  get closed(): boolean {
    return this.isClosed;
  }

  extend(ms: number): void {
    this.extendedMs.push(ms);
  }

  async readSession(): Promise<StorageState | undefined> {
    return this.isClosed ? undefined : filterStorageState(this.session);
  }

  async close(): Promise<void> {
    this.isClosed = true;
  }

  /** Simule la fermeture automatique à l'échéance (fin du délai 3-D Secure). */
  expire(): void {
    this.isClosed = true;
  }
}

export function fakeBrowsingFailure(code: Extract<RunFailureCode, "unavailable" | "error" | "not_logged_in">): { ok: false; code: RunFailureCode; message: string; launched: boolean; durationMs: number } {
  const messages = {
    unavailable: "Aucun navigateur libre : l'achat est reporté (simulé).",
    error: "Le navigateur d'achat n'a pas pu être préparé (simulé).",
    not_logged_in: "Aucune session enregistrée pour le compte Achat (simulé).",
  } as const;
  return { ok: false, code, message: messages[code], launched: code === "error", durationMs: 0 };
}

export { hasSession as fakeHasSession };
