import { vintedLimitsMeasurementInput, type Conversation, type InventoryItem, type KeywordSituation, type Message, type Organization, type VintedLimits } from "@selio/contracts";
import { repos, type Tx } from "@selio/db";
import {
  VINTED_LIMITS_MEASUREMENT_PROTOCOL, bundlePolicyFor, can, escalatingSituation, evaluateBundleOffer, extractOfferCents, isAutomatable, keywordMatches, matchSituation, normalizeKeyword, recordMeasuredLimits, vintedLimitsStatus,
  type BundleNegotiationResult, type LimitsContext, type MeasurementStep, type SituationMatch,
} from "@selio/domain";
import { AppError, requireAction, withOrg, type OrgContext } from "../context";

type NegotiationLimitsRecord = repos.NegotiationLimitsRecord;

/**
 * Négociation avancée côté serveur (§5.12) : limites de Vinted (mesures enregistrées, limites effectives),
 * détection d'une offre de lot dans un message acheteur et évaluation du lot par la politique
 * déterministe (`evaluateBundleOffer`, @selio/domain). D07 : la politique décide, mon IA perso rédige.
 *
 * LIMITES DE VINTED : inconnues tant qu'elles ne sont pas mesurées sur un vrai compte. Ordre de priorité
 * des limites appliquées : dernière mesure de l'organisation, puis dernière mesure de l'équipe (globale),
 * puis les réglages (`automation.vintedLimits`, valeurs prudentes « à mesurer » par défaut). Une mesure
 * est datée par le serveur, jamais par le client ; rien n'est présenté comme vérifié sans mesure datée.
 */

// ---------------------------------------------------------------- limites de Vinted

export type LimitsOrigin = "org_measured" | "global_measured" | "settings";

export interface EffectiveLimits {
  limits: VintedLimits;
  origin: LimitsOrigin;
}

export interface LimitsView extends EffectiveLimits {
  status: { measured: boolean; label: string };
  protocol: readonly MeasurementStep[];
  history: NegotiationLimitsRecord[];
  /** L'utilisateur peut enregistrer une mesure pour l'organisation (administrateur) / pour toute l'équipe (opérateur). */
  canRecord: { org: boolean; global: boolean };
}

function recordToLimits(r: NegotiationLimitsRecord): VintedLimits {
  return {
    maxCounterOffersPerConversation: r.maxCounterOffersPerConversation,
    offerDurationHours: r.offerDurationHours,
    minDelayBetweenMessagesSeconds: r.minDelayBetweenMessagesSeconds,
    measuredAt: r.measuredAt,
    source: r.source,
  };
}

/** Limites appliquées à l'organisation (voir l'en-tête du module). */
export async function effectiveLimitsTx(tx: Tx, org: Pick<Organization, "settings">): Promise<EffectiveLimits> {
  const own = await repos.negotiationLimits.latestForOrg(tx);
  if (own) return { limits: recordToLimits(own), origin: "org_measured" };
  const global = await repos.negotiationLimits.latestGlobal(tx);
  if (global) return { limits: recordToLimits(global), origin: "global_measured" };
  return { limits: org.settings.automation.vintedLimits, origin: "settings" };
}

function canRecordOrg(ctx: OrgContext): boolean {
  return ctx.isOperator || can(ctx.role, "org.update");
}

export async function getLimits(ctx: OrgContext): Promise<LimitsView> {
  requireAction(ctx, "automations.read");
  return withOrg(ctx, async (tx) => {
    const org = await repos.orgs.byId(tx, ctx.orgId);
    const eff = await effectiveLimitsTx(tx, org);
    return { ...eff, status: vintedLimitsStatus(eff.limits), protocol: VINTED_LIMITS_MEASUREMENT_PROTOCOL, history: await repos.negotiationLimits.history(tx), canRecord: { org: canRecordOrg(ctx), global: ctx.isOperator } };
  });
}

