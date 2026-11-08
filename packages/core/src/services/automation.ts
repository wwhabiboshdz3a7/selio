import { counterOfferWording } from "@selio/ai";
import { CLOUD_RULE_ACTIONS, automationRuleCreate, jobQuery, negotiationAutomation, type AutomationRule, type CloudAccount, type InventoryItem, type Job, type Message, type RunLocation, type RuleKind } from "@selio/contracts";
import { repos, type Tx } from "@selio/db";
import {
  PERSONAL_ACCOUNT_SKIP, applyLimits, applyLimitsToDecision, checkMessageDelay, followUpTemplateAllowed, applySituationOverride, bundleMessage, daysInStock, decideFollowUp, evaluateOffer, fillTemplate, followUp24hDedupeKey, gateRule, isAutomatable, jobDedupeKey, localDayKey, recheckFollowUp, renderTemplate, retryDelayMs, situationTemplateReply,
  type BundleNegotiationResult, type NegotiationResult,
} from "@selio/domain";
import { PLAN_QUOTAS } from "@selio/demo-data";
import { AppError, nowIso, requireAction, withOrg, type OrgContext } from "../context";
import type { AutomationState } from "../types-data";
import { sendMessageTx } from "./messaging";
import { updateItemTx } from "./items";
import { effectiveLimitsTx, escalationFor, evaluateConversationBundleTx, limitsContextFor, situationFor } from "./negotiation";

export const listRules = (ctx: OrgContext) => withOrg(ctx, (tx) => repos.rules.list(tx));

export function createRule(ctx: OrgContext, raw: unknown): Promise<AutomationRule> {
  requireAction(ctx, "automations.write");
  const parsed = automationRuleCreate.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", "Règle invalide", 400, parsed.error.flatten());
  return withOrg(ctx, async (tx) => {
    const rule = await repos.rules.create(tx, parsed.data);
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "rule.created", targetType: "automation_rule", targetId: rule.id, meta: { kind: rule.kind }, ip: ctx.ip });
    return rule;
  });
}

export function updateRule(ctx: OrgContext, id: string, raw: Record<string, unknown>): Promise<AutomationRule> {
  requireAction(ctx, "automations.write");
  return withOrg(ctx, async (tx) => {
    const r = await repos.rules.byId(tx, id);
    const merged = automationRuleCreate.safeParse({ ...r, ...raw, schedule: { ...r.schedule, ...((raw.schedule as object) ?? {}) }, limits: { ...r.limits, ...((raw.limits as object) ?? {}) }, config: { ...r.config, ...((raw.config as object) ?? {}) } });
    if (!merged.success) throw new AppError("validation", "Règle invalide", 400, merged.error.flatten());
    const saved = await repos.rules.update(tx, id, merged.data);
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "rule.updated", targetType: "automation_rule", targetId: id, meta: { enabled: saved.enabled }, ip: ctx.ip });
    return saved;
  });
}

export function deleteRule(ctx: OrgContext, id: string): Promise<void> {
  requireAction(ctx, "automations.write");
  return withOrg(ctx, async (tx) => {
    await repos.rules.delete(tx, id);
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "rule.deleted", targetType: "automation_rule", targetId: id, ip: ctx.ip });
  });
}

export function getState(ctx: OrgContext): Promise<AutomationState> {
  return withOrg(ctx, async (tx) => {
    const s = await repos.automationState.get(tx);
    const org = await repos.orgs.byId(tx, ctx.orgId);
    const today = localDayKey(ctx.services.now(), org.settings.timezone);
    const actionsToday = await tx.count("select count(*) from jobs where org_id = $1 and status = 'succeeded' and to_char(coalesce(finished_at, created_at) at time zone $2, 'YYYY-MM-DD') = $3", [ctx.orgId, org.settings.timezone, today]);
    return { globalPaused: s.globalPaused, pausedAt: s.pausedAt, actionsToday };
  });
}

export function setGlobalPause(ctx: OrgContext, paused: boolean): Promise<AutomationState> {
  requireAction(ctx, "automations.write");
  return withOrg(ctx, async (tx) => {
    await repos.automationState.set(tx, paused);
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: paused ? "automation.global_pause" : "automation.global_resume", ip: ctx.ip });
  }).then(() => getState(ctx));
}

export function listJobs(ctx: OrgContext, raw: unknown) {
  const q = jobQuery.safeParse(raw ?? {});
  if (!q.success) throw new AppError("validation", "Filtres invalides", 400, q.error.flatten());
  return withOrg(ctx, (tx) => repos.jobs.list(tx, q.data));
}

/** Identifiants des comptes Perso de l'organisation. */
async function personalAccountIds(tx: Tx): Promise<Set<string>> {
  return new Set((await repos.connections.list(tx)).filter((c) => !isAutomatable(c)).map((c) => c.id));
}

