import { z } from "zod";
import { id, isoDate, nonNegCents, rate } from "./common";

export const RULE_KINDS = [
  "reply_on_new_message",
  "follow_up_no_reply",
  "auto_negotiate",
  "post_sale_message",
  "relist_stale",
  "price_drop_stale",
] as const;
export const ruleKind = z.enum(RULE_KINDS);
export type RuleKind = z.infer<typeof ruleKind>;

/** Où s'exécute la règle : serveur (worker) ou navigateur (extension ouverte). */
export const RUN_LOCATIONS = ["server", "browser"] as const;
export const runLocation = z.enum(RUN_LOCATIONS);

export const schedule = z.object({
  /** 0 = dimanche … 6 = samedi */
  days: z.array(z.number().int().min(0).max(6)).min(1).default([1, 2, 3, 4, 5, 6, 0]),
  startHour: z.number().int().min(0).max(23).default(8),
  endHour: z.number().int().min(1).max(24).default(21),
  timezone: z.string().min(1).max(64).default("Europe/Paris"),
});
export type Schedule = z.infer<typeof schedule>;

export const ruleLimits = z.object({
  maxPerDay: z.number().int().min(0).max(1000).default(50),
  maxPerCustomerPerDay: z.number().int().min(0).max(50).default(2),
  minMinutesBetweenActions: z.number().int().min(0).max(1440).default(5),
});

export const ruleConfig = z.object({
  template: z.string().max(2000).optional(),
  delayHours: z.number().int().min(0).max(720).optional(),
  staleDays: z.number().int().min(1).max(365).optional(),
  dropRate: rate.optional(),
  minMarginRate: rate.optional(),
  minMarginCents: nonNegCents.optional(),
  maxDiscountRate: rate.optional(),
  counterStepRate: rate.optional(),
  maxRounds: z.number().int().min(0).max(10).optional(),
  useAi: z.boolean().optional(),
});
export type RuleConfig = z.infer<typeof ruleConfig>;

export const automationRule = z.object({
  id,
  orgId: id,
  name: z.string().trim().min(1).max(120),
  kind: ruleKind,
  enabled: z.boolean().default(false),
  /** Les actions sensibles exigent une validation humaine par défaut. */
  requiresApproval: z.boolean().default(true),
  runsIn: runLocation.default("server"),
  schedule: schedule.default({}),
  limits: ruleLimits.default({}),
  config: ruleConfig.default({}),
  lastRunAt: isoDate.nullable().default(null),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type AutomationRule = z.infer<typeof automationRule>;

export const automationRuleCreate = automationRule.omit({ id: true, orgId: true, createdAt: true, updatedAt: true, lastRunAt: true });
export type AutomationRuleCreate = z.input<typeof automationRuleCreate>;
export const automationRuleUpdate = automationRuleCreate.partial();

export const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled", "skipped", "awaiting_approval"] as const;
export const jobStatus = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof jobStatus>;

export const JOB_KINDS = [
  "automation.evaluate",
  "automation.send_message",
  "connector.sync",
  "ai.generate",
  "radar.scan",
  "purchase.simulate",
  "retention.cleanup",
  "export.csv",
] as const;
export const jobKind = z.enum(JOB_KINDS);
export type JobKind = z.infer<typeof jobKind>;

export const job = z.object({
  id,
  orgId: id,
  kind: jobKind,
  status: jobStatus,
  /** Clé d'idempotence unique par organisation : un même travail n'est jamais dupliqué. */
  dedupeKey: z.string().min(1).max(200),
  ruleId: id.nullable().default(null),
  payload: z.record(z.unknown()).default({}),
  result: z.record(z.unknown()).nullable().default(null),
  error: z.string().max(1000).nullable().default(null),
  attempts: z.number().int().min(0).default(0),
  maxAttempts: z.number().int().min(1).max(10).default(3),
  runsIn: runLocation.default("server"),
  scheduledFor: isoDate,
  startedAt: isoDate.nullable().default(null),
  finishedAt: isoDate.nullable().default(null),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Job = z.infer<typeof job>;

export const jobQuery = z.object({
  status: jobStatus.optional(),
  kind: jobKind.optional(),
  ruleId: id.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type JobQuery = z.infer<typeof jobQuery>;
