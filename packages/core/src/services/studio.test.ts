import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AIError, AIService, createAIService, type AIProvider, type GenerateRequest, type StructuredRequest, type StructuredResult } from "@selio/ai";
import { quotasForPlan, type ListingGenerationOutput, type Plan } from "@selio/contracts";
import { Db, MIGRATIONS_DIR, SecretBox, createPool, repos, runMigrations, type PgPool } from "@selio/db";
import { extractCmValues, studioQuestion } from "@selio/domain";
import { AppError, type OrgContext, type Services } from "../context";
import * as billing from "./billing";
import { FakeStudioVision, generateListing, getPrep, listPreps, listSizeReferences, measurementsSentence, prepareListing, provideSizeReference, shareBlocker, shareableMeasurements, validatePrep, type ImageReducer, type StudioPhotoStore } from "./studio";

/**
 * Studio façon Kavis de bout en bout sur PostgreSQL (base dédiée selio_test_core_studio, créée si besoin :
 * Vitest 3 en espace de travail peut lancer les fichiers en parallèle). Lecture des photos factice
 * (`FakeStudioVision`, réponses programmées comme celles du modèle 1), rédaction par le simulateur ou par un
 * fournisseur scripté, horloge injectée. Les photos sont de faux en-têtes PNG (seules les dimensions comptent).
 */
const OWNER_URL = process.env.TEST_CORE_STUDIO_DATABASE_URL ?? "postgres://selio:selio@127.0.0.1:5432/selio_test_core_studio";
const APP_URL = process.env.TEST_CORE_STUDIO_DATABASE_URL_APP ?? "postgres://selio_app:selio_app@127.0.0.1:5432/selio_test_core_studio";

const T0 = new Date("2026-11-04T10:00:00.000Z");

let available = true;
let owner: PgPool;
let services: Services;
let vision: FakeStudioVision;
let seq = 0;
const mockAi = createAIService({ env: { AI_PROVIDER: "mock" }, allowFallback: false });

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
    await owner.query("truncate users, organizations, payment_events, rate_limits, size_references cascade");
  } catch {
    available = false;
    return;
  }
  services = {
    db: new Db(createPool(APP_URL, { max: 4 })),
    ai: mockAi,
    secrets: new SecretBox(SecretBox.generateKey()),
    now: () => new Date(T0),
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
  vision = new FakeStudioVision();
  // Base des références partagée : chaque test part d'une base vide (base dédiée à ce fichier).
  if (available && owner) await owner.query("truncate size_references");
  if (services) {
    services.ai = mockAi;
    services.studio = { vision };
  }
});

async function setupOrg(plan: Plan = "pro", opts: { operator?: boolean } = {}): Promise<OrgContext> {
  const n = ++seq;
  const ids = await services.db.withGlobal(async (tx) => {
    const u = await repos.users.create(tx, { email: `studio${n}@test.local`, displayName: `Owner ${n}`, passwordHash: "x", passwordSalt: "y" });
    const o = await repos.orgs.create(tx, { name: `Org Studio ${n}`, slug: `org-studio-${n}`, settings: {} });
    await repos.memberships.create(tx, { orgId: o.id, userId: u.id, role: "owner" });
    return { userId: u.id, orgId: o.id };
  });
  await services.db.withOrg(ids.orgId, (tx) => repos.subscriptions.upsert(tx, { plan, status: "active", quotas: quotasForPlan(plan) }));
  return { services, orgId: ids.orgId, userId: ids.userId, role: "owner", isOperator: opts.operator ?? false, ip: "203.0.113.8" };
}

/** Faux PNG : signature et bloc IHDR (largeur, hauteur), complété jusqu'à `bytes` octets. */
function png(width: number, height: number, bytes = 64): Uint8Array {
  const b = new Uint8Array(Math.max(33, bytes));
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, width);
  v.setUint32(20, height);
  return b;
}
const dataUrl = (b: Uint8Array) => `data:image/png;base64,${Buffer.from(b).toString("base64")}`;
const photo = (id: string, w = 1024, h = 768, extra: Record<string, unknown> = {}) => ({ id, url: dataUrl(png(w, h)), ...extra });

const read = (value: string, confidence = 0.95) => ({ value, confidence, readFrom: "label" });
const sortOf = (roles: string[], group = 1) => ({ photos: roles.map((role, index) => ({ index, role, articleGroup: group, confidence: 0.9 })) });

async function expectAppError(p: Promise<unknown>, status: number, code?: string): Promise<AppError> {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(AppError);
  const e = err as AppError;
  expect(e.status).toBe(status);
  if (code) expect(e.code).toBe(code);
  return e;
}

const counts = (ctx: OrgContext) => services.db.withOrg(ctx.orgId, async (tx) => ({
  listings: await repos.usage.sumKindSince(tx, "studio.listing", "2026-11-01T00:00:00.000Z"),
  ai: await repos.aiRequests.countSince(tx, "2026-11-01T00:00:00.000Z"),
  preps: (await repos.studioPreps.list(tx, 100)).length,
}));

