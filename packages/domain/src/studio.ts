import {
  LABEL_FIELDS, MEASUREMENT_HOWTO, MEASUREMENT_NAMES, STUDIO_MEASUREMENT_TOLERANCE_CM, STUDIO_MIN_CONFIDENCE, STUDIO_MODEL_MAX_BYTES, STUDIO_MODEL_MAX_PHOTOS, STUDIO_MODEL_MAX_SIDE_PX, STUDIO_TRUSTED_CONFIDENCE,
  type GarmentKind, type ItemCategory, type LabelFieldName, type LabelReadOutput, type ListingGenerationOutput, type MeasurementName, type MeasurementSource, type MeasurementsOutput, type NamedMeasurementField,
  type PhotoRole, type PhotoSortOutput, type SellerQuestion, type SizeReference, type SortedPhoto, type StudioFields, type StudioPrep, type StudioPrepArticle, type StudioQuestionField, type StudioQuestionReason,
  type StudioSellerHints, type StudioTextField, type TextFieldSource,
} from "@selio/contracts";
import { estimateResale, type Comparable } from "./radar";

/** Prix de départ par catégorie quand le prix d'achat n'est pas indiqué (estimation prudente). */
const CATEGORY_BASE_CENTS: Record<ItemCategory, number> = { shoes: 2500, bags: 3000, men: 1800, women: 1800, kids: 800, accessories: 1500, home: 1200, electronics: 2500, other: 1200 };

export interface DraftPricing {
  suggestedPriceCents: number;
  priceLowCents: number;
  priceHighCents: number;
  priceMethod: string;
  comparableCount: number;
  lowConfidence: boolean;
}

/**
 * Prix conseillé d'une annonce générée : médiane des ventes comparables
 * (marque + catégorie), ajustée à l'état. L'IA ne fixe jamais le prix.
 */
export function priceListingDraft(data: Pick<ListingGenerationOutput, "brand" | "category" | "condition">, comps: Comparable[], purchasePriceCents: number | null): DraftPricing {
  const base = purchasePriceCents && purchasePriceCents > 0 ? purchasePriceCents : CATEGORY_BASE_CENTS[data.category];
  const est = estimateResale({ priceCents: base, brand: data.brand, category: data.category, condition: data.condition }, comps);
  const suggested = Math.max(100, Math.round(est.resalePriceCents / 100) * 100);
  return {
    suggestedPriceCents: suggested,
    priceLowCents: Math.round((suggested * 0.85) / 50) * 50,
    priceHighCents: Math.round((suggested * 1.15) / 50) * 50,
    priceMethod: est.method,
    comparableCount: est.comparableCount,
    lowConfidence: est.confidence === "low",
  };
}

// ---------------------------------------------------------------------------
// Studio façon Kavis (§5.11) : fonctions pures autour des lectures du modèle 1.
// Aucune valeur n'est inventée ici : chaque champ garde sa provenance (étiquette,
// mètre ruban, base des références, vendeur) ou reste vide avec une question.
// ---------------------------------------------------------------------------

/** Ordre de priorité des rôles quand on choisit les photos envoyées au modèle. */
export const PHOTO_ROLE_PRIORITY: readonly PhotoRole[] = ["front", "label", "tape", "back", "detail", "defect", "other"];

export interface PhotoGroup {
  articleGroup: number;
  /** Positions des photos de l'article (ordre d'envoi). */
  photoIndexes: number[];
  photos: SortedPhoto[];
}

/** Regroupe les photos triées par article (groupes dans l'ordre de leur première photo). */
export function groupPhotosByArticle(sort: PhotoSortOutput): PhotoGroup[] {
  const groups = new Map<number, SortedPhoto[]>();
  for (const p of [...sort.photos].sort((a, b) => a.index - b.index)) {
    const list = groups.get(p.articleGroup) ?? [];
    list.push(p);
    groups.set(p.articleGroup, list);
  }
  return [...groups.entries()].map(([articleGroup, photos]) => ({ articleGroup, photoIndexes: photos.map((p) => p.index), photos }));
}

/** Découpe N photos en lots équilibrés d'au plus `max` (7 → 4 + 3, 12 → 6 + 6). */
export function planPhotoBatches(count: number, max: number = STUDIO_MODEL_MAX_PHOTOS): { offset: number; count: number }[] {
  if (count <= 0) return [];
  const batches = Math.ceil(count / max);
  const base = Math.floor(count / batches);
  const extra = count % batches;
  const out: { offset: number; count: number }[] = [];
  let offset = 0;
  for (let b = 0; b < batches; b++) {
    const n = base + (b < extra ? 1 : 0);
    out.push({ offset, count: n });
    offset += n;
  }
  return out;
}

/**
 * Réunit les tris de plusieurs lots (au plus 6 photos par appel) : positions rendues globales. Si chaque
 * lot ne contient qu'un article, c'est le même (cas courant : un article, 7 à 12 photos) ; sinon les
 * groupes restent séparés d'un lot à l'autre. Dans les deux cas, le vendeur est prévenu de vérifier.
 */
