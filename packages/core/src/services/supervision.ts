import { radarAlertPayload, type RadarAlertPayload } from "@selio/contracts";
import { repos, type Tx } from "@selio/db";
import { sendEmail, type Services } from "../context";
import { PUSH_MAX_FAILURES, type PushTarget } from "./alerts";

/**
 * Supervision des services de Selio (worker, tâche « supervision.tick » chaque minute).
 *
 * - `checkTargets` interroge chaque cible (par défaut /api/health et /api/ai/health de l'API) avec un délai
 *   borné : succès = statut HTTP 2xx et, si la réponse est un objet JSON, `ok` différent de `false`.
 * - `nextState` est la machine à états, pure : une cible passe « en panne » après
 *   SUPERVISION_FAILURES_BEFORE_ALERT échecs consécutifs (alerte UNE fois), un rappel part toutes les
 *   SUPERVISION_REMINDER_MINUTES tant que la panne dure, et le rétablissement est notifié (seulement si une
 *   alerte était partie : un échec isolé ne réveille personne).
 * - `recordCheck` applique la machine dans une transaction, ligne de la cible verrouillée (`for update`) :
 *   deux workers ne peuvent pas envoyer deux fois la même alerte.
 * - `notifyOperators` prévient les opérateurs (OPERATOR_EMAILS) : Web Push sur leurs appareils abonnés
 *   (toutes organisations confondues) et email. Ni l'un ni l'autre n'est obligatoire : sans clés VAPID ou
 *   sans fournisseur d'email, l'événement est tout de même enregistré et journalisé.
 *
 * Rien de secret n'est enregistré : l'adresse est gardée sans requête ni identifiants, les en-têtes (jeton
 * de santé de l'IA) ne quittent jamais la mémoire du worker, les erreurs sont tronquées.
 *
 * Panne de la base : l'état est tenu en mémoire du worker et l'alerte part par email seul (voir
 * `supervisionTick`). Une alerte délivrée à personne (email « noop », aucun push) est retentée au passage
 * suivant et journalisée en erreur.
 *
 * Limites assumées : le worker tourne sur la même machine que l'API ; si la machine entière tombe, personne
 * n'est prévenu par lui. Si Redis tombe, le planning BullMQ ne déclenche plus aucun passage. Pour ces deux
 * cas, un battement externe est indispensable : un service de disponibilité gratuit qui interroge
 * /api/health de l'extérieur, ou qui attend le battement SUPERVISION_HEARTBEAT_URL du worker (désactivé par
 * défaut, voir apps/worker/.env.example et docs/SUPERVISION.md).
 */

export const SUPERVISION_FAILURES_BEFORE_ALERT = 3;
export const SUPERVISION_REMINDER_MINUTES = 60;
export const SUPERVISION_TIMEOUT_MS = 10_000;
/** Historique gardé pour /api/health/details. */
export const SUPERVISION_HISTORY_DAYS = 7;
/** Chemin de l'application ouvert par la notification (page Administration, opérateurs). */
export const SUPERVISION_APP_PATH = "/admin";

// ---------------------------------------------------------------- types

export interface SupervisionTarget {
  /** Nom court affiché dans l'alerte (« api », « ia »). */
  name: string;
  url: string;
  /** En-têtes envoyés (jeton de santé de l'IA) : jamais enregistrés ni journalisés. */
  headers?: Record<string, string>;
}

/** Réponse HTTP minimale (fetch standard, ou simulé en test). */
export interface SupervisionResponse {
  status: number;
  json?: () => Promise<unknown>;
}
export type SupervisionFetch = (url: string, init: { method: "GET"; headers: Record<string, string>; signal: AbortSignal }) => Promise<SupervisionResponse>;

