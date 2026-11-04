import { z } from "zod";

/**
 * Panneau « Comparables Selio » (Selio Track, Pro et Agence) : contrat entre le content script, le
 * service worker et `POST /api/ext/comparables`.
 *
 * - Seuls les champs de l'ARTICLE partent vers Selio : titre, marque, catégorie, taille, état, prix
 *   affiché. Jamais le pseudo du vendeur, les photos, la description, l'adresse ni la référence de
 *   l'annonce, ni rien d'autre de la page. Le schéma est strict : une clé de plus est refusée.
 * - La catégorie n'est pas lue par l'adaptateur `vinted-dom-v1` : elle part à null et Selio cherche
 *   alors les comparables dans toutes les catégories.
 * - Le service worker reste le seul détenteur du jeton ; le content script ne reçoit que des données
 *   d'affichage, revalidées par `comparablesResponse`.
 *
 * Les listes et libellés ci-dessous sont le miroir de `@selio/contracts` (pricing.ts, inventory.ts,
 * track.ts) : le content script n'embarque pas tout le paquet des contrats. Un test vérifie qu'ils
 * restent identiques.
 */

export const ITEM_CATEGORIES = ["women", "men", "kids", "shoes", "bags", "accessories", "home", "electronics", "other"] as const;
export const ITEM_CONDITIONS = ["new_with_tags", "new_without_tags", "very_good", "good", "satisfactory"] as const;
export const PRICE_METHODS = ["embeddings", "comparables", "model", "blend", "none"] as const;
export type PriceMethod = (typeof PRICE_METHODS)[number];
export const PRICE_CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
export type PriceConfidenceLevel = (typeof PRICE_CONFIDENCE_LEVELS)[number];

export const PRICE_METHOD_LABELS: Record<PriceMethod, string> = {
  embeddings: "Ventes proches (similarité des titres)",
  comparables: "Ventes de même marque et catégorie",
  model: "Modèle de prix",
  blend: "Ventes comparables et modèle de prix",
  none: "Pas assez de références",
};

export const PRICE_STRATEGY_LABELS = { fast: "Vente rapide", standard: "Standard", max: "Marge maximale" } as const;
export const PRICE_NOT_ENOUGH_REFERENCES = "Pas assez de références pour proposer un prix : fixez-le à la main.";
export const PRICE_MODEL_DEMO_DATA = "Données de démonstration";
export const TRACK_UNAVAILABLE_MESSAGE = "Track est compris à partir de Pro";

export const ITEM_CONDITION_LABELS: Record<(typeof ITEM_CONDITIONS)[number], string> = {
  new_with_tags: "Neuf avec étiquette",
  new_without_tags: "Neuf sans étiquette",
  very_good: "Très bon état",
  good: "Bon état",
  satisfactory: "Satisfaisant",
};

export const CONFIDENCE_LABELS: Record<PriceConfidenceLevel, string> = { low: "faible", medium: "moyenne", high: "élevée" };

/** Les seuls champs envoyés à Selio, dans cet ordre (affichés aussi dans le panneau). */
export const COMPARABLES_FIELDS = ["title", "brand", "category", "size", "condition", "priceCents"] as const;

const text = (max: number) => z.string().trim().min(1).max(max);

/** Article envoyé pour les comparables : strict, aucune autre donnée de la page. */
export const comparablesRequest = z
  .object({
    title: text(200),
    brand: text(80).nullable(),
    category: z.enum(ITEM_CATEGORIES).nullable(),
    size: text(40).nullable(),
    condition: z.enum(ITEM_CONDITIONS).nullable(),
    priceCents: z.number().int().min(0).max(10_000_000).nullable(),
  })
  .strict();
export type ComparablesRequest = z.infer<typeof comparablesRequest>;

const clip = (v: string | null | undefined, max: number): string | null => {
  const t = (v ?? "").replace(/\s+/g, " ").trim().slice(0, max).trim();
  return t ? t : null;
};

/**
 * Construit la demande à partir de l'article lu par l'adaptateur : recopie les six champs autorisés et
 * rien d'autre, même si l'objet reçu en porte davantage (pseudo, photos, description, adresse…).
 */