export function mergeSortBatches(batches: { output: PhotoSortOutput; offset: number }[]): { output: PhotoSortOutput; warnings: string[] } {
  if (batches.length === 0) return { output: { photos: [] }, warnings: [] };
  if (batches.length === 1) {
    const b = batches[0]!;
    return { output: { photos: b.output.photos.map((p) => ({ ...p, index: p.index + b.offset })) }, warnings: [] };
  }
  const singleArticle = batches.every((b) => new Set(b.output.photos.map((p) => p.articleGroup)).size <= 1);
  const photos: SortedPhoto[] = [];
  let groupOffset = 0;
  for (const b of batches) {
    const local = [...new Set(b.output.photos.map((p) => p.articleGroup))];
    for (const p of b.output.photos) {
      const group = singleArticle ? 1 : groupOffset + local.indexOf(p.articleGroup) + 1;
      photos.push({ ...p, index: p.index + b.offset, articleGroup: group });
    }
    groupOffset += local.length;
  }
  const warnings = [
    singleArticle
      ? `Photos triées en ${batches.length} lots (au plus ${STUDIO_MODEL_MAX_PHOTOS} par appel) : vérifiez qu'elles montrent bien le même article.`
      : `Photos triées en ${batches.length} lots (au plus ${STUDIO_MODEL_MAX_PHOTOS} par appel) : le regroupement par article est à vérifier d'un lot à l'autre.`,
  ];
  return { output: { photos: photos.sort((a, b) => a.index - b.index) }, warnings };
}

/**
 * Photos envoyées au modèle (au plus 6, jamais 12) : une de chaque rôle d'abord, dans l'ordre face,
 * étiquette, mètre, dos, détail, défaut, autre (la plus sûre de chaque rôle), puis les suivantes dans
 * le même ordre. Renvoie les photos retenues, dans l'ordre de priorité.
 */
export function selectPhotosForModel(photos: SortedPhoto[], max: number = STUDIO_MODEL_MAX_PHOTOS): SortedPhoto[] {
  const limit = Math.max(0, Math.min(max, STUDIO_MODEL_MAX_PHOTOS));
  const byRole = new Map<PhotoRole, SortedPhoto[]>();
  for (const role of PHOTO_ROLE_PRIORITY) byRole.set(role, photos.filter((p) => p.role === role).sort((a, b) => b.confidence - a.confidence || a.index - b.index));
  const out: SortedPhoto[] = [];
  for (let round = 0; out.length < limit; round++) {
    let added = false;
    for (const role of PHOTO_ROLE_PRIORITY) {
      const p = byRole.get(role)![round];
      if (p && out.length < limit) {
        out.push(p);
        added = true;
      }
    }
    if (!added) break;
  }
  return out;
}

/** Photos d'un rôle donné (étiquette : 2 au plus ; mètre ruban : 3 au plus), les plus sûres d'abord. */
export function photosWithRole(photos: SortedPhoto[], role: PhotoRole, max: number): SortedPhoto[] {
  return photos.filter((p) => p.role === role).sort((a, b) => b.confidence - a.confidence || a.index - b.index).slice(0, Math.max(0, max));
}

// ----------------------------------------------------------------- familles et mesures attendues

/** Mesures attendues par famille de pièce : sans elles, une question est posée au vendeur. */
export const EXPECTED_MEASUREMENTS: Record<GarmentKind, readonly MeasurementName[]> = {
  top: ["chest", "length", "shoulders"],
  outerwear: ["chest", "length", "shoulders", "sleeve"],
  dress: ["chest", "waist", "length"],
  bottom: ["waist", "inseam"],
  shoes: ["sole"],
  bag: [],
  accessory: [],
  other: [],
};

const GARMENT_KEYWORDS: { kind: GarmentKind; kw: string[] }[] = [
  { kind: "shoes", kw: ["chaussure", "basket", "sneaker", "bottine", "boots", "botte", "sandale", "escarpin", "mocassin", "derby", "espadrille", "tong"] },
  { kind: "bag", kw: ["sac", "cabas", "pochette", "sacoche", "besace", "bag"] },
  { kind: "dress", kw: ["robe", "combinaison", "salopette", "dress"] },
  { kind: "outerwear", kw: ["veste", "manteau", "doudoune", "parka", "blouson", "trench", "blazer", "jacket", "coat"] },
  { kind: "bottom", kw: ["jean", "pantalon", "short", "jupe", "jogging", "legging", "chino", "bermuda", "jeans", "trousers", "pants"] },
  { kind: "top", kw: ["pull", "sweat", "hoodie", "t-shirt", "tshirt", "tee", "chemise", "chemisier", "blouse", "polo", "top", "debardeur", "gilet", "cardigan", "maillot", "shirt"] },
  { kind: "accessory", kw: ["ceinture", "echarpe", "foulard", "bonnet", "casquette", "chapeau", "lunettes", "montre", "bijou", "collier", "bracelet", "gants", "cravate"] },
];