/** Réglages de la supervision (`services.supervision`), fournis par le worker. */
export interface SupervisionServices {
  /** HTTP injectable (fetch global par défaut). */
  fetch?: SupervisionFetch;
  /** Destinataires des alertes : OPERATOR_EMAILS. */
  operatorEmails?: string[];
  failuresBeforeAlert?: number;
  reminderMinutes?: number;
  timeoutMs?: number;
  /**
   * État des cibles gardé en mémoire du worker : secours quand la base est injoignable (la supervision ne
   * dépend pas du composant qu'elle surveille), resynchronisé avec la base dès qu'elle répond. Créé au
   * premier passage s'il n'est pas fourni.
   */
  memory?: Map<string, TargetState>;
}

export interface CheckResult {
  name: string;
  /** Adresse sans requête, fragment ni identifiants. */
  url: string;
  ok: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  error: string | null;
  checkedAt: string;
}

export type TargetStatus = "unknown" | "up" | "down";
export type SupervisionEvent = "alert" | "reminder" | "recovered";

export interface TargetState {
  name: string;
  url: string;
  status: TargetStatus;
  consecutiveFailures: number;
  /** Premier échec de la série en cours. */
  failingSince: string | null;
  /** Passage « en panne » (alerte envoyée). */
  downSince: string | null;
  lastAlertAt: string | null;
  lastCheckedAt: string | null;
  lastOkAt: string | null;
  lastStatusCode: number | null;
  lastLatencyMs: number | null;
  lastError: string | null;
}

export interface StateOptions {
  failuresBeforeAlert?: number;
  reminderMinutes?: number;
}

// ---------------------------------------------------------------- vérification

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

/** Adresse sans requête, fragment ni identifiants (rien de secret dans l'historique). */
export function safeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return clip(`${u.protocol}//${u.host}${u.pathname}`, 500);
  } catch {
    return "adresse invalide";
  }
}

function errorText(err: unknown, timeoutMs: number, aborted: boolean): string {
  if (aborted) return `délai dépassé (${Math.round(timeoutMs / 100) / 10} s)`;
  const e = err as { name?: string; message?: string; cause?: { code?: string } } | null;
  const code = typeof e?.cause?.code === "string" ? ` (${e.cause.code})` : "";
  return clip(`${e?.message || e?.name || "erreur réseau"}${code}`, 200);
}

async function checkOne(target: SupervisionTarget, doFetch: SupervisionFetch, timeoutMs: number, now: () => Date): Promise<CheckResult> {
  const url = safeUrl(target.url);
  const checkedAt = now().toISOString();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = performance.now();
  try {
    const res = await Promise.race([
      doFetch(target.url, { method: "GET", headers: { accept: "application/json", ...(target.headers ?? {}) }, signal: ctrl.signal }),
      new Promise<never>((_, reject) => ctrl.signal.addEventListener("abort", () => reject(new Error("abort")), { once: true })),
    ]);
    const latencyMs = Math.round(performance.now() - started);
    if (res.status < 200 || res.status >= 300) return { name: target.name, url, ok: false, statusCode: res.status, latencyMs, error: `HTTP ${res.status}`, checkedAt };
    // Réponse JSON qui se déclare en échec (`ok: false`) : la cible répond mais ne va pas bien.
    let body: unknown = null;
    try {
      body = res.json ? await res.json() : null;
    } catch {
      body = null;
    }
    if (body && typeof body === "object" && (body as { ok?: unknown }).ok === false) {
      return { name: target.name, url, ok: false, statusCode: res.status, latencyMs, error: "réponse « ok: false »", checkedAt };
    }
    return { name: target.name, url, ok: true, statusCode: res.status, latencyMs, error: null, checkedAt };
  } catch (err) {
    return { name: target.name, url, ok: false, statusCode: null, latencyMs: null, error: errorText(err, timeoutMs, ctrl.signal.aborted), checkedAt };
  } finally {
    clearTimeout(timer);
  }
}

const globalFetch: SupervisionFetch = (url, init) => fetch(url, init);

