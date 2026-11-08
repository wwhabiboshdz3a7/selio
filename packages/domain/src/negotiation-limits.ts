import type { FollowUp24hMode, Plan, Schedule, VintedLimits, VintedLimitsMeasurementInput } from "@selio/contracts";
import { FOLLOW_UP_24H_DEFAULT_DELAY_HOURS, FOLLOW_UP_24H_MAX_AGE_HOURS, PLAN_QUOTAS, VINTED_LIMITS_DEFAULTS, isPlan, vintedLimits } from "@selio/contracts";
import type { NegotiationResult } from "./negotiation";
import { isWithinSchedule } from "./time";

/**
 * Limites de Vinted et relance après 24 h (§5.12). Deux politiques pures, sans accès à la base :
 *
 * 1. **Limites de Vinted** : contre-offres par conversation, durée d'une offre, délai entre deux
 *    messages. Elles sont INCONNUES tant qu'elles n'ont pas été mesurées sur un vrai compte. Les valeurs
 *    par défaut (`VINTED_LIMITS_DEFAULTS` : 3 contre-offres, 48 h, 60 s) sont **prudentes et marquées
 *    « à mesurer »** (`source: "default_conservative"`). Rien ici n'est présenté comme vérifié.
 *
 *    PROTOCOLE DE MESURE (à faire par Ibrahim, à la main, sur un compte de l'équipe, jamais sur le
 *    compte d'un client ; voir `VINTED_LIMITS_MEASUREMENT_PROTOCOL` et docs/NEGOCIATION.md) :
 *    a. Un compte vendeur de l'équipe et un compte acheteur de l'équipe, une annonce de test sans valeur.
 *    b. Contre-offres : l'acheteur fait une offre ; le vendeur contre-propose ; répéter jusqu'à ce que
 *       Vinted refuse ou masque le bouton. Noter le nombre de contre-offres acceptées par conversation
 *       et le message exact affiché.
 *    c. Durée d'une offre : noter l'heure d'envoi d'une offre et l'heure d'expiration affichée, puis
 *       vérifier le lendemain que l'offre a bien expiré.
 *    d. Délai entre messages : envoyer quelques messages à la suite (10 au plus) dans la même
 *       conversation ; noter à partir de quel rythme Vinted ralentit, masque l'envoi ou avertit.
 *       ARRÊT au premier avertissement ou CAPTCHA : jamais de contournement, jamais d'insistance.
 *    e. Enregistrer les trois valeurs dans Automatisation › Négociation automatique, étape « Limites de Vinted »
 *       (`recordMeasuredLimits` : `source` devient « measured »). Garder les captures d'écran dans
 *       `livraison/`. Refaire la mesure chaque trimestre et après tout changement de l'interface Vinted :
 *       une valeur mesurée reste une observation datée, Vinted peut changer sans prévenir.
 *
 * 2. **Relance après 24 h** (`follow_up_24h`) : une conversation dont le dernier message est sortant
 *    depuis au moins `delayHours` (24 par défaut), sans réponse, reçoit **une seule** relance (clé
 *    d'idempotence `followUp24hDedupeKey`, sans jour : jamais une deuxième le lendemain). Le mode vient
 *    du quota `followUp24h` de l'offre : « suggested » (Pro) → brouillon à valider dans Messages (tâche
 *    serveur en attente de validation) ; « auto » (Agence) → tâche exécutée par Selio Cloud (cadence et
 *    plafonds du Cloud) ; « none » → rien. Hors des heures actives, la relance est différée.
 */

// ---------------------------------------------------------------- limites de Vinted

/** Étape du protocole de mesure, affichable par l'écran « Limites Vinted ». */
export interface MeasurementStep {
  step: number;
  title: string;
  detail: string;
}

