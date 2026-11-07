import { LABEL_FIELDS, MEASUREMENT_NAMES, STUDIO_MEASUREMENT_TOLERANCE_CM, STUDIO_MIN_CONFIDENCE } from "@selio/contracts";
import type { HelpAnswerOutput, LabelReadOutput, MeasurementName, MeasurementsOutput, PhotoDescription, PhotoSortOutput, ReplySuggestion, SellerQuestion, SortedPhoto, StudioQuestionField, StudioQuestionReason } from "@selio/contracts";
import { helpTokens, normalizeHelpText, sanitizeUntrustedText, scanForInjection, simplifyText, studioQuestion, type NegotiationResult } from "@selio/domain";
import { STUDIO_EXAMPLE_BRAND, STUDIO_EXAMPLE_MEASUREMENT } from "../prompts";

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

// ---------------------------------------------------------------- estimation des prix (§5.10)

export type PriceExplanationValidation = { ok: true; explanation: string } | { ok: false; code: string; reason: string };

/**
 * L'explication d'un prix par mon IA perso n'est montrée que si elle reste dans les faits fournis :
 * aucun prix autre que ceux décidés par l'estimation, aucun chiffre absent des faits (délai, nombre de
 * ventes), aucune promesse, ni lien, ni HTML, ni motif d'injection repris (D07 : l'IA rédige, elle ne
 * choisit jamais le prix).
 */
export function validatePriceExplanation(text: string, ctx: { allowedPricesCents: readonly number[]; facts: readonly string[] }): PriceExplanationValidation {
  const explanation = text.replace(/\s+/g, " ").trim();
  if (explanation.length < 20) return { ok: false, code: "too_short", reason: "Explication trop courte." };
  if (/<[a-z!/][^>]*>/i.test(explanation)) return { ok: false, code: "html", reason: "L'explication contient du HTML." };
  if (/https?:\/\/|www\.|\]\(/i.test(explanation)) return { ok: false, code: "link", reason: "L'explication contient un lien." };
  const scan = scanForInjection(explanation);
  if (scan.suspicious) return { ok: false, code: "injection_echo", reason: `L'explication reprend un motif suspect (${scan.matches[0]}).` };
  if (/garanti|100\s?%|z[ée]ro risque|sans risque|à coup sûr|certain(e)? de vendre/i.test(explanation)) return { ok: false, code: "promise", reason: "L'explication promet un résultat." };
  const allowed = new Set(ctx.allowedPricesCents.map((c) => Math.round(c)));
  const foreignPrice = extractAllPricesCents(explanation).find((c) => !allowed.has(c));
  if (foreignPrice !== undefined) return { ok: false, code: "invented_price", reason: `Prix absent de l'estimation : ${(foreignPrice / 100).toFixed(2)} €.` };
  const known = numbersIn(ctx.facts.join("\n"));
  const invented = [...numbersIn(explanation)].find((n) => !known.has(n));
  if (invented) return { ok: false, code: "invented_number", reason: `Chiffre absent des faits fournis : ${invented}.` };
  return { ok: true, explanation: explanation.slice(0, 800) };
}

export type PhotoDescriptionValidation = { ok: true; description: PhotoDescription } | { ok: false; code: string; reason: string };

/** La description lue sur une photo ne contient ni prix, ni lien, ni HTML, ni motif d'injection. */
export function validatePhotoDescription(raw: PhotoDescription): PhotoDescriptionValidation {
  // Un champ vide (« "brand": "" », fréquent chez les modèles de vision) vaut « inconnu » : null.
  const blank = (v: string | null | undefined) => (typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim() : null);
  const d: PhotoDescription = { ...raw, brand: blank(raw.brand), subcategory: blank(raw.subcategory), material: blank(raw.material), color: blank(raw.color) };
  const text = [d.title, d.brand, d.subcategory, d.material, d.color].filter(Boolean).join(" \n ");
  if (/<[a-z!/][^>]*>/i.test(text)) return { ok: false, code: "html", reason: "La description contient du HTML." };
  if (/https?:\/\/|www\./i.test(text)) return { ok: false, code: "link", reason: "La description contient un lien." };
  if (extractAllPricesCents(text).length > 0) return { ok: false, code: "price", reason: "La description donne un prix (interdit : le prix est calculé ailleurs)." };
  const scan = scanForInjection(text);
  if (scan.suspicious) return { ok: false, code: "injection_echo", reason: `La description reprend un motif suspect (${scan.matches[0]}).` };
  return { ok: true, description: { ...d, title: d.title.replace(/\s+/g, " ").trim() } };
}