/** Interroge toutes les cibles en parallèle (délai `timeoutMs` par cible, 10 s par défaut). */
export async function checkTargets(services: Pick<Services, "now" | "supervision">, targets: SupervisionTarget[]): Promise<CheckResult[]> {
  const doFetch = services.supervision?.fetch ?? globalFetch;
  const timeoutMs = services.supervision?.timeoutMs ?? SUPERVISION_TIMEOUT_MS;
  return Promise.all(targets.map((t) => checkOne(t, doFetch, timeoutMs, services.now)));
}

// ---------------------------------------------------------------- machine à états

export function initialState(name: string, url: string): TargetState {
  return { name, url, status: "unknown", consecutiveFailures: 0, failingSince: null, downSince: null, lastAlertAt: null, lastCheckedAt: null, lastOkAt: null, lastStatusCode: null, lastLatencyMs: null, lastError: null };
}

/**
 * État suivant d'une cible après une vérification, et la notification à envoyer :
 * - échec n° `failuresBeforeAlert` (3) d'affilée → « alert » (une seule fois) ;
 * - toujours en panne, dernière notification il y a `reminderMinutes` (60) ou plus → « reminder » ;
 * - succès après une panne signalée → « recovered » ; succès après des échecs non signalés → rien.
 */
export function nextState(prev: TargetState, r: CheckResult, opts: StateOptions = {}): { state: TargetState; event: SupervisionEvent | null } {
  const threshold = Math.max(1, opts.failuresBeforeAlert ?? SUPERVISION_FAILURES_BEFORE_ALERT);
  const reminderMs = Math.max(1, opts.reminderMinutes ?? SUPERVISION_REMINDER_MINUTES) * 60_000;
  const base = { ...prev, url: r.url, lastCheckedAt: r.checkedAt, lastStatusCode: r.statusCode, lastLatencyMs: r.latencyMs };
  if (r.ok) {
    const state: TargetState = { ...base, status: "up", consecutiveFailures: 0, failingSince: null, downSince: null, lastAlertAt: null, lastOkAt: r.checkedAt, lastError: null };
    return { state, event: prev.status === "down" ? "recovered" : null };
  }
  const failures = prev.consecutiveFailures + 1;
  const failed = { ...base, consecutiveFailures: failures, failingSince: prev.failingSince ?? r.checkedAt, lastError: r.error };
  if (prev.status === "down") {
    const last = prev.lastAlertAt ? new Date(prev.lastAlertAt).getTime() : 0;
    if (new Date(r.checkedAt).getTime() - last >= reminderMs) return { state: { ...failed, status: "down", lastAlertAt: r.checkedAt }, event: "reminder" };
    return { state: { ...failed, status: "down" }, event: null };
  }
  if (failures >= threshold) return { state: { ...failed, status: "down", downSince: r.checkedAt, lastAlertAt: r.checkedAt }, event: "alert" };
  return { state: { ...failed, status: prev.status }, event: null };
}

// ---------------------------------------------------------------- persistance (tables globales, 0016)

function rowToState(r: Record<string, unknown>): TargetState {
  const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
  const num = (v: unknown) => (v == null ? null : Number(v));
  return {
    name: String(r.name),
    url: String(r.url),
    status: (r.status as TargetStatus) ?? "unknown",
    consecutiveFailures: Number(r.consecutiveFailures ?? 0),
    failingSince: iso(r.failingSince),
    downSince: iso(r.downSince),
    lastAlertAt: iso(r.lastAlertAt),
    lastCheckedAt: iso(r.lastCheckedAt),
    lastOkAt: iso(r.lastOkAt),
    lastStatusCode: num(r.lastStatusCode),
    lastLatencyMs: num(r.lastLatencyMs),
    lastError: r.lastError == null ? null : String(r.lastError),
  };
}

async function lockState(tx: Tx, name: string, url: string): Promise<TargetState> {
  await tx.query("insert into supervision_targets (name, url) values ($1, $2) on conflict (name) do nothing", [name, url]);
  return rowToState(await tx.one("select * from supervision_targets where name = $1 for update", [name], "Cible de supervision"));
}

