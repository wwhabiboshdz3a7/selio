import type { FastifyInstance, FastifyRequest } from "fastify";
import { promoCodeInput } from "@selio/contracts";
import { AppError, offers } from "@selio/core";
import { requireFinances } from "../plugins/roles";

/**
 * Offres commerciales (promotions sur Starter, Pro et Agence, gérées par l'équipe Selio).
 *
 * - `GET /api/offers/banner` : bandeau public, SANS session (vitrine et application) ; nom, texte, code, remise,
 *   forfaits, durée et fin seulement. Mis en cache 60 s ; limitation de débit globale (par adresse IP).
 * - `POST /api/offers/check` : vérification d'un code (session requise, rien n'est écrit), limitée par personne.
 * - `GET /api/billing/offer` et `POST /api/billing/offer` : offre appliquée à l'organisation, « Ajouter un code
 *   promo » (finances ; l'application est réservée au titulaire par le service).
 * - `/api/admin/offers` : liste, création, modification (activer, désactiver, bandeau), suppression (réelle si
 *   jamais utilisée, sinon archivage). Opérateurs « tech » et « business » (droit « admin.offers »).
 */

const perUser = (prefix: string, max: number, timeWindow: string) => ({
  rateLimit: { max, timeWindow, keyGenerator: (req: FastifyRequest) => (req.orgCtx ? `${prefix}:${req.orgCtx.userId}` : `${prefix}-ip:${req.ip}`) },
});

/** Durée de cache du bandeau public (secondes) : une offre activée apparaît en une minute au plus. */
export const OFFER_BANNER_MAX_AGE_SECONDS = 60;

export default async function offerRoutes(app: FastifyInstance) {
  app.get("/api/offers/banner", async (_req, reply) => {
    reply.header("cache-control", `public, max-age=${OFFER_BANNER_MAX_AGE_SECONDS}`);
    return { offers: await offers.publicBanners(app.services) };
  });

  app.post("/api/offers/check", { config: perUser("offers-check", 20, "10 minutes") }, async (req) => {
    app.requireCtx(req);
    const body = promoCodeInput.parse(req.body ?? {});
    return offers.checkCode(app.services, body.code, { plan: body.plan ?? null, cycle: body.cycle });
  });

  app.get("/api/billing/offer", async (req) => {
    const ctx = app.requireCtx(req);
    requireFinances(ctx);
    return { redemption: await offers.getOrgOffer(ctx) };
  });

  app.post("/api/billing/offer", { config: perUser("offers-apply", 10, "10 minutes") }, async (req) => {
    const ctx = app.requireCtx(req);
    requireFinances(ctx);
    const body = promoCodeInput.parse(req.body ?? {});
    const r = await offers.applyCodeForOrg(ctx, body.code, { plan: body.plan ?? null });
    if (!r.applied) throw new AppError(r.reason === "already_applied" ? "conflict" : "promo_refused", r.message, r.reason === "already_applied" ? 409 : 400, { reason: r.reason });
    return r;
  });

  app.get("/api/admin/offers", async (req) => offers.adminListOffers(app.requireCtx(req)));
  app.post("/api/admin/offers", { config: { ...perUser("admin-offers", 60, "10 minutes"), doubleSubmit: true } }, async (req, reply) => {
    const created = await offers.adminCreateOffer(app.requireCtx(req), req.body);
    reply.status(201);
    return created;
  });
  app.patch<{ Params: { id: string } }>("/api/admin/offers/:id", { config: perUser("admin-offers", 60, "10 minutes") }, async (req) => offers.adminUpdateOffer(app.requireCtx(req), req.params.id, req.body));
  app.delete<{ Params: { id: string } }>("/api/admin/offers/:id", { config: perUser("admin-offers", 60, "10 minutes") }, async (req) => offers.adminDeleteOffer(app.requireCtx(req), req.params.id));
}
