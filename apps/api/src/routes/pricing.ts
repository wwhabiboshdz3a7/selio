import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Queue } from "bullmq";
import { PRICE_MODEL_MIN_REFERENCES } from "@selio/contracts";
import { repos } from "@selio/db";
import { AppError, pricing, requireAction } from "@selio/core";
import { PRICING_TRAIN_JOB } from "../queue";

/**
 * Estimation des prix (§5.10) : service interne exposé à Studio, Manager, Radar, Track et à l'extension.
 * Comparables (ventes de l'organisation et base de références, sans donnée personnelle) et modèle de prix
 * chargé en mémoire (entraîné chaque semaine par le worker). Mon IA perso peut expliquer le prix en mots
 * (`explain: true`), elle ne le choisit jamais. Rien n'est présenté comme mesuré sans mesure : « modèle
 * non entraîné » ou « données de démonstration » tant que la base réelle manque.
 */
export interface PricingRouteOptions {
  /** File « selio-maintenance » (null sans Redis) : entraînement demandé par un opérateur, exécuté par le worker. */
  maintenanceQueue: Pick<Queue, "add"> | null;
  /** Références nécessaires pour entraîner (PRICING_MIN_REFERENCES, jamais sous le seuil des contrats). */
  minReferences?: number;
}

const perUser = (prefix: string, max: number, timeWindow: string) => ({
  rateLimit: { max, timeWindow, keyGenerator: (req: FastifyRequest) => (req.orgCtx ? `${prefix}:${req.orgCtx.userId}` : `${prefix}-ip:${req.ip}`) },
});

export default async function pricingRoutes(app: FastifyInstance, opts: PricingRouteOptions) {
  const minimum = Math.max(PRICE_MODEL_MIN_REFERENCES, Math.round(opts.minReferences ?? PRICE_MODEL_MIN_REFERENCES));
  // Caractéristiques → fourchette P25 / P50 / P75, trois stratégies, délai, méthode, confiance (droit items.read ;
  // l'explication par mon IA perso demande en plus ai.use et compte dans le quota IA).
  app.post("/api/pricing/estimate", { config: perUser("pricing-estimate", 60, "1 minute") }, async (req) => {
    const ctx = app.requireCtx(req);
    const controller = new AbortController();
    req.raw.on("close", () => { if (req.raw.destroyed) controller.abort(); });
    return pricing.estimate(ctx, req.body ?? {}, { signal: controller.signal });
  });

  // État du modèle pour l'interface : « Modèle non entraîné », « Données de démonstration » ou date d'entraînement,
  // mesures seulement si elles viennent d'un test sur de vraies données, et volume de la base. `real` et `demo`
  // comptent les VENTES (prix final connu ou estimé), seules utiles au modèle, face au minimum de 500 ;
  // `bySource` compte toutes les références (annonces en ligne comprises), `estimated` les prix estimés.
  app.get("/api/pricing/model", async (req) => {
    const ctx = app.requireCtx(req);
    const status = await pricing.getModelStatus(ctx);
    const { bySource, sold } = await app.services.db.withGlobal(async (tx) => ({ bySource: await repos.priceReferences.countBySource(tx), sold: await repos.priceReferences.soldBySource(tx) }));
    const real = sold.sold.sale + sold.sold.track + sold.sold.import;
    const estimated = sold.estimated.sale + sold.estimated.track + sold.estimated.import;
    return { ...status, loaded: app.services.pricing?.model?.version ?? null, references: { real, demo: sold.sold.demo, estimated, bySource, minimum } };
  });

  // ---------------------------------------------------------------- opérateurs
  /** Modèles enregistrés (sans le JSON) et base de références par source : opérateurs seulement. */
  app.get("/api/admin/pricing", async (req) => {
    const ctx = app.requireCtx(req);
    if (!ctx.isOperator) throw new AppError("forbidden", "Accès réservé aux opérateurs Selio.", 403);
    return app.services.db.withGlobal(async (tx) => ({
      models: await repos.priceModels.list(tx, 20),
      references: await repos.priceReferences.countBySource(tx),
      loaded: app.services.pricing?.model?.version ?? null,
    }));
  });

  /**
   * Entraînement à la demande : mis en file pour le worker (même tâche que le planning du dimanche, un seul
   * entraînement à la fois). Réponse 202 ; le résultat se lit sur GET /api/pricing/model.
   */
  app.post("/api/admin/pricing/train", { config: perUser("pricing-train", 5, "10 minutes") }, async (req, reply) => {
    const ctx = app.requireCtx(req);
    if (!ctx.isOperator) throw new AppError("forbidden", "Accès réservé aux opérateurs Selio.", 403);
    requireAction(ctx, "org.read");
    if (!opts.maintenanceQueue) throw new AppError("pricing_trainer_unavailable", "L'entraînement s'exécute dans le worker, injoignable ici (Redis absent).", 503);
    try {
      // Identifiant fixe : deux demandes rapprochées ne lancent qu'un entraînement ; retiré une fois traité.
      await opts.maintenanceQueue.add(PRICING_TRAIN_JOB, { requestedBy: ctx.userId }, { jobId: "pricing-train-manual", attempts: 1, removeOnComplete: true, removeOnFail: true });
    } catch {
      throw new AppError("pricing_busy", "L'entraînement n'a pas pu être lancé : réessayez dans un instant.", 503);
    }
    reply.status(202);
    return { queued: true };
  });
}
