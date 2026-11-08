import { LABEL_FIELDS, MEASUREMENT_NAMES, MIGRATION_SOURCES, PHOTO_ROLES, type MigrationSource, type PhotoRole } from "@selio/contracts";
import { hashString, parseSettingsText, seededRandom, suggestMappingFromCandidates, type MigrationCandidate } from "@selio/domain";
import { AIError, extractJson, type AIProvider, type EmbedResult, type GenerateOptions, type GenerateRequest, type GenerateResult, type HealthResult, type OcrRequest, type OcrResult, type StructuredRequest, type StructuredResult } from "../types";

export interface MockOptions {
  /** Latence simulée (ms), déterministe. */
  latencyMs?: number;
  /** Force une erreur pour les tests (ex. "timeout"). */
  failWith?: AIError | null;
  /** Retourne une sortie volontairement invalide (tests de validation). */
  invalidOutput?: boolean;
  /** OCR d'essai simulé (facultatif) : null ou absent = non configuré, comme OLLAMA_OCR_MODEL vide. */
  ocrModel?: string | null;
}

/**
 * Provider déterministe : même requête → même sortie. Sert la démo (bandeau
 * « simulé ») et les tests. Il n'imite pas un vrai modèle : il applique des
 * gabarits français à partir des indices présents dans le prompt.
 */
export class MockAIProvider implements AIProvider {
  readonly name = "mock";
  readonly model = "selio-mock-v1";
  /** Modèle 2 simulé : vecteurs déterministes de dimension MOCK_EMBED_DIMENSIONS. */
  readonly embedModel = "selio-mock-embed-v1";
  /** Le simulateur accepte les photos ; ses descriptions sont toujours marquées simulées par l'appelant. */
  readonly canSeeImages: boolean = true;
  /** OCR d'essai simulé : non configuré par défaut (comme en production, OLLAMA_OCR_MODEL vide). */
  readonly ocrModel: string | null;
  constructor(private readonly opts: MockOptions = {}) {
    this.ocrModel = opts.ocrModel ?? null;
  }

  async health(): Promise<HealthResult> {
    return {
      ok: true,
      status: "mock",
      message: "Simulateur IA déterministe (aucun modèle réel)",
      latencyMs: 0,
      model: this.model,
      provider: this.name,
      details: {
        models: [
          { role: "text", name: this.model, present: true },
          { role: "vision", name: this.model, present: true },
          { role: "embed", name: this.embedModel, present: true },
          ...(this.ocrModel ? [{ role: "ocr" as const, name: this.ocrModel, present: true, optional: true }] : []),
        ],
        missing: [],
        installed: [this.model, this.embedModel, ...(this.ocrModel ? [this.ocrModel] : [])],
      },
    };
  }

