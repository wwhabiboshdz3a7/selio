import { cloudInboxSnapshot, type CloudInboxConversation, type CloudInboxSnapshot, type Job, type Message } from "@selio/contracts";
import { repos, type Tx } from "@selio/db";
import { isAutomatable, sanitizeUntrustedText, scanForInjection } from "@selio/domain";
import { type OrgContext, type Services } from "../context";
import { CONVERSATION_RULE_ORDER, runRuleTx } from "./automation";
import { ingestInboundTx, suggestReply } from "./messaging";

/**
 * Selio Cloud — enregistrement d'une lecture de la messagerie Vinted (D63), puis réponses automatiques.
 *
 * 1. Le contenu rendu par l'exécuteur est revalidé et borné (`cloudInboxSnapshot`) : c'est une donnée lue
 *    sur Vinted, jamais une instruction. Une conversation d'un autre compte Vinted est ignorée.
 * 2. Messages de l'acheteur : `ingestInboundTx`, dédoublonnés par `<conversation>:<date ou début du texte>`
 *    (même clé que l'extension). Messages du vendeur vus sur Vinted (réponse depuis le téléphone, ou message
 *    envoyé par Selio) : enregistrés comme envoyés, sans jamais doubler un message déjà connu de Selio (même
 *    clé, ou même texte déjà envoyé). Dernier message de Vinted au vendeur : plus rien de « non lu ».
 * 3. Règles de conversation actives (négociation, situation, réponse) lancées aussitôt avec le contexte
 *    système, dans cet ordre : les réponses partent par le Cloud (`decideRunsIn`), en file ou à valider selon
 *    la règle. Une conversation dont le dernier message est celui du vendeur n'est jamais relancée par une
 *    réponse (règles, puis revérification au moment d'envoyer).
 * 4. Réponse générique (`reply_on_new_message`) : rédigée par l'IA (si l'IA est active et que le réglage IA
 *    « Validation humaine avant envoi » est désactivé) par le même chemin que les suggestions
 *    (`suggestReply` : quota, décision de la politique imposée, sortie validée — aucun prix hors décision, ni
 *    lien, ni HTML), SANS repli simulé ; IA coupée, indisponible, sortie refusée ou message suspect
 *    (tentative d'injection) : gabarit de la règle. Jamais de texte vide ou refusé.
 * Le journal du Cloud ne reçoit que des comptes ; aucun texte ni pseudo n'est journalisé.
 */

export interface InboxProcessResult {
  listSource: CloudInboxSnapshot["listSource"] | "invalid";
  conversationsRead: number;
  messagesIn: number;
  messagesOut: number;
  jobsCreated: number;
  aiReplies: number;
}

/** Contexte « système » du worker (même forme que `systemContext` d'apps/worker). */
function systemContext(services: Services, orgId: string): OrgContext {
  return { services, orgId, userId: "system", role: "owner", isOperator: true, ip: null };
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** Clé de dédoublonnage d'un message lu (identique à l'extension : référence, puis date ou début du texte). */
export function inboxMessageKey(ref: string, m: { at?: string | null; body: string }): string {
  return `${ref}:${m.at ?? m.body.slice(0, 40)}`;
}

