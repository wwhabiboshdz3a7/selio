import type { BuyerFees, InventoryItem, MarginRules, Opportunity, Order } from "@selio/contracts";
import type { Period } from "./analytics";
import { purchaseCost } from "./buying";
import { applyRate, assertCents, ratio, type Cents } from "./money";
import { countsAsRevenue } from "./orders";

/**
 * Marge de bout en bout (§5.14) : du prix d'achat (Radar, achat assisté ou saisie) jusqu'à la revente,
 * en passant par le prix affiché. Tout est en centimes entiers. Une marge est « projetée » tant que
 * l'article n'est pas vendu (revenu = prix affiché) et « réalisée » une fois la vente connue (revenu =
 * prix de vente, frais vendeur et port à charge vendeur déduits). Marge brute opérationnelle, pas un
 * bénéfice net (ni impôts, ni cotisations).
 */

export interface MarginPurchase {
  /** Prix payé pour l'article. */
  priceCents: Cents;
  /** Port payé à l'achat. */
  shippingCents?: Cents;
  /** Frais acheteur payés à l'achat (protection acheteurs…). */
  buyerFeesCents?: Cents;
}

export interface MarginListing {
  listedPriceCents: Cents | null;
}

export interface MarginSale {
  salePriceCents: Cents;
  /** Frais prélevés au vendeur par la plateforme (0 sur Vinted). */
  sellerFeesCents?: Cents;
  /** Port à la charge du vendeur (0 si payé par l'acheteur). */
  shippingPaidBySellerCents?: Cents;
}

export interface MarginCosts {
  packagingCents?: Cents;
  otherCents?: Cents;
}

export interface EndToEndMarginInput {
  purchase: MarginPurchase;
  listing?: MarginListing | null;
  sale?: MarginSale | null;
  /**
   * Marge projetée (pas de vente) : frais attendus à la vente, comme `projectedMargin` (Stock, fiche
   * article) : commission par défaut de la plateforme et port par défaut. Ignoré pour une vente.
   */
  expectedSale?: Pick<MarginSale, "sellerFeesCents" | "shippingPaidBySellerCents"> | null;
  costs?: MarginCosts | null;
}

export type MarginStatus = "projected" | "realized";

export interface MarginBreakdownDetail {
  purchaseCents: Cents;
  purchaseShippingCents: Cents;
  buyerFeesCents: Cents;
  sellerFeesCents: Cents;
  shippingPaidBySellerCents: Cents;
  packagingCents: Cents;
  otherCents: Cents;
}

export interface EndToEndMargin {
  status: MarginStatus;
  /** Tout ce qui a été ou sera dépensé : achat, port, frais, emballage, autres, et pour une vente les frais vendeur. */
  costCents: Cents;
  /** Prix de vente (réalisée) ou prix affiché (projetée) ; 0 quand aucun prix n'est connu. */
  revenueCents: Cents;
  marginCents: Cents;
  /** Marge / revenu (0 sans revenu). */
  marginRate: number;
  /** Faux quand la marge projetée n'a aucun prix affiché : la marge vaut alors − coût. */
  priceKnown: boolean;
  breakdown: MarginBreakdownDetail;
}

const nn = (v: Cents | undefined, label: string): Cents => {
  const c = assertCents(v ?? 0, label);
  if (c < 0) throw new RangeError(`${label} ne peut pas être négatif (reçu ${c})`);
  return c;
};

