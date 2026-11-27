import {
  CLOUD_CONSENT_VERSION, CLOUD_JITTER_MAX_MINUTES, CLOUD_JOB_MAX_AGE_HOURS, CLOUD_LOCK_STALE_MINUTES, CLOUD_MAX_ACTIONS_PER_HOUR, CLOUD_MIN_MINUTES_BETWEEN_ACTIONS,
  CLOUD_PAUSE_REASON_LABELS, CLOUD_RUN_CODE_LABELS, EXTENSION_AUTO_HOSTS, extensionAutoReport, extensionAutoResumeInput, extensionAutoSetInput, isVintedPauseReason, normalizeVintedHost,
  type CloudActionDetail, type CloudRunCode, type ExtensionAuto, type ExtensionAutoNext, type ExtensionAutoState, type Job,
} from "@selio/contracts";
import { repos, type Tx } from "@selio/db";
import { checkMessageDelay, isAutomatable, isWithinSchedule, renderTemplate } from "@selio/domain";
import { PLAN_QUOTAS } from "@selio/demo-data";
import { AppError, requireAction, withOrg, type OrgContext } from "../context";
import { deliveredMessages } from "./automation";
import { NOT_IN_DAILY_QUOTA, cloudActiveHours, cloudDayStart, cloudSettings, hasValidConsent, machinePausedUntil, notifyPaused } from "./cloud";
import { processInboxSnapshot, type InboxProcessResult } from "./cloud-inbox";
import { ensureFullAutoTx } from "./full-auto";
import { effectiveLimitsTx, limitsContextFor } from "./negotiation";

/**
 * Automatisation complète par l'extension (D64) : tant que le Chrome du vendeur est ouvert, l'extension
 * demande au serveur quoi faire (`nextAction`), l'exécute dans un onglet en arrière-plan, puis en rend compte
 * (`reportAction`). TOUTES les décisions sont prises ici, comme pour Selio Cloud :
 * - interrupteur activé par le client (accord courant obligatoire), un seul compte Vinted par navigateur ;
 * - arrêt global, accord courant, pause venue de Vinted (reprise acquittée par le client), coupe-circuit,
 *   heures actives, une action à la fois, plafond horaire (12), délai humain (3 min + 0 à 4 min), plafond
 *   du jour de l'offre pour les envois ; tâche de plus de 24 h écartée ;
 * - au moment d'envoyer : conversation du bon compte, ouverte, dernier message de l'acheteur, délai minimal
 *   entre deux messages ; texte préparé (brouillon de l'IA, texte de la règle, gabarit) jamais vide ;
 * - compte rendu : envoi confirmé → envoyé ; rien cliqué → tâche remise en file ; clic sans confirmation →
 *   échec, jamais renvoyé ; signal de Vinted → pause, email aux propriétaires, rien de retenté.
 * Lecture de la messagerie : même enregistrement que le Cloud (`processInboxSnapshot`, source « browser »).
 * Le journal (`cloud_actions`, source « browser ») ne porte que des comptes, jamais un texte ni un pseudo.
 */

const PAUSE_CODES: readonly CloudRunCode[] = ["captcha", "warning", "blocked", "rate_limited"];
const UNCERTAIN = "Résultat incertain : vérifiez dans Vinted avant de relancer.";

/** URL d'une page Vinted que l'extension sait lire (son script n'est présent que sur ces domaines). */
function extensionHost(host: unknown): string | null {
  const h = normalizeVintedHost(host) ?? "www.vinted.fr";
  const www = h.startsWith("www.") ? h : `www.${h}`;
  return (EXTENSION_AUTO_HOSTS as readonly string[]).includes(www) ? www : null;
}

async function eligibleConnections(tx: Tx) {
  return (await repos.connections.list(tx)).filter((c) => c.provider === "vinted" && c.status !== "disconnected" && isAutomatable(c));
}

// ---------------------------------------------------------------- état, interrupteur, reprise