// ---------------------------------------------------------------- Studio façon Kavis (§5.11)
// Le modèle 1 ne remplit rien qu'il n'a pas lu : la validation écarte une valeur sans provenance
// (readFrom absent, mesure sans ruban visible), une lecture peu sûre (confiance < 0,5 : valeur vide et
// question au vendeur), une marque absente du texte lu, une recopie de l'exemple du prompt, et tout ce
// qui ressemble à du HTML, un lien ou une injection.

/** Une valeur écartée par la validation, et pourquoi (journalisée, et convertie en question au vendeur). */
export interface FieldRejection {
  field: StudioQuestionField;
  code: "no_tape" | "not_read" | "low_confidence" | "not_in_text" | "example_echo" | "unsafe" | "implausible" | "no_evidence" | "duplicate";
  reason: string;
}

export type PhotoSortValidation = { ok: true; output: PhotoSortOutput; warnings: string[] } | { ok: false; code: string; reason: string };

/**
 * Tri des photos : une entrée par photo envoyée, positions dans [0, N-1] (une numérotation à partir de 1
 * est ramenée à 0), doublons et positions inconnues écartés, photo oubliée → « other » avec une confiance
 * nulle, groupes renumérotés 1, 2… dans l'ordre d'apparition.
 */
export function validatePhotoSort(out: PhotoSortOutput, photoCount: number): PhotoSortValidation {
  if (photoCount <= 0) return { ok: false, code: "empty", reason: "Aucune photo envoyée." };
  const warnings: string[] = [];
  let entries = out.photos;
  const indexes = entries.map((p) => p.index);
  // Numérotation de 1 à N (fréquente chez les modèles) : ramenée de 0 à N-1.
  if (indexes.length === photoCount && !indexes.includes(0) && indexes.every((i) => i >= 1 && i <= photoCount) && new Set(indexes).size === photoCount) {
    entries = entries.map((p) => ({ ...p, index: p.index - 1 }));
  }
  const byIndex = new Map<number, SortedPhoto>();
  let dropped = 0;
  for (const p of entries) {
    if (p.index < 0 || p.index >= photoCount || byIndex.has(p.index)) {
      dropped++;
      continue;
    }
    byIndex.set(p.index, p);
  }
  if (byIndex.size === 0) return { ok: false, code: "no_photo", reason: "Le tri ne correspond à aucune photo envoyée." };
  if (dropped > 0) warnings.push(`${dropped} entrée(s) du tri ignorée(s) (photo inconnue ou en double).`);
  const missing: number[] = [];
  const photos: SortedPhoto[] = [];
  let lastGroup = 1;
  for (let i = 0; i < photoCount; i++) {
    const p = byIndex.get(i);
    if (p) {
      photos.push({ ...p, confidence: Math.min(1, Math.max(0, p.confidence)) });
      lastGroup = p.articleGroup;
    } else {
      missing.push(i);
      photos.push({ index: i, role: "other", articleGroup: lastGroup, confidence: 0 });
    }
  }
  if (missing.length > 0) warnings.push(`Rôle inconnu pour ${missing.length} photo(s) : classées « autre », à vérifier.`);
  // Groupes renumérotés dans l'ordre d'apparition (1, 2, 3…).
  const order: number[] = [];
  for (const p of photos) if (!order.includes(p.articleGroup)) order.push(p.articleGroup);
  return { ok: true, output: { photos: photos.map((p) => ({ ...p, articleGroup: order.indexOf(p.articleGroup) + 1 })) }, warnings };
}

function unsafeText(text: string): string | null {
  if (/<[a-z!/][^>]*>/i.test(text)) return "HTML";
  if (/https?:\/\/|www\./i.test(text)) return "lien";
  if (extractAllPricesCents(text).length > 0) return "prix";
  const scan = scanForInjection(text);
  if (scan.suspicious) return `motif suspect (${scan.matches[0]})`;
  return null;
}

/**
 * La valeur figure-t-elle dans le texte lu (transcription du modèle ou de l'OCR) ? Comparaison sans
 * accents, casse ni ponctuation ; une valeur courte (« M », « 38 ») doit être un mot entier du texte.
 */
export function appearsInText(value: string, text: string): boolean {
  const v = simplifyText(value);
  const t = simplifyText(text);
  if (!v || !t) return false;
  const tokens = ` ${t} `;
  if (tokens.includes(` ${v} `)) return true;
  const compact = v.replace(/ /g, "");
  return compact.length >= 3 && t.replace(/ /g, "").includes(compact);
}