export const VINTED_LIMITS_MEASUREMENT_PROTOCOL: readonly MeasurementStep[] = [
  { step: 1, title: "Deux comptes de l'équipe", detail: "Un compte vendeur et un compte acheteur de l'équipe, une annonce de test sans valeur. Jamais le compte d'un client." },
  { step: 2, title: "Contre-offres par conversation", detail: "L'acheteur fait une offre, le vendeur contre-propose ; répéter jusqu'à ce que Vinted refuse ou masque le bouton. Noter le nombre de contre-offres acceptées et le message exact affiché." },
  { step: 3, title: "Durée d'une offre", detail: "Noter l'heure d'envoi d'une offre et l'heure d'expiration affichée par Vinted, puis vérifier le lendemain que l'offre a expiré." },
  { step: 4, title: "Délai entre deux messages", detail: "Envoyer quelques messages à la suite (10 au plus) dans la même conversation et noter à partir de quel rythme Vinted ralentit, masque l'envoi ou avertit. Arrêt au premier avertissement ou CAPTCHA : aucun contournement." },
  { step: 5, title: "Enregistrer et dater", detail: "Saisir les trois valeurs dans Automatisation › Négociation automatique, étape « Limites de Vinted » (la date est fixée par le serveur à l'enregistrement) ; garder les captures d'écran. Refaire la mesure chaque trimestre et après un changement de l'interface Vinted." },
];

/** Les limites ont-elles été mesurées sur un vrai compte ? */
export function isMeasuredLimits(limits: Pick<VintedLimits, "source" | "measuredAt">): boolean {
  return limits.source === "measured" && limits.measuredAt !== null;
}

/** Statut lisible des limites (jamais « vérifiées » sans mesure datée). */
export function vintedLimitsStatus(limits: Pick<VintedLimits, "source" | "measuredAt">): { measured: boolean; label: string } {
  if (isMeasuredLimits(limits)) return { measured: true, label: `Mesurées sur un vrai compte le ${limits.measuredAt!.slice(0, 10)}` };
  return { measured: false, label: "Valeurs prudentes par défaut, à mesurer sur un vrai compte" };
}

/**
 * Enregistre une mesure faite sur un vrai compte : valeurs validées par le schéma, `source` « measured »,
 * date de la mesure. Lève une RangeError si une valeur est hors bornes.
 */
export function recordMeasuredLimits(current: VintedLimits, measured: VintedLimitsMeasurementInput, measuredAt: Date): VintedLimits {
  const parsed = vintedLimits.safeParse({ ...current, ...measured, measuredAt: measuredAt.toISOString(), source: "measured" });
  if (!parsed.success) throw new RangeError(`Mesure invalide : ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join(", ")}`);
  return parsed.data;
}

/** Date d'expiration d'une offre envoyée à `sentAt`, selon la durée (mesurée ou prudente). */
export function offerExpiresAt(sentAt: Date, limits: Pick<VintedLimits, "offerDurationHours">): Date {
  return new Date(sentAt.getTime() + limits.offerDurationHours * 3_600_000);
}

export interface LimitsContext {
  limits: VintedLimits;
  /** Contre-offres déjà envoyées par le vendeur dans cette conversation. */
  counterOffersSent: number;
  /** Dernier message sortant (null : aucun). */
  lastOutboundAt: Date | string | null;
  now: Date;
}

export type LimitsCheck =
  | { allowed: true; waitSeconds: 0 }
  | { allowed: false; reason: "max_counter_offers" | "too_soon"; waitSeconds: number; detail: string };

function elapsedSeconds(from: Date | string | null, now: Date): number | null {
  if (from === null) return null;
  const d = typeof from === "string" ? new Date(from) : from;
  if (Number.isNaN(d.getTime())) return null;
  return (now.getTime() - d.getTime()) / 1000;
}

const sourceLabel = (limits: Pick<VintedLimits, "source" | "measuredAt">) => (isMeasuredLimits(limits) ? "valeur mesurée" : "valeur prudente, à mesurer");