export async function autoState(ctx: OrgContext): Promise<ExtensionAutoState> {
  return withOrg(ctx, async (tx) => {
    const autos = new Map((await repos.extensionAutos.list(tx)).map((a) => [a.connectionId, a]));
    const cloud = new Map((await repos.cloudAccounts.list(tx)).map((a) => [a.connectionId, a]));
    return {
      consentCurrent: await hasValidConsent(tx),
      consentVersion: CLOUD_CONSENT_VERSION,
      intervalMinutes: cloudSettings(ctx.services).inboxSyncMinutes,
      connections: (await eligibleConnections(tx)).map((c) => {
        const a = autos.get(c.id);
        const cl = cloud.get(c.id);
        return {
          connectionId: c.id, label: c.label, enabled: a?.enabled ?? false, pausedReason: a?.pausedReason ?? null, pausedLabel: a?.pausedReason ? CLOUD_PAUSE_REASON_LABELS[a.pausedReason] : null,
          lastSeenAt: a?.lastSeenAt ?? null, lastActionAt: a?.lastActionAt ?? null, cloudActive: cl?.status === "active" && cl.hasSession,
        };
      }),
    };
  });
}

/**
 * Interrupteur « Automatisation complète dans ce navigateur » : activable seulement avec l'accord courant
 * (texte d'accord de Selio Cloud, qui décrit ce mode). Un seul compte Vinted à la fois (le navigateur n'est
 * connecté qu'à un compte). Coupé : les envois automatiques encore en file redeviennent des tâches à valider.
 */
export async function setAuto(ctx: OrgContext, raw: unknown): Promise<ExtensionAutoState> {
  requireAction(ctx, "cloud.manage");
  const parsed = extensionAutoSetInput.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", "Réglage invalide", 400, parsed.error.flatten());
  const nowIso = ctx.services.now().toISOString();
  await withOrg(ctx, async (tx) => {
    const connection = (await eligibleConnections(tx)).find((c) => c.id === parsed.data.connectionId);
    if (!connection) throw new AppError("validation", "Compte Vinted introuvable, déconnecté ou Perso : il ne peut pas être automatisé.", 400);
    if (parsed.data.enabled) {
      if (!(await hasValidConsent(tx))) throw new AppError("consent_required", "Acceptez d'abord les conditions de l'automatisation dans Selio (Selio Cloud › Accord) : elles couvrent aussi l'automatisation complète par l'extension.", 409, { version: CLOUD_CONSENT_VERSION });
      if (!extensionHost(connection.config.vintedHost)) throw new AppError("validation", "Ce domaine Vinted n'est pas encore pris en charge par l'extension (vinted.fr, .be, .com).", 400);
      for (const other of await repos.extensionAutos.list(tx)) {
        if (other.connectionId !== connection.id && other.enabled) {
          await repos.extensionAutos.upsert(tx, other.connectionId, { enabled: false });
          await repos.jobs.browserAutoToApproval(tx, other.connectionId);
        }
      }
      await repos.extensionAutos.upsert(tx, connection.id, { enabled: true, enabledAt: nowIso, enabledBy: ctx.userId, lastSeenAt: nowIso });
      // Plein automatique : règles de réponse et de négociation actives, sans dernier clic (D64).
      await ensureFullAutoTx(ctx, tx, "extension");
    } else {
      await repos.extensionAutos.upsert(tx, connection.id, { enabled: false });
      await repos.jobs.browserAutoToApproval(tx, connection.id);
    }
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: parsed.data.enabled ? "extension.auto.enabled" : "extension.auto.disabled", targetType: "connection", targetId: connection.id, meta: { consentVersion: CLOUD_CONSENT_VERSION }, ip: ctx.ip });
  });
  return autoState(ctx);
}