/**
 * Applique une vérification : état verrouillé, machine à états, historique. Rend l'événement à notifier et
 * l'identifiant de la ligne d'historique. `fallbackPrev` : état gardé en mémoire pendant une panne de la
 * base ; s'il est plus récent que celui de la base, c'est lui qui sert de point de départ (resynchronisation :
 * ni alerte en double, ni rétablissement oublié).
 */
export async function recordCheck(services: Pick<Services, "db" | "supervision">, result: CheckResult, fallbackPrev?: TargetState | null): Promise<{ state: TargetState; event: SupervisionEvent | null; checkId: string | null }> {
  const opts = stateOptions(services);
  return services.db.withGlobal(async (tx) => {
    const stored = await lockState(tx, result.name, result.url);
    const prev = fallbackPrev && isNewer(fallbackPrev.lastCheckedAt, stored.lastCheckedAt) ? fallbackPrev : stored;
    const { state, event } = nextState(prev, result, opts);
    await tx.query(
      `update supervision_targets set url = $2, status = $3, consecutive_failures = $4, failing_since = $5, down_since = $6, last_alert_at = $7,
         last_checked_at = $8, last_ok_at = $9, last_status_code = $10, last_latency_ms = $11, last_error = $12, updated_at = now() where name = $1`,
      [state.name, state.url, state.status, state.consecutiveFailures, state.failingSince, state.downSince, state.lastAlertAt, state.lastCheckedAt, state.lastOkAt, state.lastStatusCode, state.lastLatencyMs, state.lastError ? clip(state.lastError, 300) : null],
    );
    const row = await tx.maybeOne<{ id: string }>("insert into supervision_checks (target, ok, status_code, latency_ms, error, event, checked_at) values ($1, $2, $3, $4, $5, $6, $7) returning id", [
      result.name, result.ok, result.statusCode, result.latencyMs, result.error ? clip(result.error, 300) : null, event, result.checkedAt,
    ]);
    return { state, event, checkId: row?.id ?? null };
  });
}

function stateOptions(services: Pick<Services, "supervision">): StateOptions {
  return { failuresBeforeAlert: services.supervision?.failuresBeforeAlert, reminderMinutes: services.supervision?.reminderMinutes };
}

function isNewer(a: string | null, b: string | null): boolean {
  if (!a) return false;
  if (!b) return true;
  return new Date(a).getTime() > new Date(b).getTime();
}

/**
 * Après la notification : nombre de canaux réellement délivrés, et, si personne n'a été prévenu d'une
 * alerte ou d'un rappel, `last_alert_at` remis à vide pour que le passage suivant retente (en rappel) au
 * lieu d'attendre 60 minutes.
 */
async function recordDelivery(services: Pick<Services, "db">, name: string, checkId: string | null, delivered: number, retry: boolean): Promise<void> {
  await services.db.withGlobal(async (tx) => {
    if (checkId) await tx.query("update supervision_checks set delivered = $2 where id = $1", [checkId, delivered]);
    if (retry) await tx.query("update supervision_targets set last_alert_at = null, updated_at = now() where name = $1 and status = 'down'", [name]);
  });
}

/** Retire l'historique de plus de SUPERVISION_HISTORY_DAYS jours. */
export async function pruneChecks(services: Pick<Services, "db" | "now">): Promise<number> {
  const before = new Date(services.now().getTime() - SUPERVISION_HISTORY_DAYS * 86_400_000).toISOString();
  return services.db.withGlobal(async (tx) => (await tx.query("delete from supervision_checks where checked_at < $1 returning id", [before])).length);
}

export interface SupervisionCheckRow {
  target: string;
  ok: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  error: string | null;
  event: SupervisionEvent | null;
  /** Canaux réellement délivrés pour la notification (push + emails d'un vrai fournisseur) ; null : aucune. */
  delivered: number | null;
  checkedAt: string;
}

