import IORedis from "ioredis";
import { createProfileDir, removeProfileDir, sweepStaleProfiles, type BrowserRunner, type CloudAction as RunnerAction, type LoginBlockSignal, type LoginInputEvent, type LoginWindowApi, type ScreencastFrame } from "@selio/cloud";
import { repos } from "@selio/db";
import { AppError, cloud, type CloudExecutor, type CloudExecutorAction, type CloudExecutorInput, type CloudRunOutcome, type Services } from "@selio/core";
import type { TaskLogger } from "./tasks";

/**
 * Selio Cloud côté worker : exécuteur de navigateur (PlaywrightRunner de @selio/cloud), passage du
 * planificateur (`cloud.tick`) et fenêtre de connexion (`cloud.login`, file « selio-cloud-login »).
 *
 * Journaux : identifiants, codes et compteurs seulement — jamais la session, jamais le texte d'un
 * message, jamais un événement clavier ou souris.
 */

export const CLOUD_LOGIN_QUEUE = "selio-cloud-login";
export const CLOUD_LOGIN_JOB = "cloud.login";

// Protocole Redis de la fenêtre de connexion (le même que apps/api/src/cloud-relay.ts, à garder aligné).
export const cloudScreenChannel = (loginSessionId: string) => `cloud:screen:${loginSessionId}`;
export const cloudInputChannel = (loginSessionId: string) => `cloud:input:${loginSessionId}`;

/** Messages publiés vers l'API (relayés tels quels au navigateur du client). */
export type ScreenMessage =
  | { type: "frame"; data: string; width: number; height: number }
  | { type: "status"; status: "starting" | "open" }
  | { type: "done" }
  /**
   * `vinted_signal` : CAPTCHA, blocage, avertissement ou « trop de requêtes » pendant la connexion
   * (fenêtre fermée sans session, compte en pause) ; `navigation_refused` : page ou redirection hors de
   * Vinted et des fournisseurs de connexion (fenêtre fermée).
   */
  | { type: "closed"; reason: "expired" | "cancelled" | "error" | "no_session" | "unavailable" | "vinted_signal" | "navigation_refused" };

// ---------------------------------------------------------------- exécuteur

/**
 * Traduit une action du cœur en action du navigateur. `bulk_edit` (lourde) n'a pas d'implémentation
 * navigateur : refusée sans rien ouvrir.
 */
export function toRunnerAction(action: CloudExecutorAction): RunnerAction | null {
  if (action.kind === "reply" || action.kind === "follow_up") {
    if (!action.conversationUrl || !action.text) return null;
    return { kind: action.kind, conversationUrl: action.conversationUrl, text: action.text, id: action.id };
  }
  if (action.kind === "republish") return action.itemUrl ? { kind: "republish", itemUrl: action.itemUrl, id: action.id } : null;
  return null;
}

/**
 * Exécuteur du cœur bâti sur un `BrowserRunner` (Playwright en production, FakeRunner en test) :
 * un dossier de travail temporaire neuf par action (CLOUD_PROFILE_DIR), supprimé à la fin. Un refus
 * avant tout lancement est signalé `launched: false` (rien n'a touché Vinted, rien n'est compté).
 */
export class RunnerCloudExecutor implements CloudExecutor {
  constructor(private readonly runner: BrowserRunner, private readonly profileBaseDir: string) {}

