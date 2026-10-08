import { connectionCreate, type ConnectionTestResult, type ExtensionToken, type MarketplaceConnection } from "@selio/contracts";
import { repos, hashSecret, newSecret, secretsMatch } from "@selio/db";
import { describeConnectors, getConnector } from "@selio/connectors";
import { PLAN_QUOTAS } from "@selio/demo-data";
import { AppError, nowIso, requireAction, withOrg, type OrgContext, type Services } from "../context";
import { ingestInboundTx } from "./messaging";

export const describe = () => describeConnectors();
export const listConnections = (ctx: OrgContext) => withOrg(ctx, (tx) => repos.connections.list(tx));

export function createConnection(ctx: OrgContext, raw: unknown): Promise<MarketplaceConnection> {
  requireAction(ctx, "connections.manage");
  const parsed = connectionCreate.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", "Connexion invalide", 400, parsed.error.flatten());
  return withOrg(ctx, async (tx) => {
    const quotas = (await repos.subscriptions.get(tx))?.quotas ?? PLAN_QUOTAS.free;
    if ((await repos.connections.count(tx)) >= quotas.connections) throw new AppError("quota_exceeded", `Quota de connexions atteint (${quotas.connections}).`, 402);
    const desc = getConnector(parsed.data.provider).describe();
    const id = newSecret(12);
    const c = await repos.connections.create(tx, {
      id, provider: parsed.data.provider, label: parsed.data.label, status: parsed.data.provider === "demo" ? "connected" : "ready", capabilities: desc.capabilities, config: parsed.data.config ?? {}, transport: desc.transport,
      secretCiphertext: parsed.data.secret ? ctx.services.secrets.encrypt(parsed.data.secret, id) : null,
    });
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "connection.created", targetType: "marketplace_connection", targetId: c.id, meta: { provider: c.provider }, ip: ctx.ip });
    return c;
  });
}

export function testConnection(ctx: OrgContext, id: string): Promise<ConnectionTestResult> {
  requireAction(ctx, "connections.manage");
  return withOrg(ctx, async (tx) => {
    const c = await repos.connections.byId(tx, id);
    const res = await getConnector(c.provider).test({ orgId: ctx.orgId, connectionId: c.id, config: c.config, now: ctx.services.now() });
    await repos.connections.update(tx, id, { status: c.status === "disconnected" ? "disconnected" : res.status, lastTestAt: res.testedAt, lastError: res.ok ? null : res.message, capabilities: res.capabilities });
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "connection.tested", targetType: "marketplace_connection", targetId: id, meta: { status: res.status }, ip: ctx.ip });
    return res;
  });
}

export function syncConnection(ctx: OrgContext, id: string): Promise<{ conversations: number; items: number; orders: number; simulated: boolean }> {
  requireAction(ctx, "connections.manage");
  return withOrg(ctx, async (tx) => {
    const c = await repos.connections.byId(tx, id);
    if (c.status !== "connected" && c.status !== "degraded") throw new AppError("connector_unavailable", `La connexion est « ${c.status} » : synchronisation impossible.`, 409);
    const connector = getConnector(c.provider);
    if (!connector.readConversations) throw new AppError("connector_unavailable", "Ce connecteur ne permet pas la lecture des conversations côté serveur (elle passe par l'extension).", 409);
    const res = await connector.readConversations({ orgId: ctx.orgId, connectionId: c.id, config: c.config, now: ctx.services.now() });
    if (!res.ok) {
      await repos.connections.update(tx, id, { status: "degraded", lastError: res.message });
      throw new AppError("connector_unavailable", res.message, 502);
    }
    let conversations = 0;
    for (const ext of res.data) {
      for (const m of ext.messages) await ingestInboundTx(ctx, tx, { connectionId: c.id, provider: c.provider, conversationRef: ext.externalRef, buyerHandle: ext.buyerHandle, itemExternalRef: ext.itemExternalRef, body: m.body, externalRef: m.externalRef, at: m.at });
      conversations++;
    }
    await repos.connections.update(tx, id, { lastSyncAt: nowIso(ctx), lastError: null });
    await repos.usage.record(tx, "connector.sync", { connectionId: id });
    return { conversations, items: 0, orders: 0, simulated: res.simulated };
  });
}

