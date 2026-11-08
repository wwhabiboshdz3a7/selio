import { conversationQuery, draftCreate, type AiRequest, type Conversation, type Message, type Organization, type Provider } from "@selio/contracts";
import { repos, type Tx } from "@selio/db";
import { getConnector } from "@selio/connectors";
import { applyLimitsToDecision, applySituationOverride, evaluateOffer, extractOfferCents, sanitizeUntrustedText, scanForInjection, situationEscalates, situationPromptContext, type NegotiationResult } from "@selio/domain";
import { AIError } from "@selio/ai";
import { PLAN_QUOTAS } from "@selio/demo-data";
import { AppError, nowIso, requireAction, withOrg, type OrgContext } from "../context";
import type { ConversationDetail, SuggestionResult } from "../types-data";
import { effectiveLimitsTx, escalationFor, evaluateConversationBundleTx, limitsContextFor, situationFor } from "./negotiation";

export function listConversations(ctx: OrgContext, raw: unknown) {
  const q = conversationQuery.safeParse(raw ?? {});
  if (!q.success) throw new AppError("validation", "Filtres invalides", 400, q.error.flatten());
  return withOrg(ctx, (tx) => repos.conversations.list(tx, q.data));
}

async function lastOfferTx(tx: Tx, ctx: OrgContext, conv: Conversation, msgs: Message[]): Promise<ConversationDetail["lastOffer"]> {
  if (!conv.itemId) return null;
  const item = await repos.items.byId(tx, conv.itemId).catch(() => null);
  if (!item) return null;
  const lastInbound = [...msgs].reverse().find((m) => m.direction === "inbound" && m.offerCents);
  if (!lastInbound?.offerCents) return null;
  const org = await repos.orgs.byId(tx, ctx.orgId);
  const evaluation = evaluateOffer({ item, offerCents: lastInbound.offerCents, rules: org.settings.margin, roundsSoFar: conv.negotiationRounds, now: ctx.services.now() });
  // Une situation réglée « transmettre au vendeur » (défaut, remboursement…) l'emporte sur la décision de prix,
  // puis les limites de Vinted (au-delà des contre-offres : vendeur), comme pour la négociation automatique.
  return { offerCents: lastInbound.offerCents, evaluation: await limitedTx(tx, org, conv, msgs, ctx.services.now(), applySituationOverride(evaluation, escalationFor(org, lastInbound.body))) };
}

/**
 * Limites de Vinted appliquées à une décision montrée dans Messages ou transmise à mon IA perso : au-delà
 * du nombre de contre-offres, plus de contre-proposition. Le délai entre deux messages n'est pas appliqué
 * ici (c'est le vendeur qui enverra) : il l'est au moment de l'envoi automatique.
 */
async function limitedTx<T extends NegotiationResult>(tx: Tx, org: Organization, conv: Conversation, msgs: Message[], now: Date, ev: T): Promise<T> {
  const limits = (await effectiveLimitsTx(tx, org)).limits;
  const limited = applyLimitsToDecision(ev, { ...limitsContextFor(msgs, limits, now, await repos.jobs.pendingCounterOffers(tx, conv.id)), lastOutboundAt: null });
  const { limits: _l, deferUntil: _d, ...rest } = limited;
  return rest as unknown as T;
}