  private async simulate(opts?: GenerateOptions): Promise<void> {
    if (this.opts.failWith) throw this.opts.failWith;
    const delay = this.opts.latencyMs ?? 0;
    if (delay > 0) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, delay);
        opts?.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new AIError("cancelled", "Requête annulée"));
        }, { once: true });
      });
    }
    if (opts?.signal?.aborted) throw new AIError("cancelled", "Requête annulée");
  }

  async generate(req: GenerateRequest, opts?: GenerateOptions): Promise<GenerateResult> {
    const started = Date.now();
    await this.simulate(opts);
    const text = this.render(req);
    return { text, usage: { promptTokens: estimateTokens(req.system + req.prompt), outputTokens: estimateTokens(text) }, latencyMs: Date.now() - started, model: this.model, provider: this.name };
  }

  async generateStructured<T>(req: StructuredRequest<T>, opts?: GenerateOptions): Promise<StructuredResult<T>> {
    const started = Date.now();
    await this.simulate(opts);
    const raw = this.opts.invalidOutput ? '{"reply": 42, "intent": "hack"}' : JSON.stringify(this.renderStructured(req));
    const json = extractJson(raw);
    const parsed = req.schema.safeParse(json ? JSON.parse(json) : null);
    if (!parsed.success) throw new AIError("invalid_output", `Sortie simulée invalide : ${parsed.error.issues.map((i) => i.message).join(", ")}`);
    return {
      data: parsed.data,
      raw,
      text: raw,
      usage: { promptTokens: estimateTokens(req.system + req.prompt), outputTokens: estimateTokens(raw) },
      latencyMs: Date.now() - started,
      model: this.model,
      provider: this.name,
    };
  }

  async *stream(req: GenerateRequest, opts?: GenerateOptions): AsyncIterable<string> {
    const { text } = await this.generate(req, opts);
    for (const word of text.split(/(\s+)/)) yield word;
  }

  /** Embeddings déterministes : même texte → même vecteur (voir mockEmbedding). */
  async embed(texts: string[], opts?: GenerateOptions): Promise<EmbedResult> {
    const started = Date.now();
    if (texts.some((t) => typeof t !== "string" || t.trim().length === 0)) throw new AIError("config", "Chaque texte à vectoriser doit être non vide", false);
    await this.simulate(opts);
    const embeddings = texts.map(mockEmbedding);
    return {
      embeddings,
      dimensions: embeddings.length > 0 ? MOCK_EMBED_DIMENSIONS : 0,
      usage: { promptTokens: estimateTokens(texts.join(" ")), outputTokens: 0 },
      latencyMs: Date.now() - started,
      model: this.embedModel,
      provider: this.name,
    };
  }

  /**
   * OCR d'essai simulé : renvoie le texte de l'indice [[ocr: …]] (rien sinon). Non configuré : AIError
   * « config », comme le vrai fournisseur sans OLLAMA_OCR_MODEL.
   */
  async ocr(req: OcrRequest, opts?: GenerateOptions): Promise<OcrResult> {
    const started = Date.now();
    if (!this.ocrModel) throw new AIError("config", "Aucun modèle OCR configuré (OLLAMA_OCR_MODEL, facultatif)", false);
    await this.simulate(opts);
    const text = readRawHints(req.prompt).ocr ?? "";
    return { text, usage: { promptTokens: estimateTokens(req.prompt), outputTokens: estimateTokens(text) }, latencyMs: Date.now() - started, model: this.ocrModel, provider: this.name };
  }

  private render(req: GenerateRequest): string {
    const hints = readHints(req.prompt);
    const rnd = seededRandom(hashString(req.prompt));
    const openers = ["Bonjour", "Hello", "Bonjour et merci pour votre message"];
    const opener = openers[Math.floor(rnd() * openers.length)]!;
    if (hints.kind === "listing_description") {
      return `${hints.title ?? "Article"} ${hints.brand ? `de la marque ${hints.brand}` : ""} en ${hints.condition ?? "bon état"}. Taille ${hints.size ?? "unique"}. Envoi rapide et soigné.`;
    }
    return `${opener}, ${hints.buyerName ?? ""}`.trim() + ". Oui, l'article est toujours disponible. N'hésitez pas si vous avez d'autres questions.";
  }

  private renderStructured(req: StructuredRequest<unknown>): unknown {
    const hints = readHints(req.prompt);
    if (req.schemaName === "listing_generation") return mockGeneratedListing(hints);
    if (req.schemaName === "photo_description") return mockPhotoDescription(hints);
    if (req.schemaName === "price_explanation") return { explanation: mockPriceExplanation(hints) };
    if (req.schemaName === "help_answer") return mockHelpAnswer(req.prompt);
    if (req.schemaName === "photo_sort") return mockPhotoSort(req.prompt);
    if (req.schemaName === "label_read") return mockLabelRead(req.prompt);
    if (req.schemaName === "measurements_read") return mockMeasurements(req.prompt);
    if (req.schemaName === "settings_migration") return mockSettingsMigration(req.prompt);
    if (req.schemaName === "listing_description") {
      return {
        title: `${hints.brand ? hints.brand + " " : ""}${hints.title ?? "Article"}`.slice(0, 120),
        description: `${hints.title ?? "Article"}${hints.brand ? ` ${hints.brand}` : ""}, ${hints.condition ?? "bon état"}${hints.size ? `, taille ${hints.size}` : ""}. Photos non retouchées, envoi soigné sous 48 h.`,
        hashtags: [hints.brand, hints.category].filter(Boolean).map((s) => `#${String(s).toLowerCase().replace(/\s+/g, "")}`),
      };
    }
    const decision = hints.decision ?? "answer";
    const name = hints.buyerName ? ` ${hints.buyerName}` : "";
    const price = hints.priceCents != null ? (hints.priceCents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" }) : null;
    const sig = hints.signature ? `\n${hints.signature}` : "";
    // Relance après 24 h (indice [[followUp]] de buildFollowUpRequest) : aucun prix, aucun chiffre, aucune pression.
    if (hints.followUp) {
      return { reply: `Bonjour${name}, je me permets un petit message : l'article est toujours disponible. Si vous avez une question, je suis là.${sig}`, intent: "answer", proposedPriceCents: null, confidence: 0.9, notes: "Sortie simulée (MockAIProvider)" };
    }
    // Lot (indice [[bundle: N]]) : le prix cité est celui du lot entier ; « dernier prix » seulement au plancher du lot.
    if (hints.bundle && hints.bundle >= 2 && (decision === "counter" || decision === "accept")) {
      const lot = `le lot de ${hints.bundle} articles`;
      const reply = decision === "accept"
        ? `Bonjour${name}, c'est d'accord pour ${lot} à ${price ?? "ce prix"}. Je vous laisse faire l'offre sur l'annonce et j'accepte dès réception.${sig}`
        : `Bonjour${name}, merci pour votre proposition. ${hints.priceCents != null && (hints.atFloor || hints.priceCents === hints.floorCents) ? `Pour ${lot}, je peux aller jusqu'à ${price}, c'est mon dernier prix pour ce lot.` : `Pour ${lot}, je peux vous le faire à ${price ?? "un prix intermédiaire"}.`} Si cela vous convient, faites l'offre à ce montant.${sig}`;
      return { reply, intent: decision === "accept" ? "accept_offer" : "counter_offer", proposedPriceCents: hints.priceCents ?? null, confidence: 0.9, notes: "Sortie simulée (MockAIProvider)" };
    }
    // Situation par mots-clés transmise au vendeur (indice [[situation]]) : accusé de réception sans engagement.
    if (hints.situation && (decision === "escalate" || decision === "hold")) {
      return { reply: `Bonjour${name}, merci de me l'avoir signalé. Je regarde cela de près et je reviens vers vous rapidement.${sig}`, intent: "escalate", proposedPriceCents: null, confidence: 0.9, notes: "Sortie simulée (MockAIProvider)" };
    }
    const map: Record<string, { reply: string; intent: string }> = {
      accept: { reply: `Bonjour${name}, c'est d'accord pour ${price ?? "ce prix"}. Je vous laisse faire l'offre sur l'annonce et j'accepte dès réception.${sig}`, intent: "accept_offer" },
      // « Dernier prix » seulement si la contre-offre est au plancher (indice [[atFloor]] émis par buildReplyRequest,
      // ou [[floorCents]] égal au prix imposé), formule neutre sinon.
      counter: { reply: `Bonjour${name}, merci pour votre proposition. ${hints.priceCents != null && (hints.atFloor || hints.priceCents === hints.floorCents) ? `Je peux aller jusqu'à ${price}, c'est mon dernier prix pour cet article.` : `Je peux vous le faire à ${price ?? "un prix intermédiaire"}.`} Si cela vous convient, faites l'offre à ce montant.${sig}`, intent: "counter_offer" },
      decline: { reply: `Bonjour${name}, merci pour l'intérêt. Je ne peux malheureusement pas descendre à ce prix. L'article reste disponible au prix affiché.${sig}`, intent: "decline_offer" },
      escalate: { reply: `Bonjour${name}, merci pour votre message. Je reviens vers vous très vite avec une réponse précise.${sig}`, intent: "escalate" },
      hold: { reply: `Bonjour${name}, merci pour votre message. Je vous réponds dès que possible.${sig}`, intent: "answer" },
      answer: { reply: `Bonjour${name}, oui l'article est toujours disponible. Les mesures et l'état sont décrits dans l'annonce, je peux ajouter des photos si besoin.${sig}`, intent: "answer" },
    };
    const chosen = map[decision] ?? map.answer!;
    return { reply: chosen.reply, intent: chosen.intent, proposedPriceCents: decision === "counter" || decision === "accept" ? (hints.priceCents ?? null) : null, confidence: 0.9, notes: "Sortie simulée (MockAIProvider)" };
  }
}