/** Un message sortant peut-il partir maintenant (délai minimal entre deux messages) ? */
export function checkMessageDelay(ctx: LimitsContext): LimitsCheck {
  const elapsed = elapsedSeconds(ctx.lastOutboundAt, ctx.now);
  const min = ctx.limits.minDelayBetweenMessagesSeconds;
  if (elapsed !== null && elapsed < min) {
    const waitSeconds = Math.ceil(min - elapsed);
    return { allowed: false, reason: "too_soon", waitSeconds, detail: `Délai minimal entre deux messages : ${min} s (${sourceLabel(ctx.limits)}) ; encore ${waitSeconds} s.` };
  }
  return { allowed: true, waitSeconds: 0 };
}

/**
 * Une contre-offre peut-elle partir ? Refus au-delà de `maxCounterOffersPerConversation`, puis respect du
 * délai entre deux messages. La politique ne dépasse jamais ces bornes, mesurées ou prudentes.
 */
export function applyLimits(ctx: LimitsContext): LimitsCheck {
  const max = ctx.limits.maxCounterOffersPerConversation;
  if (ctx.counterOffersSent >= max) {
    return { allowed: false, reason: "max_counter_offers", waitSeconds: 0, detail: `${ctx.counterOffersSent} contre-offre(s) déjà envoyée(s) dans cette conversation, limite ${max} (${sourceLabel(ctx.limits)}).` };
  }
  return checkMessageDelay(ctx);
}

export interface LimitedNegotiationResult extends NegotiationResult {
  limits: LimitsCheck;
  /** Quand la réponse peut partir (délai entre deux messages) ; null si rien ne la retient. */
  deferUntil: Date | null;
}

/**
 * Applique les limites de Vinted à une décision de la politique : une contre-proposition au-delà du
 * nombre de contre-offres devient une transmission au vendeur ; un message trop tôt après le précédent
 * est différé (« hold », `deferUntil`). Une décision qui n'envoie rien (transmission, attente) est inchangée.
 */
export function applyLimitsToDecision<T extends NegotiationResult>(result: T, ctx: LimitsContext): T & LimitedNegotiationResult {
  const sends = result.decision === "accept" || result.decision === "counter" || result.decision === "decline";
  if (!sends) return { ...result, limits: { allowed: true, waitSeconds: 0 }, deferUntil: null };
  const check = result.decision === "counter" ? applyLimits(ctx) : checkMessageDelay(ctx);
  if (check.allowed) return { ...result, limits: check, deferUntil: null };
  if (check.reason === "max_counter_offers") {
    return { ...result, decision: "escalate", counterCents: null, requiresApproval: true, reasons: [...result.reasons, `Limite Vinted : ${check.detail} Transmis au vendeur.`], limits: check, deferUntil: null };
  }
  return { ...result, decision: "hold", counterCents: null, requiresApproval: false, reasons: [...result.reasons, `${check.detail} Réponse différée.`], limits: check, deferUntil: new Date(ctx.now.getTime() + check.waitSeconds * 1000) };
}

// ---------------------------------------------------------------- relance après 24 h

/** Clé d'idempotence d'une relance : une seule par conversation, quel que soit le jour ou la règle. */
/**
 * Gabarit de relance acceptable (même règle que la validation de l'IA et que l'écran) : aucun chiffre
 * hors des variables {prenom} et {article}, jamais « meilleur prix » ni « dernier prix », aucun lien.
 * Vérifié côté serveur avant l'envoi : un gabarit modifié par l'API ne passe pas outre.
 */
export function followUpTemplateAllowed(template: string): boolean {
  if (/meilleur prix|dernier prix/i.test(template)) return false;
  if (/https?:\/\/|www\./i.test(template)) return false;
  return !/\d/.test(template.replace(/\{(prenom|article)\}/g, ""));
}

export function followUp24hDedupeKey(conversationId: string): string {
  return `follow_up_24h:${conversationId}`;
}