export interface LabelReadValidation {
  output: LabelReadOutput;
  questions: SellerQuestion[];
  rejected: FieldRejection[];
  /** Aucun texte transcrit (ni par le modèle, ni par l'OCR d'essai) : aucune valeur n'a pu être corroborée. */
  noTranscript: boolean;
}

const EMPTY_LABEL_FIELD = { value: null, confidence: 0, readFrom: null } as const;

/**
 * Lecture de l'étiquette : un champ n'est gardé que s'il est lu sur l'étiquette (`readFrom` « label »),
 * avec une confiance d'au moins 0,5, sans HTML ni lien ni motif suspect ; la marque, la taille et la
 * référence doivent en plus figurer dans le texte lu (transcription du modèle, texte de l'OCR d'essai).
 * SANS AUCUNE TRANSCRIPTION, rien n'est retenu (un modèle qui « reconnaît » une marque sans transcrire
 * l'étiquette l'a déduite du logo ou du style) : les quatre champs sont écartés avec une question au vendeur,
 * et le service tente l'OCR d'essai en second recours s'il est configuré. Exemption documentée : avec une
 * transcription, la matière n'est pas cherchée mot à mot dans le texte, car le modèle normalise la composition
 * (« 100% COTTON » → « 100 % coton ») ; elle reste exigée lue sur l'étiquette, avec sa confiance. Une marque
 * recopiée de l'exemple du prompt fait écarter toute la lecture. Chaque champ écarté devient vide, avec une
 * question au vendeur.
 */
export function validateLabelRead(raw: LabelReadOutput, ctx: { ocrText?: string | null } = {}): LabelReadValidation {
  const rejected: FieldRejection[] = [];
  const questions: SellerQuestion[] = [];
  const transcript = [raw.text, ctx.ocrText].filter((t): t is string => typeof t === "string" && t.trim().length > 0).join("\n");
  const noTranscript = transcript.length === 0;
  const echo = raw.brand.value !== null && simplifyText(raw.brand.value) === simplifyText(STUDIO_EXAMPLE_BRAND);
  const out: LabelReadOutput = { brand: { ...EMPTY_LABEL_FIELD }, size: { ...EMPTY_LABEL_FIELD }, material: { ...EMPTY_LABEL_FIELD }, reference: { ...EMPTY_LABEL_FIELD }, careSymbols: [], text: null };
  for (const key of LABEL_FIELDS) {
    const f = raw[key];
    const value = f.value?.replace(/\s+/g, " ").trim() || null;
    if (value === null) continue;
    const reject = (code: FieldRejection["code"], reason: string, reason_: StudioQuestionReason) => {
      rejected.push({ field: key, code, reason });
      questions.push(studioQuestion(key, reason_, reason_ === "low_confidence" ? { read: null } : {}));
    };
    if (echo) {
      reject("example_echo", "Lecture recopiée de l'exemple du prompt : rien n'a été lu.", "rejected");
      continue;
    }
    if (f.readFrom !== "label") {
      reject("not_read", `${key} non lu sur l'étiquette (provenance absente) : aucune déduction depuis le style.`, "rejected");
      continue;
    }
    if (f.confidence < STUDIO_MIN_CONFIDENCE) {
      reject("low_confidence", `${key} lu avec une confiance de ${f.confidence.toFixed(2)} (< ${STUDIO_MIN_CONFIDENCE}).`, "low_confidence");
      continue;
    }
    const unsafe = unsafeText(value);
    if (unsafe) {
      reject("unsafe", `${key} écarté (${unsafe}).`, "rejected");
      continue;
    }
    if (noTranscript) {
      reject("not_in_text", `${key} « ${value.slice(0, 40)} » sans aucun texte transcrit de l'étiquette : rien n'est retenu.`, "rejected");
      continue;
    }
    if (key !== "material" && !appearsInText(value, transcript)) {
      reject("not_in_text", `${key} « ${value.slice(0, 40)} » absent du texte lu sur l'étiquette.`, "rejected");
      continue;
    }
    out[key] = { value: value.slice(0, 80), confidence: f.confidence, readFrom: "label" };
  }
  const care = echo ? [] : (raw.careSymbols ?? []).map((c) => c.replace(/\s+/g, " ").trim()).filter((c) => c.length > 0 && !unsafeText(c));
  out.careSymbols = [...new Set(care)].slice(0, 12);
  const text = !echo && raw.text ? sanitizeUntrustedText(raw.text, 600) : "";
  out.text = text && !unsafeText(text) ? text : null;
  return { output: out, questions, rejected, noTranscript };
}