/**
 * Famille d'une pièce, d'après un texte (type de pièce, titre) puis la catégorie de l'article.
 * Sert seulement à savoir quelles mesures demander ; jamais à remplir un champ.
 */
export function garmentKindFor(input: { text?: string | null; category?: ItemCategory | null }): GarmentKind {
  const text = ` ${simplifyText(input.text ?? "")} `;
  // Mot entier, au singulier ou au pluriel (« baskets », « jeans », « manteaux »).
  const has = (k: string) => {
    const w = simplifyText(k);
    return text.includes(` ${w} `) || text.includes(` ${w}s `) || text.includes(` ${w}x `);
  };
  for (const g of GARMENT_KEYWORDS) if (g.kw.some(has)) return g.kind;
  if (input.category === "shoes") return "shoes";
  if (input.category === "bags") return "bag";
  if (input.category === "accessories") return "accessory";
  return "other";
}

// ----------------------------------------------------------------- questions au vendeur

const FIELD_NAMES: Record<StudioQuestionField, string> = {
  brand: "la marque",
  size: "la taille",
  material: "la matière",
  reference: "la référence",
  chest: "la poitrine",
  length: "la longueur",
  shoulders: "la largeur d'épaules",
  sleeve: "la longueur de manche",
  waist: "le tour de taille",
  hips: "les hanches",
  inseam: "l'entrejambe",
  rise: "le montant",
  sole: "la longueur de semelle",
};

const isMeasurementName = (f: StudioQuestionField): f is MeasurementName => (MEASUREMENT_NAMES as readonly string[]).includes(f);

