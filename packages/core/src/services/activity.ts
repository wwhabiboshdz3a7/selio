import {
  ACTIVITY_ACTOR_KINDS, ACTIVITY_STATUSES, ACTIVITY_TARGET_TYPES, ACTIVITY_VERBS, activityCursor, activityQuery, activityRecordInput, activityVerbsOf, parseActivityCursor,
  type ActivityActorKind, type ActivityPage, type ActivityRecordInput, type ActivityRow, type ActivityStatus, type ActivityTargetType, type ActivityVerb,
} from "@selio/contracts";
import { repos, type Tx } from "@selio/db";
import { describeActivity, sanitizeUntrustedText } from "@selio/domain";
import { AppError, requireAction, seesFinances, withOrg, type OrgContext, type Services } from "../context";

/**
 * Journal d'activité de Selio Manager : « Selio a fait une contre-offre à Léa : 35,00 € », « Studio a trié
 * 6 photos et lu l'étiquette », « Marie a mis « Veste Levi's » en vente »… Lu dans les traces existantes
 * (`repos.activity.list`), rien n'est dupliqué. Rôles : « org.read » (titulaire, administrateur, exécuteur,
 * lecture seule) ; sans « finances.read », les prix d'achat sont retirés des phrases et des données (la
 * réponse passe en plus par `redactForRole`). Jamais le texte d'un message d'acheteur.
 */

const VERBS: ReadonlySet<string> = new Set(ACTIVITY_VERBS);
const ACTORS: ReadonlySet<string> = new Set(ACTIVITY_ACTOR_KINDS);
const STATUSES: ReadonlySet<string> = new Set(ACTIVITY_STATUSES);
const TARGETS: ReadonlySet<string> = new Set(ACTIVITY_TARGET_TYPES);

export async function listActivity(ctx: OrgContext, raw: unknown): Promise<ActivityPage> {
  requireAction(ctx, "org.read");
  const parsed = activityQuery.safeParse(raw ?? {});
  if (!parsed.success) throw new AppError("validation", "Filtres du journal invalides", 400, parsed.error.flatten());
  const q = parsed.data;
  const actor = q.actor;
  const before = parseActivityCursor(q.cursor);
  if (q.cursor && !before) throw new AppError("validation", "Curseur du journal invalide", 400);
  const finances = seesFinances(ctx.role);
  return withOrg(ctx, async (tx) => {
    const rows = await repos.activity.list(tx, {
      verbs: q.category ? activityVerbsOf(q.category) : undefined,
      actorKind: actor === "selio" || actor === "studio" || actor === "bot" ? actor : actor === "members" ? "member" : undefined,
      actorUserId: actor && !["selio", "studio", "bot", "members"].includes(actor) ? actor : undefined,
      automatic: q.mode === "auto" ? true : q.mode === "manual" ? false : undefined,
      from: q.from,
      to: q.to,
      before,
      limit: q.limit + 1,
    });
    const members = await repos.memberships.listOrg(tx, ctx.orgId);
    const names = new Map(members.map((m) => [m.userId, m.user.displayName]));
    const page = rows.slice(0, q.limit);
    const entries = page.flatMap((r) => {
      const row = toRow(r);
      return row ? [describeActivity(row, { finances, memberName: (id) => names.get(id) ?? null })] : [];
    });
    const last = page[page.length - 1];
    return { entries, nextCursor: rows.length > q.limit && last ? activityCursor(last) : null };
  });
}

/** Ligne de la base vérifiée : verbe, acteur, cible et état connus ; sinon ignorée (jamais d'erreur). */
function toRow(r: repos.ActivityFeedRow): ActivityRow | null {
  if (!VERBS.has(r.verb) || !ACTORS.has(r.actorKind)) return null;
  return {
    id: r.id,
    at: r.at,
    verb: r.verb as ActivityVerb,
    actorKind: r.actorKind as ActivityActorKind,
    actorUserId: r.actorUserId,
    targetType: r.targetType && TARGETS.has(r.targetType) ? (r.targetType as ActivityTargetType) : null,
    targetId: r.targetId,
    itemId: r.itemId,
    itemTitle: r.itemTitle,
    counterpart: r.counterpart,
    priceCents: r.priceCents === null ? null : Number(r.priceCents),
    purchaseCents: r.purchaseCents === null ? null : Number(r.purchaseCents),
    status: STATUSES.has(r.status) ? (r.status as ActivityStatus) : "done",
    data: r.data ?? {},
  };
}

/**
 * Enregistre une action qui n'a pas de trace propre dans Selio (Selio Bot : offre envoyée, achat auto,
 * message, favori…). Elle apparaît dans le journal comme les autres, avec l'acteur donné (« Selio Bot » par
 * défaut). Rangée dans le journal d'audit (`activity.<verbe>`), donc gardée selon la même durée de rétention.
 *
 * - `summary` : phrase sans le sujet (« a envoyé une offre à Léa : 20,00 € »). Facultative : sinon la phrase par
 *   défaut du verbe. Jamais de prix d'achat ni de marge dedans, jamais le message complet d'un acheteur.
 * - `purchaseCents` : prix d'achat éventuel, montré seulement aux rôles qui voient les finances.
 * - `counterpart` : prénom ou pseudo de l'acheteur tel que la messagerie l'affiche.
 *
 * Exemple (dans une transaction de l'organisation) :
 *   await recordActivityTx(tx, { verb: "bot.offer_sent", counterpart: "Léa", priceCents: 2000, itemId, itemTitle, targetType: "conversation", targetId: convId });
 */
export async function recordActivityTx(tx: Tx, input: ActivityRecordInput): Promise<void> {
  const parsed = activityRecordInput.safeParse(input);
  if (!parsed.success) throw new AppError("validation", "Action du journal invalide", 400, parsed.error.flatten());
  const a = parsed.data;
  if (a.actor === "member" && !a.actorUserId) throw new AppError("validation", "Action d'un membre sans membre", 400);
  await repos.audit.add(tx, {
    actorUserId: a.actorUserId,
    action: `activity.${a.verb}`,
    targetType: a.targetType,
    targetId: a.targetId,
    meta: {
      actor: a.actor,
      status: a.status,
      ...(a.summary ? { summary: sanitizeUntrustedText(a.summary, 200) } : {}),
      targetType: a.targetType,
      targetId: a.targetId,
      itemId: a.itemId,
      itemTitle: a.itemTitle ? sanitizeUntrustedText(a.itemTitle, 200) : null,
      counterpart: a.counterpart ? sanitizeUntrustedText(a.counterpart, 60) : null,
      priceCents: a.priceCents,
      purchaseCents: a.purchaseCents,
    },
  });
}

/** Même chose hors transaction (worker, Selio Bot) : ouvre une transaction de l'organisation. */
export function recordActivity(services: Services, orgId: string, input: ActivityRecordInput): Promise<void> {
  return services.db.withOrg(orgId, (tx) => recordActivityTx(tx, input));
}
