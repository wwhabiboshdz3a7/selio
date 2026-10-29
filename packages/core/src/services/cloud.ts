import { createHash } from "node:crypto";
import {
  CLOUD_ACTION_KINDS, CLOUD_ACTION_LEVEL_BY_KIND, CLOUD_ACTIVE_HOURS_DEFAULT, CLOUD_CIRCUIT_BREAKER_MINUTES, CLOUD_CONSENT_TEXT, CLOUD_CONSENT_VERSION, CLOUD_JITTER_MAX_MINUTES, CLOUD_JOB_MAX_AGE_HOURS,
  CLOUD_MAX_LOGIN_WINDOWS_PER_ORG,
  CLOUD_JOURNAL_RETENTION_DAYS, CLOUD_LOCK_STALE_MINUTES, CLOUD_LOGIN_TTL_MINUTES, CLOUD_MAX_ACCOUNTS_PER_ORG_DEFAULT, CLOUD_MAX_ACTIONS_PER_HOUR, CLOUD_MAX_BROWSERS_DEFAULT,
  CLOUD_MIN_MINUTES_BETWEEN_ACTIONS, CLOUD_ACTION_KIND_LABELS, CLOUD_ACTION_LEVEL_LABELS, CLOUD_ACTION_STATUS_LABELS, CLOUD_PAUSE_REASON_LABELS, CLOUD_RUN_CODES, CLOUD_RUN_CODE_LABELS,
  PLAN_LABELS, cloudAcceptConsentInput, cloudEnableAccountInput, cloudJournalQuery, cloudResumeInput, cloudUpdateSettingsInput, filterVintedStorageState, isPlan, isStorageStateEmpty,
  isVintedPauseReason, normalizeVintedHost, quotasForPlan,
  type CloudAccount, type CloudAction, type CloudActionDetail, type CloudActionKind, type CloudActionLevel, type CloudAvailability, type CloudConsent, type CloudConsentView,
  type CloudLoginTicket, type CloudRunCode, type CloudSkipReason, type CloudStorageState, type Job, type Page, type PlanQuotas, type Schedule,
} from "@selio/contracts";
import { hashSecret, newSecret, repos, type Tx } from "@selio/db";
import { PERSONAL_ACCOUNT_SKIP, isAutomatable, isWithinSchedule, renderTemplate, toCsv } from "@selio/domain";
import { alertEmail } from "@selio/email";
import { AppError, requireAction, sendEmail, webLink, withOrg, type OrgContext, type Services, type ServicesConfig } from "../context";

/**
 * Selio Cloud : automatisation quand l'ordinateur du client est éteint.
 *
 * Règles tenues ici (prompt §2, étude juridique) :
 * - aucun mot de passe Vinted : le client se connecte lui-même dans la fenêtre du Cloud ; seule la
 *   session des domaines vinted.* est gardée, chiffrée (SecretBox, données associées = id du compte),
 *   effacée à l'arrêt, sur demande, à la déconnexion du compte Vinted ou quand Vinted la refuse ;
 * - aucun contournement : au premier CAPTCHA, avertissement, blocage ou « trop de requêtes », le
 *   compte passe en pause avec la raison, le client est prévenu, rien n'est retenté tout seul ;
 * - rythme humain : une action par compte et par passage, plafonds horaire et journalier, délai
 *   minimal plus un aléa, heures actives ; le navigateur n'est ouvert que pour agir (exécuteur) ;
 * - adresse IP partagée : actions légères seulement tant que CLOUD_HEAVY_ACTIONS est faux ; après un
 *   « trop de requêtes » ou un blocage, coupe-circuit de toute la machine (CLOUD_CIRCUIT_BREAKER_MINUTES) ;
 * - accord obligatoire (version et empreinte du texte courant) avant toute action ;
 * - arrêt global, accord, offre, plafond de comptes et coupe-circuit relus SOUS VERROU juste avant
 *   chaque action (un arrêt d'urgence pendant un passage arrête les comptes suivants) ;
 * - horloge relue à chaque compte et à la fin de chaque action (délai humain, heures actives) ;
 * - session réécrite seulement si c'est encore celle du début de l'action (jamais recréée après un
 *   arrêt ou une suppression, jamais une session neuve écrasée).
 * Le journal (`cloud_actions`) et l'audit ne portent jamais de secret ni le texte d'un message.
 */

// ---------------------------------------------------------------- exécuteur (interface minimale)

/** Action confiée à l'exécuteur de navigateur. */
export interface CloudExecutorAction {
  /** Identifiant de corrélation (tâche) : jamais un secret. */
  id: string;
  kind: CloudActionKind;
  level: CloudActionLevel;
  /** https://…vinted.*\/inbox/<référence> (réponse, relance). */
  conversationUrl?: string;
  /** Texte à envoyer (réponse, relance). Jamais journalisé par le service. */
  text?: string;
  /** Annonce visée (actions lourdes, derrière CLOUD_HEAVY_ACTIONS). */
  itemUrl?: string;
}

export interface CloudExecutorInput {
  accountId: string;
  /** Session déchiffrée, déjà limitée aux domaines vinted.* ; null pour un compte sans session. */
  session: CloudStorageState | null;
  action: CloudExecutorAction;
}

/**
 * Résultat d'une exécution (forme compatible avec `RunOutcome` de @selio/cloud). La session rendue
 * est refiltrée (vinted.* seulement) puis rechiffrée avant d'être sauvegardée.
 */
export type CloudRunOutcome =
  | { ok: true; session?: unknown; durationMs?: number; detail?: string }
  | {
      ok: false;
      /** captcha, warning, blocked, rate_limited (→ pause), not_logged_in (→ connexion à refaire), selector_missing, timeout, error. */
      code: string;
      message?: string;
      session?: unknown;
      /** « none » : rien n'a été envoyé ; « unknown » : le clic a pu avoir lieu (jamais renvoyé automatiquement). */
      sideEffects?: "none" | "unknown";
      /**
       * `false` : aucun navigateur n'a été lancé (refus avant lancement, aucun créneau libre, Chromium
       * en panne). Rien n'a touché Vinted : l'action ne compte ni dans les plafonds ni dans « cloud.action ».
       * Avec le code `unavailable`, la tâche est remise en file.
       */
      launched?: boolean;
      durationMs?: number;
    };

/** Exécuteur de navigateur : Playwright (paquet @selio/cloud) dans le worker, `FakeCloudExecutor` dans les tests. */
export interface CloudExecutor {
  run(input: CloudExecutorInput): Promise<CloudRunOutcome>;
}

type Responder = CloudRunOutcome | ((input: CloudExecutorInput) => CloudRunOutcome | Promise<CloudRunOutcome>);

/**
 * Exécuteur factice pour les tests : rejoue les résultats mis en file, sinon réussit en rendant la
 * session reçue avec un cookie de passage mis à jour (preuve que la session est rechiffrée).
 */
export class FakeCloudExecutor implements CloudExecutor {
  readonly calls: CloudExecutorInput[] = [];
  private readonly queue: Responder[] = [];

  enqueue(...outcomes: Responder[]): this {
    this.queue.push(...outcomes);
    return this;
  }

  async run(input: CloudExecutorInput): Promise<CloudRunOutcome> {
    this.calls.push(JSON.parse(JSON.stringify(input)) as CloudExecutorInput);
    const next = this.queue.shift();
    if (next) return typeof next === "function" ? next(input) : next;
    const base = input.session ?? { cookies: [], origins: [] };
    const touch = { name: "selio_fake_touch", value: String(this.calls.length), domain: ".vinted.fr", path: "/", expires: -1, httpOnly: false, secure: true, sameSite: "Lax" as const };
    return { ok: true, durationMs: 1200, detail: "fake", session: { cookies: [...base.cookies.filter((c) => c.name !== touch.name), touch], origins: base.origins } };
  }
}

// ---------------------------------------------------------------- réglages

export interface CloudSettings {
  heavyActions: boolean;
  maxAccountsPerOrg: number;
  maxBrowsers: number;
  proOption: boolean;
}