interface Hints {
  kind?: string;
  /** Explication d'un prix : montants décidés par l'estimation, méthode, nombre de ventes, délai, facteurs. */
  fast?: string;
  standard?: string;
  max?: string;
  method?: string;
  count?: string;
  delay?: string;
  confidence?: string;
  factors?: string;
  demo?: string;
  notes?: string;
  files?: string;
  photos?: string;
  seed?: string;
  decision?: string;
  priceCents?: number;
  /** Prix plancher (indice optionnel) : permet au simulateur de dire « dernier prix » à bon escient. */
  floorCents?: number;
  /** Contre-offre au plancher (indice émis par `buildReplyRequest`, sans révéler le plancher). */
  atFloor?: boolean;
  /** Offre sur un lot de N articles (indice `[[bundle: N]]`). */
  bundle?: number;
  /** Situation par mots-clés reconnue (nom réglé par le vendeur). */
  situation?: string;
  /** Relance après 24 h (indice `[[followUp: 1]]`). */
  followUp?: boolean;
  buyerName?: string;
  title?: string;
  brand?: string;
  size?: string;
  condition?: string;
  category?: string;
  signature?: string;
}

/** Lit les indices structurés que le constructeur de prompt insère (`[[clé: valeur]]`). */
function readHints(prompt: string): Hints {
  const out: Hints = {};
  for (const m of prompt.matchAll(/\[\[([a-zA-Z]+):\s*([^\]]*)\]\]/g)) {
    const key = m[1]!;
    const val = m[2]!.trim();
    if (key === "priceCents") out.priceCents = Number.parseInt(val, 10);
    else if (key === "floorCents") out.floorCents = Number.parseInt(val, 10);
    else if (key === "atFloor") out.atFloor = val === "1" || val === "true";
    else if (key === "bundle") out.bundle = Number.parseInt(val, 10);
    else if (key === "followUp") out.followUp = val === "1" || val === "true";
    else (out as Record<string, string>)[key] = val;
  }
  return out;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export const MOCK_EMBED_DIMENSIONS = 64;