/** Reprise après une pause : acquittement explicite exigé quand la pause vient de Vinted (rien ne reprend seul). */
export async function resumeAuto(ctx: OrgContext, raw: unknown): Promise<ExtensionAutoState> {
  requireAction(ctx, "cloud.manage");
  const parsed = extensionAutoResumeInput.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", "Reprise invalide", 400, parsed.error.flatten());
  await withOrg(ctx, async (tx) => {
    const auto = await repos.extensionAutos.byConnection(tx, parsed.data.connectionId);
    if (!auto?.pausedReason) throw new AppError("conflict", "L'automatisation de ce compte n'est pas en pause.", 409);
    if (isVintedPauseReason(auto.pausedReason) && !parsed.data.acknowledge) {
      throw new AppError("acknowledge_required", `${CLOUD_PAUSE_REASON_LABELS[auto.pausedReason]} : vérifiez le compte dans Vinted, puis confirmez en avoir pris connaissance pour reprendre.`, 409, { pausedReason: auto.pausedReason });
    }
    if (!(await hasValidConsent(tx))) throw new AppError("consent_required", "Acceptez d'abord les conditions de l'automatisation dans Selio.", 409, { version: CLOUD_CONSENT_VERSION });
    await repos.extensionAutos.upsert(tx, auto.connectionId, { pausedReason: null, pausedAt: null });
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "extension.auto.resumed", targetType: "connection", targetId: auto.connectionId, meta: { previousReason: auto.pausedReason, acknowledged: isVintedPauseReason(auto.pausedReason) }, ip: ctx.ip });
  });
  return autoState(ctx);
}

// ---------------------------------------------------------------- prochaine action (décidée par le serveur)

const wait = (reason: string, retryInMinutes: number): ExtensionAutoNext => ({ action: "wait", reason, retryInMinutes: Math.min(240, Math.max(0.5, Math.round(retryInMinutes * 10) / 10)) });

/** Passage interrompu (onglet fermé, navigateur quitté pendant une action) : jamais renvoyé, compte en pause. */
async function recoverStaleTx(tx: Tx, auto: ExtensionAuto, now: Date): Promise<void> {
  const before = now.getTime() - CLOUD_LOCK_STALE_MINUTES * 60_000;
  for (const job of await repos.jobs.runningBrowserAuto(tx, auto.connectionId)) {
    if (new Date(job.startedAt ?? job.updatedAt).getTime() >= before) continue;
    const nowIso = now.toISOString();
    const sync = job.payload.cloudKind === "sync_inbox";
    await repos.jobs.update(tx, job.id, { status: "failed", error: sync ? "Lecture interrompue (navigateur fermé ?)." : `Envoi interrompu (navigateur fermé ?). ${UNCERTAIN}`, finishedAt: nowIso });
    const action = await repos.cloudActions.byJob(tx, job.id);
    if (action?.status === "running") await repos.cloudActions.update(tx, action.id, { status: "failed", finishedAt: nowIso, detail: { ...action.detail, code: "error", sideEffects: sync ? "none" : "unknown", message: "passage interrompu" } });
    const messageId = typeof job.result?.messageId === "string" ? job.result.messageId : null;
    if (messageId) await repos.messages.update(tx, messageId, { status: "failed", error: UNCERTAIN }).catch(() => null);
    // Un envoi a pu partir : pause prudente (Vinted a pu afficher un signal que personne n'a lu).
    if (!sync && !auto.pausedReason) {
      await repos.extensionAutos.pauseForSignal(tx, auto.connectionId, "interrupted", nowIso);
      await repos.audit.add(tx, { actorUserId: null, action: "extension.auto.paused", targetType: "connection", targetId: auto.connectionId, meta: { reason: "interrupted", automatic: true, jobId: job.id } });
    }
  }
}

/**
 * Ce que l'extension doit faire maintenant pour le compte activé : attendre (avec la raison et le délai),
 * lire la messagerie, ou envoyer un message préparé. Chaque appel compte comme un signe de vie de l'extension
 * (routage des tâches vers le navigateur). La tâche rendue est prise sous verrou (jamais deux fois).
 */
