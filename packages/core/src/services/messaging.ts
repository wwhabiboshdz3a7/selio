import { conversationQuery, draftCreate, type AiRequest, type Conversation, type Message } from "@selio/contracts";
import { repos, type Tx } from "@selio/db";
import { getConnector } from "@selio/connectors";
import { evaluateOffer, extractOfferCents, sanitizeUntrustedText, scanForInjection, type NegotiationResult } from "@selio/domain";
import { AIError } from "@selio/ai";
import { PLAN_QUOTAS } from "@selio/demo-data";
import { AppError, nowIso, requireAction, withOrg, type OrgContext } from "../context";
import type { ConversationDetail, SuggestionResult } from "../types-data";

export function listConversations(ctx: OrgContext, raw: unknown) {
  const q = conversationQuery.safeParse(raw ?? {});
  if (!q.success) throw new AppError("validation", "Filtres invalides", 400, q.error.flatten());
  return withOrg(ctx, (tx) => repos.conversations.list(tx, q.data));
}

async function lastOfferTx(tx: Tx, ctx: OrgContext, conv: Conversation): Promise<ConversationDetail["lastOffer"]> {
  if (!conv.itemId) return null;
  const item = await repos.items.byId(tx, conv.itemId).catch(() => null);
  if (!item) return null;
  const msgs = await repos.messages.forConversation(tx, conv.id);
  const lastInbound = [...msgs].reverse().find((m) => m.direction === "inbound" && m.offerCents);
  if (!lastInbound?.offerCents) return null;
  const org = await ctx.services.db.withGlobal((g) => repos.orgs.byId(g, ctx.orgId));
  return { offerCents: lastInbound.offerCents, evaluation: evaluateOffer({ item, offerCents: lastInbound.offerCents, rules: org.settings.margin, roundsSoFar: conv.negotiationRounds, now: ctx.services.now() }) };
}

export function getConversation(ctx: OrgContext, id: string): Promise<ConversationDetail> {
  return withOrg(ctx, async (tx) => {
    const conversation = await repos.conversations.byId(tx, id);
    const messages = await repos.messages.forConversation(tx, id);
    const customer = await repos.customers.byId(tx, conversation.customerId);
    const item = conversation.itemId ? await repos.items.byId(tx, conversation.itemId).catch(() => null) : null;
    const connection = conversation.connectionId ? await repos.connections.byId(tx, conversation.connectionId).catch(() => null) : null;
    return { conversation, messages, customer, item, connection, lastOffer: await lastOfferTx(tx, ctx, conversation) };
  });
}

export function markRead(ctx: OrgContext, id: string): Promise<void> {
  return withOrg(ctx, async (tx) => {
    await repos.conversations.update(tx, id, { unreadCount: 0 });
    await repos.messages.markRead(tx, id);
  });
}

export function setConversationStatus(ctx: OrgContext, id: string, status: Conversation["status"]): Promise<void> {
  requireAction(ctx, "messages.draft");
  if (status !== "open" && status !== "archived") throw new AppError("validation", "Statut invalide", 400);
  return withOrg(ctx, async (tx) => { await repos.conversations.update(tx, id, { status }); });
}

export function createDraft(ctx: OrgContext, conversationId: string, raw: unknown): Promise<Message> {
  requireAction(ctx, "messages.draft");
  const parsed = draftCreate.safeParse({ ...(raw as object), conversationId });
  if (!parsed.success) throw new AppError("validation", "Brouillon invalide", 400, parsed.error.flatten());
  return withOrg(ctx, async (tx) => {
    await repos.conversations.byId(tx, conversationId);
    return repos.messages.create(tx, { conversationId, direction: "outbound", source: "user", status: "draft", body: sanitizeUntrustedText(parsed.data.body, 4000), offerCents: parsed.data.offerCents ?? null });
  });
}

export function updateDraft(ctx: OrgContext, messageId: string, body: string): Promise<Message> {
  requireAction(ctx, "messages.draft");
  const clean = sanitizeUntrustedText(String(body ?? ""), 4000);
  if (!clean) throw new AppError("validation", "Le message est vide.", 400);
  return withOrg(ctx, async (tx) => {
    const m = await repos.messages.byId(tx, messageId);
    if (m.status !== "draft" && m.status !== "failed") throw new AppError("conflict", "Seul un brouillon (ou un envoi en échec) peut être modifié.", 409);
    return repos.messages.update(tx, messageId, { body: clean, status: "draft", error: null });
  });
}

