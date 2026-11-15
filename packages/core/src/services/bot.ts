import { CLOUD_ACTIVE_HOURS_DEFAULT, PURCHASE_STATUS_LABELS, RULE_KIND_LABELS, quotasForPlan, type BotAction, type BotId, type BotSummary, type JobStatus, type PurchaseStatus, type RuleKind } from "@selio/contracts";
import { botActionStatus, botForRuleKind, can, describeBots } from "@selio/domain";
import { repos, type Tx } from "@selio/db";
import { requireAction, withOrg, type OrgContext } from "../context";
import { recordActivityTx } from "./activity";
import * as automation from "./automation";
import * as cloud from "./cloud";
import * as radar from "./radar";

/**
 * Selio Bot : synthèse des automatisations qui agissent pour le revendeur, et coupe-circuit de
 * l'organisation (« Tout arrêter »). Aucune logique d'action ici : l'état de chaque bot est lu dans les
 * règles, les réglages, la disponibilité de Selio Cloud et les verrous de Radar Auto ; les dernières
 * actions dans les journaux existants (tâches, demandes d'achat). Le coupe-circuit est l'arrêt global
 * des automatisations (`automation_state`), déjà relu par le planificateur des règles, le planificateur
 * Cloud (sous verrou, avant chaque action), la lecture en direct de Radar, Radar Auto, la file des tâches
 * serveur et la file de l'extension.
 */

export interface BotSummaryOptions {
  /** Cloud ouvert sur ce serveur (CLOUD_ENABLED et Redis) ; null si inconnu. */
  cloudServerEnabled?: boolean | null;
  /** Heures actives du Cloud (CLOUD_ACTIVE_HOURS). */
  cloudActiveHours?: { startHour: number; endHour: number };
}

const RECENT_PER_BOT = 5;

/** Dernières tâches des règles regroupées par les bots (journal des automatisations). */
async function recentJobsTx(tx: Tx): Promise<Partial<Record<BotId, BotAction[]>>> {
  const rows = await tx.query<{ kind: RuleKind; status: JobStatus; ruleName: string | null; createdAt: string; finishedAt: string | null; runsIn: string }>(
    `select r.kind, j.status, j.payload->>'ruleName' as rule_name, j.created_at, j.finished_at, j.runs_in
       from jobs j join automation_rules r on r.id = j.rule_id and r.org_id = j.org_id
      where j.org_id = $1 order by coalesce(j.finished_at, j.created_at) desc limit 200`,
    [tx.orgId],
  );
  const out: Partial<Record<BotId, BotAction[]>> = {};
  for (const r of rows) {
    const bot = botForRuleKind(r.kind);
    if (!bot) continue;
    const list = (out[bot] ??= []);
    if (list.length >= RECENT_PER_BOT) continue;
    const where = r.runsIn === "cloud" ? " · Selio Cloud" : r.runsIn === "browser" ? " · extension" : "";
    list.push({ at: r.finishedAt ?? r.createdAt, label: `${r.ruleName ?? RULE_KIND_LABELS[r.kind]}${where}`, status: botActionStatus(r.status), source: r.runsIn === "cloud" ? "cloud" : "job" });
  }
  return out;
}

function purchaseActionStatus(status: PurchaseStatus): BotAction["status"] {
  if (status === "executed" || status === "simulated") return "done";
  if (status === "blocked") return "failed";
  if (status === "cancelled") return "skipped";
  return "pending";
}

