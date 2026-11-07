import { z } from "zod";
import { AIError, type AIService, type StudioSimulatorHints } from "@selio/ai";
import {
  LABEL_FIELDS, LABEL_FIELD_LABELS, MEASUREMENT_LABELS, MEASUREMENT_NAMES, STUDIO_LABEL_MAX_PHOTOS, STUDIO_MAX_PHOTOS, STUDIO_TAPE_MAX_PHOTOS, STUDIO_TRUSTED_CONFIDENCE,
  garmentKind, itemCategory, labelReadOutput, measurementName, measurementValues, measurementsOutput, namedMeasurementField, photoRole, studioSellerHints,
  type GarmentKind, type LabelFieldName, type LabelReadOutput, type MeasurementName, type MeasurementsOutput, type NamedMeasurementField, type PhotoRole, type PhotoSortOutput, type SellerQuestion, type SizeReference, type SortedPhoto, type StudioFields,
} from "@selio/contracts";
import { assembleStudioPrep, buildSellerQuestions, checkModelImage, garmentKindFor, groupPhotosByArticle, matchSizeReference, mergeFields, photosWithRole, simplifyText, stripUnknownMeasurements, type StudioArticleInput } from "@selio/domain";
import { DataError, type DemoPhotoContent, type StudioPrepAnswersInput, type StudioPrepResultView, type StudioPrepView, type ValidatePrepResultView, type WornPhotoView } from "../data/types";

/**
 * Studio façon Kavis dans la démonstration (§5.11) : même enchaînement que `prepareListing` et
 * `validatePrep` (packages/core/src/services/studio.ts), avec le simulateur de @selio/ai et les fonctions
 * pures de @selio/domain. Le simulateur ne voit pas les photos : il ne « lit » que ce que décrit une photo
 * d'exemple (`DemoPhotoContent`) ; pour une photo du vendeur, l'étiquette est illisible et aucun ruban
 * n'est visible, honnêtement : les champs restent vides avec leur question.
 */

export interface DemoSizeReference extends SizeReference {
  /** Exemple fourni avec la démonstration (comme une référence « fournie par Selio »), ou mesure partagée par le vendeur. */
  origin: "demo_example" | "seller_validated";
}

export type DemoWornJob = WornPhotoView & { usageEventId: string | null };

/** Message du fournisseur « noop » (miroir de NO_WORN_PROVIDER_MESSAGE côté serveur) : aucun modèle ni service n'est choisi. */
export const NO_WORN_PROVIDER = "aucun fournisseur configuré : décision à prendre";

/** Demande de rédaction à partir d'une préparation (`prepId`), plutôt que de photos seules. */
export function isFromPrepInput(input: unknown): boolean {
  const id = input && typeof input === "object" ? (input as { prepId?: unknown }).prepId : undefined;
  return id !== undefined && id !== null;
}

export interface DemoStudioState {
  version: 1;
  preps: StudioPrepView[];
  references: DemoSizeReference[];
  worn: DemoWornJob[];
}

/** Base des références de la démonstration : exemples FICTIFS, signalés comme tels à l'écran (« Base des références »). */
export const DEMO_SIZE_REFERENCES: readonly DemoSizeReference[] = [
  { brand: "Levi's", reference: "501", size: "W32 L32", category: "bottom", measurements: { waist: 41, inseam: 81, rise: 29 }, origin: "demo_example" },
  { brand: "Levi's", reference: "501", size: "W30 L32", category: "bottom", measurements: { waist: 39, inseam: 81, rise: 28.5 }, origin: "demo_example" },
  { brand: "Longchamp", reference: "L1899", size: null, category: "bag", measurements: { length: 30 }, origin: "demo_example" },
];

export function seedDemoStudio(): DemoStudioState {
  return { version: 1, preps: [], references: DEMO_SIZE_REFERENCES.map((r) => ({ ...r, measurements: { ...r.measurements } })), worn: [] };
}