export async function nextAction(ctx: OrgContext): Promise<ExtensionAutoNext> {
  const { services } = ctx;
  const now = services.now();
  const nowIso = now.toISOString();
  const machine = await machinePausedUntil(services, now);
  return withOrg(ctx, async (tx) => {
    const auto = (await repos.extensionAutos.list(tx)).find((a) => a.enabled);
    if (!auto) return wait("disabled", 30);
    const connection = (await eligibleConnections(tx)).find((c) => c.id === auto.connectionId);
    if (!connection) return wait("connection_unavailable", 30);
    await repos.extensionAutos.upsert(tx, auto.connectionId, { lastSeenAt: nowIso });
    await recoverStaleTx(tx, auto, now);
    const fresh = (await repos.extensionAutos.lockedByConnection(tx, auto.connectionId))!;
    if ((await repos.automationState.get(tx)).globalPaused) return wait("global_pause", 15);
    if (!(await hasValidConsent(tx))) return wait("no_consent", 30);
    if (fresh.pausedReason) return wait("paused", 30);
    if (machine) return wait("machine_paused", Math.max(1, (new Date(machine.until).getTime() - now.getTime()) / 60_000));
    // Compte actif dans Selio Cloud : le Cloud s'en charge (jamais deux automatisations sur le même compte).
    const cloud = await repos.cloudAccounts.byConnection(tx, auto.connectionId);
    if (cloud?.status === "active" && cloud.hasSession) return wait("cloud_active", 30);
    const org = await repos.orgs.byId(tx, ctx.orgId);
    if (!isWithinSchedule(cloudActiveHours(org.settings.timezone, services.config?.cloudActiveHours), now)) return wait("outside_active_hours", 30);
    if ((await repos.jobs.runningBrowserAuto(tx, auto.connectionId)).length > 0) return wait("busy", 2);
    if ((await repos.cloudActions.countBrowserSince(tx, new Date(now.getTime() - 3_600_000).toISOString(), auto.connectionId)) >= CLOUD_MAX_ACTIONS_PER_HOUR) return wait("hourly_limit", 10);
    if (fresh.nextActionAt && new Date(fresh.nextActionAt).getTime() > now.getTime()) return wait("too_soon", (new Date(fresh.nextActionAt).getTime() - now.getTime()) / 60_000);
    const host = extensionHost(connection.config.vintedHost);
    if (!host) return wait("host_unsupported", 60);

    // 1. Envois dus (réponses, négociation) avant toute lecture.
    const quotas = (await repos.subscriptions.get(tx))?.quotas ?? PLAN_QUOTAS.free;
    const dayStart = cloudDayStart(now);
    // Plafond du jour de l'offre : envois du Cloud et de l'extension confondus (lectures non comprises).
    const sentToday = await repos.cloudActions.countSince(tx, dayStart, undefined, { excludeKinds: NOT_IN_DAILY_QUOTA });
    const dailyLimited = sentToday >= quotas.automationActionsPerDay;
    if (!dailyLimited) {
      for (const job of await repos.jobs.dueBrowserAuto(tx, auto.connectionId, nowIso)) {
        const prepared = await prepareSendTx(ctx, tx, job, auto.connectionId, host, now);
        if (prepared === "skip") continue;
        return { action: "send", jobId: job.id, conversationUrl: prepared.url, text: prepared.text, retryInMinutes: 3 };
      }
    }
    if (dailyLimited) return wait("daily_limit", 60);

    // 2. Lecture de la messagerie si la précédente est assez ancienne.
    const interval = cloudSettings(services).inboxSyncMinutes;
    if (interval === 0) return wait("sync_disabled", 30);
    const last = await repos.jobs.lastBrowserSyncAt(tx, auto.connectionId);
    const dueIn = last ? interval - (now.getTime() - new Date(last).getTime()) / 60_000 : 0;
    if (dueIn > 0) return wait("idle", Math.min(dueIn, 5));
    const job = await repos.jobs.create(tx, {
      kind: "connector.sync", status: "running", dedupeKey: `ext.sync_inbox:${auto.connectionId}:${nowIso}`, ruleId: null, runsIn: "browser", maxAttempts: 1,
      payload: { extAuto: true, connectionId: auto.connectionId, cloudKind: "sync_inbox" }, scheduledFor: nowIso, startedAt: nowIso, createdAt: nowIso,
    });
    const action = await repos.cloudActions.add(tx, { accountId: null, source: "browser", connectionId: auto.connectionId, kind: "sync_inbox", level: "light", status: "running", jobId: job.id, startedAt: nowIso, createdAt: nowIso });
    await repos.jobs.update(tx, job.id, { result: { extAuto: true, cloudActionId: action.id } });
    return { action: "sync_inbox", jobId: job.id, inboxUrl: `https://${host}/inbox`, maxConversations: cloudSettings(services).inboxMaxConversations, retryInMinutes: 3 };
  });
}

