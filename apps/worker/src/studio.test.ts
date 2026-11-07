import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAIService } from "@selio/ai";
import { quotasForPlan, type Plan } from "@selio/contracts";
import { Db, MIGRATIONS_DIR, SecretBox, createPool, repos, runMigrations, type PgPool } from "@selio/db";
import { FakeWornPhotoProvider, NO_WORN_PROVIDER_MESSAGE, NoopWornPhotoProvider, createWornPhotoProvider, wornPhotos, type OrgContext, type Services } from "@selio/core";
import { loadEnv, maintenanceSchedules, studioServicesConfig } from "./config";
import { STUDIO_WORN_BATCH, studioRetention, studioWornTick } from "./studio";
import { retentionTick } from "./tasks";

/**
 * Selio Studio côté worker (photos portées la nuit, rétention des préparations), sur PostgreSQL, base DÉDIÉE
 * (selio_test_worker_studio, créée si besoin) : Vitest 3 en espace de travail peut faire tourner les fichiers
 * de tests du paquet en même temps, et ce fichier vide les organisations, la file des photos portées et les
 * préparations de SA base. Aucun fournisseur réel : « noop » (refus) et le fournisseur de test. Ignoré si la
 * base n'est pas joignable.
 */
const OWNER_URL = process.env.TEST_WORKER_STUDIO_DATABASE_URL ?? "postgres://selio:selio@127.0.0.1:5432/selio_test_worker_studio";
const APP_URL = process.env.TEST_WORKER_STUDIO_DATABASE_URL_APP ?? "postgres://selio_app:selio_app@127.0.0.1:5432/selio_test_worker_studio";

/** 4 novembre 2026, 11 h à Paris (UTC+1) : hors de la fenêtre de nuit. */
const DAY = new Date("2026-11-04T10:00:00.000Z");
/** 22 h 30 à Paris le même jour : dans la fenêtre. */
const NIGHT = new Date("2026-11-04T21:30:00.000Z");
/** 6 h 30 à Paris le lendemain : la fenêtre est finie. */
const MORNING = new Date("2026-11-05T05:30:00.000Z");
const silent = { info: () => {}, warn: () => {}, error: () => {} };
const base = { DATABASE_URL: "postgres://x", REDIS_URL: "redis://127.0.0.1:6379", SECRETS_ENCRYPTION_KEY: "k".repeat(44) };

let available = true;
let owner: PgPool;
let services: Services;
let clock = new Date(DAY);
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
    now: () => new Date(clock),
    allowAiFallback: false,
    version: "test",
    config: {},
  };
});

afterAll(async () => {
  await services?.db.close();
  await owner?.end();
});

beforeEach(async () => {
  clock = new Date(DAY);
  if (!available || !services) return;
  // Réglages par défaut du worker (nuit 22 h – 6 h à Paris, dépassement fermé) et fournisseur « noop ».
  services.config = studioServicesConfig(loadEnv(base));
  services.wornPhotos = new NoopWornPhotoProvider();
  // File des photos portées : propre à cette base de test (le passage traite toutes les organisations).
  await owner.query("truncate worn_photo_jobs, studio_preps");
});

async function setupOrg(plan: Plan = "pro"): Promise<OrgContext> {
  const n = ++seq;
  const ids = await services.db.withGlobal(async (tx) => {
    const u = await repos.users.create(tx, { email: `wstudio${n}@test.local`, displayName: `Owner ${n}`, passwordHash: "x", passwordSalt: "y" });
    const o = await repos.orgs.create(tx, { name: `Org W Studio ${n}`, slug: `org-w-studio-${n}`, settings: {} });
    await repos.memberships.create(tx, { orgId: o.id, userId: u.id, role: "owner" });
    return { userId: u.id, orgId: o.id };
  });
  await services.db.withOrg(ids.orgId, (tx) => repos.subscriptions.upsert(tx, { plan, status: "active", quotas: quotasForPlan(plan) }));
  return { services, orgId: ids.orgId, userId: ids.userId, role: "owner", isOperator: false, ip: null };
}

const photoKey = (ctx: OrgContext, name = "face") => `org/${ctx.orgId}/studio-photo/${name}.jpg`;
const used = (ctx: OrgContext) => services.db.withOrg(ctx.orgId, (tx) => repos.usage.sumKindSince(tx, "studio.worn_photo", "2026-11-01T00:00:00.000Z"));
const jobOf = async (ctx: OrgContext, id: string) => (await services.db.withOrg(ctx.orgId, (tx) => repos.wornPhotoJobs.byId(tx, id)))!;

// ---------------------------------------------------------------- configuration (pure)