/** Préparations gardées dans la démonstration (les plus récentes). */
const MAX_DEMO_PREPS = 60;

// ---------------------------------------------------------------- entrée

const prepPhotoInput = z
  .object({
    id: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "Identifiant de photo invalide"),
    key: z.string().trim().max(300).optional(),
    url: z.string().max(3_000_000).regex(/^data:image\/(jpeg|png|webp);base64,/, "Photo JPEG, PNG ou WebP attendue").optional(),
    role: photoRole.optional(),
  })
  .refine((p) => (p.key ? 1 : 0) + (p.url ? 1 : 0) === 1, "Chaque photo : une clé de stockage ou une photo réduite, l'une ou l'autre.");

const prepareInput = z.object({
  photos: z.array(prepPhotoInput).min(1, "Ajoutez au moins une photo").max(STUDIO_MAX_PHOTOS, `${STUDIO_MAX_PHOTOS} photos au plus`),
  itemId: z.string().nullable().default(null),
  category: itemCategory.nullable().default(null),
  garmentKind: garmentKind.optional(),
  notes: z.string().trim().max(200).optional(),
  hints: studioSellerHints.default({}),
});

/** Clé de rapprochement de la base des références (miroir des colonnes `brand_key` / `reference_key` / `size_key`) : « Levi's » = « levis », « AB-123 » = « ab 123 ». */
export function referenceKey(s: string | null | undefined): string {
  return simplifyText(s ?? "").replace(/ /g, "");
}

export interface CheckedPrepPhoto {
  id: string;
  key: string | null;
  url: string;
  role: PhotoRole | undefined;
}

/**
 * Entrée de la préparation vérifiée AVANT tout appel et avant toute requête IA enregistrée (comme le serveur :
 * contrôle des photos, puis quotas) : 12 photos au plus, chacune lisible, ≤ 1 024 px de côté long et ≤ 1 Mo.
 */
export function checkPrepareInput(raw: unknown, uploads: ReadonlyMap<string, string>): { input: z.infer<typeof prepareInput>; photos: CheckedPrepPhoto[] } {
  const parsed = prepareInput.safeParse(raw);
  if (!parsed.success) throw new DataError("validation", parsed.error.issues[0]?.message ?? "Demande invalide", 400, parsed.error.flatten());
  const input = parsed.data;
  const photos = input.photos.map((p) => {
    const url = p.url ?? (p.key ? uploads.get(p.key) : undefined);
    if (!url) throw new DataError("photo_rejected", `Photo ${p.id} : introuvable dans le stockage de la démonstration (envoyez la photo réduite).`, 400, { photoId: p.id, reason: "missing" });
    const check = checkModelImage(url);
    if (!check.ok) throw new DataError("photo_rejected", `Photo ${p.id} : ${check.reason}`, 400, { photoId: p.id, reason: check.code === "too_large" || check.code === "too_heavy" ? "needs_reduction" : "unreadable" });
    return { id: p.id, key: p.key ?? null, url, role: p.role };
  });
  return { input, photos };
}

/**
 * Le tri complété (miroir de `completeSort`) : chaque photo une fois, rôle du vendeur prioritaire, articles
 * renumérotés 1, 2… La provenance du rôle est posée explicitement (« seller » / « model »), jamais déduite de la confiance.
 */
export function completeSort(sort: PhotoSortOutput, count: number, roleHints: (PhotoRole | undefined)[]): PhotoSortOutput {
  const byIndex = new Map(sort.photos.map((p) => [p.index, p]));
  const firstGroup = [...sort.photos].sort((a, b) => a.index - b.index)[0]?.articleGroup ?? 1;
  const photos: SortedPhoto[] = [];
  for (let i = 0; i < count; i++) {
    const p = byIndex.get(i) ?? { index: i, role: "other" as PhotoRole, articleGroup: firstGroup, confidence: 0 };
    const hint = roleHints[i];
    photos.push(hint ? { ...p, role: hint, confidence: 1, roleSource: "seller" } : { ...p, roleSource: "model" });
  }
  const order = new Map<number, number>();
  for (const p of photos) if (!order.has(p.articleGroup)) order.set(p.articleGroup, order.size + 1);
  return { photos: photos.map((p) => ({ ...p, articleGroup: Math.min(12, order.get(p.articleGroup)!) })) };
}

