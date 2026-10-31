import type { HelpAnswerOutput, ReplySuggestion } from "@selio/contracts";
import { helpTokens, normalizeHelpText, scanForInjection, type NegotiationResult } from "@selio/domain";

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
  // Règle des gabarits appliquée aussi au vrai modèle : jamais « meilleur prix » (le plancher peut être
  // plus bas) ; « dernier prix » seulement pour une contre-offre au plancher de la politique.
  if (/meilleur prix/i.test(reply)) return { ok: false, code: "false_last_price", reason: "« Meilleur prix » est interdit : le plancher peut être plus bas." };
  if (/dernier prix/i.test(reply)) {
    const floor = ctx.decision?.floorCents ?? ctx.floorPriceCents;
    const atFloor = decision === "counter" && imposed !== null && imposed <= floor;
    if (!atFloor) return { ok: false, code: "false_last_price", reason: "« Dernier prix » annoncé alors que la proposition n'est pas au plancher." };
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

/**
 * Phrase de contre-offre des gabarits sans IA. « Dernier prix » seulement quand la
 * contre-offre est au prix plancher ; sinon une formule neutre. Jamais « c'est mon
 * meilleur prix » quand le plancher est plus bas : ce serait faux.
 */
export function counterOfferWording(counterCents: number, floorCents: number): string {
  const fmt = (c: number) => (c / 100).toFixed(2).replace(".", ",") + " €";
  const proposal = counterCents === floorCents ? `Je peux aller jusqu'à ${fmt(counterCents)}, c'est mon dernier prix pour cet article.` : `Je peux vous le faire à ${fmt(counterCents)}.`;
  return `${proposal} Si cela vous convient, faites l'offre à ce montant.`;
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
    return { reply: `Bonjour${name}, merci pour votre proposition. ${counterOfferWording(ctx.decision.counterCents, ctx.decision.floorCents)}${sig}`, intent: "counter_offer", proposedPriceCents: ctx.decision.counterCents, confidence: 1, notes: "Gabarit sans IA" };
  if (d === "decline")
    return { reply: `Bonjour${name}, merci pour l'intérêt porté à l'article. Je ne peux pas descendre à ce prix, il reste disponible au prix affiché.${sig}`, intent: "decline_offer", proposedPriceCents: null, confidence: 1, notes: "Gabarit sans IA" };
  if (d === "escalate" || d === "hold")
    return { reply: `Bonjour${name}, merci pour votre message. Je reviens vers vous rapidement.${sig}`, intent: "escalate", proposedPriceCents: null, confidence: 1, notes: "Gabarit sans IA" };
  return { reply: `Bonjour${name}, oui l'article est toujours disponible. N'hésitez pas si vous avez des questions.${sig}`, intent: "answer", proposedPriceCents: null, confidence: 1, notes: "Gabarit sans IA" };
}

export type HelpValidationOutcome = { ok: true; output: HelpAnswerOutput } | { ok: false; code: string; reason: string };

/** Nombres d'un texte (séparateurs de milliers retirés, virgule décimale normalisée). */
function numbersIn(text: string): Set<string> {
  const flat = text.replace(/(\d)[\s  ](?=\d{3}\b)/g, "$1");
  return new Set([...flat.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0].replace(",", ".").replace(/^0+(?=\d)/, "")));
}

/** Domaines cités en clair (ex. « exemple.com »). */
function domainsIn(text: string): string[] {
  return [...text.toLowerCase().matchAll(/\b[a-z0-9-]+\.(?:fr|com|net|org|io|be|eu|app|dev|co|ai|info|biz|shop)\b/g)].map((m) => m[0]);
}

/**
 * Une réponse d'aide rédigée par l'IA n'est montrée que si elle reste dans les passages :
 * aucun lien ni adresse, pas de HTML, aucun motif d'injection repris, uniquement des sources
 * fournies, aucun chiffre absent des passages et un vocabulaire majoritairement tiré d'eux.
 */
export function validateHelpAnswer(out: HelpAnswerOutput, passages: { id: string; question: string; answer: string }[]): HelpValidationOutcome {
  const answer = out.answer.trim();
  const corpus = passages.map((p) => `${p.question}\n${p.answer}`).join("\n");
  if (answer.length < 10) return { ok: false, code: "too_short", reason: "Réponse trop courte." };
  if (/<[a-z!/][^>]*>/i.test(answer)) return { ok: false, code: "html", reason: "La réponse contient du HTML." };
  if (/https?:\/\/|www\.|\]\(/i.test(answer)) return { ok: false, code: "link", reason: "La réponse contient un lien." };
  if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(answer)) return { ok: false, code: "contact", reason: "La réponse contient une adresse email." };
  const knownDomains = new Set(domainsIn(corpus));
  const foreign = domainsIn(answer).find((d) => !knownDomains.has(d));
  if (foreign) return { ok: false, code: "link", reason: `La réponse cite une adresse absente des passages (${foreign}).` };
  const scan = scanForInjection(answer);
  if (scan.suspicious) return { ok: false, code: "injection_echo", reason: `La réponse reprend un motif suspect (${scan.matches[0]}).` };

  const ids = new Set(passages.map((p) => p.id));
  const unknown = out.sourceIds.find((id) => !ids.has(id));
  if (unknown) return { ok: false, code: "unknown_source", reason: `Source inconnue : ${unknown.slice(0, 40)}.` };
  const sourceIds = [...new Set(out.sourceIds)];
  if (out.outOfScope) return { ok: true, output: { answer, sourceIds, outOfScope: true } };
  if (sourceIds.length === 0) return { ok: false, code: "no_source", reason: "Aucun passage cité." };

  const known = numbersIn(corpus);
  const invented = [...numbersIn(answer)].find((n) => !known.has(n));
  if (invented) return { ok: false, code: "invented_number", reason: `Chiffre absent des passages : ${invented}.` };

  // Vocabulaire : au moins la moitié des mots porteurs de sens doivent venir des passages.
  const corpusTokens = new Set(helpTokens(corpus));
  const words = helpTokens(answer).filter((t) => t.length >= 4 && !/^\d+$/.test(t));
  if (words.length >= 6) {
    const inCorpus = words.filter((t) => corpusTokens.has(t) || [...corpusTokens].some((c) => c.length >= 4 && (c.startsWith(t) || t.startsWith(c)))).length;
    if (inCorpus / words.length < 0.5) return { ok: false, code: "off_passages", reason: "La réponse s'éloigne des passages de la FAQ." };
  }
  if (normalizeHelpText(answer).length === 0) return { ok: false, code: "too_short", reason: "Réponse vide." };
  return { ok: true, output: { answer, sourceIds, outOfScope: false } };
}
