import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AIError, AIService, MockAIProvider, type AIProvider } from "@selio/ai";
import { ACCOUNT_CHECKLIST, ACCOUNT_CHECKLIST_STEP_IDS, COMPTES_INDEPENDENCE_NOTICE, quotasForPlan, type Role } from "@selio/contracts";
import { Db, MIGRATIONS_DIR, SecretBox, createPool, repos, runMigrations, type PgPool } from "@selio/db";
import type { OrgContext, Services } from "../context";
import * as comptes from "./comptes";

/**
 * Selio Comptes (§5.15) sur PostgreSQL, base dédiée selio_test_core_comptes (créée si besoin : Vitest 3 en
 * espace de travail peut lancer les fichiers en parallèle). Mon IA perso est le simulateur : aucun appel
 * réseau, et surtout aucun appel vers Vinted (le service n'en connaît aucun). Ignoré si la base n'est pas joignable.
 */
const OWNER_URL = process.env.TEST_CORE_COMPTES_DATABASE_URL ?? "postgres://selio:selio@127.0.0.1:5432/selio_test_core_comptes";
const APP_URL = process.env.TEST_CORE_COMPTES_DATABASE_URL_APP ?? "postgres://selio_app:selio_app@127.0.0.1:5432/selio_test_core_comptes";

let available = true;
let owner: PgPool;
let db: Db;
let seq = 0;

function aiWith(provider: AIProvider): AIService {
  return new AIService({ provider, concurrency: 2, maxPending: 20, circuitFailures: 1000, circuitCooldownMs: 1000, timeoutMs: 5000, allowFallback: false });
}

function servicesWith(provider: AIProvider = new MockAIProvider()): Services {
  return { db, ai: aiWith(provider), secrets: new SecretBox(SecretBox.generateKey()), now: () => new Date(), allowAiFallback: false, version: "test" };
}

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
    await owner.query("truncate users, organizations, rate_limits cascade");
  } catch {
    available = false;
    return;
  }
  db = new Db(createPool(APP_URL, { max: 4 }));
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
});

let ctx: OrgContext;

/** Organisation Pro avec son titulaire ; `as(role)` donne le contexte d'un autre rôle de la même organisation. */
async function setupOrg(services: Services, settings: Record<string, unknown> = {}): Promise<OrgContext> {
  const n = ++seq;
  const ids = await db.withGlobal(async (tx) => {
    const user = await repos.users.create(tx, { email: `comptes${n}@test.local`, displayName: `Titulaire ${n}`, passwordHash: "x", passwordSalt: "y" });
    const o = await repos.orgs.create(tx, { name: `Boutique Comptes ${n}`, slug: `boutique-comptes-${n}`, settings });
    await repos.memberships.create(tx, { orgId: o.id, userId: user.id, role: "owner" });
    return { userId: user.id, orgId: o.id };
  });
  await db.withOrg(ids.orgId, (tx) => repos.subscriptions.upsert(tx, { plan: "pro", status: "active", provider: "none", quotas: quotasForPlan("pro") }));
  return { services, orgId: ids.orgId, userId: ids.userId, role: "owner", isOperator: false, ip: "203.0.113.20" };
}

const as = (c: OrgContext, role: Role): OrgContext => ({ ...c, role });

async function expectForbidden(p: Promise<unknown>): Promise<void> {
  await expect(p).rejects.toMatchObject({ code: "forbidden", status: 403 });
}

const aiRows = (orgId: string) => db.withOrg(orgId, (tx) => tx.query<{ kind: string; status: string; validated: boolean }>("select kind, status, validated from ai_requests where org_id = $1 order by created_at", [orgId]));
const auditActions = async (orgId: string) => (await db.withOrg(orgId, (tx) => repos.audit.list(tx, 100))).map((a) => ({ action: a.action, meta: a.meta }));

