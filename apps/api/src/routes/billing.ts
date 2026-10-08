import type { FastifyInstance } from "fastify";
import type { Plan } from "@selio/contracts";
import { billing } from "@selio/core";

export default async function billingRoutes(app: FastifyInstance, opts: { config: billing.BillingConfig }) {
  app.get("/api/billing/subscription", async (req) => billing.getSubscription(app.requireCtx(req)));
  app.get("/api/billing/usage", async (req) => billing.getUsage(app.requireCtx(req)));
  app.get("/api/billing/usage-events", async (req) => billing.listUsageEvents(app.requireCtx(req), Number((req.query as { limit?: string }).limit ?? 50)));
  app.post("/api/billing/checkout", async (req) => billing.startCheckout(app.requireCtx(req), (req.body as { plan: Plan }).plan, opts.config));
  // Webhook : corps brut pour vérifier la signature.
  app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", { parseAs: "string" }, (_req, body, done) => done(null, body));
    scope.post("/api/billing/webhook", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req) => {
      const sig = req.headers["stripe-signature"];
      return billing.handleStripeWebhook(app.services, opts.config, String(req.body ?? ""), typeof sig === "string" ? sig : undefined);
    });
  });
}
