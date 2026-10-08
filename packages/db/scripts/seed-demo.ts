/**
 * Insère l'organisation de démonstration en base (mode connecté) :
 * utile pour une recette sur un environnement réel sans données.
 * Utilisateur : marie@demo.selio.local / mot de passe : demo-selio-2026
 */
import { buildDemoState } from "@selio/demo-data";
import { createPool } from "../src/pool";
import { Db } from "../src/pool";
import { hashPassword } from "../src/crypto";
import * as repos from "../src/repos";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL manquante");
  process.exit(1);
}
const db = new Db(createPool(url, { max: 2 }));

async function main() {
  const state = buildDemoState(new Date());
  const { hash, salt } = await hashPassword("demo-selio-2026");
  const orgId = await db.withGlobal(async (tx) => {
    const existing = await repos.users.byEmail(tx, state.user.email);
    if (existing) {
      console.info("Le compte de démonstration existe déjà, rien à faire.");
      return null;
    }
    const user = await repos.users.create(tx, { email: state.user.email, displayName: state.user.displayName, passwordHash: hash, passwordSalt: salt, isOperator: true });
    const org = await repos.orgs.create(tx, { name: state.org.name, slug: `${state.org.slug}-${Date.now().toString(36)}`, settings: state.org.settings });
    await repos.memberships.create(tx, { orgId: org.id, userId: user.id, role: "owner" });
    return org.id;
  });
  if (!orgId) return;
  await db.withOrg(orgId, async (tx) => {
    const idMap = new Map<string, string>();
    const remap = (id: string | null) => (id ? (idMap.get(id) ?? null) : null);
    for (const c of state.connections) { const { id, orgId: _o, hasSecret: _h, ...rest } = c; const row = await repos.connections.create(tx, rest); idMap.set(id, row.id); }
    for (const it of state.items) { const { id, orgId: _o, ...rest } = it; const row = await repos.items.create(tx, { ...rest, connectionId: remap(it.connectionId) }); idMap.set(id, row.id); }
    for (const c of state.customers) { const { id, orgId: _o, ...rest } = c; const row = await repos.customers.create(tx, rest); idMap.set(id, row.id); }
    for (const c of state.conversations) { const { id, orgId: _o, ...rest } = c; const row = await repos.conversations.create(tx, { ...rest, customerId: remap(c.customerId)!, itemId: remap(c.itemId), connectionId: remap(c.connectionId) }); idMap.set(id, row.id); }
    for (const m of state.messages) { const { id: _i, orgId: _o, ...rest } = m; await repos.messages.create(tx, { ...rest, conversationId: remap(m.conversationId)!, externalRef: m.externalRef ? `${m.externalRef}-${Date.now().toString(36)}` : null }); }
    for (const o of state.orders) { const { id, orgId: _o, ...rest } = o; const row = await repos.orders.create(tx, { ...rest, itemId: remap(o.itemId)!, customerId: remap(o.customerId)!, connectionId: remap(o.connectionId) }); idMap.set(id, row.id); }
    for (const s of state.shipments) { const { id: _i, orgId: _o, ...rest } = s; await repos.shipments.upsert(tx, remap(s.orderId)!, rest); }
    for (const r of state.rules) { const { id, orgId: _o, ...rest } = r; const row = await repos.rules.create(tx, rest); idMap.set(id, row.id); }
    for (const j of state.jobs) { const { id: _i, orgId: _o, ...rest } = j; await repos.jobs.create(tx, { ...rest, ruleId: remap(j.ruleId) }); }
    for (const s of state.searches) { const { id, orgId: _o, ...rest } = s; const row = await repos.searches.create(tx, rest); idMap.set(id, row.id); }
    for (const o of state.opportunities) { const { id: _i, orgId: _o, ...rest } = o; await repos.opportunities.create(tx, { ...rest, searchId: remap(o.searchId)! }); }
    await repos.subscriptions.upsert(tx, { plan: state.subscription.plan, status: state.subscription.status, provider: "none", quotas: state.subscription.quotas, testMode: true, currentPeriodEnd: state.subscription.currentPeriodEnd });
    await repos.audit.add(tx, { actorUserId: null, action: "demo.seeded", meta: {} });
  });
  console.info(`Organisation de démonstration créée (${orgId}). Connexion : ${state.user.email} / demo-selio-2026`);
}

main()
  .then(() => db.close())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