/** Texte d'une question au vendeur, le même partout (validation, fusion, écran, démonstration). */
export function studioQuestion(field: StudioQuestionField, reason: StudioQuestionReason, detail: { read?: string | number | null; other?: string | number | null; otherSource?: string } = {}): SellerQuestion {
  const name = FIELD_NAMES[field];
  const measure = isMeasurementName(field);
  const fmt = (v: string | number | null | undefined) => (typeof v === "number" ? `${String(v).replace(".", ",")} cm` : `« ${v ?? ""} »`);
  let text: string;
  if (reason === "conflict") {
    text = `${capitalize(name)} : ${measure ? "le mètre ruban ou la base indique" : "l'étiquette indique"} ${fmt(detail.read)}, ${detail.otherSource ?? "vous avez indiqué"} ${fmt(detail.other)}. Laquelle est juste ?`;
  } else if (reason === "low_confidence") {
    text = measure
      ? `${capitalize(name)} n'a pas pu être lue avec certitude sur le mètre ruban : mesurez-la (${MEASUREMENT_HOWTO[field]}) et indiquez-la en cm.`
      : detail.read
        ? `L'étiquette semble indiquer ${fmt(detail.read)} pour ${name} : est-ce juste ?`
        : `${capitalize(name)} n'a pas pu être lue avec certitude sur l'étiquette : pouvez-vous l'indiquer ?`;
  } else if (reason === "no_tape") {
    text = `Aucun mètre ruban n'est visible : mesurez ${name} (${MEASUREMENT_HOWTO[field as MeasurementName] ?? "à plat"}) en cm, ou ajoutez une photo avec le mètre posé sur l'article.`;
  } else if (reason === "rejected") {
    text = measure
      ? `${capitalize(name)} n'a pas été retenue (lecture du ruban non vérifiable) : mesurez-la (${MEASUREMENT_HOWTO[field]}) et indiquez-la en cm.`
      : `${capitalize(name)} n'a pas été retenue (elle n'est pas lisible sur l'étiquette) : pouvez-vous l'indiquer ?`;
  } else if (measure) {
    text = `Mesurez ${name} (${MEASUREMENT_HOWTO[field]}) et indiquez-la en cm, ou ajoutez une photo avec le mètre ruban posé dessus.`;
  } else if (field === "brand") {
    text = "Quelle est la marque ? Elle n'est pas lisible sur l'étiquette (indiquez « sans marque » s'il n'y en a pas).";
  } else if (field === "size") {
    text = "Quelle taille est indiquée sur l'étiquette ? Elle n'a pas pu être lue.";
  } else if (field === "material") {
    text = "Quelle est la composition (par exemple « 100 % coton ») ? Elle n'a pas pu être lue sur l'étiquette.";
  } else {
    text = "Quelle est la référence du modèle, si elle figure sur l'étiquette ?";
  }
  return { field, reason, text: text.slice(0, 300) };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Questions au vendeur : champs vides (marque, taille, matière), lectures peu sûres à confirmer, conflits
 * entre sources, et mesures attendues pour la famille de la pièce (haut : poitrine, longueur, épaules ;
 * bas : taille, entrejambe ; chaussures : semelle…). Une question par champ au plus.
 */
export function buildSellerQuestions(fields: StudioFields, measurements: readonly NamedMeasurementField[], kind: GarmentKind, opts: { tapeVisible?: boolean } = {}): SellerQuestion[] {
  const out = new Map<StudioQuestionField, SellerQuestion>();
  const add = (q: SellerQuestion) => {
    if (!out.has(q.field)) out.set(q.field, q);
  };
  // Une valeur lue (étiquette, ruban) avec une confiance entre 0,5 et 0,7 : à confirmer par le vendeur.
  const unsureRead = (f: { source: StudioTextField["source"] | MeasurementSource | null; confidence?: number }) => (f.source === "label" || f.source === "tape_photo") && f.confidence !== undefined && f.confidence < STUDIO_TRUSTED_CONFIDENCE;
  for (const key of LABEL_FIELDS) {
    const f = fields[key];
    // Une question déjà portée par le champ (posée par la fusion ou à la préparation) est gardée telle quelle, avec sa
    // raison : lecture peu sûre à confirmer, ou désaccord entre deux sources.
    if (f.question) add({ field: key, reason: f.value === null ? "missing" : unsureRead(f) ? "low_confidence" : "conflict", text: f.question });
    else if (f.value === null) {
      // La référence est facultative ; la taille n'a pas de sens pour un sac ou un accessoire.
      if (key === "reference") continue;
      if (key === "size" && (kind === "bag" || kind === "accessory")) continue;
      add(studioQuestion(key, "missing"));
    } else if (f.source === "label" && f.confidence !== undefined && f.confidence < STUDIO_TRUSTED_CONFIDENCE) add(studioQuestion(key, "low_confidence", { read: f.value }));
  }
  const byName = new Map(measurements.map((m) => [m.name, m]));
  for (const m of measurements) {
    if (m.question) add({ field: m.name, reason: m.valueCm === null ? "missing" : unsureRead(m) ? "low_confidence" : "conflict", text: m.question });
    else if (m.valueCm !== null && m.source === "tape_photo" && m.confidence !== undefined && m.confidence < STUDIO_TRUSTED_CONFIDENCE) add(studioQuestion(m.name, "low_confidence"));
  }
  for (const name of EXPECTED_MEASUREMENTS[kind]) {
    const m = byName.get(name);
    if (!m || m.valueCm === null) add(studioQuestion(name, opts.tapeVisible === false ? "no_tape" : "missing"));
  }
  return [...out.values()];
}

// ----------------------------------------------------------------- fusion des champs avec provenance

/** Texte comparable : sans accents, casse ni ponctuation (« Levi's » = « LEVIS »). */
export function simplifyText(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const sameValue = (a: string, b: string) => simplifyText(a).replace(/ /g, "") === simplifyText(b).replace(/ /g, "");

/** La référence de la base correspond-elle à l'article (marque, référence, et taille quand ses mesures en dépendent) ? */
export function sizeReferenceMatches(ref: SizeReference, article: { brand: string | null; reference: string | null; size: string | null }): { ok: true } | { ok: false; reason: string } {
  if (!article.brand || !article.reference) return { ok: false, reason: "marque ou référence inconnue" };
  if (!sameValue(ref.brand, article.brand) || !sameValue(ref.reference, article.reference)) return { ok: false, reason: "marque ou référence différente" };
  if (ref.size !== null) {
    if (!article.size) return { ok: false, reason: "taille inconnue" };
    if (!sameValue(ref.size, article.size)) return { ok: false, reason: "taille différente" };
  }
  return { ok: true };
}

/** Choisit, parmi les références de la base, celle qui correspond à l'article (taille exacte d'abord), ou null. */
export function matchSizeReference(refs: readonly SizeReference[], article: { brand: string | null; reference: string | null; size: string | null }): SizeReference | null {
  const ok = refs.filter((r) => sizeReferenceMatches(r, article).ok);
  return ok.find((r) => r.size !== null) ?? ok[0] ?? null;
}

export interface MergedStudioFields {
  fields: StudioFields;
  /** Mesures qui ont une valeur (avec provenance), plus celles en conflit ; les attendues vides sont ajoutées par `buildStudioArticle`. */
  measurements: NamedMeasurementField[];
  careSymbols: string[];
  tapeVisible: boolean;
  /** Référence de la base effectivement utilisée. */
  referenceUsed: SizeReference | null;
  warnings: string[];
}

type TextCandidate = { value: string; source: TextFieldSource; confidence?: number };
type MeasureCandidate = { valueCm: number; source: MeasurementSource; confidence?: number };

const SOURCE_PHRASE: Record<MeasurementSource | TextFieldSource, string> = {
  tape_photo: "le mètre ruban indique",
  reference_db: "la base des références indique",
  seller: "vous avez indiqué",
  label: "l'étiquette indique",
};

function mergeText(key: LabelFieldName, read: LabelReadOutput[LabelFieldName] | null | undefined, seller: string | undefined): StudioTextField {
  const label: TextCandidate | null = read && read.value && read.readFrom === "label" && read.confidence >= STUDIO_MIN_CONFIDENCE ? { value: read.value, source: "label", confidence: read.confidence } : null;
  const fromSeller: TextCandidate | null = seller && seller.trim() ? { value: seller.trim().slice(0, 80), source: "seller" } : null;
  // Priorité : étiquette lue avec confiance (≥ 0,7) > vendeur > étiquette peu sûre (0,5 à 0,7, à confirmer).
  const ordered = [label && label.confidence! >= STUDIO_TRUSTED_CONFIDENCE ? label : null, fromSeller, label && label.confidence! < STUDIO_TRUSTED_CONFIDENCE ? label : null].filter((c): c is TextCandidate => c !== null);
  const chosen = ordered[0];
  if (!chosen) return { value: null, source: null };
  const field: StudioTextField = { value: chosen.value, source: chosen.source, ...(chosen.confidence !== undefined ? { confidence: chosen.confidence } : {}) };
  const other = ordered.find((c) => !sameValue(c.value, chosen.value));
  if (other) {
    const labelSide = chosen.source === "label" ? chosen : other;
    const sellerSide = chosen.source === "label" ? other : chosen;
    field.question = studioQuestion(key, "conflict", { read: labelSide.value, other: sellerSide.value }).text;
  }
  return field;
}

function mergeMeasure(name: MeasurementName, tape: MeasureCandidate | null, ref: MeasureCandidate | null, seller: MeasureCandidate | null): NamedMeasurementField | null {
  // Priorité : ruban lu avec confiance (≥ 0,7) > base par la référence > vendeur > ruban peu sûr (0,5 à 0,7, à confirmer).
  const ordered = [tape && tape.confidence! >= STUDIO_TRUSTED_CONFIDENCE ? tape : null, ref, seller, tape && tape.confidence! < STUDIO_TRUSTED_CONFIDENCE ? tape : null].filter((c): c is MeasureCandidate => c !== null);
  const chosen = ordered[0];
  if (!chosen) return null;
  const field: NamedMeasurementField = { name, valueCm: chosen.valueCm, source: chosen.source, ...(chosen.confidence !== undefined ? { confidence: chosen.confidence } : {}) };
  const other = ordered.find((c) => Math.abs(c.valueCm - chosen.valueCm) > STUDIO_MEASUREMENT_TOLERANCE_CM);
  if (other) {
    const name_ = FIELD_NAMES[name];
    const fmt = (v: number) => `${String(v).replace(".", ",")} cm`;
    field.question = `${capitalize(name_)} : ${SOURCE_PHRASE[chosen.source]} ${fmt(chosen.valueCm)}, ${SOURCE_PHRASE[other.source]} ${fmt(other.valueCm)}. Laquelle est juste ?`.slice(0, 300);
  }
  return field;
}

const roundHalf = (v: number) => Math.round(v * 2) / 2;

/**
 * Fusionne ce qui a été lu et indiqué, champ par champ, en gardant la provenance de chaque valeur.
 * Priorité : lecture de l'étiquette ou du ruban avec confiance ≥ 0,7 > base des références (par la
 * référence, mesures seulement) > vendeur > lecture peu sûre. Deux sources en désaccord : la valeur
 * prioritaire est gardée et une question est posée. Une lecture sans provenance (`readFrom` absent,
 * mesure sans ruban visible) ou sous 0,5 de confiance n'est jamais retenue.
 */
export function mergeFields(label: LabelReadOutput | null, hints: StudioSellerHints = {}, reference: SizeReference | null = null, tape: MeasurementsOutput | null = null): MergedStudioFields {
  const warnings: string[] = [];
  const fields: StudioFields = {
    brand: mergeText("brand", label?.brand, hints.brand),
    size: mergeText("size", label?.size, hints.size),
    material: mergeText("material", label?.material, hints.material),
    reference: mergeText("reference", label?.reference, hints.reference),
  };
  let referenceUsed: SizeReference | null = null;
  if (reference) {
    const match = sizeReferenceMatches(reference, { brand: fields.brand.value, reference: fields.reference.value, size: fields.size.value });
    if (match.ok) referenceUsed = reference;
    else warnings.push(`Mesures de la base des références non utilisées : ${match.reason}.`);
  }
  const tapeVisible = tape?.tapeVisible === true;
  const measurements: NamedMeasurementField[] = [];
  for (const name of MEASUREMENT_NAMES) {
    const read = tapeVisible ? tape!.measurements.find((m) => m.name === name && m.evidence === "tape_photo" && m.valueCm !== null && m.valueCm > 0 && m.confidence >= STUDIO_MIN_CONFIDENCE) : undefined;
    const tapeC: MeasureCandidate | null = read ? { valueCm: roundHalf(read.valueCm!), source: "tape_photo", confidence: read.confidence } : null;
    const refV = referenceUsed?.measurements[name];
    const refC: MeasureCandidate | null = refV !== undefined ? { valueCm: refV, source: "reference_db" } : null;
    const sellerV = hints.measurements?.[name];
    const sellerC: MeasureCandidate | null = sellerV !== undefined && sellerV > 0 ? { valueCm: sellerV, source: "seller" } : null;
    const merged = mergeMeasure(name, tapeC, refC, sellerC);
    if (merged) measurements.push(merged);
  }
  return { fields, measurements, careSymbols: [...(label?.careSymbols ?? [])].slice(0, 12), tapeVisible, referenceUsed, warnings };
}

export interface StudioArticleInput {
  articleGroup: number;
  label: LabelReadOutput | null;
  tape: MeasurementsOutput | null;
  hints?: StudioSellerHints;
  reference?: SizeReference | null;
  /** Famille de la pièce si elle est connue ; sinon déduite de `text` et `category` (seulement pour choisir les mesures à demander). */
  garmentKind?: GarmentKind;
  text?: string | null;
  category?: ItemCategory | null;
  /** Questions et avertissements produits par la validation des lectures. */
  questions?: SellerQuestion[];
  warnings?: string[];
}

/** Un article complet : champs fusionnés, mesures attendues (vides avec question si inconnues), questions. */
export function buildStudioArticle(group: PhotoGroup, input: StudioArticleInput | undefined): StudioPrepArticle {
  const merged = mergeFields(input?.label ?? null, input?.hints ?? {}, input?.reference ?? null, input?.tape ?? null);
  const kind = input?.garmentKind ?? garmentKindFor({ text: input?.text ?? null, category: input?.category ?? null });
  const measurements = [...merged.measurements];
  const questions = buildSellerQuestions(merged.fields, measurements, kind, { tapeVisible: merged.tapeVisible });
  // Questions de la validation (lecture écartée) d'abord pour les champs restés vides, puis celles de la fusion.
  const fields = { ...merged.fields };
  const allQuestions = new Map<StudioQuestionField, SellerQuestion>();
  for (const q of input?.questions ?? []) {
    const stillEmpty = isMeasurementName(q.field) ? !measurements.some((m) => m.name === q.field && m.valueCm !== null) : fields[q.field as LabelFieldName].value === null;
    if (stillEmpty && !allQuestions.has(q.field)) allQuestions.set(q.field, q);
  }
  for (const q of questions) if (!allQuestions.has(q.field)) allQuestions.set(q.field, q);
  for (const name of EXPECTED_MEASUREMENTS[kind]) {
    if (!measurements.some((m) => m.name === name)) measurements.push({ name, valueCm: null, source: null });
  }
  // Chaque champ porte sa question (vide, peu sûr ou en conflit), la même que dans la liste.
  for (let i = 0; i < measurements.length; i++) {
    const m = measurements[i]!;
    const q = allQuestions.get(m.name);
    if (q && !m.question) measurements[i] = { ...m, question: q.text };
  }
  for (const key of LABEL_FIELDS) {
    const q = allQuestions.get(key);
    if (q && !fields[key].question) fields[key] = { ...fields[key], question: q.text };
  }
  const order = new Map(MEASUREMENT_NAMES.map((n, i) => [n, i]));
  measurements.sort((a, b) => order.get(a.name)! - order.get(b.name)!);
  return {
    articleGroup: group.articleGroup,
    photoIndexes: group.photoIndexes,
    modelPhotoIndexes: selectPhotosForModel(group.photos).map((p) => p.index),
    garmentKind: kind,
    fields,
    careSymbols: merged.careSymbols,
    tapeVisible: merged.tapeVisible,
    measurements,
    sizeReference: merged.referenceUsed ? { brand: merged.referenceUsed.brand, reference: merged.referenceUsed.reference, size: merged.referenceUsed.size } : null,
    questions: [...allQuestions.values()].slice(0, 40),
    warnings: [...(input?.warnings ?? []), ...merged.warnings].slice(0, 20),
  };
}

// ----------------------------------------------------------------- mesures citées dans un texte rédigé

const CM_RE = /(\d{1,3}(?:[.,]\d{1,2})?)\s?cm\b/gi;

/** Valeurs en cm citées dans un texte (« 52 cm », « 41,5cm »), dans l'ordre. */
export function extractCmValues(text: string): number[] {
  return [...text.matchAll(CM_RE)].map((m) => Number.parseFloat(m[1]!.replace(",", "."))).filter((v) => Number.isFinite(v));
}

const sameCm = (a: number, b: number) => Math.abs(a - b) < 0.05;

export interface StrippedMeasurements {
  text: string;
  /** Valeurs en cm retirées, car absentes des mesures connues (une mesure inventée par le modèle). */
  removed: number[];
}

/**
 * Retire d'un texte rédigé par le modèle toute mesure en cm absente des mesures connues (celles de la
 * préparation, avec provenance) : dans un titre, la mention seule ; dans une description, la phrase entière
 * qui la cite (le reste de la phrase décrit la mesure inventée). Les mesures connues restent ; la phrase
 * déterministe « Mesures à plat : … » est ajoutée ensuite par l'appelant.
 */
export function stripUnknownMeasurements(text: string, allowedCm: readonly number[], mode: "title" | "description"): StrippedMeasurements {
  const known = (v: number) => allowedCm.some((a) => sameCm(a, v));
  const removed: number[] = [];
  if (mode === "title") {
    const out = text
      .replace(CM_RE, (m, v: string) => {
        const n = Number.parseFloat(v.replace(",", "."));
        if (known(n)) return m;
        removed.push(n);
        return "";
      })
      .replace(/\(\s*\)/g, "")
      .replace(/\s+([,;:)])/g, "$1")
      .replace(/([,;:(–-])\s*(?=[,;:)]|$)/g, "")
      .replace(/\s{2,}/g, " ")
      .replace(/[\s,;:–-]+$/g, "")
      .trim();
    return { text: out, removed };
  }
  const paragraphs = text.split(/\n+/).map((paragraph) =>
    paragraph
      .split(/(?<=[.!?…])\s+/)
      .filter((sentence) => {
        const unknown = extractCmValues(sentence).filter((v) => !known(v));
        if (unknown.length === 0) return true;
        removed.push(...unknown);
        return false;
      })
      .join(" ")
      .trim(),
  );
  return { text: paragraphs.filter((p) => p.length > 0).join("\n\n"), removed };
}

/** Assemble la préparation Studio complète à partir du tri et des lectures de chaque article. */
export function assembleStudioPrep(input: { sort: PhotoSortOutput; articles: StudioArticleInput[]; warnings?: string[]; simulated?: boolean; ocr?: { configured: boolean; used: boolean } }): StudioPrep {
  const groups = groupPhotosByArticle(input.sort);
  const articles = groups.map((g) => buildStudioArticle(g, input.articles.find((a) => a.articleGroup === g.articleGroup)));
  return {
    photos: [...input.sort.photos].sort((a, b) => a.index - b.index),
    articles,
    warnings: (input.warnings ?? []).slice(0, 30),
    simulated: input.simulated ?? false,
    ocr: input.ocr ?? { configured: false, used: false },
    // Aucun rapport de mesure n'existe : la précision reste « à mesurer » (jamais de pourcentage promis).
    accuracy: { status: "to_measure", brandAndSizeRate: null, measurementRate: null, reportDate: null },
  };
}

// ----------------------------------------------------------------- photos réduites : dimensions

export type ImageFormat = "jpeg" | "png" | "webp";
export interface ImageInfo {
  format: ImageFormat;
  width: number;
  height: number;
}

/**
 * Dimensions d'une image lues dans ses en-têtes (JPEG : segment SOF ; PNG : IHDR ; WebP : VP8, VP8L,
 * VP8X), sans dépendance ni décodage. Null si le format n'est pas reconnu ou l'en-tête tronqué.
 */
export function checkImageDimensions(bytes: Uint8Array): ImageInfo | null {
  const u16be = (i: number) => (bytes[i]! << 8) | bytes[i + 1]!;
  const u32be = (i: number) => ((bytes[i]! << 24) >>> 0) + (bytes[i + 1]! << 16) + (bytes[i + 2]! << 8) + bytes[i + 3]!;
  const has = (i: number, n: number) => i + n <= bytes.length;
  const ascii = (i: number, n: number) => (has(i, n) ? String.fromCharCode(...bytes.subarray(i, i + n)) : "");
  const valid = (info: ImageInfo): ImageInfo | null => (info.width > 0 && info.height > 0 ? info : null);
  // PNG : signature puis le premier bloc, IHDR (largeur et hauteur sur 4 octets).
  if (has(0, 24) && bytes[0] === 0x89 && ascii(1, 3) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    if (ascii(12, 4) !== "IHDR") return null;
    return valid({ format: "png", width: u32be(16), height: u32be(20) });
  }
  // JPEG : on parcourt les segments jusqu'au premier SOF (C0 à CF sauf C4, C8, CC).
  if (has(0, 4) && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (has(i, 4)) {
      if (bytes[i] !== 0xff) return null;
      let marker = bytes[i + 1]!;
      // Octets de remplissage 0xFF.
      while (marker === 0xff && has(i, 3)) {
        i++;
        marker = bytes[i + 1]!;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      if (marker === 0xd9 || marker === 0xda) return null; // fin d'image ou début des données avant tout SOF
      if (!has(i, 4)) return null;
      const length = u16be(i + 2);
      if (length < 2) return null;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        if (!has(i, 9)) return null;
        return valid({ format: "jpeg", height: u16be(i + 5), width: u16be(i + 7) });
      }
      i += 2 + length;
    }
    return null;
  }
  // WebP : conteneur RIFF, puis le premier bloc.
  if (has(0, 30) && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const chunk = ascii(12, 4);
    if (chunk === "VP8 ") {
      if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
      return valid({ format: "webp", width: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff, height: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff });
    }
    if (chunk === "VP8L") {
      if (bytes[20] !== 0x2f) return null;
      const b1 = bytes[21]!, b2 = bytes[22]!, b3 = bytes[23]!, b4 = bytes[24]!;
      return valid({ format: "webp", width: 1 + (((b2 & 0x3f) << 8) | b1), height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)) });
    }
    if (chunk === "VP8X") {
      return valid({ format: "webp", width: 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)), height: 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)) });
    }
  }
  return null;
}