describe("worker : Studio (configuration)", () => {
  it("« studio.worn » toutes les 10 min ; « noop », nuit 22 h – 6 h à Paris, dépassement fermé à 0,25 € par défaut ; « mock » jamais en production", () => {
    const env = loadEnv(base);
    expect(env).toMatchObject({ CRON_STUDIO_WORN: "*/10 * * * *", WORN_PHOTO_PROVIDER: "noop", WORN_NIGHT_WINDOW: { startHour: 22, endHour: 6 }, WORN_NIGHT_TIMEZONE: "Europe/Paris", WORN_OVERAGE_ENABLED: false });
    expect(env.OLLAMA_OCR_MODEL).toBeUndefined();
    expect(maintenanceSchedules(env).find((s) => s.name === "studio.worn")).toEqual({ name: "studio.worn", pattern: "*/10 * * * *" });
    expect(studioServicesConfig(env)).toEqual({ wornOverageEnabled: false, wornOverageUnitCents: 25, wornNightWindow: { startHour: 22, endHour: 6, timezone: "Europe/Paris" } });
    expect(studioServicesConfig(loadEnv({ ...base, WORN_OVERAGE_ENABLED: "true", WORN_OVERAGE_CENTS: "30", WORN_NIGHT_WINDOW: "23h-5h" }))).toEqual({ wornOverageEnabled: true, wornOverageUnitCents: 30, wornNightWindow: { startHour: 23, endHour: 5, timezone: "Europe/Paris" } });
    expect(loadEnv({ ...base, WORN_PHOTO_PROVIDER: "mock" }).WORN_PHOTO_PROVIDER).toBe("mock");
    expect(() => loadEnv({ ...base, WORN_PHOTO_PROVIDER: "service-payant" })).toThrow(/WORN_PHOTO_PROVIDER/);
    expect(() => loadEnv({ ...base, WORN_NIGHT_WINDOW: "nuit" })).toThrow(/WORN_NIGHT_WINDOW/);
    expect(() => loadEnv({ ...base, WORN_OVERAGE_CENTS: "0" })).toThrow(/WORN_OVERAGE_CENTS/);
    expect(() => loadEnv({ ...base, NODE_ENV: "production", AI_PROVIDER: "ollama", WORN_PHOTO_PROVIDER: "mock" })).toThrow(/WORN_PHOTO_PROVIDER=mock est refusé/);
    // Le fournisseur de test n'est jamais créé en production : « noop » à sa place.
    expect(createWornPhotoProvider("mock").name).toBe("mock");
    expect(createWornPhotoProvider("mock", { production: true }).name).toBe("noop");
    expect(createWornPhotoProvider(undefined).name).toBe("noop");
  });
});

// ---------------------------------------------------------------- file de nuit

