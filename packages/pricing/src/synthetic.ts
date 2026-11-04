/**
 * Références SYNTHÉTIQUES pour les tests et le script d'évaluation (`pnpm prix:eval --synthetic N`).
 * Toutes ont la source `demo` : un modèle entraîné dessus est marqué « données de démonstration »
 * et son erreur n'est jamais présentée comme une mesure réelle.
 *
 * Structure réaliste, dans l'esprit de la simulation du compte rendu (partie 07) : prix de vente
 * = niveau de la marque (popularité en loi de Zipf, longue traîne de petites marques) + catégorie
 * et sous-catégorie + interaction marque × catégorie + état + taille + matière + saison (selon la
 * catégorie) + photos + bruit propre à chaque article (σ ≈ 0,25 en logarithme). Ce bruit fixe le
 * plancher d'erreur vers 17 % : « chaque article est unique ». Le délai de vente dépend de la
 * catégorie, de l'état et surtout de l'écart entre prix affiché et prix typique. Les articles
 * dont la vente tomberait après `now` restent invendus. Une petite part de lignes « sales »
 * (doublons, prix aberrants, délais négatifs, lots, états illisibles) exerce le nettoyage.
 *
 * Aucune donnée personnelle : ni pseudo, ni identifiant, ni photo, ni titre.
 */
import { createRng, gaussian } from "./gbm";
import type { DateInput, PriceReference } from "./types";

export interface SyntheticOptions {
  /** Nombre de lignes produites (lignes sales comprises). */
  n: number;
  seed?: number;
  /** Fin de la période (dernière date possible). Par défaut : 30 octobre 2026. */
  now?: DateInput;
  /** Profondeur d'historique, en jours (395 ≈ 13 mois). */
  days?: number;
  /** Part de lignes sales (0,02). */
  dirtyShare?: number;
  /** Bruit propre à chaque article, écart type en logarithme (0,25). */
  noise?: number;
}

interface Category {
  name: string;
  /** Prix typique en centimes (très bon état, marque moyenne). */
  base: number;
  sizes: "letter" | "eu" | "waist" | "shoe" | "kids" | "one";
  /** Amplitude saisonnière (log) et mois du pic (0 = janvier). */
  season: [number, number];
  subcategories: [string, number][];
  materials: string[];
  weight: number;
  /** Délai médian typique, en jours. */
  delay: number;
}

const CATEGORIES: Category[] = [
  { name: "Jeans", base: 2200, sizes: "waist", season: [0.02, 0], subcategories: [["Jean droit", 0], ["Jean slim", -0.05], ["Jean flare", 0.08], ["Jean mom", 0.04]], materials: ["Denim", "Coton", "98 % coton 2 % élasthanne"], weight: 12, delay: 12 },
  { name: "Pulls", base: 1800, sizes: "letter", season: [0.15, 0], subcategories: [["Pull col rond", 0], ["Pull col roulé", 0.06], ["Cardigan", -0.03]], materials: ["Laine", "Coton", "Cachemire", "Acrylique", "50 % laine 50 % acrylique"], weight: 10, delay: 14 },
  { name: "Manteaux", base: 4500, sizes: "letter", season: [0.3, 0], subcategories: [["Doudoune", 0.1], ["Trench", 0], ["Manteau en laine", 0.05], ["Parka", -0.05]], materials: ["Laine", "Polyester", "Nylon", "Coton"], weight: 7, delay: 18 },
  { name: "Robes", base: 2000, sizes: "eu", season: [0.12, 6], subcategories: [["Robe d'été", -0.05], ["Robe midi", 0.03], ["Robe de soirée", 0.2]], materials: ["Viscose", "Coton", "Polyester", "Soie", "Lin"], weight: 11, delay: 13 },
  { name: "T-shirts", base: 900, sizes: "letter", season: [0.08, 6], subcategories: [["T-shirt imprimé", 0.05], ["T-shirt uni", -0.05], ["Débardeur", -0.1]], materials: ["Coton", "Polyester", "Lin"], weight: 12, delay: 10 },
  { name: "Chemises", base: 1500, sizes: "letter", season: [0.05, 5], subcategories: [["Chemise en lin", 0.05], ["Chemise oxford", 0], ["Blouse", -0.02]], materials: ["Coton", "Lin", "Soie", "Viscose"], weight: 7, delay: 12 },
  { name: "Baskets", base: 3500, sizes: "shoe", season: [0.05, 4], subcategories: [["Baskets basses", 0], ["Baskets montantes", 0.08], ["Running", -0.05]], materials: ["Cuir", "Toile", "Synthétique", "Daim"], weight: 10, delay: 9 },
  { name: "Bottes", base: 4000, sizes: "shoe", season: [0.25, 0], subcategories: [["Bottines", 0], ["Bottes hautes", 0.1], ["Boots", 0.05]], materials: ["Cuir", "Daim", "Synthétique"], weight: 5, delay: 15 },
  { name: "Sacs", base: 3000, sizes: "one", season: [0.03, 11], subcategories: [["Sac à main", 0.1], ["Sac à dos", -0.05], ["Pochette", -0.15]], materials: ["Cuir", "Toile", "Synthétique", "Nylon"], weight: 7, delay: 16 },
  { name: "Vestes", base: 3500, sizes: "letter", season: [0.12, 3], subcategories: [["Veste en jean", 0], ["Blazer", 0.05], ["Veste de survêtement", -0.1]], materials: ["Denim", "Coton", "Polyester", "Laine"], weight: 7, delay: 14 },
  { name: "Jupes", base: 1400, sizes: "eu", season: [0.1, 6], subcategories: [["Jupe plissée", 0.03], ["Jupe en jean", 0], ["Jupe longue", 0.02]], materials: ["Coton", "Polyester", "Denim", "Viscose"], weight: 5, delay: 13 },
  { name: "Shorts", base: 1100, sizes: "letter", season: [0.25, 6], subcategories: [["Short en jean", 0], ["Short de sport", -0.1], ["Bermuda", 0]], materials: ["Denim", "Coton", "Polyester", "Lin"], weight: 4, delay: 11 },
  { name: "Vêtements enfant", base: 700, sizes: "kids", season: [0.05, 8], subcategories: [["Body", -0.1], ["Ensemble", 0.1], ["Pyjama", -0.05]], materials: ["Coton", "Polyester"], weight: 6, delay: 17 },
];

