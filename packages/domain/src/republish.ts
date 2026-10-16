import { ITEM_CATEGORY_LABELS, ITEM_CONDITION_LABELS, type InventoryItem, type InventoryItemUpdate, type Republication } from "@selio/contracts";
import { applyRate, type Cents } from "./money";
import { daysOnline, DEFAULT_REPUBLISH_AFTER_DAYS } from "./online";

/**
 * Republications pré-faites : au moins 8 variantes prêtes par annonce
 * (titre, description, prix, photo de couverture, créneau conseillé). On
 * alterne les variantes pour éviter de republier deux fois la même annonce,
 * et on garde la trace de celles déjà utilisées et de leur rendement.
 */

export const MIN_REPUBLISH_VARIANTS = 8;

export interface RepublishVariant {
  id: string;
  index: number;
  name: string;
  strategy: string;
  title: string;
  description: string;
  priceCents: Cents | null;
  /** Ordre des photos (indices dans `photos`) : la première devient la couverture. */
  photoOrder: number[];
  slot: string;
  uses: number;
  lastUsed: Republication | null;
  /** Vues et favoris relevés 48 h après la dernière utilisation (null si pas encore mesuré). */
  result: { views: number; favorites: number } | null;
}

export interface RepublicationPlan {
  variants: RepublishVariant[];
  next: RepublishVariant | null;
  usedCount: number;
  totalRepublications: number;
  daysOnline: number | null;
  /** Jours restants avant la prochaine republication conseillée (0 = maintenant). */
  dueInDays: number | null;
  /** Meilleure variante mesurée sur cette annonce. */
  best: RepublishVariant | null;
}

function season(now: Date): string {
  const m = now.getUTCMonth();
  return m === 11 || m <= 1 ? "l'hiver" : m <= 4 ? "le printemps" : m <= 7 ? "l'été" : "l'automne";
}

const CATEGORY_KEYWORD: Record<InventoryItem["category"], string> = {
  women: "femme",
  men: "homme",
  kids: "enfant",
  shoes: "chaussures",
  bags: "sac",
  accessories: "accessoire",
  home: "maison",
  electronics: "high-tech",
  other: "",
};

function clean(s: string): string {
  return s.replace(/\s+/g, " ").replace(/\s+([,.])/g, "$1").replace(/^[\s–-]+|[\s–-]+$/g, "").trim();
}

/** Nettoie un texte multiligne : espaces en trop, lignes vides multiples. */
function cleanText(s: string): string {
  return s.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Assemble les morceaux non vides d'un titre. */
function join(...parts: (string | false | null | undefined)[]): string {
  return parts.filter((p): p is string => Boolean(p && p.trim())).join(" ");
}

function cap(s: string, max = 100): string {
  const t = clean(s);
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + "…";
}

/** Type de pièce sans la marque (« Sweat à capuche The North Face » → « Sweat à capuche »). */
export function pieceName(item: Pick<InventoryItem, "title" | "brand" | "category">): string {
  let t = item.title;
  if (item.brand) t = t.replace(new RegExp(item.brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "");
  t = clean(t);
  return t || ITEM_CATEGORY_LABELS[item.category];
}

function roundTo10(c: number): number {
  return Math.round(c / 10) * 10;
}

/** Prix d'une variante : jamais sous le plancher ni au-dessus du prix affiché. */
function variantPrice(item: InventoryItem, kind: "same" | "minus_1" | "round" | "minus_3pct" | "minus_5pct" | "floor"): Cents | null {
  const listed = item.listedPriceCents;
  if (listed === null) return null;
  const floor = item.floorPriceCents ?? 0;
  let p = listed;
  switch (kind) {
    case "same": p = listed; break;
    case "minus_1": p = listed - 100; break;
    case "round": p = Math.floor(listed / 100) * 100 - 10; break;
    case "minus_3pct": p = roundTo10(listed - applyRate(listed, 0.03)); break;
    case "minus_5pct": p = roundTo10(listed - applyRate(listed, 0.05)); break;
    case "floor": p = item.floorPriceCents ?? roundTo10(listed - applyRate(listed, 0.1)); break;
  }
  return Math.min(listed, Math.max(floor, p));
}

function rotate(count: number, by: number): number[] {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, i) => (i + by) % count);
}

interface VariantSpec {
  id: string;
  name: string;
  strategy: string;
  slot: string;
  price: Parameters<typeof variantPrice>[1];
  title: (c: Ctx) => string;
  description: (c: Ctx) => string;
}

interface Ctx {
  brand: string;
  piece: string;
  size: string;
  color: string;
  condition: string;
  base: string;
  season: string;
  keyword: string;
  hashtags: string;
}