/**
 * Vecteur déterministe de dimension 64 dérivé d'un hachage du texte, normalisé
 * (norme 1). Chaque mot (sans accent ni casse) est haché vers une dimension et
 * un signe, puis les contributions sont sommées : deux textes qui partagent des
 * mots ont une similarité cosinus plus forte, ce qui suffit à la démo des
 * ventes comparables. Un texte sans mot reçoit un vecteur pseudo-aléatoire
 * dérivé du hachage du texte entier. Aucune sémantique réelle : simulateur.
 */
export function mockEmbedding(text: string): number[] {
  const v = new Array<number>(MOCK_EMBED_DIMENSIONS).fill(0);
  const words = simplify(text).split(/[^a-z0-9]+/).filter((w) => w.length > 0);
  for (const word of words) {
    const h = hashString(word);
    const dim = h % MOCK_EMBED_DIMENSIONS;
    const sign = (h >>> 8) & 1 ? 1 : -1;
    v[dim]! += sign;
    // Deuxième projection : limite les collisions entre mots différents.
    const h2 = hashString(`${word}#2`);
    v[h2 % MOCK_EMBED_DIMENSIONS]! += ((h2 >>> 8) & 1 ? 1 : -1) * 0.5;
  }
  let norm = Math.hypot(...v);
  if (norm === 0) {
    const rnd = seededRandom(hashString(text));
    for (let i = 0; i < v.length; i++) v[i] = rnd() * 2 - 1;
    norm = Math.hypot(...v);
  }
  return v.map((x) => x / norm);
}

/**
 * Assistant d'aide simulé : reprend les premières phrases du passage le plus pertinent
 * (le premier fourni), sans rien y ajouter. Aucun passage : hors du champ de l'aide.
 */
function mockHelpAnswer(prompt: string): { answer: string; sourceIds: string[]; outOfScope: boolean } {
  const m = prompt.match(/<<<PASSAGE id=([a-z0-9-]+)>>>\nQuestion : [^\n]*\nRéponse : ([\s\S]*?)\n<<<FIN_PASSAGE>>>/);
  if (!m) return { answer: "L'aide de Selio ne couvre pas cette question.", sourceIds: [], outOfScope: true };
  const text = m[2]!.replace(/\s+/g, " ").trim();
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  return { answer: sentences.slice(0, 3).join(" ").trim().slice(0, 1500), sourceIds: [m[1]!], outOfScope: false };
}