/** Fournisseur de rédaction scripté : rend l'annonce donnée et garde les requêtes (images comprises). */
class ScriptedProvider implements AIProvider {
  readonly name = "scripted";
  readonly model = "scripted-model";
  readonly canSeeImages = true;
  readonly requests: GenerateRequest[] = [];
  constructor(public output: ListingGenerationOutput) {}
  async health() {
    return { ok: true, status: "healthy" as const, message: "", latencyMs: 1, model: this.model, provider: this.name };
  }
  async generate(): Promise<never> {
    throw new AIError("unavailable", "non utilisé");
  }
  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.requests.push(req);
    if (req.schemaName !== "listing_generation") throw new AIError("unavailable", "seulement la rédaction");
    const data = this.output as unknown as T;
    return { data, raw: JSON.stringify(data), text: JSON.stringify(data), usage: { promptTokens: 10, outputTokens: 10 }, latencyMs: 3, model: this.model, provider: this.name };
  }
}
const scriptedAi = (provider: AIProvider) => new AIService({ provider, concurrency: 1, maxPending: 10, circuitFailures: 5, circuitCooldownMs: 1000, timeoutMs: 5000, allowFallback: false });
const listingOut = (o: Partial<ListingGenerationOutput> = {}): ListingGenerationOutput => ({ title: "Pull Zara bleu marine taille M", description: "Pull Zara en maille, coloris bleu marine. Très bon état, aucun défaut visible. Envoi soigné sous 48 h.", brand: "Zara", category: "women", size: "M", condition: "very_good", colors: ["Bleu marine"], material: null, hashtags: [], confidence: 0.8, ...o });