/**
 * Transport d'une tâche (fonction pure) : une réponse ou une relance passe par Selio Cloud quand le
 * compte Vinted de la conversation y est actif (session enregistrée, ni en pause ni arrêté) ; sinon
 * la tâche garde l'emplacement déclaré par la règle (serveur ou extension). Les autres règles ne
 * passent jamais par le Cloud au lancement (actions légères seulement sur l'adresse partagée).
 */
export function decideRunsIn(input: { ruleKind: RuleKind; ruleRunsIn: RunLocation; cloudAccount: Pick<CloudAccount, "status" | "hasSession"> | null | undefined }): RunLocation {
  if (CLOUD_RULE_ACTIONS[input.ruleKind] && input.cloudAccount?.status === "active" && input.cloudAccount.hasSession) return "cloud";
  // Une règle ne se déclare jamais « cloud » : sans compte actif, la tâche part vers l'extension.
  return input.ruleRunsIn === "cloud" ? "browser" : input.ruleRunsIn;
}

/** Exécute une tâche (serveur). Les tâches « navigateur » ne sont exécutables que par l'extension, les tâches « cloud » par Selio Cloud. */
export async function executeJobTx(ctx: OrgContext, tx: Tx, job: Job): Promise<Job> {
  // Le compte a pu passer en « Perso » entre la planification et la validation : on n'agit pas.
  const personal = await personalAccountIds(tx);
  if (personal.size > 0) {
    const convId = typeof job.payload.conversationId === "string" ? job.payload.conversationId : null;
    const itemId = typeof job.payload.itemId === "string" ? job.payload.itemId : null;
    const target = convId ? await repos.conversations.byId(tx, convId).catch(() => null) : itemId ? await repos.items.byId(tx, itemId).catch(() => null) : null;
    if (target?.connectionId && personal.has(target.connectionId)) {
      return repos.jobs.update(tx, job.id, { status: "skipped", result: { reason: PERSONAL_ACCOUNT_SKIP }, finishedAt: nowIso(ctx) });
    }
  }
  if (job.runsIn === "cloud") {
    // Exécutée par le planificateur Cloud (worker), jamais ici : la tâche attend en file.
    return repos.jobs.update(tx, job.id, { status: "queued", scheduledFor: job.status === "queued" ? job.scheduledFor : nowIso(ctx), result: { ...(job.result ?? {}), awaitingCloud: true, note: "À exécuter par Selio Cloud (navigateur isolé sur notre machine)." } });
  }
  if (job.runsIn === "browser") {
    // En mode connecté, une action navigateur est remise à l'extension : on la marque en file pour elle.
    const conv = typeof job.payload.conversationId === "string" ? await repos.conversations.byId(tx, job.payload.conversationId).catch(() => null) : null;
    const connection = conv?.connectionId ? await repos.connections.byId(tx, conv.connectionId).catch(() => null) : null;
    if (connection?.provider !== "demo") {
      return repos.jobs.update(tx, job.id, { status: "queued", scheduledFor: nowIso(ctx), result: { awaitingBrowser: true, note: "À exécuter par l'extension (navigateur ouvert requis)." } });
    }
  }
  const rule = job.ruleId ? await repos.rules.byId(tx, job.ruleId).catch(() => null) : null;
  if (job.kind === "automation.send_message" && typeof job.payload.conversationId === "string") {
    const stopped = await preSendCheckTx(ctx, tx, job, rule);
    if (stopped) return stopped;
  }
  await repos.jobs.update(tx, job.id, { status: "running", startedAt: nowIso(ctx), attempts: job.attempts + 1 });
  const attempts = job.attempts + 1;
  try {
    let result: Record<string, unknown> = { noop: true };
    const conversationId = typeof job.payload.conversationId === "string" ? job.payload.conversationId : null;
    const itemId = typeof job.payload.itemId === "string" ? job.payload.itemId : null;
    if (job.kind === "automation.send_message" && conversationId && rule) {
      const conv = await repos.conversations.byId(tx, conversationId);
      const customer = await repos.customers.byId(tx, conv.customerId);
      const item = conv.itemId ? await repos.items.byId(tx, conv.itemId).catch(() => null) : null;
      const body = typeof job.payload.body === "string" ? job.payload.body : renderTemplate(rule.config.template ?? "Bonjour {{prenom}}, merci pour votre message.", { prenom: customer.displayName.split(" ")[0], article: item?.title ?? "l'article" });
      // Brouillon déjà préparé (relance après 24 h, offre Pro) : on envoie le texte tel que le vendeur l'a validé ou corrigé.
      const prepared = typeof job.payload.draftMessageId === "string" ? await repos.messages.byId(tx, job.payload.draftMessageId).catch(() => null) : null;
      const draft = prepared && prepared.conversationId === conversationId && (prepared.status === "draft" || prepared.status === "failed")
        ? prepared
        : await repos.messages.create(tx, { conversationId, direction: "outbound", source: "automation", status: "draft", body, offerCents: typeof job.payload.offerCents === "number" ? job.payload.offerCents : null, ruleId: rule.id });
      const sent = await sendMessageTx(ctx, tx, draft.id);
      if (sent.status !== "sent") throw new Error(sent.error ?? "Envoi refusé");
      result = { messageId: sent.id, simulated: sent.simulated };
    } else if (job.kind === "automation.evaluate" && itemId && rule?.kind === "price_drop_stale") {
      const item = await repos.items.byId(tx, itemId);
      const next = Math.max(item.floorPriceCents ?? 0, Math.round((item.listedPriceCents ?? 0) * (1 - (rule.config.dropRate ?? 0.05))));
      if (next < (item.listedPriceCents ?? 0)) await updateItemTx(ctx, tx, itemId, { listedPriceCents: next });
      result = { from: item.listedPriceCents, to: next };
    }
    await repos.usage.record(tx, "automation.action", { jobId: job.id });
    return repos.jobs.update(tx, job.id, { status: "succeeded", result, error: null, finishedAt: nowIso(ctx) });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const failed = attempts >= job.maxAttempts;
    return repos.jobs.update(tx, job.id, { status: failed ? "failed" : "queued", error, finishedAt: nowIso(ctx), scheduledFor: failed ? job.scheduledFor : new Date(ctx.services.now().getTime() + retryDelayMs(attempts)).toISOString() });
  }
}

