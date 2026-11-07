import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAIService } from "@selio/ai";
import { WORN_OVERAGE_UNIT_CENTS, invoiceAmounts, quotasForPlan, wornOverageLine, wornOverageLineLabel, type Plan } from "@selio/contracts";
import type { PaymentProvider } from "@selio/connectors";
import { Db, MIGRATIONS_DIR, SecretBox, createPool, repos, runMigrations, type PgPool } from "@selio/db";
import { AppError, type OrgContext, type Services } from "../context";
import * as billing from "./billing";
import {
  FakeWornPhotoProvider, NO_WORN_PROVIDER_MESSAGE, NoopWornPhotoProvider, WORN_JOB_RETENTION_DAYS, cancelWornPhoto, createWornPhotoProvider, deleteOrphanStudioPhoto, inNightWindow, listWornPhotos, nextNightWindow, parseNightWindow, purgeFinishedWornPhotos, requestWornPhoto, runDueWornPhotos, wornConfigFromEnv, wornSettings,
} from "./worn-photos";
import type { StudioPhotoStore } from "./studio";

/**
 * Photos portées et ligne de dépassement sur la facture, sur PostgreSQL (base dédiée selio_test_core_worn,
 * créée si besoin : Vitest 3 en espace de travail peut lancer les fichiers en parallèle). Fournisseur factice ou
 * « noop », paiement factice, horloge injectée. Aucune image produite, aucun service payant. Les tests sur la
 * base sont ignorés si elle n'est pas joignable ; les fonctions pures tournent toujours.
 */
const OWNER_URL = process.env.TEST_CORE_WORN_DATABASE_URL ?? "postgres://selio:selio@127.0.0.1:5432/selio_test_core_worn";
const APP_URL = process.env.TEST_CORE_WORN_DATABASE_URL_APP ?? "postgres://selio_app:selio_app@127.0.0.1:5432/selio_test_core_worn";

const T0 = new Date("2026-11-04T10:00:00.000Z"); // mercredi, 11 h à Paris (heure d'hiver)
const NIGHT = new Date("2026-11-04T21:30:00.000Z"); // 22 h 30 à Paris

let available = true;
let owner: PgPool;
let services: Services;
let clock = new Date(T0);
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
  clock = new Date(T0);
  // Le passage de nuit traite toutes les organisations : chaque test part d'une file vide (base dédiée à ce fichier).
  if (available && owner) await owner.query("truncate worn_photo_jobs");
  if (services) {
    services.config = {};
    services.wornPhotos = undefined;
    services.payments = undefined;
  }
});

async function setupOrg(plan: Plan = "pro", sub: Record<string, unknown> = {}): Promise<OrgContext> {
  const n = ++seq;
  const ids = await services.db.withGlobal(async (tx) => {
    const u = await repos.users.create(tx, { email: `worn${n}@test.local`, displayName: `Owner ${n}`, passwordHash: "x", passwordSalt: "y" });
    const o = await repos.orgs.create(tx, { name: `Org Portées ${n}`, slug: `org-worn-${n}`, settings: {} });
    await repos.memberships.create(tx, { orgId: o.id, userId: u.id, role: "owner" });
    return { userId: u.id, orgId: o.id };
  });
  await services.db.withOrg(ids.orgId, (tx) => repos.subscriptions.upsert(tx, { plan, status: "active", provider: "revolut", quotas: quotasForPlan(plan), cardOnFile: true, paymentMethodId: "pm_test", revolutCustomerId: `cus_${n}`, currentPeriodEnd: "2026-11-20T10:00:00.000Z", cycle: "monthly", ...sub }));
  return { services, orgId: ids.orgId, userId: ids.userId, role: "owner", isOperator: false, ip: "203.0.113.7" };
}

const photoKey = (ctx: OrgContext, n = 1) => `org/${ctx.orgId}/item-photo/photo-${n}.jpg`;

async function expectAppError(p: Promise<unknown>, status: number, code?: string): Promise<AppError> {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  const e = err as AppError;
  expect(e.status).toBe(status);
  if (code) expect(e.code).toBe(code);
  return e;
}

const usedThisMonth = (ctx: OrgContext) => services.db.withOrg(ctx.orgId, (tx) => repos.usage.sumKindSince(tx, "studio.worn_photo", "2026-11-01T00:00:00.000Z"));

// ---------------------------------------------------------------- fonctions pures

