import type { AiRequest } from "@selio/contracts";

export type AiRequestLike = Pick<AiRequest, "kind" | "status" | "latencyMs" | "validated" | "rejectionReason" | "createdAt">;

/**
 * État de l'IA sur une période, calculé à l'identique en démonstration et sur le
 * serveur à partir du journal des requêtes. Définitions (affichées telles quelles) :
 * - terminées : réussies + repli + rejetées + échecs (les requêtes en cours ou annulées n'entrent dans aucun taux) ;
 * - réussies : le modèle a répondu et sa sortie a passé les contrôles ;
 * - repli : un gabarit déterministe a remplacé le modèle (IA indisponible ou sortie écartée) ;
 * - rejetées : sortie écartée par les contrôles, sans gabarit ;
 * - échecs : erreur ou délai dépassé.
 */
export interface AiHealthSummary {
  windowDays: number;
  from: string;
  finished: number;
  succeeded: number;
  fallbacks: number;
  rejected: number;
  failed: number;
  timeouts: number;
  inFlight: number;
  cancelled: number;
  /** Sorties produites (réussies + repli + rejetées) et, parmi elles, celles validées par les contrôles. */
  produced: number;
  validated: number;
  /** Réussies / terminées. */
  availabilityRate: number | null;
  /** Validées / produites. */
  validatedRate: number | null;
  /** (Repli + rejetées) / terminées. */
  fallbackRate: number | null;
  /** Échecs / terminées. */
  failureRate: number | null;
  /** Durée des requêtes qui ont abouti à une sortie (réussies, repli, rejetées). */
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  byKind: { kind: AiRequest["kind"]; total: number; succeeded: number }[];
}

export function aiOutcome(r: Pick<AiRequestLike, "status" | "rejectionReason">): "succeeded" | "fallback" | "rejected" | "failed" | "in_flight" | "cancelled" {
  if (r.status === "succeeded") return r.rejectionReason ? "fallback" : "succeeded";
  if (r.status === "rejected") return "rejected";
  if (r.status === "failed" || r.status === "timeout") return "failed";
  if (r.status === "cancelled") return "cancelled";
  return "in_flight";
}

export function summarizeAiRequests(requests: AiRequestLike[], opts: { now: Date; windowDays: number }): AiHealthSummary {
  const from = new Date(opts.now.getTime() - opts.windowDays * 86_400_000).toISOString();
  const inWindow = requests.filter((r) => r.createdAt >= from);
  let succeeded = 0, fallbacks = 0, rejected = 0, failed = 0, timeouts = 0, inFlight = 0, cancelled = 0, validated = 0;
  const latencies: number[] = [];
  const byKind = new Map<AiRequest["kind"], { total: number; succeeded: number }>();
  for (const r of inWindow) {
    const o = aiOutcome(r);
    if (o === "succeeded") succeeded++;
    else if (o === "fallback") fallbacks++;
    else if (o === "rejected") rejected++;
    else if (o === "failed") { failed++; if (r.status === "timeout") timeouts++; }
    else if (o === "cancelled") cancelled++;
    else inFlight++;
    if (o === "succeeded" || o === "fallback" || o === "rejected") {
      if (r.validated) validated++;
      if (r.latencyMs > 0) latencies.push(r.latencyMs);
    }
    if (o !== "cancelled") {
      const k = byKind.get(r.kind) ?? { total: 0, succeeded: 0 };
      k.total++;
      if (o === "succeeded") k.succeeded++;
      byKind.set(r.kind, k);
    }
  }
  const finished = succeeded + fallbacks + rejected + failed;
  const produced = succeeded + fallbacks + rejected;
  const rate = (n: number, d: number) => (d > 0 ? n / d : null);
  latencies.sort((a, b) => a - b);
  return {
    windowDays: opts.windowDays,
    from,
    finished, succeeded, fallbacks, rejected, failed, timeouts, inFlight, cancelled, produced, validated,
    availabilityRate: rate(succeeded, finished),
    validatedRate: rate(validated, produced),
    fallbackRate: rate(fallbacks + rejected, finished),
    failureRate: rate(failed, finished),
    avgLatencyMs: latencies.length ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length) : null,
    p95LatencyMs: latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(0.95 * latencies.length))]! : null,
    byKind: [...byKind.entries()].map(([kind, v]) => ({ kind, ...v })).sort((a, b) => b.total - a.total),
  };
}

/** Quota mensuel effectif : le plus petit entre le plan et le réglage de l'organisation (0 = pas de limite propre). */
export function effectiveAiQuota(planPerMonth: number, orgMonthlyQuota: number): number {
  return Math.min(planPerMonth, orgMonthlyQuota || Number.POSITIVE_INFINITY);
}
