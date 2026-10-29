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

/**
 * Exécuteur factice pour les tests des autres paquets (core, worker, API) :
 * aucun navigateur, scénarios programmables, appels enregistrés.
 *
 * Scénarios nommés : `ok`, `captcha`, `warning`, `blocked`, `rate_limited`,
 * `not_logged_in`, `selector_missing`, `timeout`, `error`, `unavailable`
 * (aucun navigateur lancé) — ou une issue complète, ou une fonction de l'entrée.
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
}

export class FakeRunner implements BrowserRunner {
  readonly calls: FakeRunCall[] = [];
  readonly loginWindows: FakeLoginWindow[] = [];
  private readonly queue: FakeScenario[];
  private fallback: FakeScenario;
  private loginState: StorageState;

  constructor(options: FakeRunnerOptions = {}) {
    this.queue = [...(options.scenarios ?? [])];
    this.fallback = options.fallback ?? "ok";
    this.loginState = options.loginState ?? { cookies: [], origins: [] };
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
