import { createHash } from "node:crypto";
import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { repos } from "@selio/db";
import { AppError, type Services } from "@selio/core";

/**
 * Anti double envoi (double clic, double tap, deux onglets qui envoient la même chose au même instant) sur les
 * actions sensibles : paiement, achat, inscription, création d'article ou d'offre, envoi d'un message, invitation.
 *
 * Une route le demande avec `config: { doubleSubmit: true }` (ou `{ windowMs }`). La même requête (même personne,
 * même organisation, même adresse, même corps) reçue une seconde fois pendant que la première est en cours, ou dans
 * la fenêtre qui suit sa réussite, est refusée (409 `duplicate_request`, message clair) AVANT d'atteindre le
 * service : l'action n'est jamais faite deux fois. Une première requête en échec libère aussitôt le verrou. Le
 * verrou vit dans PostgreSQL (`rate_limits`, compteur atomique) : il tient aussi avec plusieurs instances de l'API.
 * Le client désactive déjà ses boutons pendant la requête ; ce verrou couvre ce que le client ne voit pas.
 */

export const DOUBLE_SUBMIT_WINDOW_MS = 4_000;
/** Durée maximale du verrou pendant le traitement (une requête plus longue, ou un processus arrêté net, le libère). */
export const DOUBLE_SUBMIT_LOCK_MS = 60_000;
export const DUPLICATE_REQUEST_MESSAGE = "Cette action vient déjà d'être envoyée : elle n'est pas refaite une seconde fois. Patientez quelques secondes avant de recommencer si besoin.";

export interface DoubleSubmitConfig {
  windowMs?: number;
}

declare module "fastify" {
  interface FastifyContextConfig {
    doubleSubmit?: boolean | DoubleSubmitConfig;
  }
}

/** Empreinte stable d'une requête (le corps peut contenir un mot de passe : seule l'empreinte SHA-256 est gardée). */
export function requestFingerprint(req: Pick<FastifyRequest, "method" | "url" | "body" | "ip" | "orgCtx">): string {
  const who = req.orgCtx ? `${req.orgCtx.orgId}:${req.orgCtx.userId}` : `ip:${req.ip}`;
  let body = "";
  try {
    body = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? null);
  } catch {
    body = "?";
  }
  return createHash("sha256").update(`${who}\n${req.method} ${req.url}\n${body}`).digest("base64url");
}

const HELD_KEY = Symbol("doubleSubmitKey");
type WithHeldKey = { [HELD_KEY]?: string };

export default fp(async function doubleSubmitPlugin(app: FastifyInstance, opts: { services: Services; windowMs?: number }) {
  app.addHook("preHandler", async (req) => {
    const cfg = req.routeOptions.config?.doubleSubmit;
    if (!cfg) return;
    const key = `double:${requestFingerprint(req)}`;
    // Verrou posé pour toute la durée du traitement (borné à une minute), raccourci ou levé à la réponse.
    const hits = await opts.services.db.withGlobal((tx) => repos.rateLimits.hit(tx, key, DOUBLE_SUBMIT_LOCK_MS));
    if (hits > 1) throw new AppError("duplicate_request", DUPLICATE_REQUEST_MESSAGE, 409);
    (req as WithHeldKey)[HELD_KEY] = key;
  });
  // À la réponse, AVANT son envoi (un nouvel essai lancé dès la réponse reçue trouve le verrou à jour) :
  // - action refusée ou en échec (quota, validation, panne) : rien n'a été fait, le verrou est levé pour qu'un nouvel
  //   essai (après avoir corrigé la cause) passe tout de suite ;
  // - action réussie : le doublon reste refusé pendant la fenêtre (le second clic d'un double clic arrive souvent
  //   juste après la réponse au premier).
  app.addHook("onSend", async (req, reply, payload) => {
    const key = (req as WithHeldKey)[HELD_KEY];
    if (!key) return payload;
    const cfg = req.routeOptions.config?.doubleSubmit;
    const windowMs = typeof cfg === "object" && cfg.windowMs !== undefined ? cfg.windowMs : opts.windowMs ?? DOUBLE_SUBMIT_WINDOW_MS;
    await opts.services.db
      .withGlobal((tx) => (reply.statusCode >= 400 || windowMs <= 0 ? repos.rateLimits.release(tx, key) : repos.rateLimits.expireIn(tx, key, windowMs, DOUBLE_SUBMIT_LOCK_MS)))
      .catch(() => undefined);
    return payload;
  });
});
