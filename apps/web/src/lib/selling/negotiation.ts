import type { AutomationRule, FollowUp24hMode, Message, NegotiationAutomation } from "@selio/contracts";
import { decideFollowUp, fillBundleTemplate, fillTemplate, keywordMatches, normalizeKeyword, type FollowUpDecision } from "@selio/domain";

/**
 * Aides d'écran de la négociation avancée (§5.12). Aucune décision ici : la politique déterministe
 * (@selio/domain) décide, ces fonctions ne font que l'afficher ou préparer un texte à valider.
 */

const eur = (c: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(c / 100);

/** Mots qui signalent qu'un acheteur parle d'un lot (comparés sans accents ni casse, en mots entiers). */
const BUNDLE_WORDS = ["lot", "lots", "les deux", "les 2", "les trois", "les 3", "plusieurs articles", "ensemble", "tout prendre", "je prends tout"];

/**
 * Le texte évoque-t-il un lot ? Repère d'affichage seulement (badge « Lot ») : le message reste une
 * DONNÉE non fiable, comparée à une liste fixe, jamais interprétée.
 */
export function mentionsBundle(text: string | null | undefined): boolean {
  const norm = normalizeKeyword(text ?? "");
  if (!norm) return false;
  return BUNDLE_WORDS.some((w) => keywordMatches(norm, normalizeKeyword(w)));
}

/** Identifiants des règles « relance après 24 h » de l'organisation. */
export function followUpRuleIds(rules: readonly Pick<AutomationRule, "id" | "kind">[]): Set<string> {
  return new Set(rules.filter((r) => r.kind === "follow_up_24h").map((r) => r.id));
}

/** Message issu de la relance après 24 h (brouillon proposé, ou relance déjà envoyée). */
export function isFollowUpMessage(m: Pick<Message, "ruleId" | "source" | "direction">, ruleIds: ReadonlySet<string>): boolean {
  return m.direction === "outbound" && m.source === "automation" && m.ruleId !== null && ruleIds.has(m.ruleId);
}

/** Libellés du mode de relance selon l'offre. */
export const FOLLOW_UP_MODE_LABELS: Record<FollowUp24hMode, { title: string; detail: string }> = {
  suggested: { title: "Relance proposée", detail: "Offre Pro : Selio prépare un brouillon de relance, à relire et valider dans la messagerie." },
  auto: { title: "Relance automatique via Selio Cloud", detail: "Offre Agence : la relance part seule depuis Selio Cloud, aux heures actives et dans les plafonds du Cloud." },
  none: { title: "Relance non comprise dans l'offre", detail: "La relance après 24 h est proposée en Pro (brouillon à valider) et automatique en Agence (via Selio Cloud)." },
};

/** Relance remplie pour l'aperçu ou le brouillon : {prenom} et {article}, aucun prix (la validation refuse tout chiffre). */
export function followUpText(template: string, vars: { prenom: string; article: string }): string {
  return fillTemplate(template, vars).trim();
}

/** Un modèle de relance contient-il un chiffre (hors variables) ? Un prix ou une date n'a rien à faire dans une relance. */
export function followUpHasDigits(template: string): boolean {
  return /\d/.test(template.replace(/\{(prenom|article)\}/g, ""));
}

/** Où en est la relance d'une conversation (affichage dans la messagerie). */
export function conversationFollowUp(input: {
  conversation: { status: "open" | "archived" };
  messages: readonly Pick<Message, "direction" | "status" | "createdAt" | "ruleId" | "source">[];
  mode: FollowUp24hMode;
  ruleIds: ReadonlySet<string>;
  now: Date;
  schedule?: { days: number[]; startHour: number; endHour: number; timezone: string } | null;
}): FollowUpDecision {
  const real = input.messages.filter((m) => m.status !== "draft" && m.status !== "failed");
  const last = real.reduce<(typeof real)[number] | null>((a, m) => (a === null || m.createdAt > a.createdAt ? m : a), null);
  return decideFollowUp({
    conversation: { status: input.conversation.status, lastMessageDirection: last ? last.direction : null, lastMessageAt: last ? last.createdAt : null },
    plan: input.mode,
    now: input.now,
    alreadyFollowedUp: input.messages.some((m) => isFollowUpMessage(m, input.ruleIds)),
    schedule: input.schedule ?? null,
  });
}

/**
 * Brouillon d'offre de lot proposé à un acheteur (« Créer le lot ») : la liste des articles puis le
 * gabarit de contre-offre de lot, au prix du lot (jamais sous son plancher, jamais « dernier prix » :
 * c'est une proposition, pas l'offre finale).
 */
export function bundleProposalText(input: { prenom: string; titles: readonly string[]; priceCents: number; listedTotalCents: number; messages: Pick<NegotiationAutomation["messages"], "bundleCounter"> }): string {
  const hello = input.prenom ? `Bonjour ${input.prenom},` : "Bonjour,";
  const list = input.titles.map((t) => `« ${t} »`).join(", ");
  const offer = fillBundleTemplate(input.messages.bundleCounter, { prenom: input.prenom, prix: eur(input.priceCents), prix_initial: eur(input.listedTotalCents), nb_articles: input.titles.length });
  return `${hello} je vous propose un lot : ${list}. ${offer}`.replace(/\s+/g, " ").trim();
}