// ---------------------------------------------------------------------------
// Générateur d'annonces simulé : le simulateur ne voit pas les photos. Il
// déduit ce qu'il peut des indications (marque, taille, notes, noms de
// fichiers) et complète avec un gabarit déterministe, clairement signalé
// comme simulé dans l'interface.
// ---------------------------------------------------------------------------

interface PieceSpec { kw: string[]; piece: string; category: string; material: string | null; colors: string[] }

const PIECES: PieceSpec[] = [
  { kw: ["jean", "denim", "501"], piece: "Jean", category: "men", material: "Denim", colors: ["Bleu"] },
  { kw: ["pull", "maille", "torsad", "cardigan"], piece: "Pull en maille", category: "men", material: "Laine", colors: ["Bleu marine", "Beige", "Gris"] },
  { kw: ["sweat", "hoodie", "capuche"], piece: "Sweat à capuche", category: "men", material: "Coton", colors: ["Gris", "Noir"] },
  { kw: ["basket", "sneaker", "air max", "samba", "stan smith", "running", "chaussure"], piece: "Baskets", category: "shoes", material: "Cuir", colors: ["Blanc", "Noir"] },
  { kw: ["bottine", "boots", "1460", "chelsea"], piece: "Bottines", category: "shoes", material: "Cuir", colors: ["Noir"] },
  { kw: ["robe"], piece: "Robe midi", category: "women", material: "Viscose", colors: ["Noir", "Vert"] },
  { kw: ["jupe"], piece: "Jupe plissée", category: "women", material: "Polyester", colors: ["Beige"] },
  { kw: ["blouse", "chemisier"], piece: "Blouse", category: "women", material: "Soie", colors: ["Blanc"] },
  { kw: ["doudoune", "parka", "nuptse"], piece: "Doudoune", category: "men", material: "Polyester", colors: ["Noir"] },
  { kw: ["manteau", "trench"], piece: "Manteau", category: "women", material: "Laine", colors: ["Camel"] },
  { kw: ["veste", "blouson", "jacket"], piece: "Veste", category: "men", material: "Coton", colors: ["Kaki", "Noir"] },
  { kw: ["chemise", "flanelle"], piece: "Chemise", category: "men", material: "Coton", colors: ["Bleu ciel", "Blanc"] },
  { kw: ["polo"], piece: "Polo", category: "men", material: "Coton", colors: ["Blanc", "Bleu marine"] },
  { kw: ["t-shirt", "tshirt", "tee"], piece: "T-shirt", category: "men", material: "Coton", colors: ["Blanc", "Noir"] },
  { kw: ["sac", "bag", "pliage", "cabas"], piece: "Sac", category: "bags", material: "Toile", colors: ["Noir"] },
  { kw: ["lunettes", "wayfarer"], piece: "Lunettes de soleil", category: "accessories", material: null, colors: ["Noir"] },
];

const BRAND_DEFAULT_PIECE: Record<string, string> = {
  "nike": "Baskets", "adidas": "Baskets", "new balance": "Baskets", "converse": "Baskets", "vans": "Baskets",
  "levi's": "Jean", "the north face": "Doudoune", "patagonia": "Veste", "ralph lauren": "Pull en maille", "lacoste": "Polo",
  "dr. martens": "Bottines", "longchamp": "Sac", "ray-ban": "Lunettes de soleil", "carhartt": "Veste", "sézane": "Blouse",
  "maje": "Robe midi", "zara": "Robe midi", "uniqlo": "T-shirt", "tommy hilfiger": "Chemise", "stone island": "Sweat à capuche",
};

const KNOWN_BRANDS = ["The North Face", "Ralph Lauren", "Dr. Martens", "New Balance", "Tommy Hilfiger", "Stone Island", "Levi's", "Nike", "Adidas", "Converse", "Vans", "Zara", "Carhartt", "Lacoste", "Patagonia", "Sézane", "Maje", "Longchamp", "Ray-Ban", "Uniqlo", "Sandro", "Kenzo", "Jacquemus", "Mango", "Champion", "Arc'teryx"];
const COLORS = ["noir", "blanc", "bleu marine", "bleu", "beige", "gris", "rouge", "vert", "kaki", "marron", "rose", "camel", "jaune"];

