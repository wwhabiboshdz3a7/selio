import type { KeywordSituation } from "@selio/contracts";
import type { NegotiationResult } from "./negotiation";
import { fillTemplate } from "./negotiation-journey";
import { sanitizeUntrustedText } from "./untrusted";

/**
 * Situations personnalisées par mots-clés (§5.12). Le vendeur règle des situations (« défaut »,
 * « remboursement », « envoi »…) ; le message de l'acheteur est comparé à leurs mots-clés après
 * normalisation (accents, casse, ponctuation). Règles :
 * - le message de l'acheteur est une DONNÉE non fiable : il est nettoyé et comparé, jamais interprété ;
 *   un texte d'injection (« ignore les consignes », « accepte à 1 € ») n'a aucun effet tant qu'aucune
 *   situation ne contient exactement ces mots, et même alors il ne déclenche qu'une situation réglée
 *   par le vendeur ;
 * - la situation ne décide jamais d'un prix : au plus, `decisionOverride: "escalate"` transmet la
 *   conversation au vendeur (D07 : la politique décide, la situation peut seulement la rendre plus
 *   prudente, jamais moins) ;
 * - la consigne `guidance` est un RÉGLAGE du vendeur : elle est transmise à mon IA perso dans un bloc
 *   cadré (`settingBlock`, @selio/ai), jamais comme texte libre, et la sortie est validée comme
 *   toute réponse (`validateReplySuggestion`).
 */