export interface FollowUpConversation {
  status: "open" | "archived";
  /** Sens du dernier message (null : conversation sans message). */
  lastMessageDirection: "inbound" | "outbound" | null;
  lastMessageAt: Date | string | null;
}

export type FollowUpAction = "none" | "draft" | "cloud";
export type FollowUpReasonCode =
  | "archived"
  | "item_unavailable"
  | "already_followed_up"
  | "not_in_plan"
  | "no_message"
  | "buyer_replied"
  | "delay_not_reached"
  | "too_old"
  | "outside_schedule"
  | "draft"
  | "cloud";

export interface FollowUpDecision {
  action: FollowUpAction;
  code: FollowUpReasonCode;
  reason: string;
  /** Où la tâche s'exécute : serveur (brouillon) ou Cloud ; null si aucune tâche. */
  runsIn: "server" | "cloud" | null;
  /** Statut initial de la tâche : brouillon à valider, ou en file pour le Cloud. */
  jobStatus: "awaiting_approval" | "queued" | null;
  hoursSinceLastMessage: number | null;
}

export interface FollowUpContext {
  conversation: FollowUpConversation;
  /** Offre (plan), quotas, ou mode déjà résolu. */
  plan: Plan | string | FollowUp24hMode | { followUp24h: FollowUp24hMode };
  now: Date;
  /** Une relance a déjà été créée pour cette conversation (brouillon, envoyée ou en file). */
  alreadyFollowedUp: boolean;
  /** Heures actives (règle, ou Cloud) ; absent : pas de contrainte horaire ici. */
  schedule?: Schedule | null;
  /** Délai avant relance (24 h par défaut). */
  delayHours?: number;
  /** Au-delà, on ne relance plus (7 jours par défaut). */
  maxAgeHours?: number;
  /**
   * L'article de la conversation est-il encore en vente (« listed », sans commande sur la conversation) ?
   * false : vendu, réservé, archivé ou commandé, jamais « toujours disponible ». Absent : conversation sans article.
   */
  itemAvailable?: boolean;
}

/** Mode de relance d'une offre : « none », « suggested » (Pro) ou « auto » (Agence). */
export function followUpModeFor(plan: FollowUpContext["plan"]): FollowUp24hMode {
  if (typeof plan === "object") return plan.followUp24h;
  if (plan === "none" || plan === "suggested" || plan === "auto") return plan;
  return isPlan(plan) ? PLAN_QUOTAS[plan].followUp24h : "none";
}

/** Décide s'il faut relancer, et comment. Fonction pure : voir l'en-tête du module. */
export function decideFollowUp(ctx: FollowUpContext): FollowUpDecision {
  const delayHours = ctx.delayHours ?? FOLLOW_UP_24H_DEFAULT_DELAY_HOURS;
  const maxAgeHours = ctx.maxAgeHours ?? FOLLOW_UP_24H_MAX_AGE_HOURS;
  const elapsed = elapsedSeconds(ctx.conversation.lastMessageAt, ctx.now);
  const hours = elapsed === null ? null : elapsed / 3600;
  const none = (code: FollowUpReasonCode, reason: string): FollowUpDecision => ({ action: "none", code, reason, runsIn: null, jobStatus: null, hoursSinceLastMessage: hours });

  if (ctx.conversation.status === "archived") return none("archived", "Conversation archivée : aucune relance.");
  if (ctx.itemAvailable === false) return none("item_unavailable", "Article vendu, réservé, retiré ou déjà commandé : aucune relance « toujours disponible ».");
  if (ctx.alreadyFollowedUp) return none("already_followed_up", "Une relance a déjà été faite dans cette conversation : jamais une deuxième.");
  const mode = followUpModeFor(ctx.plan);
  if (mode === "none") return none("not_in_plan", "La relance après 24 h n'est pas comprise dans l'offre.");
  if (ctx.conversation.lastMessageDirection === null || hours === null) return none("no_message", "Aucun message dans la conversation.");
  if (ctx.conversation.lastMessageDirection === "inbound") return none("buyer_replied", "Le dernier message vient de l'acheteur : rien à relancer, il attend une réponse.");
  if (hours < delayHours) return none("delay_not_reached", `Dernier message envoyé il y a ${Math.floor(hours)} h : relance à partir de ${delayHours} h.`);
  if (hours > maxAgeHours) return none("too_old", `Dernier message envoyé il y a plus de ${Math.floor(maxAgeHours / 24)} jours : on ne relance plus.`);
  if (ctx.schedule && !isWithinSchedule(ctx.schedule, ctx.now)) return none("outside_schedule", "Hors des heures actives : relance différée au prochain créneau.");
  if (mode === "suggested") {
    return { action: "draft", code: "draft", reason: "Offre Pro : brouillon de relance à valider dans Messages.", runsIn: "server", jobStatus: "awaiting_approval", hoursSinceLastMessage: hours };
  }
  return { action: "cloud", code: "cloud", reason: "Offre Agence : relance envoyée par Selio Cloud aux heures actives, dans ses plafonds.", runsIn: "cloud", jobStatus: "queued", hoursSinceLastMessage: hours };
}

