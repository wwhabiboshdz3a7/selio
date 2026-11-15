import {
  TRACK_ALERT_COOLDOWN_HOURS, TRACK_ALERT_MIN_REFERENCE_SNAPSHOTS, TRACK_ALERT_NOTICE, TRACK_ALERT_REFERENCE_DAYS, TRACK_DEMO_NOTICE, TRACK_UNAVAILABLE_MESSAGE,
  quotasForPlan, radarAlertPayload, trackAlertRules,
  type RadarAlertPayload, type TrackAlertEvent, type TrackAlertRule, type TrackAlertRules, type TrackFilterAlerts, type TrackSnapshot,
} from "@selio/contracts";
import { repos, type Tx } from "@selio/db";
import { AppError, requireAction, withOrg, type OrgContext, type Services } from "../context";
import { alertScheduleFor, formatEur } from "./alerts";

/**
 * Alertes de tendance des filtres Track (statistiques seulement).
 *
 * - Réglage par filtre (`track_filters.alert_rules`), coupé par défaut : prix médian qui s'écarte de ± X %
 *   de la médiane des 7 jours précédents, nouvelles annonces d'une lecture au-dessus d'un seuil, délai
 *   médian des disparues (estimation) qui baisse de X %.
 * - Évaluées par le worker après chaque nouvel instantané d'une empreinte (`runTrackRead`), pour chaque
 *   organisation dont un filtre actif suit cette empreinte et a ses alertes allumées.
 * - Pas de rafale : une alerte par filtre et par règle au plus toutes les 24 h, sous un verrou de
 *   l'organisation. Comparaison toujours entre instantanés de MÊME source (le simulateur ne se compare
 *   jamais à une lecture en direct), au moins 3 instantanés de référence pour une variation.
 * - Envoi : la file des notifications de la PWA (`radar_alerts`, type `track_trend`, tâche « alerts.send »),
 *   heures calmes de l'organisation respectées. Contenu : nom du filtre et agrégats, aucune annonce, aucun
 *   pseudo. Données du simulateur annoncées comme telles.
 */

export interface TrackAlertHit {
  rule: TrackAlertRule;
  /** Variation (ratio) pour le prix et le délai ; nombre d'annonces pour les nouvelles. */
  value: number;
  /** Prix médian de référence (centimes), délai de référence (jours) ou seuil. */
  reference: number;
  message: string;
}

const pct = (ratio: number) => Math.round(Math.abs(ratio) * 100);
const days = (d: number) => `${(Math.round(d * 10) / 10).toFixed(1).replace(".", ",")} j`;