describe("photos portées : fenêtre de nuit et réglages (fonctions pures)", () => {
  it("nextNightWindow : la prochaine nuit 22 h – 6 h à Paris, ou maintenant si on y est", () => {
    // 11 h à Paris (UTC+1) → 22 h le soir même, fin 6 h le lendemain.
    expect(nextNightWindow(T0, "Europe/Paris")).toEqual({ start: new Date("2026-11-04T21:00:00.000Z"), end: new Date("2026-11-05T05:00:00.000Z"), inWindow: false });
    // 22 h 30 : déjà dans la fenêtre, elle commence maintenant et finit à 6 h le lendemain.
    expect(nextNightWindow(NIGHT, "Europe/Paris")).toEqual({ start: NIGHT, end: new Date("2026-11-05T05:00:00.000Z"), inWindow: true });
    // 4 h du matin : dans la fenêtre, fin à 6 h le jour même.
    const four = new Date("2026-11-05T03:00:00.000Z");
    expect(nextNightWindow(four, "Europe/Paris")).toEqual({ start: four, end: new Date("2026-11-05T05:00:00.000Z"), inWindow: true });
    // 6 h pile : la fenêtre est finie, la suivante commence le soir.
    expect(nextNightWindow(new Date("2026-11-05T05:00:00.000Z"), "Europe/Paris").start).toEqual(new Date("2026-11-05T21:00:00.000Z"));
    // Heure d'été (UTC+2) : 22 h à Paris = 20 h UTC.
    expect(nextNightWindow(new Date("2026-07-01T10:00:00.000Z"), "Europe/Paris").start).toEqual(new Date("2026-07-01T20:00:00.000Z"));
    // Nuit du changement d'heure (25 octobre 2026) : 22 h en heure d'été, 6 h en heure d'hiver.
    expect(nextNightWindow(new Date("2026-10-24T19:00:00.000Z"), "Europe/Paris")).toEqual({ start: new Date("2026-10-24T20:00:00.000Z"), end: new Date("2026-10-25T05:00:00.000Z"), inWindow: false });
    // Fenêtre qui ne passe pas minuit (1 h – 5 h) et autre fuseau.
    expect(nextNightWindow(T0, "Europe/Paris", { startHour: 1, endHour: 5 })).toEqual({ start: new Date("2026-11-05T00:00:00.000Z"), end: new Date("2026-11-05T04:00:00.000Z"), inWindow: false });
    expect(nextNightWindow(T0, "UTC").start).toEqual(new Date("2026-11-04T22:00:00.000Z"));
  });

  it("inNightWindow, parseNightWindow, wornConfigFromEnv et wornSettings : prudents par défaut", () => {
    expect(inNightWindow(T0)).toBe(false);
    expect(inNightWindow(NIGHT)).toBe(true);
    expect(inNightWindow(new Date("2026-11-05T04:59:00.000Z"))).toBe(true);
    expect(parseNightWindow("22-6")).toEqual({ startHour: 22, endHour: 6 });
    expect(parseNightWindow("23:00-05:00")).toEqual({ startHour: 23, endHour: 5 });
    expect(parseNightWindow("22h-6h")).toEqual({ startHour: 22, endHour: 6 });
    expect(parseNightWindow("6-6")).toBeNull();
    expect(parseNightWindow("toute la nuit")).toBeNull();
    expect(wornConfigFromEnv({})).toEqual({ wornOverageEnabled: false, wornOverageUnitCents: 25, wornNightWindow: { startHour: 22, endHour: 6, timezone: "Europe/Paris" } });
    expect(wornConfigFromEnv({ WORN_OVERAGE_ENABLED: "true", WORN_OVERAGE_UNIT_CENTS: "30", WORN_NIGHT_WINDOW: "23-5", WORN_NIGHT_TIMEZONE: "Europe/Brussels" })).toEqual({ wornOverageEnabled: true, wornOverageUnitCents: 30, wornNightWindow: { startHour: 23, endHour: 5, timezone: "Europe/Brussels" } });
    // Valeurs absurdes : défauts (prix plafonné, fuseau inconnu, fenêtre illisible).
    expect(wornConfigFromEnv({ WORN_OVERAGE_UNIT_CENTS: "5000", WORN_NIGHT_TIMEZONE: "Mars/Olympus", WORN_NIGHT_WINDOW: "n'importe" })).toEqual({ wornOverageEnabled: false, wornOverageUnitCents: 25, wornNightWindow: { startHour: 22, endHour: 6, timezone: "Europe/Paris" } });
    expect(wornSettings({ config: {} })).toEqual({ overageEnabled: false, overageUnitCents: WORN_OVERAGE_UNIT_CENTS, window: { startHour: 22, endHour: 6, timezone: "Europe/Paris" } });
    expect(createWornPhotoProvider(undefined).name).toBe("noop");
    expect(createWornPhotoProvider("mock").name).toBe("mock");
    expect(createWornPhotoProvider("mock", { production: true }).name).toBe("noop");
    expect(createWornPhotoProvider("service-payant").name).toBe("noop");
  });

  it("ligne de dépassement : 0,25 € la photo (proposition), libellé de facture, total compris dans invoiceAmounts", async () => {
    expect(WORN_OVERAGE_UNIT_CENTS).toBe(25);
    expect(wornOverageLineLabel(3)).toBe("Photos portées au-delà du quota : 3 × 0,25 €");
    expect(wornOverageLine(0)).toBeNull();
    expect(wornOverageLine(4)).toEqual({ kind: "overage", product: "worn_photo", label: "Photos portées au-delà du quota : 4 × 0,25 €", quantity: 4, unitCents: 25, amountCents: 100 });
    expect(invoiceAmounts(2499, 20, [wornOverageLine(2)!])).toEqual(invoiceAmounts(2549, 20));
    expect(invoiceAmounts(2499, 20, [])).toEqual(invoiceAmounts(2499, 20));
    expect(await new NoopWornPhotoProvider().generate()).toEqual({ refused: NO_WORN_PROVIDER_MESSAGE });
  });
});