/** Erreur du simulateur → erreur affichable (jamais une lecture inventée en repli). */
function aiFailure(err: unknown, what: string): DataError {
  if (err instanceof DataError) return err;
  const e = err instanceof AIError ? err : null;
  if (e?.code === "quota_exceeded") return new DataError("quota_exceeded", e.message, 402);
  if (e?.code === "invalid_output") return new DataError("ai_invalid_output", e.message, 422);
  if ((e?.code as string | undefined) === "input_rejected") return new DataError("photo_rejected", e!.message, 400);
  return new DataError("ai_unavailable", `${what} indisponible (${e?.code ?? "erreur"}). Vous pouvez remplir l'annonce à la main.`, 503);
}

const fatal = (err: unknown) => err instanceof AIError && (err.code === "quota_exceeded" || err.code === "cancelled");

export interface DemoPrepareArgs {
  ai: AIService;
  orgId: string;
  input: unknown;
  /** Contenu « visible » des photos d'exemple, par identifiant de photo. */
  contents?: Record<string, DemoPhotoContent>;
  /** Photos envoyées au stockage simulé (`uploadStudioPhoto`), par clé. */
  uploads: ReadonlyMap<string, string>;
  references: readonly SizeReference[];
  now: string;
  newId: () => string;
}

export interface DemoPrepareOutcome {
  result: StudioPrepResultView;
  views: StudioPrepView[];
  usage: { calls: number; promptTokens: number; outputTokens: number; latencyMs: number };
}

