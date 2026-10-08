import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { repos } from "@selio/db";
import { AppError, connections, items, messaging, withOrg } from "@selio/core";
import { checkPrice, suggestFloorPrice } from "@selio/domain";

/**
 * API de l'extension navigateur (jeton Bearer à portées limitées).
 * Aucun secret longue durée n'est renvoyé à la page ; l'extension ne reçoit
 * que les données nécessaires à l'écran courant.
 */
const capturedItem = z.object({
  title: z.string().trim().min(1).max(200),
  brand: z.string().max(80).nullable().optional(),
  size: z.string().max(40).nullable().optional(),
  condition: z.enum(["new_with_tags", "new_without_tags", "very_good", "good", "satisfactory"]).nullable().optional(),
  priceCents: z.number().int().min(0).nullable().optional(),
  description: z.string().max(2000).optional(),
  photoUrls: z.array(z.string().url().max(500)).max(12).optional(),
  externalRef: z.string().max(120).nullable().optional(),
  url: z.string().url().max(500),
  adapterVersion: z.string().max(40),
  purchasePriceCents: z.number().int().min(0).optional(),
});

const capturedConversation = z.object({
  conversationRef: z.string().max(120).nullable().optional(),
  buyerHandle: z.string().trim().min(1).max(80),
  itemTitle: z.string().max(200).nullable().optional(),
  itemExternalRef: z.string().max(120).nullable().optional(),
  messages: z.array(z.object({ direction: z.enum(["inbound", "outbound"]), body: z.string().max(2000), at: z.string().nullable().optional() })).max(30),
  url: z.string().url().max(500),
  adapterVersion: z.string().max(40),
});

function requireScope(req: { extScopes: string[] | null }, scope: string) {
  if (!req.extScopes?.includes(scope)) throw new AppError("forbidden", `Portée « ${scope} » absente du jeton.`, 403);
}

export default async function extRoutes(app: FastifyInstance) {
  app.get("/api/ext/ping", async (req) => {
    const ctx = app.requireCtx(req);
    await connections.touchExtension(ctx);
    const org = await app.services.db.withGlobal((tx) => repos.orgs.byId(tx, ctx.orgId));
    return { ok: true, orgName: org.name, scopes: req.extScopes, margin: org.settings.margin, serverTime: app.services.now().toISOString() };
  });

  app.post("/api/ext/capture", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const ctx = app.requireCtx(req);
    requireScope(req, "capture:items");
    const parsed = capturedItem.safeParse(req.body);
    if (!parsed.success) throw new AppError("validation", "Capture invalide", 400, parsed.error.flatten());
    const c = parsed.data;
    const created = await withOrg(ctx, async (tx) => {
      if (c.externalRef) {
        const dup = await tx.maybeOne<{ id: string }>("select id from inventory_items where org_id = $1 and external_ref = $2", [ctx.orgId, c.externalRef]);
        if (dup) throw new AppError("conflict", "Cet article a déjà été capturé.", 409, { existingId: dup.id });
      }
      const item = await items.createItemTx(ctx, tx, {
        title: c.title, brand: c.brand ?? null, size: c.size ?? null, condition: c.condition ?? "good", description: c.description ?? "", listedPriceCents: c.priceCents ?? null, purchasePriceCents: c.purchasePriceCents ?? 0,
        photos: (c.photoUrls ?? []).map((url, i) => ({ id: `${i}`, url, alt: c.title, position: i })), externalRef: c.externalRef ?? null, externalUrl: c.url, status: "in_stock", tags: ["capture-extension"],
      }, "Capture via l'extension");
      await repos.usage.record(tx, "extension.capture", { adapterVersion: c.adapterVersion });
      return item;
    });
    reply.status(201);
    return created;
  });

  app.post("/api/ext/rules", async (req) => {
    const ctx = app.requireCtx(req);
    requireScope(req, "read:rules");
    const body = z.object({ externalRef: z.string().max(120).nullable().optional(), listedPriceCents: z.number().int().min(0).nullable().optional(), offerCents: z.number().int().min(0).nullable().optional() }).parse(req.body ?? {});
    const org = await app.services.db.withGlobal((tx) => repos.orgs.byId(tx, ctx.orgId));
    const item = body.externalRef ? await withOrg(ctx, (tx) => tx.maybeOne<{ id: string; purchasePriceCents: number; purchaseFeesCents: number; listedPriceCents: number | null; floorPriceCents: number | null; title: string }>("select id, purchase_price_cents, purchase_fees_cents, listed_price_cents, floor_price_cents, title from inventory_items where org_id = $1 and external_ref = $2", [ctx.orgId, body.externalRef])) : null;
    const pricing = item ? { purchasePriceCents: item.purchasePriceCents, purchaseFeesCents: item.purchaseFeesCents, listedPriceCents: item.listedPriceCents ?? body.listedPriceCents ?? null, floorPriceCents: item.floorPriceCents } : null;
    return {
      known: Boolean(item),
      itemId: item?.id ?? null,
      title: item?.title ?? null,
      floorPriceCents: pricing ? (pricing.floorPriceCents ?? suggestFloorPrice(pricing, org.settings.margin)) : null,
      offerCheck: pricing && body.offerCents != null ? checkPrice(pricing, body.offerCents, org.settings.margin) : null,
      margin: org.settings.margin,
    };
  });

  app.post("/api/ext/draft", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const ctx = app.requireCtx(req);
    requireScope(req, "draft:messages");
    const parsed = capturedConversation.safeParse(req.body);
    if (!parsed.success) throw new AppError("validation", "Conversation invalide", 400, parsed.error.flatten());
    const c = parsed.data;
    const vinted = await withOrg(ctx, async (tx) => (await repos.connections.list(tx)).find((x) => x.provider === "vinted" && x.status !== "disconnected") ?? null);
    if (!vinted) throw new AppError("conflict", "Ajoutez d'abord une connexion Vinted dans Paramètres › Connexions.", 409);
    const conv = await withOrg(ctx, async (tx) => {
      let last = null;
      for (const m of c.messages.filter((x) => x.direction === "inbound")) last = await messaging.ingestInboundTx(ctx, tx, { connectionId: vinted.id, provider: "vinted", conversationRef: c.conversationRef ?? null, buyerHandle: c.buyerHandle, itemExternalRef: c.itemExternalRef ?? null, body: m.body, externalRef: c.conversationRef ? `${c.conversationRef}:${m.at ?? m.body.slice(0, 40)}` : null, at: m.at ?? undefined });
      return last;
    });
    if (!conv) throw new AppError("validation", "Aucun message acheteur dans la conversation.", 400);
    const suggestion = await messaging.suggestReply(ctx, conv.id);
    return { conversationId: conv.id, draftId: suggestion.draft.id, body: suggestion.suggestion.reply, evaluation: suggestion.evaluation, source: suggestion.source, validated: suggestion.validated, rejectionReason: suggestion.rejectionReason, requiresApproval: true };
  });

  /** Tâches « navigateur » en attente pour cette organisation (exécution par l'extension, expérimental). */
  app.get("/api/ext/jobs", async (req) => {
    const ctx = app.requireCtx(req);
    requireScope(req, "sync:conversations");
    return withOrg(ctx, async (tx) => (await repos.jobs.list(tx, { status: "queued", pageSize: 20 })).items.filter((j) => j.runsIn === "browser"));
  });
}