/** Offre de lot et situation reconnues dans le dernier message de l'acheteur (politique déterministe, jamais l'IA). */
async function negotiationExtrasTx(tx: Tx, ctx: OrgContext, conv: Conversation, msgs: Message[]): Promise<Pick<ConversationDetail, "bundleOffer" | "situation">> {
  const lastInbound = [...msgs].reverse().find((m) => m.direction === "inbound");
  if (!lastInbound) return { bundleOffer: null, situation: null };
  const org = await repos.orgs.byId(tx, ctx.orgId);
  // Transmission : toute situation « transmettre au vendeur » qui correspond, même moins spécifique qu'une autre.
  const escalation = escalationFor(org, lastInbound.body);
  const match = escalation ?? situationFor(org, lastInbound.body);
  const bundle = lastInbound.offerCents ? await evaluateConversationBundleTx(tx, org, conv, lastInbound, { roundsSoFar: conv.negotiationRounds, now: ctx.services.now() }) : null;
  return {
    bundleOffer: bundle ? { offerCents: bundle.signal.offerCents, itemIds: bundle.items.map((i) => i.id), purchaseTotalCents: bundle.items.reduce((sum, i) => sum + i.purchasePriceCents + i.purchaseFeesCents, 0), evaluation: await limitedTx(tx, org, conv, msgs, ctx.services.now(), applySituationOverride(bundle.result, escalation)) } : null,
    situation: match ? { id: match.situation.id, name: match.situation.name, matchedKeywords: match.matchedKeywords, escalate: situationEscalates(match) } : null,
  };
}