/** Dimensions après réduction (côté long ≤ `maxSide`, proportions gardées, jamais d'agrandissement). Fonction pure pour la réduction côté navigateur. */
export function reducedDimensions(width: number, height: number, maxSide: number = STUDIO_MODEL_MAX_SIDE_PX): { width: number; height: number; scale: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0, scale: 0 };
  const longSide = Math.max(width, height);
  if (longSide <= maxSide) return { width: Math.round(width), height: Math.round(height), scale: 1 };
  const scale = maxSide / longSide;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  t["-".charCodeAt(0)] = 62; // base64url
  t["_".charCodeAt(0)] = 63;
  return t;
})();

/** Taille en octets d'un contenu base64 (sans le décoder). */
export function base64ByteLength(b64: string): number {
  const clean = b64.replace(/[\s=]/g, "");
  return Math.floor((clean.length * 3) / 4);
}

/**
 * Décode du base64 (ou base64url) en octets, sans dépendance (navigateur et serveur). `maxBytes` limite
 * le décodage au début du contenu (lecture des en-têtes). Null si un caractère est invalide.
 */
export function decodeBase64(b64: string, maxBytes = Number.POSITIVE_INFINITY): Uint8Array | null {
  const body = b64.startsWith("data:") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const clean = body.replace(/[\s=]/g, "");
  const total = Math.floor((clean.length * 3) / 4);
  const n = Math.min(total, Math.max(0, Math.floor(maxBytes)));
  const out = new Uint8Array(n);
  let o = 0;
  for (let i = 0; i < clean.length && o < n; i += 4) {
    const c = [0, 1, 2, 3].map((k) => (i + k < clean.length ? clean.charCodeAt(i + k) : -2));
    const v = c.map((code) => (code === -2 ? 0 : code < 128 ? B64_INDEX[code]! : -1));
    if (v.some((x) => x < 0)) return null;
    const triple = (v[0]! << 18) | (v[1]! << 12) | (v[2]! << 6) | v[3]!;
    out[o++] = (triple >> 16) & 0xff;
    if (o < n && c[2] !== -2) out[o++] = (triple >> 8) & 0xff;
    if (o < n && c[3] !== -2) out[o++] = triple & 0xff;
  }
  return o === n ? out : out.subarray(0, o);
}

