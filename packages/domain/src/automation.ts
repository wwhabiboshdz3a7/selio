import type { AutomationRule, Job, RuleKind } from "@selio/contracts";
import { isWithinSchedule, localDayKey } from "./time";

/** Où une règle peut tourner : certaines exigent un navigateur ouvert (session Vinted de l'utilisateur). */
export const RULE_RUN_LOCATION: Record<RuleKind, { location: "server" | "browser"; explanation: string }> = {
  reply_on_new_message: { location: "browser", explanation: "La lecture et l'envoi de messages Vinted passent par l'extension, donc par un navigateur ouvert." },
  follow_up_no_reply: { location: "browser", explanation: "L'envoi d'une relance nécessite l'extension ouverte sur Vinted." },
  auto_negotiate: { location: "browser", explanation: "La décision est calculée côté serveur, l'envoi exige l'extension ouverte." },
  post_sale_message: { location: "browser", explanation: "Message envoyé via l'extension après confirmation de vente." },
  relist_stale: { location: "browser", explanation: "La remise en avant se fait dans l'interface Vinted via l'extension." },
  price_drop_stale: { location: "server", explanation: "La baisse de prix dans Selio est calculée sur le serveur ; la répercussion sur Vinted exige l'extension." },
};

export type RuleGate =
  | { allowed: true }
  | { allowed: false; reason: "disabled" | "global_pause" | "outside_schedule" | "daily_limit" | "customer_limit" | "too_soon" };

export interface RuleGateContext {
  rule: AutomationRule;
  globalPaused: boolean;
  now: Date;
  actionsToday: number;
  actionsTodayForCustomer?: number;
  lastActionAt?: Date | null;
}

/** Vérifie si une règle a le droit de déclencher une action maintenant. */
export function gateRule(ctx: RuleGateContext): RuleGate {
  const { rule, now } = ctx;
  if (ctx.globalPaused) return { allowed: false, reason: "global_pause" };
  if (!rule.enabled) return { allowed: false, reason: "disabled" };
  if (!isWithinSchedule(rule.schedule, now)) return { allowed: false, reason: "outside_schedule" };
  if (ctx.actionsToday >= rule.limits.maxPerDay) return { allowed: false, reason: "daily_limit" };
  if (typeof ctx.actionsTodayForCustomer === "number" && ctx.actionsTodayForCustomer >= rule.limits.maxPerCustomerPerDay)
    return { allowed: false, reason: "customer_limit" };
  if (ctx.lastActionAt && rule.limits.minMinutesBetweenActions > 0) {
    const elapsedMin = (now.getTime() - ctx.lastActionAt.getTime()) / 60_000;
    if (elapsedMin < rule.limits.minMinutesBetweenActions) return { allowed: false, reason: "too_soon" };
  }
  return { allowed: true };
}

export const RULE_GATE_LABELS: Record<Exclude<RuleGate, { allowed: true }>["reason"], string> = {
  disabled: "Règle en pause",
  global_pause: "Arrêt global des automatisations",
  outside_schedule: "Hors plage horaire",
  daily_limit: "Limite journalière atteinte",
  customer_limit: "Limite par acheteur atteinte",
  too_soon: "Délai minimal entre deux actions non écoulé",
};

/** Clé d'idempotence d'un job : règle + cible + jour local. Un même job n'est jamais créé deux fois. */
export function jobDedupeKey(rule: Pick<AutomationRule, "id" | "kind" | "schedule">, targetId: string, now: Date, suffix = ""): string {
  const day = localDayKey(now, rule.schedule.timezone);
  return `${rule.kind}:${rule.id}:${targetId}:${day}${suffix ? ":" + suffix : ""}`;
}

/** Délai de nouvelle tentative : exponentiel borné (1 min, 2 min, 4 min… ≤ 30 min). */
export function retryDelayMs(attempt: number): number {
  return Math.min(30 * 60_000, 60_000 * 2 ** Math.max(0, attempt - 1));
}

export function shouldRetry(job: Pick<Job, "attempts" | "maxAttempts">): boolean {
  return job.attempts < job.maxAttempts;
}

/** Remplit un gabarit `{{variable}}` avec échappement : jamais de HTML, texte brut uniquement. */
export function renderTemplate(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key];
    return v === null || v === undefined ? "" : String(v);
  });
}