/** Marques nommées : [nom, écart du niveau de prix (log), variantes d'écriture]. */
const NAMED_BRANDS: [string, number, string[]][] = [
  ["Zara", -0.25, ["ZARA", "Zara Woman", "zara"]],
  ["H&M", -0.55, ["H & M", "HM", "h&m"]],
  ["Shein", -0.85, ["SHEIN"]],
  ["Primark", -0.8, ["primark"]],
  ["Kiabi", -0.75, ["KIABI"]],
  ["Mango", -0.2, ["MANGO"]],
  ["Bershka", -0.45, ["bershka"]],
  ["Pull&Bear", -0.4, ["Pull & Bear", "Pull and Bear"]],
  ["Uniqlo", -0.15, ["UNIQLO"]],
  ["Promod", -0.4, ["PROMOD"]],
  ["Jules", -0.45, ["JULES"]],
  ["Celio", -0.4, ["CELIO", "celio*"]],
  ["Levi's", 0.2, ["Levis", "LEVI'S", "Levi’s", "Levi Strauss"]],
  ["Nike", 0.3, ["NIKE", "nike"]],
  ["Adidas", 0.2, ["ADIDAS", "adidas Originals"]],
  ["New Balance", 0.3, ["NEW BALANCE", "Newbalance"]],
  ["Converse", 0.05, ["CONVERSE"]],
  ["Vans", 0.0, ["VANS"]],
  ["Carhartt", 0.45, ["Carhartt WIP", "CARHARTT"]],
  ["Ralph Lauren", 0.55, ["Polo Ralph Lauren", "RALPH LAUREN"]],
  ["Tommy Hilfiger", 0.35, ["Tommy Jeans", "TOMMY HILFIGER"]],
  ["Lacoste", 0.45, ["LACOSTE"]],
  ["The North Face", 0.7, ["North Face", "TNF"]],
  ["Patagonia", 0.8, ["PATAGONIA"]],
  ["Sézane", 0.65, ["Sezane", "SÉZANE"]],
  ["Maje", 0.7, ["MAJE"]],
  ["Sandro", 0.7, ["SANDRO"]],
  ["Claudie Pierlot", 0.6, ["CLAUDIE PIERLOT"]],
  ["Ba&sh", 0.65, ["Ba & sh", "BA&SH"]],
  ["The Kooples", 0.65, ["Kooples"]],
  ["Petit Bateau", 0.1, ["PETIT BATEAU"]],
  ["Jacadi", 0.25, ["JACADI"]],
  ["Dr. Martens", 0.6, ["Dr Martens", "Doc Martens"]],
  ["Longchamp", 0.85, ["LONGCHAMP"]],
  ["Michael Kors", 0.8, ["MK", "MICHAEL KORS"]],
  ["Stone Island", 1.0, ["STONE ISLAND"]],
  ["Ami Paris", 1.0, ["AMI"]],
  ["Isabel Marant", 1.2, ["ISABEL MARANT"]],
  ["Saint Laurent", 1.9, ["YSL", "Yves Saint Laurent"]],
  ["Louis Vuitton", 2.2, ["LV", "LOUIS VUITTON"]],
  ["Sans marque", -0.7, ["", "Aucune marque", "Autre"]],
];

