import { bundleSettings as bundleSettingsSchema, type BundleOfferPolicy, type BundleSettings, type InventoryItem, type MarginRules, type NegotiationAutomation } from "@selio/contracts";
import { hashString } from "./ids";
import { daysOnline } from "./online";
import { endToEndMargin } from "./margin";
import { applyRate, ratio, type Cents } from "./money";
import { bundlePolicyFor, lotFloorCents } from "./negotiation-lots";

/**
 * Lots intelligents (§5.14) : propositions de lots à partir de règles EXPLICITES, sans IA :
 * 1. le même acheteur a ouvert des conversations sur ≥ 2 articles en ligne ;
 * 2. plusieurs articles de la même marque et de la même taille ;
 * 3. des articles anciens (en ligne depuis plus de N jours, 60 par défaut).
 * La remise proposée est celle de la politique de lot (2 articles, 3 et plus), bornée par le PLANCHER DE
 * LOT calculé par la politique de négociation (`lotFloorCents`, negotiation-lots.ts : jamais sous la
 * somme des planchers réels des articles) ; un lot ne descend jamais dessous. La marge projetée vient de
 * `endToEndMargin`. Ici on PROPOSE ; répondre à une offre de lot reste la décision de la politique de
 * négociation (`evaluateBundleOffer`), jamais de l'IA.
 */

export type BundleReason = "same_buyer" | "same_brand_size" | "stale";
export const BUNDLE_REASON_LABELS: Record<BundleReason, string> = {
  same_buyer: "Même acheteur intéressé par plusieurs articles",
  same_brand_size: "Même marque et même taille",
  stale: "Articles en ligne depuis longtemps",
};

export type BundleItem = Pick<InventoryItem, "id" | "title" | "brand" | "size" | "category" | "status" | "listedPriceCents" | "floorPriceCents" | "purchasePriceCents" | "purchaseFeesCents" | "listedAt" | "createdAt" | "republications"> & Partial<Pick<InventoryItem, "connectionId">>;

/** Un lot Vinted ne réunit jamais deux vendeurs : les regroupements se font par compte Vinted. */
const accountKey = (it: BundleItem) => it.connectionId ?? "";

/** Conversations ouvertes par un acheteur : les articles qui l'intéressent. */
export interface BuyerInterest {
  customerId: string;
  itemIds: string[];
}

export interface BundleSignals {
  buyerInterest?: readonly BuyerInterest[];
  /** Regrouper par marque et taille (vrai par défaut). */
  brandAffinity?: boolean;
  /** Exiger la même taille dans un lot de marque (vrai par défaut) ; faux : la marque seule suffit. */
  sizeAffinity?: boolean;
  /** Âge (jours en ligne) à partir duquel un article est « ancien » ; défaut : réglage `staleAfterDays`. */
  ageDays?: number;
}

/** Remises de lot proposées spontanément : `automation.negotiation.lot`. */
export type LotDiscountPolicy = NegotiationAutomation["lot"];
/** Borne de la politique quand un acheteur fait une offre sur un lot : `automation.negotiation.bundle` (plancher de lot). */
export type BundleFloorPolicy = Pick<BundleOfferPolicy, "maxDiscountRate">;
/** Sans borne de remise de lot, le plancher de lot est la somme des planchers réels. */
export const FLOOR_SUM_ONLY: BundleFloorPolicy = { maxDiscountRate: 1 };

/**
 * Plancher d'un lot proposé : délégué à la politique de négociation (`lotFloorCents`) pour que la
 * proposition et l'évaluation d'une offre de lot partagent exactement la même borne.
 */
export function suggestedBundleFloorCents(items: readonly Pick<BundleItem, "purchasePriceCents" | "purchaseFeesCents" | "listedPriceCents" | "floorPriceCents">[], rules: MarginRules, policy: BundleFloorPolicy = FLOOR_SUM_ONLY): Cents {
  return lotFloorCents(items, rules, policy).floorCents;
}

export interface BundleSuggestion {
  id: string;
  reason: BundleReason;
  label: string;
  itemIds: string[];
  /** Acheteur à l'origine de la proposition (règle 1), sinon null. */
  customerId: string | null;
  listedTotalCents: Cents;
  /** Plancher de lot (politique de négociation) : jamais sous la somme des planchers réels des articles. */
  floorCents: Cents;
  /** Remise retenue : taux de la politique, abaissé si le plancher de lot l'exige. */
  suggestedDiscountRate: number;
  /** Vrai si la remise de la politique a dû être réduite pour respecter le plancher de lot. */
  discountCapped: boolean;
  bundlePriceCents: Cents;
  projectedMarginCents: Cents;
  projectedMarginRate: number;
}