/** Préparation simulée : tri, étiquette, mètre ruban, base des références, fusion avec provenance et questions. */
export async function demoPrepare(args: DemoPrepareArgs): Promise<DemoPrepareOutcome> {
  // Photos : toutes vérifiées AVANT tout appel (même contrôle que le serveur : ≤ 1 024 px, ≤ 1 Mo, en-têtes lisibles).
  const checked = checkPrepareInput(args.input, args.uploads);
  const input = checked.input;
  const photos = checked.photos.map((p) => ({ ...p, content: args.contents?.[p.id] }));
  const images = photos.map((p) => p.url);
  const usage = { calls: 0, promptTokens: 0, outputTokens: 0, latencyMs: 0 };
  const add = (r: { usage: { promptTokens: number; outputTokens: number }; latencyMs: number }, calls = 1) => {
    usage.calls += calls;
    usage.promptTokens += r.usage.promptTokens;
    usage.outputTokens += r.usage.outputTokens;
    usage.latencyMs += r.latencyMs;
  };
  const warnings: string[] = [];
  let ocrUsed = false;
  try {
    // 1. Tri (au plus 6 photos par appel, lots réunis par le service IA).
    const hasGroups = photos.some((p) => p.content?.group);
    const sortSim: StudioSimulatorHints = {
      photoNames: photos.map((p) => p.content?.name ?? ""),
      roles: photos.map((p) => p.content?.role ?? null),
      ...(hasGroups ? { groups: photos.map((p) => p.content?.group ?? 1) } : {}),
    };
    const sorted = await args.ai.sortPhotos(args.orgId, images, { simulator: sortSim });
    add(sorted, sorted.calls);
    warnings.push(...sorted.warnings);
    const sort = completeSort(sorted.data, photos.length, photos.map((p) => p.role));
    const groups = groupPhotosByArticle(sort);

    // 2. Par article : étiquette (2 photos au plus), mètre ruban (3 au plus), base des références.
    const kind: GarmentKind = input.garmentKind ?? garmentKindFor({ text: input.notes ?? null, category: input.category });
    const articles: StudioArticleInput[] = [];
    for (const group of groups) {
      const articleWarnings: string[] = [];
      const articleQuestions: SellerQuestion[] = [];
      let label: LabelReadOutput | null = null;
      let tape: MeasurementsOutput | null = null;
      const labelPhotos = photosWithRole(group.photos, "label", STUDIO_LABEL_MAX_PHOTOS);
      if (labelPhotos.length > 0) {
        const c = labelPhotos.map((p) => photos[p.index]!.content).find((x) => x?.label || x?.ocrText);
        try {
          const call = await args.ai.readLabel(args.orgId, labelPhotos.map((p) => images[p.index]!), { simulator: c ? { label: c.label, ocrText: c.ocrText } : undefined });
          add(call);
          const p = labelReadOutput.safeParse(call.data);
          if (p.success) label = p.data;
          else articleWarnings.push("Lecture de l'étiquette illisible : rien n'est retenu, complétez les champs.");
          articleQuestions.push(...call.questions);
          articleWarnings.push(...call.warnings);
          ocrUsed ||= call.ocrUsed;
        } catch (err) {
          if (fatal(err)) throw err;
          articleWarnings.push(`Lecture de l'étiquette indisponible (${err instanceof AIError ? err.code : "erreur"}) : rien n'est retenu, complétez les champs.`);
        }
      } else {
        articleWarnings.push("Aucune photo d'étiquette : marque, taille et matière restent à indiquer (jamais devinées d'après le style).");
      }
      const tapePhotos = photosWithRole(group.photos, "tape", STUDIO_TAPE_MAX_PHOTOS);
      if (tapePhotos.length > 0) {
        const c = tapePhotos.map((p) => photos[p.index]!.content).find((x) => x?.tape);
        try {
          const call = await args.ai.readMeasurements(args.orgId, { images: tapePhotos.map((p) => images[p.index]!), garmentKind: kind }, { simulator: c?.tape ? { tape: c.tape } : undefined });
          add(call);
          const p = measurementsOutput.safeParse(call.data);
          if (p.success) tape = p.data;
          else articleWarnings.push("Lecture du mètre ruban illisible : aucune mesure n'est retenue.");
          articleQuestions.push(...call.questions);
          articleWarnings.push(...call.warnings);
        } catch (err) {
          if (fatal(err)) throw err;
          articleWarnings.push(`Lecture du mètre ruban indisponible (${err instanceof AIError ? err.code : "erreur"}) : aucune mesure n'est retenue.`);
        }
      }
      // Base des références : seulement par la marque et la référence lues (ou indiquées par le vendeur).
      const known = mergeFields(label, input.hints, null, tape).fields;
      let reference: SizeReference | null = null;
      if (known.brand.value && known.reference.value) {
        // Même rapprochement que la base (`brand_key`, `reference_key`) : « levis » retrouve « Levi's ».
        const same = args.references.filter((r) => referenceKey(r.brand) === referenceKey(known.brand.value) && referenceKey(r.reference) === referenceKey(known.reference.value));
        reference = matchSizeReference(same, { brand: known.brand.value, reference: known.reference.value, size: known.size.value });
        if (!reference && same.length > 0) articleWarnings.push("Référence connue de la base, mais pas dans cette taille : mesures non reprises.");
      }
      articles.push({ articleGroup: group.articleGroup, label, tape, hints: input.hints, reference, garmentKind: kind, text: input.notes ?? null, category: input.category, questions: articleQuestions, warnings: articleWarnings });
    }

    warnings.push("Démonstration : le simulateur ne lit pas réellement les photos, vérifiez chaque champ.");
    const prep = assembleStudioPrep({ sort, articles, warnings, simulated: true, ocr: { configured: args.ai.canOcr, used: ocrUsed } });
    const batchId = args.newId();
    const sortedByIndex = new Map(sort.photos.map((p) => [p.index, p]));
    const views: StudioPrepView[] = prep.articles.map((article) => ({
      prepId: args.newId(),
      batchId,
      articleGroup: article.articleGroup,
      status: "draft",
      itemId: input.itemId,
      garmentKind: article.garmentKind,
      category: input.category,
      fields: article.fields,
      measurements: article.measurements,
      questions: article.questions,
      warnings: article.warnings,
      photos: article.photoIndexes.map((i) => ({ index: i, id: photos[i]!.id, key: photos[i]!.key, role: sortedByIndex.get(i)?.role ?? "other", confidence: sortedByIndex.get(i)?.confidence ?? 0, roleSource: sortedByIndex.get(i)?.roleSource ?? "model" })),
      photoIndexes: article.photoIndexes,
      modelPhotoIndexes: article.modelPhotoIndexes,
      careSymbols: article.careSymbols,
      tapeVisible: article.tapeVisible,
      sizeReference: article.sizeReference,
      simulated: true,
      shareMeasurements: false,
      validatedAt: null,
      listingGeneratedAt: null,
      createdAt: args.now,
    }));
    return { result: { ...prep, batchId, articles: prep.articles.map((a, i) => ({ ...a, prepId: views[i]!.prepId, status: "draft" as const })) }, views, usage };
  } catch (err) {
    throw aiFailure(err, "Préparation");
  }
}