const CONDITIONS: [string, number, number][] = [
  ["new_with_tags", 0.3, 0.12],
  ["new_without_tags", 0.18, 0.15],
  ["very_good", 0, 0.4],
  ["good", -0.15, 0.25],
  ["satisfactory", -0.35, 0.08],
];
const CONDITION_TEXT: Record<string, string[]> = {
  new_with_tags: ["Neuf avec étiquette", "new_with_tags"],
  new_without_tags: ["Neuf sans étiquette", "new_without_tags", "new"],
  very_good: ["Très bon état", "very_good"],
  good: ["Bon état", "good"],
  satisfactory: ["Satisfaisant", "satisfactory"],
};

const MATERIAL_EFFECT: Record<string, number> = {
  cachemire: 0.5, cuir: 0.3, soie: 0.25, daim: 0.2, laine: 0.15, lin: 0.08, coton: 0, denim: 0,
  viscose: -0.05, nylon: -0.05, toile: -0.05, polyester: -0.12, synthetique: -0.18, acrylique: -0.18,
};
const COLORS = ["Noir", "Blanc", "Bleu marine", "Gris", "Beige", "Bleu", "Rouge", "Vert kaki", "Rose", "Marron", "Multicolore", "Jaune moutarde"];

function pickWeighted<T>(rng: () => number, items: readonly T[], weight: (t: T) => number): T {
  let total = 0;
  for (const it of items) total += weight(it);
  let r = rng() * total;
  for (const it of items) {
    r -= weight(it);
    if (r <= 0) return it;
  }
  return items[items.length - 1]!;
}

