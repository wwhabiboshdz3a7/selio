import type { AutoBuySettings, BuyerFees, Opportunity } from "@selio/contracts";
import { applyRate, ratio, type Cents } from "./money";

/**
 * Coût réel d'un achat côté acheteur : prix + port + frais acheteur
 * (ex. protection acheteurs Vinted : part fixe + pourcentage du prix).
 */
export interface PurchaseCost {
  itemCents: Cents;
  shippingCents: Cents;
  protectionCents: Cents;
  totalCents: Cents;
}

export const DEFAULT_BUYER_FEES: BuyerFees = { fixedCents: 70, rate: 0.05 };

export function buyerProtectionCents(priceCents: Cents, fees: BuyerFees | null | undefined): Cents {
  if (!fees) return 0;
  return fees.fixedCents + applyRate(priceCents, fees.rate);
}

export function purchaseCost(observed: { priceCents: Cents; shippingCents: Cents }, fees?: BuyerFees | null): PurchaseCost {
  const protectionCents = buyerProtectionCents(observed.priceCents, fees);
  return {
    itemCents: observed.priceCents,
    shippingCents: observed.shippingCents,
    protectionCents,
    totalCents: observed.priceCents + observed.shippingCents + protectionCents,
  };
}

/** Lecture complète d'une affaire : achat total, revente, bénéfice et marges. */
export interface DealEconomics extends PurchaseCost {
  resaleCents: Cents;
  sellerFeesCents: Cents;
  profitCents: Cents;
  /** Bénéfice / prix de revente. */
  marginRate: number;
  /** Bénéfice / coût total d'achat (rentabilité de la mise). */
  roi: number;
}

export function dealEconomics(observed: { priceCents: Cents; shippingCents: Cents }, resaleCents: Cents, fees?: BuyerFees | null, sellerFeesCents: Cents = 0): DealEconomics {
  const cost = purchaseCost(observed, fees);
  const profitCents = resaleCents - sellerFeesCents - cost.totalCents;
  return { ...cost, resaleCents, sellerFeesCents, profitCents, marginRate: ratio(profitCents, resaleCents), roi: ratio(profitCents, cost.totalCents) };
}

/** Grille de lecture du score sur 100 (retours démo du 13/10). */
export interface ScoreBand {
  key: "weak" | "fair" | "good" | "great" | "exceptional";
  min: number;
  max: number;
  label: string;
  advice: string;
}

export const SCORE_BANDS: readonly ScoreBand[] = [
  { key: "weak", min: 0, max: 59, label: "Affaire faible", advice: "Ignorer" },
  { key: "fair", min: 60, max: 74, label: "Correcte", advice: "À regarder si on a le temps" },
  { key: "good", min: 75, max: 84, label: "Bonne affaire", advice: "À valider à la main" },
  { key: "great", min: 85, max: 94, label: "Très bonne affaire", advice: "Seuil conseillé pour l'achat auto" },
  { key: "exceptional", min: 95, max: 100, label: "Exceptionnelle", advice: "Achat prioritaire" },
];

export function scoreBand(score: number): ScoreBand {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  return SCORE_BANDS.find((b) => s >= b.min && s <= b.max) ?? SCORE_BANDS[0]!;
}

/** Seuil à partir duquel une affaire apparaît dans « À valider ». */
export const REVIEW_THRESHOLD = 75;

export interface AutoBuyContext {
  opportunity: Pick<Opportunity, "id" | "score" | "status" | "observed" | "estimate">;
  settings: AutoBuySettings;
  fees?: BuyerFees | null;
  /** Montant déjà engagé aujourd'hui par les achats (manuels et automatiques). */
  spentTodayCents: Cents;
  /** Un achat existe déjà pour cette opportunité. */
  alreadyPurchased: boolean;
}

export type AutoBuyDecision = { buy: true; totalCents: Cents; reason: string } | { buy: false; reason: string };

/**
 * Décision d'achat automatique, avec garde-fous : activation explicite,
 * seuil de score, prix maximal par article, plafond journalier, marge
 * positive, pas de doublon.
 */
export function autoBuyDecision(ctx: AutoBuyContext): AutoBuyDecision {
  const { opportunity: o, settings } = ctx;
  if (!settings.enabled) return { buy: false, reason: "Achat auto désactivé" };
  if (ctx.alreadyPurchased || o.status === "purchased") return { buy: false, reason: "Déjà acheté (doublon évité)" };
  if (o.status === "dismissed") return { buy: false, reason: "Affaire écartée" };
  if (o.score < settings.threshold) return { buy: false, reason: `Score ${o.score} sous le seuil ${settings.threshold}` };
  const total = purchaseCost(o.observed, ctx.fees).totalCents;
  if (total > settings.maxItemCents) return { buy: false, reason: "Au-dessus du prix maximal par article" };
  if (ctx.spentTodayCents + total > settings.dailyCapCents) return { buy: false, reason: "Plafond de dépense du jour atteint" };
  if (o.estimate.marginCents <= 0) return { buy: false, reason: "Marge estimée nulle ou négative" };
  return { buy: true, totalCents: total, reason: `Score ${o.score} ≥ seuil ${settings.threshold}, dans le plafond du jour` };
}

/** Fin du délai d'annulation d'un achat automatique. */
export function cancelableUntil(at: Date, settings: Pick<AutoBuySettings, "cancelWindowMinutes">): string | null {
  if (settings.cancelWindowMinutes <= 0) return null;
  return new Date(at.getTime() + settings.cancelWindowMinutes * 60_000).toISOString();
}

export function canStillCancel(cancelable: string | null, now: Date): boolean {
  return cancelable !== null && new Date(cancelable).getTime() > now.getTime();
}