export function endToEndMargin(input: EndToEndMarginInput): EndToEndMargin {
  const breakdown: MarginBreakdownDetail = {
    purchaseCents: nn(input.purchase.priceCents, "prix d'achat"),
    purchaseShippingCents: nn(input.purchase.shippingCents, "port d'achat"),
    buyerFeesCents: nn(input.purchase.buyerFeesCents, "frais acheteur"),
    sellerFeesCents: nn(input.sale ? input.sale.sellerFeesCents : input.expectedSale?.sellerFeesCents, "frais vendeur"),
    shippingPaidBySellerCents: nn(input.sale ? input.sale.shippingPaidBySellerCents : input.expectedSale?.shippingPaidBySellerCents, "port vendeur"),
    packagingCents: nn(input.costs?.packagingCents, "emballage"),
    otherCents: nn(input.costs?.otherCents, "autres coûts"),
  };
  const sale = input.sale ?? null;
  const status: MarginStatus = sale ? "realized" : "projected";
  const revenueCents = sale ? nn(sale.salePriceCents, "prix de vente") : input.listing?.listedPriceCents != null ? nn(input.listing.listedPriceCents, "prix affiché") : 0;
  const priceKnown = sale !== null || (input.listing?.listedPriceCents ?? null) !== null;
  const costCents =
    breakdown.purchaseCents + breakdown.purchaseShippingCents + breakdown.buyerFeesCents + breakdown.packagingCents + breakdown.otherCents + breakdown.sellerFeesCents + breakdown.shippingPaidBySellerCents;
  const marginCents = revenueCents - costCents;
  return { status, costCents, revenueCents, marginCents, marginRate: ratio(marginCents, revenueCents), priceKnown, breakdown };
}

/**
 * Entrée de marge d'un article Manager, avec sa commande payée si elle existe (marge réalisée). Même
 * règles que le reste de Selio :
 * - vente : l'INSTANTANÉ de la commande (prix et frais d'achat enregistrés à la vente, comme `orderMargin`
 *   dans « CA et marge brute ») ; une correction ultérieure du prix d'achat de l'article ne change pas une
 *   vente passée ;
 * - stock : les frais attendus à la vente déduits par la même règle que `projectedMargin` (Stock, fiche
 *   article) quand les règles de marge sont fournies.
 */
export function marginInputFromItem(
  item: Pick<InventoryItem, "purchasePriceCents" | "purchaseFeesCents" | "listedPriceCents">,
  order?: Pick<Order, "status" | "salePriceCents" | "platformFeeCents" | "shippingCostCents" | "otherCostsCents"> & Partial<Pick<Order, "purchasePriceCents" | "purchaseFeesCents">> | null,
  costs?: MarginCosts | null,
  rules?: Pick<MarginRules, "defaultPlatformFeeRate" | "defaultShippingCostCents"> | null,
): EndToEndMarginInput {
  const sold = order && countsAsRevenue(order.status) ? order : null;
  const purchasePriceCents = sold?.purchasePriceCents ?? item.purchasePriceCents;
  const purchaseFeesCents = sold?.purchaseFeesCents ?? item.purchaseFeesCents;
  const listed = item.listedPriceCents;
  return {
    // Les frais d'acquisition de Manager (port entrant, nettoyage…) sont rangés avec les frais d'achat.
    purchase: { priceCents: purchasePriceCents, shippingCents: 0, buyerFeesCents: purchaseFeesCents },
    listing: { listedPriceCents: listed },
    sale: sold ? { salePriceCents: sold.salePriceCents, sellerFeesCents: sold.platformFeeCents, shippingPaidBySellerCents: sold.shippingCostCents } : null,
    expectedSale: !sold && rules && listed !== null ? { sellerFeesCents: applyRate(listed, rules.defaultPlatformFeeRate), shippingPaidBySellerCents: rules.defaultShippingCostCents } : null,
    costs: { packagingCents: costs?.packagingCents ?? 0, otherCents: (costs?.otherCents ?? 0) + (sold?.otherCostsCents ?? 0) },
  };
}

