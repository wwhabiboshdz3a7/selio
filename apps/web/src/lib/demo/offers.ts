import {
  PAID_PLANS, discountedPriceCents, normalizeOfferCode, offerAvailability, offerCoversPlan, offerDiscountLabel, offerDurationLabel, offerInput, offerPlansLabel, offerRuleIssues, offerUpdate, toPublicOffer,
  type BillingCycle, type CommercialOffer, type OfferInput, type OfferUpdate, type PromoCheckResult, type PublicOffer,
} from "@selio/contracts";
import { newId } from "@selio/domain";
import { PRICING } from "@selio/demo-data";
import { DataError } from "../data/types";

/**
 * Offres commerciales de la démonstration : comme la table globale `commercial_offers`, elles vivent hors de
 * l'espace de démonstration (une nouvelle inscription ou la déconnexion ne les efface pas) et sont rangées dans
 * le navigateur seulement. Aucune offre par défaut : le bandeau n'apparaît qu'après en avoir créé une depuis
 * l'administration de la démonstration. Mêmes règles que le serveur (@selio/contracts).
 */
export const DEMO_OFFERS_KEY = "selio.demo.offers";

export interface DemoOfferStore {
  load(): CommercialOffer[];
  save(offers: CommercialOffer[]): void;
}

/** Stockage local, protégé (navigation privée, stockage bloqué) : en mémoire si le navigateur refuse. */
export class LocalDemoOfferStore implements DemoOfferStore {
  private memory: CommercialOffer[] = [];
  load(): CommercialOffer[] {
    try {
      const storage = globalThis.localStorage;
      if (storage) {
        const raw = storage.getItem(DEMO_OFFERS_KEY);
        const parsed = raw ? (JSON.parse(raw) as unknown) : [];
        this.memory = Array.isArray(parsed) ? (parsed as CommercialOffer[]) : [];
      }
    } catch {
      // stockage indisponible ou illisible : la mémoire suffit
    }
    return this.memory;
  }
  save(offers: CommercialOffer[]): void {
    this.memory = offers;
    try {
      globalThis.localStorage?.setItem(DEMO_OFFERS_KEY, JSON.stringify(offers));
    } catch {
      // stockage indisponible : la mémoire suffit
    }
  }
}

export class MemoryDemoOfferStore implements DemoOfferStore {
  constructor(private offers: CommercialOffer[] = []) {}
  load(): CommercialOffer[] { return this.offers; }
  save(offers: CommercialOffer[]): void { this.offers = offers; }
}

const priceOf = (plan: (typeof PAID_PLANS)[number], cycle: BillingCycle): number => PRICING.monthlyCents[plan] * (cycle === "yearly" ? PRICING.annualMonthsCharged : 1);

function firstIssue(issues: { message: string }[]): never {
  throw new DataError("validation", issues[0]?.message ?? "Offre invalide.", 400, { issues });
}

export function createDemoOffer(list: CommercialOffer[], raw: unknown, userId: string, now: string): CommercialOffer {
  const parsed = offerInput.safeParse(raw ?? {});
  if (!parsed.success) firstIssue(parsed.error.issues);
  const input = parsed.data;
  if (input.code && list.some((o) => o.code?.toUpperCase() === input.code)) throw new DataError("conflict", `Le code ${input.code} est déjà utilisé par une autre offre.`, 409);
  return { id: newId(), ...input, redemptions: 0, createdBy: userId, createdAt: now, updatedAt: now, archivedAt: null };
}

export function updateDemoOffer(list: CommercialOffer[], id: string, raw: unknown, now: string): CommercialOffer {
  const current = list.find((o) => o.id === id);
  if (!current) throw new DataError("not_found", "Offre introuvable.", 404);
  if (current.archivedAt) throw new DataError("conflict", "Offre archivée : elle a déjà servi et ne peut plus être modifiée. Créez-en une nouvelle.", 409);
  const parsed = offerUpdate.safeParse(raw ?? {});
  if (!parsed.success) firstIssue(parsed.error.issues);
  const patch: OfferUpdate = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
  if (patch.discountPercent != null && patch.discountCents === undefined) patch.discountCents = null;
  if (patch.discountCents != null && patch.discountPercent === undefined) patch.discountPercent = null;
  const merged = { ...current, ...patch } as CommercialOffer;
  const issues = offerRuleIssues(merged);
  if (issues.length) firstIssue(issues);
  if (patch.code && list.some((o) => o.id !== id && o.code?.toUpperCase() === patch.code)) throw new DataError("conflict", `Le code ${patch.code} est déjà utilisé par une autre offre.`, 409);
  return { ...merged, updatedAt: now };
}

/** Bandeau : actives, dans leur période, sous leur maximum, avec bandeau (trois au plus, les plus récentes). */
export function demoBanners(list: CommercialOffer[], now: Date): PublicOffer[] {
  return list
    .filter((o) => o.bannerEnabled && offerAvailability(o, { now }).ok)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 3)
    .map(toPublicOffer);
}

export function demoCheckCode(list: CommercialOffer[], rawCode: unknown, now: Date, plan: string | null, cycle: BillingCycle = "monthly"): { offer: CommercialOffer; result: PromoCheckResult } | { offer: null; result: PromoCheckResult } {
  const code = normalizeOfferCode(rawCode);
  if (!code) return { offer: null, result: { valid: false, reason: "invalid_code", message: "Ce code promo n'a pas le bon format (3 à 24 lettres, chiffres ou tirets)." } };
  const offer = list.find((o) => o.code?.toUpperCase() === code);
  if (!offer) return { offer: null, result: { valid: false, reason: "unknown_code", message: "Code promo inconnu." } };
  const ok = offerAvailability(offer, { now, plan });
  if (!ok.ok) return { offer: null, result: { valid: false, reason: ok.reason, message: ok.message } };
  const prices = PAID_PLANS.filter((p) => offerCoversPlan(offer.plans, p)).map((p) => ({ plan: p, cycle, priceCents: priceOf(p, cycle), discountedCents: discountedPriceCents(priceOf(p, cycle), offer) }));
  const summary = `${offerDiscountLabel(offer)} sur ${offerPlansLabel(offer.plans)} ${offer.durationMonths === null ? "tant que l'abonnement dure" : offerDurationLabel(offer.durationMonths)}`;
  return { offer, result: { valid: true, message: `Code ${offer.code} valable : ${summary}.`, offer: toPublicOffer(offer), prices } };
}

export type { OfferInput };