/** Nombre maximal d'alertes rendues par `supervisionDetails` (période gardée : SUPERVISION_HISTORY_DAYS). */
export const SUPERVISION_ALERTS_LIMIT = 200;

function rowToCheck(r: Record<string, unknown>): SupervisionCheckRow {
  return {
    target: String(r.target),
    ok: Boolean(r.ok),
    statusCode: r.statusCode == null ? null : Number(r.statusCode),
    latencyMs: r.latencyMs == null ? null : Number(r.latencyMs),
    error: r.error == null ? null : String(r.error),
    event: (r.event as SupervisionEvent | null) ?? null,
    delivered: r.delivered == null ? null : Number(r.delivered),
    checkedAt: r.checkedAt instanceof Date ? r.checkedAt.toISOString() : String(r.checkedAt),
  };
}

/**
 * État de chaque cible, dernières vérifications (vue opérateur, /api/health/details) et TOUTES les alertes
 * de la période gardée (7 jours, au plus 200) : une panne de 3 h du matin reste visible le lendemain, même si
 * les 20 dernières vérifications de la cible sont redevenues normales.
 */
export async function supervisionDetails(services: Pick<Services, "db" | "now">, opts: { perTarget?: number } = {}): Promise<{ targets: TargetState[]; recent: SupervisionCheckRow[]; alerts: SupervisionCheckRow[] }> {
  const perTarget = Math.min(100, Math.max(1, opts.perTarget ?? 20));
  const since = new Date(services.now().getTime() - SUPERVISION_HISTORY_DAYS * 86_400_000).toISOString();
  return services.db.withGlobal(async (tx) => {
    const targets = (await tx.query("select * from supervision_targets order by name")).map(rowToState);
    const rows = await tx.query<Record<string, unknown>>(
      "select * from (select c.*, row_number() over (partition by target order by checked_at desc) as rn from supervision_checks c) x where rn <= $1 order by checked_at desc, target",
      [perTarget],
    );
    const alertRows = await tx.query<Record<string, unknown>>(
      "select * from supervision_checks where event is not null and checked_at > $1 order by checked_at desc limit $2",
      [since, SUPERVISION_ALERTS_LIMIT],
    );
    return { targets, recent: rows.map(rowToCheck), alerts: alertRows.map(rowToCheck) };
  });
}

// ---------------------------------------------------------------- notifications

function minutesBetween(fromIso: string | null, to: string): number {
  if (!fromIso) return 0;
  return Math.max(0, Math.round((new Date(to).getTime() - new Date(fromIso).getTime()) / 60_000));
}

/** Texte de la notification (Web Push et email). Aucun secret : nom de la cible, durée, dernière erreur. */
export function supervisionPayload(event: SupervisionEvent, state: TargetState, at: string): RadarAlertPayload {
  const err = state.lastError ? ` Dernière erreur : ${state.lastError}.` : "";
  const name = clip(state.name, 60);
  if (event === "alert") {
    return radarAlertPayload.parse({ title: clip(`Selio : « ${name} » ne répond plus`, 200), body: clip(`${state.consecutiveFailures} vérifications en échec d'affilée (depuis ${minutesBetween(state.failingSince, at)} min).${err}`, 400), url: SUPERVISION_APP_PATH });
  }
  if (event === "reminder") {
    return radarAlertPayload.parse({ title: clip(`Selio : « ${name} » toujours en panne`, 200), body: clip(`En panne depuis ${minutesBetween(state.downSince, at)} min (${state.consecutiveFailures} échecs d'affilée).${err}`, 400), url: SUPERVISION_APP_PATH });
  }
  return radarAlertPayload.parse({ title: clip(`Selio : « ${name} » rétabli`, 200), body: clip(`La vérification répond de nouveau${state.lastLatencyMs != null ? ` (${state.lastLatencyMs} ms)` : ""}.`, 400), url: SUPERVISION_APP_PATH });
}