function medianOf(values: readonly number[]): number | null {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Règles déclenchées par le dernier instantané (fonction pure, testée sans base). `previous` : instantanés
 * des 7 jours précédents ; seuls ceux de la même source que `latest` comptent.
 */
export function evaluateTrackAlertRules(raw: unknown, latest: TrackSnapshot, previous: readonly TrackSnapshot[]): TrackAlertHit[] {
  const parsed = trackAlertRules.safeParse(raw ?? {});
  if (!parsed.success || !parsed.data.enabled) return [];
  const rules = parsed.data;
  const from = new Date(latest.readAt).getTime() - TRACK_ALERT_REFERENCE_DAYS * 86_400_000;
  const refs = previous.filter((s) => s.source === latest.source && s.readAt < latest.readAt && new Date(s.readAt).getTime() >= from);
  const hits: TrackAlertHit[] = [];
  if (rules.medianPrice.enabled && latest.medianPriceCents !== null) {
    const prices = refs.map((s) => s.medianPriceCents).filter((v): v is number => v !== null);
    const ref = prices.length >= TRACK_ALERT_MIN_REFERENCE_SNAPSHOTS ? medianOf(prices) : null;
    if (ref !== null && ref > 0) {
      const change = (latest.medianPriceCents - ref) / ref;
      if (pct(change) >= rules.medianPrice.percent) {
        hits.push({ rule: "median_price", value: Math.round(change * 1000) / 1000, reference: Math.round(ref), message: `Prix médian en ${change > 0 ? "hausse" : "baisse"} de ${pct(change)} % : ${formatEur(latest.medianPriceCents)} contre ${formatEur(Math.round(ref))} sur les ${TRACK_ALERT_REFERENCE_DAYS} jours précédents.` });
      }
    }
  }
  if (rules.newListings.enabled && latest.newCount >= rules.newListings.threshold) {
    hits.push({ rule: "new_listings", value: latest.newCount, reference: rules.newListings.threshold, message: `${latest.newCount} nouvelles annonces depuis la lecture précédente (seuil : ${rules.newListings.threshold}).` });
  }
  if (rules.daysToSell.enabled && latest.medianDaysListed !== null) {
    const delays = refs.map((s) => s.medianDaysListed).filter((v): v is number => v !== null);
    const ref = delays.length >= TRACK_ALERT_MIN_REFERENCE_SNAPSHOTS ? medianOf(delays) : null;
    if (ref !== null && ref > 0) {
      const drop = (ref - latest.medianDaysListed) / ref;
      if (drop > 0 && pct(drop) >= rules.daysToSell.percent) {
        hits.push({ rule: "days_to_sell", value: Math.round(-drop * 1000) / 1000, reference: Math.round(ref * 10) / 10, message: `Délai de vente en baisse de ${pct(drop)} % : ${days(latest.medianDaysListed)} contre ${days(ref)} sur les ${TRACK_ALERT_REFERENCE_DAYS} jours précédents (annonces disparues, estimation).` });
      }
    }
  }
  return hits;
}

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

/** Notification d'une alerte de tendance : nom du filtre et agrégats, lien vers la page du filtre. */
export function trackAlertPayload(filter: { id: string; name: string }, hit: Pick<TrackAlertHit, "message">, demo: boolean): RadarAlertPayload {
  return radarAlertPayload.parse({
    title: clip(`Track : ${filter.name.replace(/\s+/g, " ").trim()}`, 200),
    body: clip(`${hit.message}${demo ? " Données de démonstration." : ""}`, 400),
    url: `/track/filtres/${filter.id}`,
  });
}

export interface TrackAlertsSummary {
  /** Filtres évalués (organisations confondues). */
  filters: number;
  /** Alertes enregistrées (listées dans la page du filtre). */
  fired: number;
  /** Notifications mises en file. */
  queued: number;
  /** Alertes écartées : même règle déjà déclenchée depuis moins de 24 h. */
  cooldown: number;
  errors: number;
}

/**
 * Évalue les alertes de tendance après un nouvel instantané de l'empreinte : pour chaque filtre actif qui
 * la suit avec des alertes allumées (toutes organisations), règles du filtre, délai de 24 h par règle,
 * historique et notification. Une erreur sur une organisation n'empêche pas les autres.
 */
export async function evaluateTrackAlerts(services: Services, fingerprint: string, now: Date = services.now()): Promise<TrackAlertsSummary> {
  const summary: TrackAlertsSummary = { filters: 0, fired: 0, queued: 0, cooldown: 0, errors: 0 };
  const targets = await services.db.withGlobal((tx) => repos.trackReads.alertTargets(tx, fingerprint));
  if (targets.length === 0) return summary;
  const since = new Date(now.getTime() - (TRACK_ALERT_REFERENCE_DAYS + 1) * 86_400_000).toISOString();
  const snaps = await services.db.withGlobal((tx) => repos.trackSnapshots.since(tx, fingerprint, since));
  const latest = snaps[snaps.length - 1];
  if (!latest) return summary;
  const previous = snaps.slice(0, -1);
  const cooldownSince = new Date(now.getTime() - TRACK_ALERT_COOLDOWN_HOURS * 3_600_000).toISOString();
  for (const t of targets) {
    try {
      await services.db.withOrg(t.orgId, async (tx) => {
        await repos.usage.lock(tx, "track.alerts");
        const quotas = (await repos.subscriptions.get(tx))?.quotas ?? quotasForPlan("free");
        if (quotas.trackFiltersFollowed <= 0) return;
        const filter = await repos.trackFilters.byId(tx, t.filterId).catch(() => null);
        if (!filter || !filter.enabled || filter.fingerprint !== fingerprint) return;
        summary.filters++;
        const hits = evaluateTrackAlertRules(filter.alertRules, latest, previous);
        if (hits.length === 0) return;
        const org = await repos.orgs.byId(tx, t.orgId);
        for (const hit of hits) {
          if (await repos.trackAlertEvents.lastSince(tx, filter.id, hit.rule, cooldownSince)) {
            summary.cooldown++;
            continue;
          }
          const scheduledFor = alertScheduleFor(now, org.settings.timezone, org.settings.radar?.quietHours);
          const queued = await repos.radarAlerts.enqueue(tx, { kind: "track_trend", dedupeKey: `track:${filter.id}:${hit.rule}:${latest.readAt}`, payload: trackAlertPayload(filter, hit, latest.source === "demo"), scheduledFor: scheduledFor.toISOString() });
          await repos.trackAlertEvents.add(tx, { filterId: filter.id, rule: hit.rule, source: latest.source, value: hit.value, reference: hit.reference, message: hit.message, notified: queued !== null, readAt: latest.readAt, createdAt: now.toISOString() });
          summary.fired++;
          if (queued) summary.queued++;
        }
      });
    } catch {
      summary.errors++;
    }
  }
  return summary;
}

// ---------------------------------------------------------------- réglage par filtre (API)

async function requireTrackTx(tx: Tx): Promise<void> {
  const quotas = (await repos.subscriptions.get(tx))?.quotas ?? quotasForPlan("free");
  if (quotas.trackFiltersFollowed <= 0) throw new AppError("track_unavailable", TRACK_UNAVAILABLE_MESSAGE, 402);
}

function view(filterId: string, rules: TrackAlertRules, events: TrackAlertEvent[]): TrackFilterAlerts {
  const demo = events.some((e) => e.source === "demo");
  return { filterId, rules, events, cooldownHours: TRACK_ALERT_COOLDOWN_HOURS, notices: [TRACK_ALERT_NOTICE, ...(demo ? [TRACK_DEMO_NOTICE] : [])] };
}

/** Réglage et dernières alertes d'un filtre (page du filtre). */
export async function filterAlerts(ctx: OrgContext, filterId: string): Promise<TrackFilterAlerts> {
  requireAction(ctx, "analytics.read");
  return withOrg(ctx, async (tx) => {
    await requireTrackTx(tx);
    const filter = await repos.trackFilters.byId(tx, filterId).catch(() => null);
    if (!filter) throw new AppError("not_found", "Filtre Track introuvable.", 404);
    return view(filter.id, filter.alertRules, await repos.trackAlertEvents.list(tx, filter.id));
  });
}

/** Modifie le réglage des alertes d'un filtre (tout couper : `enabled: false`). */
export async function updateFilterAlerts(ctx: OrgContext, filterId: string, raw: unknown): Promise<TrackFilterAlerts> {
  requireAction(ctx, "radar.write");
  const parsed = trackAlertRules.safeParse(raw ?? {});
  if (!parsed.success) throw new AppError("validation", parsed.error.issues[0]?.message ?? "Réglage des alertes invalide", 400, parsed.error.flatten());
  return withOrg(ctx, async (tx) => {
    await requireTrackTx(tx);
    const existing = await repos.trackFilters.byId(tx, filterId).catch(() => null);
    if (!existing) throw new AppError("not_found", "Filtre Track introuvable.", 404);
    const updated = await repos.trackFilters.setAlertRules(tx, filterId, parsed.data);
    const on = parsed.data.enabled ? (["medianPrice", "newListings", "daysToSell"] as const).filter((k) => parsed.data[k].enabled) : [];
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "track.filter_alerts_updated", targetType: "track_filter", targetId: filterId, meta: { enabled: parsed.data.enabled, rules: on }, ip: ctx.ip });
    return view(updated.id, updated.alertRules, await repos.trackAlertEvents.list(tx, filterId));
  });
}