const pick = <T>(rng: () => number, items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;

function materialKey(raw: string): string {
  const t = raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (t.includes("%")) return t.includes("laine") ? "laine" : "coton";
  return t.replace(/[^a-z]/g, "");
}

/** Taille affichée et son effet (log) sur le prix. */
function sizeFor(rng: () => number, kind: Category["sizes"]): [string, number] {
  switch (kind) {
    case "letter": {
      const [label, ord] = pickWeighted(rng, [["XS", 1], ["S", 2], ["M", 3], ["L", 4], ["XL", 5], ["XXL", 6]] as [string, number][], ([, o]) => [0.1, 0.25, 0.3, 0.22, 0.1, 0.03][o - 1]!);
      const shown = pick(rng, [label, label, `Taille ${label}`, label.toLowerCase()]);
      return [shown, -0.04 * Math.abs(ord - 3.5)];
    }
    case "eu": {
      const n = 34 + 2 * Math.floor(rng() * 6);
      return [pick(rng, [String(n), `${n}`, `FR ${n}`]), -0.03 * Math.abs((n - 32) / 2 - 3)];
    }
    case "waist": {
      const w = 26 + Math.floor(rng() * 11);
      const l = 30 + 2 * Math.floor(rng() * 3);
      return [pick(rng, [`W${w}`, `W${w} L${l}`, `${w}/${l}`]), -0.03 * Math.abs((w - 24) / 2 - 3.5)];
    }
    case "shoe": {
      const s = 36 + Math.floor(rng() * 10) + (rng() < 0.15 ? 0.5 : 0);
      return [String(s).replace(".", ","), 0];
    }
    case "kids": {
      const age = pick(rng, ["18 mois", "2 ans", "4 ans", "6 ans", "8 ans", "10 ans", "12 ans"]);
      const years = age.includes("mois") ? 1.5 : Number(age.split(" ")[0]);
      return [age, 0.02 * years];
    }
    default:
      return [pick(rng, ["Taille unique", "TU"]), 0];
  }
}

/** Génère des références de démonstration (source `demo`), reproductibles à graine égale. */
export function generateSyntheticReferences(options: SyntheticOptions): PriceReference[] {
  const rng = createRng(options.seed ?? 7);
  const nowTime = options.now === undefined ? Date.parse("2026-10-30T12:00:00Z") : options.now instanceof Date ? options.now.getTime() : Date.parse(options.now);
  const horizon = (options.days ?? 395) * 86_400_000;
  const noise = options.noise ?? 0.25;
  const dirtyShare = Math.min(0.5, Math.max(0, options.dirtyShare ?? 0.02));
  const nDirty = Math.round(options.n * dirtyShare);
  const nClean = options.n - nDirty;

  // Marques : nommées puis longue traîne ; popularité en loi de Zipf ; niveau de prix par marque.
  const brands: { name: string; level: number; variants: string[]; weight: number }[] = [];
  NAMED_BRANDS.forEach(([name, level, variants], i) => brands.push({ name, level, variants, weight: 1 / Math.pow(i + 1, 0.9) }));
  for (let i = 0; i < 260; i++) brands.push({ name: `Atelier ${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26) + 1}`, level: gaussian(rng) * 0.35, variants: [], weight: 0.6 / Math.pow(i + 10, 1.1) });
  const interactions = new Map<string, number>();
  const interaction = (b: string, c: string) => {
    const k = `${b}|${c}`;
    let v = interactions.get(k);
    if (v === undefined) {
      v = gaussian(rng) * 0.12;
      interactions.set(k, v);
    }
    return v;
  };

  const out: PriceReference[] = [];
  for (let i = 0; i < nClean; i++) {
    const cat = pickWeighted(rng, CATEGORIES, (c) => c.weight);
    const brand = pickWeighted(rng, brands, (b) => b.weight);
    const [sub, subEffect] = pick(rng, cat.subcategories);
    const [condition, condEffect] = pickWeighted(rng, CONDITIONS, (c) => c[2]);
    const [size, sizeEffect] = sizeFor(rng, cat.sizes);
    const material = rng() < 0.85 ? pick(rng, cat.materials) : null;
    const color = rng() < 0.9 ? pick(rng, COLORS) : null;
    const photoCount = 1 + Math.min(19, Math.floor(-Math.log(Math.max(rng(), 1e-9)) * 4));
    const listedAt = nowTime - Math.floor(rng() * horizon);
    const month = new Date(listedAt).getUTCMonth();
    const seasonEffect = cat.season[0] * Math.cos((2 * Math.PI * (month - cat.season[1])) / 12);
    const logFair =
      Math.log(cat.base) + brand.level + subEffect + interaction(brand.name, cat.name) + condEffect + sizeEffect +
      (material ? (MATERIAL_EFFECT[materialKey(material)] ?? 0) : 0) + seasonEffect + 0.015 * (Math.min(photoCount, 8) - 4);
    const finalCents = Math.max(100, Math.round(Math.exp(logFair + gaussian(rng) * noise) / 10) * 10);
    const markup = rng() < 0.5 ? 0 : 0.05 + rng() * 0.25;
    const listedCents = Math.max(100, Math.round((finalCents * (1 + markup)) / 50) * 50);
    const relative = Math.log(listedCents) - logFair;
    // Plus l'article est affiché au-dessus de son prix typique, plus il met de temps à partir ; un état moins bon ralentit.
    const conditionRank = CONDITIONS.findIndex((c) => c[0] === condition);
    const delay = Math.min(365, cat.delay * Math.exp(1.2 * relative + 0.08 * (conditionRank - 2) + gaussian(rng) * 0.7));
    const soldTime = listedAt + delay * 86_400_000;
    const sold = soldTime <= nowTime;
    const brandShown = brand.variants.length && rng() < 0.12 ? pick(rng, brand.variants) : brand.name;
    out.push({
      brand: brandShown,
      category: cat.name,
      subcategory: sub,
      size,
      material,
      color,
      condition: pick(rng, CONDITION_TEXT[condition]!),
      listedPriceCents: listedCents,
      finalPriceCents: sold ? finalCents : null,
      listedAt: new Date(listedAt).toISOString(),
      soldAt: sold ? new Date(Math.round(soldTime)).toISOString() : null,
      photoCount,
      views: Math.round(20 + rng() * 300),
      favorites: Math.round(rng() * 25),
      source: "demo",
    });
  }

  // Lignes sales : chacune doit être écartée par le nettoyage.
  for (let k = 0; k < nDirty && out.length > 0; k++) {
    const base = out[Math.floor(rng() * nClean)]!;
    const kind = k % 6;
    if (kind === 0) out.push({ ...base });
    else if (kind === 1) out.push({ ...base, listedPriceCents: 40, finalPriceCents: base.finalPriceCents === null ? null : 30 });
    else if (kind === 2) out.push({ ...base, listedPriceCents: base.listedPriceCents * 400, finalPriceCents: base.finalPriceCents === null ? null : base.finalPriceCents! * 400 });
    else if (kind === 3) out.push({ ...base, soldAt: new Date(Date.parse(String(base.listedAt)) - 3 * 86_400_000).toISOString(), finalPriceCents: base.finalPriceCents ?? base.listedPriceCents });
    else if (kind === 4) out.push({ ...base, category: "Lot de vêtements", subcategory: null });
    else out.push({ ...base, condition: "à voir" });
  }
  return out;
}