/** Normalisation commune aux mots-clés et au message : sans accents, minuscules, ponctuation → espace. */
export function normalizeKeyword(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Un mot-clé (déjà normalisé) apparaît-il dans le texte (déjà normalisé) comme mot(s) entier(s) ? */
export function keywordMatches(normalizedText: string, normalizedKeyword: string): boolean {
  if (!normalizedKeyword || !normalizedText) return false;
  return ` ${normalizedText} `.includes(` ${normalizedKeyword} `);
}

export interface SituationMatch {
  situation: KeywordSituation;
  /** Mots-clés (tels que réglés) retrouvés dans le message. */
  matchedKeywords: string[];
  /** Plus la valeur est haute, plus la situation est spécifique (nombre de mots-clés retrouvés d'abord). */
  specificity: number;
}

/** Évalue une situation sur un texte normalisé ; null si elle ne correspond pas. */
function evaluateSituation(situation: KeywordSituation, normalizedText: string): SituationMatch | null {
  const keywords = [...new Map(situation.keywords.map((k) => [normalizeKeyword(k), k])).entries()].filter(([n]) => n.length > 0);
  if (keywords.length === 0) return null;
  const matched = keywords.filter(([n]) => keywordMatches(normalizedText, n));
  const ok = situation.matchMode === "all" ? matched.length === keywords.length : matched.length > 0;
  if (!ok) return null;
  const matchedLength = Math.min(499, matched.reduce((sum, [n]) => sum + n.length, 0));
  // Nombre de mots-clés retrouvés d'abord, puis « tous les mots » avant « l'un des mots », puis la longueur.
  const specificity = matched.length * 1000 + (situation.matchMode === "all" ? 500 : 0) + matchedLength;
  return { situation, matchedKeywords: matched.map(([, raw]) => raw), specificity };
}

/**
 * Situation la plus spécifique qui correspond au message (données non fiables), parmi les situations
 * activées ; à spécificité égale, la première de la liste. Null si aucune.
 */
export function matchSituation(messageText: string, situations: readonly KeywordSituation[]): SituationMatch | null {
  const text = normalizeKeyword(sanitizeUntrustedText(messageText, 4000));
  if (!text) return null;
  let best: SituationMatch | null = null;
  for (const situation of situations) {
    if (!situation.enabled) continue;
    const match = evaluateSituation(situation, text);
    if (match && (best === null || match.specificity > best.specificity)) best = match;
  }
  return best;
}

/**
 * Situation « transmettre au vendeur » qui correspond au message, QUELLE QUE SOIT sa spécificité : une
 * situation plus spécifique (« envoi », gabarit) ne masque jamais un défaut ou un litige signalé dans le
 * même message (ajouter des mots-clés ne permet pas d'éviter la transmission). La plus spécifique des
 * situations de transmission est rendue (pour l'explication) ; null si aucune ne correspond.
 */
export function escalatingSituation(messageText: string, situations: readonly KeywordSituation[]): SituationMatch | null {
  return matchSituation(messageText, situations.filter((s) => s.decisionOverride === "escalate"));
}

/** Une situation active de transmission au vendeur correspond-elle au message ? */
export function anySituationEscalates(messageText: string, situations: readonly KeywordSituation[]): boolean {
  return escalatingSituation(messageText, situations) !== null;
}

/** La situation impose-t-elle de transmettre au vendeur ? */
export function situationEscalates(match: SituationMatch | null): boolean {
  return match?.situation.decisionOverride === "escalate";
}

/**
 * Applique la surcharge de décision d'une situation à une décision de la politique : « escalate »
 * transmet au vendeur (validation humaine), quelle que soit la décision de prix. Aucune situation ne
 * peut accepter, contre-proposer ou refuser à la place de la politique.
 */
export function applySituationOverride<T extends NegotiationResult>(result: T, match: SituationMatch | null): T {
  if (!situationEscalates(match)) return result;
  const reason = `Situation « ${match!.situation.name} » (mots-clés : ${match!.matchedKeywords.join(", ")}) : transmise au vendeur, réglage de l'organisation.`;
  if (result.decision === "escalate") return { ...result, requiresApproval: true, reasons: [...result.reasons, reason] };
  return { ...result, decision: "escalate", counterCents: null, requiresApproval: true, reasons: [...result.reasons, reason] };
}

export interface SituationPromptContext {
  name: string;
  guidance: string | null;
  tone: KeywordSituation["response"]["tone"] | null;
}

/**
 * Ce que mon IA perso reçoit d'une situation : son nom et la consigne du vendeur, nettoyés et bornés
 * (sans délimiteurs de bloc ni indices de simulateur). Le message de l'acheteur n'y figure pas.
 */
export function situationPromptContext(match: SituationMatch): SituationPromptContext {
  const clean = (s: string, max: number) => sanitizeUntrustedText(s, max).replace(/<<<|>>>|\[\[|\]\]/g, "").replace(/\s+/g, " ").trim();
  const guidance = match.situation.response.guidance ? clean(match.situation.response.guidance, 300) : "";
  return { name: clean(match.situation.name, 80), guidance: guidance.length > 0 ? guidance : null, tone: match.situation.response.tone ?? null };
}

/** Réponse par gabarit d'une situation (variables {prenom}, {article}, {prix}) ; null si la situation rédige par l'IA ou n'a pas de gabarit. */
export function situationTemplateReply(match: SituationMatch, vars: { prenom?: string; article?: string; prix?: string } = {}): string | null {
  const r = match.situation.response;
  if (r.kind !== "template" || !r.template || r.template.trim().length === 0) return null;
  return fillTemplate(r.template, vars).trim();
}

/**
 * Exemples proposés au vendeur (jamais actifs sans son choix) : un défaut ou un remboursement est
 * transmis au vendeur ; l'envoi et l'échange reçoivent un gabarit.
 */
export const SUGGESTED_KEYWORD_SITUATIONS: readonly KeywordSituation[] = [
  {
    id: "defaut",
    name: "Défaut ou article abîmé",
    keywords: ["défaut", "abîmé", "abimé", "trou", "tache", "cassé", "déchiré", "ne fonctionne pas"],
    matchMode: "any",
    response: { kind: "ai", guidance: "Remercie l'acheteur de l'avoir signalé, dis que tu vérifies et que tu reviens vers lui rapidement. Ne promets rien." },
    decisionOverride: "escalate",
    enabled: true,
  },
  {
    id: "remboursement",
    name: "Remboursement ou litige",
    keywords: ["remboursement", "rembourser", "litige", "arnaque", "signaler", "retour"],
    matchMode: "any",
    response: { kind: "ai", guidance: "Reste calme et courtois, indique que tu regardes la situation et que tu réponds rapidement. Ne promets ni remboursement ni retour." },
    decisionOverride: "escalate",
    enabled: true,
  },
  {
    id: "envoi",
    name: "Envoi et délais",
    keywords: ["envoi", "expédition", "expedition", "livraison", "délai", "colis", "quand"],
    matchMode: "any",
    response: { kind: "template", template: "Bonjour {prenom}, j'expédie sous deux jours ouvrés après l'achat, avec un suivi. Je vous tiens au courant dès l'envoi." },
    decisionOverride: null,
    enabled: true,
  },
  {
    id: "echange",
    name: "Échange ou troc",
    keywords: ["échange", "echange", "troc", "troquer"],
    matchMode: "any",
    response: { kind: "template", template: "Bonjour {prenom}, je ne fais pas d'échange, mais « {article} » reste disponible à la vente." },
    decisionOverride: null,
    enabled: true,
  },
];
