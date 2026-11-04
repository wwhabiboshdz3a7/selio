import type { FastifyInstance, FastifyRequest } from "fastify";
import { TRACK_DEMO_NOTICE, TRACK_LEGAL_NOTICE, TRACK_SOURCE_LABELS, TRACK_UNAVAILABLE_MESSAGE, buildUsageCounter, quotasForPlan, type PlanQuotas, type TrackSource, type UsageCounter } from "@selio/contracts";
import { repos, type Tx } from "@selio/db";
import { AppError, requireAction, track, withOrg, type OrgContext } from "@selio/core";

/**
 * Selio Track (prompt §5.9, Pro et Agence) : STATISTIQUES SEULEMENT. L'API ne lit jamais de page Vinted
 * (le worker lit les empreintes dues, simulateur par défaut, pages publiques derrière TRACK_LIVE_ENABLED).
 * Ici : filtres suivis (quotas du plan), tendances, scans de niche, recherche par photo (photo jamais
 * conservée ni journalisée), flux des ventes (Agence), analyse d'un vendeur (409 tant que le réglage est
 * fermé, à valider juridiquement) et compteurs d'utilisation. Sans Track dans l'offre : 402 explicite
 * (« Track est compris à partir de Pro »).
 */

/** Photo réduite par le navigateur : 1,5 Mo au plus une fois décodée, une seule par recherche. */
export const TRACK_PHOTO_MAX_BYTES = 1.5 * 1024 * 1024;
/** Corps d'une recherche par photo : la photo en base64 (≈ 4/3 de sa taille) et les indices. */
const PHOTO_BODY_LIMIT = Math.ceil((TRACK_PHOTO_MAX_BYTES * 4) / 3) + 64 * 1024;

const perUser = (prefix: string, max: number, timeWindow: string) => ({
  rateLimit: { max, timeWindow, keyGenerator: (req: FastifyRequest) => (req.orgCtx ? `${prefix}:${req.orgCtx.userId}` : `${prefix}-ip:${req.ip}`) },
});

async function quotasTx(tx: Tx): Promise<{ plan: string; quotas: PlanQuotas }> {
  const sub = await repos.subscriptions.get(tx);
  return { plan: sub?.plan ?? "free", quotas: sub?.quotas ?? quotasForPlan("free") };
}

/** 402 explicite quand l'offre ne comprend pas Track (gratuit, Starter). */
async function requireTrack(ctx: OrgContext): Promise<PlanQuotas> {
  const { quotas } = await withOrg(ctx, quotasTx);
  if (quotas.trackFiltersFollowed <= 0) throw new AppError("track_unavailable", TRACK_UNAVAILABLE_MESSAGE, 402);
  return quotas;
}

/** Taille décodée d'une photo envoyée en data URL base64 (sans la décoder). */
export function decodedPhotoBytes(dataUrl: string): number {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1).replace(/\s+/g, "");
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

const monthStart = (d: Date, offsetMonths = 0) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offsetMonths, 1));
const monthKey = (d: Date) => d.toISOString().slice(0, 7);

export interface TrackUsage {
  plan: string;
  period: { from: string; to: string };
  counters: { filtersFollowed: UsageCounter; scans: UsageCounter; photoSearches: UsageCounter };
  historyMonths: number;
  /** Mois de l'historique du plan (le plus ancien d'abord), compteurs du mois courant compris. */
  history: { month: string; scans: number; photoSearches: number }[];
  source: TrackSource;
  sourceLabel: string;
  notices: string[];
}

