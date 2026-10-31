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
    reply.status(err.code === "quota_exceeded" ? 402 : err.code === "invalid_output" ? 422 : 503).send({ error: { code: err.code === "quota_exceeded" ? "quota_exceeded" : err.code === "invalid_output" ? "ai_invalid_output" : "ai_unavailable", message: err.message } });
    return;
  }
  const fe = err as FastifyError;
  if (fe.statusCode && fe.statusCode < 500) {
    reply.status(fe.statusCode).send({ error: { code: fe.code === "FST_ERR_VALIDATION" ? "validation" : fe.statusCode === 429 ? "rate_limited" : "http", message: fe.message } });
    return;
  }
  req.log.error({ err }, "erreur interne");
  reply.status(500).send({ error: { code: "internal", message: "Erreur interne du serveur." } });
}
