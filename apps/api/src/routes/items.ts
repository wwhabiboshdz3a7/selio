import type { FastifyInstance } from "fastify";
import type { ItemStatus } from "@selio/contracts";
import { items, seesFinances } from "@selio/core";

export default async function itemRoutes(app: FastifyInstance) {
  // Le tri « par marge » révélerait l'ordre des marges : sans « finances.read », ramené au tri par défaut.
  app.get("/api/items", async (req) => {
    const ctx = app.requireCtx(req);
    const query = { ...((req.query ?? {}) as Record<string, unknown>) };
    if (!seesFinances(ctx.role) && query.sort === "margin_desc") delete query.sort;
    return items.listItems(ctx, query);
  });
  app.get("/api/items/brands", async (req) => items.listBrands(app.requireCtx(req)));
  app.get("/api/items/export.csv", async (req, reply) => {
    const csv = await items.exportItemsCsv(app.requireCtx(req));
    reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", "attachment; filename=selio-articles.csv");
    return csv;
  });
  // Enregistrement avec contrôle de l'annonce : avertissements NON bloquants (photos, floue, mesures manquantes) dans `listingCheck`.
  app.post("/api/items", async (req, reply) => { reply.status(201); return items.createItemChecked(app.requireCtx(req), req.body); });
  app.post("/api/items/bulk", async (req) => items.bulkItems(app.requireCtx(req), req.body));
  app.post("/api/items/import", { bodyLimit: 8 * 1024 * 1024 }, async (req) => items.importItems(app.requireCtx(req), req.body));
  app.get<{ Params: { id: string } }>("/api/items/:id", async (req) => items.getItem(app.requireCtx(req), req.params.id));
  app.get<{ Params: { id: string } }>("/api/items/:id/history", async (req) => items.itemHistory(app.requireCtx(req), req.params.id));
  app.patch<{ Params: { id: string } }>("/api/items/:id", { bodyLimit: 20 * 1024 * 1024 }, async (req) => items.updateItemChecked(app.requireCtx(req), req.params.id, req.body));
  /** Contrôle d'une annonce sans l'enregistrer (scores de netteté calculés par le navigateur, facultatifs). */
  app.post<{ Params: { id: string } }>("/api/items/:id/checks", async (req) => items.checkItem(app.requireCtx(req), req.params.id, ((req.body ?? {}) as { photoScores?: unknown }).photoScores));
  /** Ajout de photos seulement (« items.photos.write ») : seule écriture permise au contributeur photos. 12 photos réduites au plus. */
  app.post<{ Params: { id: string } }>("/api/items/:id/photos", { bodyLimit: 20 * 1024 * 1024 }, async (req) => items.addItemPhotos(app.requireCtx(req), req.params.id, req.body ?? {}));
  app.post<{ Params: { id: string } }>("/api/items/:id/status", async (req) => items.setItemStatus(app.requireCtx(req), req.params.id, (req.body as { status: ItemStatus }).status));
  app.delete<{ Params: { id: string } }>("/api/items/:id", async (req, reply) => { await items.deleteItem(app.requireCtx(req), req.params.id); reply.status(204); });
}
