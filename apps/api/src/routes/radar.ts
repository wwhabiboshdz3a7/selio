import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Queue } from "bullmq";
import type { Opportunity } from "@selio/contracts";
import { repos } from "@selio/db";
import { AppError, radar, radarAlerts, requireAction, withOrg } from "@selio/core";
import { RADAR_RESUME_JOB } from "../queue";

/**
 * Selio Radar et Radar Auto (préfixes /api/radar et /api/purchases). L'API ne lit jamais de page
 * Vinted et n'ouvre aucun navigateur : les lectures en direct et les achats par le navigateur se font
 * dans le worker (Selio Cloud, compte Achat). Ici : recherches, affaires, « 1 clic », réglages,
 * mesures, état des verrous de Radar Auto, et la reprise d'un achat après la validation 3-D Secure
 * (mise en file pour le worker, qui tient le navigateur ouvert).
 */
export interface RadarRouteOptions {
  /** File « selio-radar » (null sans Redis) : reprise 3-D Secure exécutée par le worker. */
  radarQueue: Pick<Queue, "add"> | null;
}

const perUser = (prefix: string, max: number, timeWindow: string) => ({
  rateLimit: { max, timeWindow, keyGenerator: (req: FastifyRequest) => (req.orgCtx ? `${prefix}:${req.orgCtx.userId}` : `${prefix}-ip:${req.ip}`) },
});

