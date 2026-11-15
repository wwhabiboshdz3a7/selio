import {
  TRACK_DEMO_NOTICE, TRACK_MAX_SLOWDOWN_FACTOR, TRACK_SOURCE_LABELS, resolveQuotas, isPlan, trackManualPauseInput,
  type TrackAdminOrgUsage, type TrackAdminRead, type TrackAdminStatus, type TrackSource,
} from "@selio/contracts";
import { repos } from "@selio/db";
import { AppError, isTechOperator, requireOperatorCapability, withOrg, type OrgContext } from "../context";
import { usagePeriodStart } from "./billing";
import * as cloud from "./cloud";
import { effectiveSlowdownFactor } from "./radar";
import { trackLiveEnabled } from "./track";

/**
 * Selio Track dans l'administration (/admin/track, routes /api/admin/track/*).
 *
 * - Lecture pour tout opérateur Selio : source active et interrupteur, pauses (manuelle, après un signal
 *   de Vinted, coupe-circuit de la machine), ralentissement, dernières lectures et problèmes récents
 *   (journal partagé de 7 jours, empreintes abrégées), utilisation de Track par client face aux quotas.
 * - Pause et reprise manuelles réservées au rôle d'opérateur « tech » ; écrites dans `track_runtime`,
 *   relues par le worker à chaque lecture (aucun redémarrage) ; auditées `admin.track_paused` /
 *   `admin.track_resumed`. La pause manuelle n'ouvre jamais rien : elle ne fait qu'arrêter les lectures.
 * - Aucune donnée de personne : ni critère de filtre, ni nom de filtre, ni annonce.
 */

/** Lecture : tout opérateur (droit `admin.track.read`, « tech » et « business »). */
function requireOperatorRead(ctx: OrgContext): void {
  requireOperatorCapability(ctx, "admin.track.read");
}

/** Pause et reprise : opérateur technique seulement. */
function requireTech(ctx: OrgContext): void {
  requireOperatorRead(ctx);
  if (!isTechOperator(ctx)) throw new AppError("forbidden", "Mettre Track en pause ou le reprendre est réservé au rôle d'opérateur « tech ».", 403);
}

const shortFp = (fp: string) => fp.slice(0, 12);
const toRead = (r: repos.TrackLoggedRead): TrackAdminRead => ({ fingerprint: shortFp(r.fingerprint), readAt: r.readAt, source: r.source, outcome: r.outcome, listed: r.listed, newCount: r.newCount, goneCount: r.goneCount, factor: r.factor, message: r.message });

