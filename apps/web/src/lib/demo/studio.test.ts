import { beforeEach, describe, expect, it } from "vitest";
import { MemoryDemoStorage } from "@selio/demo-data";
import { STUDIO_MODEL_MAX_SIDE_PX, namedMeasurementField, studioTextField } from "@selio/contracts";
import { DemoClient } from "./client";
import { adjustToPrep, prepFacts } from "./studio";
import { DEMO_SAMPLE_SET } from "../studio/samples";
import { fakeJpegDataUrl } from "../studio/test-images";
import type { DemoPhotoContent, StudioPrepareRequest } from "../data/types";

// 13 h à Paris : hors de la fenêtre de nuit (22 h – 6 h).
let now = new Date("2026-11-04T12:00:00Z");
let client: DemoClient;
beforeEach(async () => {
  now = new Date("2026-11-04T12:00:00Z");
  client = new DemoClient(new MemoryDemoStorage(), () => now);
  await client.login({ email: "marie@demo.selio.local", password: "demo" });
});

/** Le jeu d'exemple (jean + pull) avec des photos factices de 768 × 1 024 px. */
function sampleRequest(): { input: StudioPrepareRequest; contents: Record<string, DemoPhotoContent> } {
  const photos = DEMO_SAMPLE_SET.map((s, i) => ({ id: `photo-${i + 1}`, url: fakeJpegDataUrl(768, 1024) }));
  const contents = Object.fromEntries(DEMO_SAMPLE_SET.map((s, i) => [`photo-${i + 1}`, s.content]));
  return { input: { photos }, contents };
}

const studioCount = async (kind: "studio.listing" | "studio.worn_photo") => (await client.listUsageEvents(500)).filter((u) => u.kind === kind).length;