export function deleteDraft(ctx: OrgContext, messageId: string): Promise<void> {
  requireAction(ctx, "messages.draft");
  return withOrg(ctx, async (tx) => {
    const m = await repos.messages.byId(tx, messageId);
    if (m.status !== "draft" && m.status !== "failed") throw new AppError("conflict", "Seul un brouillon peut être supprimé.", 409);
    await repos.messages.delete(tx, messageId);
  });
}

/** Envoi via le connecteur : le statut « envoyé » n'est posé qu'après confirmation. */
export async function sendMessageTx(ctx: OrgContext, tx: Tx, messageId: string): Promise<Message> {
  const m = await repos.messages.byId(tx, messageId);
  if (m.status === "sent" || m.status === "pending") throw new AppError("conflict", "Ce message est déjà envoyé ou en cours d'envoi.", 409);
  const conv = await repos.conversations.byId(tx, m.conversationId);
  const connection = conv.connectionId ? await repos.connections.byId(tx, conv.connectionId).catch(() => null) : null;
  const connector = connection ? getConnector(connection.provider) : null;
  const sendCap = connection?.capabilities.find((c) => c.capability === "send_message");
  if (!connection || !connector?.sendMessage || !sendCap || sendCap.state === "unavailable" || connection.status === "disconnected" || connection.status === "expired") {
    const error = !connection ? "Aucune connexion associée à cette conversation." : sendCap?.state === "unavailable" ? "Ce connecteur ne permet pas l'envoi automatique : utilisez l'extension pour valider le message dans Vinted." : `Connexion « ${connection.label} » ${connection.status === "expired" ? "expirée" : "déconnectée"}.`;
    return repos.messages.update(tx, messageId, { status: "failed", error });
  }
  await repos.messages.update(tx, messageId, { status: "pending", error: null });
  let secret: string | null = null;
  const blob = await repos.connections.secret(tx, connection.id);
  if (blob) secret = ctx.services.secrets.decrypt(blob, connection.id);
  const result = await connector.sendMessage({ orgId: ctx.orgId, connectionId: connection.id, config: connection.config, secret, now: ctx.services.now() }, { conversationRef: conv.externalRef ?? conv.id, body: m.body, idempotencyKey: m.id });
  if (!result.ok) return repos.messages.update(tx, messageId, { status: "failed", error: result.message });
  const sent = await repos.messages.update(tx, messageId, { status: "sent", sentAt: result.data.sentAt, externalRef: result.data.externalRef, simulated: result.simulated, error: null });
  await repos.conversations.update(tx, conv.id, { lastMessageAt: sent.sentAt, lastMessagePreview: sent.body.slice(0, 120), negotiationRounds: sent.offerCents !== null ? conv.negotiationRounds + 1 : conv.negotiationRounds });
  await repos.customers.update(tx, conv.customerId, { lastContactAt: sent.sentAt });
  await repos.audit.add(tx, { actorUserId: ctx.userId, action: "message.sent", targetType: "message", targetId: messageId, meta: { simulated: sent.simulated }, ip: ctx.ip });
  return sent;
}

export function sendMessage(ctx: OrgContext, messageId: string): Promise<Message> {
  requireAction(ctx, "messages.send");
  return withOrg(ctx, (tx) => sendMessageTx(ctx, tx, messageId));
}

export function evaluateConversationOffer(ctx: OrgContext, conversationId: string, offerCents: number): Promise<NegotiationResult> {
  if (!Number.isInteger(offerCents) || offerCents < 0) throw new AppError("validation", "Offre invalide", 400);
  return withOrg(ctx, async (tx) => {
    const conv = await repos.conversations.byId(tx, conversationId);
    if (!conv.itemId) throw new AppError("validation", "Cette conversation n'est liée à aucun article.", 400);
    const item = await repos.items.byId(tx, conv.itemId);
    const org = await ctx.services.db.withGlobal((g) => repos.orgs.byId(g, ctx.orgId));
    return evaluateOffer({ item, offerCents, rules: org.settings.margin, roundsSoFar: conv.negotiationRounds, now: ctx.services.now() });
  });
}