/** Revérifie et prend un envoi : « skip » s'il doit attendre ou a été écarté (journalisé). */
async function prepareSendTx(ctx: OrgContext, tx: Tx, job: Job, connectionId: string, host: string, now: Date): Promise<"skip" | { url: string; text: string }> {
  const nowIso = now.toISOString();
  const skipJob = async (reason: string) => {
    await repos.jobs.update(tx, job.id, { status: "skipped", result: { ...(job.result ?? {}), extAuto: true, reason }, finishedAt: nowIso });
    await repos.cloudActions.add(tx, { accountId: null, source: "browser", connectionId, kind: "reply", level: "light", status: "skipped", jobId: job.id, detail: { reason: reason.slice(0, 60) }, createdAt: nowIso });
    const draftId = typeof job.payload.draftMessageId === "string" ? job.payload.draftMessageId : null;
    const draft = draftId ? await repos.messages.byId(tx, draftId).catch(() => null) : null;
    if (draft && (draft.status === "draft" || draft.status === "failed")) await repos.messages.delete(tx, draft.id);
    return "skip" as const;
  };
  if (now.getTime() - new Date(job.createdAt).getTime() > CLOUD_JOB_MAX_AGE_HOURS * 3_600_000) return skipJob("expired");
  const convId = typeof job.payload.conversationId === "string" ? job.payload.conversationId : null;
  const conv = convId ? await repos.conversations.byId(tx, convId).catch(() => null) : null;
  if (!conv || !conv.externalRef || !/^\d{1,20}$/.test(conv.externalRef)) return skipJob("conversation_unknown");
  if (conv.connectionId !== connectionId) return skipJob("account_mismatch");
  if (conv.status === "archived") return skipJob("conversation_archived");
  const msgs = await repos.messages.forConversation(tx, conv.id);
  const draftId = typeof job.payload.draftMessageId === "string" ? job.payload.draftMessageId : null;
  const prepared = draftId ? msgs.find((m) => m.id === draftId && (m.status === "draft" || m.status === "failed")) ?? null : null;
  if (draftId && !prepared) return skipJob("follow_up_obsolete");
  const delivered = deliveredMessages(msgs.filter((m) => m.id !== prepared?.id));
  if (delivered[delivered.length - 1]?.direction === "outbound") return skipJob("already_answered");
  const org = await repos.orgs.byId(tx, ctx.orgId);
  const limits = (await effectiveLimitsTx(tx, org)).limits;
  if (!checkMessageDelay(limitsContextFor(msgs, limits, now)).allowed) return "skip";
  const rule = job.ruleId ? await repos.rules.byId(tx, job.ruleId).catch(() => null) : null;
  const hasBody = typeof job.payload.body === "string" && job.payload.body.trim().length > 0;
  const templateRule = rule?.kind === "reply_on_new_message";
  if (!prepared && !hasBody && (job.payload.handoff === true || !templateRule)) return skipJob("nothing_to_send");
  const customer = await repos.customers.byId(tx, conv.customerId).catch(() => null);
  const item = conv.itemId ? await repos.items.byId(tx, conv.itemId).catch(() => null) : null;
  const text = (prepared ? prepared.body : hasBody ? (job.payload.body as string) : renderTemplate(rule?.config.template ?? "Bonjour {{prenom}}, merci pour votre message.", { prenom: customer?.displayName.split(" ")[0] ?? "", article: item?.title ?? "l'article" })).slice(0, 2000);
  if (!text.trim()) return skipJob("empty_message");
  const claimed = await repos.jobs.claimBrowserAuto(tx, job.id, nowIso);
  if (!claimed) return "skip";
  const message = prepared
    ? await repos.messages.update(tx, prepared.id, { status: "pending", body: text, error: null })
    : await repos.messages.create(tx, { conversationId: conv.id, direction: "outbound", source: "automation", status: "pending", body: text, offerCents: typeof job.payload.offerCents === "number" ? job.payload.offerCents : null, ruleId: rule?.id ?? null });
  const detail: CloudActionDetail = { conversationRef: conv.externalRef, conversationId: conv.id, messageLength: text.length, ...(typeof job.payload.ruleName === "string" ? { ruleName: job.payload.ruleName.slice(0, 120) } : {}) };
  const action = await repos.cloudActions.add(tx, { accountId: null, source: "browser", connectionId, kind: "reply", level: "light", status: "running", jobId: job.id, detail, startedAt: nowIso, createdAt: nowIso });
  await repos.jobs.update(tx, job.id, { result: { extAuto: true, cloudActionId: action.id, messageId: message.id, fromDraft: prepared !== null } });
  return { url: `https://${host}/inbox/${conv.externalRef}`, text };
}

