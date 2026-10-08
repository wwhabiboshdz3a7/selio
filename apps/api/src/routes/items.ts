import type { FastifyInstance } from "fastify";
import type { ItemStatus } from "@selio/contracts";
import { items } from "@selio/core";

export default async function itemRoutes(app: FastifyInstance) {
  app.get("/api/items", async (req) => items.listItems(app.requireCtx(req), req.query));
  app.get("/api/items/brands", async (req) => items.listBrands(app.requireCtx(req)));
  app.get("/api/items/export.csv", async (req, reply) => {
    const csv = await items.exportItemsCsv(app.requireCtx(req));
    reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", "attachment; filename=selio-articles.csv");
    return csv;
  });
  app.post("/api/items", async (req, reply) => { reply.status(201); return items.createItem(app.requireCtx(req), req.body); });
  app.post("/api/items/bulk", async (req) => items.bulkItems(app.requireCtx(req), req.body));
  app.post("/api/items/import", { bodyLimit: 8 * 1024 * 1024 }, async (req) => items.importItems(app.requireCtx(req), req.body));
  app.get<{ Params: { id: string } }>("/api/items/:id", async (req) => items.getItem(app.requireCtx(req), req.params.id));
  app.get<{ Params: { id: string } }>("/api/items/:id/history", async (req) => items.itemHistory(app.requireCtx(req), req.params.id));
  app.patch<{ Params: { id: string } }>("/api/items/:id", { bodyLimit: 20 * 1024 * 1024 }, async (req) => items.updateItem(app.requireCtx(req), req.params.id, req.body));
  app.post<{ Params: { id: string } }>("/api/items/:id/status", async (req) => items.setItemStatus(app.requireCtx(req), req.params.id, (req.body as { status: ItemStatus }).status));
  app.delete<{ Params: { id: string } }>("/api/items/:id", async (req, reply) => { await items.deleteItem(app.requireCtx(req), req.params.id); reply.status(204); });
}