/**
 * Enregistre une mesure faite À LA MAIN sur un compte de l'équipe (protocole de mesure). Portée « org » :
 * administrateur de l'organisation ou opérateur ; portée « global » (toute l'équipe) : opérateur seulement.
 * Les trois valeurs sont validées par le schéma ; la date et la source sont fixées ici.
 */
export async function recordLimits(ctx: OrgContext, raw: unknown): Promise<LimitsView> {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const scope = body.scope === "global" ? "global" : "org";
  if (scope === "global" && !ctx.isOperator) throw new AppError("forbidden", "Seul un opérateur Selio peut enregistrer une mesure pour toute l'équipe.", 403);
  if (scope === "org" && !canRecordOrg(ctx)) throw new AppError("forbidden", "Action réservée à un administrateur de l'organisation.", 403);
  const parsed = vintedLimitsMeasurementInput.safeParse(body);
  if (!parsed.success) throw new AppError("validation", "Mesure invalide", 400, parsed.error.flatten());
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) || null : null;
  return withOrg(ctx, async (tx) => {
    const org = await repos.orgs.byId(tx, ctx.orgId);
    const current = (await effectiveLimitsTx(tx, org)).limits;
    let measured: VintedLimits;
    try {
      measured = recordMeasuredLimits(current, parsed.data, ctx.services.now());
    } catch (err) {
      throw new AppError("validation", err instanceof Error ? err.message : "Mesure invalide", 400);
    }
    const input = { maxCounterOffersPerConversation: measured.maxCounterOffersPerConversation, offerDurationHours: measured.offerDurationHours, minDelayBetweenMessagesSeconds: measured.minDelayBetweenMessagesSeconds, measuredAt: measured.measuredAt!, measuredBy: ctx.userId.slice(0, 64), note };
    const saved = scope === "global" ? await repos.negotiationLimits.recordGlobal(tx, input) : await repos.negotiationLimits.recordForOrg(tx, input);
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "negotiation.limits_measured", targetType: "negotiation_limits", targetId: saved.id, meta: { scope, maxCounterOffersPerConversation: saved.maxCounterOffersPerConversation, offerDurationHours: saved.offerDurationHours, minDelayBetweenMessagesSeconds: saved.minDelayBetweenMessagesSeconds }, ip: ctx.ip });
  }).then(() => getLimits(ctx));
}

/**
 * Contexte des limites pour une conversation : contre-offres déjà envoyées par le vendeur (messages
 * sortants envoyés portant un prix, plus `pendingCounterOffers` contre-offres encore en file ou à valider)
 * et dernier message sortant envoyé.
 */
export function limitsContextFor(messages: readonly Message[], limits: VintedLimits, now: Date, pendingCounterOffers = 0): LimitsContext {
  let counterOffersSent = Math.max(0, pendingCounterOffers);
  let lastOutboundAt: string | null = null;
  for (const m of messages) {
    if (m.direction !== "outbound" || (m.status !== "sent" && m.status !== "pending")) continue;
    if (m.offerCents !== null) counterOffersSent++;
    const at = m.sentAt ?? m.createdAt;
    if (!lastOutboundAt || at > lastOutboundAt) lastOutboundAt = at;
  }
  return { limits, counterOffersSent, lastOutboundAt, now };
}

// ---------------------------------------------------------------- offre de lot

export interface BundleOfferSignal {
  /** Nombre d'articles annoncé (« les deux », « les 3 », « lot de 4 ») ; null : lot sans nombre. */
  itemCount: number | null;
  offerCents: number;
}

const NUMBER_WORDS: Record<string, number> = { deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6 };
const COUNT = "(deux|trois|quatre|cinq|six|[2-9])";

