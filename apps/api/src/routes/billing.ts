import type { FastifyInstance } from "fastify";
import { changePlanInput, checkoutInput } from "@selio/contracts";
import { billing } from "@selio/core";

/**
 * Abonnement et paiement (Revolut). Le navigateur ne reçoit jamais la clé secrète : seulement
 * le jeton public d'une commande, que le formulaire Revolut consomme. Le webhook lit le corps
 * brut pour vérifier la signature.
 */
export default async function billingRoutes(app: FastifyInstance) {
  app.get("/api/billing/subscription", async (req) => billing.getSubscription(app.requireCtx(req)));
  app.get("/api/billing/usage", async (req) => billing.getUsage(app.requireCtx(req)));
  app.get("/api/billing/usage-events", async (req) => billing.listUsageEvents(app.requireCtx(req), Number((req.query as { limit?: string }).limit ?? 50)));
  app.post("/api/billing/checkout", async (req) => {
    const body = (req.body ?? {}) as { plan?: unknown; cycle?: unknown };
    // L'offre est validée par le service (400 explicite) ; la périodicité par le contrat (mensuel par défaut).
    const cycle = checkoutInput.shape.cycle.safeParse(body.cycle);
    return billing.startCheckout(app.requireCtx(req), String(body.plan ?? ""), { cycle: cycle.success ? cycle.data : "monthly" });
  });
  // Changement de carte sans paiement : commande de vérification (1 €) en capture manuelle, annulée dès la carte enregistrée.
  app.post("/api/billing/card", async (req) => billing.startCardUpdate(app.requireCtx(req)));
  app.post("/api/billing/cancel", async (req) => billing.cancelSubscription(app.requireCtx(req)));
  app.post("/api/billing/reactivate", async (req) => billing.reactivateSubscription(app.requireCtx(req)));
  app.post("/api/billing/plan", async (req) => billing.changePlan(app.requireCtx(req), changePlanInput.parse(req.body).plan));
  app.get("/api/billing/invoices", async (req) => billing.listInvoices(app.requireCtx(req)));
  app.get<{ Params: { id: string } }>("/api/billing/invoices/:id", async (req) => billing.getInvoice(app.requireCtx(req), req.params.id));
  // Webhook Revolut : corps brut pour vérifier la signature (HMAC du corps tel que reçu), sans session.
  app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", { parseAs: "string" }, (_req, body, done) => done(null, body));
    scope.post("/api/billing/webhook/revolut", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req) => billing.handleRevolutWebhook(app.services, String(req.body ?? ""), req.headers));
  });
}