/** Ajoute des préparations à l'état (les plus récentes d'abord, 60 au plus). */
export function storePreps(state: DemoStudioState, views: StudioPrepView[]): void {
  state.preps = [...views, ...state.preps].slice(0, MAX_DEMO_PREPS);
}

export function prepById(state: DemoStudioState, prepId: string): StudioPrepView {
  const p = state.preps.find((x) => x.prepId === prepId);
  if (!p) throw new DataError("not_found", "Préparation introuvable.", 404);
  return p;
}

// ---------------------------------------------------------------- validation par le vendeur

const answerText = (max: number) => z.string().trim().max(max).nullable().transform((v) => (v && v.length > 0 ? v : null));
const prepAnswers = z.object({
  fields: z.object({ brand: answerText(80).optional(), size: answerText(40).optional(), material: answerText(80).optional(), reference: answerText(80).optional() }).default({}),
  measurements: z.record(measurementName, z.number().positive().max(300).nullable()).default({}),
  garmentKind: garmentKind.optional(),
  itemId: z.string().nullable().optional(),
  shareMeasurements: z.boolean().default(false),
});

const roundHalf = (v: number) => Math.round(v * 2) / 2;
const SIZE_FREE_KINDS: readonly GarmentKind[] = ["bag", "accessory"];

/**
 * Validation (miroir de `validatePrep`) : chaque réponse devient une valeur « seller » ou un champ volontairement
 * vide ; « partager anonymement la mesure » enrichit la base des références de la démonstration (marque,
 * référence, taille, mesures validées ; rien d'autre), sans modifier un exemple fourni.
 */
