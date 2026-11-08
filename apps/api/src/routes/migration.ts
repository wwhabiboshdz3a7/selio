import type { FastifyInstance } from "fastify";
import { migration } from "@selio/core";

/**
 * Migration depuis un autre outil (§5.13) : texte collé, captures (modèle 1, jamais stockées) ou fichier
 * obtenu au titre de la portabilité RGPD. Aucune connexion à l'outil d'origine, aucun identifiant demandé.
 * L'application n'écrit que les champs acceptés sur l'écran « ancien → nouveau ».
 */
/** 4 captures réduites (3 Mo au plus chacune, en base64) et le texte collé. */
const CONVERT_BODY_LIMIT = 14 * 1024 * 1024;
const IMPORT_BODY_LIMIT = 3 * 1024 * 1024;

export default async function migrationRoutes(app: FastifyInstance) {
  app.post("/api/migration/convert", { bodyLimit: CONVERT_BODY_LIMIT, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const ac = new AbortController();
    req.raw.on("close", () => { if (req.raw.destroyed) ac.abort(); });
    const res = await migration.convertSettings(app.requireCtx(req), req.body, ac.signal);
    reply.status(201);
    return res;
  });
  // « /api/migration/file » : même import, chemin utilisé par le client web.
  for (const url of ["/api/migration/import", "/api/migration/file"]) {
    app.post(url, { bodyLimit: IMPORT_BODY_LIMIT, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
      const res = await migration.importRgpdFile(app.requireCtx(req), req.body);
      reply.status(201);
      return res;
    });
  }
  app.get("/api/migration", async (req) => migration.listMigrations(app.requireCtx(req)));
  app.get<{ Params: { id: string } }>("/api/migration/:id", async (req) => migration.getMigration(app.requireCtx(req), req.params.id));
  app.patch<{ Params: { id: string } }>("/api/migration/:id", async (req) => migration.saveMapping(app.requireCtx(req), req.params.id, req.body));
  /**
   * Application : `mappingId` (correspondance enregistrée par la conversion) et/ou `mapping` (corrigée sur
   * l'écran « ancien → nouveau », revalidée par le schéma), et les identifiants des champs acceptés.
   */
  app.post("/api/migration/apply", async (req) => {
    const body = (req.body ?? {}) as { mappingId?: unknown; mapping?: unknown; acceptedFieldIds?: unknown };
    return migration.applyMigration(app.requireCtx(req), typeof body.mappingId === "string" && body.mappingId ? body.mappingId : null, body.acceptedFieldIds, body.mapping);
  });
  app.post<{ Params: { id: string } }>("/api/migration/:id/apply", async (req) => {
    const body = (req.body ?? {}) as { mapping?: unknown; acceptedFieldIds?: unknown };
    return migration.applyMigration(app.requireCtx(req), req.params.id, body.acceptedFieldIds, body.mapping);
  });
}