const intOr = (v: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const isTrue = (v: unknown): boolean => v === true || (typeof v === "string" && ["1", "true", "yes", "oui"].includes(v.trim().toLowerCase()));

/** Lit CLOUD_HEAVY_ACTIONS, CLOUD_MAX_ACCOUNTS_PER_ORG, CLOUD_MAX_BROWSERS et CLOUD_PRO_OPTION (API et worker). */
export function cloudConfigFromEnv(env: Record<string, string | undefined> = process.env): ServicesConfig {
  return {
    cloudHeavyActions: isTrue(env.CLOUD_HEAVY_ACTIONS),
    cloudMaxAccountsPerOrg: intOr(env.CLOUD_MAX_ACCOUNTS_PER_ORG, CLOUD_MAX_ACCOUNTS_PER_ORG_DEFAULT, 0, 1000),
    cloudMaxBrowsers: intOr(env.CLOUD_MAX_BROWSERS, CLOUD_MAX_BROWSERS_DEFAULT, 1, 200),
    cloudProOption: isTrue(env.CLOUD_PRO_OPTION),
  };
}

/** Réglages effectifs : tout ce qui ouvre davantage est faux par défaut. */
export function cloudSettings(services: Pick<Services, "config">): CloudSettings {
  const c = services.config ?? {};
  return {
    heavyActions: c.cloudHeavyActions === true,
    maxAccountsPerOrg: intOr(c.cloudMaxAccountsPerOrg, CLOUD_MAX_ACCOUNTS_PER_ORG_DEFAULT, 0, 1000),
    maxBrowsers: intOr(c.cloudMaxBrowsers, CLOUD_MAX_BROWSERS_DEFAULT, 1, 200),
    proOption: c.cloudProOption === true,
  };
}

// ---------------------------------------------------------------- accord

/** Empreinte SHA-256 (hex) du texte d'accord : ce que le client a lu est prouvable. */
export function cloudConsentTextHash(text: string = CLOUD_CONSENT_TEXT): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Un accord ne vaut que pour la version et le texte courants. */
export function isConsentCurrent(consent: Pick<CloudConsent, "version" | "textHash"> | null | undefined): boolean {
  return !!consent && consent.version === CLOUD_CONSENT_VERSION && consent.textHash === cloudConsentTextHash();
}

export async function hasValidConsent(tx: Tx): Promise<boolean> {
  return isConsentCurrent(await repos.cloudConsents.latest(tx));
}

function consentView(accepted: CloudConsent | null): CloudConsentView {
  return { version: CLOUD_CONSENT_VERSION, text: CLOUD_CONSENT_TEXT, accepted, current: isConsentCurrent(accepted) };
}

export async function consent(ctx: OrgContext): Promise<CloudConsentView> {
  requireAction(ctx, "cloud.read");
  return withOrg(ctx, async (tx) => consentView(await repos.cloudConsents.latest(tx)));
}

/** Enregistre l'accord (case cochée) pour la version courante : utilisateur, date, IP, empreinte du texte. */
export async function acceptConsent(ctx: OrgContext, raw: unknown): Promise<CloudConsentView> {
  requireAction(ctx, "cloud.manage");
  const parsed = cloudAcceptConsentInput.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", "Cochez la case pour accepter les conditions du Cloud.", 400, parsed.error.flatten());
  if (parsed.data.version !== CLOUD_CONSENT_VERSION) throw new AppError("conflict", "Le texte de l'accord a changé : relisez-le avant d'accepter.", 409, { version: CLOUD_CONSENT_VERSION });
  return withOrg(ctx, async (tx) => {
    const textHash = cloudConsentTextHash();
    const saved = await repos.cloudConsents.add(tx, { userId: ctx.userId, version: CLOUD_CONSENT_VERSION, textHash, acceptedAt: ctx.services.now().toISOString(), ip: ctx.ip ? ctx.ip.slice(0, 64) : null });
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "cloud.consent.accepted", targetType: "cloud_consent", targetId: saved.id, meta: { version: saved.version, textHash }, ip: ctx.ip });
    return consentView(saved);
  });
}

// ---------------------------------------------------------------- disponibilité selon l'offre

/**
 * Le Cloud selon l'offre (fonction pure) : compris dans Agence (`cloudIncluded`), « en option, prix à
 * décider » pour Pro (activable seulement si CLOUD_PRO_OPTION l'ouvre, rien n'est facturé),
 * indisponible en accès de base et Starter.
 */
export function cloudAvailabilityFor(plan: string, quotas: PlanQuotas, settings: CloudSettings): CloudAvailability {
  const planKey = isPlan(plan) ? plan : "free";
  const included = quotas.cloudIncluded;
  const optional = !included && planKey === "pro";
  const available = included || (optional && settings.proOption);
  const reason = included
    ? planKey === "agence" ? "Selio Cloud est compris dans votre offre Agence." : "Selio Cloud est compris dans votre offre."
    : optional
      ? settings.proOption
        ? "Selio Cloud en option avec l'offre Pro : prix à décider, rien n'est facturé pour l'instant."
        : "Selio Cloud sera proposé en option avec l'offre Pro (prix à décider) : pas encore activable. Il est compris dans l'offre Agence."
      : `Selio Cloud n'est pas disponible avec l'offre ${PLAN_LABELS[planKey]}. Il est compris dans l'offre Agence (option à venir avec Pro, prix à décider).`;
  return {
    plan: planKey,
    included,
    optional,
    available,
    reason,
    actionsPerDay: quotas.automationActionsPerDay,
    maxAccounts: available ? Math.min(settings.maxAccountsPerOrg, quotas.connections) : 0,
    heavyActionsEnabled: settings.heavyActions,
    maxBrowsers: settings.maxBrowsers,
    capacityNote: `Capacité visée : 50 navigateurs ouverts en même temps sur notre machine. C'est une hypothèse à mesurer, aucun chiffre n'est mesuré à ce jour ; limite prudente actuelle : ${settings.maxBrowsers} navigateurs.`,
  };
}

async function availabilityTx(tx: Tx, services: Services): Promise<CloudAvailability> {
  const sub = await repos.subscriptions.get(tx);
  return cloudAvailabilityFor(sub?.plan ?? "free", sub?.quotas ?? quotasForPlan("free"), cloudSettings(services));
}

export async function availability(ctx: OrgContext): Promise<CloudAvailability> {
  requireAction(ctx, "cloud.read");
  return withOrg(ctx, (tx) => availabilityTx(tx, ctx.services));
}

// ---------------------------------------------------------------- comptes Cloud

export interface CloudAccountView extends CloudAccount {
  connectionLabel: string;
  displayHandle: string | null;
  /** Actions du jour (UTC) ayant ouvert le navigateur pour ce compte. */
  actionsToday: number;
}

export interface CloudOverview {
  availability: CloudAvailability;
  consent: CloudConsentView;
  accounts: CloudAccountView[];
  /** Actions Cloud du jour (UTC) pour l'organisation, face au plafond journalier de l'offre. */
  actionsToday: number;
}

/** Début du jour UTC (même remise à zéro que le compteur « cloud.action » de la page d'utilisation). */
export function cloudDayStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

async function accountViews(tx: Tx, now: Date): Promise<CloudAccountView[]> {
  const connections = new Map((await repos.connections.list(tx)).map((c) => [c.id, c]));
  const out: CloudAccountView[] = [];
  for (const a of await repos.cloudAccounts.list(tx)) {
    const c = connections.get(a.connectionId);
    const handle = c && typeof c.config.displayHandle === "string" ? c.config.displayHandle : null;
    out.push({ ...a, connectionLabel: c?.label ?? "Compte supprimé", displayHandle: handle, actionsToday: await repos.cloudActions.countSince(tx, cloudDayStart(now), a.id) });
  }
  return out;
}

/** Vue d'ensemble de l'espace Cloud : offre, accord, comptes et compteur du jour. */
export async function overview(ctx: OrgContext): Promise<CloudOverview> {
  requireAction(ctx, "cloud.read");
  return withOrg(ctx, async (tx) => {
    const now = ctx.services.now();
    return {
      availability: await availabilityTx(tx, ctx.services),
      consent: consentView(await repos.cloudConsents.latest(tx)),
      accounts: await accountViews(tx, now),
      actionsToday: await repos.cloudActions.countSince(tx, cloudDayStart(now)),
    };
  });
}

export async function listAccounts(ctx: OrgContext): Promise<CloudAccountView[]> {
  requireAction(ctx, "cloud.read");
  return withOrg(ctx, (tx) => accountViews(tx, ctx.services.now()));
}

export async function getAccount(ctx: OrgContext, id: string): Promise<CloudAccount> {
  requireAction(ctx, "cloud.read");
  return withOrg(ctx, (tx) => repos.cloudAccounts.byId(tx, id));
}

async function requireConsentTx(tx: Tx): Promise<void> {
  if (!(await hasValidConsent(tx))) throw new AppError("consent_required", "Acceptez d'abord les conditions de Selio Cloud (écran d'accord).", 409, { version: CLOUD_CONSENT_VERSION });
}

async function requireAvailableTx(tx: Tx, services: Services): Promise<CloudAvailability> {
  const av = await availabilityTx(tx, services);
  if (!av.available) throw new AppError("cloud_unavailable", av.reason, 402, { plan: av.plan, optional: av.optional });
  return av;
}

/**
 * Active le Cloud pour un compte Vinted : connexion Vinted existante (ni Perso ni déconnectée),
 * accord valide, offre compatible, moins de 10 comptes Cloud (CLOUD_MAX_ACCOUNTS_PER_ORG). Le compte
 * démarre « connexion à faire » : rien ne s'exécute avant que le client se connecte lui-même.
 */
export async function enableAccount(ctx: OrgContext, input: unknown): Promise<CloudAccount> {
  requireAction(ctx, "cloud.manage");
  const parsed = cloudEnableAccountInput.safeParse(typeof input === "string" ? { connectionId: input } : input);
  if (!parsed.success) throw new AppError("validation", "Compte à activer invalide", 400, parsed.error.flatten());
  return withOrg(ctx, async (tx) => {
    const connection = await repos.connections.byId(tx, parsed.data.connectionId);
    if (connection.provider !== "vinted") throw new AppError("validation", "Seul un compte Vinted peut être activé dans le Cloud.", 400);
    if (connection.status === "disconnected") throw new AppError("conflict", "Ce compte Vinted est déconnecté : reconnectez-le avant d'activer le Cloud.", 409);
    if (!isAutomatable(connection)) throw new AppError("validation", "Un compte Perso n'est jamais utilisé par les automatisations : changez sa catégorie pour l'activer dans le Cloud.", 400);
    await requireConsentTx(tx);
    const av = await requireAvailableTx(tx, ctx.services);
    const existing = await repos.cloudAccounts.byConnection(tx, connection.id);
    if (existing && existing.status !== "stopped") return existing;
    if ((await repos.cloudAccounts.countActive(tx)) >= av.maxAccounts) {
      throw new AppError("quota_exceeded", `Limite de ${av.maxAccounts} comptes Cloud atteinte pour votre organisation : arrêtez un compte avant d'en activer un autre.`, 402, { maxAccounts: av.maxAccounts });
    }
    const account = existing
      ? await repos.cloudAccounts.update(tx, existing.id, { status: "needs_login", pausedReason: null, pausedAt: null })
      : await repos.cloudAccounts.create(tx, { connectionId: connection.id });
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "cloud.account.enabled", targetType: "cloud_account", targetId: account.id, meta: { connectionId: connection.id, reactivated: !!existing }, ip: ctx.ip });
    return account;
  });
}