export interface SuggestBundlesInput {
  items: readonly BundleItem[];
  signals?: BundleSignals;
  /** Remises de lot (2 articles, 3 et plus) et borne de remise de lot (plancher de lot). */
  negotiation: Pick<NegotiationAutomation, "lot"> & Partial<Pick<NegotiationAutomation, "bundle">>;
  rules: MarginRules;
  settings?: BundleSettings;
  now: Date;
}

/** Taux de remise de la politique selon le nombre d'articles (0 si la politique de lot est désactivée). */
export function policyBundleRate(policy: LotDiscountPolicy, count: number): number {
  if (!policy.enabled || count < 2) return 0;
  return count === 2 ? policy.twoItemsRate : policy.threePlusRate;
}

/**
 * Remise bornée par le plancher de lot : jamais plus que ce qui laisse le prix du lot au-dessus de la somme
 * des planchers. `capped` dit si la politique a été abaissée.
 */
export function boundedBundleDiscount(listedTotalCents: Cents, floorCents: Cents, wantedRate: number): { rate: number; capped: boolean } {
  if (listedTotalCents <= 0) return { rate: 0, capped: wantedRate > 0 };
  const maxRate = Math.max(0, (listedTotalCents - floorCents) / listedTotalCents);
  if (wantedRate <= maxRate) return { rate: wantedRate, capped: false };
  return { rate: Math.floor(maxRate * 1000) / 1000, capped: true };
}

/** Prix d'un lot après remise, arrondi, jamais sous le plancher de lot. */
export function bundlePriceCents(listedTotalCents: Cents, floorCents: Cents, rate: number): Cents {
  return Math.max(floorCents, listedTotalCents - applyRate(listedTotalCents, rate));
}

const eligible = (it: BundleItem): boolean => (it.status === "listed" || it.status === "in_stock") && it.listedPriceCents !== null && it.listedPriceCents > 0;

/** Âge d'un article : jours en ligne (dernière mise en ligne), sinon jours depuis sa création (en stock). */
export function bundleItemAgeDays(item: Pick<BundleItem, "listedAt" | "republications" | "createdAt">, now: Date): number {
  return daysOnline(item, now) ?? Math.max(0, Math.floor((now.getTime() - new Date(item.createdAt).getTime()) / 86_400_000));
}

const norm = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Construit une proposition pour un jeu d'articles (null si moins de 2 articles ou lot impossible). */
export function buildBundle(items: readonly BundleItem[], reason: BundleReason, ctx: { policy: LotDiscountPolicy; floorPolicy?: BundleFloorPolicy | ((itemCount: number) => BundleFloorPolicy); rules: MarginRules; customerId?: string | null; label?: string }): BundleSuggestion | null {
  const list = items.filter(eligible);
  if (list.length < 2) return null;
  const listedTotalCents = list.reduce((s, it) => s + (it.listedPriceCents ?? 0), 0);
  const floorPolicy = typeof ctx.floorPolicy === "function" ? ctx.floorPolicy(list.length) : ctx.floorPolicy ?? FLOOR_SUM_ONLY;
  const floorCents = suggestedBundleFloorCents(list, ctx.rules, floorPolicy);
  const wanted = policyBundleRate(ctx.policy, list.length);
  const { rate, capped } = boundedBundleDiscount(listedTotalCents, floorCents, wanted);
  const price = bundlePriceCents(listedTotalCents, floorCents, rate);
  const margin = endToEndMargin({
    purchase: { priceCents: list.reduce((s, it) => s + it.purchasePriceCents, 0), shippingCents: 0, buyerFeesCents: list.reduce((s, it) => s + it.purchaseFeesCents, 0) },
    listing: { listedPriceCents: price },
  });
  const ids = list.map((it) => it.id).sort();
  return {
    id: `bundle-${reason}-${hashString(ids.join("|")).toString(36)}`,
    reason,
    label: ctx.label ?? BUNDLE_REASON_LABELS[reason],
    itemIds: list.map((it) => it.id),
    customerId: ctx.customerId ?? null,
    listedTotalCents,
    floorCents,
    suggestedDiscountRate: rate,
    discountCapped: capped,
    bundlePriceCents: price,
    projectedMarginCents: margin.marginCents,
    projectedMarginRate: ratio(margin.marginCents, price),
  };
}