describe("Studio façon Kavis : photos, tri, étiquette, mètre ruban, provenance", () => {
  it("refuse 12 photos en pleine taille avant tout appel au modèle ; 13 photos refusées ; trop lourde, illisible, à réduire", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const full = Array.from({ length: 12 }, (_, i) => photo(`p${i}`, 4000, 3000));
    const e = await expectAppError(prepareListing(ctx, { photos: full }), 400, "photo_rejected");
    expect(e.details).toMatchObject({ photoId: "p0", reason: "too_large", width: 4000, height: 3000 });
    expect(e.message).toMatch(/jamais de photo en pleine taille/);
    expect(vision.calls).toEqual([]);
    expect(await counts(ctx)).toEqual({ listings: 0, ai: 0, preps: 0 });
    await expectAppError(prepareListing(ctx, { photos: Array.from({ length: 13 }, (_, i) => photo(`p${i}`)) }), 400, "validation");
    // Plus de 1,5 Mo, illisible, entre 1 024 et 1 600 px sans réducteur : refus (jamais envoyée telle quelle).
    expect((await expectAppError(prepareListing(ctx, { photos: [{ id: "lourde", url: dataUrl(png(800, 600, 1_600_000)) }] }), 400, "photo_rejected")).details).toMatchObject({ reason: "too_heavy" });
    expect((await expectAppError(prepareListing(ctx, { photos: [{ id: "texte", url: `data:image/jpeg;base64,${Buffer.from("pas une image").toString("base64")}` }] }), 400, "photo_rejected")).details).toMatchObject({ reason: "unreadable" });
    expect((await expectAppError(prepareListing(ctx, { photos: [photo("moyenne", 1400, 1050)] }), 400, "photo_rejected")).details).toMatchObject({ reason: "needs_reduction", width: 1400 });
    expect(vision.calls).toEqual([]);
    // Avec un réducteur branché : la photo est réduite à 1 024 px avant d'être envoyée.
    const reducer: ImageReducer = { reduce: async (_input, opts) => ({ data: png(opts.maxSide, Math.round(opts.maxSide * 0.75)), contentType: "image/jpeg" }) };
    services.studio = { vision, reducer };
    const ok = await prepareListing(ctx, { photos: [photo("moyenne", 1400, 1050)] });
    expect(ok.articles).toHaveLength(1);
    expect(vision.count("sortPhotos")).toBe(1);
  });

  it("au plus 6 photos par appel : 12 photos → tri en 2 lots de 6, étiquette 2 photos, mètre 3 photos ; ≤ 6 retenues pour l'annonce", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    vision.respond("sortPhotos", sortOf(["front", "back", "label", "label", "label", "tape"]), sortOf(["tape", "tape", "tape", "detail", "defect", "other"]));
    vision.respond("readLabel", { brand: read("Zara"), size: read("M"), material: read("100 % coton"), reference: { value: null, confidence: 0, readFrom: null } });
    vision.respond("readMeasurements", { tapeVisible: true, measurements: [{ name: "chest", valueCm: 52.2, confidence: 0.9, evidence: "tape_photo" }] });
    const prep = await prepareListing(ctx, { photos: Array.from({ length: 12 }, (_, i) => photo(`p${i}`)), garmentKind: "top" });
    expect(vision.calls.map((c) => [c.method, c.images])).toEqual([["sortPhotos", 6], ["sortPhotos", 6], ["readLabel", 2], ["readMeasurements", 3]]);
    expect(vision.calls.every((c) => c.images <= 6)).toBe(true);
    expect(prep.articles).toHaveLength(1);
    const a = prep.articles[0]!;
    expect(a.photoIndexes).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(a.modelPhotoIndexes.length).toBeLessThanOrEqual(6);
    expect(a.fields.brand).toMatchObject({ value: "Zara", source: "label" });
    // Lu à 52,2 sur le ruban : arrondi au demi-centimètre, provenance « tape_photo ».
    expect(a.measurements.find((m) => m.name === "chest")).toMatchObject({ valueCm: 52, source: "tape_photo" });
    expect(prep.warnings.join(" ")).toMatch(/2 lots/);
    expect(prep.accuracy.status).toBe("to_measure");
    // La préparation ne compte pas d'annonce Studio, seulement une requête IA ; rien de l'image en base.
    expect(await counts(ctx)).toEqual({ listings: 0, ai: 1, preps: 1 });
    const stored = await owner.query("select photos::text as photos from studio_preps where id = $1", [a.prepId]);
    expect(stored.rows[0].photos).not.toContain("base64");
    expect(stored.rows[0].photos.length).toBeLessThan(2000);
  });

  it("jamais de mesure inventée : sans mètre ruban, mesures vides et questions ; ruban non visible, sans preuve ou peu sûr : écarté", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    // Aucune photo de mètre : le modèle n'est même pas appelé pour les mesures.
    vision.respond("sortPhotos", sortOf(["front", "label"]));
    vision.respond("readLabel", { brand: read("Zara"), size: read("M"), material: { value: "laine", confidence: 0.9, readFrom: null }, reference: null });
    const prep = await prepareListing(ctx, { photos: [photo("face"), photo("etiquette")], garmentKind: "top" });
    expect(vision.count("readMeasurements")).toBe(0);
    const a = prep.articles[0]!;
    for (const name of ["chest", "length", "shoulders"]) {
      const m = a.measurements.find((x) => x.name === name)!;
      expect(m).toMatchObject({ valueCm: null, source: null });
      expect(m.question).toMatch(/mètre ruban|Mesurez/);
    }
    expect(a.questions.filter((q) => ["chest", "length", "shoulders"].includes(q.field)).map((q) => q.reason)).toEqual(["no_tape", "no_tape", "no_tape"]);
    // Matière « déduite » sans provenance (readFrom absent) : écartée, champ vide et question.
    expect(a.fields.material).toMatchObject({ value: null, source: null });
    expect(a.questions.some((q) => q.field === "material")).toBe(true);

    // Une photo de mètre, mais le modèle dit le ruban invisible : aucune mesure retenue, même si des valeurs sont rendues.
    vision.respond("sortPhotos", sortOf(["front", "tape"]));
    vision.respond("readMeasurements", { tapeVisible: false, measurements: [{ name: "chest", valueCm: 50, confidence: 0.99, evidence: "tape_photo" }] });
    const noTape = (await prepareListing(ctx, { photos: [photo("face"), photo("ruban")], garmentKind: "top" })).articles[0]!;
    expect(noTape.measurements.find((m) => m.name === "chest")).toMatchObject({ valueCm: null, source: null });
    expect(noTape.tapeVisible).toBe(false);

    // Ruban visible, mais mesure « à l'œil » (sans preuve) ou trop peu sûre : écartée.
    vision.respond("sortPhotos", sortOf(["front", "tape"]));
    vision.respond("readMeasurements", { tapeVisible: true, measurements: [{ name: "chest", valueCm: 50, confidence: 0.9, evidence: null }, { name: "length", valueCm: 68, confidence: 0.2, evidence: "tape_photo" }, { name: "shoulders", valueCm: 44, confidence: 0.92, evidence: "tape_photo" }] });
    const eyeballed = (await prepareListing(ctx, { photos: [photo("face"), photo("ruban")], garmentKind: "top" })).articles[0]!;
    expect(eyeballed.measurements.find((m) => m.name === "chest")).toMatchObject({ valueCm: null, source: null });
    expect(eyeballed.measurements.find((m) => m.name === "length")).toMatchObject({ valueCm: null, source: null });
    expect(eyeballed.measurements.find((m) => m.name === "shoulders")).toMatchObject({ valueCm: 44, source: "tape_photo" });
    // Aucune photo d'étiquette : marque et taille vides avec questions, jamais devinées.
    expect(eyeballed.fields.brand).toMatchObject({ value: null, source: null });
    expect(eyeballed.questions.some((q) => q.field === "brand")).toBe(true);
    expect(vision.count("readLabel")).toBe(1);
  });

  it("référence lue sur l'étiquette → mesures de la base (« reference_db ») ; seul l'opérateur fournit une référence", async () => {
    if (!available) return;
    const op = await setupOrg("agence", { operator: true });
    const ctx = await setupOrg();
    await expectAppError(provideSizeReference(ctx, { brand: "Levi's", reference: "501-0115", size: "W32 L32", category: "bottom", measurements: { waist: 41 } }), 403, "forbidden");
    const ref = await provideSizeReference(op, { brand: "Levi's", reference: "501-0115", size: "W32 L32", category: "bottom", measurements: { waist: 41, inseam: 81 } });
    expect(ref).toMatchObject({ source: "provided", size: "W32 L32", measurements: { waist: 41, inseam: 81 } });
    expect((await listSizeReferences(ctx, { brand: "levis" })).map((r) => r.reference)).toEqual(["501-0115"]);
    vision.respond("sortPhotos", sortOf(["front", "label"]));
    vision.respond("readLabel", { brand: read("LEVI'S"), size: read("W32 L32"), material: read("99 % coton"), reference: read("501 0115") });
    const a = (await prepareListing(ctx, { photos: [photo("face"), photo("etiquette")], garmentKind: "bottom" })).articles[0]!;
    expect(a.measurements.find((m) => m.name === "waist")).toMatchObject({ valueCm: 41, source: "reference_db" });
    expect(a.measurements.find((m) => m.name === "inseam")).toMatchObject({ valueCm: 81, source: "reference_db" });
    expect(a.sizeReference).toEqual({ brand: "Levi's", reference: "501-0115", size: "W32 L32" });
    expect(a.questions.some((q) => q.field === "waist" || q.field === "inseam")).toBe(false);
    // Autre taille : la référence est connue mais pas ses mesures dans cette taille, rien n'est repris.
    vision.respond("sortPhotos", sortOf(["front", "label"]));
    vision.respond("readLabel", { brand: read("Levi's"), size: read("W34 L34"), material: null, reference: read("501-0115") });
    const other = (await prepareListing(ctx, { photos: [photo("face"), photo("etiquette")], garmentKind: "bottom" })).articles[0]!;
    expect(other.measurements.find((m) => m.name === "waist")).toMatchObject({ valueCm: null, source: null });
    expect(other.warnings.join(" ")).toMatch(/pas dans cette taille/);
  });

  it("réponses du vendeur → provenance « seller » ; partage anonyme seulement s'il est coché ; generateListing avec prepId ne relit rien", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    vision.respond("sortPhotos", sortOf(["front", "label", "back"]));
    vision.respond("readLabel", { brand: read("Zara"), size: read("M"), material: read("100 % coton"), reference: null });
    const prep = await prepareListing(ctx, { photos: [photo("face"), photo("etiquette"), photo("dos")], garmentKind: "top" });
    const prepId = prep.articles[0]!.prepId;
    expect(prep.articles[0]!.status).toBe("draft");
    const callsAfterPrep = vision.calls.length;
    // Une préparation non validée ne se génère pas.
    await expectAppError(generateListing(ctx, { prepId }), 409, "prep_not_validated");

    // Sans case cochée : rien n'est partagé.
    const first = await validatePrep(ctx, prepId, { measurements: { chest: 52 }, fields: { reference: "ZR-0001" } });
    expect(first.shared).toEqual({ done: false, reason: null });
    expect(await services.db.withGlobal((g) => repos.sizeReferences.count(g))).toBe(0);
    // Avec la case cochée : mesures validées du vendeur partagées, sans aucune donnée d'organisation.
    const res = await validatePrep(ctx, prepId, { measurements: { chest: 52, length: 70.3 }, fields: { reference: "ZR-0001" }, shareMeasurements: true });
    expect(res.prep.status).toBe("validated");
    expect(res.prep.fields.brand).toMatchObject({ value: "Zara", source: "label" });
    expect(res.prep.fields.reference).toEqual({ value: "ZR-0001", source: "seller" });
    expect(res.prep.measurements.find((m) => m.name === "chest")).toEqual({ name: "chest", valueCm: 52, source: "seller" });
    expect(res.prep.measurements.find((m) => m.name === "length")).toEqual({ name: "length", valueCm: 70.5, source: "seller" });
    expect(res.prep.questions.map((q) => q.field)).toEqual(["shoulders"]);
    expect(res.shared).toEqual({ done: true, reason: null });
    const shared = await owner.query("select * from size_references");
    expect(shared.rows).toHaveLength(1);
    expect(shared.rows[0]).toMatchObject({ brand: "Zara", reference: "ZR-0001", size: "M", category: "top", source: "seller_validated", measurements: { chest: 52, length: 70.5 } });
    expect(Object.keys(shared.rows[0]).some((k) => /org|user|email|photo/.test(k))).toBe(false);
    // Le partage ne fait qu'ajouter : il n'écrase jamais une mesure déjà connue.
    vision.respond("sortPhotos", sortOf(["front", "label"]));
    vision.respond("readLabel", { brand: read("ZARA"), size: read("M"), material: null, reference: read("ZR0001") });
    const reused = (await prepareListing(ctx, { photos: [photo("face"), photo("etiquette")], garmentKind: "top" })).articles[0]!;
    expect(reused.measurements.find((m) => m.name === "chest")).toMatchObject({ valueCm: 52, source: "reference_db" });
    expect((await validatePrep(ctx, reused.prepId, { measurements: { chest: 60, shoulders: 44 }, shareMeasurements: true })).shared.done).toBe(true);
    expect((await owner.query("select measurements from size_references")).rows[0].measurements).toEqual({ chest: 52, length: 70.5, shoulders: 44 });
    // Sans référence : partage impossible, et dit pourquoi.
    vision.respond("sortPhotos", sortOf(["front"]));
    const noRef = (await prepareListing(ctx, { photos: [photo("face")], garmentKind: "top" })).articles[0]!;
    expect((await validatePrep(ctx, noRef.prepId, { measurements: { chest: 50 }, shareMeasurements: true })).shared).toMatchObject({ done: false, reason: expect.stringMatching(/Marque et référence/) });

    // Génération : aucune relecture des photos (ni tri, ni étiquette, ni ruban), champs de la préparation imposés.
    const before = await counts(ctx);
    const callsBeforeGeneration = vision.calls.length;
    expect(callsBeforeGeneration).toBe(callsAfterPrep + 3); // les deux préparations suivantes : tri + étiquette, puis tri
    const draft = await generateListing(ctx, { prepId, photos: [photo("face"), photo("dos")] });
    expect(vision.calls.length).toBe(callsBeforeGeneration);
    expect(draft).toMatchObject({ prepId, brand: "Zara", size: "M", material: "100 % coton" });
    expect(draft.description).toContain("Mesures à plat : poitrine 52 cm, longueur 70,5 cm.");
    expect(draft.fields?.brand.source).toBe("label");
    expect(draft.measurements?.find((m) => m.name === "length")).toMatchObject({ valueCm: 70.5, source: "seller" });
    const after = await counts(ctx);
    expect(after.listings - before.listings).toBe(1);
    expect((await getPrep(ctx, prepId)).listingGeneratedAt).toBe(T0.toISOString());
    expect((await listPreps(ctx, { batchId: prep.batchId })).map((p) => p.prepId)).toEqual([prepId]);
    // Une autre organisation ne voit ni ne génère la préparation (RLS).
    const other = await setupOrg();
    await expectAppError(getPrep(other, prepId), 404, "not_found");
    await expectAppError(generateListing(other, { prepId }), 404, "not_found");
  });

  it("avec prepId, une marque ou une taille non lue n'est jamais reprise du modèle ; seules les photos de l'article (pas l'étiquette) sont envoyées", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    vision.respond("sortPhotos", sortOf(["front", "label", "tape", "back", "detail", "defect"]));
    vision.respond("readLabel", { brand: null, size: null, material: null, reference: null });
    vision.respond("readMeasurements", { tapeVisible: true, measurements: [{ name: "chest", valueCm: 48, confidence: 0.9, evidence: "tape_photo" }] });
    const prep = await prepareListing(ctx, { photos: ["f", "l", "t", "b", "d", "x"].map((id) => photo(id)), garmentKind: "top" });
    const prepId = prep.articles[0]!.prepId;
    await validatePrep(ctx, prepId, {});
    const provider = new ScriptedProvider(listingOut());
    services.ai = scriptedAi(provider);
    const draft = await generateListing(ctx, { prepId, photos: ["f", "l", "t", "b", "d", "x"].map((id) => photo(id)) });
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]!.images).toHaveLength(4); // face, dos, détail, défaut : ni l'étiquette ni le mètre
    expect(provider.requests[0]!.prompt).toContain("Marque inconnue");
    expect(draft.brand).toBeNull();
    expect(draft.size).toBeNull();
    expect(draft.title).toBe("Pull bleu marine");
    expect(draft.description).not.toContain("Zara");
    expect(draft.description).toContain("Mesures à plat : poitrine 48 cm.");
    expect(draft.warnings.join(" ")).toMatch(/Marque « Zara » retirée/);
    expect(draft.warnings.join(" ")).toMatch(/Taille inconnue/);
  });

  it("mesures et matière inventées par le modèle : retirées de l'annonce ; seules celles de la préparation (avec provenance) sont citées", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    vision.respond("sortPhotos", sortOf(["front", "tape"]));
    vision.respond("readMeasurements", { tapeVisible: true, measurements: [{ name: "chest", valueCm: 48, confidence: 0.9, evidence: "tape_photo" }] });
    const prepId = (await prepareListing(ctx, { photos: [photo("f"), photo("t")], garmentKind: "top" })).articles[0]!.prepId;
    await validatePrep(ctx, prepId, { fields: { brand: "Sans marque", size: "M" }, measurements: { length: 70, shoulders: null } });
    const provider = new ScriptedProvider(listingOut({
      title: "Pull bleu marine 68 cm taille M",
      description: "Pull en maille, en coton, coloris bleu marine. Longueur 68 cm, épaules 44 cm, poitrine 48 cm. Très bon état. Envoi soigné sous 48 h.",
      brand: null,
      size: "M",
      material: "Coton",
    }));
    services.ai = scriptedAi(provider);
    const draft = await generateListing(ctx, { prepId, photos: [photo("f")] });
    // Consignes : les faits connus (mesures avec provenance) et les inconnus (matière) sont dits au rédacteur.
    expect(provider.requests[0]!.prompt).toContain("Matière inconnue : n'en cite aucune.");
    expect(provider.requests[0]!.prompt).toContain("Mesures à plat : poitrine 48 cm, longueur 70 cm.");
    expect(provider.requests[0]!.system).toMatch(/n'écris AUCUNE mesure en cm autre que celles fournies/);
    // 68 cm et 44 cm ne viennent de nulle part : retirés (mention dans le titre, phrase entière dans la description) ; la matière « vue » aussi.
    expect(draft.title).toBe("Pull bleu marine taille M");
    expect(draft.description).not.toMatch(/68 cm|44 cm/);
    expect(draft.description).not.toMatch(/coton/i);
    expect(draft.description).toContain("Mesures à plat : poitrine 48 cm, longueur 70 cm.");
    expect(draft.description).toContain("Très bon état.");
    expect(extractCmValues(`${draft.title}\n${draft.description}`).every((v) => v === 48 || v === 70)).toBe(true);
    expect(draft.material).toBeNull();
    expect(draft.warnings.join(" ")).toMatch(/Mesures inventées par le modèle retirées \(68 cm, 44 cm\)/);
    expect(draft.warnings.join(" ")).toMatch(/Matière « Coton » retirée/);
    expect(draft.measurements?.map((m) => [m.name, m.valueCm, m.source])).toEqual(expect.arrayContaining([["chest", 48, "tape_photo"], ["length", 70, "seller"]]));
  });

  it("le silence ne vaut pas confirmation : lecture peu sûre (0,5–0,7) ou désaccord entre sources → 409 tant que le vendeur n'a pas répondu ; confirmée ou corrigée, la valeur devient « seller »", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    vision.respond("sortPhotos", sortOf(["front", "label", "tape"]));
    vision.respond("readLabel", { brand: read("Levi's"), size: read("W32 L32", 0.62), material: null, reference: null, text: "LEVI'S W32 L32" });
    vision.respond("readMeasurements", { tapeVisible: true, measurements: [{ name: "waist", valueCm: 41, confidence: 0.9, evidence: "tape_photo" }, { name: "inseam", valueCm: 81, confidence: 0.55, evidence: "tape_photo" }] });
    const prep = (await prepareListing(ctx, { photos: [photo("f"), photo("l"), photo("t")], garmentKind: "bottom", hints: { measurements: { waist: 44 } } })).articles[0]!;
    expect(prep.fields.size).toMatchObject({ value: "W32 L32", source: "label", confidence: 0.62 });
    expect(prep.measurements.find((m) => m.name === "waist")).toMatchObject({ valueCm: 41, source: "tape_photo", question: expect.stringMatching(/44 cm/) });
    expect(prep.questions.map((q) => [q.field, q.reason])).toEqual(expect.arrayContaining([["size", "low_confidence"], ["waist", "conflict"], ["inseam", "low_confidence"]]));
    // Sans réponse : refus, avec la liste des champs à confirmer ; la préparation reste un brouillon.
    const e = await expectAppError(validatePrep(ctx, prep.prepId, {}), 409, "prep_unconfirmed");
    expect((e.details as { fields: { field: string }[] }).fields.map((f) => f.field).sort()).toEqual(["inseam", "size", "waist"]);
    expect(e.message).toMatch(/Confirmez d'abord/);
    expect((await getPrep(ctx, prep.prepId)).status).toBe("draft");
    await expectAppError(generateListing(ctx, { prepId: prep.prepId }), 409, "prep_not_validated");
    // Répondre à une partie seulement ne suffit pas.
    await expectAppError(validatePrep(ctx, prep.prepId, { fields: { size: "W32 L32" } }), 409, "prep_unconfirmed");
    // Confirmée telle quelle (taille, entrejambe) ou corrigée (tour de taille) : la valeur devient « seller », plus aucune question sur ces champs.
    const v = await validatePrep(ctx, prep.prepId, { fields: { size: "W32 L32" }, measurements: { waist: 44, inseam: 81 } });
    expect(v.prep.status).toBe("validated");
    expect(v.prep.fields.size).toEqual({ value: "W32 L32", source: "seller" });
    expect(v.prep.measurements.find((m) => m.name === "waist")).toEqual({ name: "waist", valueCm: 44, source: "seller" });
    expect(v.prep.measurements.find((m) => m.name === "inseam")).toEqual({ name: "inseam", valueCm: 81, source: "seller" });
    expect(v.prep.questions.filter((q) => q.reason === "low_confidence" || q.reason === "conflict")).toEqual([]);
  });

  it("partage anonyme : seules les mesures sûres et sans question partent (jamais une lecture à confirmer ni une mesure reprise de la base) ; référence trop courte → raison ; refus de la base → raison, validation gardée", async () => {
    if (!available) return;
    // Fonction pure : saisie du vendeur et ruban sûr (≥ 0,7) partagés ; ruban peu sûr, mesure encore en question, base : jamais.
    const open = [studioQuestion("hips", "conflict")];
    expect(shareableMeasurements([
      { name: "chest", valueCm: 52, source: "seller" },
      { name: "length", valueCm: 70, source: "tape_photo", confidence: 0.9 },
      { name: "shoulders", valueCm: 44, source: "tape_photo", confidence: 0.55 },
      { name: "hips", valueCm: 50, source: "seller" },
      { name: "waist", valueCm: 40, source: "reference_db" },
      { name: "sleeve", valueCm: null, source: null },
    ], open)).toEqual({ chest: 52, length: 70 });
    expect(shareBlocker("Zara", "A")).toMatch(/Référence trop courte/);
    expect(shareBlocker("—", "ZR-1")).toMatch(/Marque trop courte/);
    expect(shareBlocker("Zara", "ZR-1")).toBeNull();

    const ctx = await setupOrg();
    vision.respond("sortPhotos", sortOf(["front", "label"]));
    vision.respond("readLabel", { brand: read("Zara"), size: read("M"), material: null, reference: null, text: "ZARA M" });
    const prep = (await prepareListing(ctx, { photos: [photo("f"), photo("l")], garmentKind: "top" })).articles[0]!;
    // Référence « A » : la base l'exigerait avec 2 caractères ; la validation passe, le partage dit pourquoi il n'a pas eu lieu.
    const short = await validatePrep(ctx, prep.prepId, { fields: { reference: "A" }, measurements: { chest: 52 }, shareMeasurements: true });
    expect(short.prep.status).toBe("validated");
    expect(short.shared).toEqual({ done: false, reason: expect.stringMatching(/Référence trop courte/) });
    expect(await services.db.withGlobal((g) => repos.sizeReferences.count(g))).toBe(0);
    // Refus de la base elle-même (erreur SQL dans la transaction) : point de reprise, la validation est gardée, raison rendue.
    const contribute = vi.spyOn(repos.sizeReferences, "contribute").mockImplementationOnce(async (tx) => { await tx.query("select 1 / 0"); return null; });
    const refused = await validatePrep(ctx, prep.prepId, { fields: { reference: "ZR-0009" }, measurements: { chest: 52 }, shareMeasurements: true });
    contribute.mockRestore();
    expect(refused.prep).toMatchObject({ status: "validated", fields: { reference: { value: "ZR-0009", source: "seller" } } });
    expect(refused.shared).toEqual({ done: false, reason: expect.stringMatching(/La base des références a refusé/) });
    expect((await getPrep(ctx, prep.prepId)).fields.reference.value).toBe("ZR-0009");
    expect(await services.db.withGlobal((g) => repos.sizeReferences.count(g))).toBe(0);
    // Puis le partage normal fonctionne.
    expect((await validatePrep(ctx, prep.prepId, { measurements: { chest: 52 }, shareMeasurements: true })).shared).toEqual({ done: true, reason: null });
    expect(await services.db.withGlobal((g) => repos.sizeReferences.count(g))).toBe(1);
  });

  it("provenance du rôle d'une photo : « seller » quand le vendeur l'indique, « model » sinon, même quand le modèle est sûr à 100 %", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    vision.respond("sortPhotos", { photos: [{ index: 0, role: "front", articleGroup: 1, confidence: 1 }, { index: 1, role: "detail", articleGroup: 1, confidence: 0.4 }] });
    const prep = await prepareListing(ctx, { photos: [photo("f"), photo("l", 1024, 768, { role: "label" })], garmentKind: "top" });
    expect(prep.photos.map((p) => [p.index, p.role, p.confidence, p.roleSource])).toEqual([[0, "front", 1, "model"], [1, "label", 1, "seller"]]);
    expect((await getPrep(ctx, prep.articles[0]!.prepId)).photos.map((p) => p.roleSource)).toEqual(["model", "seller"]);
  });

  it("générateur sans préparation : 6 photos au plus envoyées au modèle, pleine taille refusée", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const provider = new ScriptedProvider(listingOut());
    services.ai = scriptedAi(provider);
    const draft = await generateListing(ctx, { photos: Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, url: dataUrl(png(1024, 768)), alt: `photo-${i}.jpg` })) });
    expect(provider.requests[0]!.images).toHaveLength(6);
    expect(draft.warnings.join(" ")).toMatch(/6 photos sur 12/);
    expect((await counts(ctx)).listings).toBe(1);
    await expectAppError(generateListing(ctx, { photos: [{ id: "grande", url: dataUrl(png(4032, 3024)), alt: "" }] }), 400, "photo_rejected");
    expect(provider.requests).toHaveLength(1);
    // Entre 1 024 et 1 600 px sans réducteur : refusée sur ce chemin aussi (le serveur réduit ou refuse, il n'envoie jamais plus grand au modèle).
    expect((await expectAppError(generateListing(ctx, { photos: [{ id: "moyenne", url: dataUrl(png(1400, 1050)), alt: "" }] }), 400, "photo_rejected")).details).toMatchObject({ reason: "needs_reduction", width: 1400 });
    expect(provider.requests).toHaveLength(1);
    // Seule tolérance (compatibilité) : une image dont les dimensions ne se lisent pas dans les en-têtes passe telle quelle, sous 1,5 Mo.
    await generateListing(ctx, { photos: [{ id: "opaque", url: `data:image/jpeg;base64,${Buffer.from("pas une image").toString("base64")}`, alt: "" }] });
    expect(provider.requests).toHaveLength(2);
  });

  it("quotas : Studio non inclus ou quota d'annonces atteint → 402 sans appeler le modèle ; la préparation n'est pas comptée", async () => {
    if (!available) return;
    const starter = await setupOrg("starter");
    const e = await expectAppError(prepareListing(starter, { photos: [photo("face")] }), 402, "quota_exceeded");
    expect(e.message).toMatch(/pas inclus/);
    const ctx = await setupOrg("pro");
    for (let i = 0; i < 3; i++) await prepareListing(ctx, { photos: [photo(`p${i}`)] });
    expect((await counts(ctx)).listings).toBe(0);
    expect((await billing.getUsage(ctx)).studio.listings.used).toBe(0);
    await services.db.withOrg(ctx.orgId, (tx) => repos.usage.record(tx, "studio.listing", {}, 20, T0.toISOString()));
    const calls = vision.calls.length;
    await expectAppError(prepareListing(ctx, { photos: [photo("face")] }), 402, "quota_exceeded");
    expect(vision.calls.length).toBe(calls);
  });

  it("vision indisponible ou aveugle : refus explicite ; panne du tri : 503 ; panne de l'étiquette : champs vides et avertissement", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    vision.canSeeImages = false;
    expect((await expectAppError(prepareListing(ctx, { photos: [photo("face")] }), 503, "ai_unavailable")).message).toMatch(/aucune valeur n'est devinée/);
    vision.canSeeImages = true;
    vision.respond("sortPhotos", new AIError("unavailable", "Ollama injoignable"));
    await expectAppError(prepareListing(ctx, { photos: [photo("face")] }), 503, "ai_unavailable");
    const failed = await services.db.withOrg(ctx.orgId, (tx) => repos.aiRequests.list(tx));
    expect(failed[0]).toMatchObject({ status: "failed" });
    vision.respond("sortPhotos", sortOf(["front", "label"]));
    vision.respond("readLabel", new AIError("timeout", "délai"));
    const a = (await prepareListing(ctx, { photos: [photo("face"), photo("etiquette")], garmentKind: "top" })).articles[0]!;
    expect(a.fields.brand).toMatchObject({ value: null, source: null });
    expect(a.warnings.join(" ")).toMatch(/étiquette indisponible \(timeout\)/);
    expect(a.questions.some((q) => q.field === "brand")).toBe(true);
  });

  it("photos par clé de stockage : lues par le serveur, jamais celles d'une autre organisation ; sans stockage : 503", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    const keys = [`org/${ctx.orgId}/studio-photo/a1.jpg`, `org/${ctx.orgId}/studio-photo/a2.jpg`];
    await expectAppError(prepareListing(ctx, { photos: [{ id: "a1", key: keys[0] }] }), 503, "storage_unconfigured");
    const reads: string[] = [];
    const store: StudioPhotoStore = { read: async (key) => { reads.push(key); return { data: png(1000, 800), contentType: "image/jpeg" }; } };
    services.studio = { vision, photos: store };
    vision.respond("sortPhotos", sortOf(["front", "back"]));
    const prep = await prepareListing(ctx, { photos: [{ id: "a1", key: keys[0] }, { id: "a2", key: keys[1], role: "back" }] });
    expect(reads).toEqual(keys);
    const view = await getPrep(ctx, prep.articles[0]!.prepId);
    expect(view.photos).toEqual([{ index: 0, id: "a1", key: keys[0], role: "front", confidence: 0.9, roleSource: "model" }, { index: 1, id: "a2", key: keys[1], role: "back", confidence: 1, roleSource: "seller" }]);
    const other = await setupOrg();
    await expectAppError(prepareListing(ctx, { photos: [{ id: "x", key: `org/${other.orgId}/studio-photo/x.jpg` }] }), 403, "forbidden");
    await expectAppError(prepareListing(ctx, { photos: [{ id: "x", key: keys[0], url: dataUrl(png(10, 10)) }] }), 400, "validation");
    // Génération à partir des clés : relues dans le stockage (pas de nouvel envoi du navigateur), sans relecture par le modèle 1.
    await validatePrep(ctx, prep.articles[0]!.prepId, { fields: { brand: "Sans marque", size: "M" } });
    reads.length = 0;
    const before = vision.calls.length;
    const draft = await generateListing(ctx, { prepId: prep.articles[0]!.prepId });
    expect(reads).toEqual(keys);
    expect(vision.calls.length).toBe(before);
    expect(draft.fields?.brand).toEqual({ value: "Sans marque", source: "seller" });
  });

  it("plusieurs articles dans un même envoi : une préparation par article, rôle du vendeur prioritaire", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    vision.respond("sortPhotos", { photos: [{ index: 0, role: "front", articleGroup: 7, confidence: 0.9 }, { index: 1, role: "front", articleGroup: 3, confidence: 0.8 }, { index: 2, role: "other", articleGroup: 3, confidence: 0.4 }] });
    const prep = await prepareListing(ctx, { photos: [photo("a"), photo("b"), photo("c", 1024, 768, { role: "label" })] });
    expect(prep.articles.map((a) => [a.articleGroup, a.photoIndexes])).toEqual([[1, [0]], [2, [1, 2]]]);
    expect(prep.photos.find((p) => p.index === 2)).toMatchObject({ role: "label", confidence: 1 });
    expect(vision.calls.filter((c) => c.method === "readLabel")).toEqual([{ method: "readLabel", images: 1 }]);
    expect(new Set(prep.articles.map((a) => a.prepId)).size).toBe(2);
    expect((await listPreps(ctx, { batchId: prep.batchId })).map((p) => p.articleGroup)).toEqual([1, 2]);
  });

  it("sans lecture injectée : la passerelle IA (simulateur) sert de modèle 1, préparation marquée simulée, rien sans provenance", async () => {
    if (!available) return;
    const ctx = await setupOrg();
    services.studio = {};
    const prep = await prepareListing(ctx, { photos: [photo("face"), photo("etiquette", 1024, 768, { role: "label" }), photo("ruban", 1024, 768, { role: "tape" })], garmentKind: "top" });
    expect(prep.simulated).toBe(true);
    expect(prep.warnings.join(" ")).toMatch(/Démonstration/);
    for (const a of prep.articles) {
      for (const f of Object.values(a.fields)) expect(f.value === null).toBe(f.source === null);
      for (const m of a.measurements) expect(m.valueCm === null).toBe(m.source === null);
    }
    expect((await getPrep(ctx, prep.articles[0]!.prepId)).simulated).toBe(true);
  });

  it("measurementsSentence : seulement les mesures avec provenance", () => {
    expect(measurementsSentence([{ name: "chest", valueCm: 52, source: "tape_photo" }, { name: "length", valueCm: null, source: null }, { name: "sleeve", valueCm: 61.5, source: "seller" }])).toBe("Mesures à plat : poitrine 52 cm, manche 61,5 cm.");
    expect(measurementsSentence([{ name: "chest", valueCm: null, source: null }])).toBe("");
  });
});