/** Pause en un clic (raison « client »). Une pause venue de Vinted garde sa raison. */
export async function pause(ctx: OrgContext, id: string, reason: "client" = "client"): Promise<CloudAccount> {
  requireAction(ctx, "cloud.manage");
  return withOrg(ctx, async (tx) => {
    const account = await repos.cloudAccounts.byId(tx, id);
    if (account.status === "stopped") throw new AppError("conflict", "Ce compte Cloud est arrêté.", 409);
    if (account.status === "paused") return account;
    const saved = await repos.cloudAccounts.update(tx, id, { status: "paused", pausedReason: reason, pausedAt: ctx.services.now().toISOString() });
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "cloud.account.paused", targetType: "cloud_account", targetId: id, meta: { reason }, ip: ctx.ip });
    return saved;
  });
}

/**
 * Reprise. Après un signal de Vinted (CAPTCHA, avertissement, blocage, trop de requêtes), le client
 * doit acquitter explicitement (`{ acknowledge: true }`) : rien ne reprend tout seul.
 */
export async function resume(ctx: OrgContext, id: string, raw: unknown = {}): Promise<CloudAccount> {
  requireAction(ctx, "cloud.manage");
  const parsed = cloudResumeInput.safeParse(raw ?? {});
  if (!parsed.success) throw new AppError("validation", "Reprise invalide", 400, parsed.error.flatten());
  return withOrg(ctx, async (tx) => {
    const account = await repos.cloudAccounts.byId(tx, id);
    if (account.status !== "paused") throw new AppError("conflict", "Ce compte Cloud n'est pas en pause.", 409);
    const fromVinted = isVintedPauseReason(account.pausedReason);
    if (fromVinted && !parsed.data.acknowledge) {
      throw new AppError("acknowledge_required", `${CLOUD_PAUSE_REASON_LABELS[account.pausedReason!]} : vérifiez le compte dans Vinted, puis confirmez en avoir pris connaissance pour reprendre.`, 409, { pausedReason: account.pausedReason });
    }
    await requireConsentTx(tx);
    await requireAvailableTx(tx, ctx.services);
    const saved = await repos.cloudAccounts.update(tx, id, { status: account.hasSession ? "active" : "needs_login", pausedReason: null, pausedAt: null });
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "cloud.account.resumed", targetType: "cloud_account", targetId: id, meta: { previousReason: account.pausedReason, acknowledged: fromVinted }, ip: ctx.ip });
    return saved;
  });
}

/** Arrête le Cloud d'un compte dans une transaction : statut « arrêté », session effacée, tâches et fenêtres annulées. */
async function stopTx(tx: Tx, account: CloudAccount, audit: { actorUserId: string | null; ip: string | null; reason: string }): Promise<CloudAccount> {
  await repos.cloudAccounts.clearSession(tx, account.id);
  const saved = await repos.cloudAccounts.update(tx, account.id, { status: "stopped", pausedReason: null, pausedAt: null });
  const cancelledJobs = await repos.jobs.cancelCloudForAccount(tx, account.id);
  await repos.cloudLoginSessions.closeOpenForAccount(tx, account.id, "cancelled");
  await repos.audit.add(tx, { actorUserId: audit.actorUserId, action: "cloud.account.stopped", targetType: "cloud_account", targetId: account.id, meta: { reason: audit.reason, sessionDeleted: account.hasSession, cancelledJobs }, ip: audit.ip });
  return saved;
}

export async function stop(ctx: OrgContext, id: string): Promise<CloudAccount> {
  requireAction(ctx, "cloud.manage");
  return withOrg(ctx, async (tx) => stopTx(tx, await repos.cloudAccounts.byId(tx, id), { actorUserId: ctx.userId, ip: ctx.ip, reason: "client" }));
}

/**
 * Déconnexion ou suppression d'une connexion Vinted : le compte Cloud rattaché est arrêté et sa
 * session effacée dans la même transaction (la suppression de la connexion supprime ensuite la ligne).
 */
export async function stopForConnectionTx(tx: Tx, connectionId: string, audit: { actorUserId: string | null; ip: string | null; reason: string }): Promise<boolean> {
  const account = await repos.cloudAccounts.byConnection(tx, connectionId);
  if (!account) return false;
  if (account.status === "stopped" && !account.hasSession) return false;
  await stopTx(tx, account, audit);
  return true;
}

/** Supprime la session en un clic : le compte repasse « connexion à faire » (ou reste en pause / arrêté). */
export async function deleteSession(ctx: OrgContext, id: string): Promise<CloudAccount> {
  requireAction(ctx, "cloud.manage");
  return withOrg(ctx, async (tx) => {
    const account = await repos.cloudAccounts.byId(tx, id);
    await repos.cloudAccounts.clearSession(tx, id);
    const saved = account.status === "active" ? await repos.cloudAccounts.update(tx, id, { status: "needs_login" }) : await repos.cloudAccounts.byId(tx, id);
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "cloud.session.deleted", targetType: "cloud_account", targetId: id, meta: { hadSession: account.hasSession }, ip: ctx.ip });
    return saved;
  });
}

/** Niveaux d'action du compte : « lourd » refusé tant que CLOUD_HEAVY_ACTIONS est faux (à décider par Ibrahim). */
export async function updateSettings(ctx: OrgContext, id: string, raw: unknown): Promise<CloudAccount> {
  requireAction(ctx, "cloud.manage");
  const parsed = cloudUpdateSettingsInput.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", "Réglages Cloud invalides", 400, parsed.error.flatten());
  const levels = [...new Set(parsed.data.levels)];
  if (levels.includes("heavy") && !cloudSettings(ctx.services).heavyActions) {
    throw new AppError("heavy_disabled", "Les actions lourdes (republier, modifier en masse) ne sont pas ouvertes sur l'adresse partagée : décision à prendre par Ibrahim.", 403);
  }
  return withOrg(ctx, async (tx) => {
    const account = await repos.cloudAccounts.byId(tx, id);
    if (account.status === "stopped") throw new AppError("conflict", "Ce compte Cloud est arrêté.", 409);
    const saved = await repos.cloudAccounts.update(tx, id, { settings: { levels } });
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "cloud.account.settings_updated", targetType: "cloud_account", targetId: id, meta: { levels }, ip: ctx.ip });
    return saved;
  });
}

// ---------------------------------------------------------------- journal

export async function journal(ctx: OrgContext, raw: unknown = {}): Promise<Page<CloudAction>> {
  requireAction(ctx, "cloud.read");
  const q = cloudJournalQuery.safeParse(raw ?? {});
  if (!q.success) throw new AppError("validation", "Filtres invalides", 400, q.error.flatten());
  return withOrg(ctx, (tx) => repos.cloudActions.list(tx, q.data));
}

/** Export CSV du journal (90 jours au plus) : aucune donnée de session, aucun texte de message. */
export async function exportJournal(ctx: OrgContext, raw: unknown = {}): Promise<string> {
  requireAction(ctx, "cloud.read");
  const q = cloudJournalQuery.safeParse(raw ?? {});
  if (!q.success) throw new AppError("validation", "Filtres invalides", 400, q.error.flatten());
  return withOrg(ctx, async (tx) => {
    const labels = new Map((await accountViews(tx, ctx.services.now())).map((a) => [a.id, a.connectionLabel]));
    const rows = await repos.cloudActions.listAll(tx, { kind: q.data.kind, status: q.data.status, accountId: q.data.accountId });
    const header = ["Date", "Compte", "Action", "Niveau", "Statut", "Résultat", "Durée (s)", "Conversation", "Longueur du message"];
    const body = rows.map((r) => [
      r.createdAt,
      labels.get(r.accountId) ?? r.accountId,
      CLOUD_ACTION_KIND_LABELS[r.kind],
      CLOUD_ACTION_LEVEL_LABELS[r.level],
      CLOUD_ACTION_STATUS_LABELS[r.status],
      r.detail.code ? CLOUD_RUN_CODE_LABELS[r.detail.code] : r.detail.reason ?? "",
      typeof r.detail.durationMs === "number" ? (r.detail.durationMs / 1000).toFixed(1).replace(".", ",") : "",
      r.detail.conversationRef ?? "",
      r.detail.messageLength ?? "",
    ]);
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "cloud.journal.exported", targetType: "cloud_action", meta: { rows: rows.length }, ip: ctx.ip });
    return toCsv([header, ...body]);
  });
}

// ---------------------------------------------------------------- fenêtre de connexion

/**
 * Ouvre une fenêtre de connexion : le ticket (secret aléatoire) n'est renvoyé qu'une fois et seule son
 * empreinte est stockée. Le client tape lui-même ses identifiants dans le navigateur du Cloud.
 *
 * Refusée tant qu'une pause venue de Vinted n'a pas été acquittée (`resume` avec `acknowledge`), et
 * au-delà de CLOUD_MAX_LOGIN_WINDOWS_PER_ORG fenêtres ouvertes pour l'organisation : chaque fenêtre
 * tient un navigateur jusqu'à 5 min, une organisation ne doit pas occuper ceux des autres.
 */
