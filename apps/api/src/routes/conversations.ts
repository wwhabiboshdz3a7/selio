import type { FastifyInstance } from "fastify";
import type { Conversation } from "@selio/contracts";
import { messaging } from "@selio/core";

export default async function conversationRoutes(app: FastifyInstance) {
  app.get("/api/conversations", async (req) => messaging.listConversations(app.requireCtx(req), req.query));
  app.post("/api/conversations/simulate", async (req) => {
    const body = (req.body ?? {}) as { conversationId?: string | null; body?: string };
    return messaging.simulateIncoming(app.requireCtx(req), body.conversationId ?? null, body.body);
  });
  app.get<{ Params: { id: string } }>("/api/conversations/:id", async (req) => messaging.getConversation(app.requireCtx(req), req.params.id));
  app.post<{ Params: { id: string } }>("/api/conversations/:id/read", async (req, reply) => { await messaging.markRead(app.requireCtx(req), req.params.id); reply.status(204); });
  app.post<{ Params: { id: string } }>("/api/conversations/:id/status", async (req, reply) => { await messaging.setConversationStatus(app.requireCtx(req), req.params.id, (req.body as { status: Conversation["status"] }).status); reply.status(204); });
  app.post<{ Params: { id: string } }>("/api/conversations/:id/drafts", async (req, reply) => { reply.status(201); return messaging.createDraft(app.requireCtx(req), req.params.id, req.body); });
  app.post<{ Params: { id: string } }>("/api/conversations/:id/suggest", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const ac = new AbortController();
    req.raw.on("close", () => { if (req.raw.destroyed) ac.abort(); });
    return messaging.suggestReply(app.requireCtx(req), req.params.id, ac.signal);
  });
  app.post<{ Params: { id: string } }>("/api/conversations/:id/evaluate", async (req) => messaging.evaluateConversationOffer(app.requireCtx(req), req.params.id, Number((req.body as { offerCents?: number })?.offerCents)));
  app.patch<{ Params: { id: string } }>("/api/messages/:id", async (req) => messaging.updateDraft(app.requireCtx(req), req.params.id, (req.body as { body: string }).body));
  app.delete<{ Params: { id: string } }>("/api/messages/:id", async (req, reply) => { await messaging.deleteDraft(app.requireCtx(req), req.params.id); reply.status(204); });
  app.post<{ Params: { id: string } }>("/api/messages/:id/send", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => messaging.sendMessage(app.requireCtx(req), req.params.id));
}
