import { DECLARATION_THRESHOLDS_2026, type DeclarationThresholds, type Order } from "@selio/contracts";
import { ratio, type Cents } from "./money";
import { countsAsRevenue } from "./orders";

/**
 * Seuils de déclaration (§5.14). Depuis 2026, les plateformes transmettent à l'administration les
 * vendeurs qui dépassent, sur l'année civile, un nombre de ventes OU un montant encaissé. Selio informe
 * quand on s'en approche. INFORMATION FACTUELLE SEULEMENT : aucun conseil fiscal, aucune interprétation
 * de la situation du client (particulier, professionnel, nature des biens…). Le texte le dit et renvoie
 * vers l'administration. Les seuils sont paramétrables (réglages de l'organisation) au cas où ils changent.
 */

export interface Thresholds {
  /** Nombre de ventes sur l'année à partir duquel la plateforme transmet. */
  salesCount: number;
  /** Montant encaissé sur l'année (centimes) à partir duquel la plateforme transmet. */
  revenueCents: Cents;
  /** Année d'entrée en vigueur de ces valeurs (documentaire). */
  year: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { ...DECLARATION_THRESHOLDS_2026 };
/** Part du seuil à partir de laquelle on prévient (80 %). */
export const DEFAULT_APPROACHING_RATE = 0.8;

export type ThresholdLevel = "none" | "approaching" | "reached";
export type ThresholdKind = "sales" | "revenue";

export interface NextThreshold {
  kind: ThresholdKind;
  /** Valeur du seuil (nombre de ventes, ou centimes). */
  value: number;
  /** Ce qu'il reste avant de l'atteindre (0 si atteint). */
  remaining: number;
  /** Avancement vers ce seuil (1 = atteint, peut dépasser 1). */
  ratio: number;
}

export interface ThresholdStatus {
  level: ThresholdLevel;
  /** Année civile considérée. */
  year: number;
  salesThisYear: number;
  revenueThisYearCents: Cents;
  thresholds: Thresholds;
  salesRatio: number;
  revenueRatio: number;
  /** Seuils déjà atteints. */
  reached: ThresholdKind[];
  /** Le seuil le plus proche parmi ceux qui ne sont pas atteints (null : les deux sont atteints). */
  nextThreshold: NextThreshold | null;
  /** Texte factuel, prêt à afficher, qui se termine par la mise en garde. */
  text: string;
  disclaimer: string;
}

/** Mise en garde ajoutée à chaque statut : Selio n'est pas un conseil fiscal. */
export const THRESHOLD_DISCLAIMER = "Ceci est une information, pas un conseil fiscal : Selio n'est pas un conseil fiscal et n'interprète pas votre situation ; renseignez-vous auprès de l'administration.";

/** Montant en euros, déterministe (indépendant de la locale de l'environnement) : « 1 000,00 € ». */
const eur = (c: number) => {
  const abs = Math.abs(Math.round(c));
  const euros = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${c < 0 ? "-" : ""}${euros},${String(abs % 100).padStart(2, "0")} €`;
};
const ventes = (n: number) => `${n} vente${n > 1 ? "s" : ""}`;

/** Seuils effectifs à partir des réglages de l'organisation (année : celle de `now`). */
export function thresholdsFromSettings(settings: Pick<DeclarationThresholds, "salesCount" | "revenueCents">, year: number = DEFAULT_THRESHOLDS.year): Thresholds {
  return { salesCount: settings.salesCount, revenueCents: settings.revenueCents, year };
}

/** Nombre de ventes et montant encaissé d'une année civile (commandes qui comptent dans le CA, datées par leur création). */
export function yearTotals(orders: Iterable<Pick<Order, "status" | "createdAt" | "salePriceCents">>, year: number): { salesThisYear: number; revenueThisYearCents: Cents } {
  let count = 0;
  let revenue = 0;
  for (const o of orders) {
    if (!countsAsRevenue(o.status)) continue;
    if (new Date(o.createdAt).getUTCFullYear() !== year) continue;
    count++;
    revenue += o.salePriceCents;
  }
  return { salesThisYear: count, revenueThisYearCents: revenue };
}

export interface ThresholdStatusInput {
  salesThisYear: number;
  revenueThisYearCents: Cents;
  thresholds?: Thresholds;
  /** Part du seuil à partir de laquelle le niveau passe à « approaching » (0,8 par défaut). */
  approachingRate?: number;
  now: Date;
}

/**
 * Niveau d'alerte : « none » sous 80 % des deux seuils, « approaching » à partir de 80 % de l'un
 * d'eux, « reached » dès qu'un seuil est atteint. Le texte dit où en est le client, ce que signifie le
 * seuil (transmission par la plateforme) et rien d'autre.
 */
export function thresholdStatus(input: ThresholdStatusInput): ThresholdStatus {
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  const approachingRate = Math.min(0.99, Math.max(0.1, input.approachingRate ?? DEFAULT_APPROACHING_RATE));
  const year = input.now.getUTCFullYear();
  const sales = Math.max(0, Math.floor(input.salesThisYear));
  const revenue = Math.max(0, Math.round(input.revenueThisYearCents));
  const salesRatio = ratio(sales, thresholds.salesCount);
  const revenueRatio = ratio(revenue, thresholds.revenueCents);
  const reached: ThresholdKind[] = [];
  if (sales >= thresholds.salesCount) reached.push("sales");
  if (revenue >= thresholds.revenueCents) reached.push("revenue");
  const all: NextThreshold[] = [
    { kind: "sales", value: thresholds.salesCount, remaining: Math.max(0, thresholds.salesCount - sales), ratio: salesRatio },
    { kind: "revenue", value: thresholds.revenueCents, remaining: Math.max(0, thresholds.revenueCents - revenue), ratio: revenueRatio },
  ];
  const candidates = all.filter((c) => !reached.includes(c.kind));
  const nextThreshold = candidates.length === 0 ? null : candidates.sort((a, b) => b.ratio - a.ratio)[0]!;
  const level: ThresholdLevel = reached.length > 0 ? "reached" : nextThreshold && nextThreshold.ratio >= approachingRate ? "approaching" : "none";

  const situation = `En ${year}, vous avez ${ventes(sales)} et ${eur(revenue)} encaissés.`;
  const rule = `Seuils de transmission par les plateformes à l'administration : ${ventes(thresholds.salesCount)} ou ${eur(thresholds.revenueCents)} sur l'année (valeurs ${thresholds.year}, modifiables dans les réglages).`;
  let state: string;
  if (level === "reached") {
    const parts = reached.map((k) => (k === "sales" ? `celui de ${ventes(thresholds.salesCount)} (${ventes(sales)})` : `celui de ${eur(thresholds.revenueCents)} (${eur(revenue)})`));
    state = `Seuil atteint : ${parts.join(" et ")}. La plateforme transmet alors les informations du compte à l'administration.`;
  } else if (level === "approaching" && nextThreshold) {
    state = nextThreshold.kind === "sales"
      ? `Vous approchez du seuil de ${ventes(thresholds.salesCount)} : il reste ${ventes(nextThreshold.remaining)} avant de l'atteindre.`
      : `Vous approchez du seuil de ${eur(thresholds.revenueCents)} : il reste ${eur(nextThreshold.remaining)} avant de l'atteindre.`;
  } else {
    state = "Vous êtes en dessous des deux seuils.";
  }
  return {
    level,
    year,
    salesThisYear: sales,
    revenueThisYearCents: revenue,
    thresholds,
    salesRatio,
    revenueRatio,
    reached,
    nextThreshold,
    text: `${situation} ${rule} ${state} ${THRESHOLD_DISCLAIMER}`,
    disclaimer: THRESHOLD_DISCLAIMER,
  };
}

