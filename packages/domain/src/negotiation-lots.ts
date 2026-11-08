import type { BundleOfferPolicy, MarginRules, NegotiationAutomation, Schedule } from "@selio/contracts";
import { negotiationAutomation } from "@selio/contracts";
import { applyRate, assertCents, sumCents, type Cents } from "./money";
import { evaluateOffer, type NegotiationResult } from "./negotiation";
import { lotDiscountRate } from "./negotiation-journey";
import { suggestFloorPrice, type ItemPricing } from "./pricing";

/**
 * Négociation sur un lot (plusieurs articles dans une même offre, §5.12). Même principe que pour un
 * article seul (D07) : cette politique déterministe décide accepter / contre-proposer / refuser /
 * transmettre au vendeur ; l'IA ne fait que rédiger dans les bornes. Le lot est évalué comme un
 * article unique dont le prix affiché est la somme des prix affichés, le coût la somme des coûts, et
 * le plancher le **plancher de lot** :
 *
 *   plancher de lot = max( somme des planchers réels , total affiché × (1 − remise maximale de lot) )
 *
 * La remise de lot ne descend donc jamais sous la somme des planchers réels des articles (plancher
 * fixé par le vendeur, ou plancher suggéré par les règles de marge) : un lot ne crée pas de vente à
 * perte. Paliers, remise maximale, nombre de contre-propositions, plage horaire et approbation suivent
 * les mêmes règles que l'article seul (`evaluateOffer`). Le prix retenu est ensuite réparti entre les
 * articles au prorata de leur prix affiché (`perItemAllocationCents`), pour la comptabilité et les
 * marges par article.
 */

export interface BundleOfferContext {
  /** Articles du lot, chacun avec son plancher (ou les éléments pour le suggérer). */
  items: ItemPricing[];
  /** Offre de l'acheteur pour le lot entier. */
  offerCents: Cents;
  rules: MarginRules;
  bundlePolicy: Pick<BundleOfferPolicy, "maxDiscountRate" | "minItems">;
  /** Contre-propositions déjà envoyées à cet acheteur pour ce lot. */
  roundsSoFar: number;
  actionsTodayForCustomer?: number;
  maxActionsPerCustomerPerDay?: number;
  schedule?: Schedule;
  now?: Date;
  untrusted?: boolean;
}

export interface BundleNegotiationResult extends NegotiationResult {
  itemCount: number;
  /** Somme des prix affichés (0 si un article n'a pas de prix). */
  listedTotalCents: Cents;
  /** Somme des planchers réels des articles : le plancher du lot n'est jamais en dessous. */
  floorSumCents: Cents;
  /** Remise effectivement permise par le plancher du lot sur le total affiché (0 si aucune). */
  bundleDiscountRate: number;
  /** Prix retenu pour la répartition : offre acceptée, contre-proposition, sinon l'offre reçue. */
  settledCents: Cents;
  /** Répartition de `settledCents` entre les articles, au prorata du prix affiché (somme exacte). */
  perItemAllocationCents: Cents[];
}

const eur = (c: number) => (c / 100).toFixed(2).replace(".", ",") + " €";

/** Plancher réel d'un article : celui du vendeur, sinon le plancher suggéré par les règles de marge. */
export function lotItemFloorCents(item: ItemPricing, rules: MarginRules): Cents {
  return item.floorPriceCents ?? suggestFloorPrice(item, rules);
}

export interface LotFloor {
  floorSumCents: Cents;
  listedTotalCents: Cents | null;
  /** Plancher du lot : jamais sous `floorSumCents`. */
  floorCents: Cents;
}

/** Plancher d'un lot : total affiché moins la remise maximale de lot, borné par la somme des planchers réels. */
export function lotFloorCents(items: readonly ItemPricing[], rules: MarginRules, policy: Pick<BundleOfferPolicy, "maxDiscountRate">): LotFloor {
  const floorSumCents = sumCents(items.map((i) => lotItemFloorCents(i, rules)));
  const listedTotalCents = items.every((i) => i.listedPriceCents !== null) ? sumCents(items.map((i) => i.listedPriceCents!)) : null;
  if (listedTotalCents === null) return { floorSumCents, listedTotalCents, floorCents: floorSumCents };
  const byDiscount = listedTotalCents - applyRate(listedTotalCents, policy.maxDiscountRate);
  return { floorSumCents, listedTotalCents, floorCents: Math.max(floorSumCents, byDiscount) };
}