// ---------------------------------------------------------------- base de données

describe("photos portées : quotas, file de nuit, fournisseur, facturation", () => {
  it("quota du plan (10 en Pro) puis 402 ; dépassement refusé tant que WORN_OVERAGE_ENABLED est faux ; demande planifiée la nuit", async () => {
    if (!available) return;
    const ctx = await setupOrg("pro");
    for (let i = 0; i < 10; i++) {
      const job = await requestWornPhoto(ctx, { photoKey: photoKey(ctx, i), pose: "front" });
      expect(job).toMatchObject({ status: "queued", provider: "noop", overageCents: 0, scheduledFor: "2026-11-04T21:00:00.000Z" });
    }
    expect(await usedThisMonth(ctx)).toBe(10);
    const e = await expectAppError(requestWornPhoto(ctx, { photoKey: photoKey(ctx, 11) }), 402, "quota_exceeded");
    expect(e.message).toContain("(10)");
    expect(e.details).toMatchObject({ quota: 10, used: 10, overageAvailable: false });
    // Même avec l'accord : le réglage est désactivé, rien n'est accepté ni compté.
    await expectAppError(requestWornPhoto(ctx, { photoKey: photoKey(ctx, 11), acceptOverage: true }), 402, "quota_exceeded");
    expect(await usedThisMonth(ctx)).toBe(10);
    // Usage du mois : 10 / 10, dépassé.
    expect((await billing.getUsage(ctx)).studio.wornPhotos).toMatchObject({ used: 10, quota: 10, exceeded: true });
  });

  it("Agence : 30 par mois ; Starter : non incluses ; clé d'une autre organisation ou invalide : refusée", async () => {
    if (!available) return;
    const agence = await setupOrg("agence");
    for (let i = 0; i < 30; i++) await requestWornPhoto(agence, { photoKey: photoKey(agence, i) });
    await expectAppError(requestWornPhoto(agence, { photoKey: photoKey(agence, 99) }), 402, "quota_exceeded");
    const starter = await setupOrg("starter");
    const e = await expectAppError(requestWornPhoto(starter, { photoKey: photoKey(starter) }), 402, "quota_exceeded");
    expect(e.message).toMatch(/pas incluses/);
    const pro = await setupOrg("pro");
    await expectAppError(requestWornPhoto(pro, { photoKey: photoKey(agence) }), 403, "forbidden");
    await expectAppError(requestWornPhoto(pro, { photoKey: "https://exemple.fr/photo.jpg" }), 400, "validation");
    await expectAppError(requestWornPhoto(pro, { photoKey: `org/${pro.orgId}/avatar/moi.jpg` }), 400, "validation");
    await expectAppError(requestWornPhoto({ ...pro, role: "viewer" }, { photoKey: photoKey(pro) }), 403, "forbidden");
  });

  it("dépassement : seulement avec WORN_OVERAGE_ENABLED ET l'accord explicite, compté à 0,25 € ; jamais sans carte", async () => {
    if (!available) return;
    services.config = { wornOverageEnabled: true };
    const ctx = await setupOrg("pro");
    for (let i = 0; i < 10; i++) await requestWornPhoto(ctx, { photoKey: photoKey(ctx, i) });
    // Sans accord : 402 qui propose le dépassement (prix et accord demandés).
    const e = await expectAppError(requestWornPhoto(ctx, { photoKey: photoKey(ctx, 11) }), 402, "quota_exceeded");
    expect(e.message).toContain("0,25 €");
    expect(e.details).toMatchObject({ overageAvailable: true, unitCents: 25, consentRequired: true });
    // Avec accord : acceptée, prix unitaire et date de l'accord enregistrés, comptée au-delà du quota.
    // L'accord vaut pour le prix AFFICHÉ : sans prix accepté, ou avec un autre prix que celui du serveur, refus 409 (rien n'est enregistré).
    const missing = await expectAppError(requestWornPhoto(ctx, { photoKey: photoKey(ctx, 11), acceptOverage: true }), 409, "overage_price_changed");
    expect(missing.details).toMatchObject({ unitCents: 25, acceptedUnitCents: null, consentRequired: true });
    const changed = await expectAppError(requestWornPhoto(ctx, { photoKey: photoKey(ctx, 11), acceptOverage: true, acceptedUnitCents: 30 }), 409, "overage_price_changed");
    expect(changed.message).toMatch(/0,25 € la photo \(accord donné sur 0,30 €\)/);
    expect(changed.details).toMatchObject({ unitCents: 25, acceptedUnitCents: 30 });
    expect(await usedThisMonth(ctx)).toBe(10);
    const over = await requestWornPhoto(ctx, { photoKey: photoKey(ctx, 11), acceptOverage: true, acceptedUnitCents: 25 });
    expect(over.overageCents).toBe(25);
    expect(over.overageAcceptedAt).toBe(T0.toISOString());
    expect(await usedThisMonth(ctx)).toBe(11);
    const audit = await services.db.withOrg(ctx.orgId, (tx) => repos.audit.list(tx));
    expect(audit.find((a) => a.targetId === over.id)?.meta).toMatchObject({ overageAccepted: true, overageCents: 25 });
    // Prix du serveur changé (40 c) : l'accord donné sur 25 c est refusé, l'accord sur 40 c est enregistré à 40 c.
    services.config = { wornOverageEnabled: true, wornOverageUnitCents: 40 };
    await expectAppError(requestWornPhoto(ctx, { photoKey: photoKey(ctx, 12), acceptOverage: true, acceptedUnitCents: 25 }), 409, "overage_price_changed");
    expect((await requestWornPhoto(ctx, { photoKey: photoKey(ctx, 12), acceptOverage: true, acceptedUnitCents: 40 })).overageCents).toBe(40);
    services.config = { wornOverageEnabled: true };
    // Sans carte enregistrée (le dépassement est facturé au renouvellement) : refusé.
    const noCard = await setupOrg("pro", { cardOnFile: false, paymentMethodId: null });
    for (let i = 0; i < 10; i++) await requestWornPhoto(noCard, { photoKey: photoKey(noCard, i) });
    await expectAppError(requestWornPhoto(noCard, { photoKey: photoKey(noCard, 11), acceptOverage: true, acceptedUnitCents: 25 }), 402, "quota_exceeded");
    // Résiliation demandée : refusé aussi (plus de renouvellement pour le facturer).
    const leaving = await setupOrg("pro", { cancelAtPeriodEnd: true });
    for (let i = 0; i < 10; i++) await requestWornPhoto(leaving, { photoKey: photoKey(leaving, i) });
    await expectAppError(requestWornPhoto(leaving, { photoKey: photoKey(leaving, 11), acceptOverage: true, acceptedUnitCents: 25 }), 402, "quota_exceeded");
  });

  it("nuit : hors fenêtre rien ne part ; « noop » refuse proprement et rend le quota ; « mock » produit une clé de l'organisation", async () => {
    if (!available) return;
    services.config = { wornOverageEnabled: true };
    const ctx = await setupOrg("pro");
    const a = await requestWornPhoto(ctx, { photoKey: photoKey(ctx, 1), pose: "three_quarter" });
    const b = await requestWornPhoto(ctx, { photoKey: photoKey(ctx, 2) });
    // 12 h : hors de la fenêtre, rien n'est lancé.
    clock = new Date("2026-11-04T11:00:00.000Z");
    const day = await runDueWornPhotos(services);
    expect(day).toMatchObject({ outsideWindow: true, done: 0, refused: 0, failed: 0 });
    expect((await listWornPhotos(ctx)).every((j) => j.status === "queued")).toBe(true);
    // 22 h 30, sans fournisseur : « noop » refuse avec le message attendu, la place de quota est rendue.
    clock = new Date(NIGHT);
    expect(await usedThisMonth(ctx)).toBe(2);
    const night = await runDueWornPhotos(services);
    expect(night).toMatchObject({ outsideWindow: false, refused: 2, done: 0 });
    const refused = await listWornPhotos(ctx);
    for (const j of refused) expect(j).toMatchObject({ status: "refused", provider: "noop", error: NO_WORN_PROVIDER_MESSAGE, resultKey: null, overageCents: 0 });
    expect(await usedThisMonth(ctx)).toBe(0);
    expect(refused.map((j) => j.id).sort()).toEqual([a.id, b.id].sort());
    // Un second passage ne reprend rien.
    expect(await runDueWornPhotos(services)).toMatchObject({ refused: 0, done: 0, failed: 0 });

    // Avec le fournisseur factice : la photo est produite, la clé appartient à l'organisation.
    clock = new Date(T0);
    const provider = new FakeWornPhotoProvider();
    services.wornPhotos = provider;
    const c = await requestWornPhoto(ctx, { photoKey: photoKey(ctx, 3), pose: "back" });
    expect(c.provider).toBe("mock");
    clock = new Date(NIGHT);
    expect(await runDueWornPhotos(services)).toMatchObject({ done: 1 });
    expect(provider.calls).toEqual([{ orgId: ctx.orgId, jobId: c.id, photoKey: photoKey(ctx, 3), pose: "back", signal: undefined }]);
    const done = (await listWornPhotos(ctx)).find((j) => j.id === c.id)!;
    expect(done).toMatchObject({ status: "done", provider: "mock", resultKey: `org/${ctx.orgId}/studio-photo/worn-${c.id}.jpg`, error: null });
    expect(await usedThisMonth(ctx)).toBe(1);
  });

  it("fournisseur en panne, clé d'une autre organisation, demande interrompue : échec et quota rendu", async () => {
    if (!available) return;
    const ctx = await setupOrg("pro");
    const other = await setupOrg("pro");
    const provider = new FakeWornPhotoProvider();
    services.wornPhotos = provider;
    provider.next.push(new Error("délai dépassé"), { resultKey: `org/${other.orgId}/studio-photo/vol.jpg` }, { refused: "pose non prise en charge" });
    await requestWornPhoto(ctx, { photoKey: photoKey(ctx, 1) });
    await requestWornPhoto(ctx, { photoKey: photoKey(ctx, 2) });
    await requestWornPhoto(ctx, { photoKey: photoKey(ctx, 3) });
    clock = new Date(NIGHT);
    expect(await runDueWornPhotos(services)).toMatchObject({ failed: 2, refused: 1, done: 0 });
    const jobs = await listWornPhotos(ctx);
    expect(jobs.filter((j) => j.status === "failed").map((j) => j.error).sort()).toEqual(["Le fournisseur a échoué : délai dépassé", "Résultat refusé : la clé rendue par le fournisseur n'est pas une clé de stockage de cette organisation."]);
    expect(jobs.find((j) => j.status === "refused")?.error).toBe("pose non prise en charge");
    expect(jobs.every((j) => j.resultKey === null)).toBe(true);
    expect(await usedThisMonth(ctx)).toBe(0);

    // Demande restée « en cours » plus d'une heure (worker interrompu) : close en échec, quota rendu.
    clock = new Date(T0);
    const stuck = await requestWornPhoto(ctx, { photoKey: photoKey(ctx, 4) });
    await services.db.withOrg(ctx.orgId, (tx) => repos.wornPhotoJobs.claim(tx, stuck.id, "2026-11-04T21:00:00.000Z", "mock"));
    clock = new Date("2026-11-04T22:30:00.000Z");
    expect(await runDueWornPhotos(services)).toMatchObject({ interrupted: 1 });
    expect((await listWornPhotos(ctx)).find((j) => j.id === stuck.id)).toMatchObject({ status: "failed" });
    expect(await usedThisMonth(ctx)).toBe(0);
  });

  it("annulation : une demande en file est supprimée et rend son quota ; traitée : 409 ; inconnue : 404", async () => {
    if (!available) return;
    services.config = { wornOverageEnabled: true };
    const ctx = await setupOrg("pro");
    for (let i = 0; i < 10; i++) await requestWornPhoto(ctx, { photoKey: photoKey(ctx, i) });
    const over = await requestWornPhoto(ctx, { photoKey: photoKey(ctx, 10), acceptOverage: true, acceptedUnitCents: 25 });
    expect(await usedThisMonth(ctx)).toBe(11);
    expect(await cancelWornPhoto(ctx, over.id)).toEqual({ cancelled: true, id: over.id });
    expect(await usedThisMonth(ctx)).toBe(10);
    expect((await listWornPhotos(ctx)).some((j) => j.id === over.id)).toBe(false);
    await expectAppError(cancelWornPhoto(ctx, over.id), 404, "not_found");
    const first = (await listWornPhotos(ctx))[0]!;
    clock = new Date(NIGHT);
    await runDueWornPhotos(services);
    await expectAppError(cancelWornPhoto(ctx, first.id), 409, "conflict");
    // Une autre organisation ne voit ni n'annule les demandes (RLS).
    const other = await setupOrg("pro");
    expect(await listWornPhotos(other)).toEqual([]);
    await expectAppError(cancelWornPhoto(other, first.id), 404, "not_found");
  });

  it("rien n'est gardé sans nécessité : la photo envoyée pour Studio est effacée du stockage à l'annulation, au refus, à l'échec et à l'interruption ; jamais la photo d'un article, ni une photo encore utilisée", async () => {
    if (!available) return;
    const deleted: string[] = [];
    let down = false;
    const store: StudioPhotoStore = { read: async () => { throw new Error("non utilisé"); }, delete: async (key) => { if (down) throw new Error("stockage injoignable"); deleted.push(key); } };
    services.studio = { photos: store };
    const ctx = await setupOrg("pro");
    const studioKey = (n: number) => `org/${ctx.orgId}/studio-photo/p${n}.jpg`;
    // Annulation : l'objet part avec la demande.
    const a = await requestWornPhoto(ctx, { photoKey: studioKey(1) });
    await cancelWornPhoto(ctx, a.id);
    expect(deleted).toEqual([studioKey(1)]);
    // La photo d'un article vit avec lui : jamais effacée ; une clé d'une autre organisation non plus.
    const b = await requestWornPhoto(ctx, { photoKey: photoKey(ctx, 2) });
    await cancelWornPhoto(ctx, b.id);
    expect(deleted).toEqual([studioKey(1)]);
    expect(await deleteOrphanStudioPhoto(services, ctx.orgId, "org/autre-organisation/studio-photo/x.jpg", null)).toBe("kept");
    // Même photo pour deux demandes : effacée seulement quand plus aucune demande ne l'utilise.
    const c1 = await requestWornPhoto(ctx, { photoKey: studioKey(3) });
    const c2 = await requestWornPhoto(ctx, { photoKey: studioKey(3), pose: "back" });
    await cancelWornPhoto(ctx, c1.id);
    expect(deleted).toEqual([studioKey(1)]);
    await cancelWornPhoto(ctx, c2.id);
    expect(deleted).toEqual([studioKey(1), studioKey(3)]);
    // Refus (« noop ») la nuit : effacée et comptée.
    await requestWornPhoto(ctx, { photoKey: studioKey(4) });
    clock = new Date(NIGHT);
    expect(await runDueWornPhotos(services)).toMatchObject({ refused: 1, objectsDeleted: 1 });
    expect(deleted).toContain(studioKey(4));
    // Échec du fournisseur avec un stockage en panne : la demande est close quand même (suppression comptée en échec, jamais levée).
    clock = new Date(T0);
    const provider = new FakeWornPhotoProvider();
    services.wornPhotos = provider;
    provider.next.push(new Error("panne"));
    const failed = await requestWornPhoto(ctx, { photoKey: studioKey(5) });
    down = true;
    clock = new Date(NIGHT);
    expect(await runDueWornPhotos(services)).toMatchObject({ failed: 1, objectsDeleted: 0 });
    down = false;
    expect((await listWornPhotos(ctx)).find((j) => j.id === failed.id)?.status).toBe("failed");
    expect(deleted).not.toContain(studioKey(5));
    // Photo produite : la photo d'origine reste jusqu'à la purge (la demande terminée la référence encore).
    clock = new Date(T0);
    await requestWornPhoto(ctx, { photoKey: studioKey(6) });
    clock = new Date(NIGHT);
    expect(await runDueWornPhotos(services)).toMatchObject({ done: 1, objectsDeleted: 0 });
    expect(deleted).not.toContain(studioKey(6));
    // Interruption (worker arrêté) : close en échec, photo effacée.
    clock = new Date(T0);
    const stuck = await requestWornPhoto(ctx, { photoKey: studioKey(7) });
    await services.db.withOrg(ctx.orgId, (tx) => repos.wornPhotoJobs.claim(tx, stuck.id, "2026-11-04T21:00:00.000Z", "mock"));
    clock = new Date("2026-11-04T22:30:00.000Z");
    expect(await runDueWornPhotos(services)).toMatchObject({ interrupted: 1, objectsDeleted: 1 });
    expect(deleted).toContain(studioKey(7));
    // Sans suppression branchée sur ce serveur : rien n'est tenté, rien ne casse.
    services.studio = { photos: { read: store.read } };
    clock = new Date(T0);
    const d = await requestWornPhoto(ctx, { photoKey: studioKey(8) });
    expect(await deleteOrphanStudioPhoto(services, ctx.orgId, studioKey(8), d.id)).toBe("no_store");
    await cancelWornPhoto(ctx, d.id);
    expect(deleted).not.toContain(studioKey(8));
    services.studio = undefined;
  });

  it("rétention : demandes terminées depuis plus de 30 jours supprimées avec leurs objets (photo d'origine, résultat) ; dépassement produit pas encore facturé, demandes récentes ou en file gardés", async () => {
    if (!available) return;
    expect(WORN_JOB_RETENTION_DAYS).toBe(30);
    const deleted: string[] = [];
    services.studio = { photos: { read: async () => { throw new Error("non utilisé"); }, delete: async (key) => { deleted.push(key); } } };
    services.config = { wornOverageEnabled: true };
    services.wornPhotos = new FakeWornPhotoProvider();
    // Quota ramené à 2 pour atteindre le dépassement sans 10 demandes.
    const ctx = await setupOrg("pro", { quotas: { ...quotasForPlan("pro"), wornPhotosPerMonth: 2 } });
    const studioKey = (n: number) => `org/${ctx.orgId}/studio-photo/p${n}.jpg`;
    const resultKey = (id: string) => `org/${ctx.orgId}/studio-photo/worn-${id}.jpg`;
    const a = await requestWornPhoto(ctx, { photoKey: studioKey(1) });
    const b = await requestWornPhoto(ctx, { photoKey: studioKey(2) });
    const over = await requestWornPhoto(ctx, { photoKey: studioKey(3), acceptOverage: true, acceptedUnitCents: 25 });
    clock = new Date(NIGHT);
    expect(await runDueWornPhotos(services)).toMatchObject({ done: 3 });
    // Le lendemain : une demande refusée (« noop ») et une demande récente qui restera en file.
    clock = new Date("2026-11-05T10:00:00.000Z");
    services.wornPhotos = new NoopWornPhotoProvider();
    const refused = await requestWornPhoto(ctx, { photoKey: studioKey(4), acceptOverage: true, acceptedUnitCents: 25 });
    clock = new Date("2026-11-05T21:30:00.000Z");
    expect(await runDueWornPhotos(services)).toMatchObject({ refused: 1 });
    expect(deleted).toEqual([studioKey(4)]);
    clock = new Date("2026-12-01T10:00:00.000Z");
    const recent = await requestWornPhoto(ctx, { photoKey: studioKey(5), acceptOverage: true, acceptedUnitCents: 25 });
    // 31 jours après la seconde nuit : a, b et la refusée partent (avec leurs objets) ; le dépassement produit non facturé et la demande en file restent.
    deleted.length = 0;
    const purge = await purgeFinishedWornPhotos(services, ctx.orgId, new Date("2026-12-07T10:00:00.000Z"));
    expect(purge).toEqual({ jobs: 3, objectsDeleted: 5, objectsFailed: 0 });
    expect(deleted.sort()).toEqual([studioKey(1), resultKey(a.id), studioKey(2), resultKey(b.id), studioKey(4)].sort());
    expect((await listWornPhotos(ctx)).map((j) => j.id).sort()).toEqual([over.id, recent.id].sort());
    expect(refused.id).not.toBe(over.id);
    // Une fois le dépassement facturé, la purge l'emporte aussi (photo d'origine et résultat).
    const invoice = await services.db.withOrg(ctx.orgId, (tx) => repos.invoices.create(tx, { plan: "pro", cycle: "monthly", amountCents: 2524, vatRate: 20, vatNotice: null, periodStart: "2026-11-20T10:00:00.000Z", periodEnd: "2026-12-20T10:00:00.000Z", orderId: `ord-worn-purge-${seq}`, issuedAt: "2026-11-20T10:00:00.000Z", extraLines: [] }));
    expect(await services.db.withOrg(ctx.orgId, (tx) => repos.wornPhotoJobs.markOverageBilled(tx, { invoiceId: invoice.id, cutoff: "2026-11-20T10:00:00.000Z", unitCents: 25, quantity: 1, at: "2026-11-20T10:00:00.000Z" }))).toBe(1);
    deleted.length = 0;
    expect(await purgeFinishedWornPhotos(services, ctx.orgId, new Date("2026-12-07T10:00:00.000Z"))).toEqual({ jobs: 1, objectsDeleted: 2, objectsFailed: 0 });
    expect(deleted.sort()).toEqual([studioKey(3), resultKey(over.id)].sort());
    expect((await listWornPhotos(ctx)).map((j) => j.id)).toEqual([recent.id]);
    services.studio = undefined;
  });

  it("renouvellement : « Photos portées au-delà du quota : n × 0,25 € » ajoutée seulement avec WORN_OVERAGE_ENABLED, facturée une fois", async () => {
    if (!available) return;
    const orders: { amountCents: number; description: string; metadata?: Record<string, string> }[] = [];
    const payments: PaymentProvider = {
      name: "revolut",
      testMode: true,
      createCustomer: async () => ({ customerId: "cus_x" }),
      createCheckoutOrder: async () => { throw new Error("non utilisé"); },
      createOrder: async (input) => {
        orders.push({ amountCents: input.amountCents, description: input.description, metadata: input.metadata });
        return { orderId: `ord_${orders.length}_${seq}`, token: null, state: "pending", amountCents: input.amountCents, currency: "EUR", customerId: input.customerId ?? null, merchantOrderRef: input.merchantOrderRef ?? null, paymentAttempts: 0, paymentMethodId: null };
      },
      chargeSavedMethod: async () => ({ state: "completed" }),
      cancelOrder: async () => ({ state: "cancelled" }),
      getOrder: async () => { throw new Error("non utilisé"); },
      listMerchantPaymentMethods: async () => [],
      verifyWebhook: () => ({ ok: false, reason: "non utilisé" }),
    };
    services.config = { wornOverageEnabled: true };
    services.wornPhotos = new FakeWornPhotoProvider();
    const ctx = await setupOrg("pro", { currentPeriodEnd: "2026-11-05T08:00:00.000Z" });
    for (let i = 0; i < 10; i++) await requestWornPhoto(ctx, { photoKey: photoKey(ctx, i) });
    await requestWornPhoto(ctx, { photoKey: photoKey(ctx, 10), acceptOverage: true, acceptedUnitCents: 25 });
    await requestWornPhoto(ctx, { photoKey: photoKey(ctx, 11), acceptOverage: true, acceptedUnitCents: 25 });
    const cancelled = await requestWornPhoto(ctx, { photoKey: photoKey(ctx, 12), acceptOverage: true, acceptedUnitCents: 25 });
    await cancelWornPhoto(ctx, cancelled.id);
    clock = new Date(NIGHT);
    expect(await runDueWornPhotos(services)).toMatchObject({ done: 12 });

    // Échéance passée : un débit = abonnement + 2 photos au-delà du quota (la photo annulée n'est pas facturée).
    clock = new Date("2026-11-05T09:00:00.000Z");
    const svc: Services = { ...services, payments };
    const plan = billing.planPriceCents("pro", "monthly");
    const renewed = await billing.processSubscriptionRenewal(svc, ctx.orgId);
    expect(renewed.action).toBe("renewed");
    expect(orders.at(-1)).toMatchObject({ amountCents: plan + 50, metadata: { kind: "renewal", overageCents: "50" } });
    expect(orders.at(-1)!.description).toContain("photos portées au-delà du quota");
    const [invoice] = await services.db.withOrg(ctx.orgId, (tx) => repos.invoices.list(tx));
    expect(invoice!.amountCents).toBe(plan + 50);
    expect(invoice!.extraLines).toEqual([{ kind: "overage", product: "worn_photo", label: "Photos portées au-delà du quota : 2 × 0,25 €", quantity: 2, unitCents: 25, amountCents: 50 }]);
    const view = await billing.getInvoice({ ...ctx, services: svc }, invoice!.id);
    expect(view.lines.map((l) => [l.kind, l.label, l.amountCents])).toEqual([
      ["plan", "Abonnement Selio Pro — mensuel", plan],
      ["overage", "Photos portées au-delà du quota : 2 × 0,25 €", 50],
    ]);
    expect(view.lines[1]).toMatchObject({ quantity: 2, unitCents: 25 });
    expect(view.totals).toEqual({ ...invoiceAmounts(plan + 50, 20), vatRate: 20 });
    const billed = (await listWornPhotos(ctx)).filter((j) => j.overageCents > 0);
    expect(billed).toHaveLength(2);
    expect(billed.every((j) => j.billed)).toBe(true);

    // Échéance suivante : rien de neuf au-delà du quota, aucune ligne (jamais facturé deux fois).
    clock = new Date("2026-12-05T09:00:00.000Z");
    expect((await billing.processSubscriptionRenewal(svc, ctx.orgId)).action).toBe("renewed");
    expect(orders.at(-1)!.amountCents).toBe(plan);
    expect(orders.at(-1)!.metadata).not.toHaveProperty("overageCents");
    const latest = (await services.db.withOrg(ctx.orgId, (tx) => repos.invoices.list(tx)))[0]!;
    expect(latest.extraLines).toEqual([]);
    expect((await billing.getInvoice({ ...ctx, services: svc }, latest.id)).lines).toHaveLength(1);
  });

  it("renouvellement sans WORN_OVERAGE_ENABLED : aucune ligne, même si des photos au-delà du quota existent", async () => {
    if (!available) return;
    const orders: number[] = [];
    const payments = {
      name: "revolut", testMode: true,
      createOrder: async (input: { amountCents: number }) => { orders.push(input.amountCents); return { orderId: `ord_off_${seq}_${orders.length}`, token: null, state: "pending", amountCents: input.amountCents, currency: "EUR", customerId: null, merchantOrderRef: null, paymentAttempts: 0, paymentMethodId: null }; },
      chargeSavedMethod: async () => ({ state: "completed" }),
      cancelOrder: async () => ({ state: "cancelled" }),
      listMerchantPaymentMethods: async () => [],
    } as unknown as PaymentProvider;
    services.config = { wornOverageEnabled: true };
    services.wornPhotos = new FakeWornPhotoProvider();
    const ctx = await setupOrg("pro", { currentPeriodEnd: "2026-11-05T08:00:00.000Z" });
    for (let i = 0; i < 10; i++) await requestWornPhoto(ctx, { photoKey: photoKey(ctx, i) });
    await requestWornPhoto(ctx, { photoKey: photoKey(ctx, 10), acceptOverage: true, acceptedUnitCents: 25 });
    clock = new Date(NIGHT);
    await runDueWornPhotos(services);
    // Le réglage est retiré avant l'échéance : rien n'est facturé, la photo reste non facturée.
    services.config = {};
    clock = new Date("2026-11-05T09:00:00.000Z");
    expect((await billing.processSubscriptionRenewal({ ...services, payments }, ctx.orgId)).action).toBe("renewed");
    expect(orders).toEqual([billing.planPriceCents("pro", "monthly")]);
    const [invoice] = await services.db.withOrg(ctx.orgId, (tx) => repos.invoices.list(tx));
    expect(invoice!.extraLines).toEqual([]);
    expect((await listWornPhotos(ctx)).find((j) => j.overageCents > 0)?.billed).toBe(false);
  });
});