export async function suggestReply(ctx: OrgContext, conversationId: string, signal?: AbortSignal): Promise<SuggestionResult> {
  requireAction(ctx, "ai.use");
  const detail = await getConversation(ctx, conversationId);
  const org = await ctx.services.db.withGlobal((g) => repos.orgs.byId(g, ctx.orgId));
  if (!org.settings.ai.enabled) throw new AppError("ai_unavailable", "L'assistant IA est désactivé dans les paramètres.", 409);
  const monthStart = new Date(Date.UTC(ctx.services.now().getUTCFullYear(), ctx.services.now().getUTCMonth(), 1)).toISOString();
  const req = await withOrg(ctx, async (tx) => {
    const quotas = (await repos.subscriptions.get(tx))?.quotas ?? PLAN_QUOTAS.free;
    const used = await repos.aiRequests.countSince(tx, monthStart);
    const quota = Math.min(quotas.aiRequestsPerMonth, org.settings.ai.monthlyRequestQuota || Infinity);
    if (used >= quota) throw new AppError("quota_exceeded", `Quota IA mensuel atteint (${quota}).`, 402);
    return repos.aiRequests.create(tx, { kind: "reply_suggestion", provider: ctx.services.ai.provider.name, model: ctx.services.ai.provider.model, status: "running", conversationId, itemId: detail.item?.id ?? null });
  });
  const suspicious = detail.messages.some((m) => m.direction === "inbound" && scanForInjection(m.body).suspicious);
  const started = Date.now();
  let result;
  try {
    result = await ctx.services.ai.suggestReply(ctx.orgId, {
      buyerName: detail.customer.displayName.split(" ")[0] ?? null,
      itemTitle: detail.item?.title ?? "l'article",
      listedPriceCents: detail.item?.listedPriceCents ?? null,
      floorPriceCents: detail.item?.floorPriceCents ?? 0,
      purchasePriceCents: detail.item?.purchasePriceCents ?? 0,
      decision: detail.lastOffer?.evaluation ?? null,
      offerCents: detail.lastOffer?.offerCents ?? null,
      messages: detail.messages.map((m) => ({ direction: m.direction, body: m.body })),
      settings: { tone: org.settings.ai.tone, signature: org.settings.ai.signature },
    }, { signal, allowFallback: ctx.services.allowAiFallback });
  } catch (err) {
    const e = err instanceof AIError ? err : null;
    await withOrg(ctx, (tx) => repos.aiRequests.update(tx, req.id, { status: e?.code === "timeout" ? "timeout" : e?.code === "cancelled" ? "cancelled" : e?.code === "invalid_output" ? "rejected" : "failed", error: (err as Error).message.slice(0, 500), latencyMs: Date.now() - started, finishedAt: nowIso(ctx) }));
    if (e?.code === "quota_exceeded") throw new AppError("quota_exceeded", e.message, 402);
    if (e?.code === "invalid_output") throw new AppError("ai_invalid_output", e.message, 422);
    throw new AppError("ai_unavailable", `Assistant IA indisponible (${e?.code ?? "erreur"}). Vous pouvez rédiger manuellement.`, 503);
  }
  return withOrg(ctx, async (tx) => {
    const patch: Partial<AiRequest> = { status: result.validated ? "succeeded" : "rejected", promptTokens: result.usage.promptTokens, outputTokens: result.usage.outputTokens, latencyMs: Math.max(result.latencyMs, Date.now() - started), validated: result.validated, rejectionReason: result.rejectionReason, finishedAt: nowIso(ctx) };
    await repos.aiRequests.update(tx, req.id, patch);
    await repos.usage.record(tx, "ai.request", { requestId: req.id, suspicious, source: result.source });
    const draft = await repos.messages.create(tx, { conversationId, direction: "outbound", source: "ai", status: "draft", body: result.suggestion.reply, offerCents: result.suggestion.proposedPriceCents, aiRequestId: req.id });
    return { draft, suggestion: result.suggestion, evaluation: detail.lastOffer?.evaluation ?? null, source: result.source, provider: result.provider, model: result.model, validated: result.validated, rejectionReason: result.rejectionReason, simulated: result.provider === "mock" };
  });
}