export async function startLogin(ctx: OrgContext, accountId: string): Promise<CloudLoginTicket> {
  requireAction(ctx, "cloud.manage");
  return withOrg(ctx, async (tx) => {
    const account = await repos.cloudAccounts.byId(tx, accountId);
    if (account.status === "stopped") throw new AppError("conflict", "Ce compte Cloud est arrêté : réactivez-le d'abord.", 409);
    if (account.status === "paused" && isVintedPauseReason(account.pausedReason)) {
      throw new AppError("acknowledge_required", `${CLOUD_PAUSE_REASON_LABELS[account.pausedReason!]} : vérifiez le compte dans Vinted, puis reprenez le Cloud en le confirmant avant de vous reconnecter.`, 409, { pausedReason: account.pausedReason });
    }
    await requireConsentTx(tx);
    await requireAvailableTx(tx, ctx.services);
    await repos.cloudLoginSessions.closeOpenForAccount(tx, accountId, "cancelled");
    if ((await repos.cloudLoginSessions.countOpen(tx, ctx.services.now().toISOString())) >= CLOUD_MAX_LOGIN_WINDOWS_PER_ORG) {
      throw new AppError("cloud_busy", `Déjà ${CLOUD_MAX_LOGIN_WINDOWS_PER_ORG} fenêtres de connexion ouvertes pour votre organisation : terminez-en une avant d'en ouvrir une autre.`, 429, { max: CLOUD_MAX_LOGIN_WINDOWS_PER_ORG });
    }
    const ticket = newSecret(32);
    const expiresAt = new Date(ctx.services.now().getTime() + cloudLoginTtlMs(ctx.services)).toISOString();
    const session = await repos.cloudLoginSessions.create(tx, { accountId, ticketHash: hashSecret(ticket), expiresAt });
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "cloud.login.started", targetType: "cloud_account", targetId: accountId, meta: { loginSessionId: session.id, expiresAt }, ip: ctx.ip });
    return { loginSessionId: session.id, ticket, expiresAt };
  });
}

export interface CloudLoginRef {
  loginSessionId: string;
  orgId: string;
  accountId: string;
  expiresAt: string;
}

/** Retrouve une fenêtre ouverte, non expirée et dont le ticket n'a pas encore servi (lecture seule). */
export async function findLoginByTicket(services: Services, ticket: string): Promise<CloudLoginRef | null> {
  if (typeof ticket !== "string" || ticket.length < 20 || ticket.length > 200) return null;
  const found = await services.db.withGlobal((tx) => repos.cloudLoginSessions.byTicketHash(tx, hashSecret(ticket)));
  if (!found || found.status !== "open" || found.attachedAt !== null || new Date(found.expiresAt).getTime() <= services.now().getTime()) return null;
  return { loginSessionId: found.id, orgId: found.orgId, accountId: found.accountId, expiresAt: found.expiresAt };
}

/**
 * Consomme le ticket à l'ouverture de la WebSocket (UPDATE conditionnel) : il ne sert qu'une fois.
 * Une seconde connexion avec le même ticket (copié depuis l'adresse, onglet rouvert…) est refusée,
 * même pendant la validité de la fenêtre. Null si le ticket est inconnu, expiré, fermé ou déjà utilisé.
 */
export async function attachLoginTicket(services: Services, ticket: string): Promise<CloudLoginRef | null> {
  const ref = await findLoginByTicket(services, ticket);
  if (!ref) return null;
  const attached = await services.db.withOrg(ref.orgId, (tx) => repos.cloudLoginSessions.attach(tx, ref.loginSessionId, services.now().toISOString()));
  return attached ? ref : null;
}

/**
 * Fin de connexion (worker) : la session lue dans la fenêtre est refiltrée (vinted.* seulement),
 * chiffrée avec la clé du serveur (données associées = id du compte) et le compte devient actif.
 */
export async function completeLogin(services: Services, loginSessionId: string, storageState: unknown): Promise<CloudAccount> {
  const found = await services.db.withGlobal((tx) => repos.cloudLoginSessions.findGlobal(tx, loginSessionId));
  if (!found) throw new AppError("not_found", "Fenêtre de connexion introuvable.", 404);
  if (found.status !== "open") throw new AppError("conflict", "Cette fenêtre de connexion est déjà fermée.", 409);
  const now = services.now();
  if (new Date(found.expiresAt).getTime() <= now.getTime()) {
    await services.db.withOrg(found.orgId, (tx) => repos.cloudLoginSessions.close(tx, found.id, "expired"));
    throw new AppError("login_expired", "La fenêtre de connexion a expiré : ouvrez-en une nouvelle.", 410);
  }
  const filtered = filterVintedStorageState(storageState);
  if (isStorageStateEmpty(filtered)) throw new AppError("validation", "Aucune session Vinted détectée : connectez-vous dans la fenêtre avant de la fermer.", 400);
  return services.db.withOrg(found.orgId, async (tx) => {
    const account = await repos.cloudAccounts.byId(tx, found.accountId);
    if (account.status === "stopped") {
      await repos.cloudLoginSessions.close(tx, found.id, "cancelled");
      throw new AppError("conflict", "Ce compte Cloud a été arrêté pendant la connexion : session non enregistrée.", 409);
    }
    const closed = await repos.cloudLoginSessions.close(tx, found.id, "done");
    if (!closed) throw new AppError("conflict", "Cette fenêtre de connexion est déjà fermée.", 409);
    await repos.cloudAccounts.setSession(tx, account.id, services.secrets.encrypt(JSON.stringify(filtered), account.id), now.toISOString());
    const saved = account.status === "needs_login" ? await repos.cloudAccounts.update(tx, account.id, { status: "active" }) : await repos.cloudAccounts.byId(tx, account.id);
    await repos.audit.add(tx, { actorUserId: null, action: "cloud.login.completed", targetType: "cloud_account", targetId: account.id, meta: { loginSessionId: found.id, cookies: filtered.cookies.length, origins: filtered.origins.length } });
    return saved;
  });
}

export type CloudLoginSignal = "captcha" | "warning" | "blocked" | "rate_limited";

/**
 * Signal de Vinted pendant la connexion (CAPTCHA, avertissement, blocage, trop de requêtes), côté
 * worker : la fenêtre est fermée SANS enregistrer de session (une vérification passée par le client
 * ne sert jamais de laissez-passer au robot), le compte passe en pause avec la raison, les
 * propriétaires sont prévenus, et un « trop de requêtes » ou un blocage suspend tout le Cloud de la
 * machine (adresse partagée). Rien n'est retenté. Rend vrai si la fenêtre était encore ouverte.
 */
export async function loginBlocked(services: Services, loginSessionId: string, code: CloudLoginSignal): Promise<boolean> {
  const found = await services.db.withGlobal((tx) => repos.cloudLoginSessions.findGlobal(tx, loginSessionId));
  if (!found) return false;
  const now = services.now();
  const result = await services.db.withOrg(found.orgId, async (tx) => {
    const closed = (await repos.cloudLoginSessions.close(tx, found.id, "cancelled")) !== null;
    const account = await repos.cloudAccounts.pauseForSignal(tx, found.accountId, code, now.toISOString());
    const connection = await repos.connections.byId(tx, account.connectionId).catch(() => null);
    await repos.audit.add(tx, { actorUserId: null, action: "cloud.login.blocked", targetType: "cloud_account", targetId: account.id, meta: { loginSessionId: found.id, reason: code, sessionSaved: false } });
    return { closed, label: connection?.label ?? "Compte Vinted" };
  });
  if (code === "rate_limited" || code === "blocked") await tripCircuit(services, code, now);
  await notifyPaused(services, found.orgId, result.label, code);
  return result.closed;
}

/** Fenêtre fermée sans connexion (annulée par le client ou expirée), côté worker. */
export async function abandonLogin(services: Services, loginSessionId: string, status: "cancelled" | "expired"): Promise<boolean> {
  const found = await services.db.withGlobal((tx) => repos.cloudLoginSessions.findGlobal(tx, loginSessionId));
  if (!found || found.status !== "open") return false;
  return services.db.withOrg(found.orgId, async (tx) => (await repos.cloudLoginSessions.close(tx, found.id, status)) !== null);
}

export async function cancelLogin(ctx: OrgContext, loginSessionId: string): Promise<void> {
  requireAction(ctx, "cloud.manage");
  return withOrg(ctx, async (tx) => {
    const session = await repos.cloudLoginSessions.byId(tx, loginSessionId);
    if (!session) throw new AppError("not_found", "Fenêtre de connexion introuvable.", 404);
    if (await repos.cloudLoginSessions.close(tx, loginSessionId, "cancelled")) {
      await repos.audit.add(tx, { actorUserId: ctx.userId, action: "cloud.login.cancelled", targetType: "cloud_account", targetId: session.accountId, meta: { loginSessionId }, ip: ctx.ip });
    }
  });
}

// ---------------------------------------------------------------- planification (fonction pure)

export interface PlanAccountRunInput {
  account: Pick<CloudAccount, "status" | "settings" | "hasSession">;
  /** Niveau de l'action envisagée (léger par défaut). */
  level?: CloudActionLevel;
  consentOk: boolean;
  /** Arrêt global des automatisations (automation_state.globalPaused). */
  globalPaused: boolean;
  /** Coupe-circuit de la machine (après un « trop de requêtes » ou un blocage sur l'adresse partagée). */
  machinePaused?: boolean;
  /** Offre compatible avec le Cloud (`cloudAvailabilityFor().available`). */
  available: boolean;
  /**
   * Compte dans le nombre de comptes Cloud de l'offre (les plus anciens d'abord). Faux après une offre
   * réduite (Agence → Pro) : le compte attend que la maintenance l'arrête, il n'agit plus.
   */
  withinAccountLimit?: boolean;
  heavyActionsEnabled: boolean;
  quotas: Pick<PlanQuotas, "automationActionsPerDay">;
  /** Actions Cloud de l'organisation depuis le début du jour UTC (compteur « cloud.action »). */
  actionsToday: number;
  /** Actions de ce compte dans l'heure écoulée. */
  actionsLastHour: number;
  lastActionAt: Date | string | null;
  now: Date;
  /** Heures actives (fuseau de l'organisation) : jamais la nuit. */
  activeHours: Schedule;
  /** Aléa ajouté au délai minimal entre deux actions (rythme humain), en minutes. */
  jitterMinutes?: number;
}