/** Statut à partir des commandes de l'organisation et de ses réglages (année de `now`). */
export function thresholdStatusForOrders(orders: Iterable<Pick<Order, "status" | "createdAt" | "salePriceCents">>, settings: DeclarationThresholds, now: Date): ThresholdStatus {
  const year = now.getUTCFullYear();
  return thresholdStatus({ ...yearTotals(orders, year), thresholds: thresholdsFromSettings(settings, year), approachingRate: settings.approachingRate, now });
}

/**
 * Texte du seuil sans aucun montant (§5.15), pour un rôle sans « finances.read » : le nombre de ventes de
 * l'année et le niveau d'alerte seulement, jamais le montant encaissé ni ce qu'il reste avant le seuil en
 * euros (qui permettrait de recalculer le chiffre d'affaires). Utilisé par l'alerte de la vue d'ensemble.
 */
export function thresholdTextWithoutAmounts(s: Pick<ThresholdStatus, "level" | "year" | "salesThisYear" | "thresholds" | "reached">): string {
  const situation = `En ${s.year}, vous avez ${ventes(s.salesThisYear)}.`;
  const state = s.level === "reached"
    ? (s.reached.includes("sales") ? `Le seuil de ${ventes(s.thresholds.salesCount)} est atteint.` : "Un seuil de transmission est atteint.")
    : s.level === "approaching" ? "Un seuil de transmission approche." : "Vous êtes en dessous des seuils.";
  return `${situation} ${state} Le détail des montants est réservé au titulaire et aux administrateurs. ${THRESHOLD_DISCLAIMER}`;
}