/** Règles dont le texte par défaut est le gabarit de la règle (réponse, ancienne relance, après-vente). */
const TEMPLATE_RULES: readonly RuleKind[] = ["reply_on_new_message", "follow_up_no_reply", "post_sale_message"];

/** Article encore en vente (« listed ») et sans commande en cours : une relance peut dire « toujours disponible ». */
export async function itemAvailableTx(tx: Tx, item: InventoryItem | null): Promise<boolean> {
  if (!item || item.status !== "listed") return false;
  return !(await repos.orders.forItem(tx, item.id)).some((o) => o.status !== "cancelled" && o.status !== "refunded");
}

/** Messages réellement échangés (un brouillon n'a pas été lu par l'acheteur). */
export function deliveredMessages<T extends Pick<Message, "status">>(msgs: readonly T[]): T[] {
  return msgs.filter((m) => m.status === "sent" || m.status === "received" || m.status === "pending");
}

/** Supprime le brouillon préparé d'une tâche (relance abandonnée, limite atteinte). */
async function dropPreparedDraftTx(tx: Tx, job: Job): Promise<void> {
  if (typeof job.payload.draftMessageId !== "string") return;
  const draft = await repos.messages.byId(tx, job.payload.draftMessageId).catch(() => null);
  if (draft && (draft.status === "draft" || draft.status === "failed")) await repos.messages.delete(tx, draft.id);
}

/**
 * Revérifications juste avant d'envoyer un message (validation, file serveur, nouvelle tentative) :
 * - relance : l'acheteur n'a pas répondu depuis la planification, l'article est encore en vente, la
 *   conversation est ouverte (sinon la tâche est écartée et son brouillon supprimé) ;
 * - texte : une tâche sans texte ni brouillon préparé (situation transmise au vendeur, réponse à rédiger
 *   par mon IA perso) n'envoie JAMAIS un remerciement générique : refus 409, le vendeur répond dans Messages ;
 * - limites de Vinted (mesurées, ou prudentes tant que non mesurées) : délai minimal entre deux messages
 *   pour un envoi AUTOMATIQUE (la tâche est remise en file à l'heure permise ; une tâche validée à la main
 *   part comme un envoi depuis Messages) et nombre de contre-offres par conversation, pour toutes les tâches
 *   (au-delà, la tâche est écartée et la conversation reste au vendeur).
 * Renvoie la tâche mise à jour quand rien ne doit partir maintenant, sinon null.
 */
