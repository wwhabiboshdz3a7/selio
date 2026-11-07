import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { repos } from "@selio/db";
import { AppError, withOrg, type OrgContext } from "@selio/core";
import { SIZE_REFERENCE_IMPORT_MAX_ROWS, parseSizeReferenceImport } from "../size-references";

/**
 * Administration de la base des références de tailles (Studio, §5.11) : opérateurs Selio seulement.
 *
 * `POST /api/admin/size-references` importe un fichier CSV (`Content-Type: text/csv`, ou `{ "csv": "…" }`) ou
 * JSON (tableau, `{ "references": [...] }`). Aucune donnée personnelle : une colonne personnelle refuse le
 * fichier entier, une colonne inconnue aussi. Tout ou rien : une ligne invalide refuse l'import et rien n'est
 * écrit. `?dryRun=true` vérifie sans écrire. Les références importées sont « fournies par Selio » (source
 * `provided`) : elles remplacent une ligne de même marque, référence et taille, et un vendeur ne peut plus les
 * modifier en partageant ses mesures.
 */

const IMPORT_BODY_LIMIT = 5 * 1024 * 1024;

const perUser = (prefix: string, max: number, timeWindow: string) => ({
  rateLimit: { max, timeWindow, keyGenerator: (req: FastifyRequest) => (req.orgCtx ? `${prefix}:${req.orgCtx.userId}` : `${prefix}-ip:${req.ip}`) },
});

const importQuery = z.object({
  dryRun: z.enum(["true", "false", "1", "0"]).optional().transform((v) => v === "true" || v === "1"),
  format: z.enum(["csv", "json"]).optional(),
});
const listQuery = z.object({
  brand: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

function requireOperator(ctx: OrgContext): void {
  if (!ctx.isOperator) throw new AppError("forbidden", "Accès réservé aux opérateurs Selio.", 403);
}

export default async function adminRoutes(app: FastifyInstance) {
  // CSV envoyé tel quel (fichier choisi par l'opérateur) : lu comme du texte, dans ce plugin seulement.
  app.addContentTypeParser(["text/csv", "text/plain"], { parseAs: "string", bodyLimit: IMPORT_BODY_LIMIT }, (_req, body, done) => done(null, body));

  app.post("/api/admin/size-references", { bodyLimit: IMPORT_BODY_LIMIT, config: perUser("admin-size-refs", 10, "10 minutes") }, async (req, reply) => {
    const ctx = app.requireCtx(req);
    requireOperator(ctx);
    const q = importQuery.parse(req.query ?? {});
    const body = req.body as unknown;
    const wrapped = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
    const input = typeof wrapped?.csv === "string" ? wrapped.csv : body;
    // Texte : CSV, ou JSON s'il commence par « [ » ou « { » ; objet : JSON. `?format=` force la lecture.
    const parsed = parseSizeReferenceImport(input, q.format);
    if (!parsed.ok) {
      throw new AppError("import_rejected", parsed.errors[0]?.line === 0 ? parsed.errors[0].message : `Import refusé : ${parsed.errorCount} ligne(s) invalide(s), rien n'a été écrit.`, 400, {
        errors: parsed.errors,
        errorCount: parsed.errorCount,
        maxRows: SIZE_REFERENCE_IMPORT_MAX_ROWS,
        ...(parsed.personalColumns ? { personalColumns: parsed.personalColumns } : {}),
        ...(parsed.unknownColumns ? { unknownColumns: parsed.unknownColumns } : {}),
      });
    }
    const rows = parsed.rows;
    if (!q.dryRun) {
      // Une seule transaction : tout ou rien (une ligne refusée par la base annule l'import entier).
      await app.services.db.withGlobal(async (tx) => {
        for (const r of rows) await repos.sizeReferences.provide(tx, { brand: r.brand, reference: r.reference, size: r.size, category: r.category, measurements: r.measurements as Record<string, number> });
      });
    }
    const brands = new Set(rows.map((r) => r.brand.toLowerCase())).size;
    await withOrg(ctx, (tx) => repos.audit.add(tx, { actorUserId: ctx.userId, action: q.dryRun ? "admin.size_references_checked" : "admin.size_references_imported", targetType: "size_references", meta: { format: parsed.format, rows: rows.length, brands }, ip: ctx.ip }));
    const total = await app.services.db.withGlobal((tx) => repos.sizeReferences.count(tx));
    reply.status(q.dryRun ? 200 : 201);
    return { dryRun: q.dryRun, format: parsed.format, imported: q.dryRun ? 0 : rows.length, checked: rows.length, brands, total };
  });

  /** Lecture de la base (opérateur) : marque, référence, taille, famille, mesures, source. Aucune donnée personnelle. */
  app.get("/api/admin/size-references", async (req) => {
    const ctx = app.requireCtx(req);
    requireOperator(ctx);
    const q = listQuery.parse(req.query ?? {});
    return app.services.db.withGlobal(async (tx) => ({ references: await repos.sizeReferences.list(tx, q), total: await repos.sizeReferences.count(tx) }));
  });
}