function validIso(at: string | null | undefined): string | null {
  if (!at) return null;
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Message de même sens et de même texte déjà enregistré : à 5 minutes près de la date lue, ou, sans date,
 * parmi les 20 derniers messages de la conversation. Préfère ignorer un « merci » répété plutôt que doubler.
 */
async function alreadyKnownTx(tx: Tx, conversationId: string, direction: "inbound" | "outbound", body: string, at: string | null): Promise<boolean> {
  const wanted = collapse(body);
  const msgs = (await repos.messages.forConversation(tx, conversationId)).filter((x) => x.direction === direction && x.status !== "draft" && collapse(x.body) === wanted);
  if (msgs.length === 0) return false;
  if (!at) {
    const recent = (await repos.messages.forConversation(tx, conversationId)).slice(-20).map((x) => x.id);
    return msgs.some((x) => recent.includes(x.id));
  }
  const t = new Date(at).getTime();
  return msgs.some((x) => Math.abs(new Date(x.sentAt ?? x.createdAt).getTime() - t) <= 5 * 60_000 || Math.abs(new Date(x.createdAt).getTime() - t) <= 5 * 60_000);
}

interface ConversationCounts {
  messagesIn: number;
  messagesOut: number;
  read: boolean;
}

/**
 * Enregistre une conversation lue. Les messages sans date reçoivent une date d'enregistrement croissante
 * (ordre de la page) juste avant `now`, pour que l'ordre dans Selio reste celui de Vinted.
 */
async function ingestConversationTx(ctx: OrgContext, tx: Tx, connectionId: string, c: CloudInboxConversation, now: Date): Promise<ConversationCounts> {
  const counts: ConversationCounts = { messagesIn: 0, messagesOut: 0, read: false };
  let conv = await repos.conversations.byExternalRef(tx, "vinted", c.ref);
  // Isolation : jamais une conversation rattachée à un autre compte Vinted.
  if (conv && conv.connectionId && conv.connectionId !== connectionId) return counts;
  if (conv && !conv.connectionId) conv = await repos.conversations.update(tx, conv.id, { connectionId });
  const buyerHandle = c.buyerHandle ?? (conv ? (await repos.customers.byId(tx, conv.customerId).catch(() => null))?.handle ?? null : null);
  const n = c.messages.length;
  for (let i = 0; i < n; i++) {
    const m = c.messages[i]!;
    const body = sanitizeUntrustedText(m.body, 2000);
    if (!body) continue;
    const at = validIso(m.at);
    const key = inboxMessageKey(c.ref, { at: m.at ?? null, body });
    if (await tx.maybeOne("select id from messages where org_id = $1 and external_ref = $2", [ctx.orgId, key])) continue;
    const createdAt = at ?? new Date(now.getTime() - (n - i)).toISOString();
    if (m.direction === "inbound") {
      if (!buyerHandle) continue;
      // Même message déjà connu sous une autre clé (lu une fois avec sa date, une fois sans : JSON puis HTML,
      // ou capturé par l'extension) : jamais en double.
      if (conv && (await alreadyKnownTx(tx, conv.id, "inbound", body, at))) continue;
      conv = await ingestInboundTx(ctx, tx, { connectionId, provider: "vinted", conversationRef: c.ref, buyerHandle, itemExternalRef: c.itemExternalRef ?? null, body, externalRef: key, at: createdAt, offerCents: m.offerCents ?? null });
      counts.messagesIn++;
      continue;
    }
    // Message du vendeur : seulement dans une conversation déjà connue (créée par un message de l'acheteur).
    if (!conv) continue;
    const known = (await repos.messages.forConversation(tx, conv.id)).find(
      (x) => x.direction === "outbound" && x.externalRef === null && collapse(x.body) === collapse(body) && (x.status === "sent" || x.status === "pending" || (x.status === "failed" && /incertain/i.test(x.error ?? ""))),
    );
    if (known) {
      // Message envoyé par Selio (ou dont l'envoi était incertain) et vu sur Vinted : il est bien parti.
      await repos.messages.update(tx, known.id, { externalRef: key, ...(known.status !== "sent" ? { status: "sent" as const, sentAt: known.sentAt ?? createdAt, error: null } : {}) });
      continue;
    }
    if (await alreadyKnownTx(tx, conv.id, "outbound", body, at)) continue;
    await repos.messages.create(tx, { conversationId: conv.id, direction: "outbound", source: "user", status: "sent", body, offerCents: m.offerCents ?? null, externalRef: key, sentAt: createdAt, createdAt });
    conv = await repos.conversations.update(tx, conv.id, { lastMessageAt: createdAt, lastMessagePreview: body.slice(0, 120) });
    counts.messagesOut++;
  }
  // Le dernier message sur Vinted est celui du vendeur : il a lu et répondu, rien n'est plus « non lu ».
  if (conv && c.messages[n - 1]?.direction === "outbound" && conv.unreadCount > 0) await repos.conversations.update(tx, conv.id, { unreadCount: 0 });
  counts.read = conv !== null;
  return counts;
}

/**
 * Enregistre une lecture réussie de la messagerie, lance les règles de conversation, puis fait rédiger par
 * l'IA les réponses génériques créées pour ce compte. Chaque étape a sa propre transaction ; la ligne de
 * journal de la lecture reçoit les comptes (clés fermées du contrat).
 */
export async function processInboxSnapshot(services: Services, orgId: string, target: { accountId: string; connectionId: string; jobId: string }, raw: unknown): Promise<InboxProcessResult> {
  const ctx = systemContext(services, orgId);
  const result: InboxProcessResult = { listSource: "invalid", conversationsRead: 0, messagesIn: 0, messagesOut: 0, jobsCreated: 0, aiReplies: 0 };
  const parsed = cloudInboxSnapshot.safeParse(raw ?? { conversations: [], listSource: "none" });
  const writeDetail = async () =>
    services.db.withOrg(orgId, async (tx) => {
      const action = await repos.cloudActions.byJob(tx, target.jobId);
      if (!action) return;
      await repos.cloudActions.update(tx, action.id, {
        detail: {
          ...action.detail,
          listSource: result.listSource === "invalid" ? "none" : result.listSource,
          conversationsListed: parsed.success ? parsed.data.listed ?? parsed.data.conversations.length : 0,
          conversationsRead: result.conversationsRead, messagesIn: result.messagesIn, messagesOut: result.messagesOut, jobsCreated: result.jobsCreated, aiReplies: result.aiReplies,
          ...(result.listSource === "invalid" ? { message: "lecture illisible : rien enregistré" } : result.listSource === "none" ? { message: "messagerie non reconnue : adaptateur à vérifier" } : {}),
        },
      });
    });
  if (!parsed.success) {
    await writeDetail();
    return result;
  }
  result.listSource = parsed.data.listSource;
  const now = services.now();

  // 1. Messages, dans une transaction (tout ou rien).
  await services.db.withOrg(orgId, async (tx) => {
    const account = await repos.cloudAccounts.byId(tx, target.accountId).catch(() => null);
    const connection = await repos.connections.byId(tx, target.connectionId).catch(() => null);
    // Compte arrêté pendant la lecture, connexion changée ou passée en Perso : rien n'est enregistré.
    if (!account || account.status === "stopped" || account.connectionId !== target.connectionId || !connection || !isAutomatable(connection)) return;
    for (const c of parsed.data.conversations) {
      const counts = await ingestConversationTx(ctx, tx, target.connectionId, c, now);
      result.messagesIn += counts.messagesIn;
      result.messagesOut += counts.messagesOut;
      if (counts.read) result.conversationsRead++;
    }
  });

  // 2. Règles de conversation, seulement s'il y a du nouveau de la part d'un acheteur.
  if (result.messagesIn > 0) {
    const rules = await services.db.withOrg(orgId, async (tx) => {
      if ((await repos.automationState.get(tx)).globalPaused) return [];
      return (await repos.rules.list(tx)).filter((r) => r.enabled && CONVERSATION_RULE_ORDER.includes(r.kind)).sort((a, b) => CONVERSATION_RULE_ORDER.indexOf(a.kind) - CONVERSATION_RULE_ORDER.indexOf(b.kind));
    });
    for (const rule of rules) {
      const r = await services.db.withOrg(orgId, (tx) => runRuleTx(ctx, tx, rule));
      result.jobsCreated += r.created;
    }
    // 3. Réponses génériques rédigées par l'IA (sinon gabarit de la règle au moment d'envoyer).
    const replyRuleIds = rules.filter((r) => r.kind === "reply_on_new_message").map((r) => r.id);
    const pending = await services.db.withOrg(orgId, (tx) => repos.jobs.cloudRepliesWithoutText(tx, target.accountId, replyRuleIds));
    for (const job of pending) if (await aiReplyForJob(ctx, job)) result.aiReplies++;
  }
  await writeDetail();
  return result;
}

/**
 * Fait rédiger par l'IA le texte d'une réponse Cloud encore en file. Vrai si un brouillon validé a été
 * rattaché à la tâche ; sinon la tâche est marquée (`aiTried`) et partira avec le gabarit de la règle.
 */
async function aiReplyForJob(ctx: OrgContext, job: Job): Promise<boolean> {
  const { services, orgId } = ctx;
  const conversationId = typeof job.payload.conversationId === "string" ? job.payload.conversationId : null;
  const mark = (reason: string) => services.db.withOrg(orgId, (tx) => repos.jobs.markAiTried(tx, job.id, reason)).then(() => false);
  if (!conversationId) return mark("no_conversation");
  const pre = await services.db.withOrg(orgId, async (tx) => {
    const org = await repos.orgs.byId(tx, orgId);
    const msgs: Message[] = await repos.messages.forConversation(tx, conversationId);
    return { aiEnabled: org.settings.ai.enabled, aiApproval: org.settings.ai.requireApproval, suspicious: msgs.some((m) => m.direction === "inbound" && scanForInjection(m.body).suspicious) };
  });
  if (!pre.aiEnabled) return mark("ai_disabled");
  // Réglage IA « Validation humaine avant envoi » : un brouillon IA ne part jamais seul. La réponse
  // automatique garde alors le gabarit de la règle (texte écrit par le vendeur lui-même).
  if (pre.aiApproval) return mark("ai_requires_approval");
  // Message qui ressemble à une tentative d'injection : aucune rédaction libre, gabarit du vendeur.
  if (pre.suspicious) return mark("suspicious");
  let draftId: string;
  try {
    const s = await suggestReply(ctx, conversationId, undefined, { allowFallback: false });
    if (s.source !== "ai" || !s.validated || !s.draft.body.trim()) {
      await services.db.withOrg(orgId, (tx) => repos.messages.delete(tx, s.draft.id));
      return mark("rejected");
    }
    draftId = s.draft.id;
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string" ? (err as { code: string }).code : "error";
    return mark(code);
  }
  const attached = await services.db.withOrg(orgId, (tx) => repos.jobs.attachCloudDraft(tx, job.id, draftId));
  // La tâche a changé entre-temps (annulée, prise, texte fixé) : le brouillon ne sert plus.
  if (!attached) await services.db.withOrg(orgId, (tx) => repos.messages.delete(tx, draftId)).catch(() => {});
  return attached;
}