export type PlanAccountRunResult = { act: true; reason: "ok" } | { act: false; reason: CloudSkipReason };

/** Décide si un compte peut agir maintenant (réutilisable par le worker). L'ordre des refus est stable. */
export function planAccountRun(input: PlanAccountRunInput): PlanAccountRunResult {
  const no = (reason: CloudSkipReason): PlanAccountRunResult => ({ act: false, reason });
  const level = input.level ?? "light";
  if (input.globalPaused) return no("global_pause");
  if (input.machinePaused) return no("machine_paused");
  if (!input.consentOk) return no("no_consent");
  if (!input.available) return no("plan_unavailable");
  if (input.withinAccountLimit === false) return no("over_account_limit");
  if (input.account.status !== "active") return no("account_not_active");
  if (!input.account.hasSession) return no("no_session");
  if (level === "heavy" && !input.heavyActionsEnabled) return no("heavy_disabled");
  if (!input.account.settings.levels.includes(level)) return no("level_not_allowed");
  if (!isWithinSchedule(input.activeHours, input.now)) return no("outside_active_hours");
  if (input.actionsToday >= input.quotas.automationActionsPerDay) return no("daily_limit");
  if (input.actionsLastHour >= CLOUD_MAX_ACTIONS_PER_HOUR) return no("hourly_limit");
  if (input.lastActionAt) {
    const last = typeof input.lastActionAt === "string" ? new Date(input.lastActionAt) : input.lastActionAt;
    const elapsedMin = (input.now.getTime() - last.getTime()) / 60_000;
    if (elapsedMin < CLOUD_MIN_MINUTES_BETWEEN_ACTIONS + Math.max(0, input.jitterMinutes ?? 0)) return no("too_soon");
  }
  return { act: true, reason: "ok" };
}

/**
 * Comptes autorisés à agir selon le nombre de comptes de l'offre : les `maxAccounts` comptes non
 * arrêtés les plus anciens (création, puis identifiant). Les plus récents passent au-delà du plafond.
 */
export function accountsWithinLimit(accounts: Pick<CloudAccount, "id" | "status" | "createdAt">[], maxAccounts: number): Set<string> {
  const live = accounts.filter((a) => a.status !== "stopped").sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return new Set(live.slice(0, Math.max(0, maxAccounts)).map((a) => a.id));
}

/**
 * Heures actives du Cloud dans le fuseau de l'organisation : 8 h – 23 h par défaut (contrats), ou la
 * plage réglée par CLOUD_ACTIVE_HOURS (ignorée si incohérente : début ≥ fin, hors 0–24).
 */
export function cloudActiveHours(timezone: string, hours?: { startHour: number; endHour: number } | null): Schedule {
  const valid = !!hours && Number.isInteger(hours.startHour) && Number.isInteger(hours.endHour) && hours.startHour >= 0 && hours.endHour <= 24 && hours.startHour < hours.endHour;
  return { ...CLOUD_ACTIVE_HOURS_DEFAULT, ...(valid ? { startHour: hours.startHour, endHour: hours.endHour } : {}), timezone };
}

/** Validité d'une fenêtre de connexion : CLOUD_LOGIN_TIMEOUT_MS (1 à 30 min) ou 5 min (contrats). */
export function cloudLoginTtlMs(services: Pick<Services, "config">): number {
  const ms = services.config?.cloudLoginTimeoutMs;
  return typeof ms === "number" && Number.isFinite(ms) ? Math.min(30 * 60_000, Math.max(60_000, Math.round(ms))) : CLOUD_LOGIN_TTL_MINUTES * 60_000;
}

/** URL https d'une conversation Vinted à partir de sa référence (`/inbox/<n>`), ou null. Hôte pris dans la liste fermée. */
export function vintedConversationUrl(ref: string | null | undefined, host?: unknown): string | null {
  if (!ref || !/^\d{1,20}$/.test(ref)) return null;
  const h = normalizeVintedHost(host) ?? "www.vinted.fr";
  return `https://${h}/inbox/${ref}`;
}

const PAUSE_CODES: readonly CloudRunCode[] = ["captcha", "warning", "blocked", "rate_limited"];
/** Signaux qui visent souvent l'adresse et non le compte : coupe-circuit de toute la machine. */
const CIRCUIT_CODES: readonly CloudRunCode[] = ["rate_limited", "blocked"];

function normalizeCode(outcome: CloudRunOutcome): CloudRunCode {
  if (outcome.ok) return "ok";
  return (CLOUD_RUN_CODES as readonly string[]).includes(outcome.code) && outcome.code !== "ok" ? (outcome.code as CloudRunCode) : "error";
}

function cloudKindOf(job: Job): CloudActionKind {
  const k = job.payload.cloudKind;
  return typeof k === "string" && (CLOUD_ACTION_KINDS as readonly string[]).includes(k) ? (k as CloudActionKind) : "reply";
}

// ---------------------------------------------------------------- coupe-circuit de la machine

/** Fin de la suspension du Cloud sur la machine, ou null si le Cloud peut agir. */
export async function machinePausedUntil(services: Services, now: Date = services.now()): Promise<{ until: string; reason: "rate_limited" | "blocked" | null } | null> {
  const r = await services.db.withGlobal((tx) => repos.cloudRuntime.get(tx));
  return r.suspendedUntil && new Date(r.suspendedUntil).getTime() > now.getTime() ? { until: r.suspendedUntil, reason: r.reason } : null;
}

/**
 * Après un « trop de requêtes » ou un blocage sur un compte : plus aucune action Cloud sur la machine
 * pendant CLOUD_CIRCUIT_BREAKER_MINUTES (l'adresse est partagée, les autres comptes ne doivent pas
 * insister). Le worker l'écrit en erreur dans ses journaux (alerte de l'opérateur).
 */
export async function tripCircuit(services: Services, code: "rate_limited" | "blocked", now: Date = services.now()): Promise<string> {
  const until = new Date(now.getTime() + CLOUD_CIRCUIT_BREAKER_MINUTES * 60_000).toISOString();
  await services.db.withGlobal((tx) => repos.cloudRuntime.suspend(tx, until, code));
  return until;
}

/** Levée manuelle du coupe-circuit par l'opérateur (après vérification). */
export async function clearCircuit(services: Services): Promise<void> {
  await services.db.withGlobal((tx) => repos.cloudRuntime.clear(tx));
}

// ---------------------------------------------------------------- exécution des tâches Cloud (worker)

export interface CloudRunOptions {
  /** Horloge figée (tests) ; sinon `services.now()` est relu à chaque compte et à la fin de chaque action. */
  now?: Date;
  /** Source d'aléa (0 ≤ x < 1) pour le délai humain ; injectée par les tests. */
  rng?: () => number;
  /** Arrêt du worker demandé : aucune nouvelle action n'est lancée (celle en cours se termine). */
  shouldStop?: () => boolean;
}

export interface CloudRunSummary {
  /** Exécutions lancées (navigateur ouvert). */
  executed: number;
  done: number;
  failed: number;
  /** Comptes mis en pause par un signal de Vinted pendant ce passage. */
  paused: string[];
  /** Comptes dont la session a été refusée (connexion à refaire). */
  needsLogin: string[];
  /** Tâches remises en file sans navigateur (aucun créneau libre, Chromium indisponible). */
  requeued: number;
  /** Tâches laissées en file ou écartées, par raison. */
  skipped: { reason: string; count: number }[];
  /** Tâches restées « en cours » après un passage interrompu, marquées en échec (compte mis en pause). */
  recovered: number;
  /** Coupe-circuit déclenché pendant ce passage (fin de la suspension), à signaler à l'opérateur. */
  circuitUntil: string | null;
}

interface PreparedRun {
  job: Job;
  account: CloudAccount;
  actionId: string;
  messageId: string | null;
  input: CloudExecutorInput;
  detail: CloudActionDetail;
  connectionLabel: string;
  /** Date d'enregistrement de la session au début de l'action : seule cette session peut être remplacée. */
  sessionSavedAt: string | null;
}

const UNCERTAIN = "Résultat incertain : vérifiez dans Vinted avant de relancer.";

/**
 * Tâches restées « en cours » depuis plus de 15 minutes : passage interrompu (arrêt brutal du worker
 * pendant une action). Jamais relancées automatiquement ; le compte est mis en pause par prudence
 * (raison « interrupted ») : Vinted a pu afficher un signal que personne n'a lu.
 */