const FOOTER = "Envoi soigné sous 48 h. N'hésitez pas à me poser vos questions.";

const SPECS: VariantSpec[] = [
  { id: "v1", name: "Classique optimisé", strategy: "Titre complet marque + pièce + couleur + taille, description d'origine.", slot: "Dimanche 19 h – 21 h", price: "same",
    title: (c) => join(c.brand, c.piece, c.color, c.size && `– taille ${c.size}`), description: (c) => `${c.base}\n\n${FOOTER}` },
  { id: "v2", name: "Marque en premier", strategy: "Marque en majuscules, nouvelle photo de couverture, −1 €.", slot: "Lundi 19 h – 21 h", price: "minus_1",
    title: (c) => (c.brand ? join(`${c.brand.toUpperCase()} ·`, c.piece, c.size) : join(c.piece, c.size)), description: (c) => join(c.brand && `${c.brand} –`, `${c.piece}.`) + `\n${c.base}\nPièce authentique, photos réelles.` },
  { id: "v3", name: "Mots-clés de recherche", strategy: "Titre écrit comme une recherche acheteur, hashtags en fin de description.", slot: "Mercredi 12 h – 14 h", price: "same",
    title: (c) => join(c.piece, c.brand, c.keyword, c.size), description: (c) => `${c.base}\n\n${c.hashtags}` },
  { id: "v4", name: "État mis en avant", strategy: "L'état ouvre le titre et la description : rassure l'acheteur.", slot: "Jeudi 20 h – 22 h", price: "same",
    title: (c) => join(c.piece, c.brand, `– ${c.condition.toLowerCase()}`), description: (c) => `État : ${c.condition}.\n${c.base}\nMesures disponibles sur demande.` },
  { id: "v5", name: "Prix rond attractif", strategy: "Prix psychologique juste sous l'euro rond, couverture changée.", slot: "Vendredi 18 h – 20 h", price: "round",
    title: (c) => join(c.brand, c.piece, c.size, c.color), description: (c) => `${c.base}\n\nPrix ajusté, à saisir.` },
  { id: "v6", name: "Saison et tendance", strategy: "Accroche saisonnière dans le titre et l'introduction.", slot: "Samedi 10 h – 12 h", price: "same",
    title: (c) => join(c.piece, c.brand, `parfait pour ${c.season}`), description: (c) => `Parfait pour ${c.season}.\n${c.base}` },
  { id: "v7", name: "Lot et remise", strategy: "Met en avant les lots pour vendre plusieurs pièces, −5 % (plancher respecté).", slot: "Dimanche 18 h – 20 h", price: "minus_5pct",
    title: (c) => join(c.brand, c.piece, c.size, "– lot possible"), description: (c) => `${c.base}\n\nRemise sur les lots : ajoutez d'autres articles de mon dressing au panier.` },
  { id: "v8", name: "Fiche express", strategy: "Description en liste courte, lisible en 3 secondes, −3 %.", slot: "Mardi 19 h – 21 h", price: "minus_3pct",
    title: (c) => join(c.piece, c.brand, c.size, "– envoi rapide"), description: (c) => `• Marque : ${c.brand || "—"}\n• Taille : ${c.size || "—"}\n• État : ${c.condition}\n• Envoi : sous 48 h\n\n${c.base}` },
  { id: "v9", name: "Reformulation complète", strategy: "Texte réécrit, autre photo de couverture.", slot: "Samedi 17 h – 19 h", price: "same",
    title: (c) => join(c.piece, c.brand && `de la marque ${c.brand}`, c.size && `taille ${c.size}`), description: (c) => `À vendre : ${join(c.piece, c.brand)}${c.size ? `, taille ${c.size}` : ""}.\n${c.base}` },
  { id: "v10", name: "Dernier prix", strategy: "Dernière relance au prix plancher avant de retirer ou de baisser durablement.", slot: "Dimanche 20 h – 22 h", price: "floor",
    title: (c) => join(c.brand, c.piece, c.size, "– prix final"), description: (c) => `${c.base}\n\nDernière baisse avant retrait de l'annonce.` },
];