describe("worker : photos portées la nuit (studio.worn)", () => {
  it("une demande du jour attend la nuit : rien hors de la fenêtre ; la nuit, « noop » refuse proprement et rend le quota", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const job = await wornPhotos.requestWornPhoto(ctx, { photoKey: photoKey(ctx) });
    // Planifiée à 22 h, heure de Paris (21 h UTC en novembre).
    expect(job).toMatchObject({ status: "queued", provider: "noop", scheduledFor: "2026-11-04T21:00:00.000Z" });
    expect(await used(ctx)).toBe(1);
    // 11 h à Paris : hors de la fenêtre, rien n'est lancé.
    const day = await studioWornTick(services, silent);
    expect(day).toMatchObject({ outsideWindow: true, done: 0, refused: 0, failed: 0, interrupted: 0, provider: "noop" });
    expect((await jobOf(ctx, job.id)).status).toBe("queued");
    // 21 h 50 à Paris : toujours hors de la fenêtre.
    clock = new Date("2026-11-04T20:50:00.000Z");
    expect((await studioWornTick(services, silent)).outsideWindow).toBe(true);
    expect((await jobOf(ctx, job.id)).status).toBe("queued");
    // 22 h 30 à Paris : la demande est prise, « noop » la refuse, la place de quota est rendue.
    clock = new Date(NIGHT);
    const logs: string[] = [];
    const night = await studioWornTick(services, { ...silent, info: (_o, m) => { logs.push(m); } });
    expect(night).toMatchObject({ outsideWindow: false, done: 0, refused: 1, failed: 0, provider: "noop" });
    const after = await jobOf(ctx, job.id);
    expect(after).toMatchObject({ status: "refused", error: NO_WORN_PROVIDER_MESSAGE, resultKey: null, overageCents: 0, usageEventId: null });
    expect(after.finishedAt).not.toBeNull();
    expect(await used(ctx)).toBe(0);
    expect(logs.join(" ")).toMatch(/aucun fournisseur configuré : décision à prendre/);
    // Une seule fois : le passage suivant n'y touche plus.
    expect(await studioWornTick(services, silent)).toMatchObject({ refused: 0, done: 0 });
    const audit = await services.db.withOrg(ctx.orgId, (tx) => tx.query<{ action: string }>("select action from audit_logs where target_id = $1 order by created_at", [job.id]));
    expect(audit.map((a) => a.action)).toEqual(["studio.worn_photo_requested", "studio.worn_photo_refused"]);
  });

  it("fournisseur de test : produite la nuit seulement (clé de l'organisation), quota gardé ; fenêtre finie à 6 h → attend la nuit suivante", async () => {
    if (!available) return;
    const fake = new FakeWornPhotoProvider();
    services.wornPhotos = fake;
    const ctx = await setupOrg();
    const job = await wornPhotos.requestWornPhoto(ctx, { photoKey: photoKey(ctx), pose: "back" });
    expect(job.provider).toBe("mock");
    // 6 h 30 le lendemain sans passage pendant la nuit : la fenêtre est finie, la demande attend.
    clock = new Date(MORNING);
    expect(await studioWornTick(services, silent)).toMatchObject({ outsideWindow: true, done: 0 });
    expect(fake.calls).toHaveLength(0);
    clock = new Date("2026-11-05T22:10:00.000Z"); // 23 h 10 à Paris
    expect(await studioWornTick(services, silent)).toMatchObject({ outsideWindow: false, done: 1, provider: "mock" });
    expect(fake.calls).toEqual([expect.objectContaining({ orgId: ctx.orgId, jobId: job.id, photoKey: photoKey(ctx), pose: "back" })]);
    expect(await jobOf(ctx, job.id)).toMatchObject({ status: "done", resultKey: `org/${ctx.orgId}/studio-photo/worn-${job.id}.jpg`, error: null });
    expect(await used(ctx)).toBe(1);
  });

  it("refus, panne ou clé d'une autre organisation : quota rendu ; demande interrompue (worker arrêté) close même le jour ; arrêt du worker → plus rien n'est pris", async () => {
    if (!available) return;
    const fake = new FakeWornPhotoProvider();
    services.wornPhotos = fake;
    const ctx = await setupOrg();
    const other = await setupOrg();
    const a = await wornPhotos.requestWornPhoto(ctx, { photoKey: photoKey(ctx, "a") });
    const b = await wornPhotos.requestWornPhoto(ctx, { photoKey: photoKey(ctx, "b") });
    const c = await wornPhotos.requestWornPhoto(ctx, { photoKey: photoKey(ctx, "c") });
    expect(await used(ctx)).toBe(3);
    fake.next.push(new Error("service injoignable"), { resultKey: `org/${other.orgId}/studio-photo/vol.jpg` }, { refused: "photo refusée par le fournisseur" });
    clock = new Date(NIGHT);
    expect(await studioWornTick(services, silent)).toMatchObject({ done: 0, failed: 2, refused: 1 });
    expect((await jobOf(ctx, a.id)).error).toMatch(/Le fournisseur a échoué : service injoignable/);
    expect((await jobOf(ctx, b.id)).error).toMatch(/pas une clé de stockage de cette organisation/);
    expect(await jobOf(ctx, c.id)).toMatchObject({ status: "refused", error: "photo refusée par le fournisseur" });
    expect(await used(ctx)).toBe(0);

    // Demande restée « en cours » depuis plus d'une heure (worker interrompu) : close au passage suivant, même le jour.
    const d = await wornPhotos.requestWornPhoto(ctx, { photoKey: photoKey(ctx, "d") });
    await owner.query("update worn_photo_jobs set status = 'running', started_at = $2 where id = $1", [d.id, new Date(NIGHT.getTime() - 2 * 3_600_000).toISOString()]);
    clock = new Date("2026-11-05T10:00:00.000Z");
    expect(await studioWornTick(services, silent)).toMatchObject({ outsideWindow: true, interrupted: 1 });
    expect(await jobOf(ctx, d.id)).toMatchObject({ status: "failed" });
    expect((await jobOf(ctx, d.id)).error).toMatch(/Interrompue/);
    expect(await used(ctx)).toBe(0);

    // Arrêt du worker : le signal est déjà levé, aucune demande n'est prise.
    await wornPhotos.requestWornPhoto(ctx, { photoKey: photoKey(ctx, "e") });
    clock = new Date("2026-11-05T22:30:00.000Z");
    const stop = new AbortController();
    stop.abort();
    expect(await studioWornTick(services, silent, { signal: stop.signal })).toMatchObject({ done: 0, refused: 0, failed: 0 });
    expect(fake.calls).toHaveLength(3);
    // Passage borné : au plus STUDIO_WORN_BATCH demandes.
    expect(STUDIO_WORN_BATCH).toBeLessThanOrEqual(50);
    expect(await studioWornTick(services, silent, { limit: 1 })).toMatchObject({ done: 1 });
  });
});