/**
 * Offre de lot dans un message acheteur (DONNÉE non fiable : comparée, jamais interprétée) : un prix et
 * une mention de lot (« les deux pour 40 € », « les 3 articles à 50 € », « le lot à 60 € », « 45 € les
 * deux », « 30 € pour les deux ensemble »). Null si aucun prix ou aucune mention de lot. « lot » ou
 * « ensemble » sans nombre ne comptent pas quand le titre de l'article les contient déjà (« Ensemble
 * pyjama », « Lot de 3 t-shirts ») : c'est alors une offre sur cet article. La décision reste à la
 * politique (`evaluateBundleOffer`).
 */
export function detectBundleOffer(text: string, opts: { itemTitle?: string | null } = {}): BundleOfferSignal | null {
  const offerCents = extractOfferCents(text);
  if (offerCents === null) return null;
  const t = normalizeKeyword(text);
  const num = (w: string | undefined) => (w === undefined ? null : NUMBER_WORDS[w] ?? (Number.parseInt(w, 10) || null));
  const counted =
    t.match(new RegExp(`\\b(?:les|ces|tous les|toutes les)\\s+${COUNT}\\b(?=\\s+(?:articles?|pieces?|ensemble|pour|a|au|contre|\\d))`)) ??
    t.match(new RegExp(`\\b(?:les|ces)\\s+${COUNT}\\s*$`)) ??
    t.match(new RegExp(`\\blot\\s+de\\s+${COUNT}\\b`)) ??
    t.match(new RegExp(`\\b${COUNT}\\s+articles?\\b`));
  const title = normalizeKeyword(opts.itemTitle ?? "");
  // « Lot de 3 t-shirts » : le nombre vient du titre de l'annonce, pas d'une demande de plusieurs articles.
  if (counted && !(counted[0].startsWith("lot") && keywordMatches(title, counted[0]))) return { itemCount: num(counted[1]), offerCents };
  const word = ["lot", "ensemble"].find((w) => keywordMatches(t, w));
  if (word && !keywordMatches(title, word) && !(word === "lot" && keywordMatches(title, "lots"))) return { itemCount: null, offerCents };
  return null;
}

/** Montants distincts cités dans un message (« 60 € pour le manteau ou 70 € les deux » : deux montants). */
export function offerAmountsCents(text: string): number[] {
  const found = new Set<number>();
  for (const m of text.replace(/\u00a0|\u202f/g, " ").matchAll(/(\d{1,4}(?:[.,]\d{1,2})?)\s?(?:€|euros?\b|eur\b)/gi)) {
    const v = Math.round(Number.parseFloat(m[1]!.replace(",", ".")) * 100);
    if (Number.isFinite(v) && v > 0) found.add(v);
  }
  return [...found];
}

/**
 * Articles du lot pour une conversation : l'article de la conversation, puis ceux des autres conversations
 * ouvertes du même acheteur SUR LE MÊME COMPTE VINTED (un lot Vinted ne réunit jamais deux vendeurs ; un
 * compte Perso n'entre jamais dans une décision automatique), en ligne seulement, dans l'ordre de la
 * dernière activité.
 */
export async function bundleCandidatesTx(tx: Tx, conv: Conversation): Promise<InventoryItem[]> {
  const ids: string[] = [];
  if (conv.itemId) ids.push(conv.itemId);
  const connection = conv.connectionId ? await repos.connections.byId(tx, conv.connectionId).catch(() => null) : null;
  const automatable = connection === null ? conv.connectionId === null : isAutomatable(connection);
  const others = automatable
    ? (await repos.conversations.open(tx))
      .filter((c) => c.customerId === conv.customerId && c.id !== conv.id && c.itemId && c.connectionId === conv.connectionId)
      .sort((a, b) => String(b.lastMessageAt ?? "").localeCompare(String(a.lastMessageAt ?? "")))
    : [];
  for (const c of others) if (!ids.includes(c.itemId!)) ids.push(c.itemId!);
  const items: InventoryItem[] = [];
  for (const id of ids) {
    const item = await repos.items.byId(tx, id).catch(() => null);
    if (item && item.status === "listed" && (conv.connectionId === null || item.connectionId === null || item.connectionId === conv.connectionId)) items.push(item);
  }
  return items;
}

