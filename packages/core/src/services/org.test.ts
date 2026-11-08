import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAIService } from "@selio/ai";
import { quotasForPlan, type Role } from "@selio/contracts";
import { Db, MIGRATIONS_DIR, SecretBox, createPool, repos, runMigrations, type PgPool } from "@selio/db";
import type { EmailMessage } from "@selio/email";
import type { OrgContext, Services } from "../context";
import * as org from "./org";

/**
 * Invitations avec les rôles d'équipe (§5.15) sur PostgreSQL (base dédiée selio_test_core_org, créée si besoin).
 * Emails factices (aucun envoi). Ignoré si la base n'est pas joignable.
 */
const OWNER_URL = process.env.TEST_CORE_ORG_DATABASE_URL ?? "postgres://selio:selio@127.0.0.1:5432/selio_test_core_org";
const APP_URL = process.env.TEST_CORE_ORG_DATABASE_URL_APP ?? "postgres://selio_app:selio_app@127.0.0.1:5432/selio_test_core_org";

let available = true;
let owner: PgPool;
let services: Services;
const sent: EmailMessage[] = [];
let seq = 0;

async function ensureDatabase(): Promise<void> {
  const url = new URL(OWNER_URL);
  const dbName = url.pathname.replace(/^\//, "");
  url.pathname = "/postgres";
  const admin = createPool(url.toString(), { max: 1 });
  try {
    const exists = await admin.query("select 1 from pg_database where datname = $1", [dbName]);
    if (exists.rowCount === 0) await admin.query(`create database "${dbName.replace(/"/g, "")}"`);
  } finally {
    await admin.end();
  }
}

beforeAll(async () => {
  try {
    await ensureDatabase();
    owner = createPool(OWNER_URL, { max: 2 });
    await runMigrations(owner, MIGRATIONS_DIR);
    await owner.query("truncate users, organizations, payment_events, rate_limits cascade");
  } catch {
    available = false;
    return;
  }
  services = {
    db: new Db(createPool(APP_URL, { max: 4 })),
    ai: createAIService({ env: { AI_PROVIDER: "mock" }, allowFallback: false }),
    secrets: new SecretBox(SecretBox.generateKey()),
    now: () => new Date("2026-11-08T10:00:00.000Z"),
    allowAiFallback: false,
    version: "test",
    email: { send: async (m) => { sent.push(m); return { id: `mail-${sent.length}` }; } },
    publicWebUrl: "https://selio.example",
    config: {},
  };
});

afterAll(async () => {
  await services?.db.close();
  await owner?.end();
});

/** Organisation Agence (assez de places pour l'équipe) avec son titulaire. */
async function setupOrg(): Promise<OrgContext> {
  const n = ++seq;
  const ids = await services.db.withGlobal(async (tx) => {
    const u = await repos.users.create(tx, { email: `titulaire${n}@test.local`, displayName: `Titulaire ${n}`, passwordHash: "x", passwordSalt: "y" });
    const o = await repos.orgs.create(tx, { name: `Org Équipe ${n}`, slug: `org-equipe-${n}`, settings: {} });
    await repos.memberships.create(tx, { orgId: o.id, userId: u.id, role: "owner" });
    return { userId: u.id, orgId: o.id };
  });
  await services.db.withOrg(ids.orgId, (tx) => repos.subscriptions.upsert(tx, { plan: "agence", status: "active", quotas: quotasForPlan("agence") }));
  return { services, orgId: ids.orgId, userId: ids.userId, role: "owner", isOperator: false, ip: null };
}

describe("invitations et rôles d'équipe", () => {
  it("accepte les nouveaux rôles : administrateur, exécuteur, contributeur photos, lecture seule", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const roles: Role[] = ["admin", "operator", "photographer", "viewer"];
    for (const [i, role] of roles.entries()) {
      const m = await org.inviteMember(ctx, { email: `membre${seq}-${i}@test.local`, role });
      expect(m.role).toBe(role);
    }
    const members = await org.listMembers(ctx);
    expect(members.map((m) => m.role).sort()).toEqual(["admin", "operator", "owner", "photographer", "viewer"]);
    expect(sent.length).toBeGreaterThanOrEqual(4);
    // Rôle inconnu : refusé par la validation.
    await expect(org.inviteMember(ctx, { email: `x${seq}@test.local`, role: "superadmin" })).rejects.toMatchObject({ code: "validation", status: 400 });
  });

  it("un administrateur ne peut pas inviter un titulaire ; le titulaire non plus par invitation ; les autres rôles n'invitent pas", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const admin = await org.inviteMember(ctx, { email: `adjoint${seq}@test.local`, role: "admin" });
    const adminCtx: OrgContext = { ...ctx, userId: admin.userId, role: "admin" };
    await expect(org.inviteMember(adminCtx, { email: `patron${seq}@test.local`, role: "owner" })).rejects.toMatchObject({ code: "forbidden", status: 403 });
    await expect(org.inviteMember(ctx, { email: `patron${seq}@test.local`, role: "owner" })).rejects.toMatchObject({ code: "validation", status: 400 });
    // L'administrateur invite un contributeur photos.
    expect((await org.inviteMember(adminCtx, { email: `photos${seq}@test.local`, role: "photographer" })).role).toBe("photographer");
    for (const role of ["operator", "photographer", "viewer"] as Role[]) {
      await expect(org.inviteMember({ ...ctx, role }, { email: `refus-${role}${seq}@test.local`, role: "viewer" })).rejects.toMatchObject({ status: 403 });
    }
    // Rien n'a été créé pour les invitations refusées.
    const emails = (await org.listMembers(ctx)).map((m) => m.user.email);
    expect(emails.some((e) => e.startsWith("patron") || e.startsWith("refus-"))).toBe(false);
  });

  it("changement de rôle vers contributeur photos : ses appareils ne reçoivent plus les alertes Radar", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const m = await org.inviteMember(ctx, { email: `exec${seq}@test.local`, role: "operator" });
    await services.db.withOrg(ctx.orgId, (tx) => repos.pushSubscriptions.upsert(tx, { userId: m.userId, endpoint: `https://push.example/exec-${seq}`, p256dh: "p256dh-test", auth: "auth-test", userAgent: null }));
    await org.updateMemberRole(ctx, m.id, "photographer");
    expect((await org.listMembers(ctx)).find((x) => x.id === m.id)?.role).toBe("photographer");
    expect(await services.db.withOrg(ctx.orgId, (tx) => repos.pushSubscriptions.listActive(tx, m.userId))).toHaveLength(0);
    // Un administrateur ne nomme pas de titulaire.
    const admin = await org.inviteMember(ctx, { email: `adm${seq}@test.local`, role: "admin" });
    await expect(org.updateMemberRole({ ...ctx, userId: admin.userId, role: "admin" }, m.id, "owner")).rejects.toMatchObject({ status: 403 });
  });
});