export function getConversation(ctx: OrgContext, id: string): Promise<ConversationDetail> {
  return withOrg(ctx, async (tx) => {
    const conversation = await repos.conversations.byId(tx, id);
    const messages = await repos.messages.forConversation(tx, id);
    const customer = await repos.customers.byId(tx, conversation.customerId);
    const item = conversation.itemId ? await repos.items.byId(tx, conversation.itemId).catch(() => null) : null;
    const connection = conversation.connectionId ? await repos.connections.byId(tx, conversation.connectionId).catch(() => null) : null;
    return { conversation, messages, customer, item, connection, lastOffer: await lastOfferTx(tx, ctx, conversation, messages), ...(await negotiationExtrasTx(tx, ctx, conversation, messages)) };
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
    // Brouillon de relance supprimé (à valider, ou validé et en file pour Selio Cloud) : sa tâche est
    // annulée, et la relance n'est jamais refaite (une tâche annulée compte comme relance faite).
    await tx.query("update jobs set status = 'cancelled', finished_at = $3 where org_id = $1 and status in ('awaiting_approval', 'queued') and payload->>'draftMessageId' = $2", [ctx.orgId, messageId, nowIso(ctx)]);
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
  // Brouillon de relance envoyé depuis Messages : la tâche qui l'attendait est close (jamais renvoyé une seconde fois).
  await tx.query("update jobs set status = 'succeeded', result = $3, finished_at = $4 where org_id = $1 and status in ('awaiting_approval', 'queued') and payload->>'draftMessageId' = $2", [ctx.orgId, messageId, JSON.stringify({ messageId, sentFromMessages: true }), nowIso(ctx)]);
  // Le vendeur a répondu lui-même : les transmissions ouvertes de la conversation (situation, IA) sont closes.
  if (m.source !== "automation") {
    for (const h of await repos.jobs.openHandoffs(tx, conv.id)) await repos.jobs.update(tx, h.id, { status: "succeeded", result: { ...(h.result ?? {}), answeredInMessages: true, messageId }, finishedAt: nowIso(ctx) });
  }
  await repos.audit.add(tx, { actorUserId: ctx.userId, action: "message.sent", targetType: "message", targetId: messageId, meta: { simulated: sent.simulated }, ip: ctx.ip });
  return sent;
}

export function sendMessage(ctx: OrgContext, messageId: string): Promise<Message> {
  requireAction(ctx, "messages.send");
  return withOrg(ctx, (tx) => sendMessageTx(ctx, tx, messageId));
}

export function evaluateConversationOffer(ctx: OrgContext, conversationId: string, offerCents: number): Promise<NegotiationResult> {
  // Simulation d'offre : réservée à qui rédige les réponses (la lecture seule n'en a pas besoin). Pour un rôle
  // sans « finances.read », la marge à l'offre et les raisons chiffrées sont masquées à la sortie de l'API
  // (redactForRole → reasonsWithoutFinances) ; le plancher reste visible (règle de prix, voir DECISIONS).
  requireAction(ctx, "messages.draft");
  if (!Number.isInteger(offerCents) || offerCents < 0) throw new AppError("validation", "Offre invalide", 400);
  return withOrg(ctx, async (tx) => {
    const conv = await repos.conversations.byId(tx, conversationId);
    if (!conv.itemId) throw new AppError("validation", "Cette conversation n'est liée à aucun article.", 400);
    const item = await repos.items.byId(tx, conv.itemId);
    const org = await repos.orgs.byId(tx, ctx.orgId);
    return evaluateOffer({ item, offerCents, rules: org.settings.margin, roundsSoFar: conv.negotiationRounds, now: ctx.services.now() });
  });
}

function situationContext(org: Organization, detail: ConversationDetail): { name: string; guidance: string | null } | null {
  const lastInbound = [...detail.messages].reverse().find((m) => m.direction === "inbound");
  const match = lastInbound ? escalationFor(org, lastInbound.body) ?? situationFor(org, lastInbound.body) : null;
  if (!match) return null;
  const c = situationPromptContext(match);
  return { name: c.name, guidance: c.guidance };
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
  const lot = detail.bundleOffer ?? null;
  const started = Date.now();
  let result;
  try {
    result = await ctx.services.ai.suggestReply(ctx.orgId, {
      buyerName: detail.customer.displayName.split(" ")[0] ?? null,
      itemTitle: detail.item?.title ?? "l'article",
      // Lot : la décision, le prix affiché, le plancher et le coût sont ceux du lot entier (la validation de la
      // sortie porte alors sur le lot : aucun prix par article, aucun prix que la politique n'a pas fixé).
      listedPriceCents: lot ? lot.evaluation.listedTotalCents : detail.item?.listedPriceCents ?? null,
      floorPriceCents: lot ? lot.evaluation.floorCents : detail.item?.floorPriceCents ?? 0,
      purchasePriceCents: lot ? lot.purchaseTotalCents : detail.item?.purchasePriceCents ?? 0,
      decision: lot ? lot.evaluation : detail.lastOffer?.evaluation ?? null,
      offerCents: detail.bundleOffer?.offerCents ?? detail.lastOffer?.offerCents ?? null,
      messages: detail.messages.map((m) => ({ direction: m.direction, body: m.body })),
      settings: { tone: org.settings.ai.tone, signature: org.settings.ai.signature },
      // Lot : la décision de lot est la décision imposée ; situation : nom et consigne du vendeur, bornés (données).
      bundle: detail.bundleOffer ? { count: detail.bundleOffer.evaluation.itemCount, totalListedCents: detail.bundleOffer.evaluation.listedTotalCents, decision: detail.bundleOffer.evaluation } : null,
      situation: situationContext(org, detail),
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
export async function ingestInboundTx(ctx: OrgContext, tx: Tx, input: { connectionId: string | null; provider: Provider; conversationRef: string | null; buyerHandle: string; buyerName?: string | null; itemId?: string | null; itemExternalRef?: string | null; body: string; externalRef?: string | null; at?: string }): Promise<Conversation> {
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
  // L'acheteur a répondu : les relances encore à envoyer (en file pour le Cloud, ou brouillon à valider)
  // n'ont plus lieu d'être. Elles sont écartées et leur brouillon supprimé.
  for (const j of await repos.jobs.pendingFollowUps(tx, conv.id)) {
    await repos.jobs.update(tx, j.id, { status: "skipped", result: { ...(j.result ?? {}), reason: "L'acheteur a répondu : relance abandonnée.", code: "buyer_replied" }, finishedAt: nowIso(ctx) });
    const draftId = typeof j.payload.draftMessageId === "string" ? j.payload.draftMessageId : null;
    const draft = draftId ? await repos.messages.byId(tx, draftId).catch(() => null) : null;
    if (draft && draft.status === "draft") await repos.messages.delete(tx, draft.id);
  }
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