// ---------------------------------------------------------------- compte rendu de l'extension

export interface ReportResult {
  status: "recorded";
  code: CloudRunCode;
  paused: boolean;
  inbox: InboxProcessResult | null;
}

/**
 * Compte rendu d'une action rendue par `nextAction`. La pause d'un signal de Vinted est écrite d'abord
 * (transaction courte), puis le reste ; les propriétaires reçoivent l'email ; rien n'est retenté.
 */
export async function reportAction(ctx: OrgContext, raw: unknown, opts: { rng?: () => number } = {}): Promise<ReportResult> {
  const parsed = extensionAutoReport.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", "Compte rendu invalide", 400, parsed.error.flatten());
  const r = parsed.data;
  const { services } = ctx;
  const rng = opts.rng ?? Math.random;
  const now = services.now();
  const nowIso = now.toISOString();
  const code = r.code;
  const pause = PAUSE_CODES.includes(code);
  const ref = await withOrg(ctx, async (tx) => {
    const job = await repos.jobs.byId(tx, r.jobId).catch(() => null);
    if (!job || job.payload.extAuto !== true || job.status !== "running" || typeof job.payload.connectionId !== "string") throw new AppError("conflict", "Cette action n'est plus attendue.", 409);
    const connection = await repos.connections.byId(tx, job.payload.connectionId).catch(() => null);
    return { job, connectionId: job.payload.connectionId, label: connection?.label ?? "Compte Vinted" };
  });
  if (pause) {
    await withOrg(ctx, async (tx) => {
      await repos.extensionAutos.pauseForSignal(tx, ref.connectionId, code as "captcha", nowIso);
      await repos.audit.add(tx, { actorUserId: null, action: "extension.auto.paused", targetType: "connection", targetId: ref.connectionId, meta: { reason: code, automatic: true, jobId: ref.job.id } });
    });
    await notifyPaused(services, ctx.orgId, ref.label, code, "browser");
  }
  const sync = ref.job.payload.cloudKind === "sync_inbox";
  const launched = code !== "unavailable";
  const nothingSent = r.sideEffects === "none";
  await withOrg(ctx, async (tx) => {
    const action = await repos.cloudActions.byJob(tx, ref.job.id);
    const detail: CloudActionDetail = { ...(action?.detail ?? {}), code, ...(typeof r.durationMs === "number" ? { durationMs: r.durationMs } : {}), ...(!sync && code !== "ok" ? { sideEffects: r.sideEffects } : {}) };
    const messageId = typeof ref.job.result?.messageId === "string" ? ref.job.result.messageId : null;
    const fromDraft = ref.job.result?.fromDraft === true;
    const settleMessage = async (error: string) => {
      if (!messageId) return;
      if (nothingSent && fromDraft) await repos.messages.update(tx, messageId, { status: "draft", error: null });
      else if (nothingSent) await repos.messages.delete(tx, messageId);
      else await repos.messages.update(tx, messageId, { status: "failed", error: `${error} ${UNCERTAIN}`.slice(0, 500) });
    };
    const pace = { lastActionAt: nowIso, nextActionAt: new Date(now.getTime() + (CLOUD_MIN_MINUTES_BETWEEN_ACTIONS + rng() * CLOUD_JITTER_MAX_MINUTES) * 60_000).toISOString() };
    if (!launched) {
      // Aucun onglet n'a pu s'ouvrir : rien n'a touché Vinted.
      await settleMessage(CLOUD_RUN_CODE_LABELS[code]);
      if (sync) await repos.jobs.update(tx, ref.job.id, { status: "skipped", result: { extAuto: true, code }, finishedAt: nowIso });
      else await repos.jobs.update(tx, ref.job.id, { status: "queued", startedAt: null, result: { extAuto: true, code: "requeued" } });
      if (action) await repos.cloudActions.remove(tx, action.id);
      return;
    }
    if (code === "ok") {
      if (messageId) {
        const sent = await repos.messages.update(tx, messageId, { status: "sent", sentAt: nowIso, error: null });
        const conv = await repos.conversations.byId(tx, sent.conversationId);
        await repos.conversations.update(tx, conv.id, { lastMessageAt: nowIso, lastMessagePreview: sent.body.slice(0, 120), negotiationRounds: sent.offerCents !== null ? conv.negotiationRounds + 1 : conv.negotiationRounds });
        await repos.customers.update(tx, conv.customerId, { lastContactAt: nowIso }).catch(() => null);
        await repos.usage.record(tx, "automation.action", { jobId: ref.job.id, browser: true });
      }
      await repos.jobs.update(tx, ref.job.id, { status: "succeeded", error: null, result: { ...(ref.job.result ?? {}), code }, finishedAt: nowIso });
      if (action) await repos.cloudActions.update(tx, action.id, { status: "done", finishedAt: nowIso, detail });
    } else if (pause) {
      await settleMessage(CLOUD_RUN_CODE_LABELS[code]);
      await repos.jobs.update(tx, ref.job.id, sync || !nothingSent
        ? { status: "failed", error: sync ? CLOUD_RUN_CODE_LABELS[code] : `${CLOUD_RUN_CODE_LABELS[code]}. ${UNCERTAIN}`, result: { ...(ref.job.result ?? {}), code }, finishedAt: nowIso }
        : { status: "queued", startedAt: null, error: CLOUD_RUN_CODE_LABELS[code], result: { ...(ref.job.result ?? {}), code } });
      if (action) await repos.cloudActions.update(tx, action.id, { status: "paused", finishedAt: nowIso, detail });
    } else {
      // Erreur, page non reconnue, délai, session Vinted absente du navigateur : jamais renvoyé si un clic a pu avoir lieu.
      await settleMessage(CLOUD_RUN_CODE_LABELS[code]);
      const requeue = !sync && nothingSent && code === "not_logged_in";
      await repos.jobs.update(tx, ref.job.id, requeue
        ? { status: "queued", startedAt: null, error: CLOUD_RUN_CODE_LABELS[code], result: { ...(ref.job.result ?? {}), code } }
        : { status: "failed", error: nothingSent ? CLOUD_RUN_CODE_LABELS[code] : `${CLOUD_RUN_CODE_LABELS[code]}. ${UNCERTAIN}`, result: { ...(ref.job.result ?? {}), code }, finishedAt: nowIso });
      if (action) await repos.cloudActions.update(tx, action.id, { status: "failed", finishedAt: nowIso, detail });
      // Navigateur déconnecté de Vinted : on attend 30 min avant de redemander.
      if (code === "not_logged_in") pace.nextActionAt = new Date(now.getTime() + 30 * 60_000).toISOString();
    }
    await repos.extensionAutos.upsert(tx, ref.connectionId, pace);
  });
  let inbox: InboxProcessResult | null = null;
  if (sync && code === "ok") inbox = await processInboxSnapshot(services, ctx.orgId, { source: "browser", connectionId: ref.connectionId, jobId: ref.job.id }, r.inbox ?? { conversations: [], listSource: "none" });
  return { status: "recorded", code, paused: pause, inbox };
}