// ---------------------------------------------------------------- rétention

describe("worker : rétention de Studio", () => {
  it("brouillons de préparation jamais validés supprimés après 30 jours ; préparations validées et récentes gardées ; compris dans retention.cleanup", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const prep = (createdAt: string, status: "draft" | "validated") => services.db.withOrg(ctx.orgId, async (tx) => {
      const row = await repos.studioPreps.create(tx, { batchId: `b-${createdAt}-${status}`, articleGroup: 1, photos: [], fields: {}, measurements: [], questions: [], warnings: [], details: {}, garment: "top", category: null, simulated: false, createdAt });
      if (status === "validated") await repos.studioPreps.update(tx, row.id, { status: "validated", validatedAt: createdAt });
      return row.id;
    });
    const old = await prep("2026-09-20T10:00:00.000Z", "draft");
    const oldValidated = await prep("2026-09-20T10:00:00.000Z", "validated");
    const recent = await prep("2026-10-30T10:00:00.000Z", "draft");
    const r = await studioRetention(services, silent);
    expect(r).toMatchObject({ preps: 1, errors: 0 });
    expect(r.orgs).toBeGreaterThanOrEqual(1);
    const left = await services.db.withOrg(ctx.orgId, async (tx) => (await repos.studioPreps.list(tx, 100)).map((p) => p.id).sort());
    expect(left).toEqual([oldValidated, recent].sort());
    expect(left).not.toContain(old);
    // Le passage quotidien de rétention l'inclut (et ne trouve plus rien à supprimer).
    const all = await retentionTick(services, silent);
    expect(all.studio).toMatchObject({ preps: 0, errors: 0 });
  });

  it("demandes de photo portée terminées depuis plus de 30 jours supprimées avec leurs objets du stockage ; dépassement non facturé, demande récente et demande en file gardés", async () => {
    if (!available) return;
    const deleted: string[] = [];
    services.studio = { photos: { read: async () => { throw new Error("non utilisé"); }, delete: async (key) => { deleted.push(key); } } };
    const ctx = await setupOrg();
    const insert = (name: string, status: "done" | "refused" | "queued", finishedAt: string | null, overageCents = 0) => services.db.withOrg(ctx.orgId, async (tx) => {
      const row = await repos.wornPhotoJobs.create(tx, { photoKey: photoKey(ctx, name), pose: "front", provider: "mock", scheduledFor: "2026-09-20T21:00:00.000Z", overageCents, overageAcceptedAt: overageCents > 0 ? "2026-09-20T10:00:00.000Z" : null, createdAt: "2026-09-20T10:00:00.000Z" });
      if (status !== "queued") {
        await repos.wornPhotoJobs.claim(tx, row.id, "2026-09-20T21:30:00.000Z", "mock");
        await repos.wornPhotoJobs.finish(tx, row.id, { status, finishedAt: finishedAt!, resultKey: status === "done" ? `org/${ctx.orgId}/studio-photo/worn-${name}.jpg` : null, keepOverage: status === "done" });
      }
      return row.id;
    });
    const oldDone = await insert("a", "done", "2026-09-20T21:40:00.000Z");
    const oldRefused = await insert("b", "refused", "2026-09-20T21:41:00.000Z");
    const oldOverage = await insert("c", "done", "2026-09-20T21:42:00.000Z", 25);
    const recent = await insert("d", "done", "2026-10-30T21:40:00.000Z");
    const queued = await insert("e", "queued", null);
    const r = await studioRetention(services, silent);
    expect(r).toMatchObject({ worn: 2, objectsDeleted: 3, errors: 0 });
    expect(deleted.sort()).toEqual([photoKey(ctx, "a"), `org/${ctx.orgId}/studio-photo/worn-a.jpg`, photoKey(ctx, "b")].sort());
    const left = (await services.db.withOrg(ctx.orgId, (tx) => repos.wornPhotoJobs.list(tx))).map((j) => j.id).sort();
    expect(left).toEqual([oldOverage, recent, queued].sort());
    expect(left).not.toContain(oldDone);
    expect(left).not.toContain(oldRefused);
    // Le passage quotidien de rétention l'inclut (plus rien à supprimer ensuite).
    expect((await retentionTick(services, silent)).studio).toMatchObject({ worn: 0, objectsDeleted: 0, errors: 0 });
    services.studio = undefined;
  });
});
