import type { Opportunity, PurchaseRequest, PushSubscriptionView, RadarSearch } from "@selio/contracts";
import { hashString } from "@selio/domain";
import type { RadarMetricsView } from "../data/types";
import { searchIntervalSeconds } from "../radar";

/**
 * Selio Radar dans la démonstration : état rangé à côté de l'état partagé (`DemoState` ne le connaît pas),
 * persisté avec lui et créé au premier accès, comme le Cloud (./cloud.ts). Rien ne touche Vinted : la
 * recherche « en direct » est SIMULÉE, ses lectures et ses mesures sont des chiffres fictifs, toujours
 * marqués « démo » ; les abonnements aux notifications sont enregistrés sans rien envoyer.
 */
export interface DemoRadarState {
  version: 1;
  /** Lectures « en direct » fictives par jour (UTC). Jamais présentées comme mesurées. */
  readsPerDay: { day: string; reads: number; blocks: number }[];
  /** Appareils abonnés (démonstration : aucun envoi). */
  pushSubscriptions: PushSubscriptionView[];
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Lectures fictives des 7 derniers jours (du plus ancien à aujourd'hui) et jours avec un blocage. */
const READS = [214, 203, 196, 208, 199, 191, 117] as const;
/** Délais publication → détection fictifs (secondes) des affaires de la recherche « en direct ». */
const DELAYS = [48, 72, 95, 130, 61, 84] as const;

const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Valeurs par défaut des champs ajoutés aux recherches (états de démonstration enregistrés avant Radar en direct). */
export function withSearchDefaults(s: RadarSearch): RadarSearch {
  return {
    ...s,
    source: s.source ?? "demo",
    priority: s.priority ?? false,
    connectionId: s.connectionId ?? null,
    slowdownFactor: s.slowdownFactor ?? 1,
    lastReadAt: s.lastReadAt ?? null,
    lastBlockAt: s.lastBlockAt ?? null,
    pagesRead: s.pagesRead ?? 0,
    blocksCount: s.blocksCount ?? 0,
    consecutiveFailures: s.consecutiveFailures ?? 0,
    suspendedReason: s.suspendedReason ?? null,
  };
}

/**
 * État Radar de départ. La deuxième recherche devient « en direct » (simulée) : historique de lectures
 * fictif sur 7 jours, deux blocages (le dernier il y a 10 h, d'où un rythme ralenti × 2), affaires datées
 * de leur publication. Mute `searches` et `opportunities` en place.
 */
export function seedDemoRadar(searches: RadarSearch[], opportunities: Opportunity[], now: Date): DemoRadarState {
  for (let i = 0; i < searches.length; i++) searches[i] = withSearchDefaults(searches[i]!);
  const t = now.getTime();
  const lastBlock = t - 10 * HOUR;
  const readsPerDay = READS.map((reads, i) => {
    const day = dayKey(t - (READS.length - 1 - i) * DAY);
    const blocks = (i === 3 ? 1 : 0) + (day === dayKey(lastBlock) ? 1 : 0);
    return { day, reads, blocks };
  });
  const live = searches[1] ?? searches[0];
  if (live) {
    Object.assign(live, {
      source: "cloud",
      provider: "vinted",
      slowdownFactor: 2,
      lastBlockAt: new Date(lastBlock).toISOString(),
      lastReadAt: new Date(t - 70_000).toISOString(),
      lastRunAt: new Date(t - 70_000).toISOString(),
      pagesRead: readsPerDay.reduce((s, d) => s + d.reads, 0),
      blocksCount: readsPerDay.reduce((s, d) => s + d.blocks, 0),
    } satisfies Partial<RadarSearch>);
    let k = 0;
    for (const o of opportunities) {
      if (o.searchId !== live.id) continue;
      const detected = new Date(o.observed.seenAt).getTime();
      o.observed = { ...o.observed, externalRef: String(4_100_000_000 + (hashString(o.id) % 90_000_000)), detectedAt: o.observed.seenAt, publishedAt: new Date(detected - DELAYS[k % DELAYS.length]! * 1000).toISOString() };
      k++;
    }
  }
  return { version: 1, readsPerDay, pushSubscriptions: [] };
}

/** Compte une lecture « en direct » simulée dans l'historique fictif. */
export function recordDemoRead(state: DemoRadarState, now: Date): void {
  const day = dayKey(now.getTime());
  const row = state.readsPerDay.find((d) => d.day === day);
  if (row) row.reads++;
  else state.readsPerDay.push({ day, reads: 1, blocks: 0 });
  // Fenêtre bornée (90 jours, comme la rétention des mesures côté serveur).
  if (state.readsPerDay.length > 90) state.readsPerDay.splice(0, state.readsPerDay.length - 90);
}

function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : Math.round((v[mid - 1]! + v[mid]!) / 2);
}

/**
 * Mesures de la démonstration, même forme que `radarMetrics` côté serveur. Sans recherche « en direct »
 * lue sur la période : « à mesurer ». Sinon des chiffres FICTIFS, marqués `demo` ; le délai détection →
 * achat reste « à mesurer » (aucun achat réel n'existe, l'achat réel est désactivé).
 */
export function demoRadarMetrics(input: { searches: RadarSearch[]; opportunities: Opportunity[]; purchases: PurchaseRequest[]; state: DemoRadarState; now: Date; days?: number }): RadarMetricsView {
  const days = Math.min(90, Math.max(1, Math.round(input.days ?? 30)));
  const since = dayKey(input.now.getTime() - (days - 1) * DAY);
  const live = input.searches.filter((s) => s.source === "cloud");
  const searches = live.map((s) => {
    const { factor, intervalSeconds } = searchIntervalSeconds(s, input.now);
    return { id: s.id, name: s.name, factor, intervalSeconds, lastBlockAt: s.lastBlockAt };
  });
  const readsPerDay = live.length ? input.state.readsPerDay.filter((d) => d.day >= since) : [];
  const liveReads = readsPerDay.reduce((s, d) => s + d.reads, 0);
  const blocks = readsPerDay.reduce((s, d) => s + d.blocks, 0);
  if (liveReads === 0) {
    return { days, status: "to_measure", label: "à mesurer", liveReads: 0, blocks: 0, blockRatePer1000: null, medianPublishToDetectSeconds: null, medianDetectToPurchaseSeconds: null, readsPerDay: [], searches };
  }
  const liveIds = new Set(live.map((s) => s.id));
  const delays = input.opportunities
    .filter((o) => liveIds.has(o.searchId) && o.observed.publishedAt && o.observed.detectedAt)
    .map((o) => (new Date(o.observed.detectedAt!).getTime() - new Date(o.observed.publishedAt!).getTime()) / 1000);
  // Achats réels seulement (jamais en démonstration) : détection → achat reste « à mesurer ».
  const realPurchases = input.purchases.filter((p) => p.status === "executed" && p.executedAt);
  const oppById = new Map(input.opportunities.map((o) => [o.id, o]));
  const buy = realPurchases.map((p) => {
    const det = oppById.get(p.opportunityId)?.observed.detectedAt;
    return det ? (new Date(p.executedAt!).getTime() - new Date(det).getTime()) / 1000 : NaN;
  });
  return {
    days, status: "measured", demo: true,
    label: "Démo : chiffres fictifs, aucune page Vinted n'a été lue",
    liveReads, blocks,
    blockRatePer1000: Math.round(((blocks * 1000) / liveReads) * 100) / 100,
    medianPublishToDetectSeconds: median(delays),
    medianDetectToPurchaseSeconds: median(buy),
    readsPerDay,
    searches,
  };
}