const intParam = (raw: unknown, fallback: number, min: number, max: number) => {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

export default async function radarRoutes(app: FastifyInstance, opts: RadarRouteOptions) {
  // ---------------------------------------------------------------- recherches
  app.get("/api/radar/searches", async (req) => radar.listSearches(app.requireCtx(req)));
  app.post("/api/radar/searches", async (req, reply) => { reply.status(201); return radar.createSearch(app.requireCtx(req), req.body); });
  // Modification : critères, source (simulateur / en direct), priorité (3 au plus), compte Achat lu.
  app.patch<{ Params: { id: string } }>("/api/radar/searches/:id", async (req) => radar.updateSearch(app.requireCtx(req), req.params.id, (req.body ?? {}) as Record<string, unknown>));
  app.delete<{ Params: { id: string } }>("/api/radar/searches/:id", async (req, reply) => { await radar.deleteSearch(app.requireCtx(req), req.params.id); reply.status(204); });
  // Lecture à la demande : simulateur ici ; une recherche en direct répond 503 (lue par le worker seulement).
  app.post<{ Params: { id: string } }>("/api/radar/searches/:id/run", { config: perUser("radar-run", 30, "1 minute") }, async (req) => radar.runSearch(app.requireCtx(req), req.params.id));

  // ---------------------------------------------------------------- affaires
  app.get("/api/radar/opportunities", async (req) => radar.listOpportunities(app.requireCtx(req), req.query as { searchId?: string; status?: string }));
  // Détail pour la page « 1 clic » : coût total, recherche, demande d'achat en cours, lien de l'annonce.
  app.get<{ Params: { id: string } }>("/api/radar/opportunities/:id", async (req) => radar.getOpportunity(app.requireCtx(req), req.params.id));
  app.post<{ Params: { id: string } }>("/api/radar/opportunities/:id/status", async (req) => radar.setOpportunityStatus(app.requireCtx(req), req.params.id, (req.body as { status: Opportunity["status"] }).status));
  // « Je l'ai achetée » : report d'un achat fait par le client sur Vinted ; `paidCents` (facultatif) = prix réellement payé, port compris.
  app.post<{ Params: { id: string } }>("/api/radar/opportunities/:id/buy", async (req) => radar.quickBuy(app.requireCtx(req), req.params.id, { paidCents: (req.body as { paidCents?: unknown } | null)?.paidCents }));

  // ---------------------------------------------------------------- mesures, alertes, réglages, Radar Auto
  // Statistiques honnêtes : « à mesurer » tant qu'aucune lecture en direct n'existe.
  app.get("/api/radar/metrics", async (req) => radar.radarMetrics(app.requireCtx(req), { days: intParam((req.query as { days?: string }).days, 30, 1, 90) }));
  app.get("/api/radar/alerts", async (req) => radarAlerts.listAlerts(app.requireCtx(req), intParam((req.query as { limit?: string }).limit, 50, 1, 200)));
  // Réglages Radar (alertes, heures calmes, plafond de pages) et Radar Auto (verrou serveur, traçabilité).
  app.patch("/api/radar/settings", async (req) => radar.updateRadarSettings(app.requireCtx(req), req.body ?? {}));
  // Verrous de Radar Auto : serveur, adresse partagée, organisation, Cloud, accord (lecture seule).
  app.get("/api/radar/auto/status", async (req) => radar.autoStatus(app.requireCtx(req)));

  // ---------------------------------------------------------------- achats
  app.post("/api/purchases/auto-run", { config: perUser("radar-auto", 10, "1 minute") }, async (req) => radar.runAutoBuy(app.requireCtx(req)));
  app.get("/api/purchases", async (req) => radar.listPurchases(app.requireCtx(req)));
  app.post("/api/purchases", async (req, reply) => { reply.status(201); return radar.createPurchase(app.requireCtx(req), (req.body ?? {}) as { opportunityId?: string; maxPriceCents?: number; budgetCents?: number }); });
  app.post<{ Params: { id: string } }>("/api/purchases/:id/confirm", async (req) => radar.confirmPurchase(app.requireCtx(req), req.params.id, { paidCents: (req.body as { paidCents?: unknown } | null)?.paidCents }));
  app.post<{ Params: { id: string } }>("/api/purchases/:id/cancel", async (req) => radar.cancelPurchase(app.requireCtx(req), req.params.id));

  /**
   * Le client a validé le paiement 3-D Secure dans l'application de sa banque. Le navigateur de l'achat
   * est tenu ouvert par le worker : la reprise (relecture de la confirmation, sans recliquer ni rien
   * saisir) y est mise en file, la réponse est 202 et l'issue se lit sur GET /api/purchases. Délai
   * dépassé : l'achat est abandonné (409, à vérifier dans Vinted).
   */
  app.post<{ Params: { id: string } }>("/api/purchases/:id/resume", { config: perUser("radar-resume", 10, "5 minutes") }, async (req, reply) => {
    const ctx = app.requireCtx(req);
    // Navigateur disponible dans ce processus (tests) : reprise directe.
    if (app.services.radar?.purchaser) return radar.resumePurchase(ctx, req.params.id);
    requireAction(ctx, "purchase.simulate");
    const now = app.services.now();
    const purchase = await withOrg(ctx, (tx) => repos.purchases.byId(tx, req.params.id));
    if (purchase.status !== "awaiting_3ds") throw new AppError("conflict", "Cet achat n'attend pas de validation bancaire.", 409);
    if (purchase.awaiting3dsUntil && new Date(purchase.awaiting3dsUntil).getTime() <= now.getTime()) {
      await radar.expireAwaiting3ds(app.services, ctx.orgId, now);
      throw new AppError("conflict", "Le délai de validation bancaire est dépassé : l'achat a été abandonné. Vérifiez dans Vinted qu'aucune commande n'a été passée.", 409);
    }
    if (!opts.radarQueue) throw new AppError("radar_purchaser_unavailable", "La vérification du paiement s'exécute dans le worker (navigateur de Selio Cloud), injoignable ici (Redis absent).", 503);
    try {
      // Identifiant de job fixe : deux clics rapprochés ne lancent qu'une reprise ; retiré une fois traité
      // (réussi ou non) pour qu'une nouvelle demande reste possible.
      await opts.radarQueue.add(RADAR_RESUME_JOB, { orgId: ctx.orgId, purchaseId: purchase.id, userId: ctx.userId }, { jobId: `radar-resume-${purchase.id}`, attempts: 1, removeOnComplete: true, removeOnFail: true });
    } catch {
      throw new AppError("radar_busy", "La vérification du paiement n'a pas pu être lancée : réessayez dans un instant.", 503);
    }
    reply.status(202);
    return { queued: true, purchase };
  });

  // ---------------------------------------------------------------- opérateurs
  // Lectures, blocages et facteurs de ralentissement par organisation, sans aucune donnée de vendeur.
  app.get("/api/admin/radar", async (req) => radar.adminRadarOverview(app.requireCtx(req), { days: intParam((req.query as { days?: string }).days, 7, 1, 90) }));
}