function simplify(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[-_.']+/g, " ");
}

function mockGeneratedListing(h: Hints): Record<string, unknown> {
  const haystack = simplify([h.brand, h.notes, h.files].filter(Boolean).join(" "));
  const rnd = seededRandom(hashString(h.seed ?? haystack ?? "selio"));
  const brand = h.brand?.trim() || KNOWN_BRANDS.find((b) => haystack.includes(simplify(b))) || null;
  const byKeyword = PIECES.find((p) => p.kw.some((k) => haystack.includes(simplify(k))));
  const byBrand = brand ? PIECES.find((p) => p.piece === BRAND_DEFAULT_PIECE[brand.toLowerCase()]) : undefined;
  const spec = byKeyword ?? byBrand ?? PIECES[Math.floor(rnd() * PIECES.length)]!;
  const sizeMatch = haystack.match(/\b(xxs|xs|s|m|l|xl|xxl|3[4-9]|4[0-6]|w\d{2})\b/i);
  const size = h.size?.trim() || (sizeMatch ? sizeMatch[1]!.toUpperCase() : null);
  const colorWord = COLORS.find((c) => haystack.includes(c));
  const color = colorWord ? colorWord.charAt(0).toUpperCase() + colorWord.slice(1) : spec.colors[Math.floor(rnd() * spec.colors.length)]!;
  // Les notes du vendeur priment sur les noms de fichiers (« etiquette.jpg » n'est pas « neuf avec étiquette »).
  const notes = simplify(h.notes ?? "");
  const condition = /defaut|tache|trou|use/.test(notes) ? "satisfactory" : /porte/.test(notes) ? (rnd() < 0.7 ? "very_good" : "good") : /neuf avec etiquette|avec etiquette/.test(notes) ? "new_with_tags" : /\bneuf\b/.test(notes) ? "new_without_tags" : rnd() < 0.6 ? "very_good" : "good";
  const conditionText: Record<string, string> = {
    new_with_tags: "Neuf avec étiquette, jamais porté.",
    new_without_tags: "Neuf sans étiquette, jamais porté.",
    very_good: "Très bon état : porté quelques fois, aucun défaut visible.",
    good: "Bon état : légères traces d'usage, sans défaut majeur.",
    satisfactory: "État correct : défaut visible sur les photos, prix ajusté en conséquence.",
  };
  const title = [brand, spec.piece, color.toLowerCase(), size ? `taille ${size}` : null].filter(Boolean).join(" ").slice(0, 70);
  const description = [
    `${spec.piece}${brand ? ` ${brand}` : ""} coloris ${color.toLowerCase()}${spec.material ? `, en ${spec.material.toLowerCase()}` : ""}.`,
    conditionText[condition],
    size ? `Taille ${size}${spec.category === "shoes" ? "" : ", coupe classique"}.` : "Taille à confirmer sur l'étiquette.",
    "Mesures disponibles sur demande.",
    "Envoi soigné sous 48 h.",
  ].join(" ");
  const tag = (v: string) => `#${simplify(v).replace(/\s+/g, "")}`;
  return {
    title: title.length >= 3 ? title : `${spec.piece} ${color}`,
    description,
    brand,
    category: spec.category,
    size,
    condition,
    colors: [color],
    material: spec.material,
    hashtags: [brand ? tag(brand) : null, tag(spec.piece), tag(color)].filter(Boolean),
    confidence: brand || byKeyword ? 0.6 : 0.35,
  };
}

// ---------------------------------------------------------------------------
// Estimation des prix simulée : la description de la photo reprend le
// générateur d'annonces simulé (il ne voit pas la photo) ; l'explication
// recopie les faits fournis, sans aucun montant ni facteur nouveau.
// ---------------------------------------------------------------------------

function mockPhotoDescription(h: Hints): Record<string, unknown> {
  const listing = mockGeneratedListing(h);
  const colors = listing.colors as string[];
  const title = String(listing.title);
  const piece = PIECES.find((p) => title.includes(p.piece))?.piece ?? null;
  return {
    title,
    brand: listing.brand,
    category: listing.category,
    subcategory: piece,
    material: listing.material,
    color: colors[0] ?? null,
    condition: listing.condition,
    confidence: listing.confidence,
  };
}

const eurosFromHint = (v: string | undefined): string | null => {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) ? `${(n / 100).toFixed(2).replace(".", ",")} €` : null;
};