async function preSendCheckTx(ctx: OrgContext, tx: Tx, job: Job, rule: AutomationRule | null): Promise<Job | null> {
  const now = ctx.services.now();
  const conv = await repos.conversations.byId(tx, job.payload.conversationId as string).catch(() => null);
  if (!conv) return null;
  const msgs = await repos.messages.forConversation(tx, conv.id);
  const skipWith = async (reason: string, extra: Record<string, unknown> = {}) => {
    await dropPreparedDraftTx(tx, job);
    return repos.jobs.update(tx, job.id, { status: "skipped", result: { ...(job.result ?? {}), reason, ...extra }, finishedAt: nowIso(ctx) });
  };
  if (job.payload.followUp === true) {
    const delivered = deliveredMessages(msgs);
    const lastDelivered = delivered[delivered.length - 1];
    const lastInbound = [...msgs].reverse().find((m) => m.direction === "inbound");
    const item = conv.itemId ? await repos.items.byId(tx, conv.itemId).catch(() => null) : null;
    const check = recheckFollowUp({
      conversation: { status: conv.status, lastMessageDirection: lastDelivered?.direction ?? null, lastMessageAt: lastDelivered ? lastDelivered.sentAt ?? lastDelivered.createdAt : null },
      jobCreatedAt: job.createdAt,
      lastInboundAt: lastInbound?.createdAt ?? null,
      itemAvailable: conv.itemId ? await itemAvailableTx(tx, item) : undefined,
    });
    if (!check.ok) return skipWith(check.reason, { code: check.code });
  }
  const prepared = typeof job.payload.draftMessageId === "string" ? msgs.find((m) => m.id === job.payload.draftMessageId && (m.status === "draft" || m.status === "failed")) : undefined;
  const hasBody = typeof job.payload.body === "string" && job.payload.body.trim().length > 0;
  if (!hasBody && !prepared && (job.payload.handoff === true || !rule || !TEMPLATE_RULES.includes(rule.kind))) {
    // File automatique : écartée sans rien envoyer ; validation par le vendeur : refus explicite.
    if (job.status !== "awaiting_approval") return skipWith("Aucun texte préparé : conversation transmise au vendeur, rien envoyé.", { code: "nothing_to_send" });
    throw new AppError("conflict", "Rien à envoyer automatiquement : cette conversation vous est transmise. Répondez dans Messages (vous pouvez demander une suggestion à mon IA perso) ; la tâche se ferme dès votre réponse.", 409);
  }
  const org = await repos.orgs.byId(tx, ctx.orgId);
  const limits = (await effectiveLimitsTx(tx, org)).limits;
  const limitsCtx = limitsContextFor(msgs, limits, now);
  // Une tâche validée à la main par le vendeur part comme un envoi depuis Messages (sans attente) ; le nombre
  // de contre-offres, lui, vaut pour toutes les tâches, validées ou automatiques.
  const humanApproved = job.status === "awaiting_approval";
  const check = job.payload.decision === "counter" ? (humanApproved ? applyLimits({ ...limitsCtx, lastOutboundAt: null }) : applyLimits(limitsCtx)) : humanApproved ? { allowed: true as const, waitSeconds: 0 as const } : checkMessageDelay(limitsCtx);
  if (check.allowed) return null;
  if (check.reason === "too_soon") {
    return repos.jobs.update(tx, job.id, { status: "queued", scheduledFor: new Date(now.getTime() + check.waitSeconds * 1000).toISOString(), result: { ...(job.result ?? {}), deferred: true, note: check.detail } });
  }
  return skipWith(`Limite Vinted : ${check.detail} Transmis au vendeur.`, { code: check.reason });
}

/**
 * Message de négociation automatique (sans IA) selon la décision de la politique.
 * Contre-offre : « dernier prix » seulement au prix plancher (counterCents === floorCents),
 * formule neutre sinon ; jamais « c'est mon meilleur prix » quand le plancher est plus bas.
 */
export function autoNegotiateBody(ev: NegotiationResult, offerCents: number, firstName: string): string {
  const fmt = (c: number) => (c / 100).toFixed(2).replace(".", ",") + " €";
  if (ev.decision === "accept") return `Bonjour ${firstName}, c'est d'accord pour ${fmt(offerCents)}. Faites l'offre sur l'annonce et je l'accepte.`;
  if (ev.decision === "counter" && ev.counterCents !== null) return `Bonjour ${firstName}, merci pour votre proposition. ${counterOfferWording(ev.counterCents, ev.floorCents)}`;
  return `Bonjour ${firstName}, merci pour l'intérêt. Je ne peux pas descendre à ce prix, l'article reste disponible au prix affiché.`;
}

export interface RunResult { evaluated: number; created: number; skipped: { reason: string; count: number }[] }

/** Règles qui portent sur les conversations ouvertes (les autres portent sur les articles en ligne). */
const CONVERSATION_RULES: readonly RuleKind[] = ["reply_on_new_message", "follow_up_no_reply", "auto_negotiate", "post_sale_message", "follow_up_24h", "keyword_situation"];

const eur = (c: number) => (c / 100).toFixed(2).replace(".", ",") + " €";

/** Règles de relance : une seule relance par conversation sans réponse, quelle que soit la règle qui l'a faite. */
const FOLLOW_UP_RULES: readonly RuleKind[] = ["follow_up_no_reply", "follow_up_24h"];

/**
 * Une relance existe-t-elle déjà depuis le dernier message de l'acheteur ? Message d'une règle de relance
 * après le dernier message reçu (brouillon, en attente, envoyé, ou échec au résultat incertain : il a pu
 * partir), ou tâche de relance créée depuis, QUEL QUE SOIT son statut : un brouillon supprimé (tâche
 * annulée), une relance refusée ou un envoi Cloud incertain (tâche échouée) comptent comme faits.
 */