export function demoValidate(state: DemoStudioState, prepId: string, raw: StudioPrepAnswersInput | undefined, now: string): ValidatePrepResultView {
  const parsed = prepAnswers.safeParse(raw ?? {});
  if (!parsed.success) throw new DataError("validation", parsed.error.issues[0]?.message ?? "Réponses invalides", 400, parsed.error.flatten());
  const answers = parsed.data;
  const current = prepById(state, prepId);
  const answered = new Set<string>();
  const fields: StudioFields = { ...current.fields };
  for (const key of LABEL_FIELDS) {
    const v = answers.fields[key];
    if (v === undefined) continue;
    answered.add(key);
    fields[key] = v === null ? { value: null, source: null } : { value: v, source: "seller" };
  }
  const byName = new Map<MeasurementName, NamedMeasurementField>(current.measurements.map((m) => [m.name, m]));
  for (const [name, v] of Object.entries(answers.measurements) as [MeasurementName, number | null][]) {
    answered.add(name);
    byName.set(name, v === null ? { name, valueCm: null, source: null } : { name, valueCm: roundHalf(v), source: "seller" });
  }
  const order = new Map(MEASUREMENT_NAMES.map((n, i) => [n, i]));
  const measurements = [...byName.values()].sort((a, b) => order.get(a.name)! - order.get(b.name)!);
  for (const m of measurements) if (!namedMeasurementField.safeParse(m).success) throw new DataError("validation", `Mesure ${MEASUREMENT_LABELS[m.name]} invalide.`, 400);
  const kind = answers.garmentKind ?? current.garmentKind;
  const remaining = buildSellerQuestions(fields, measurements, kind, { tapeVisible: current.tapeVisible }).filter((q) => !answered.has(q.field));
  // Comme le serveur : une lecture peu sûre ou un désaccord entre deux sources ne se valide pas en silence.
  const unconfirmed = remaining.filter((q) => q.reason === "low_confidence" || q.reason === "conflict");
  if (unconfirmed.length > 0) {
    const labels = unconfirmed.map((q) => ((LABEL_FIELDS as readonly string[]).includes(q.field) ? LABEL_FIELD_LABELS[q.field as LabelFieldName] : MEASUREMENT_LABELS[q.field as MeasurementName]).toLowerCase());
    throw new DataError("prep_unconfirmed", `Confirmez d'abord ${labels.join(", ")} : lecture peu sûre ou en désaccord avec une autre source. Répondez à la question (confirmez la valeur ou corrigez-la) avant de générer.`, 409, { fields: unconfirmed });
  }
  const updated: StudioPrepView = { ...current, status: "validated", validatedAt: now, fields, measurements, questions: remaining, garmentKind: kind, shareMeasurements: answers.shareMeasurements, ...(answers.itemId !== undefined ? { itemId: answers.itemId } : {}) };
  state.preps = state.preps.map((p) => (p.prepId === prepId ? updated : p));

  let shared: ValidatePrepResultView["shared"] = { done: false, reason: null };
  if (answers.shareMeasurements) {
    const brand = fields.brand.value;
    const reference = fields.reference.value;
    const sizeFree = SIZE_FREE_KINDS.includes(kind);
    const size = sizeFree ? null : fields.size.value;
    const values = shareableMeasurements(measurements, remaining);
    const checked = measurementValues.safeParse(values);
    const blocker = brand && reference ? shareBlocker(brand, reference) : null;
    if (!brand || !reference) shared = { done: false, reason: "Marque et référence nécessaires pour partager une mesure." };
    else if (blocker) shared = { done: false, reason: blocker };
    else if (!sizeFree && !size) shared = { done: false, reason: "Taille nécessaire : les mesures d'un vêtement dépendent de sa taille." };
    else if (!checked.success || Object.keys(checked.data).length === 0) shared = { done: false, reason: "Aucune mesure confirmée à partager (saisie par vous, ou lue sur le ruban avec certitude)." };
    else {
      const key = (r: { brand: string; reference: string; size: string | null }) => `${referenceKey(r.brand)}|${referenceKey(r.reference)}|${referenceKey(r.size)}`;
      const existing = state.references.find((r) => key(r) === key({ brand, reference, size }));
      if (existing?.origin === "demo_example") shared = { done: false, reason: "Cette référence est déjà fournie par Selio : elle n'est pas modifiée." };
      else {
        // Comme la base partagée : une mesure déjà connue n'est pas remplacée, seules les manquantes s'ajoutent.
        if (existing) existing.measurements = { ...checked.data, ...existing.measurements };
        else state.references.push({ brand, reference, size, category: kind, measurements: checked.data, origin: "seller_validated" });
        shared = { done: true, reason: null };
      }
    }
  }
  return { prep: updated, shared };
}