/** Plan de republication d'une annonce : 10 variantes prêtes (minimum 8), utilisées ou non. */
export function republicationPlan(item: InventoryItem, opts: { now: Date; republishAfterDays?: number }): RepublicationPlan {
  const brand = item.brand ?? "";
  const piece = pieceName(item);
  const ctx: Ctx = {
    brand,
    piece,
    size: item.size ?? "",
    color: (item.attributes.colors[0] ?? "").toLowerCase(),
    condition: ITEM_CONDITION_LABELS[item.condition],
    base: item.description.trim() || `${piece} ${brand}`.trim() + ".",
    season: season(opts.now),
    keyword: CATEGORY_KEYWORD[item.category],
    hashtags: [brand, piece.split(" ")[0] ?? "", CATEGORY_KEYWORD[item.category], item.size ? `taille${item.size}` : ""].filter(Boolean).map((t) => `#${t.toLowerCase().replace(/[^a-z0-9àâçéèêëîïôûùüÿñæœ]/gi, "")}`).join(" "),
  };
  const photos = item.photos.length;
  const variants: RepublishVariant[] = SPECS.map((spec, i) => {
    const uses = item.republications.filter((r) => r.variantId === spec.id).sort((a, b) => b.at.localeCompare(a.at));
    const lastUsed = uses[0] ?? null;
    const measured = uses.find((u) => u.after !== null) ?? null;
    return {
      id: spec.id,
      index: i + 1,
      name: spec.name,
      strategy: spec.strategy,
      title: cap(spec.title(ctx)),
      description: cleanText(spec.description(ctx)),
      priceCents: variantPrice(item, spec.price),
      photoOrder: rotate(photos, photos > 1 ? i % photos : 0),
      slot: spec.slot,
      uses: uses.length,
      lastUsed,
      result: measured?.after ?? null,
    };
  });
  const unused = variants.filter((v) => v.uses === 0);
  const measured = variants.filter((v) => v.result !== null);
  const best = measured.length ? [...measured].sort((a, b) => b.result!.views + b.result!.favorites * 10 - (a.result!.views + a.result!.favorites * 10))[0]! : null;
  const leastRecent = [...variants].sort((a, b) => (a.lastUsed?.at ?? "").localeCompare(b.lastUsed?.at ?? ""))[0] ?? null;
  const next = unused[0] ?? best ?? leastRecent;
  const days = daysOnline(item, opts.now);
  const after = opts.republishAfterDays ?? DEFAULT_REPUBLISH_AFTER_DAYS;
  return {
    variants,
    next,
    usedCount: variants.filter((v) => v.uses > 0).length,
    totalRepublications: item.republications.length,
    daysOnline: days,
    dueInDays: days === null ? null : Math.max(0, after - days),
    best,
  };
}

/** Modifications à appliquer à l'article pour publier une variante. */
export function applyVariant(item: InventoryItem, variant: RepublishVariant): InventoryItemUpdate {
  const order = variant.photoOrder.length === item.photos.length ? variant.photoOrder : item.photos.map((_, i) => i);
  return {
    title: variant.title,
    description: variant.description,
    listedPriceCents: variant.priceCents ?? item.listedPriceCents,
    photos: order.map((idx, position) => ({ ...item.photos[idx]!, position })),
  };
}

/**
 * Enregistre une republication : la variante est marquée utilisée, les
 * statistiques d'avant sont conservées et celles de la nouvelle annonce
 * repartent de zéro (une republication crée une nouvelle annonce).
 */
export function recordRepublication(item: InventoryItem, variantId: string, mode: Republication["mode"], at: string, id: string): Pick<InventoryItem, "republications" | "listingStats"> {
  const entry: Republication = { id, variantId, at, mode, before: { views: item.listingStats.views, favorites: item.listingStats.favorites }, after: null };
  return {
    republications: [...item.republications, entry].slice(-200),
    listingStats: { views: 0, favorites: 0, offers: 0, updatedAt: at },
  };
}

/** Rendement moyen de chaque variante sur tout le dressing (vues et favoris à 48 h). */
export function variantLeaderboard(items: InventoryItem[]): { variantId: string; name: string; uses: number; measured: number; avgViews: number; avgFavorites: number }[] {
  return SPECS.map((spec) => {
    const all = items.flatMap((i) => i.republications.filter((r) => r.variantId === spec.id));
    const measured = all.filter((r) => r.after !== null);
    const sum = measured.reduce((acc, r) => ({ v: acc.v + r.after!.views, f: acc.f + r.after!.favorites }), { v: 0, f: 0 });
    return { variantId: spec.id, name: spec.name, uses: all.length, measured: measured.length, avgViews: measured.length ? Math.round(sum.v / measured.length) : 0, avgFavorites: measured.length ? Math.round((sum.f / measured.length) * 10) / 10 : 0 };
  });
}

export const REPUBLISH_VARIANT_NAMES: Record<string, string> = Object.fromEntries(SPECS.map((s) => [s.id, s.name]));
