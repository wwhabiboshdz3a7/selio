import { randomUUID } from "node:crypto";
import { filterStorageState } from "../session";
import type {
  BrowserRunner,
  CloudAction,
  LoginBlockSignal,
  LoginWindowApi,
  LoginWindowStatus,
  OpenLoginWindowInput,
  RunInput,
  RunOutcome,
  ScreencastFrame,
  StorageState,
} from "../types";
import { loginInputEventSchema } from "../types";
import { LoginInputError, LoginWindowClosedError } from "../errors";
import {
  FakeBrowsingSession,
  fakeBrowsingFailure,
  fakeFetchOutcome,
  fakeHasSession,
  type FakeBrowsingScenario,
  type FakeFetchCall,
  type FakeFetchScenario,
} from "../radar/fake";
import type { FetchPageInput, FetchPageOutcome, OpenBrowsingInput, OpenBrowsingOutcome, PageFetcher, PageOpener, RadarPageKind } from "../radar/types";
import { resolveRadarUrl } from "../radar/urls";

/**
 * Exécuteur factice pour les tests des autres paquets (core, worker, API) :
 * aucun navigateur, scénarios programmables, appels enregistrés.
 *
 * Scénarios nommés : `ok`, `captcha`, `warning`, `blocked`, `rate_limited`,
 * `not_logged_in`, `selector_missing`, `timeout`, `error`, `unavailable`
 * (aucun navigateur lancé) — ou une issue complète, ou une fonction de l'entrée.
 *
 * Selio Radar : `fetchPage` joue sa propre file de scénarios (`ok` avec la page
 * de `pageHtml`, `blocked`, `rate_limited`, `timeout`…, voir `radar/fake.ts`),
 * `openBrowsing` rend une navigation scriptée (`FakeSite`) dont les clics sont
 * enregistrés.
 */
export type FakeScenarioName = "ok" | "captcha" | "warning" | "blocked" | "rate_limited" | "not_logged_in" | "selector_missing" | "timeout" | "error" | "unavailable";
export type FakeScenario = FakeScenarioName | RunOutcome | ((input: RunInput) => RunOutcome | Promise<RunOutcome>);

export interface FakeRunCall {
  action: CloudAction;
  hadSession: boolean;
  profileDir: string;
}

const FAKE_MESSAGES: Record<Exclude<FakeScenarioName, "ok">, string> = {
  captcha: "Vinted a affiché un CAPTCHA (simulé).",
  warning: "Vinted a affiché un avertissement (simulé).",
  blocked: "Vinted a bloqué l'accès (simulé).",
  rate_limited: "Vinted a répondu « trop de requêtes » (simulé).",
  not_logged_in: "Session Vinted non reconnue (simulé).",
  selector_missing: "Élément introuvable (simulé).",
  timeout: "Délai dépassé (simulé).",
  error: "Erreur du navigateur (simulée).",
  unavailable: "Aucun navigateur libre (simulé).",
};

/** Issue type d'un scénario nommé (exportée pour les assertions des tests). */
export function fakeOutcome(name: FakeScenarioName, input: RunInput): RunOutcome {
  const session = filterStorageState(input.session ?? { cookies: [], origins: [] });
  if (name === "ok") return { ok: true, detail: "Action simulée (FakeRunner).", session, durationMs: 0 };
  if (name === "unavailable") return { ok: false, code: name, message: FAKE_MESSAGES[name], sideEffects: "none", launched: false, durationMs: 0 };
  return { ok: false, code: name, message: FAKE_MESSAGES[name], sideEffects: name === "timeout" ? "unknown" : "none", durationMs: 0 };
}

export interface FakeRunnerOptions {
  /** Scénarios consommés dans l'ordre, un par appel à `run`. */
  scenarios?: FakeScenario[];
  /** Scénario quand la file est vide (`ok` par défaut). */
  fallback?: FakeScenario;
  /** Session rendue par la fenêtre de connexion factice. */
  loginState?: StorageState;
  /** Radar : scénarios de `fetchPage`, consommés dans l'ordre. */
  fetchScenarios?: FakeFetchScenario[];
  /** Radar : scénario de `fetchPage` quand la file est vide (`ok` par défaut). */
  fetchFallback?: FakeFetchScenario;
  /** Radar : HTML de la page « ok » (une fixture), ou fonction de l'adresse. */
  pageHtml?: string | ((url: string) => string);
  /** Radar Auto : navigations d'achat, consommées dans l'ordre par `openBrowsing`. */
  browsingScenarios?: FakeBrowsingScenario[];
}