/** Synthèse de Selio Bot pour l'organisation (tous les rôles qui lisent les automatisations). */
export async function summary(ctx: OrgContext, opts: BotSummaryOptions = {}): Promise<BotSummary> {
  requireAction(ctx, "automations.read");
  const state = await automation.getState(ctx);
  const auto = await radar.autoStatus(ctx);
  const activeHours = opts.cloudActiveHours ?? { startHour: CLOUD_ACTIVE_HOURS_DEFAULT.startHour, endHour: CLOUD_ACTIVE_HOURS_DEFAULT.endHour };
  return withOrg(ctx, async (tx) => {
    const sub = await repos.subscriptions.get(tx);
    const plan = sub?.plan ?? "free";
    const quotas = sub?.quotas ?? quotasForPlan("free");
    const availability = cloud.cloudAvailabilityFor(plan, quotas, cloud.cloudSettings(ctx.services));
    const accounts = await repos.cloudAccounts.list(tx);
    const activeAccounts = accounts.filter((a) => a.status === "active" && a.hasSession).length;
    const consent = await cloud.hasValidConsent(tx);
    const serverEnabled = opts.cloudServerEnabled ?? null;
    const cloudView: BotSummary["cloud"] = {
      available: availability.available, serverEnabled, reason: availability.reason, activeAccounts, accounts: accounts.length, consent,
      ready: availability.available && serverEnabled !== false && consent && activeAccounts > 0, activeHours,
    };
    const recent = await recentJobsTx(tx);
    const autoPurchases = (await repos.purchases.list(tx)).filter((p) => p.mode === "auto").slice(0, RECENT_PER_BOT);
    recent.auto_buy = autoPurchases.map((p) => ({ at: p.executedAt ?? p.createdAt, label: `${p.opportunity?.title ?? "Affaire"} · ${PURCHASE_STATUS_LABELS[p.status]}`, status: purchaseActionStatus(p.status), source: "purchase" }));
    const autoBuy: BotSummary["autoBuy"] = {
      serverEnabled: auto.locks.find((l) => l.key === "server")?.ok === true && auto.locks.find((l) => l.key === "shared_address")?.ok === true,
      realPurchase: auto.realPurchase, orgEnabled: auto.settings.enabled, active: auto.active,
      threshold: auto.settings.threshold, dailyCapCents: auto.settings.dailyCapCents, maxItemCents: auto.settings.maxItemCents,
      reasons: auto.reasons, notice: auto.notice,
    };
    const rules = await repos.rules.list(tx);
    return {
      stopped: state.globalPaused,
      stoppedAt: state.pausedAt,
      canManage: can(ctx.role, "automations.write"),
      plan,
      actionsToday: state.actionsToday,
      actionsPerDay: quotas.automationActionsPerDay,
      cloud: cloudView,
      autoBuy,
      bots: describeBots({ rules, plan, quotas, cloud: cloudView, stopped: state.globalPaused, autoBuy, recent }),
    };
  });
}

/**
 * « Tout arrêter » : coupe-circuit de l'organisation (titulaire et administrateur). Plus aucune action
 * automatique (règles, Selio Cloud, lecture en direct, Radar Auto, file serveur, file de l'extension)
 * jusqu'à la reprise. Les tâches en file attendent ; une action déjà commencée se termine proprement.
 */
export async function stopAll(ctx: OrgContext, opts: BotSummaryOptions = {}): Promise<BotSummary> {
  requireAction(ctx, "automations.write");
  await withOrg(ctx, async (tx) => {
    const before = await repos.automationState.get(tx);
    await repos.automationState.set(tx, true);
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "bot.stopped", targetType: "organization", targetId: ctx.orgId, meta: { alreadyStopped: before.globalPaused }, ip: ctx.ip });
    // Journal d'activité de Selio Manager : « Marie a tout arrêté dans Selio Bot ».
    await recordActivityTx(tx, { verb: "bot.action", actor: "member", actorUserId: ctx.userId, summary: "a tout arrêté dans Selio Bot (coupe-circuit de l'organisation)" });
  });
  return summary(ctx, opts);
}

/** Reprise après « Tout arrêter » (titulaire et administrateur) : chaque bot retrouve son propre réglage. */
export async function resumeAll(ctx: OrgContext, opts: BotSummaryOptions = {}): Promise<BotSummary> {
  requireAction(ctx, "automations.write");
  await withOrg(ctx, async (tx) => {
    const before = await repos.automationState.get(tx);
    await repos.automationState.set(tx, false);
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "bot.resumed", targetType: "organization", targetId: ctx.orgId, meta: { wasStopped: before.globalPaused }, ip: ctx.ip });
    await recordActivityTx(tx, { verb: "bot.action", actor: "member", actorUserId: ctx.userId, summary: "a repris les bots de Selio Bot" });
  });
  return summary(ctx, opts);
}

/** Coupe-circuit de l'organisation lu dans une transaction (worker, file de l'extension). */
export async function isStoppedTx(tx: Tx): Promise<boolean> {
  return (await repos.automationState.get(tx)).globalPaused;
}