async function followedUpSinceReplyTx(tx: Tx, conversationId: string, msgs: readonly Pick<Message, "direction" | "status" | "ruleId" | "error" | "createdAt">[], followUpRuleIds: ReadonlySet<string>): Promise<boolean> {
  let lastInbound = -1;
  msgs.forEach((m, i) => { if (m.direction === "inbound") lastInbound = i; });
  const counted = (m: (typeof msgs)[number]) => m.status !== "failed" || /incertain/i.test(m.error ?? "");
  if (msgs.slice(lastInbound + 1).some((m) => m.direction === "outbound" && m.ruleId !== null && followUpRuleIds.has(m.ruleId) && counted(m))) return true;
  const since = lastInbound >= 0 ? msgs[lastInbound]!.createdAt : null;
  return (await repos.jobs.countForConversationSince(tx, [...followUpRuleIds], conversationId, since)) > 0;
}

/** Relance par défaut (sans chiffre), utilisée quand le gabarit modifié enfreint la règle des relances. */
const DEFAULT_FOLLOW_UP_TEMPLATE = negotiationAutomation.parse({}).messages.followUp;

interface RuleTarget {
  targetId: string;
  payload: Record<string, unknown>;
  kind: Job["kind"];
  connectionId?: string | null;
  /** Clé d'idempotence propre (relance : une seule par conversation ; situation : une par message). */
  dedupeKey?: string;
  /** Statut imposé par la politique (brouillon à valider, transmission au vendeur). */
  status?: "awaiting_approval" | "queued";
  /** Emplacement imposé (relance Agence par le Cloud, brouillon Pro sur le serveur). */
  runsIn?: RunLocation;
  /** Brouillon à créer dans Messages, rattaché à la tâche (relance Pro). */
  draftBody?: string;
}