function mockPriceExplanation(h: Hints): string {
  const standard = eurosFromHint(h.standard);
  const fast = eurosFromHint(h.fast);
  const max = eurosFromHint(h.max);
  const count = Number.parseInt(h.count ?? "0", 10) || 0;
  const parts = [
    `Le prix standard de ${standard ?? "l'estimation"} vient de la méthode « ${(h.method ?? "estimation").toLowerCase()} »${count > 0 ? `, à partir de ${count} vente(s) comparable(s)` : ""}.`,
    fast && max ? `Pour vendre plus vite, ${fast} ; pour viser la marge maximale, ${max}.` : "",
    h.delay ? `Le délai de vente estimé est d'environ ${h.delay} jours, sans certitude.` : "",
    h.factors ? `Facteurs pris en compte : ${h.factors}.` : "",
    h.demo === "1" ? "Attention : ces chiffres reposent sur des données de démonstration." : "",
  ];
  return parts.filter(Boolean).join(" ").slice(0, 800);
}

// ---------------------------------------------------------------------------
// Studio façon Kavis simulé (§5.11) : le simulateur ne voit pas les photos. Il
// répond seulement à partir des indices [[…]] que la démonstration ou les tests
// fournissent ([[label: brand=Levi's,size=W32]], [[tape: chest=52,length=70]],
// [[roles: front,label,tape]]…). Sans indice : rien n'est « lu » (étiquette
// illisible, aucun ruban visible), jamais une valeur inventée.
// ---------------------------------------------------------------------------

/** Indices bruts du prompt (`[[clé: valeur]]`), la dernière occurrence l'emporte. */
function readRawHints(prompt: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of prompt.matchAll(/\[\[([a-zA-Z]+):\s*([^\]]*)\]\]/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

/** « brand=Levi's,size=W32 L34,confidence=0.9 » → { brand, size, confidence } (une virgule dans une valeur est gardée). */
function parsePairs(s: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!s) return out;
  for (const part of s.split(/,(?=\s*[a-zA-Z]+\s*=)/)) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key && value) out[key] = value;
  }
  return out;
}

const clamp01 = (v: number, fallback: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);

function roleFromName(name: string): PhotoRole | null {
  const n = simplify(name);
  if (/etiquette|label|composition|\btag\b/.test(n)) return "label";
  if (/metre|mesure|ruban|\btape\b|measure/.test(n)) return "tape";
  if (/defaut|tache|trou|accroc|usure|defect/.test(n)) return "defect";
  if (/\bdos\b|\bback\b|arriere/.test(n)) return "back";
  if (/detail|zoom|gros plan|matiere/.test(n)) return "detail";
  if (/\bface\b|devant|\bfront\b|entier/.test(n)) return "front";
  return null;
}

function mockPhotoSort(prompt: string): Record<string, unknown> {
  const h = readRawHints(prompt);
  const n = Math.min(6, Math.max(1, Number.parseInt(h.photos ?? "1", 10) || 1));
  const roles = (h.roles ?? "").split(",").map((r) => r.trim());
  const groups = (h.groups ?? "").split(",").map((g) => Number.parseInt(g.trim(), 10));
  const names = (h.photoNames ?? "").split("|").map((x) => x.trim());
  const photos = Array.from({ length: n }, (_, i) => {
    const hinted = (PHOTO_ROLES as readonly string[]).includes(roles[i] ?? "") ? (roles[i] as PhotoRole) : null;
    const fromName = names[i] ? roleFromName(names[i]!) : null;
    const role: PhotoRole = hinted ?? fromName ?? (i === 0 ? "front" : "other");
    const group = groups[i];
    return { index: i, role, articleGroup: group !== undefined && Number.isFinite(group) && group >= 1 ? group : 1, confidence: hinted ? 0.9 : fromName ? 0.75 : i === 0 ? 0.5 : 0.3 };
  });
  return { photos };
}