async function recoverStaleTx(tx: Tx, now: Date): Promise<number> {
  const before = new Date(now.getTime() - CLOUD_LOCK_STALE_MINUTES * 60_000).toISOString();
  const nowIso = now.toISOString();
  let n = 0;
  for (const job of await repos.jobs.staleCloudRunning(tx, before)) {
    await repos.jobs.update(tx, job.id, { status: "failed", error: `Passage du Cloud interrompu. ${UNCERTAIN}`, finishedAt: nowIso });
    const action = await repos.cloudActions.byJob(tx, job.id);
    if (action?.status === "running") await repos.cloudActions.update(tx, action.id, { status: "failed", finishedAt: nowIso, detail: { ...action.detail, code: "error", sideEffects: "unknown", message: "passage interrompu" } });
    const messageId = typeof job.result?.messageId === "string" ? job.result.messageId : null;
    if (messageId) await repos.messages.update(tx, messageId, { status: "failed", error: UNCERTAIN }).catch(() => null);
    const accountId = action?.accountId ?? (typeof job.payload.cloudAccountId === "string" ? job.payload.cloudAccountId : null);
    if (accountId) {
      const account = await repos.cloudAccounts.byId(tx, accountId).catch(() => null);
      if (account && account.status === "active") {
        await repos.cloudAccounts.update(tx, account.id, { status: "paused", pausedReason: "interrupted", pausedAt: nowIso });
        await repos.audit.add(tx, { actorUserId: null, action: "cloud.account.paused", targetType: "cloud_account", targetId: account.id, meta: { reason: "interrupted", automatic: true, jobId: job.id } });
      }
      if (account) await repos.cloudAccounts.unlock(tx, account.id);
    }
    n++;
  }
  return n;
}

async function skipJobTx(tx: Tx, job: Job, account: CloudAccount | null, reason: CloudSkipReason, nowIso: string): Promise<void> {
  await repos.jobs.update(tx, job.id, { status: "skipped", result: { ...(job.result ?? {}), cloud: true, reason }, finishedAt: nowIso });
  if (account) {
    const kind = cloudKindOf(job);
    await repos.cloudActions.add(tx, { accountId: account.id, kind, level: CLOUD_ACTION_LEVEL_BY_KIND[kind], status: "skipped", jobId: job.id, detail: { reason }, createdAt: nowIso });
  }
}

async function ownerEmails(services: Services, orgId: string): Promise<string[]> {
  const members = await services.db.withGlobal((tx) => repos.memberships.listOrg(tx, orgId));
  const owners = members.filter((m) => m.role === "owner").map((m) => m.user.email);
  return owners.length ? owners : members.slice(0, 1).map((m) => m.user.email);
}

async function notifyPaused(services: Services, orgId: string, label: string, code: CloudRunCode): Promise<void> {
  const what = { captcha: "un CAPTCHA", warning: "un avertissement", blocked: "un blocage", rate_limited: "un message « trop de requêtes »" }[code as "captcha"] ?? "un signal";
  const rendered = alertEmail({
    title: `Selio Cloud : le compte « ${label} » est en pause`,
    body: `Vinted a affiché ${what} sur le compte « ${label} ». Selio Cloud a mis ce compte en pause et n'a rien retenté.\n\nOuvrez Vinted depuis votre navigateur habituel pour vérifier le compte. Quand tout est en ordre, vous pourrez reprendre le Cloud en confirmant avoir pris connaissance de l'avertissement. Vous pouvez aussi l'arrêter et supprimer la session en un clic.`,
    link: webLink(services, "/cloud"),
    linkLabel: "Ouvrir Selio Cloud",
  });
  for (const to of await ownerEmails(services, orgId)) await sendEmail(services, { to, ...rendered });
}

/**
 * Exécute les tâches Cloud échues d'une organisation : au plus une par compte et par passage,
 * après `planAccountRun`. La prise de la tâche (UPDATE conditionnel) et le verrou du compte
 * garantissent qu'une tâche ne s'exécute jamais deux fois ; le navigateur s'exécute hors transaction.
 * Juste avant chaque action, sous verrou : arrêt global, accord, offre, plafond de comptes et
 * coupe-circuit sont relus (un arrêt d'urgence vaut pour les comptes suivants du même passage).
 */
export async function runDueCloudJobs(services: Services, orgId: string, executor: CloudExecutor | undefined = services.cloud, opts: CloudRunOptions = {}): Promise<CloudRunSummary> {
  // Horloge relue à chaque étape : un passage peut durer plusieurs minutes (actions de 90 s au plus).
  const clock = () => opts.now ?? services.now();
  const rng = opts.rng ?? Math.random;
  const settings = cloudSettings(services);
  const summary: CloudRunSummary = { executed: 0, done: 0, failed: 0, paused: [], needsLogin: [], requeued: 0, skipped: [], recovered: 0, circuitUntil: null };
  const skipped = new Map<string, number>();
  const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
  const finish = () => ({ ...summary, skipped: [...skipped.entries()].map(([reason, count]) => ({ reason, count })) });

  summary.recovered = await services.db.withOrg(orgId, (tx) => recoverStaleTx(tx, clock()));
  const startedAt = clock();
  const ctxData = await services.db.withOrg(orgId, async (tx) => {
    const org = await repos.orgs.byId(tx, orgId);
    const accounts = await repos.cloudAccounts.list(tx);
    const availability = await availabilityTx(tx, services);
    return {
      timezone: org.settings.timezone,
      availability,
      consentOk: await hasValidConsent(tx),
      globalPaused: (await repos.automationState.get(tx)).globalPaused,
      accounts: new Map(accounts.map((a) => [a.id, a])),
      withinLimit: accountsWithinLimit(accounts, availability.maxAccounts),
      jobs: await repos.jobs.dueCloud(tx, startedAt.toISOString()),
    };
  });
  if (ctxData.jobs.length === 0) return finish();

  // Regroupement par compte, dans l'ordre d'échéance.
  const byAccount = new Map<string, Job[]>();
  for (const job of ctxData.jobs) {
    const accountId = typeof job.payload.cloudAccountId === "string" ? job.payload.cloudAccountId : null;
    const account = accountId ? ctxData.accounts.get(accountId) : undefined;
    if (!account || account.status === "stopped") {
      await services.db.withOrg(orgId, (tx) => skipJobTx(tx, job, null, "no_cloud_account", clock().toISOString()));
      skip("no_cloud_account");
      continue;
    }
    byAccount.set(account.id, [...(byAccount.get(account.id) ?? []), job]);
  }

  for (const [accountId, jobs] of byAccount) {
    if (opts.shouldStop?.()) {
      skip("worker_stopping");
      continue;
    }
    const now = clock();
    const nowIso = now.toISOString();
    const account = ctxData.accounts.get(accountId)!;
    // Tâches trop anciennes : écartées (on ne répond pas avec des jours de retard), sans ouvrir le navigateur.
    let live: Job | undefined;
    for (const candidate of jobs) {
      if (now.getTime() - new Date(candidate.createdAt).getTime() > CLOUD_JOB_MAX_AGE_HOURS * 3_600_000) {
        await services.db.withOrg(orgId, (tx) => skipJobTx(tx, candidate, account, "expired", nowIso));
        skip("expired");
        continue;
      }
      live = candidate;
      break;
    }
    if (!live) continue;
    const job: Job = live;
    const kind = cloudKindOf(job);
    const level = CLOUD_ACTION_LEVEL_BY_KIND[kind];

    const counts = await services.db.withOrg(orgId, async (tx) => ({
      actionsToday: await repos.cloudActions.countSince(tx, cloudDayStart(now)),
      actionsLastHour: await repos.cloudActions.countSince(tx, new Date(now.getTime() - 3_600_000).toISOString(), accountId),
    }));
    const decision = planAccountRun({
      account, level, consentOk: ctxData.consentOk, globalPaused: ctxData.globalPaused, machinePaused: (await machinePausedUntil(services, now)) !== null,
      available: ctxData.availability.available, withinAccountLimit: ctxData.withinLimit.has(accountId), heavyActionsEnabled: settings.heavyActions,
      quotas: { automationActionsPerDay: ctxData.availability.actionsPerDay }, actionsToday: counts.actionsToday, actionsLastHour: counts.actionsLastHour,
      lastActionAt: account.lastActionAt, now, activeHours: cloudActiveHours(ctxData.timezone, services.config?.cloudActiveHours), jitterMinutes: rng() * CLOUD_JITTER_MAX_MINUTES,
    });
    if (!decision.act) {
      skip(decision.reason);
      // Niveau refusé : la tâche ne pourra pas s'exécuter, elle est écartée et journalisée.
      if (decision.reason === "heavy_disabled" || decision.reason === "level_not_allowed") await services.db.withOrg(orgId, (tx) => skipJobTx(tx, job, account, decision.reason, nowIso));
      // Compte « actif » sans session : incohérence, la connexion est à refaire.
      if (decision.reason === "no_session" && account.status === "active") await services.db.withOrg(orgId, (tx) => repos.cloudAccounts.update(tx, accountId, { status: "needs_login" }));
      continue;
    }
    if (!executor) { skip("no_executor"); continue; }

    const prepared = await services.db.withOrg(orgId, (tx) => prepareRunTx(services, tx, job, account, kind, level, clock()));
    if (!prepared.ok) { skip(prepared.reason); continue; }
    const run = prepared.run;

    const started = Date.now();
    let outcome: CloudRunOutcome;
    try {
      outcome = await executor.run(run.input);
    } catch (err) {
      // Le message d'une exception peut contenir n'importe quoi : seul son type est gardé.
      outcome = { ok: false, code: "error", message: err instanceof Error ? err.name : "Error", sideEffects: "unknown" };
    }
    const code = normalizeCode(outcome);
    const launched = outcome.ok || outcome.launched !== false;
    if (launched) summary.executed++;
    const elapsed = typeof outcome.durationMs === "number" && Number.isFinite(outcome.durationMs) ? Math.max(0, Math.round(outcome.durationMs)) : Date.now() - started;
    const endedAt = clock();
    let pauseWritten = false;
    if (PAUSE_CODES.includes(code)) {
      // Le signal de Vinted est écrit SEUL et D'ABORD (transaction courte) : il survit à un échec de
      // l'enregistrement du reste, et le compte ne peut plus être verrouillé pour agir.
      await services.db.withOrg(orgId, async (tx) => {
        await repos.cloudAccounts.pauseForSignal(tx, accountId, code as NonNullable<CloudAccount["pausedReason"]>, endedAt.toISOString());
        await repos.audit.add(tx, { actorUserId: null, action: "cloud.account.paused", targetType: "cloud_account", targetId: accountId, meta: { reason: code, automatic: true, jobId: job.id } });
      });
      pauseWritten = true;
      if (CIRCUIT_CODES.includes(code)) summary.circuitUntil = await tripCircuit(services, code as "rate_limited" | "blocked", endedAt);
      summary.paused.push(accountId);
      await notifyPaused(services, orgId, run.connectionLabel, code);
    }
    await services.db.withOrg(orgId, (tx) => recordOutcomeTx(services, tx, run, outcome, code, elapsed, endedAt, pauseWritten));
    if (code === "ok") summary.done++;
    else if (pauseWritten) {
      // déjà compté et notifié
    } else if (code === "not_logged_in") summary.needsLogin.push(accountId);
    else if (!launched && code === "unavailable") summary.requeued++;
    else summary.failed++;
  }
  return finish();
}

