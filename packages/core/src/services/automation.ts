import { automationRuleCreate, jobQuery, type AutomationRule, type Job } from "@selio/contracts";
import { repos, type Tx } from "@selio/db";
import { daysInStock, evaluateOffer, gateRule, jobDedupeKey, localDayKey, renderTemplate, retryDelayMs } from "@selio/domain";
import { AppError, nowIso, requireAction, withOrg, type OrgContext } from "../context";
import type { AutomationState } from "../types-data";
import { sendMessageTx } from "./messaging";
import { updateItemTx } from "./items";

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
    const org = await ctx.services.db.withGlobal((g) => repos.orgs.byId(g, ctx.orgId));
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

/** Exécute une tâche (serveur). Les tâches « navigateur » ne sont exécutables que par l'extension. */
export async function executeJobTx(ctx: OrgContext, tx: Tx, job: Job): Promise<Job> {
  if (job.runsIn === "browser") {
    // En mode connecté, une action navigateur est remise à l'extension : on la marque en file pour elle.
    const conv = typeof job.payload.conversationId === "string" ? await repos.conversations.byId(tx, job.payload.conversationId).catch(() => null) : null;
    const connection = conv?.connectionId ? await repos.connections.byId(tx, conv.connectionId).catch(() => null) : null;
    if (connection?.provider !== "demo") {
      return repos.jobs.update(tx, job.id, { status: "queued", scheduledFor: nowIso(ctx), result: { awaitingBrowser: true, note: "À exécuter par l'extension (navigateur ouvert requis)." } });
    }
  }
  const rule = job.ruleId ? await repos.rules.byId(tx, job.ruleId).catch(() => null) : null;
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
      const draft = await repos.messages.create(tx, { conversationId, direction: "outbound", source: "automation", status: "draft", body, offerCents: typeof job.payload.offerCents === "number" ? job.payload.offerCents : null, ruleId: rule.id });
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

export interface RunResult { evaluated: number; created: number; skipped: { reason: string; count: number }[] }

export async function runRuleTx(ctx: OrgContext, tx: Tx, rule: AutomationRule): Promise<RunResult> {
  const now = ctx.services.now();
  const org = await ctx.services.db.withGlobal((g) => repos.orgs.byId(g, ctx.orgId));
  const state = await repos.automationState.get(tx);
  const skipped = new Map<string, number>();
  const skip = (r: string) => skipped.set(r, (skipped.get(r) ?? 0) + 1);
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  let evaluated = 0, created = 0;
  const targets: { targetId: string; payload: Record<string, unknown>; kind: Job["kind"] }[] = [];
  if (["reply_on_new_message", "follow_up_no_reply", "auto_negotiate", "post_sale_message"].includes(rule.kind)) {
    for (const conv of await repos.conversations.open(tx)) {
      evaluated++;
      const msgs = await repos.messages.forConversation(tx, conv.id);
      const last = msgs[msgs.length - 1];
      if (!last) continue;
      if (rule.kind === "reply_on_new_message" && !(last.direction === "inbound" && conv.unreadCount > 0)) { skip("Pas de nouveau message non lu"); continue; }
      if (rule.kind === "follow_up_no_reply" && !(last.direction === "outbound" && (now.getTime() - new Date(last.createdAt).getTime()) / 3_600_000 >= (rule.config.delayHours ?? 48))) { skip("Délai de relance non atteint"); continue; }
      if (rule.kind === "auto_negotiate") {
        if (last.direction !== "inbound" || !last.offerCents || !conv.itemId) { skip("Aucune offre à traiter"); continue; }
        const item = await repos.items.byId(tx, conv.itemId);
        const ev = evaluateOffer({ item, offerCents: last.offerCents, rules: org.settings.margin, roundsSoFar: conv.negotiationRounds, now });
        if (ev.decision === "hold" || ev.decision === "escalate") { skip(`Politique : ${ev.decision}`); continue; }
        const customer = await repos.customers.byId(tx, conv.customerId);
        const fmt = (c: number) => (c / 100).toFixed(2).replace(".", ",") + " €";
        const first = customer.displayName.split(" ")[0];
        const body = ev.decision === "accept" ? `Bonjour ${first}, c'est d'accord pour ${fmt(last.offerCents)}. Faites l'offre sur l'annonce et je l'accepte.` : ev.decision === "counter" ? `Bonjour ${first}, merci pour votre proposition. Je peux descendre à ${fmt(ev.counterCents!)}, c'est mon meilleur prix pour ${item.title}.` : `Bonjour ${first}, merci pour l'intérêt. Je ne peux pas descendre à ce prix, l'article reste disponible au prix affiché.`;
        targets.push({ targetId: conv.id, kind: "automation.send_message", payload: { conversationId: conv.id, customerId: conv.customerId, body, offerCents: ev.decision === "counter" ? ev.counterCents : ev.decision === "accept" ? last.offerCents : null, decision: ev.decision, reasons: ev.reasons, ruleName: rule.name } });
        continue;
      }
      if (rule.kind === "post_sale_message") {
        const orders = conv.itemId ? await repos.orders.forItem(tx, conv.itemId) : [];
        if (!orders.some((o) => o.customerId === conv.customerId && (o.status === "paid" || o.status === "shipped"))) { skip("Pas de vente récente"); continue; }
      }
      targets.push({ targetId: conv.id, kind: "automation.send_message", payload: { conversationId: conv.id, customerId: conv.customerId, ruleName: rule.name } });
    }
  } else {
    for (const item of (await repos.items.all(tx)).filter((i) => i.status === "listed")) {
      evaluated++;
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
    const dedupeKey = jobDedupeKey(rule, t.targetId, now);
    if (await repos.jobs.byDedupe(tx, dedupeKey)) { skip("Déjà planifié aujourd'hui (idempotence)"); continue; }
    const job = await repos.jobs.create(tx, { kind: t.kind, status: rule.requiresApproval ? "awaiting_approval" : "queued", dedupeKey, ruleId: rule.id, payload: t.payload, runsIn: rule.runsIn, scheduledFor: nowIso(ctx) });
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
      if (job.runsIn === "browser" && job.result && (job.result as { awaitingBrowser?: boolean }).awaitingBrowser) continue;
      await executeJobTx(ctx, tx, job);
      n++;
    }
    return n;
  });
}