export class FakeRunner implements BrowserRunner, PageFetcher, PageOpener {
  readonly calls: FakeRunCall[] = [];
  readonly loginWindows: FakeLoginWindow[] = [];
  readonly fetchCalls: FakeFetchCall[] = [];
  readonly browsings: FakeBrowsingSession[] = [];
  private readonly queue: FakeScenario[];
  private fallback: FakeScenario;
  private loginState: StorageState;
  private readonly fetchQueue: FakeFetchScenario[];
  private fetchFallback: FakeFetchScenario;
  private pageHtml: (url: string) => string;
  private readonly browsingQueue: FakeBrowsingScenario[];

  constructor(options: FakeRunnerOptions = {}) {
    this.queue = [...(options.scenarios ?? [])];
    this.fallback = options.fallback ?? "ok";
    this.loginState = options.loginState ?? { cookies: [], origins: [] };
    this.fetchQueue = [...(options.fetchScenarios ?? [])];
    this.fetchFallback = options.fetchFallback ?? "ok";
    this.pageHtml = toPageHtml(options.pageHtml);
    this.browsingQueue = [...(options.browsingScenarios ?? [])];
  }

  /** Radar : ajoute des scénarios de lecture. */
  enqueueFetch(...scenarios: FakeFetchScenario[]): this {
    this.fetchQueue.push(...scenarios);
    return this;
  }

  setFetchFallback(scenario: FakeFetchScenario): this {
    this.fetchFallback = scenario;
    return this;
  }

  setPageHtml(html: string | ((url: string) => string)): this {
    this.pageHtml = toPageHtml(html);
    return this;
  }

  /** Radar Auto : ajoute des navigations d'achat scriptées. */
  enqueueBrowsing(...scenarios: FakeBrowsingScenario[]): this {
    this.browsingQueue.push(...scenarios);
    return this;
  }

  /** Mêmes adresses que le vrai exécuteur sur Vinted (https, liste fermée, catalogue ou annonce). */
  allowsTarget(url: string, kind: RadarPageKind): boolean {
    return resolveRadarUrl(url, [kind]) !== null;
  }

  async fetchPage(input: FetchPageInput): Promise<FetchPageOutcome> {
    this.fetchCalls.push({ url: input.url, hadSession: fakeHasSession(input.session), ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}) });
    if (!resolveRadarUrl(input.url, ["catalog", "item"])) {
      return { ok: false, code: "error", message: "Adresse refusée (simulé).", launched: false, durationMs: 0 };
    }
    // Sans session, rien n'est lancé et aucun scénario n'est consommé.
    if (!fakeHasSession(input.session)) return fakeFetchOutcome("ok", input, this.pageHtml);
    const scenario = this.fetchQueue.length > 0 ? this.fetchQueue.shift()! : this.fetchFallback;
    return fakeFetchOutcome(scenario, input, this.pageHtml);
  }

  async openBrowsing(input: OpenBrowsingInput): Promise<OpenBrowsingOutcome> {
    if (!fakeHasSession(input.session)) return fakeBrowsingFailure("not_logged_in");
    const scenario = this.browsingQueue.shift();
    if (scenario === undefined) return fakeBrowsingFailure("error");
    if (scenario === "unavailable" || scenario === "error") return fakeBrowsingFailure(scenario);
    const site = typeof scenario === "function" ? scenario() : scenario;
    const browsing = new FakeBrowsingSession(site, input.session);
    this.browsings.push(browsing);
    return { ok: true, browsing };
  }

  /** Ajoute des scénarios à la file. */
  enqueue(...scenarios: FakeScenario[]): this {
    this.queue.push(...scenarios);
    return this;
  }

  setFallback(scenario: FakeScenario): this {
    this.fallback = scenario;
    return this;
  }

  setLoginState(state: StorageState): this {
    this.loginState = state;
    return this;
  }

  async run(input: RunInput): Promise<RunOutcome> {
    this.calls.push({ action: input.action, hadSession: Boolean(input.session && (input.session.cookies.length || input.session.origins.length)), profileDir: input.profileDir });
    const scenario = this.queue.length > 0 ? this.queue.shift()! : this.fallback;
    if (typeof scenario === "function") return scenario(input);
    if (typeof scenario === "string") return fakeOutcome(scenario, input);
    return scenario;
  }

  async openLoginWindow(input: OpenLoginWindowInput): Promise<LoginWindowApi> {
    const win = new FakeLoginWindow({ state: this.loginState, timeoutMs: input.timeoutMs });
    this.loginWindows.push(win);
    return win;
  }
}