type PrepareResult = { ok: true; run: PreparedRun } | { ok: false; reason: string };

/**
 * Verrou du compte, relecture des conditions qui ont pu changer pendant le passage (arrêt global,
 * accord, offre, plafond de comptes, coupe-circuit), prise de la tâche, message « en cours », ligne de
 * journal, session déchiffrée.
 */
async function prepareRunTx(services: Services, tx: Tx, job: Job, account: CloudAccount, kind: CloudActionKind, level: CloudActionLevel, now: Date): Promise<PrepareResult> {
  const nowIso = now.toISOString();
  const locked = await repos.cloudAccounts.lock(tx, account.id, nowIso, new Date(now.getTime() - CLOUD_LOCK_STALE_MINUTES * 60_000).toISOString());
  if (!locked) return { ok: false, reason: "account_busy" };
  const refuse = async (reason: string): Promise<PrepareResult> => {
    await repos.cloudAccounts.unlock(tx, account.id);
    return { ok: false, reason };
  };
  // Relu sous verrou, dans la transaction qui prend la tâche : un arrêt d'urgence déclenché pendant
  // le passage arrête aussi les comptes suivants.
  if ((await repos.automationState.get(tx)).globalPaused) return refuse("global_pause");
  const circuit = await repos.cloudRuntime.get(tx);
  if (circuit.suspendedUntil && new Date(circuit.suspendedUntil).getTime() > now.getTime()) return refuse("machine_paused");
  if (!(await hasValidConsent(tx))) return refuse("no_consent");
  const av = await availabilityTx(tx, services);
  if (!av.available) return refuse("plan_unavailable");
  if (!accountsWithinLimit(await repos.cloudAccounts.list(tx), av.maxAccounts).has(account.id)) return refuse("over_account_limit");
  // Un passage concurrent a pu agir entre-temps (délai humain à respecter).
  if (locked.lastActionAt && now.getTime() - new Date(locked.lastActionAt).getTime() < CLOUD_MIN_MINUTES_BETWEEN_ACTIONS * 60_000) return refuse("too_soon");
  const blob = await repos.cloudAccounts.session(tx, account.id);
  let session: CloudStorageState | null = null;
  try {
    session = blob ? filterVintedStorageState(JSON.parse(services.secrets.decrypt(blob, account.id))) : null;
  } catch {
    session = null;
  }
  if (isStorageStateEmpty(session)) {
    // Session absente ou illisible (clé changée, bloc altéré) : effacée, connexion à refaire.
    await repos.cloudAccounts.clearSession(tx, account.id);
    await repos.cloudAccounts.update(tx, account.id, { status: "needs_login" });
    await repos.audit.add(tx, { actorUserId: null, action: "cloud.account.needs_login", targetType: "cloud_account", targetId: account.id, meta: { reason: "session_unreadable" } });
    return refuse("no_session");
  }
  const claimed = await repos.jobs.claimCloud(tx, job.id, nowIso);
  if (!claimed) return refuse("already_claimed");
  const connection = await repos.connections.byId(tx, account.connectionId).catch(() => null);
  const conversationId = typeof job.payload.conversationId === "string" ? job.payload.conversationId : null;
  const conv = conversationId ? await repos.conversations.byId(tx, conversationId).catch(() => null) : null;
  const fail = async (reason: CloudSkipReason, error: string): Promise<PrepareResult> => {
    await repos.jobs.update(tx, job.id, { status: reason === "personal_account" ? "skipped" : "failed", error, result: { cloud: true, reason }, finishedAt: nowIso });
    await repos.cloudActions.add(tx, { accountId: account.id, kind, level, status: reason === "personal_account" ? "skipped" : "failed", jobId: job.id, detail: { reason }, createdAt: nowIso });
    return refuse(reason);
  };
  if (!connection || !isAutomatable(connection)) return fail("personal_account", PERSONAL_ACCOUNT_SKIP);
  // Isolation : jamais une conversation d'un autre compte Vinted avec la session de celui-ci.
  if (conv && conv.connectionId !== account.connectionId) return fail("account_mismatch", "La conversation n'appartient pas à ce compte Cloud : action refusée.");
  const conversationUrl = vintedConversationUrl(conv?.externalRef, connection.config.vintedHost);
  if (!conv || !conversationUrl) return fail("conversation_unknown", "Conversation Vinted inconnue (référence manquante) : action impossible dans le Cloud.");
  const rule = job.ruleId ? await repos.rules.byId(tx, job.ruleId).catch(() => null) : null;
  const customer = await repos.customers.byId(tx, conv.customerId).catch(() => null);
  const item = conv.itemId ? await repos.items.byId(tx, conv.itemId).catch(() => null) : null;
  const text = (typeof job.payload.body === "string" && job.payload.body.trim() ? job.payload.body : renderTemplate(rule?.config.template ?? "Bonjour {{prenom}}, merci pour votre message.", { prenom: customer?.displayName.split(" ")[0] ?? "", article: item?.title ?? "l'article" })).slice(0, 2000);
  if (!text.trim()) return fail("empty_message", "Message vide : rien à envoyer.");
  const message = await repos.messages.create(tx, { conversationId: conv.id, direction: "outbound", source: "automation", status: "pending", body: text, offerCents: typeof job.payload.offerCents === "number" ? job.payload.offerCents : null, ruleId: rule?.id ?? null });
  const detail: CloudActionDetail = { conversationRef: conv.externalRef, conversationId: conv.id, messageLength: text.length, ...(typeof job.payload.ruleName === "string" ? { ruleName: job.payload.ruleName.slice(0, 120) } : {}) };
  const action = await repos.cloudActions.add(tx, { accountId: account.id, kind, level, status: "running", jobId: job.id, detail, startedAt: nowIso, createdAt: nowIso });
  await repos.jobs.update(tx, job.id, { result: { cloud: true, cloudActionId: action.id, messageId: message.id } });
  return {
    ok: true,
    run: {
      job: claimed, account, actionId: action.id, messageId: message.id, detail, connectionLabel: connection.label, sessionSavedAt: locked.sessionSavedAt,
      input: { accountId: account.id, session, action: { id: job.id, kind, level, conversationUrl, text } },
    },
  };
}

/**
 * Enregistre le résultat : journal, compteur « cloud.action », tâche, message, session rechiffrée.
 * `now` est l'instant réel de FIN de l'action (lastActionAt, finishedAt). Le compte est relu sous
 * verrou de ligne : un arrêt ou une suppression de session en cours est attendu puis respecté.
 * `pauseWritten` : la pause d'un signal de Vinted a déjà été écrite (transaction à part).
 */
