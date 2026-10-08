import type { ReplySuggestion } from "@selio/contracts";
import { scanForInjection, type NegotiationResult } from "@selio/domain";

export interface ValidationContext {
  decision: NegotiationResult | null;
  offerCents: number | null;
  floorPriceCents: number;
  purchasePriceCents: number;
  listedPriceCents: number | null;
}

export type ValidationOutcome = { ok: true; suggestion: ReplySuggestion } | { ok: false; reason: string; code: string };

const EXPECTED_INTENT: Record<string, ReplySuggestion["intent"][]> = {
  accept: ["accept_offer"],
  counter: ["counter_offer"],
  decline: ["decline_offer"],
  escalate: ["escalate", "answer"],
  hold: ["answer", "escalate"],
};

/**
 * Une sortie IA n'est jamais une action : elle est validée par schéma (déjà fait)
 * puis par la politique métier avant de devenir un brouillon.
 */
export function validateReplySuggestion(s: ReplySuggestion, ctx: ValidationContext): ValidationOutcome {
  const reply = s.reply.trim();
  if (reply.length < 5) return { ok: false, code: "too_short", reason: "Réponse trop courte." };
  if (/<[a-z!/][^>]*>/i.test(reply)) return { ok: false, code: "html", reason: "La réponse contient du HTML." };
  if (/https?:\/\/|www\./i.test(reply)) return { ok: false, code: "link", reason: "La réponse contient un lien." };
  const scan = scanForInjection(reply);
  if (scan.suspicious) return { ok: false, code: "injection_echo", reason: `La réponse reprend un motif suspect (${scan.matches[0]}).` };

  const decision = ctx.decision?.decision ?? null;
  if (decision && !(EXPECTED_INTENT[decision] ?? []).includes(s.intent)) {
    return { ok: false, code: "intent_mismatch", reason: `Intention « ${s.intent} » incompatible avec la décision « ${decision} ».` };
  }
  if (!decision && (s.intent === "accept_offer" || s.intent === "counter_offer" || s.intent === "decline_offer")) {
    return { ok: false, code: "intent_without_decision", reason: "L'IA a pris une décision commerciale sans politique." };
  }

  const imposed = decision === "counter" ? ctx.decision?.counterCents ?? null : decision === "accept" ? ctx.offerCents : null;
  if (imposed !== null) {
    if (s.proposedPriceCents !== null && s.proposedPriceCents !== imposed) {
      return { ok: false, code: "price_mismatch", reason: `Prix proposé ${s.proposedPriceCents} ≠ prix imposé ${imposed}.` };
    }
    const mentioned = extractAllPricesCents(reply);
    if (mentioned.length > 0 && !mentioned.includes(imposed)) {
      return { ok: false, code: "price_in_text_mismatch", reason: "Le texte mentionne un prix différent du prix imposé." };
    }
    if (imposed < ctx.floorPriceCents && decision !== "accept") {
      return { ok: false, code: "below_floor", reason: "Prix sous le plancher." };
    }
  } else {
    if (s.proposedPriceCents !== null) return { ok: false, code: "unexpected_price", reason: "Aucun prix n'était attendu." };
  }
  // Ne jamais laisser fuiter le prix d'achat ou le plancher.
  const mentioned = extractAllPricesCents(reply);
  if (ctx.purchasePriceCents > 0 && mentioned.includes(ctx.purchasePriceCents) && ctx.purchasePriceCents !== imposed) {
    return { ok: false, code: "leak_purchase_price", reason: "Le texte révèle le prix d'achat." };
  }
  if (mentioned.includes(ctx.floorPriceCents) && ctx.floorPriceCents !== imposed && ctx.floorPriceCents !== ctx.listedPriceCents) {
    return { ok: false, code: "leak_floor", reason: "Le texte révèle le prix plancher." };
  }
  return { ok: true, suggestion: { ...s, reply } };
}

export function extractAllPricesCents(text: string): number[] {
  const out: number[] = [];
  for (const m of text.replace(/ | /g, " ").matchAll(/(\d{1,4}(?:[.,]\d{1,2})?)\s?(?:€|euros?\b|eur\b)/gi)) {
    const v = Number.parseFloat(m[1]!.replace(",", "."));
    if (Number.isFinite(v)) out.push(Math.round(v * 100));
  }
  return out;
}

/** Brouillon déterministe sans IA : utilisé quand l'IA est indisponible ou désactivée. */
export function fallbackReply(ctx: { decision: NegotiationResult | null; offerCents: number | null; buyerName: string | null; signature: string }): ReplySuggestion {
  const name = ctx.buyerName ? ` ${ctx.buyerName}` : "";
  const fmt = (c: number) => (c / 100).toFixed(2).replace(".", ",") + " €";
  const sig = ctx.signature ? `\n${ctx.signature}` : "";
  const d = ctx.decision?.decision ?? "answer";
  if (d === "accept" && ctx.offerCents !== null)
    return { reply: `Bonjour${name}, c'est d'accord pour ${fmt(ctx.offerCents)}. Faites l'offre sur l'annonce et je l'accepte dès réception.${sig}`, intent: "accept_offer", proposedPriceCents: ctx.offerCents, confidence: 1, notes: "Gabarit sans IA" };
  if (d === "counter" && ctx.decision?.counterCents != null)
    return { reply: `Bonjour${name}, merci pour votre proposition. Je peux descendre à ${fmt(ctx.decision.counterCents)}, c'est mon meilleur prix. Si cela vous convient, faites l'offre à ce montant.${sig}`, intent: "counter_offer", proposedPriceCents: ctx.decision.counterCents, confidence: 1, notes: "Gabarit sans IA" };
  if (d === "decline")
    return { reply: `Bonjour${name}, merci pour l'intérêt porté à l'article. Je ne peux pas descendre à ce prix, il reste disponible au prix affiché.${sig}`, intent: "decline_offer", proposedPriceCents: null, confidence: 1, notes: "Gabarit sans IA" };
  if (d === "escalate" || d === "hold")
    return { reply: `Bonjour${name}, merci pour votre message. Je reviens vers vous rapidement.${sig}`, intent: "escalate", proposedPriceCents: null, confidence: 1, notes: "Gabarit sans IA" };
  return { reply: `Bonjour${name}, oui l'article est toujours disponible. N'hésitez pas si vous avez des questions.${sig}`, intent: "answer", proposedPriceCents: null, confidence: 1, notes: "Gabarit sans IA" };
}