describe("Studio façon Kavis dans la démonstration", () => {
  it("trie par article, lit l'étiquette et le mètre ruban avec leur provenance, sans compter d'annonce", async () => {
    const { input, contents } = sampleRequest();
    const before = await studioCount("studio.listing");
    const prep = await client.prepareStudio(input, { simulator: { photos: contents } });
    expect(prep.simulated).toBe(true);
    expect(prep.accuracy.status).toBe("to_measure");
    expect(prep.articles).toHaveLength(2);
    const [jean, pull] = prep.articles;
    expect(jean!.photoIndexes).toEqual([0, 1, 2, 3]);
    expect(prep.photos.map((p) => p.role)).toEqual(["front", "back", "label", "tape", "front", "label"]);
    // Étiquette du jean : lue, avec sa confiance.
    expect(jean!.fields.brand).toMatchObject({ value: "Levi's", source: "label", confidence: 0.92 });
    expect(jean!.fields.size).toMatchObject({ value: "W32 L32", source: "label" });
    expect(jean!.fields.reference).toMatchObject({ value: "501", source: "label" });
    // Mesures : tour de taille lu sur le ruban ; entrejambe et montant retrouvés par la référence.
    const m = Object.fromEntries(jean!.measurements.map((x) => [x.name, x]));
    expect(m.waist).toMatchObject({ valueCm: 41, source: "tape_photo", confidence: 0.88 });
    expect(m.inseam).toMatchObject({ valueCm: 81, source: "reference_db" });
    expect(m.rise).toMatchObject({ valueCm: 29, source: "reference_db" });
    expect(jean!.sizeReference).toEqual({ brand: "Levi's", reference: "501", size: "W32 L32" });
    // Chaque valeur a sa provenance (le schéma refuse une valeur sans provenance).
    for (const x of jean!.measurements) expect(namedMeasurementField.safeParse(x).success).toBe(true);
    for (const f of Object.values(jean!.fields)) expect(studioTextField.safeParse(f).success).toBe(true);
    // Pull : étiquette peu sûre (0,62) → valeurs à confirmer, avec la question.
    expect(pull!.fields.brand).toMatchObject({ value: "Sézane", source: "label", confidence: 0.62 });
    expect(pull!.questions.find((q) => q.field === "brand")).toMatchObject({ reason: "low_confidence" });
    expect(pull!.tapeVisible).toBe(false);
    // Rien n'est compté dans le quota Studio à cette étape (seulement une requête IA).
    expect(await studioCount("studio.listing")).toBe(before);
    const p = await client.getStudioPrep(jean!.prepId);
    expect(p.photos.map((x) => x.id)).toEqual(["photo-1", "photo-2", "photo-3", "photo-4"]);
  });

  it("avec les photos du vendeur, le simulateur ne lit rien : champs vides et questions, jamais une valeur devinée", async () => {
    const prep = await client.prepareStudio({ photos: [{ id: "a", url: fakeJpegDataUrl() }, { id: "b", url: fakeJpegDataUrl() }], notes: "jean slim" }, { simulator: { photos: { a: { name: "ralph-lauren-jean-bleu.jpg" }, b: { name: "etiquette.jpg" } } } });
    const a = prep.articles[0]!;
    expect(a.garmentKind).toBe("bottom");
    for (const key of ["brand", "size", "material", "reference"] as const) expect(a.fields[key]).toMatchObject({ value: null, source: null });
    // Ni la marque du nom de fichier, ni une taille : la question est posée.
    expect(a.questions.map((q) => q.field)).toEqual(expect.arrayContaining(["brand", "size", "material", "waist", "inseam"]));
    const waist = a.measurements.find((m) => m.name === "waist")!;
    expect(waist).toMatchObject({ valueCm: null, source: null });
    expect(waist.question).toMatch(/mètre ruban/);
  });

  it("refuse une photo de plus de 1 024 px avant tout appel (jamais de pleine taille)", async () => {
    const requestsBefore = (await client.listAiRequests()).length;
    await expect(client.prepareStudio({ photos: [{ id: "big", url: fakeJpegDataUrl(4032, 3024) }] })).rejects.toMatchObject({ code: "photo_rejected", status: 400 });
    expect(STUDIO_MODEL_MAX_SIDE_PX).toBe(1024);
    expect((await client.listAiRequests()).length).toBe(requestsBefore);
    await expect(client.prepareStudio({ photos: Array.from({ length: 13 }, (_, i) => ({ id: `p${i}`, url: fakeJpegDataUrl() })) })).rejects.toMatchObject({ code: "validation" });
  });

  it("validation : les réponses deviennent « vous », un champ vidé reste vide, et la génération reprend la préparation", async () => {
    const { input, contents } = sampleRequest();
    const prep = await client.prepareStudio(input, { simulator: { photos: contents } });
    const pull = prep.articles[1]!;
    await expect(client.generateListing({ prepId: pull.prepId, photos: [] })).rejects.toMatchObject({ code: "prep_not_validated" });
    // Étiquette peu sûre (0,62) : le silence ne vaut pas confirmation, la taille lue n'est pas validée sans réponse (409, champ listé).
    await expect(client.validateStudioPrep(pull.prepId, { fields: { brand: "Sézane", material: null }, measurements: { chest: 50.3, length: 62 }, garmentKind: "top" })).rejects.toMatchObject({ code: "prep_unconfirmed", status: 409, details: { fields: [expect.objectContaining({ field: "size", reason: "low_confidence" })] } });
    expect((await client.getStudioPrep(pull.prepId)).status).toBe("draft");
    const v = await client.validateStudioPrep(pull.prepId, { fields: { brand: "Sézane", size: "M", material: null }, measurements: { chest: 50.3, length: 62 }, garmentKind: "top" });
    expect(v.prep.status).toBe("validated");
    expect(v.prep.fields.brand).toMatchObject({ value: "Sézane", source: "seller" });
    expect(v.prep.fields.size).toEqual({ value: "M", source: "seller" });
    expect(v.prep.fields.material).toEqual({ value: null, source: null });
    expect(v.prep.measurements.find((m) => m.name === "chest")).toMatchObject({ valueCm: 50.5, source: "seller" });
    // Épaules : attendue pour un haut, toujours sans valeur → la question reste.
    expect(v.prep.questions.map((q) => q.field)).toContain("shoulders");
    const listings = await studioCount("studio.listing");
    const draft = await client.generateListing({ prepId: pull.prepId, photos: [{ id: "photo-5", url: fakeJpegDataUrl(768, 1024), alt: "pull-face.jpg" }] });
    expect(draft.prepId).toBe(pull.prepId);
    expect(draft.brand).toBe("Sézane");
    expect(draft.material).toBeNull();
    expect(draft.description).toContain("Mesures à plat : poitrine 50,5 cm, longueur 62 cm.");
    expect(draft.fields?.brand.source).toBe("seller");
    expect(await studioCount("studio.listing")).toBe(listings + 1);
  });

  it("sans marque connue, une marque « vue » par le modèle est retirée de l'annonce", async () => {
    const prep = await client.prepareStudio({ photos: [{ id: "a", url: fakeJpegDataUrl() }] }, { simulator: { photos: { a: { name: "pull.jpg" } } } });
    const id = prep.articles[0]!.prepId;
    await client.validateStudioPrep(id, {});
    const draft = await client.generateListing({ prepId: id, photos: [{ id: "a", url: fakeJpegDataUrl(), alt: "pull.jpg" }] });
    expect(draft.brand).toBeNull();
    expect(draft.warnings).toContain("Marque inconnue : à compléter avant de publier.");
  });

  it("rédaction : une mesure en cm ou une matière que la préparation ne connaît pas est retirée de l'annonce (miroir du serveur)", async () => {
    const prep = await client.prepareStudio({ photos: [{ id: "a", url: fakeJpegDataUrl() }] }, { simulator: { photos: { a: { name: "pull.jpg" } } } });
    const validated = (await client.validateStudioPrep(prep.articles[0]!.prepId, { measurements: { chest: 48 } })).prep;
    expect(prepFacts(validated)).toContain("Matière inconnue : n'en cite aucune.");
    expect(prepFacts(validated)).toContain("Mesures à plat : poitrine 48 cm.");
    const out = adjustToPrep({ title: "Pull bleu 68 cm", description: "Pull en maille, en coton. Longueur 68 cm, épaules 44 cm. Très bon état. Envoi soigné sous 48 h.", brand: "Zara", size: "M", material: "Coton" }, validated);
    expect(out.data).toMatchObject({ title: "Pull bleu", brand: null, size: null, material: null });
    expect(out.data.description).not.toMatch(/68 cm|44 cm|coton|Zara/i);
    expect(out.data.description).toContain("Pull en maille. Très bon état.");
    expect(out.data.description).toContain("Mesures à plat : poitrine 48 cm.");
    expect(out.warnings.join(" ")).toMatch(/Mesures inventées par le modèle retirées \(68 cm, 44 cm\)/);
    expect(out.warnings.join(" ")).toMatch(/Matière « Coton » retirée/);
  });

  it("partage anonyme : marque, référence, taille et mesures validées rejoignent la base ; un exemple fourni n'est jamais modifié", async () => {
    const { input, contents } = sampleRequest();
    const prep = await client.prepareStudio(input, { simulator: { photos: contents } });
    const jean = prep.articles[0]!;
    const shared = await client.validateStudioPrep(jean.prepId, { measurements: { hips: 50 }, shareMeasurements: true });
    expect(shared.shared).toEqual({ done: false, reason: "Cette référence est déjà fournie par Selio : elle n'est pas modifiée." });

    const other = await client.prepareStudio({ photos: [{ id: "x", url: fakeJpegDataUrl() }], hints: { brand: "Levi's", reference: "511", size: "W31 L32" } }, { simulator: { photos: { x: { name: "jean.jpg" } } } });
    const first = await client.validateStudioPrep(other.articles[0]!.prepId, { measurements: { waist: 40 }, shareMeasurements: true });
    expect(first.shared).toEqual({ done: true, reason: null });
    // Un autre envoi du même modèle retrouve la mesure dans la base, marquée comme telle.
    const again = await client.prepareStudio({ photos: [{ id: "y", url: fakeJpegDataUrl() }], hints: { brand: "levis", reference: "511", size: "W31 L32" }, garmentKind: "bottom" }, { simulator: { photos: { y: { name: "jean.jpg" } } } });
    expect(again.articles[0]!.measurements.find((m) => m.name === "waist")).toMatchObject({ valueCm: 40, source: "reference_db" });
    const noRef = await client.validateStudioPrep(again.articles[0]!.prepId, { fields: { reference: null }, shareMeasurements: true });
    expect(noRef.shared.done).toBe(false);
  });
});