describe("Selio Comptes : checklist et progression", () => {
  beforeEach(async () => {
    if (!available) return;
    ctx = await setupOrg(servicesWith());
  });

  it("checklist fixe dans l'ordre, mentions d'indépendance et de périmètre, rien de coché au départ", async () => {
    if (!available) return;
    const view = await comptes.getChecklist(ctx);
    expect(view.steps.map((s) => s.id)).toEqual([...ACCOUNT_CHECKLIST_STEP_IDS]);
    expect(view.steps.map((s) => s.title)).toEqual(ACCOUNT_CHECKLIST.map((s) => s.title));
    expect(view.steps.find((s) => s.id === "what_not_to_do")!.actions.join(" ")).toMatch(/multi-comptes/);
    expect(view.steps.find((s) => s.id === "what_not_to_do")!.actions.join(" ")).toMatch(/faux avis/);
    expect(view.independenceNotice).toBe(COMPTES_INDEPENDENCE_NOTICE);
    expect(view.scopeNotice).toMatch(/ne fait aucune action à votre place/);
    expect(view.progress).toEqual({ steps: ACCOUNT_CHECKLIST_STEP_IDS.map((stepId) => ({ stepId, done: false, doneAt: null })), done: 0, total: 8, percent: 0 });
    // Aucun texte de la checklist ne promet un résultat ni une affiliation.
    expect(JSON.stringify(view.steps)).not.toMatch(/zéro risque|100 %|partenaire|première position/i);
  });

  it("cocher, garder la date, décocher : progression par organisation, auditée seulement au changement", async () => {
    if (!available) return;
    const p1 = await comptes.setProgress(ctx, { stepId: "username", done: true });
    expect(p1).toMatchObject({ done: 1, total: 8, percent: 13 });
    const firstAt = p1.steps.find((s) => s.stepId === "username")!.doneAt;
    expect(firstAt).toBeTruthy();
    await new Promise((r) => setTimeout(r, 5));
    const p2 = await comptes.setProgress(ctx, { stepId: "username", done: true });
    expect(p2.steps.find((s) => s.stepId === "username")!.doneAt).toBe(firstAt);
    await comptes.setProgress(ctx, { stepId: "presentation", done: true });
    const p3 = await comptes.setProgress(ctx, { stepId: "username", done: false });
    expect(p3).toMatchObject({ done: 1, percent: 13 });
    expect(p3.steps.find((s) => s.stepId === "username")).toEqual({ stepId: "username", done: false, doneAt: null });
    expect((await comptes.getChecklist(ctx)).steps.find((s) => s.id === "presentation")!.done).toBe(true);
    const actions = (await auditActions(ctx.orgId)).map((a) => a.action).filter((a) => a.startsWith("comptes."));
    expect(actions.sort()).toEqual(["comptes.step_checked", "comptes.step_checked", "comptes.step_unchecked"]);
    // Une autre organisation ne voit rien de cette progression (RLS).
    const other = await setupOrg(servicesWith());
    expect((await comptes.getProgress(other)).done).toBe(0);
  });

  it("étape inconnue refusée ; droits : lecture pour tous sauf le contributeur photos, cocher pour titulaire et administrateur", async () => {
    if (!available) return;
    await expect(comptes.setProgress(ctx, { stepId: "inconnue", done: true })).rejects.toMatchObject({ code: "validation", status: 400 });
    await expect(comptes.setProgress(ctx, { stepId: "username" })).rejects.toMatchObject({ status: 400 });
    for (const role of ["admin", "operator", "viewer"] as const) expect((await comptes.getChecklist(as(ctx, role))).steps).toHaveLength(8);
    await expectForbidden(comptes.getChecklist(as(ctx, "photographer")));
    await expectForbidden(comptes.getProgress(as(ctx, "photographer")));
    expect((await comptes.setProgress(as(ctx, "admin"), { stepId: "profile_photo", done: true })).done).toBe(1);
    for (const role of ["operator", "photographer", "viewer"] as const) await expectForbidden(comptes.setProgress(as(ctx, role), { stepId: "username", done: true }));
  });
});