/** Bornes plausibles d'une mesure lue (cm) : au-delà, c'est une erreur de lecture (pouces, millimètres, autre graduation). */
export const MEASUREMENT_BOUNDS_CM: Record<MeasurementName, readonly [number, number]> = {
  chest: [15, 100],
  length: [15, 200],
  shoulders: [15, 80],
  sleeve: [5, 110],
  waist: [15, 100],
  hips: [15, 110],
  inseam: [5, 120],
  rise: [5, 60],
  sole: [5, 45],
};

export interface MeasurementsValidation {
  output: MeasurementsOutput;
  questions: SellerQuestion[];
  rejected: FieldRejection[];
}

/**
 * Mesures : sans mètre ruban visible, aucune mesure n'est gardée (un modèle qui en donne quand même les
 * a estimées « à l'œil ») ; chaque mesure gardée porte la preuve « tape_photo », une confiance d'au moins
 * 0,5 et une valeur plausible en cm (arrondie au demi-centimètre). Une mesure recopiée de l'exemple du
 * prompt est écartée. Chaque mesure écartée devient une question au vendeur.
 */
export function validateMeasurements(raw: MeasurementsOutput): MeasurementsValidation {
  const rejected: FieldRejection[] = [];
  const questions: SellerQuestion[] = [];
  const reject = (name: MeasurementName, code: FieldRejection["code"], reason: string, q: StudioQuestionReason) => {
    rejected.push({ field: name, code, reason });
    if (!questions.some((x) => x.field === name)) questions.push(studioQuestion(name, q));
  };
  if (!raw.tapeVisible) {
    for (const m of raw.measurements) if (m.valueCm !== null) reject(m.name, "no_tape", `${m.name} donnée sans mètre ruban visible : mesure estimée, écartée.`, "no_tape");
    return { output: { tapeVisible: false, measurements: [] }, questions, rejected };
  }
  const candidates = new Map<MeasurementName, MeasurementsOutput["measurements"]>();
  for (const m of raw.measurements) {
    if (m.valueCm === null) continue;
    if (m.evidence !== "tape_photo") {
      reject(m.name, "no_evidence", `${m.name} sans preuve « tape_photo » : écartée.`, "rejected");
      continue;
    }
    if (m.confidence < STUDIO_MIN_CONFIDENCE) {
      reject(m.name, "low_confidence", `${m.name} lue avec une confiance de ${m.confidence.toFixed(2)} (< ${STUDIO_MIN_CONFIDENCE}).`, "low_confidence");
      continue;
    }
    if (m.name === STUDIO_EXAMPLE_MEASUREMENT.name && m.valueCm === STUDIO_EXAMPLE_MEASUREMENT.valueCm) {
      reject(m.name, "example_echo", `${m.name} identique à l'exemple du prompt : écartée par prudence.`, "rejected");
      continue;
    }
    const [min, max] = MEASUREMENT_BOUNDS_CM[m.name];
    if (m.valueCm < min || m.valueCm > max) {
      reject(m.name, "implausible", `${m.name} = ${m.valueCm} cm hors des bornes plausibles (${min} à ${max} cm).`, "rejected");
      continue;
    }
    candidates.set(m.name, [...(candidates.get(m.name) ?? []), m]);
  }
  const kept = new Map<MeasurementName, MeasurementsOutput["measurements"][number]>();
  for (const [name, list] of candidates) {
    const values = list.map((m) => m.valueCm!);
    // Deux lectures de la même mesure : la plus sûre est gardée ; trop différentes, aucune.
    if (Math.max(...values) - Math.min(...values) > STUDIO_MEASUREMENT_TOLERANCE_CM) {
      reject(name, "duplicate", `${name} lue plusieurs fois avec des valeurs différentes (${values.join(", ")} cm).`, "rejected");
      continue;
    }
    const best = [...list].sort((a, b) => b.confidence - a.confidence)[0]!;
    kept.set(name, { ...best, valueCm: Math.round(best.valueCm! * 2) / 2 });
  }
  const order = new Map(MEASUREMENT_NAMES.map((n, i) => [n, i]));
  const measurements = [...kept.values()].sort((a, b) => order.get(a.name)! - order.get(b.name)!);
  return { output: { tapeVisible: true, measurements }, questions, rejected };
}