function mockLabelRead(prompt: string): Record<string, unknown> {
  const h = readRawHints(prompt);
  const pairs = parsePairs(h.label);
  const base = clamp01(Number.parseFloat(pairs.confidence ?? ""), 0.9);
  // Relecture avec le texte de l'OCR d'essai : une valeur qu'il confirme est lue avec plus de certitude.
  const ocr = h.ocrText === "1" && h.ocr ? simplify(h.ocr).replace(/\s+/g, "") : "";
  const unread = h.labelReadFrom === "none";
  const field = (key: (typeof LABEL_FIELDS)[number]) => {
    const value = pairs[key]?.trim();
    if (!value) return { value: null, confidence: 0, readFrom: null };
    const confirmed = ocr && ocr.includes(simplify(value).replace(/\s+/g, ""));
    return { value, confidence: confirmed ? Math.max(base, 0.92) : base, readFrom: unread ? null : "label" };
  };
  const values = LABEL_FIELDS.map((k) => pairs[k]?.trim()).filter((v): v is string => Boolean(v));
  return {
    brand: field("brand"),
    size: field("size"),
    material: field("material"),
    reference: field("reference"),
    careSymbols: [],
    text: ocr && h.ocr ? h.ocr : values.length > 0 ? values.join(" ") : null,
  };
}

function mockMeasurements(prompt: string): Record<string, unknown> {
  const h = readRawHints(prompt);
  if (h.tape === undefined) return { tapeVisible: false, measurements: [] };
  const pairs = parsePairs(h.tape);
  const confidence = clamp01(Number.parseFloat(pairs.confidence ?? ""), 0.9);
  const measurements = MEASUREMENT_NAMES.flatMap((name) => {
    const v = Number.parseFloat(pairs[name] ?? "");
    return Number.isFinite(v) ? [{ name, valueCm: v, confidence, evidence: "tape_photo" }] : [];
  });
  // [[tapeVisible: 0]] simule un modèle qui « mesure » sans ruban : la validation doit tout écarter.
  return { tapeVisible: h.tapeVisible !== "0", measurements };
}

// ---------------------------------------------------------------------------
// Migration des réglages simulée (§5.13) : le simulateur applique le catalogue
// déterministe des équivalences aux lignes « libellé : valeur » du texte collé
// (bloc de données non fiables) et aux indices [[migration: label=value | …]]
// (captures simulées). Sans texte ni indice : aucun champ, jamais une valeur
// inventée ; les captures ne sont pas réellement lues par le simulateur.
// ---------------------------------------------------------------------------

function mockSettingsMigration(prompt: string): Record<string, unknown> {
  const h = readRawHints(prompt);
  const block = prompt.match(/<<<DONNÉES_NON_FIABLES:reglages_colles>>>\n([\s\S]*?)\n<<<FIN_DONNÉES_NON_FIABLES>>>/);
  const candidates: MigrationCandidate[] = block ? parseSettingsText(block[1]!) : [];
  for (const part of (h.migration ?? "").split("|")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const sourceLabel = part.slice(0, eq).trim();
    const sourceValue = part.slice(eq + 1).trim();
    if (sourceLabel && sourceValue) candidates.push({ sourceLabel, sourceValue });
  }
  const text = simplify(block?.[1] ?? "");
  const written = (["bleam", "clemz", "vtools"] as const).find((name) => new RegExp(`\\b${name === "vtools" ? "v ?tools" : name}\\b`).test(text));
  const source: MigrationSource = (MIGRATION_SOURCES as readonly string[]).includes(h.migrationSource ?? "") ? (h.migrationSource as MigrationSource) : written ?? "unknown";
  const mapping = suggestMappingFromCandidates(candidates, source);
  const screenshots = Number.parseInt(h.screenshots ?? "0", 10) || 0;
  const warnings = [...mapping.warnings];
  if (screenshots > 0 && !h.migration) warnings.push("Simulateur : les captures d'écran ne sont pas lues (aucun modèle de vision réel) ; collez vos réglages en texte.");
  return { source: mapping.source, fields: mapping.fields, unknownFields: mapping.unknownFields, warnings };
}