export default async function trackRoutes(app: FastifyInstance, opts: { liveEnabled: boolean }) {
  // ---------------------------------------------------------------- filtres suivis
  // Liste toujours lisible (une organisation revenue à Starter peut retirer ses anciens filtres).
  app.get("/api/track/filters", async (req) => track.listFilters(app.requireCtx(req)));
  // Quota du plan (402 au-delà, 402 sans Track), même critères déjà suivis : 409. Contrôlés par le cœur sous
  // un verrou de l'organisation ; 20 créations ou modifications par minute et par membre.
  app.post("/api/track/filters", { config: perUser("track-filters", 20, "1 minute") }, async (req, reply) => { reply.status(201); return track.createFilter(app.requireCtx(req), req.body ?? {}); });
  app.patch<{ Params: { id: string } }>("/api/track/filters/:id", { config: perUser("track-filters", 20, "1 minute") }, async (req) => {
    const ctx = app.requireCtx(req);
    requireAction(ctx, "radar.write");
    await requireTrack(ctx);
    // Réactivation sous le quota de filtres actifs : contrôlée par le cœur, dans la transaction de la mise à jour.
    return track.updateFilter(ctx, req.params.id, req.body ?? {});
  });
  app.delete<{ Params: { id: string } }>("/api/track/filters/:id", { config: perUser("track-filters", 20, "1 minute") }, async (req, reply) => { await track.deleteFilter(app.requireCtx(req), req.params.id); reply.status(204); });
  // Tendances sur 7, 30 (défaut) ou 90 jours, bornées à l'historique du plan.
  app.get<{ Params: { id: string }; Querystring: { days?: string } }>("/api/track/filters/:id/trends", async (req) => track.trends(app.requireCtx(req), req.params.id, { days: req.query.days }));

  // ---------------------------------------------------------------- scans de niche
  // « Données insuffisantes » : aucune note, aucun prix, rien de décompté du quota du mois (20 par jour au plus).
  app.post("/api/track/scans", { config: perUser("track-scan", 20, "1 minute") }, async (req, reply) => { reply.status(201); return track.nicheScan(app.requireCtx(req), req.body ?? {}); });
  app.get("/api/track/scans", async (req) => {
    const ctx = app.requireCtx(req);
    await requireTrack(ctx);
    return track.listScans(ctx);
  });

  // ---------------------------------------------------------------- recherche par photo
  /**
   * Une photo réduite par le navigateur (data URL JPEG, PNG ou WebP, 1,5 Mo au plus), lue par le modèle 1
   * puis estimée. La photo n'est NI conservée NI journalisée (journaux sans corps de requête) : seules la
   * description et l'estimation sont enregistrées.
   */
  app.post("/api/track/photo-search", { bodyLimit: PHOTO_BODY_LIMIT, config: perUser("track-photo", 10, "1 minute") }, async (req, reply) => {
    const ctx = app.requireCtx(req);
    const body = (req.body ?? {}) as { photo?: unknown; photos?: unknown };
    if (body.photos !== undefined) throw new AppError("validation", "Une seule photo par recherche (champ « photo »).", 400);
    if (typeof body.photo === "string" && decodedPhotoBytes(body.photo) > TRACK_PHOTO_MAX_BYTES) {
      throw new AppError("photo_too_large", "Photo trop lourde : 1,5 Mo au plus une fois réduite.", 413);
    }
    const controller = new AbortController();
    req.raw.on("close", () => { if (req.raw.destroyed) controller.abort(); });
    const res = await track.photoSearch(ctx, body, controller.signal);
    reply.status(201);
    return res;
  });
  app.get("/api/track/photo-search", async (req) => {
    const ctx = app.requireCtx(req);
    await requireTrack(ctx);
    return track.listPhotoSearches(ctx);
  });

  // ---------------------------------------------------------------- Agence
  // Flux des ventes (agrégats par marque et catégorie, sans pseudo) : Agence seulement (402 sinon).
  app.get("/api/track/sales-feed", async (req) => track.salesFeed(app.requireCtx(req)));
  // Analyse d'un vendeur concurrent : 409 tant que TRACK_SELLER_ANALYSIS_ENABLED est faux (RGPD), 501 sinon.
  app.get("/api/track/seller-analysis", async (req) => track.sellerAnalysis(app.requireCtx(req)));
  app.post("/api/track/seller-analysis", async (req) => track.sellerAnalysis(app.requireCtx(req)));

  // ---------------------------------------------------------------- utilisation
  /** Compteurs du mois (mêmes décomptes que les refus du cœur) et historique mensuel dans la limite du plan. */
  app.get("/api/track/usage", async (req): Promise<TrackUsage> => {
    const ctx = app.requireCtx(req);
    requireAction(ctx, "analytics.read");
    const now = app.services.now();
    return withOrg(ctx, async (tx) => {
      const { plan, quotas } = await quotasTx(tx);
      if (quotas.trackFiltersFollowed <= 0) throw new AppError("track_unavailable", TRACK_UNAVAILABLE_MESSAGE, 402);
      const from = monthStart(now).toISOString();
      const months = Math.max(1, Math.min(12, quotas.trackHistoryMonths));
      const since = monthStart(now, -(months - 1));
      const rows = await tx.query<{ month: string; kind: string; total: number | string }>(
        `select to_char(date_trunc('month', created_at at time zone 'UTC'), 'YYYY-MM') as month, kind, sum(quantity) as total
         from usage_events where org_id = $1 and kind in ('track.scan', 'track.photo_search') and created_at >= $2
         group by 1, 2`,
        [ctx.orgId, since.toISOString()],
      );
      const byMonth = new Map<string, { scans: number; photoSearches: number }>();
      for (let i = 0; i < months; i++) byMonth.set(monthKey(monthStart(since, i)), { scans: 0, photoSearches: 0 });
      for (const r of rows) {
        const entry = byMonth.get(String(r.month));
        if (!entry) continue;
        if (r.kind === "track.scan") entry.scans += Number(r.total);
        else entry.photoSearches += Number(r.total);
      }
      const current = byMonth.get(monthKey(monthStart(now))) ?? { scans: 0, photoSearches: 0 };
      const source: TrackSource = opts.liveEnabled ? "cloud" : "demo";
      return {
        plan,
        period: { from, to: now.toISOString() },
        counters: {
          filtersFollowed: buildUsageCounter(await repos.trackFilters.count(tx), quotas.trackFiltersFollowed),
          scans: buildUsageCounter(current.scans, quotas.trackScansPerMonth),
          photoSearches: buildUsageCounter(current.photoSearches, quotas.trackPhotoSearchesPerMonth),
        },
        historyMonths: quotas.trackHistoryMonths,
        history: [...byMonth.entries()].map(([month, v]) => ({ month, ...v })),
        source,
        sourceLabel: TRACK_SOURCE_LABELS[source],
        notices: [TRACK_LEGAL_NOTICE, ...(source === "demo" ? [TRACK_DEMO_NOTICE] : [])],
      };
    });
  });
}