export interface FollowUpRecheckInput {
  conversation: FollowUpConversation;
  /** Date de création de la tâche de relance : un message de l'acheteur reçu après annule la relance. */
  jobCreatedAt: Date | string;
  /** Dernier message reçu de l'acheteur (null : aucun). */
  lastInboundAt: Date | string | null;
  itemAvailable?: boolean;
  /** Mode de relance de l'offre AU MOMENT D'AGIR ; `requireMode` : mode exigé (Cloud : « auto »). */
  mode?: FollowUp24hMode;
  requireMode?: FollowUp24hMode;
}

export type FollowUpRecheck = { ok: true } | { ok: false; code: "archived" | "item_unavailable" | "buyer_replied" | "not_in_plan" | "plan_changed"; reason: string };

/**
 * Revérifie une relance déjà planifiée, juste avant de l'envoyer (Cloud, validation d'un brouillon, file
 * serveur) : entre la planification et l'envoi, l'acheteur a pu répondre, l'article être vendu, la
 * conversation archivée ou l'offre changer (Agence → Pro : la relance doit être validée). Fonction pure.
 */
export function recheckFollowUp(input: FollowUpRecheckInput): FollowUpRecheck {
  if (input.conversation.status === "archived") return { ok: false, code: "archived", reason: "Conversation archivée depuis la planification : relance abandonnée." };
  if (input.itemAvailable === false) return { ok: false, code: "item_unavailable", reason: "Article vendu, réservé ou retiré depuis la planification : relance abandonnée." };
  const created = new Date(input.jobCreatedAt).getTime();
  const inbound = input.lastInboundAt === null ? null : new Date(input.lastInboundAt).getTime();
  if (input.conversation.lastMessageDirection === "inbound" || (inbound !== null && Number.isFinite(inbound) && inbound >= created)) {
    return { ok: false, code: "buyer_replied", reason: "L'acheteur a répondu depuis la planification : relance abandonnée." };
  }
  if (input.mode !== undefined) {
    if (input.mode === "none") return { ok: false, code: "not_in_plan", reason: "La relance après 24 h n'est plus comprise dans l'offre : relance abandonnée." };
    if (input.requireMode !== undefined && input.mode !== input.requireMode) return { ok: false, code: "plan_changed", reason: "L'offre a changé : la relance doit maintenant être validée dans Messages." };
  }
  return { ok: true };
}

/** Défauts réexportés pour l'écran et les tests (toujours « à mesurer » tant que non mesurés). */
export const VINTED_LIMITS_TO_MEASURE: VintedLimits = VINTED_LIMITS_DEFAULTS;