/**
 * Propositions de lots, règles explicites dans l'ordre de priorité : même acheteur, puis même marque et
 * taille, puis articles anciens. Un article ne figure que dans une proposition par règle, et une
 * proposition « marque et taille » ou « anciens » ne reprend pas un article déjà proposé à un acheteur.
 */
export function suggestBundles(input: SuggestBundlesInput): BundleSuggestion[] {
  const settings = input.settings ?? bundleSettingsSchema.parse({});
  if (!settings.enabled) return [];
  const signals = input.signals ?? {};
  const { lot, bundle } = input.negotiation;
  // Même borne que l'évaluation d'une offre de lot (`bundlePolicyFor`) : remise maximale de lot, au moins la remise proposée.
  const floorPolicy = bundle ? (count: number): BundleFloorPolicy => bundlePolicyFor({ lot, bundle }, count) : FLOOR_SUM_ONLY;
  const ctx = { policy: lot, floorPolicy, rules: input.rules };
  const byId = new Map<string, BundleItem>();
  for (const it of input.items) if (eligible(it)) byId.set(it.id, it);
  const out: BundleSuggestion[] = [];
  const used = new Set<string>();
  const push = (b: BundleSuggestion | null) => {
    if (b && out.length < settings.maxSuggestions) {
      out.push(b);
      for (const id of b.itemIds) used.add(id);
    }
  };

  // 1. Même acheteur intéressé par au moins `sameBuyerMinItems` articles en ligne.
  for (const interest of signals.buyerInterest ?? []) {
    const found = [...new Set(interest.itemIds)].map((id) => byId.get(id)).filter((it): it is BundleItem => Boolean(it));
    // Même compte Vinted que le premier article (celui de la conversation la plus récente).
    const items = found.filter((it) => accountKey(it) === accountKey(found[0] ?? it)).slice(0, settings.maxItems);
    if (items.length < settings.sameBuyerMinItems) continue;
    push(buildBundle(items, "same_buyer", { ...ctx, customerId: interest.customerId, label: `${BUNDLE_REASON_LABELS.same_buyer} (${items.length} articles)` }));
  }

  // 2. Même marque (et même taille, sauf si sizeAffinity est faux), parmi les articles non encore proposés.
  if (signals.brandAffinity !== false) {
    const groups = new Map<string, BundleItem[]>();
    for (const it of byId.values()) {
      if (used.has(it.id) || !it.brand) continue;
      const key = `${accountKey(it)}|${signals.sizeAffinity === false ? norm(it.brand) : `${norm(it.brand)}|${norm(it.size)}`}`;
      if (signals.sizeAffinity !== false && !it.size) continue;
      groups.set(key, [...(groups.get(key) ?? []), it]);
    }
    for (const group of [...groups.values()].sort((a, b) => b.length - a.length)) {
      if (group.length < 2) continue;
      const items = group.sort((a, b) => a.id.localeCompare(b.id)).slice(0, settings.maxItems);
      const first = items[0]!;
      const label = signals.sizeAffinity === false ? `Même marque : ${first.brand}` : `Même marque et taille : ${first.brand}, ${first.size}`;
      push(buildBundle(items, "same_brand_size", { ...ctx, label }));
    }
  }

  // 3. Articles anciens (en ligne depuis plus de `ageDays`), regroupés par catégorie.
  const ageDays = signals.ageDays ?? settings.staleAfterDays;
  const stale = [...byId.values()].filter((it) => !used.has(it.id) && bundleItemAgeDays(it, input.now) > ageDays);
  const byCategory = new Map<string, BundleItem[]>();
  for (const it of stale) byCategory.set(`${accountKey(it)}|${it.category}`, [...(byCategory.get(`${accountKey(it)}|${it.category}`) ?? []), it]);
  for (const group of [...byCategory.values()].sort((a, b) => b.length - a.length)) {
    const items = group.sort((a, b) => bundleItemAgeDays(b, input.now) - bundleItemAgeDays(a, input.now)).slice(0, settings.maxItems);
    if (items.length < 2) continue;
    push(buildBundle(items, "stale", { ...ctx, label: `${BUNDLE_REASON_LABELS.stale} (plus de ${ageDays} jours)` }));
  }
  return out;
}
