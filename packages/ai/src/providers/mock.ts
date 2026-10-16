import { hashString, seededRandom } from "@selio/domain";
import { AIError, extractJson, type AIProvider, type GenerateOptions, type GenerateRequest, type GenerateResult, type HealthResult, type StructuredRequest, type StructuredResult } from "../types";

export interface MockOptions {
  /** Latence simulée (ms), déterministe. */
  latencyMs?: number;
  /** Force une erreur pour les tests (ex. "timeout"). */
  failWith?: AIError | null;
  /** Retourne une sortie volontairement invalide (tests de validation). */
  invalidOutput?: boolean;
}

/**
 * Provider déterministe : même requête → même sortie. Sert la démo (bandeau
 * « simulé ») et les tests. Il n'imite pas un vrai modèle : il applique des
 * gabarits français à partir des indices présents dans le prompt.
 */
export class MockAIProvider implements AIProvider {
  readonly name = "mock";
  readonly model = "selio-mock-v1";
  constructor(private readonly opts: MockOptions = {}) {}

  async health(): Promise<HealthResult> {
    return { ok: true, status: "mock", message: "Simulateur IA déterministe (aucun modèle réel)", latencyMs: 0, model: this.model, provider: this.name };
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
    const map: Record<string, { reply: string; intent: string }> = {
      accept: { reply: `Bonjour${name}, c'est d'accord pour ${price ?? "ce prix"}. Je vous laisse faire l'offre sur l'annonce et j'accepte dès réception.${sig}`, intent: "accept_offer" },
      counter: { reply: `Bonjour${name}, merci pour votre proposition. Je peux descendre à ${price ?? "un prix intermédiaire"}, c'est mon meilleur prix compte tenu de l'état et du port. Si cela vous convient, faites l'offre à ce montant.${sig}`, intent: "counter_offer" },
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
  notes?: string;
  files?: string;
  photos?: string;
  seed?: string;
  decision?: string;
  priceCents?: number;
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
    else (out as Record<string, string>)[key] = val;
  }
  return out;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
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