export function disconnectConnection(ctx: OrgContext, id: string): Promise<MarketplaceConnection> {
  requireAction(ctx, "connections.manage");
  return withOrg(ctx, async (tx) => {
    const c = await repos.connections.update(tx, id, { status: "disconnected", secretCiphertext: null });
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "connection.revoked", targetType: "marketplace_connection", targetId: id, ip: ctx.ip });
    return c;
  });
}

export function deleteConnection(ctx: OrgContext, id: string): Promise<void> {
  requireAction(ctx, "connections.manage");
  return withOrg(ctx, async (tx) => {
    await repos.connections.delete(tx, id);
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "connection.deleted", targetType: "marketplace_connection", targetId: id, ip: ctx.ip });
  });
}

/** Marque l'extension comme vue (statut de la connexion Vinted). */
export function touchExtension(ctx: OrgContext): Promise<void> {
  return withOrg(ctx, async (tx) => {
    for (const c of await repos.connections.list(tx)) {
      if (c.provider !== "vinted" || c.status === "disconnected") continue;
      await repos.connections.update(tx, c.id, { config: { ...c.config, extensionLastSeenAt: nowIso(ctx) }, status: "connected", lastError: null });
    }
  });
}

// ---- jetons d'extension ----
const TOKEN_SCOPES = ["capture:items", "read:rules", "draft:messages", "sync:conversations"] as const;

export const listTokens = (ctx: OrgContext) => withOrg(ctx, (tx) => repos.tokens.list(tx));

export function createToken(ctx: OrgContext, label: string): Promise<{ token: ExtensionToken; secret: string }> {
  requireAction(ctx, "tokens.manage");
  const prefix = `slx_${newSecret(6).replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toLowerCase()}`;
  const secretPart = newSecret(32);
  const secret = `${prefix}.${secretPart}`;
  return withOrg(ctx, async (tx) => {
    const token = await repos.tokens.create(tx, { userId: ctx.userId, label: (label || "Extension").slice(0, 80), prefix, secretHash: hashSecret(secretPart), scopes: [...TOKEN_SCOPES], expiresAt: new Date(ctx.services.now().getTime() + 90 * 86_400_000).toISOString() });
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "token.created", targetType: "extension_token", targetId: token.id, meta: { label: token.label }, ip: ctx.ip });
    return { token, secret };
  });
}

export function revokeToken(ctx: OrgContext, id: string): Promise<void> {
  requireAction(ctx, "tokens.manage");
  return withOrg(ctx, async (tx) => {
    await repos.tokens.revoke(tx, id);
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "token.revoked", targetType: "extension_token", targetId: id, ip: ctx.ip });
  });
}

/** Authentifie un jeton d'extension `prefix.secret` ; renvoie l'organisation et l'utilisateur liés. */
export async function authenticateToken(services: Services, raw: string): Promise<{ orgId: string; userId: string; scopes: string[]; tokenId: string } | null> {
  const [prefix, secretPart] = raw.split(".");
  if (!prefix || !secretPart || !/^slx_[a-z0-9]{4,8}$/.test(prefix)) return null;
  const found = await services.db.withGlobal((tx) => repos.tokens.findByPrefix(tx, prefix));
  if (!found || found.revokedAt || new Date(found.expiresAt).getTime() < services.now().getTime()) return null;
  if (!secretsMatch(secretPart, found.secretHash)) return null;
  await services.db.withGlobal((tx) => repos.tokens.touch(tx, found.id));
  return { orgId: found.orgId, userId: found.userId, scopes: found.scopes, tokenId: found.id };
}