/** Ingestion d'un message entrant (connecteur, extension ou simulateur). Idempotent par référence externe. */
export async function ingestInboundTx(ctx: OrgContext, tx: Tx, input: { connectionId: string | null; provider: "demo" | "vinted"; conversationRef: string | null; buyerHandle: string; buyerName?: string | null; itemId?: string | null; itemExternalRef?: string | null; body: string; externalRef?: string | null; at?: string }): Promise<Conversation> {
  const now = input.at ?? nowIso(ctx);
  const text = sanitizeUntrustedText(input.body, 2000);
  let customer = await repos.customers.byHandle(tx, input.provider, input.buyerHandle);
  if (!customer) customer = await repos.customers.create(tx, { displayName: sanitizeUntrustedText(input.buyerName ?? input.buyerHandle, 80) || "Acheteur", handle: input.buyerHandle, provider: input.provider, firstContactAt: now, lastContactAt: now });
  let itemId = input.itemId ?? null;
  if (!itemId && input.itemExternalRef) {
    const found = await tx.maybeOne<{ id: string }>("select id from inventory_items where org_id = $1 and external_ref = $2 limit 1", [ctx.orgId, input.itemExternalRef]);
    itemId = found?.id ?? null;
  }
  let conv = input.conversationRef ? await repos.conversations.byExternalRef(tx, input.provider, input.conversationRef) : null;
  if (!conv) conv = await repos.conversations.create(tx, { customerId: customer.id, itemId, connectionId: input.connectionId, provider: input.provider, externalRef: input.conversationRef, status: "open" });
  if (input.externalRef) {
    const dup = await tx.maybeOne("select id from messages where org_id = $1 and external_ref = $2", [ctx.orgId, input.externalRef]);
    if (dup) return conv;
  }
  await repos.messages.create(tx, { conversationId: conv.id, direction: "inbound", source: "buyer", status: "received", body: text, offerCents: extractOfferCents(text), externalRef: input.externalRef ?? null, simulated: input.provider === "demo", createdAt: now });
  await repos.customers.update(tx, customer.id, { lastContactAt: now });
  return repos.conversations.update(tx, conv.id, { unreadCount: conv.unreadCount + 1, lastMessageAt: now, lastMessagePreview: text.slice(0, 120), status: "open", itemId: conv.itemId ?? itemId });
}

/** Simulation d'un message entrant : réservée au connecteur de démonstration. */
export function simulateIncoming(ctx: OrgContext, conversationId: string | null, body?: string): Promise<Conversation> {
  requireAction(ctx, "messages.draft");
  return withOrg(ctx, async (tx) => {
    if (conversationId) {
      const conv = await repos.conversations.byId(tx, conversationId);
      const customer = await repos.customers.byId(tx, conv.customerId);
      if (conv.provider !== "demo") throw new AppError("conflict", "La simulation n'est possible que sur le connecteur de démonstration.", 409);
      return ingestInboundTx(ctx, tx, { connectionId: conv.connectionId, provider: "demo", conversationRef: conv.externalRef, buyerHandle: customer.handle ?? customer.displayName, itemId: conv.itemId, body: body ?? "Bonjour, est-ce toujours disponible ?" });
    }
    const demoConn = (await repos.connections.list(tx)).find((c) => c.provider === "demo");
    if (!demoConn) throw new AppError("conflict", "Ajoutez d'abord le simulateur de démonstration dans Connexions.", 409);
    const res = await getConnector("demo").readConversations!({ orgId: ctx.orgId, connectionId: demoConn.id, config: demoConn.config, now: ctx.services.now() });
    const ext = res.ok ? res.data[0] : null;
    return ingestInboundTx(ctx, tx, { connectionId: demoConn.id, provider: "demo", conversationRef: ext?.externalRef ?? null, buyerHandle: ext?.buyerHandle ?? "acheteur_demo", body: body ?? ext?.messages[0]?.body ?? "Bonjour, est-ce toujours disponible ?" });
  });
}