export type ModelImageCheck =
  | { ok: true; format: ImageFormat; width: number; height: number; bytes: number }
  | { ok: false; code: "unreadable" | "too_large" | "too_heavy"; reason: string; width?: number; height?: number; bytes: number };

/**
 * Vérification serveur d'une photo destinée au modèle 1 (le navigateur l'a réduite) : format reconnu
 * (JPEG, PNG, WebP), côté long ≤ 1 024 px et poids ≤ 1 Mo. Le serveur ne réduit pas lui-même (aucune
 * dépendance d'image) : il refuse, et le navigateur réduit avant de renvoyer.
 */
export function checkModelImage(image: string | Uint8Array, opts: { maxSide?: number; maxBytes?: number } = {}): ModelImageCheck {
  const maxSide = opts.maxSide ?? STUDIO_MODEL_MAX_SIDE_PX;
  const maxBytes = opts.maxBytes ?? STUDIO_MODEL_MAX_BYTES;
  const size = typeof image === "string" ? base64ByteLength(image.startsWith("data:") ? image.slice(image.indexOf(",") + 1) : image) : image.length;
  if (size > maxBytes) return { ok: false, code: "too_heavy", reason: `Photo trop lourde pour le modèle (${Math.round(size / 1000)} Ko, ${Math.round(maxBytes / 1000)} Ko au plus) : réduisez-la avant l'envoi.`, bytes: size };
  // Les en-têtes JPEG peuvent suivre des métadonnées EXIF (64 Ko au plus) : on lit le début, puis tout si besoin.
  let bytes = typeof image === "string" ? decodeBase64(image, 128 * 1024) : image;
  let info = bytes ? checkImageDimensions(bytes) : null;
  if (!info && typeof image === "string" && bytes && bytes.length < size) {
    bytes = decodeBase64(image);
    info = bytes ? checkImageDimensions(bytes) : null;
  }
  if (!info) return { ok: false, code: "unreadable", reason: "Photo illisible : JPEG, PNG ou WebP attendu.", bytes: size };
  if (Math.max(info.width, info.height) > maxSide) {
    return { ok: false, code: "too_large", reason: `Photo trop grande pour le modèle (${info.width} × ${info.height} px, côté long ${maxSide} px au plus) : réduisez-la avant l'envoi.`, width: info.width, height: info.height, bytes: size };
  }
  return { ok: true, format: info.format, width: info.width, height: info.height, bytes: size };
}
