import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SignupCodeCheck } from "@selio/contracts";
import { beta, offers } from "@selio/core";

/**
 * Bêta Selio (code BETA2026SELIO, voir @selio/contracts beta.ts) :
 * - `GET /api/beta` : accès bêta de l'organisation (null sans bêta) ; aussi rendu dans la session ;
 * - `POST /api/beta/welcome` : écran « Bienvenue dans la bêta » vu ;
 * - `POST /api/offers/check-signup` : vérification d'un code SANS session (page d'inscription), limitée par
 *   adresse IP ; rend seulement « valable ou non », la durée d'un accès bêta et un message (jamais de compteur).
 */
const signupCheckInput = z.object({ code: z.string().trim().min(1, "Saisissez un code").max(40) });

export default async function betaRoutes(app: FastifyInstance) {
  app.get("/api/beta", async (req) => ({ beta: await beta.getBetaStatus(app.requireCtx(req)) }));

  app.post("/api/beta/welcome", { config: { rateLimit: { max: 20, timeWindow: "15 minutes" } } }, async (req) => ({ beta: await beta.markWelcomeSeen(app.requireCtx(req)) }));

  app.post("/api/offers/check-signup", { config: { rateLimit: { max: 20, timeWindow: "10 minutes", keyGenerator: (req) => `signup-code:${req.ip}` } } }, async (req): Promise<SignupCodeCheck> => {
    const { code } = signupCheckInput.parse(req.body ?? {});
    const r = await offers.checkCode(app.services, code);
    return { valid: r.valid, ...(r.valid && r.beta ? { beta: { days: r.beta.days, plan: r.beta.plan } } : {}), message: r.valid ? r.message : `${r.message} Corrigez-le, ou videz le champ pour commencer l'essai gratuit.` };
  });
}