describe("photos portées dans la démonstration", () => {
  it("quota du plan, file de nuit, aucun fournisseur : refus honnête la nuit et place rendue", async () => {
    const first = await client.wornPhotos();
    expect(first.status.provider).toMatchObject({ name: "noop", configured: false, message: "aucun fournisseur configuré : décision à prendre" });
    expect(first.status.counter).toMatchObject({ used: 0, quota: 10 });
    expect(first.status.overage).toMatchObject({ enabled: false, unitCents: 25, proposal: true });
    // Prochaine fenêtre : ce soir 22 h à Paris (21 h UTC en novembre).
    expect(first.status.nextWindow).toMatchObject({ start: "2026-11-04T21:00:00.000Z", end: "2026-11-05T05:00:00.000Z", inWindow: false });

    const stored = await client.uploadStudioPhoto({ id: "w1", url: fakeJpegDataUrl(), alt: "pull.jpg" });
    expect(stored.key).toMatch(/^org\/[^/]+\/studio-photo\/[A-Za-z0-9-]+\.jpg$/);
    const job = await client.requestWornPhoto({ photoKey: stored.key, pose: "front" });
    expect(job).toMatchObject({ status: "queued", provider: "noop", scheduledFor: "2026-11-04T21:00:00.000Z", overageCents: 0 });
    expect(await studioCount("studio.worn_photo")).toBe(1);
    await expect(client.requestWornPhoto({ photoKey: "org/autre-org/studio-photo/abc.jpg" })).rejects.toMatchObject({ status: 403 });

    // La nuit venue : refusée proprement (aucun fournisseur), place de quota rendue.
    now = new Date("2026-11-04T21:30:00Z");
    const night = await client.wornPhotos();
    expect(night.jobs[0]).toMatchObject({ status: "refused", error: "aucun fournisseur configuré : décision à prendre" });
    expect(night.status.counter.used).toBe(0);
  });

  it("annulation d'une demande en file : place rendue ; au-delà du quota, refus (dépassement désactivé)", async () => {
    const { key } = await client.uploadStudioPhoto({ id: "w1", url: fakeJpegDataUrl(), alt: "pull.jpg" });
    const job = await client.requestWornPhoto({ photoKey: key });
    await expect(client.cancelWornPhoto(job.id)).resolves.toEqual({ cancelled: true, id: job.id });
    expect((await client.wornPhotos()).status.counter.used).toBe(0);
    for (let i = 0; i < 10; i++) await client.requestWornPhoto({ photoKey: key, acceptOverage: true });
    const full = await client.wornPhotos();
    expect(full.status.counter).toMatchObject({ used: 10, quota: 10, exceeded: true });
    await expect(client.requestWornPhoto({ photoKey: key, acceptOverage: true })).rejects.toMatchObject({ code: "quota_exceeded", status: 402, details: { overageAvailable: false } });
  });
});