function toPageHtml(html: string | ((url: string) => string) | undefined): (url: string) => string {
  if (typeof html === "function") return html;
  const fixed = html ?? `<!doctype html><html><body><main><div data-testid="catalog-grid"></div></main></body></html>`;
  return () => fixed;
}

/**
 * Fenêtre de connexion factice : images émises à la demande, connexion
 * simulée par `setLoggedIn`. Les entrées sont comptées, jamais conservées.
 */
export class FakeLoginWindow implements LoginWindowApi {
  readonly id = randomUUID();
  readonly expiresAt: Date;
  readonly viewport = { width: 1280, height: 800 };
  inputCount = 0;
  private state: LoginWindowStatus = "open";
  private loggedIn = false;
  private signal: LoginBlockSignal | null = null;
  private readonly session: StorageState;
  private readonly frames = new Set<(f: ScreencastFrame) => void>();
  private readonly closes = new Set<(s: LoginWindowStatus) => void>();

  constructor(opts: { state: StorageState; timeoutMs?: number }) {
    this.session = opts.state;
    this.expiresAt = new Date(Date.now() + (opts.timeoutMs ?? 5 * 60_000));
  }

  get status(): LoginWindowStatus {
    return this.state;
  }

  setLoggedIn(value: boolean): void {
    this.loggedIn = value;
  }

  /** Simule un signal de Vinted affiché dans la fenêtre (CAPTCHA, blocage…). */
  setSignal(signal: LoginBlockSignal | null): void {
    this.signal = signal;
  }

  /** Simule une navigation hors de la liste autorisée (la vraie fenêtre se ferme « refused »). */
  refuse(): void {
    this.end("refused");
  }

  emitFrame(frame: Partial<ScreencastFrame> = {}): void {
    const f: ScreencastFrame = { data: frame.data ?? "", width: frame.width ?? this.viewport.width, height: frame.height ?? this.viewport.height, at: frame.at ?? Date.now() };
    for (const cb of this.frames) cb(f);
  }

  onFrame(cb: (frame: ScreencastFrame) => void): () => void {
    this.frames.add(cb);
    return () => {
      this.frames.delete(cb);
    };
  }

  onClose(cb: (status: LoginWindowStatus) => void): () => void {
    this.closes.add(cb);
    return () => {
      this.closes.delete(cb);
    };
  }

  async dispatchInput(event: unknown): Promise<void> {
    if (this.state !== "open") throw new LoginWindowClosedError();
    if (!loginInputEventSchema.safeParse(event).success) throw new LoginInputError();
    this.inputCount++;
  }

  async isLoggedIn(): Promise<boolean> {
    return this.state === "open" && this.loggedIn;
  }

  async blockSignal(): Promise<LoginBlockSignal | null> {
    return this.state === "open" ? this.signal : null;
  }

  async finish(): Promise<StorageState> {
    if (this.state !== "open") throw new LoginWindowClosedError();
    const state = filterStorageState(this.session);
    this.end("finished");
    return state;
  }

  async cancel(): Promise<void> {
    this.end("cancelled");
  }

  /** Simule l'expiration de la fenêtre. */
  expire(): void {
    this.end("expired");
  }

  private end(status: LoginWindowStatus): void {
    if (this.state !== "open") return;
    this.state = status;
    for (const cb of this.closes) cb(status);
    this.closes.clear();
    this.frames.clear();
  }
}

export { FakeBrowsingPage, FakeBrowsingSession, FAKE_BLOCK_PAGE_HTML, FAKE_RATE_LIMIT_HTML, fakeFetchOutcome } from "../radar/fake";
export type { FakeBrowsingScenario, FakeClickEffect, FakeFetchCall, FakeFetchScenario, FakeFetchScenarioName, FakeSite } from "../radar/fake";