export interface NotifyOutcome {
  pushSent: number;
  pushFailed: number;
  /** Emails remis à un VRAI fournisseur (le fournisseur « noop » n'en compte aucun). */
  emailsSent: number;
  emailsFailed: number;
  /** Emails passés au fournisseur « noop » : journalisés, jamais reçus par personne. */
  emailsNotDelivered: number;
}

/** Canaux réellement délivrés : push reçus par le service de notification + emails d'un vrai fournisseur. */
export function deliveredCount(n: Pick<NotifyOutcome, "pushSent" | "emailsSent">): number {
  return n.pushSent + n.emailsSent;
}

/**
 * Avertissements de démarrage du worker : la supervision sans aucun canal utilisable (email « noop » et pas
 * de clés VAPID, ou OPERATOR_EMAILS vide) enregistre les pannes mais ne prévient personne.
 */
export function supervisionChannelWarnings(input: { operatorEmails: number; emailDelivers: boolean; push: boolean; heartbeat: boolean }): string[] {
  const out: string[] = [];
  if (input.operatorEmails === 0) out.push("supervision : OPERATOR_EMAILS vide — les pannes sont enregistrées et journalisées, personne n'est prévenu");
  else if (!input.emailDelivers && !input.push) out.push("supervision : aucun canal d'alerte utilisable (email « noop » et clés VAPID absentes) — une panne ne préviendra personne");
  else if (!input.emailDelivers) out.push("supervision : email « noop » — seules les notifications Web Push des opérateurs abonnés partent, et pas quand la base de données est injoignable");
  else if (!input.push) out.push("supervision : clés VAPID absentes — alertes par email seulement");
  if (!input.heartbeat) out.push("supervision : battement externe désactivé (SUPERVISION_HEARTBEAT_URL) — une panne de la machine entière, ou de Redis (plus aucun passage planifié), ne sera signalée par personne");
  return out;
}

function statusOf(err: unknown): number | null {
  const s = (err as { statusCode?: unknown } | null)?.statusCode;
  return typeof s === "number" ? s : null;
}

/**
 * Prévient les opérateurs : Web Push sur chacun de leurs appareils abonnés (abonnements actifs, dans les
 * organisations dont ils sont membres) et un email chacun. Ne lève jamais.
 */