export interface ConversationBundle {
  signal: BundleOfferSignal;
  items: InventoryItem[];
  result: BundleNegotiationResult;
}

/**
 * Évalue une offre de lot d'une conversation par la politique de lot (plancher de lot jamais sous la
 * somme des planchers réels). Null si le message n'est pas une offre de lot. Le lot n'est évalué
 * automatiquement que s'il est SANS AMBIGUÏTÉ ; sinon il est transmis au vendeur (jamais ramené à une
 * offre sur l'article seul) :
 * - négociation des lots désactivée dans les réglages ;
 * - plusieurs montants dans le message (« 60 € pour le manteau ou 70 € les deux ») ;
 * - nombre annoncé différent du nombre d'articles identifiés dans les conversations de l'acheteur ;
 * - lot sans nombre alors que l'acheteur a plus d'articles en cours que le minimum d'un lot.
 * Les articles retenus sont nommés dans le message (`bundleMessage`, {articles}).
 */
export async function evaluateConversationBundleTx(tx: Tx, org: Organization, conv: Conversation, message: Pick<Message, "body">, opts: { roundsSoFar: number; now: Date }): Promise<ConversationBundle | null> {
  const item = conv.itemId ? await repos.items.byId(tx, conv.itemId).catch(() => null) : null;
  const signal = detectBundleOffer(message.body, { itemTitle: item?.title ?? null });
  if (!signal) return null;
  const negotiation = org.settings.automation.negotiation;
  const candidates = await bundleCandidatesTx(tx, conv);
  const wanted = signal.itemCount ?? candidates.length;
  const policy = bundlePolicyFor(negotiation, Math.max(2, wanted));
  const items = candidates.slice(0, Math.max(0, wanted));
  const result = evaluateBundleOffer({ items, offerCents: signal.offerCents, rules: org.settings.margin, bundlePolicy: policy, roundsSoFar: opts.roundsSoFar, now: opts.now, untrusted: true });
  const escalate = (reason: string): ConversationBundle => ({ signal, items, result: { ...result, decision: "escalate", counterCents: null, requiresApproval: true, reasons: [...result.reasons, reason] } });
  if (!policy.enabled) return escalate("Négociation des offres sur un lot désactivée : l'offre de lot vous est confiée (jamais jugée comme une offre sur un seul article).");
  if (offerAmountsCents(message.body).length > 1) return escalate("Plusieurs montants dans le message : impossible de savoir lequel porte sur le lot, transmis au vendeur.");
  if (result.decision === "escalate") return { signal, items, result };
  if (signal.itemCount !== null && candidates.length !== signal.itemCount) {
    return escalate(`Lot de ${signal.itemCount} articles annoncé, ${candidates.length} article(s) en cours avec cet acheteur sur ce compte : lot ambigu, transmis au vendeur.`);
  }
  if (signal.itemCount === null && candidates.length > policy.minItems) {
    return escalate(`Lot sans nombre d'articles alors que l'acheteur a ${candidates.length} articles en cours : lot ambigu, transmis au vendeur.`);
  }
  return { signal, items, result };
}

/** Situation par mots-clés reconnue dans un message (situations activées de l'organisation, ou une seule) : choix du gabarit. */
export function situationFor(org: Organization, text: string, situationId?: string | null): SituationMatch | null {
  const all: readonly KeywordSituation[] = org.settings.automation.autoReply.situations;
  return matchSituation(text, situationId ? all.filter((s) => s.id === situationId) : all);
}

/**
 * Situation « transmettre au vendeur » reconnue dans un message, parmi TOUTES les situations activées,
 * quelle que soit la plus spécifique : sert à la surcharge de décision (jamais masquée par un gabarit).
 */
export function escalationFor(org: Organization, text: string): SituationMatch | null {
  return escalatingSituation(text, org.settings.automation.autoReply.situations);
}