describe("Selio Comptes : textes rédigés par mon IA perso", () => {
  it("mon IA perso rédige (requête IA décomptée, validée), sans chiffre ; audit sans texte ni nom de boutique", async () => {
    if (!available) return;
    ctx = await setupOrg(servicesWith());
    const r = await comptes.generateTexts(ctx, { style: "vintage", tone: "friendly", shopName: "Chez Lou" });
    expect(r).toMatchObject({ source: "ai", reason: null, style: "vintage", tone: "friendly", provider: "mock", simulated: true, independenceNotice: COMPTES_INDEPENDENCE_NOTICE });
    expect(r.message).toMatch(/recopiez-les vous-même dans Vinted/);
    expect(r.texts.presentation).toContain("Chez Lou");
    expect(r.texts.cannedReplies.length).toBeGreaterThanOrEqual(3);
    expect(r.texts.hashtags).toContain("#vintage");
    expect(JSON.stringify(r.texts)).not.toMatch(/\d/);
    expect(await aiRows(ctx.orgId)).toEqual([{ kind: "listing_description", status: "succeeded", validated: true }]);
    const audit = (await auditActions(ctx.orgId)).find((a) => a.action === "comptes.texts_generated");
    expect(audit?.meta).toEqual({ style: "vintage", tone: "friendly", source: "ai", reason: null });
    expect(JSON.stringify(audit)).not.toContain("Chez Lou");
    // Ton par défaut : chaleureux ; nom de boutique facultatif.
    expect((await comptes.generateTexts(ctx, { style: "sport" })).tone).toBe("friendly");
  });

  it("entrée invalide 400 ; exécuteur autorisé ; lecture seule et contributeur photos refusés", async () => {
    if (!available) return;
    ctx = await setupOrg(servicesWith());
    await expect(comptes.generateTexts(ctx, { style: "bijoux" })).rejects.toMatchObject({ code: "validation", status: 400 });
    await expect(comptes.generateTexts(ctx, { style: "femme", tone: "agressif" })).rejects.toMatchObject({ status: 400 });
    await expect(comptes.generateTexts(ctx, { style: "femme", shopName: "<script>" })).rejects.toMatchObject({ status: 400 });
    expect((await comptes.generateTexts(as(ctx, "operator"), { style: "femme" })).source).toBe("ai");
    await expectForbidden(comptes.generateTexts(as(ctx, "viewer"), { style: "femme" }));
    await expectForbidden(comptes.generateTexts(as(ctx, "photographer"), { style: "femme" }));
  });

  it("IA désactivée ou quota atteint : gabarit sans IA signalé, aucune requête IA créée", async () => {
    if (!available) return;
    const off = await setupOrg(servicesWith(), { ai: { enabled: false } });
    const r = await comptes.generateTexts(off, { style: "homme", tone: "neutral" });
    expect(r).toMatchObject({ source: "template", reason: "ai_disabled", provider: null, simulated: false });
    expect(r.message).toMatch(/Gabarit sans IA/);
    expect(await aiRows(off.orgId)).toEqual([]);

    const capped = await setupOrg(servicesWith(), { ai: { monthlyRequestQuota: 1 } });
    expect((await comptes.generateTexts(capped, { style: "enfant" })).source).toBe("ai");
    const over = await comptes.generateTexts(capped, { style: "enfant" });
    expect(over).toMatchObject({ source: "template", reason: "quota_exceeded" });
    expect(await aiRows(capped.orgId)).toHaveLength(1);
  });

  it("sortie invalide ou panne de mon IA perso : gabarit, requête marquée écartée ou en échec", async () => {
    if (!available) return;
    const invalid = await setupOrg(servicesWith(new MockAIProvider({ invalidOutput: true })));
    expect(await comptes.generateTexts(invalid, { style: "luxe" })).toMatchObject({ source: "template", reason: "invalid_output" });
    expect((await aiRows(invalid.orgId))[0]).toMatchObject({ status: "rejected" });

    const down = await setupOrg(servicesWith(new MockAIProvider({ failWith: new AIError("unavailable", "Ollama injoignable (simulé)", true) })));
    const r = await comptes.generateTexts(down, { style: "mixte", tone: "concise" });
    expect(r).toMatchObject({ source: "template", reason: "ai_unavailable", tone: "concise" });
    expect(r.texts.cannedReplies.length).toBeGreaterThanOrEqual(3);
    expect((await aiRows(down.orgId))[0]).toMatchObject({ status: "failed" });
  });

  it("une sortie qui invente une information sur la personne est écartée (validation, puis gabarit)", async () => {
    if (!available) return;
    // Fournisseur qui « invente » : prénom et âge de la personne, ce que la validation refuse.
    const inventing: AIProvider = Object.assign(Object.create(MockAIProvider.prototype) as MockAIProvider, new MockAIProvider(), {
      async generateStructured(req: Parameters<MockAIProvider["generateStructured"]>[0]) {
        const base = await new MockAIProvider().generateStructured(req);
        const data = { ...(base.data as Record<string, unknown>), presentation: "Je m'appelle Julie, j'ai trente ans et je vends le dressing de ma fille." };
        return { ...base, data, raw: JSON.stringify(data) } as typeof base;
      },
    });
    const c = await setupOrg(servicesWith(inventing));
    const r = await comptes.generateTexts(c, { style: "femme" });
    expect(r).toMatchObject({ source: "template", reason: "invalid_output" });
    expect(r.texts.presentation).not.toMatch(/Julie|trente/);
  });
});