  async run(input: CloudExecutorInput): Promise<CloudRunOutcome> {
    const action = toRunnerAction(input.action);
    if (!action) return { ok: false, code: "error", message: "Action non prise en charge par le navigateur du Cloud.", sideEffects: "none", launched: false, durationMs: 0 };
    let profileDir: string;
    try {
      profileDir = await createProfileDir(this.profileBaseDir);
    } catch {
      return { ok: false, code: "unavailable", message: "Dossier de travail du navigateur indisponible.", sideEffects: "none", launched: false, durationMs: 0 };
    }
    try {
      return await this.runner.run({ session: input.session, action, profileDir });
    } finally {
      // Le runner supprime déjà le profil ; ceinture et bretelles (exception avant son nettoyage).
      await removeProfileDir(profileDir).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------- planificateur

export interface CloudTickDeps {
  /** Null quand le Cloud est désactivé (CLOUD_ENABLED faux ou CLOUD_CHROMIUM_PATH absent). */
  executor: CloudExecutor | null;
  /** Organisations traitées en parallèle (CLOUD_MAX_BROWSERS) ; les navigateurs restent bornés par les créneaux du runner. */
  concurrency: number;
  now?: Date;
  rng?: () => number;
  /** Arrêt du worker demandé : aucune nouvelle action (celle en cours se termine). */
  shouldStop?: () => boolean;
  /**
   * Balayage périodique des dossiers de travail abandonnés (CLOUD_PROFILE_DIR) : à chaque passage,
   * ceux plus vieux que `maxAgeMs` (plus longue action ou fenêtre + marge) sont supprimés.
   */
  profiles?: { baseDir: string; maxAgeMs: number };
}

export interface CloudTickSummary {
  enabled: boolean;
  orgs: number;
  executed: number;
  done: number;
  failed: number;
  paused: number;
  needsLogin: number;
  /** Tâches remises en file faute de navigateur libre (rien n'a touché Vinted). */
  requeued: number;
  recovered: number;
  errors: number;
  /** Dossiers de travail abandonnés supprimés pendant ce passage. */
  swept: number;
  /** Coupe-circuit de la machine en cours (fin), ou déclenché pendant ce passage. */
  machinePausedUntil: string | null;
}

/**
 * Passage du planificateur : pour chaque organisation ayant des comptes Cloud, `runDueCloudJobs`
 * (accord, offre, heures actives, plafonds, une action par compte, pause au premier signal de
 * Vinted, rien n'est retenté). Cloud désactivé : rien n'est fait.
 */
export async function cloudTick(services: Services, log: TaskLogger, deps: CloudTickDeps): Promise<CloudTickSummary> {
  const summary: CloudTickSummary = { enabled: !!deps.executor, orgs: 0, executed: 0, done: 0, failed: 0, paused: 0, needsLogin: 0, requeued: 0, recovered: 0, errors: 0, swept: 0, machinePausedUntil: null };
  if (!deps.executor) {
    log.info({}, "Cloud désactivé : aucune action (CLOUD_ENABLED=true et CLOUD_CHROMIUM_PATH requis)");
    return summary;
  }
  // Dossiers de travail laissés par un arrêt brutal pendant que le worker tournait déjà (ou redémarrait vite).
  if (deps.profiles) summary.swept = await sweepStaleProfiles(deps.profiles.baseDir, deps.profiles.maxAgeMs).catch(() => 0);
  const res = await cloud.runCloudTick(services, deps.executor, {
    concurrency: deps.concurrency,
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.rng ? { rng: deps.rng } : {}),
    ...(deps.shouldStop ? { shouldStop: deps.shouldStop } : {}),
  });
  summary.orgs = res.orgs;
  summary.machinePausedUntil = res.machinePausedUntil;
  if (res.machinePausedUntil) log.warn({ until: res.machinePausedUntil }, "cloud : suspendu sur la machine (coupe-circuit après un signal de Vinted) — aucune action");
  for (const s of res.summaries) {
    summary.executed += s.executed;
    summary.done += s.done;
    summary.failed += s.failed;
    summary.paused += s.paused.length;
    summary.needsLogin += s.needsLogin.length;
    summary.requeued += s.requeued;
    summary.recovered += s.recovered;
    if (s.paused.length) log.warn({ orgId: s.orgId, accounts: s.paused }, "cloud : compte en pause après un signal de Vinted (aucune nouvelle tentative)");
    if (s.circuitUntil) {
      summary.machinePausedUntil = s.circuitUntil;
      // Alerte de l'opérateur : l'adresse partagée a reçu « trop de requêtes » ou un blocage.
      log.error({ orgId: s.orgId, until: s.circuitUntil }, "cloud : COUPE-CIRCUIT déclenché (trop de requêtes ou blocage de Vinted sur l'adresse partagée) — plus aucune action Cloud jusqu'à la date indiquée");
    }
    if (s.recovered) log.warn({ orgId: s.orgId, recovered: s.recovered }, "cloud : passage interrompu repris — comptes concernés mis en pause (« interrupted »)");
    if (s.requeued) log.warn({ orgId: s.orgId, requeued: s.requeued }, "cloud : aucun navigateur libre — tâches remises en file");
    if (s.executed || s.recovered || s.needsLogin.length) {
      log.info({ orgId: s.orgId, executed: s.executed, done: s.done, failed: s.failed, needsLogin: s.needsLogin.length, recovered: s.recovered, skipped: s.skipped }, "cloud : passage");
    }
  }
  for (const e of res.errors) {
    summary.errors++;
    log.error({ orgId: e.orgId }, "cloud : échec du passage pour une organisation");
  }
  return summary;
}

/**
 * Un seul passage à la fois dans ce processus : le planning tourne chaque minute alors qu'un
 * passage peut durer plus longtemps (actions au rythme humain). Le job de maintenance rend la main
 * tout de suite pour ne pas retenir les autres tâches (file à un seul exécutant).
 */
export class CloudTickRunner {
  private running: Promise<CloudTickSummary | null> | null = null;
  private stoppingFlag = false;

  constructor(private readonly tick: () => Promise<CloudTickSummary>, private readonly log: TaskLogger) {}

  /** Arrêt demandé : plus aucun passage ni aucune nouvelle action (le passage en cours finit son action). */
  get stopping(): boolean {
    return this.stoppingFlag;
  }

  stop(): void {
    this.stoppingFlag = true;
  }

  trigger(): { started: boolean } {
    if (this.running || this.stoppingFlag) return { started: false };
    this.running = this.tick()
      .catch((err: unknown) => {
        this.log.error({ error: err instanceof Error ? err.name : "Error" }, "cloud : passage en échec");
        return null;
      })
      .finally(() => {
        this.running = null;
      });
    return { started: true };
  }

  /** Attend la fin du passage en cours (arrêt du worker), au plus `timeoutMs`. */
  async drain(timeoutMs: number): Promise<void> {
    const current = this.running;
    if (!current) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([current, new Promise((r) => { timer = setTimeout(r, timeoutMs); })]);
    if (timer) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- fenêtre de connexion

/** Canal entre le worker et l'API (Redis pub/sub en production, mémoire en test). */
export interface CloudLoginBus {
  publishScreen(loginSessionId: string, message: ScreenMessage): Promise<void>;
  /** Abonne un récepteur aux messages de l'API (entrées, « hello », « cancel ») ; renvoie le désabonnement. */
  subscribeInput(loginSessionId: string, onMessage: (raw: string) => void): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

export function createRedisLoginBus(redisUrl: string, log: TaskLogger): CloudLoginBus {
  const pub = new IORedis(redisUrl, { maxRetriesPerRequest: 2 });
  pub.on("error", (e) => log.warn({ error: e.message }, "redis (cloud)"));
  const listeners = new Map<string, Set<(raw: string) => void>>();
  let sub: Promise<IORedis> | null = null;
  const subscriber = () => {
    sub ??= (async () => {
      const s = new IORedis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
      s.on("error", (e) => log.warn({ error: e.message }, "redis (cloud, abonnement)"));
      s.on("message", (channel: string, raw: string) => {
        for (const cb of listeners.get(channel) ?? []) {
          try {
            cb(raw);
          } catch {
            // un récepteur défaillant n'empêche pas les autres
          }
        }
      });
      await s.connect();
      return s;
    })().catch((err: unknown) => {
      sub = null;
      throw err;
    });
    return sub;
  };
  return {
    async publishScreen(loginSessionId, message) {
      await pub.publish(cloudScreenChannel(loginSessionId), JSON.stringify(message));
    },
    async subscribeInput(loginSessionId, onMessage) {
      const channel = cloudInputChannel(loginSessionId);
      const s = await subscriber();
      let set = listeners.get(channel);
      if (!set) {
        set = new Set();
        listeners.set(channel, set);
        await s.subscribe(channel);
      }
      set.add(onMessage);
      return async () => {
        const current = listeners.get(channel);
        current?.delete(onMessage);
        if (current && current.size === 0) {
          listeners.delete(channel);
          await s.unsubscribe(channel).catch(() => {});
        }
      };
    },
    async close() {
      listeners.clear();
      if (sub) (await sub.catch(() => null))?.disconnect();
      pub.disconnect();
    },
  };
}

export interface CloudLoginDeps {
  /** Null quand le Cloud est désactivé : la fenêtre est refermée aussitôt (« indisponible »). */
  runner: BrowserRunner | null;
  bus: CloudLoginBus;
  profileBaseDir: string;
  /** CLOUD_LOGIN_TIMEOUT_MS, borné par l'expiration du ticket. */
  loginTimeoutMs: number;
  /** Intervalle de détection de la connexion (1,5 s par défaut). */
  pollMs?: number;
  /** Intervalle de relecture de l'état en base (annulation, compte arrêté ; 5 s par défaut). */
  statusPollMs?: number;
}

export type CloudLoginOutcome = "done" | "expired" | "cancelled" | "no_session" | "error" | "unavailable" | "skipped" | "vinted_signal" | "refused";

export interface CloudLoginResult {
  outcome: CloudLoginOutcome;
  frames: number;
  inputs: number;
  rejected: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fenêtre de connexion : Chromium ouvert sur la page de connexion de Vinted, images publiées pour
 * l'API, entrées du client relayées (dans l'ordre, jamais journalisées). Dès que la connexion est
 * détectée, la session (vinted.* seulement) est lue, chiffrée et enregistrée par
 * `cloud.completeLogin`, puis « done » est publié. Sinon la fenêtre expire au bout de
 * CLOUD_LOGIN_TIMEOUT_MS (et jamais après le ticket), ou se ferme sur annulation.
 *
 * Signal de Vinted dans la fenêtre (CAPTCHA, blocage, avertissement, trop de requêtes) : la fenêtre
 * est fermée SANS lire ni enregistrer la session (`cloud.loginBlocked` : compte en pause, client
 * prévenu, coupe-circuit sur « trop de requêtes » ou blocage). Navigation hors liste (redirection
 * comprise) : la fenêtre se ferme d'elle-même (« refused »), rien n'est enregistré.
 */
export async function cloudLoginTask(services: Services, deps: CloudLoginDeps, loginSessionId: string, log: TaskLogger): Promise<CloudLoginResult> {
  const result: CloudLoginResult = { outcome: "skipped", frames: 0, inputs: 0, rejected: 0 };
  const publish = (message: ScreenMessage) => deps.bus.publishScreen(loginSessionId, message).catch(() => {});
  const findOpen = async () => {
    const found = await services.db.withGlobal((tx) => repos.cloudLoginSessions.findGlobal(tx, loginSessionId));
    return found && found.status === "open" && new Date(found.expiresAt).getTime() > services.now().getTime() ? found : null;
  };
  const done = (outcome: CloudLoginOutcome) => {
    result.outcome = outcome;
    log.info({ loginSessionId, outcome, frames: result.frames, inputs: result.inputs, rejected: result.rejected }, "cloud : fenêtre de connexion terminée");
    return result;
  };

  if (!UUID_RE.test(loginSessionId)) return done("skipped");
  const found = await findOpen();
  if (!found) {
    // Fenêtre déjà close, annulée ou expirée avant d'être prise en charge.
    await cloud.abandonLogin(services, loginSessionId, "expired").catch(() => false);
    await publish({ type: "closed", reason: "expired" });
    return done("skipped");
  }
  if (!deps.runner) {
    await cloud.abandonLogin(services, loginSessionId, "cancelled").catch(() => false);
    await publish({ type: "closed", reason: "unavailable" });
    log.info({ loginSessionId }, "Cloud désactivé : fenêtre de connexion refusée");
    return done("unavailable");
  }

  const remaining = new Date(found.expiresAt).getTime() - services.now().getTime();
  const timeoutMs = Math.max(1_000, Math.min(deps.loginTimeoutMs, remaining));
  await publish({ type: "status", status: "starting" });

  let profileDir: string | null = null;
  let win: LoginWindowApi | null = null;
  const cleanups: (() => void | Promise<void>)[] = [];
  try {
    profileDir = await createProfileDir(deps.profileBaseDir);
    try {
      win = await deps.runner.openLoginWindow({ profileDir, timeoutMs });
    } catch (err) {
      log.warn({ loginSessionId, error: err instanceof Error ? err.name : "Error" }, "cloud : fenêtre de connexion impossible à ouvrir");
      await cloud.abandonLogin(services, loginSessionId, "cancelled").catch(() => false);
      await publish({ type: "closed", reason: "unavailable" });
      return done("unavailable");
    }
    const window = win;
    let lastFrame: ScreencastFrame | null = null;
    const sendFrame = (frame: ScreencastFrame) => {
      result.frames++;
      void publish({ type: "frame", data: frame.data, width: frame.width, height: frame.height });
    };
    cleanups.push(
      window.onFrame((frame) => {
        lastFrame = frame;
        sendFrame(frame);
      }),
    );

    type Ending = "logged_in" | "expired" | "cancelled" | "closed" | "refused" | "vinted_signal";
    let signal: LoginBlockSignal | null = null;
    let settle: (e: Ending) => void = () => {};
    const ending = new Promise<Ending>((resolve) => {
      let settled = false;
      settle = (e) => {
        if (settled) return;
        settled = true;
        resolve(e);
      };
    });
    cleanups.push(window.onClose((status) => settle(status === "expired" ? "expired" : status === "cancelled" ? "cancelled" : status === "refused" ? "refused" : "closed")));

    // Entrées du client : transmises dans l'ordre d'arrivée ; seul leur nombre est compté.
    let chain: Promise<void> = Promise.resolve();
    const onInput = (raw: string) => {
      let msg: { type?: unknown; event?: unknown } | null = null;
      try {
        msg = JSON.parse(raw) as { type?: unknown; event?: unknown };
      } catch {
        msg = null;
      }
      if (msg?.type === "input") {
        const event = msg.event;
        chain = chain.then(
          // Revalidé par la fenêtre (loginInputEventSchema) avant d'atteindre Chromium.
          () => window.dispatchInput(event as LoginInputEvent).then(() => { result.inputs++; }, () => { result.rejected++; }),
        );
      } else if (msg?.type === "hello") {
        if (lastFrame) sendFrame(lastFrame);
      } else if (msg?.type === "cancel") {
        settle("cancelled");
      } else {
        result.rejected++;
      }
    };
    cleanups.push(await deps.bus.subscribeInput(loginSessionId, onInput));
    await publish({ type: "status", status: "open" });

    // Détection de la connexion et relecture de l'état en base (annulation, arrêt du compte).
    let checking = false;
    const loginTimer = setInterval(() => {
      if (checking) return;
      checking = true;
      (async () => {
        // Un signal de Vinted passe avant tout : jamais de session enregistrée derrière un CAPTCHA.
        const found = await window.blockSignal().catch(() => null);
        if (found) {
          signal = found;
          settle("vinted_signal");
          return;
        }
        if (await window.isLoggedIn().catch(() => false)) settle("logged_in");
      })().finally(() => { checking = false; });
    }, deps.pollMs ?? 1_500);
    const statusTimer = setInterval(() => {
      services.db
        .withGlobal((tx) => repos.cloudLoginSessions.findGlobal(tx, loginSessionId))
        .then((s) => {
          if (!s || s.status !== "open") settle("cancelled");
          else if (new Date(s.expiresAt).getTime() <= services.now().getTime()) settle("expired");
        }, () => {});
    }, deps.statusPollMs ?? 5_000);
    cleanups.push(() => clearInterval(loginTimer), () => clearInterval(statusTimer));

    let ended = await ending;
    if (ended === "logged_in") {
      // Dernière vérification avant de lire la session.
      const last = await window.blockSignal().catch(() => null);
      if (last) {
        signal = last;
        ended = "vinted_signal";
      }
    }
    if (ended === "vinted_signal" && signal) {
      const code = (signal as LoginBlockSignal).code;
      await window.cancel().catch(() => {});
      await cloud.loginBlocked(services, loginSessionId, code).catch(() => false);
      await publish({ type: "closed", reason: "vinted_signal" });
      log.warn({ loginSessionId, code }, "cloud : signal de Vinted pendant la connexion — fenêtre fermée, session non enregistrée, compte en pause");
      return done("vinted_signal");
    }
    if (ended === "refused") {
      await cloud.abandonLogin(services, loginSessionId, "cancelled").catch(() => false);
      await publish({ type: "closed", reason: "navigation_refused" });
      log.warn({ loginSessionId }, "cloud : navigation hors de Vinted dans la fenêtre de connexion — fenêtre fermée");
      return done("refused");
    }
    if (ended === "logged_in") {
      let state: unknown;
      try {
        state = await window.finish();
      } catch {
        await cloud.abandonLogin(services, loginSessionId, "cancelled").catch(() => false);
        await publish({ type: "closed", reason: "error" });
        return done("error");
      }
      try {
        await cloud.completeLogin(services, loginSessionId, state);
      } catch (err) {
        const noSession = err instanceof AppError && err.code === "validation";
        await cloud.abandonLogin(services, loginSessionId, "cancelled").catch(() => false);
        await publish({ type: "closed", reason: noSession ? "no_session" : "error" });
        if (!(err instanceof AppError)) log.error({ loginSessionId, error: err instanceof Error ? err.name : "Error" }, "cloud : enregistrement de la session en échec");
        return done(noSession ? "no_session" : "error");
      }
      await publish({ type: "done" });
      return done("done");
    }
    const status = ended === "expired" ? "expired" : "cancelled";
    await cloud.abandonLogin(services, loginSessionId, status).catch(() => false);
    await publish({ type: "closed", reason: status });
    return done(status);
  } finally {
    for (const c of cleanups.reverse()) {
      try {
        await c();
      } catch {
        // nettoyage au mieux
      }
    }
    if (win && win.status === "open") await win.cancel().catch(() => {});
    if (profileDir) await removeProfileDir(profileDir).catch(() => {});
  }
}