/**
 * Mesures partageables (miroir du serveur) : saisies par le vendeur, ou lues sur le ruban avec certitude (≥ 0,7) ;
 * jamais une lecture « à confirmer », une mesure encore en question, ni une mesure reprise de la base.
 */
export function shareableMeasurements(measurements: readonly NamedMeasurementField[], remaining: readonly SellerQuestion[]): Record<string, number> {
  const open = new Set<string>(remaining.map((q) => q.field));
  return Object.fromEntries(
    measurements
      .filter((m) => m.valueCm !== null && !open.has(m.name) && (m.source === "seller" || (m.source === "tape_photo" && (m.confidence ?? 0) >= STUDIO_TRUSTED_CONFIDENCE)))
      .map((m) => [m.name, m.valueCm!]),
  );
}

/** Mêmes règles que la base des références (miroir du serveur) : marque avec ≥ 1 lettre ou chiffre, référence avec ≥ 2. */
export function shareBlocker(brand: string, reference: string): string | null {
  if (brand.replace(/[^\p{L}\p{N}]/gu, "").length < 1) return "Marque trop courte pour la base des références (une lettre ou un chiffre au moins).";
  if (reference.replace(/[^A-Za-z0-9]/g, "").length < 2) return "Référence trop courte pour la base des références (deux lettres ou chiffres au moins).";
  return null;
}

// ---------------------------------------------------------------- génération à partir d'une préparation

const DESCRIPTION_ROLE_ORDER: readonly PhotoRole[] = ["front", "back", "detail", "defect", "other"];
const STUDIO_DESCRIPTION_MAX_PHOTOS = 4;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const cmLabel = (v: number) => `${String(v).replace(".", ",")} cm`;
/** Nettoie la ponctuation laissée par le retrait d'un mot (« , . », « () », doubles espaces), sans toucher aux paragraphes. */
const tidyText = (s: string) => s.replace(/\(\s*\)/g, "").replace(/\s*,\s*(?=[.;!?,])/g, "").replace(/[ \t]{2,}/g, " ").trim();

/** « Mesures à plat : tour de taille 41 cm, entrejambe 81 cm. » (valeurs avec provenance seulement), ou "". */
export function measurementsSentence(measurements: readonly NamedMeasurementField[]): string {
  const known = measurements.filter((m) => m.valueCm !== null && m.source !== null);
  if (known.length === 0) return "";
  return `Mesures à plat : ${known.map((m) => `${MEASUREMENT_LABELS[m.name].toLowerCase()} ${cmLabel(m.valueCm!)}`).join(", ")}.`;
}

/** Photos de la description (face, dos, détails, défauts ; 4 au plus) : l'étiquette et le mètre ne sont pas relus. */
export function descriptionPhotoIds(prep: StudioPrepView): string[] {
  return prep.photos
    .filter((p) => p.role !== "label" && p.role !== "tape")
    .sort((a, b) => DESCRIPTION_ROLE_ORDER.indexOf(a.role) - DESCRIPTION_ROLE_ORDER.indexOf(b.role) || a.index - b.index)
    .slice(0, STUDIO_DESCRIPTION_MAX_PHOTOS)
    .map((p) => p.id);
}

/** Faits transmis au rédacteur (miroir du serveur) : matière avec provenance, mesures, marque, taille, matière et mesures inconnues. */
export function prepFacts(prep: StudioPrepView, notes?: string): string {
  const f = prep.fields;
  const measuresText = measurementsSentence(prep.measurements);
  return [
    f.material.value ? `Matière (${f.material.source === "label" ? "lue sur l'étiquette" : "indiquée par le vendeur"}) : ${f.material.value}.` : "",
    measuresText,
    !f.brand.value ? "Marque inconnue : n'en cite aucune." : "",
    !f.size.value ? "Taille inconnue : n'en cite aucune." : "",
    !f.material.value ? "Matière inconnue : n'en cite aucune." : "",
    measuresText ? "" : "Aucune mesure connue : n'en cite aucune.",
    notes ?? "",
  ].filter(Boolean).join(" ").slice(0, 500);
}

