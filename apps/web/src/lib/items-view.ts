import { ITEM_CATEGORY_LABELS, type InventoryQuery, type ItemCategory, type ItemStatus } from "@selio/contracts";

/**
 * « Articles et stock » : lecture des filtres dans l'adresse (partageable, gardée au retour) et raccourcis
 * clavier simples (« / » pour chercher, « n » pour un nouvel article, Échap pour vider la sélection).
 */

export const ITEMS_PAGE_SIZE = 24;

export const MARGIN_FILTER_LABELS: Record<NonNullable<InventoryQuery["margin"]>, string> = {
  negative: "Marge négative",
  low: "Marge faible",
  good: "Bonne marge",
};

/** Filtres de la page lus dans l'adresse. */
export function itemsQueryFromParams(params: URLSearchParams): Partial<InventoryQuery> {
  const online = params.get("online");
  const margin = params.get("margin");
  return {
    q: params.get("q") || undefined,
    status: (params.get("status") as ItemStatus) || undefined,
    category: (params.get("category") as ItemCategory) || undefined,
    brand: params.get("brand") || undefined,
    connectionId: params.get("account") || undefined,
    photos: params.get("photos") === "none" ? "none" : undefined,
    margin: margin === "negative" || margin === "low" || margin === "good" ? margin : undefined,
    sort: (params.get("sort") as InventoryQuery["sort"]) || "updated_desc",
    minDaysOnline: online && Number.isFinite(Number(online)) ? Number(online) : undefined,
    page: Math.max(1, Number(params.get("page") ?? 1) || 1),
    pageSize: ITEMS_PAGE_SIZE,
  };
}

/** Filtres actifs (hors recherche, statut et tri), pour les puces « × » et « Effacer les filtres ». */
export function activeItemFilters(params: URLSearchParams, names: { accounts?: Record<string, string> } = {}): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const category = params.get("category") as ItemCategory | null;
  if (category) out.push({ key: "category", label: ITEM_CATEGORY_LABELS[category] ?? category });
  const brand = params.get("brand");
  if (brand) out.push({ key: "brand", label: brand });
  const account = params.get("account");
  if (account) out.push({ key: "account", label: names.accounts?.[account] ?? "Compte Vinted" });
  if (params.get("photos") === "none") out.push({ key: "photos", label: "Sans photo" });
  const online = params.get("online");
  if (online) out.push({ key: "online", label: `En ligne depuis ${online} j ou plus` });
  const margin = params.get("margin") as keyof typeof MARGIN_FILTER_LABELS | null;
  if (margin && MARGIN_FILTER_LABELS[margin]) out.push({ key: "margin", label: MARGIN_FILTER_LABELS[margin] });
  return out;
}

/** Vrai si l'élément reçoit déjà la frappe (champ, zone de texte, liste, contenu modifiable). */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || typeof (el as HTMLElement).tagName !== "string") return false;
  const node = el as HTMLElement;
  const tag = node.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || node.isContentEditable === true;
}

export type ItemsKeyAction = "search" | "new" | "clear";

/** Raccourci clavier de la page, ou null (jamais pendant une saisie, jamais avec Ctrl, Alt ou Cmd). */
export function itemsKeyAction(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "target">): ItemsKeyAction | null {
  if (e.key === "Escape") return "clear";
  if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return null;
  if (e.key === "/") return "search";
  if (e.key === "n" || e.key === "N") return "new";
  return null;
}