export async function runRuleTx(ctx: OrgContext, tx: Tx, rule: AutomationRule): Promise<RunResult> {
  const now = ctx.services.now();
  const org = await repos.orgs.byId(tx, ctx.orgId);
  const state = await repos.automationState.get(tx);
  const skipped = new Map<string, number>();
  const skip = (r: string) => skipped.set(r, (skipped.get(r) ?? 0) + 1);
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  let evaluated = 0, created = 0;
  const targets: RuleTarget[] = [];
  const personal = await personalAccountIds(tx);
  const cloudByConnection = CLOUD_RULE_ACTIONS[rule.kind] ? new Map((await repos.cloudAccounts.list(tx)).map((a) => [a.connectionId, a])) : new Map<string, CloudAccount>();
  if (CONVERSATION_RULES.includes(rule.kind)) {
    const negotiation = org.settings.automation.negotiation;
    const limits = rule.kind === "auto_negotiate" ? (await effectiveLimitsTx(tx, org)).limits : null;
    const quotas = rule.kind === "follow_up_24h" ? (await repos.subscriptions.get(tx))?.quotas ?? PLAN_QUOTAS.free : null;
    // Relances (ancienne règle et relance après 24 h) : jamais plus d'une par conversation sans réponse, toutes règles confondues.
    const followUpRuleIds = FOLLOW_UP_RULES.includes(rule.kind) ? new Set((await repos.rules.list(tx)).filter((r) => FOLLOW_UP_RULES.includes(r.kind)).map((r) => r.id)) : null;
    for (const conv of await repos.conversations.open(tx)) {
      evaluated++;
      if (conv.connectionId && personal.has(conv.connectionId)) { skip(PERSONAL_ACCOUNT_SKIP); continue; }
      const msgs = await repos.messages.forConversation(tx, conv.id);
      const last = msgs[msgs.length - 1];
      if (!last) continue;
      const customer = await repos.customers.byId(tx, conv.customerId);
      const prenom = customer.displayName.split(" ")[0] ?? "";
      if (rule.kind === "reply_on_new_message" && !(last.direction === "inbound" && conv.unreadCount > 0)) { skip("Pas de nouveau message non lu"); continue; }
      if (rule.kind === "follow_up_no_reply" && !(last.direction === "outbound" && (now.getTime() - new Date(last.createdAt).getTime()) / 3_600_000 >= (rule.config.delayHours ?? 48))) { skip("Délai de relance non atteint"); continue; }
      if (followUpRuleIds && (await followedUpSinceReplyTx(tx, conv.id, msgs, followUpRuleIds))) { skip("Relance déjà faite depuis la dernière réponse de l'acheteur"); continue; }
      if (rule.kind === "follow_up_24h") {
        // Seuls les messages échangés comptent (un brouillon n'a pas été lu par l'acheteur).
        const delivered = msgs.filter((m) => m.status === "sent" || m.status === "received" || m.status === "pending");
        const lastDelivered = delivered[delivered.length - 1];
        const dedupeKey = followUp24hDedupeKey(conv.id);
        const item = conv.itemId ? await repos.items.byId(tx, conv.itemId).catch(() => null) : null;
        const decision = decideFollowUp({
          conversation: { status: conv.status, lastMessageDirection: lastDelivered?.direction ?? null, lastMessageAt: lastDelivered ? lastDelivered.sentAt ?? lastDelivered.createdAt : null },
          plan: { followUp24h: quotas!.followUp24h },
          now,
          alreadyFollowedUp: (await repos.jobs.byDedupe(tx, dedupeKey)) !== null,
          schedule: rule.schedule,
          delayHours: rule.config.delayHours,
          // Article vendu, réservé, retiré ou commandé : jamais « toujours disponible ».
          itemAvailable: conv.itemId ? await itemAvailableTx(tx, item) : undefined,
        });
        if (decision.action === "none") { skip(decision.reason); continue; }
        // Gabarit de la règle, sinon celui de l'organisation ; s'il enfreint la règle des relances (chiffre, « dernier prix »…), texte par défaut.
        const chosen = [rule.config.template?.trim() ? rule.config.template : null, negotiation.messages.followUp].find((t): t is string => typeof t === "string" && followUpTemplateAllowed(t)) ?? DEFAULT_FOLLOW_UP_TEMPLATE;
        const body = fillTemplate(chosen, { prenom, article: item?.title ?? "l'article" }).replace(/\s+/g, " ").trim();
        // Agence : le Cloud envoie si le compte Vinted y est actif ; sinon (ou en Pro), brouillon à valider dans Messages.
        // « Validation avant envoi » réglée sur la règle : brouillon à valider, que le Cloud n'envoie qu'après validation.
        const cloud = decision.action === "cloud" && decideRunsIn({ ruleKind: rule.kind, ruleRunsIn: "server", cloudAccount: conv.connectionId ? cloudByConnection.get(conv.connectionId) : null }) === "cloud";
        const approval = !cloud || rule.requiresApproval;
        targets.push({
          targetId: conv.id, kind: "automation.send_message", connectionId: conv.connectionId, dedupeKey,
          status: approval ? "awaiting_approval" : "queued", runsIn: cloud ? "cloud" : "server", draftBody: approval ? body : undefined,
          payload: {
            conversationId: conv.id, customerId: conv.customerId, body, followUp: true, followUpMode: cloud ? (approval ? "cloud_after_approval" : "cloud") : "draft",
            reason: cloud ? (approval ? "Offre Agence, validation avant envoi : brouillon à valider, envoyé ensuite par Selio Cloud." : decision.reason) : decision.action === "cloud" ? "Offre Agence, Selio Cloud non actif sur ce compte : brouillon à valider dans Messages." : decision.reason,
            ruleName: rule.name,
          },
        });
        continue;
      }
      if (rule.kind === "keyword_situation") {
        if (last.direction !== "inbound") { skip("Aucun nouveau message de l'acheteur"); continue; }
        // Une situation « transmettre au vendeur » (défaut, litige…) l'emporte sur toute autre, même plus
        // spécifique : aucun gabarit ne part, la conversation est transmise (une seule fois par message).
        const escalation = escalationFor(org, last.body);
        const match = escalation ?? situationFor(org, last.body, rule.config.situationId ?? null);
        if (!match) { skip("Aucune situation reconnue"); continue; }
        const item = conv.itemId ? await repos.items.byId(tx, conv.itemId).catch(() => null) : null;
        const template = escalation ? null : situationTemplateReply(match, { prenom, article: item?.title ?? "l'article", prix: item?.listedPriceCents != null ? eur(item.listedPriceCents) : undefined });
        if (escalation || !template) {
          // Transmission au vendeur, ou réponse à rédiger par mon IA perso : AUCUN texte envoyable. La tâche
          // signale la conversation au vendeur ; elle se ferme quand il répond dans Messages.
          targets.push({
            targetId: conv.id, kind: "automation.send_message", connectionId: conv.connectionId, dedupeKey: `keyword_situation:handoff:${last.id}`, status: "awaiting_approval",
            payload: { conversationId: conv.id, customerId: conv.customerId, handoff: true, situationId: match.situation.id, situationName: match.situation.name, matchedKeywords: match.matchedKeywords, decision: escalation ? "escalate" : "reply", responseKind: match.situation.response.kind, note: escalation ? "Situation transmise au vendeur : répondez dans Messages." : "Réponse à rédiger avec mon IA perso dans Messages.", ruleName: rule.name },
          });
          continue;
        }
        targets.push({
          targetId: conv.id, kind: "automation.send_message", connectionId: conv.connectionId, dedupeKey: `keyword_situation:${rule.id}:${last.id}`,
          payload: { conversationId: conv.id, customerId: conv.customerId, body: template, situationId: match.situation.id, situationName: match.situation.name, matchedKeywords: match.matchedKeywords, decision: "reply", responseKind: match.situation.response.kind, ruleName: rule.name },
        });
        continue;
      }
      if (rule.kind === "auto_negotiate") {
        if (last.direction !== "inbound" || !last.offerCents) { skip("Aucune offre à traiter"); continue; }
        // Lot (« les deux pour 40 € ») : plancher de lot, jamais sous la somme des planchers réels ; sinon l'article seul.
        const bundle = await evaluateConversationBundleTx(tx, org, conv, last, { roundsSoFar: conv.negotiationRounds, now });
        let ev: NegotiationResult | BundleNegotiationResult;
        if (bundle) ev = bundle.result;
        else {
          if (!conv.itemId) { skip("Aucune offre à traiter"); continue; }
          const item = await repos.items.byId(tx, conv.itemId);
          ev = evaluateOffer({ item, offerCents: last.offerCents, rules: org.settings.margin, roundsSoFar: conv.negotiationRounds, now });
        }
        // Situation « transmettre au vendeur » (défaut, remboursement…) puis limites de Vinted (prudentes tant que non mesurées).
        // Toute situation de transmission qui correspond compte, même masquée par une situation plus spécifique.
        ev = applySituationOverride(ev, escalationFor(org, last.body));
        // Contre-offres déjà envoyées ET encore en file ou à valider : jamais au-delà de la limite.
        ev = applyLimitsToDecision(ev, limitsContextFor(msgs, limits!, now, await repos.jobs.pendingCounterOffers(tx, conv.id)));
        if (ev.decision === "hold" || ev.decision === "escalate") { skip(`Politique : ${ev.decision}`); continue; }
        const offerCents = bundle ? bundle.signal.offerCents : last.offerCents;
        const body = bundle
          ? bundleMessage(bundle.result, negotiation.messages, { prenom, titles: bundle.items.map((i) => i.title) }) ?? `Bonjour ${prenom}, merci pour votre proposition. Je ne peux pas descendre à ce prix pour le lot, les articles restent disponibles au prix affiché.`
          : autoNegotiateBody(ev, last.offerCents, prenom);
        const settled = ev.decision === "counter" ? ev.counterCents : ev.decision === "accept" ? offerCents : null;
        targets.push({
          targetId: conv.id, kind: "automation.send_message",
          payload: {
            conversationId: conv.id, customerId: conv.customerId, body, offerCents: settled, decision: ev.decision, reasons: ev.reasons, ruleName: rule.name,
            ...(bundle ? { bundle: { itemIds: bundle.items.map((i) => i.id), itemCount: bundle.result.itemCount, listedTotalCents: bundle.result.listedTotalCents, floorCents: bundle.result.floorCents, perItemAllocationCents: bundle.result.perItemAllocationCents } } : {}),
          },
        });
        continue;
      }
      if (rule.kind === "post_sale_message") {
        const orders = conv.itemId ? await repos.orders.forItem(tx, conv.itemId) : [];
        if (!orders.some((o) => o.customerId === conv.customerId && (o.status === "paid" || o.status === "shipped"))) { skip("Pas de vente récente"); continue; }
      }
      targets.push({ targetId: conv.id, kind: "automation.send_message", connectionId: conv.connectionId, payload: { conversationId: conv.id, customerId: conv.customerId, ruleName: rule.name } });
    }
  } else {
    for (const item of (await repos.items.all(tx)).filter((i) => i.status === "listed")) {
      evaluated++;
      if (item.connectionId && personal.has(item.connectionId)) { skip(PERSONAL_ACCOUNT_SKIP); continue; }
      if (daysInStock(item, now) < (rule.config.staleDays ?? 45)) { skip("Article pas encore dormant"); continue; }
      if (rule.kind === "price_drop_stale" && (item.listedPriceCents ?? 0) <= (item.floorPriceCents ?? 0)) { skip("Déjà au prix plancher"); continue; }
      targets.push({ targetId: item.id, kind: "automation.evaluate", payload: { itemId: item.id, ruleName: rule.name } });
    }
  }
  let actions = await repos.jobs.countForRuleSince(tx, rule.id, dayStart.toISOString());
  const lastJob = await tx.maybeOne<{ createdAt: string }>("select created_at from jobs where org_id = $1 and rule_id = $2 and status <> 'cancelled' and created_at >= $3 order by created_at desc limit 1", [ctx.orgId, rule.id, dayStart.toISOString()]);
  let lastActionAt: Date | null = lastJob ? new Date(lastJob.createdAt) : null;
  for (const t of targets) {
    const customerId = typeof t.payload.customerId === "string" ? t.payload.customerId : undefined;
    const perCustomer = customerId ? await repos.jobs.countForRuleSince(tx, rule.id, dayStart.toISOString(), customerId) : undefined;
    const gate = gateRule({ rule, globalPaused: state.globalPaused, now, actionsToday: actions, actionsTodayForCustomer: perCustomer, lastActionAt });
    if (!gate.allowed) { skip(gate.reason); continue; }
    const dedupeKey = t.dedupeKey ?? jobDedupeKey(rule, t.targetId, now);
    if (await repos.jobs.byDedupe(tx, dedupeKey)) { skip(t.dedupeKey ? "Déjà traité (idempotence)" : "Déjà planifié aujourd'hui (idempotence)"); continue; }
    const cloudAccount = t.connectionId ? cloudByConnection.get(t.connectionId) : undefined;
    const runsIn = t.runsIn ?? decideRunsIn({ ruleKind: rule.kind, ruleRunsIn: rule.runsIn, cloudAccount });
    let payload = runsIn === "cloud" && cloudAccount ? { ...t.payload, cloudAccountId: cloudAccount.id, cloudKind: CLOUD_RULE_ACTIONS[rule.kind] } : t.payload;
    if (t.draftBody !== undefined && typeof t.payload.conversationId === "string") {
      const draft = await repos.messages.create(tx, { conversationId: t.payload.conversationId, direction: "outbound", source: "automation", status: "draft", body: t.draftBody.slice(0, 4000), offerCents: null, ruleId: rule.id });
      payload = { ...payload, draftMessageId: draft.id };
    }
    const job = await repos.jobs.create(tx, { kind: t.kind, status: t.status ?? (rule.requiresApproval ? "awaiting_approval" : "queued"), dedupeKey, ruleId: rule.id, payload, runsIn, scheduledFor: nowIso(ctx), createdAt: nowIso(ctx) });
    created++; actions++; lastActionAt = now;
    if (job.status === "queued") await executeJobTx(ctx, tx, job);
  }
  await repos.rules.update(tx, rule.id, { lastRunAt: nowIso(ctx) });
  await repos.audit.add(tx, { actorUserId: ctx.userId, action: "rule.run", targetType: "automation_rule", targetId: rule.id, meta: { evaluated, created }, ip: ctx.ip });
  return { evaluated, created, skipped: [...skipped.entries()].map(([reason, count]) => ({ reason, count })) };
}