export interface AdjustableListing {
  title: string;
  description: string;
  brand: string | null;
  size: string | null;
  material: string | null;
}

/**
 * Sortie du rédacteur ajustée à la préparation (miroir du serveur) : marque, taille et matière de la
 * préparation (jamais celles « vues » par le modèle), toute mesure en cm absente de la préparation retirée
 * (mention dans le titre, phrase entière dans la description), phrase des mesures ajoutée telle quelle.
 */
export function adjustToPrep<T extends AdjustableListing>(data: T, prep: StudioPrepView): { data: T; warnings: string[] } {
  const f = prep.fields;
  const w: string[] = [];
  const measuresText = measurementsSentence(prep.measurements);
  let title = data.title;
  let description = data.description;
  if (!f.brand.value && data.brand && data.brand.trim().length >= 2) {
    const re = new RegExp(`\\s*\\b${escapeRe(data.brand.trim())}\\b`, "gi");
    if (re.test(title) || re.test(description)) w.push(`Marque « ${data.brand.trim()} » retirée : elle n'a pas été lue sur l'étiquette ni indiquée.`);
    title = title.replace(re, "").replace(/\s{2,}/g, " ").trim();
    description = description.replace(re, "").replace(/\s{2,}/g, " ").trim();
  }
  if (!f.size.value && data.size) {
    const re = new RegExp(`\\s*\\btaille\\s+${escapeRe(data.size.trim())}\\b`, "gi");
    title = title.replace(re, "").replace(/\s{2,}/g, " ").trim();
    description = description.replace(re, "").replace(/\s{2,}/g, " ").trim();
  }
  if (!f.material.value && data.material && data.material.trim().length >= 3) {
    const re = new RegExp(`\\s*\\b(?:en\\s+)?${escapeRe(data.material.trim())}\\b`, "gi");
    if (re.test(title) || re.test(description)) w.push(`Matière « ${data.material.trim()} » retirée : elle n'a pas été lue sur l'étiquette ni indiquée.`);
    title = title.replace(re, "").replace(/\s{2,}/g, " ").trim();
    description = description.replace(re, "").replace(/\s{2,}/g, " ").trim();
  }
  title = tidyText(title);
  description = tidyText(description);
  const allowed = prep.measurements.filter((m) => m.valueCm !== null && m.source !== null).map((m) => m.valueCm!);
  const strippedTitle = stripUnknownMeasurements(title, allowed, "title");
  const strippedDescription = stripUnknownMeasurements(description, allowed, "description");
  title = strippedTitle.text;
  description = strippedDescription.text;
  const invented = [...new Set([...strippedTitle.removed, ...strippedDescription.removed])];
  if (invented.length > 0) w.push(`Mesure${invented.length > 1 ? "s" : ""} inventée${invented.length > 1 ? "s" : ""} par le modèle retirée${invented.length > 1 ? "s" : ""} (${invented.map(cmLabel).join(", ")}) : seules les mesures de la préparation sont citées.`);
  if (title.length < 3) title = [f.brand.value, "Article", f.size.value].filter(Boolean).join(" ") || "Article";
  if (description.length < 20) description = `Article d'occasion. ${measuresText} Envoi soigné sous 48 h.`.replace(/\s+/g, " ").trim();
  if (measuresText && !description.includes(measuresText)) description = `${description}\n\n${measuresText}`.slice(0, 2000);
  for (const key of ["brand", "size"] as LabelFieldName[]) if (!f[key].value) w.push(key === "brand" ? "Marque inconnue : à compléter avant de publier." : "Taille inconnue : à compléter avant de publier.");
  return { data: { ...data, title: title.slice(0, 100), description, brand: f.brand.value, size: f.size.value, material: f.material.value }, warnings: w };
}
