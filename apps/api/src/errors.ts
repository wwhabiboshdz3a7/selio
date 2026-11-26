import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { AppError } from "@selio/core";
import { DbError } from "@selio/db";
import { AIError } from "@selio/ai";

export function errorHandler(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply): void {
  if (err instanceof AppError) {
    reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof DbError) {
    const status = err.code === "not_found" ? 404 : err.code === "conflict" ? 409 : err.code === "validation" ? 400 : 500;
    reply.status(status).send({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof ZodError) {
    reply.status(400).send({ error: { code: "validation", message: "Requête invalide", details: err.flatten() } });
    return;
  }
  if (err instanceof AIError) {
    // Entrée refusée avant tout appel (trop de photos, photo trop grande ou illisible) : erreur de l'appelant, pas une panne.
    if (err.code === "input_rejected") {
      reply.status(422).send({ error: { code: "ai_input_rejected", message: err.message } });
      return;
    }
    reply.status(err.code === "quota_exceeded" ? 402 : err.code === "invalid_output" ? 422 : 503).send({ error: { code: err.code === "quota_exceeded" ? "quota_exceeded" : err.code === "invalid_output" ? "ai_invalid_output" : "ai_unavailable", message: err.message } });
    return;
  }
  const fe = err as FastifyError;
  // Corps trop lourd (photos en pleine taille, fichier d'import) : 413 explicite, en français.
  if (fe.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
    reply.status(413).send({ error: { code: "payload_too_large", message: "Envoi trop lourd : réduisez les photos avant l'envoi (côté long 1 024 px, JPEG qualité 80, 12 photos au plus) ou découpez le fichier." } });
    return;
  }
  if (fe.statusCode && fe.statusCode < 500) {
    // Les messages de Fastify et de ses extensions sont en anglais (« Body cannot be empty… », « Rate limit
    // exceeded… ») : jamais affichés tels quels, chaque cas a son message en français.
    reply.status(fe.statusCode).send({ error: { code: fe.code === "FST_ERR_VALIDATION" ? "validation" : fe.statusCode === 429 ? "rate_limited" : "http", message: frenchHttpMessage(fe) } });
    return;
  }
  req.log.error({ err }, "erreur interne");
  reply.status(500).send({ error: { code: "internal", message: "Erreur interne du serveur." } });
}

/** Message en français d'une erreur HTTP de Fastify (corps illisible, type de contenu, débit, taille…). */
export function frenchHttpMessage(fe: Pick<FastifyError, "code" | "statusCode">): string {
  switch (fe.code) {
    case "FST_ERR_CTP_EMPTY_JSON_BODY":
      return "Requête vide : des données étaient attendues.";
    case "FST_ERR_CTP_INVALID_JSON_BODY":
      return "Requête illisible : les données envoyées ne sont pas valides.";
    case "FST_ERR_CTP_INVALID_MEDIA_TYPE":
      return "Format de requête non pris en charge.";
    case "FST_ERR_CTP_INVALID_CONTENT_LENGTH":
      return "Requête incomplète : la taille annoncée ne correspond pas aux données reçues. Réessayez.";
    case "FST_ERR_CTP_INVALID_TYPE":
      return "Type de contenu invalide.";
    case "FST_ERR_VALIDATION":
      return "Requête invalide.";
  }
  switch (fe.statusCode) {
    case 400:
      return "Requête invalide.";
    case 401:
      return "Authentification requise : reconnectez-vous.";
    case 403:
      return "Action non autorisée.";
    case 404:
      return "Élément introuvable.";
    case 405:
      return "Action non prise en charge.";
    case 408:
      return "La requête a pris trop de temps : réessayez.";
    case 413:
      return "Envoi trop lourd.";
    case 415:
      return "Format de requête non pris en charge.";
    case 429:
      return "Trop de requêtes en peu de temps : patientez une minute avant de réessayer.";
    default:
      return "Requête refusée par le serveur.";
  }
}