export function runRuleNow(ctx: OrgContext, id: string): Promise<RunResult> {
  requireAction(ctx, "automations.write");
  return withOrg(ctx, async (tx) => runRuleTx(ctx, tx, await repos.rules.byId(tx, id)));
}

export function approveJob(ctx: OrgContext, id: string): Promise<Job> {
  requireAction(ctx, "messages.send");
  return withOrg(ctx, async (tx) => {
    const job = await repos.jobs.byId(tx, id);
    if (job.status !== "awaiting_approval") throw new AppError("conflict", "Cette tâche n'attend pas de validation.", 409);
    const done = await executeJobTx(ctx, tx, job);
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "job.approved", targetType: "job", targetId: id, meta: { status: done.status }, ip: ctx.ip });
    return done;
  });
}

export function cancelJob(ctx: OrgContext, id: string): Promise<Job> {
  requireAction(ctx, "messages.send");
  return withOrg(ctx, async (tx) => {
    const job = await repos.jobs.byId(tx, id);
    if (job.status === "succeeded" || job.status === "running") throw new AppError("conflict", "Impossible d'annuler une tâche terminée ou en cours.", 409);
    const j = await repos.jobs.update(tx, id, { status: "cancelled" });
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "job.cancelled", targetType: "job", targetId: id, ip: ctx.ip });
    return j;
  });
}

export function retryJob(ctx: OrgContext, id: string): Promise<Job> {
  requireAction(ctx, "messages.send");
  return withOrg(ctx, async (tx) => {
    const job = await repos.jobs.byId(tx, id);
    if (job.status !== "failed") throw new AppError("conflict", "Seule une tâche en échec peut être relancée.", 409);
    const reset = await repos.jobs.update(tx, id, { attempts: 0 });
    const done = await executeJobTx(ctx, tx, reset);
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "job.retried", targetType: "job", targetId: id, meta: { status: done.status }, ip: ctx.ip });
    return done;
  });
}

/** Traite les tâches serveur échues (worker). */
export function processDueJobs(ctx: OrgContext): Promise<number> {
  return withOrg(ctx, async (tx) => {
    let n = 0;
    for (const job of await repos.jobs.dueQueued(tx)) {
      if (job.runsIn === "cloud") continue;
      if (job.runsIn === "browser" && job.result && (job.result as { awaitingBrowser?: boolean }).awaitingBrowser) continue;
      await executeJobTx(ctx, tx, job);
      n++;
    }
    return n;
  });
}