export function buildComparablesRequest(item: {
  title: string;
  brand: string | null;
  size: string | null;
  condition: string | null;
  priceCents: number | null;
  category?: string | null;
}): ComparablesRequest {
  const category = (ITEM_CATEGORIES as readonly string[]).includes(item.category ?? "") ? (item.category as ComparablesRequest["category"]) : null;
  const condition = (ITEM_CONDITIONS as readonly string[]).includes(item.condition ?? "") ? (item.condition as ComparablesRequest["condition"]) : null;
  const price = item.priceCents;
  return {
    title: clip(item.title, 200) ?? "",
    brand: clip(item.brand, 80),
    category,
    size: clip(item.size, 40),
    condition,
    priceCents: typeof price === "number" && Number.isInteger(price) && price >= 0 && price <= 10_000_000 ? price : null,
  };
}

const cents = z.number().int().min(0);

/** Réponse de `POST /api/ext/comparables` gardée pour l'affichage (le reste est ignoré). */
export const comparablesResponse = z.object({
  p25: cents.nullable(),
  p50: cents.nullable(),
  p75: cents.nullable(),
  delayDays: z.number().min(0).max(3650).nullable(),
  confidenceLevel: z.enum(PRICE_CONFIDENCE_LEVELS),
  method: z.enum(PRICE_METHODS),
  strategies: z.object({ fast: cents, standard: cents, max: cents }).nullable(),
  comparableCount: z.number().int().min(0),
  modelVersion: z.string().max(80).nullable().optional(),
  demo: z.boolean().default(false),
  message: z.string().max(300).nullable().default(null),
  priceCheck: z
    .object({ priceCents: cents.nullable(), position: z.enum(["below", "within", "above"]).nullable() })
    .nullable()
    .default(null),
});
export type ComparablesResponse = z.infer<typeof comparablesResponse>;

/** Codes d'erreur normalisés par le service worker pour le panneau. */
export const COMPARABLES_ERROR_CODES = ["offline", "unpaired", "track_unavailable", "rate_limited", "invalid_response"] as const;

export const COMPARABLES_MESSAGES = {
  offline: "Hors ligne : Selio est injoignable. Vérifiez votre connexion (ou l'adresse de l'API dans les options), puis réessayez.",
  unpaired: "Extension non reliée à Selio : ouvrez les options de l'extension et collez un jeton créé dans Selio › Comptes Vinted.",
  revoked: "Jeton refusé (révoqué ou expiré) : reliez à nouveau l'extension depuis ses options.",
  trackDetail: "Les comparables du panneau font partie de Selio Track, compris dans les offres Pro et Agence.",
  rateLimited: "Trop de demandes de comparables : réessayez dans une minute.",
  invalid: "Réponse inattendue de Selio : les comparables ne peuvent pas être affichés.",
} as const;

/** Ce que le panneau affiche. */
export type ComparablesView =
  | { state: "loading" }
  | { state: "ready"; data: ComparablesResponse }
  | { state: "offline"; message: string }
  | { state: "unpaired"; message: string }
  | { state: "track_unavailable"; message: string }
  | { state: "error"; message: string };

/** Réponse du service worker → état du panneau. */
export function comparablesView(res: { ok: true; data: unknown } | { ok: false; code: string; message: string }): ComparablesView {
  if (res.ok) {
    const parsed = comparablesResponse.safeParse(res.data);
    return parsed.success ? { state: "ready", data: parsed.data } : { state: "error", message: COMPARABLES_MESSAGES.invalid };
  }
  switch (res.code) {
    case "offline":
    case "network":
      return { state: "offline", message: COMPARABLES_MESSAGES.offline };
    case "unpaired":
    case "unauthorized":
      return { state: "unpaired", message: res.message || COMPARABLES_MESSAGES.unpaired };
    case "track_unavailable":
      return { state: "track_unavailable", message: TRACK_UNAVAILABLE_MESSAGE };
    case "rate_limited":
      return { state: "error", message: COMPARABLES_MESSAGES.rateLimited };
    default:
      return { state: "error", message: res.message || "Comparables indisponibles pour le moment." };
  }
}

/** Montant en euros (fr-FR), « — » sans valeur. */
export function formatEuros(c: number | null | undefined): string {
  return c === null || c === undefined ? "—" : (c / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}
