import type { FastifyInstance } from "fastify";
import { changePlanInput, checkoutInput } from "@selio/contracts";
import { billing } from "@selio/core";
import { requireFinances } from "../plugins/roles";

/**
 * Abonnement et paiement (Revolut). Le navigateur ne reçoit jamais la clé secrète : seulement
 * le jeton public d'une commande, que le formulaire Revolut consomme. Le webhook lit le corps
 * brut pour vérifier la signature.
 *
 * Rôles (§5.15) : l'abonnement, les factures, le journal d'utilisation et les paiements sont des finances :
 * 403 explicite (« finances_forbidden ») pour l'exécuteur et le contributeur photos, avant tout contrôle du
 * service (les actions de paiement restent réservées au titulaire, « billing.manage »). Les compteurs du mois
 * (`/api/billing/usage`, sans montant) restent lisibles par tous les membres ; l'offre et ses quotas, sans
 * donnée de paiement, sont aussi donnés par `GET /api/org/plan`.
 */
export default async function billingRoutes(app: FastifyInstance) {
  /** Contexte d'une route de facturation : 403 explicite sans « finances.read ». */
  const financeCtx = (req: Parameters<typeof app.requireCtx>[0]) => {
    const ctx = app.requireCtx(req);
    requireFinances(ctx);
    return ctx;
  };
  app.get("/api/billing/subscription", async (req) => billing.getSubscription(financeCtx(req)));
  app.get("/api/billing/usage", async (req) => billing.getUsage(app.requireCtx(req)));
  app.get("/api/billing/usage-events", async (req) => billing.listUsageEvents(financeCtx(req), Number((req.query as { limit?: string }).limit ?? 50)));
  app.post("/api/billing/checkout", async (req) => {
    const body = (req.body ?? {}) as { plan?: unknown; cycle?: unknown };
    // L'offre est validée par le service (400 explicite) ; la périodicité par le contrat (mensuel par défaut).
    const cycle = checkoutInput.shape.cycle.safeParse(body.cycle);
    return billing.startCheckout(financeCtx(req), String(body.plan ?? ""), { cycle: cycle.success ? cycle.data : "monthly" });
  });
  // Changement de carte sans paiement : commande de vérification (1 €) en capture manuelle, annulée dès la carte enregistrée.
  app.post("/api/billing/card", async (req) => billing.startCardUpdate(financeCtx(req)));
  app.post("/api/billing/cancel", async (req) => billing.cancelSubscription(financeCtx(req)));
  app.post("/api/billing/reactivate", async (req) => billing.reactivateSubscription(financeCtx(req)));
  app.post("/api/billing/plan", async (req) => billing.changePlan(financeCtx(req), changePlanInput.parse(req.body).plan));
  app.get("/api/billing/invoices", async (req) => billing.listInvoices(financeCtx(req)));
  app.get<{ Params: { id: string } }>("/api/billing/invoices/:id", async (req) => billing.getInvoice(financeCtx(req), req.params.id));
  // Webhook Revolut : corps brut pour vérifier la signature (HMAC du corps tel que reçu), sans session.
  app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", { parseAs: "string" }, (_req, body, done) => done(null, body));
    scope.post("/api/billing/webhook/revolut", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req) => billing.handleRevolutWebhook(app.services, String(req.body ?? ""), req.headers));
  });
}