async function recordOutcomeTx(services: Services, tx: Tx, run: PreparedRun, outcome: CloudRunOutcome, code: CloudRunCode, durationMs: number, now: Date, pauseWritten: boolean): Promise<void> {
  const nowIso = now.toISOString();
  const { job } = run;
  const account = await repos.cloudAccounts.lockedById(tx, run.account.id);
  const stopped = account.status === "stopped";
  const launched = outcome.ok || outcome.launched !== false;
  const sideEffects = outcome.ok ? undefined : outcome.sideEffects === "none" ? "none" : "unknown";
  const nothingSent = sideEffects === "none";
  const detail: CloudActionDetail = { ...run.detail, code, durationMs, ...(sideEffects ? { sideEffects } : {}) };

  // Session rendue par l'exécuteur : refiltrée puis rechiffrée, seulement si c'est encore la session du
  // début de l'action (jamais recréée après un arrêt ou une suppression, jamais une session neuve écrasée).
  if (code !== "not_logged_in" && outcome.session !== undefined && !stopped && account.hasSession) {
    const next = filterVintedStorageState(outcome.session);
    if (!isStorageStateEmpty(next)) await repos.cloudAccounts.replaceSessionIf(tx, account.id, services.secrets.encrypt(JSON.stringify(next), account.id), nowIso, run.sessionSavedAt);
  }
  // Seul un passage qui a lancé le navigateur compte (plafonds et compteur d'usage).
  if (launched) await repos.usage.record(tx, "cloud.action", { accountId: account.id, jobId: job.id, kind: run.input.action.kind, code });

  // Message : envoyé, retiré (rien n'est parti) ou en échec (résultat incertain).
  const settleMessage = async (error: string) => {
    if (!run.messageId) return;
    if (nothingSent) await repos.messages.delete(tx, run.messageId);
    else await repos.messages.update(tx, run.messageId, { status: "failed", error: `${error} ${UNCERTAIN}`.slice(0, 500) });
  };

  if (!launched && code === "unavailable") {
    // Aucun navigateur libre (ou Chromium indisponible) : rien n'a touché Vinted. La tâche retourne en
    // file, sans ligne de journal comptée ni délai humain consommé.
    await settleMessage(CLOUD_RUN_CODE_LABELS[code] + ".");
    await repos.jobs.update(tx, job.id, { status: "queued", error: CLOUD_RUN_CODE_LABELS[code], result: { cloud: "requeued", code }, startedAt: null });
    await repos.cloudActions.remove(tx, run.actionId);
  } else if (code === "ok") {
    if (run.messageId) {
      const sent = await repos.messages.update(tx, run.messageId, { status: "sent", sentAt: nowIso, error: null });
      const conv = await repos.conversations.byId(tx, sent.conversationId);
      await repos.conversations.update(tx, conv.id, { lastMessageAt: nowIso, lastMessagePreview: sent.body.slice(0, 120), negotiationRounds: sent.offerCents !== null ? conv.negotiationRounds + 1 : conv.negotiationRounds });
      await repos.customers.update(tx, conv.customerId, { lastContactAt: nowIso }).catch(() => null);
    }
    await repos.usage.record(tx, "automation.action", { jobId: job.id, cloud: true });
    await repos.jobs.update(tx, job.id, { status: "succeeded", error: null, result: { cloud: true, code, cloudActionId: run.actionId, messageId: run.messageId }, finishedAt: nowIso });
    await repos.cloudActions.update(tx, run.actionId, { status: "done", finishedAt: nowIso, detail });
    if (!stopped) await repos.cloudAccounts.update(tx, account.id, { lastActionAt: nowIso });
  } else if (PAUSE_CODES.includes(code)) {
    // Signal de Vinted : pause immédiate avec la raison, aucune nouvelle tentative automatique.
    await settleMessage(CLOUD_RUN_CODE_LABELS[code] + ".");
    await repos.jobs.update(tx, job.id, nothingSent
      ? { status: "queued", error: CLOUD_RUN_CODE_LABELS[code], result: { cloud: "paused", code, cloudActionId: run.actionId }, startedAt: null }
      : { status: "failed", error: `${CLOUD_RUN_CODE_LABELS[code]}. ${UNCERTAIN}`, result: { cloud: "paused", code, cloudActionId: run.actionId }, finishedAt: nowIso });
    await repos.cloudActions.update(tx, run.actionId, { status: "paused", finishedAt: nowIso, detail });
    if (!pauseWritten) {
      await repos.cloudAccounts.pauseForSignal(tx, account.id, code as NonNullable<CloudAccount["pausedReason"]>, nowIso);
      await repos.audit.add(tx, { actorUserId: null, action: "cloud.account.paused", targetType: "cloud_account", targetId: account.id, meta: { reason: code, automatic: true, jobId: job.id, sideEffects } });
    }
  } else if (code === "not_logged_in") {
    // Vinted ne reconnaît plus la session : elle est effacée (si c'est encore celle de l'action), le
    // client se reconnectera lui-même.
    await settleMessage(CLOUD_RUN_CODE_LABELS[code] + ".");
    await repos.jobs.update(tx, job.id, nothingSent
      ? { status: "queued", error: CLOUD_RUN_CODE_LABELS[code], result: { cloud: "needs_login", code, cloudActionId: run.actionId }, startedAt: null }
      : { status: "failed", error: `${CLOUD_RUN_CODE_LABELS[code]}. ${UNCERTAIN}`, result: { cloud: "needs_login", code, cloudActionId: run.actionId }, finishedAt: nowIso });
    await repos.cloudActions.update(tx, run.actionId, { status: "failed", finishedAt: nowIso, detail, ...(launched ? {} : { startedAt: null }) });
    const cleared = await repos.cloudAccounts.clearSessionIf(tx, account.id, run.sessionSavedAt);
    if (cleared && !stopped) await repos.cloudAccounts.update(tx, account.id, { status: account.status === "active" ? "needs_login" : account.status, ...(launched ? { lastActionAt: nowIso } : {}) });
    await repos.audit.add(tx, { actorUserId: null, action: "cloud.account.needs_login", targetType: "cloud_account", targetId: account.id, meta: { reason: "not_logged_in", jobId: job.id, sessionCleared: cleared } });
  } else {
    // Erreur technique : la tâche échoue, le client peut la relancer depuis le journal des tâches. Une
    // action refusée avant tout lancement (navigateur jamais ouvert) ne compte pas dans les plafonds.
    await settleMessage(CLOUD_RUN_CODE_LABELS[code] + ".");
    await repos.jobs.update(tx, job.id, { status: "failed", error: nothingSent ? CLOUD_RUN_CODE_LABELS[code] : `${CLOUD_RUN_CODE_LABELS[code]}. ${UNCERTAIN}`, result: { cloud: true, code, cloudActionId: run.actionId }, finishedAt: nowIso });
    await repos.cloudActions.update(tx, run.actionId, { status: "failed", finishedAt: nowIso, detail, ...(launched ? {} : { startedAt: null }) });
    if (!stopped && launched) await repos.cloudAccounts.update(tx, account.id, { lastActionAt: nowIso });
  }
  await repos.cloudAccounts.unlock(tx, account.id);
}

/**
 * Passage du planificateur sur toutes les organisations ayant des comptes Cloud, avec au plus
 * `maxBrowsers` organisations traitées en parallèle (un navigateur à la fois par organisation).
 * Coupe-circuit actif : aucune organisation n'est traitée.
 */
export async function runCloudTick(
  services: Services,
  executor: CloudExecutor | undefined = services.cloud,
  opts: CloudRunOptions & { concurrency?: number } = {},
): Promise<{ orgs: number; summaries: (CloudRunSummary & { orgId: string })[]; errors: { orgId: string; error: string }[]; machinePausedUntil: string | null }> {
  const paused = await machinePausedUntil(services, opts.now ?? services.now());
  if (paused) return { orgs: 0, summaries: [], errors: [], machinePausedUntil: paused.until };
  const orgIds = await services.db.withGlobal((tx) => repos.cloudOrgs.ids(tx));
  const limit = Math.max(1, Math.min(opts.concurrency ?? cloudSettings(services).maxBrowsers, orgIds.length || 1));
  const summaries: (CloudRunSummary & { orgId: string })[] = [];
  const errors: { orgId: string; error: string }[] = [];
  let next = 0;
  const worker = async () => {
    while (next < orgIds.length && !opts.shouldStop?.()) {
      const orgId = orgIds[next++]!;
      try {
        summaries.push({ orgId, ...(await runDueCloudJobs(services, orgId, executor, opts)) });
      } catch (err) {
        errors.push({ orgId, error: err instanceof Error ? err.message.slice(0, 200) : "erreur" });
      }
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
  return { orgs: orgIds.length, summaries, errors, machinePausedUntil: null };
}

// ---------------------------------------------------------------- rétention et entretien (worker)

/** Journal Cloud conservé 90 jours : purge de toutes les organisations concernées. */
export async function purgeCloudJournal(services: Services, now: Date = services.now()): Promise<number> {
  let purged = 0;
  for (const orgId of await services.db.withGlobal((tx) => repos.cloudOrgs.ids(tx))) {
    purged += await services.db.withOrg(orgId, (tx) => repos.cloudActions.purgeOlderThan(tx, CLOUD_JOURNAL_RETENTION_DAYS, now));
  }
  return purged;
}

/**
 * Entretien quotidien : purge du journal (90 jours), fenêtres de connexion expirées, et offre :
 * - Cloud plus disponible avec l'offre, QUELLE QU'EN SOIT LA RAISON (accès de base, Starter, Pro sans
 *   l'option ouverte) : comptes arrêtés et sessions effacées (rien ne peut plus tourner, rien n'est gardé) ;
 * - Cloud disponible mais moins de comptes permis (Agence → Pro avec option) : les comptes au-delà du
 *   plafond sont arrêtés, les plus récents d'abord (le client réactive ceux qu'il préfère).
 */
export async function cloudMaintenance(services: Services, now: Date = services.now()): Promise<{ orgs: number; purged: number; expiredLogins: number; stoppedForPlan: number; stoppedOverLimit: number }> {
  const orgIds = await services.db.withGlobal((tx) => repos.cloudOrgs.ids(tx));
  let purged = 0, expiredLogins = 0, stoppedForPlan = 0, stoppedOverLimit = 0;
  for (const orgId of orgIds) {
    await services.db.withOrg(orgId, async (tx) => {
      purged += await repos.cloudActions.purgeOlderThan(tx, CLOUD_JOURNAL_RETENTION_DAYS, now);
      expiredLogins += await repos.cloudLoginSessions.expireStale(tx, now.toISOString());
      const av = await availabilityTx(tx, services);
      const accounts = await repos.cloudAccounts.list(tx);
      if (!av.available) {
        for (const account of accounts) {
          if (account.status === "stopped" && !account.hasSession) continue;
          await stopTx(tx, account, { actorUserId: null, ip: null, reason: "plan" });
          stoppedForPlan++;
        }
        return;
      }
      const keep = accountsWithinLimit(accounts, av.maxAccounts);
      for (const account of accounts) {
        if (account.status === "stopped" || keep.has(account.id)) continue;
        await stopTx(tx, account, { actorUserId: null, ip: null, reason: "plan_limit" });
        stoppedOverLimit++;
      }
    });
  }
  return { orgs: orgIds.length, purged, expiredLogins, stoppedForPlan, stoppedOverLimit };
}