/** Entrée de marge d'une affaire Radar : coût total d'achat (prix, port, protection acheteurs) et revente estimée comme prix affiché. */
export function marginInputFromOpportunity(observed: Pick<Opportunity["observed"], "priceCents" | "shippingCents">, resaleCents: Cents | null, fees?: BuyerFees | null, costs?: MarginCosts | null): EndToEndMarginInput {
  const cost = purchaseCost(observed, fees);
  return {
    purchase: { priceCents: cost.itemCents, shippingCents: cost.shippingCents, buyerFeesCents: cost.protectionCents },
    listing: { listedPriceCents: resaleCents },
    sale: null,
    costs: costs ?? null,
  };
}

// ----------------------------------------------------------------- agrégation par période

export interface MarginTotals {
  count: number;
  /** Articles dont le prix est connu (les autres n'ont ni revenu ni marge mesurable). */
  pricedCount: number;
  costCents: Cents;
  revenueCents: Cents;
  marginCents: Cents;
  marginRate: number;
}

export const EMPTY_MARGIN_TOTALS: MarginTotals = { count: 0, pricedCount: 0, costCents: 0, revenueCents: 0, marginCents: 0, marginRate: 0 };

export function marginTotals(list: Iterable<EndToEndMargin>): MarginTotals {
  const t = { ...EMPTY_MARGIN_TOTALS };
  for (const m of list) {
    t.count++;
    if (m.priceKnown) t.pricedCount++;
    t.costCents += m.costCents;
    t.revenueCents += m.revenueCents;
    t.marginCents += m.marginCents;
  }
  t.marginRate = ratio(t.marginCents, t.revenueCents);
  return t;
}

/** Une marge datée : date de vente (réalisée) ou de mise en ligne / création (projetée). */
export interface DatedMargin {
  itemId: string;
  at: string | null;
  margin: EndToEndMargin;
}

export interface MarginsByPeriod {
  /** Ventes de la période (marges réalisées, datées par la vente). */
  sold: MarginTotals;
  /** Stock actuel (marges projetées) : photographie, jamais filtrée par la période. */
  inStock: MarginTotals;
  all: MarginTotals;
}

function inPeriod(at: string | null, period: Period): boolean {
  if (!at) return false;
  const t = new Date(at).getTime();
  return t >= period.from.getTime() && t < period.to.getTime();
}

/** Agrège vendus / en stock ; sans période, toutes les ventes comptent. */
export function marginsByPeriod(entries: Iterable<DatedMargin>, period?: Period): MarginsByPeriod {
  const sold: EndToEndMargin[] = [];
  const inStock: EndToEndMargin[] = [];
  for (const e of entries) {
    if (e.margin.status === "realized") {
      if (!period || inPeriod(e.at, period)) sold.push(e.margin);
    } else {
      inStock.push(e.margin);
    }
  }
  return { sold: marginTotals(sold), inStock: marginTotals(inStock), all: marginTotals([...sold, ...inStock]) };
}

/**
 * Marges datées des articles d'une organisation : un article vendu prend sa commande qui compte dans le
 * CA (la plus récente), les autres articles actifs sont projetés ; les archivés sont ignorés.
 */
export function itemMargins(items: Iterable<InventoryItem>, orders: Iterable<Order>, costs?: MarginCosts | null, rules?: Pick<MarginRules, "defaultPlatformFeeRate" | "defaultShippingCostCents"> | null): DatedMargin[] {
  const byItem = new Map<string, Order>();
  for (const o of orders) {
    if (!countsAsRevenue(o.status)) continue;
    const prev = byItem.get(o.itemId);
    if (!prev || new Date(o.createdAt).getTime() > new Date(prev.createdAt).getTime()) byItem.set(o.itemId, o);
  }
  const out: DatedMargin[] = [];
  for (const it of items) {
    if (it.status === "archived") continue;
    const order = byItem.get(it.id) ?? null;
    if (it.status === "sold" && !order) continue;
    const margin = endToEndMargin(marginInputFromItem(it, order, costs, rules));
    out.push({ itemId: it.id, at: order ? order.createdAt : it.listedAt ?? it.createdAt, margin });
  }
  return out;
}