export async function notifyOperators(services: Services, payload: RadarAlertPayload, opts: { push?: boolean } = {}): Promise<NotifyOutcome> {
  const out: NotifyOutcome = { pushSent: 0, pushFailed: 0, emailsSent: 0, emailsFailed: 0, emailsNotDelivered: 0 };
  const emails = [...new Set((services.supervision?.operatorEmails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!emails.length) return out;
  const nowIso = services.now().toISOString();

  // Le push retrouve les abonnements dans la base : impossible quand elle est injoignable (`push: false`).
  if (services.push && opts.push !== false) {
    try {
      const memberships = await services.db.withGlobal((tx) =>
        tx.query<{ orgId: string; userId: string }>("select m.org_id, m.user_id from memberships m join users u on u.id = m.user_id where lower(u.email) = any($1::text[])", [emails]),
      );
      const seen = new Set<string>();
      for (const m of memberships) {
        await services.db.withOrg(m.orgId, async (tx) => {
          for (const sub of await repos.pushSubscriptions.listActive(tx, m.userId)) {
            if (seen.has(sub.endpoint)) continue;
            seen.add(sub.endpoint);
            const target: PushTarget = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
            let code: number | null;
            let ok: boolean;
            try {
              const r = await services.push!.send(target, payload);
              ok = r.ok;
              code = r.statusCode ?? null;
            } catch (err) {
              ok = false;
              code = statusOf(err);
            }
            if (ok) {
              out.pushSent++;
              await repos.pushSubscriptions.markUsed(tx, sub.id, nowIso);
            } else {
              out.pushFailed++;
              if (code === 404 || code === 410) await repos.pushSubscriptions.disable(tx, sub.id, nowIso);
              else await repos.pushSubscriptions.markFailure(tx, sub.id, nowIso, PUSH_MAX_FAILURES);
            }
          }
        });
      }
    } catch {
      out.pushFailed++;
    }
  }

  for (const to of emails) {
    const r = await sendEmail(services, { to, subject: payload.title, text: `${payload.body}\n\nDétails (opérateurs) : ${(services.publicWebUrl ?? "").replace(/\/+$/, "")}${payload.url}\n\nMessage automatique de la supervision de Selio.` });
    if (!r.sent) out.emailsFailed++;
    else if (services.email?.delivers === false) out.emailsNotDelivered++;
    else out.emailsSent++;
  }
  return out;
}

// ---------------------------------------------------------------- passage

export interface SupervisionTickSummary extends NotifyOutcome {
  checked: number;
  up: number;
  down: number;
  alerts: number;
  reminders: number;
  recovered: number;
  results: CheckResult[];
  /** `delivered` : canaux réellement délivrés pour cet événement (0 : personne n'a été prévenu). */
  events: { target: string; event: SupervisionEvent; delivered: number; dbUnavailable: boolean }[];
  /** Vrai si la base était injoignable pendant ce passage (état tenu en mémoire du worker, email seul). */
  dbUnavailable: boolean;
}

/** Note ajoutée aux alertes envoyées pendant une panne de la base (pas d'historique, email seulement). */
export const SUPERVISION_DB_DOWN_NOTE = "Base de données injoignable depuis le worker : état tenu en mémoire, historique non enregistré, alerte par email seulement.";

function memoryOf(services: Services): Map<string, TargetState> {
  services.supervision ??= {};
  services.supervision.memory ??= new Map();
  return services.supervision.memory;
}

/**
 * Un passage : vérifie les cibles, applique la machine à états, prévient les opérateurs, élague l'historique.
 *
 * Indépendant de la base qu'il surveille : si l'enregistrement échoue (PostgreSQL en panne, plus de
 * connexion), la machine à états tourne sur l'état gardé en mémoire du worker (même seuil, même rappel,
 * aucune alerte en double) et l'alerte part par email seul (le push a besoin de la base pour retrouver les
 * abonnements). L'état mémoire sert de point de départ au retour de la base.
 *
 * Alerte ou rappel délivré à personne (aucun push, email « noop » ou en échec) : `lastAlertAt` est remis à
 * vide pour retenter au passage suivant, au lieu d'attendre le rappel de 60 minutes.
 */
export async function supervisionTick(services: Services, targets: SupervisionTarget[]): Promise<SupervisionTickSummary> {
  const summary: SupervisionTickSummary = { checked: 0, up: 0, down: 0, alerts: 0, reminders: 0, recovered: 0, pushSent: 0, pushFailed: 0, emailsSent: 0, emailsFailed: 0, emailsNotDelivered: 0, results: [], events: [], dbUnavailable: false };
  const memory = memoryOf(services);
  const results = await checkTargets(services, targets);
  summary.results = results;
  for (const r of results) {
    summary.checked++;
    const remembered = memory.get(r.name) ?? null;
    let state: TargetState;
    let event: SupervisionEvent | null;
    let checkId: string | null = null;
    let dbDown = false;
    try {
      ({ state, event, checkId } = await recordCheck(services, r, remembered));
    } catch {
      dbDown = true;
      summary.dbUnavailable = true;
      ({ state, event } = nextState(remembered ?? initialState(r.name, r.url), r, stateOptions(services)));
    }
    memory.set(r.name, state);
    if (state.status === "down") summary.down++;
    else if (r.ok) summary.up++;
    if (!event) continue;
    if (event === "alert") summary.alerts++;
    else if (event === "reminder") summary.reminders++;
    else summary.recovered++;
    const base = supervisionPayload(event, state, r.checkedAt);
    const payload = dbDown ? { ...base, body: clip(`${base.body} ${SUPERVISION_DB_DOWN_NOTE}`, 400) } : base;
    const n = await notifyOperators(services, payload, { push: !dbDown });
    summary.pushSent += n.pushSent;
    summary.pushFailed += n.pushFailed;
    summary.emailsSent += n.emailsSent;
    summary.emailsFailed += n.emailsFailed;
    summary.emailsNotDelivered += n.emailsNotDelivered;
    const delivered = deliveredCount(n);
    summary.events.push({ target: r.name, event, delivered, dbUnavailable: dbDown });
    // Personne n'a été prévenu d'une panne : on retente au passage suivant (en rappel).
    const retry = delivered === 0 && event !== "recovered";
    if (retry) memory.set(r.name, { ...state, lastAlertAt: null });
    if (!dbDown) {
      try {
        await recordDelivery(services, r.name, checkId, delivered, retry);
      } catch {
        summary.dbUnavailable = true;
      }
    }
  }
  try {
    await pruneChecks(services);
  } catch {
    summary.dbUnavailable = true;
  }
  return summary;
}

// ---------------------------------------------------------------- santé de l'API (/api/health)

export type ComponentStatus = "ok" | "inline" | "down";

export interface HealthDeps {
  version: string;
  /** Instant de démarrage du processus (durée de fonctionnement). */
  startedAt: Date;
  /** Ping Redis en ms ; null = Redis non configuré (exécution inline). */
  redis?: () => Promise<number | null>;
  /** File de tâches : statistiques des files BullMQ. */
  queues?: () => Promise<{ name: string; waiting: number; active: number; failed: number; paused: boolean }[]>;
  /** Délai par composant (3 s par défaut). */
  timeoutMs?: number;
}

export interface HealthReport {
  ok: boolean;
  status: "ok" | "down";
  version: string;
  uptimeSeconds: number;
  checkedAt: string;
  checks: { database: ComponentStatus; redis: ComponentStatus; queue: ComponentStatus };
  latencyMs: { database: number | null; redis: number | null };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("délai dépassé")), ms); })]).finally(() => clearTimeout(timer));
}