/**
 * Répartit un montant entre plusieurs parts au prorata de poids (prix affichés), en centimes entiers,
 * avec une somme exacte : parts entières d'abord, puis le reste aux plus grandes fractions (à égalité,
 * la première part). Poids tous nuls : parts égales.
 */
export function allocateProportionally(totalCents: Cents, weights: readonly number[]): Cents[] {
  assertCents(totalCents, "total");
  if (weights.length === 0) return [];
  const safe = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const sum = safe.reduce((a, b) => a + b, 0);
  const shares = sum === 0 ? safe.map(() => totalCents / safe.length) : safe.map((w) => (totalCents * w) / sum);
  const floors = shares.map((s) => Math.floor(s));
  let remainder = totalCents - floors.reduce((a, b) => a + b, 0);
  const order = shares
    .map((s, i) => ({ i, frac: s - Math.floor(s) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i]! += 1;
    remainder -= 1;
  }
  return floors;
}

/**
 * Politique de lot à partir des réglages de l'organisation : la remise maximale acceptée est au moins
 * la remise de lot proposée spontanément (`lot.twoItemsRate` / `threePlusRate`), sinon la politique
 * refuserait ce que le vendeur offre lui-même.
 */
export function bundlePolicyFor(settings: Pick<NegotiationAutomation, "lot" | "bundle">, itemCount: number): Pick<BundleOfferPolicy, "maxDiscountRate" | "minItems"> & { enabled: boolean } {
  return {
    enabled: settings.bundle.enabled,
    maxDiscountRate: Math.max(settings.bundle.maxDiscountRate, lotDiscountRate(itemCount, settings.lot)),
    minItems: settings.bundle.minItems,
  };
}

function withBundle(base: NegotiationResult, extra: Omit<BundleNegotiationResult, keyof NegotiationResult | "settledCents" | "perItemAllocationCents">, offerCents: Cents, listed: readonly number[]): BundleNegotiationResult {
  const settledCents = base.decision === "accept" ? offerCents : base.decision === "counter" && base.counterCents !== null ? base.counterCents : offerCents;
  return { ...base, ...extra, settledCents, perItemAllocationCents: allocateProportionally(Math.max(0, settledCents), listed) };
}

/** Évalue l'offre d'un acheteur sur un lot. Voir l'en-tête du module. */
export function evaluateBundleOffer(ctx: BundleOfferContext): BundleNegotiationResult {
  const { items, offerCents, rules } = ctx;
  const policy = ctx.bundlePolicy;
  const listed = items.map((i) => i.listedPriceCents ?? 0);
  const floor = lotFloorCents(items, rules, policy);
  const info = { itemCount: items.length, listedTotalCents: floor.listedTotalCents ?? 0, floorSumCents: floor.floorSumCents, bundleDiscountRate: floor.listedTotalCents ? Math.max(0, 1 - floor.floorCents / floor.listedTotalCents) : 0 };
  const escalate = (reason: string): BundleNegotiationResult =>
    withBundle({ decision: "escalate", counterCents: null, reasons: [reason], requiresApproval: true, floorCents: floor.floorCents, marginAtOfferCents: 0, marginRateAtOffer: 0 }, info, offerCents, listed);

  if (items.length === 0) return escalate("Lot vide : aucun article à négocier.");
  if (items.length < policy.minItems) return escalate(`Lot de ${items.length} article(s), en dessous du minimum de ${policy.minItems} : à traiter article par article.`);
  if (floor.listedTotalCents === null) return escalate("Un article du lot n'a pas de prix affiché : impossible de négocier le lot automatiquement.");

  // Le lot est évalué comme un article unique au plancher de lot ; la remise maximale est celle des lots.
  const bundleItem: ItemPricing = {
    purchasePriceCents: sumCents(items.map((i) => i.purchasePriceCents)),
    purchaseFeesCents: sumCents(items.map((i) => i.purchaseFeesCents)),
    listedPriceCents: floor.listedTotalCents,
    floorPriceCents: floor.floorCents,
  };
  const bundleRules: MarginRules = { ...rules, maxDiscountRate: policy.maxDiscountRate };
  const base = evaluateOffer({
    item: bundleItem,
    offerCents,
    rules: bundleRules,
    roundsSoFar: ctx.roundsSoFar,
    actionsTodayForCustomer: ctx.actionsTodayForCustomer,
    maxActionsPerCustomerPerDay: ctx.maxActionsPerCustomerPerDay,
    schedule: ctx.schedule,
    now: ctx.now,
    untrusted: ctx.untrusted,
  });
  // Garde-fou : quoi qu'ait calculé la politique, jamais une contre-proposition sous la somme des planchers réels.
  const counterCents = base.counterCents === null ? null : Math.max(base.counterCents, floor.floorSumCents);
  const reasons = [
    `Lot de ${items.length} articles : total affiché ${eur(floor.listedTotalCents)}, plancher du lot ${eur(floor.floorCents)} (somme des planchers réels ${eur(floor.floorSumCents)}, remise de lot maximale ${(policy.maxDiscountRate * 100).toFixed(0)} %).`,
    ...base.reasons,
  ];
  return withBundle({ ...base, counterCents, floorCents: floor.floorCents, reasons }, info, offerCents, listed);
}

/** Variables des gabarits de lot : {prenom}, {prix}, {prix_initial}, {nb_articles}, {article}, {articles} (titres des articles du lot). */
export function fillBundleTemplate(template: string, vars: { prenom?: string; prix?: string; prix_initial?: string; nb_articles?: number | string; article?: string; articles?: string }): string {
  return template.replace(/\{(prenom|prix_initial|prix|nb_articles|articles|article)\}/g, (_, k: keyof typeof vars) => {
    const v = vars[k];
    return v === undefined || v === null ? "" : String(v);
  });
}

export type BundleReplyKind = "accepted" | "counter" | "final";

/**
 * Gabarit de lot à utiliser selon la décision : « accepted », « counter » au-dessus du plancher du lot,
 * « final » (seul gabarit qui dit « dernier prix », D20) quand la contre-proposition est au plancher du
 * lot. Refus, transmission ou attente : null (gabarit de repli ou vendeur).
 */
export function bundleReplyKind(result: Pick<NegotiationResult, "decision" | "counterCents" | "floorCents">): BundleReplyKind | null {
  if (result.decision === "accept") return "accepted";
  if (result.decision === "counter" && result.counterCents !== null) return result.counterCents <= result.floorCents ? "final" : "counter";
  return null;
}

/** Gabarits de lot par défaut (repli quand un gabarit modifié enfreint la règle D20). */
const DEFAULT_BUNDLE_MESSAGES = negotiationAutomation.parse({}).messages;

/**
 * Règle D20 sur un gabarit de lot : jamais « meilleur prix » ; « dernier prix » seulement dans l'offre
 * finale (au plancher du lot). Vérifiée aussi côté serveur : un gabarit modifié par l'API, sans passer
 * par l'écran, ne peut pas faire écrire une contre-vérité.
 */
export function bundleTemplateAllowed(kind: BundleReplyKind, template: string): boolean {
  if (/meilleur prix/i.test(template)) return false;
  if (kind !== "final" && /dernier prix/i.test(template)) return false;
  return true;
}

/** Titres des articles d'un lot, pour le message (« « Veste » et « Jean » »). */
export function bundleArticlesText(titles: readonly string[]): string {
  const quoted = titles.map((t) => `« ${t.replace(/\s+/g, " ").trim().slice(0, 80)} »`);
  if (quoted.length <= 1) return quoted.join("");
  return `${quoted.slice(0, -1).join(", ")} et ${quoted[quoted.length - 1]}`;
}

/**
 * Message de lot sans IA, rempli depuis les gabarits de l'organisation ; null si la décision n'envoie rien.
 * L'accord porte toujours sur un lot PRÉCIS : les titres des articles sont cités ({articles}, ou ajoutés à
 * la fin quand le gabarit ne les cite pas), pour que l'acheteur ne puisse pas former un autre lot au même prix.
 */
export function bundleMessage(
  result: BundleNegotiationResult,
  messages: Pick<NegotiationAutomation["messages"], "bundleAccepted" | "bundleCounter" | "bundleFinal">,
  vars: { prenom?: string; article?: string; titles?: readonly string[] } = {},
): string | null {
  const kind = bundleReplyKind(result);
  if (kind === null) return null;
  const key = kind === "accepted" ? "bundleAccepted" : kind === "final" ? "bundleFinal" : "bundleCounter";
  const template = bundleTemplateAllowed(kind, messages[key]) ? messages[key] : DEFAULT_BUNDLE_MESSAGES[key];
  const articles = bundleArticlesText(vars.titles ?? []);
  const text = fillBundleTemplate(template, { prenom: vars.prenom, article: vars.article, articles, prix: eur(result.settledCents), prix_initial: eur(result.listedTotalCents), nb_articles: result.itemCount });
  return articles && !template.includes("{articles}") ? `${text} Articles du lot : ${articles}.` : text;
}