/** État de Track pour l'administration. */
export async function adminTrackStatus(ctx: OrgContext): Promise<TrackAdminStatus> {
  requireOperatorRead(ctx);
  const services = ctx.services;
  const now = services.now();
  const live = trackLiveEnabled(services);
  const source: TrackSource = live ? "cloud" : "demo";
  const data = await services.db.withGlobal(async (tx) => ({
    runtime: await repos.trackReads.runtime(tx),
    manual: await repos.trackReads.manualPause(tx),
    counts: await repos.trackReads.adminCounts(tx, now.toISOString()),
    reads: await repos.trackReads.adminReads(tx, 20, false),
    problems: await repos.trackReads.adminReads(tx, 20, true),
    usage: await repos.trackReads.adminOrgUsage(tx, usagePeriodStart(now)),
  }));
  const machine = await cloud.machinePausedUntil(services, now);
  const { runtime, manual, counts } = data;
  const factor = Math.min(TRACK_MAX_SLOWDOWN_FACTOR, effectiveSlowdownFactor({ slowdownFactor: runtime.slowdownFactor, lastBlockAt: runtime.lastBlockAt }, now));
  const signalActive = !!runtime.pausedUntil && new Date(runtime.pausedUntil).getTime() > now.getTime();
  const usage: TrackAdminOrgUsage[] = data.usage
    .map((u) => {
      const q = resolveQuotas(isPlan(u.plan) ? u.plan : "free", u.quotas);
      return {
        orgId: u.orgId, name: u.name, plan: u.plan,
        filters: { used: u.filters, quota: q.trackFiltersFollowed, enabled: u.enabledFilters },
        scans: { used: u.scans, quota: q.trackScansPerMonth },
        photoSearches: { used: u.photoSearches, quota: q.trackPhotoSearchesPerMonth },
        alertFilters: u.alertFilters,
      };
    })
    // Clients avec Track ou qui en ont encore des traces, les plus proches de leur limite d'abord.
    .filter((u) => u.filters.quota > 0 || u.filters.used > 0 || u.scans.used > 0 || u.photoSearches.used > 0)
    .sort((a, b) => ratio(b) - ratio(a) || a.name.localeCompare(b.name, "fr"));
  const notices = [
    live
      ? "Interrupteur ouvert côté API (TRACK_LIVE_ENABLED=true) : le worker lit les pages publiques seulement s'il a lui aussi l'interrupteur ouvert et Selio Cloud actif (voir le journal de démarrage du worker)."
      : "Interrupteur fermé (TRACK_LIVE_ENABLED=false) : le worker utilise le simulateur. Aucune page de Vinted n'est lue.",
    ...(live ? [] : [TRACK_DEMO_NOTICE]),
  ];
  return {
    source, sourceLabel: TRACK_SOURCE_LABELS[source], liveEnabled: live,
    manualPause: manual,
    signalPause: { until: runtime.pausedUntil, reason: runtime.pauseReason, active: signalActive },
    machinePausedUntil: machine?.until ?? null,
    slowdown: { factor, storedFactor: runtime.slowdownFactor, lastBlockAt: runtime.lastBlockAt, windowReads: runtime.windowReads, windowBlocks: runtime.windowBlocks, blocksPer1000: runtime.windowReads > 0 ? Math.round((runtime.windowBlocks / runtime.windowReads) * 10_000) / 10 : null },
    fingerprints: { followed: counts.followed, due: counts.due, slowed: counts.slowed },
    last24h: { reads: counts.reads24h, ok: counts.ok24h, anomalies: counts.anomalies24h, blocked: counts.blocked24h, skipped: Math.max(0, counts.reads24h - counts.ok24h - counts.anomalies24h - counts.blocked24h) },
    recentReads: data.reads.map(toRead),
    recentProblems: data.problems.map(toRead),
    usage,
    canControl: isTechOperator(ctx),
    notices,
  };
}

const ratio = (u: TrackAdminOrgUsage) => Math.max(u.filters.quota ? u.filters.used / u.filters.quota : 0, u.scans.quota ? u.scans.used / u.scans.quota : 0, u.photoSearches.quota ? u.photoSearches.used / u.photoSearches.quota : 0);

/** Met Track en pause (toutes sources) : le worker n'en lit plus aucune empreinte jusqu'à la reprise. */
export async function adminTrackPause(ctx: OrgContext, raw: unknown): Promise<TrackAdminStatus> {
  requireTech(ctx);
  const parsed = trackManualPauseInput.safeParse(raw ?? {});
  if (!parsed.success) throw new AppError("validation", parsed.error.issues[0]?.message ?? "Raison de la pause invalide", 400);
  const before = await ctx.services.db.withGlobal((tx) => repos.trackReads.manualPause(tx));
  await ctx.services.db.withGlobal((tx) => repos.trackReads.setManualPause(tx, { paused: true, by: ctx.userId, reason: parsed.data.reason }));
  await withOrg(ctx, (tx) => repos.audit.add(tx, { actorUserId: ctx.userId, action: "admin.track_paused", targetType: "track", targetId: "runtime", meta: { reason: parsed.data.reason, alreadyPaused: before.paused }, ip: ctx.ip }));
  return adminTrackStatus(ctx);
}

/** Reprend Track après une pause manuelle (une pause après un signal de Vinted reste en place jusqu'à son terme). */
export async function adminTrackResume(ctx: OrgContext): Promise<TrackAdminStatus> {
  requireTech(ctx);
  const before = await ctx.services.db.withGlobal((tx) => repos.trackReads.manualPause(tx));
  await ctx.services.db.withGlobal((tx) => repos.trackReads.setManualPause(tx, { paused: false, by: null, reason: null }));
  await withOrg(ctx, (tx) => repos.audit.add(tx, { actorUserId: ctx.userId, action: "admin.track_resumed", targetType: "track", targetId: "runtime", meta: { wasPaused: before.paused, pausedSince: before.since }, ip: ctx.ip }));
  return adminTrackStatus(ctx);
}