/**
 * Santé publique de l'API : base, Redis, file de tâches, version, durée de fonctionnement. Aucun message
 * d'erreur ni adresse (rien qui révèle l'infrastructure) ; `ok` faux si un composant est en panne.
 */
export async function healthReport(services: Pick<Services, "db" | "now">, deps: HealthDeps): Promise<HealthReport> {
  const timeoutMs = deps.timeoutMs ?? 3_000;
  const now = services.now();
  let database: ComponentStatus = "down";
  let dbMs: number | null = null;
  try {
    dbMs = await withTimeout(services.db.ping(), timeoutMs);
    database = "ok";
  } catch {
    database = "down";
  }
  let redis: ComponentStatus = "inline";
  let redisMs: number | null = null;
  if (deps.redis) {
    try {
      redisMs = await withTimeout(deps.redis(), timeoutMs);
      redis = redisMs === null ? "inline" : "ok";
    } catch {
      redis = "down";
    }
  }
  let queue: ComponentStatus = redis === "ok" ? "ok" : redis;
  if (redis === "ok" && deps.queues) {
    try {
      await withTimeout(deps.queues(), timeoutMs);
    } catch {
      queue = "down";
    }
  }
  const ok = database !== "down" && redis !== "down" && queue !== "down";
  return {
    ok,
    status: ok ? "ok" : "down",
    version: deps.version,
    uptimeSeconds: Math.max(0, Math.round((now.getTime() - deps.startedAt.getTime()) / 1000)),
    checkedAt: now.toISOString(),
    checks: { database, redis, queue },
    latencyMs: { database: dbMs, redis: redisMs },
  };
}
