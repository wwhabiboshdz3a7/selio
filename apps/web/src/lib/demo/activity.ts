import {
  ACTIVITY_ACTOR_KINDS, ACTIVITY_VERBS, activityCursor, activityQuery, activityVerbsOf, parseActivityCursor,
  type ActivityActorKind, type ActivityPage, type ActivityQuery, type ActivityRow, type ActivityStatus, type ActivityTargetType, type ActivityVerb, type AuditLog, type Customer, type Role,
} from "@selio/contracts";
import { can, counterpartName, describeActivity } from "@selio/domain";
import type { DemoState } from "@selio/demo-data";
import { DataError, type StudioPrepView } from "../data/types";

/**
 * Journal d'activité de la démonstration : mêmes sources et mêmes règles que le serveur
 * (`repos.activity.list` + `listActivity`, @selio/core) — historique des articles, préparations Studio,
 * messages envoyés à la main, tâches des automatisations, commandes et bordereaux, achats, journal d'audit
 * (dont les actions « activity.* » de Selio Bot). Phrases de @selio/domain (`describeActivity`).
 */

const VERBS: ReadonlySet<string> = new Set(ACTIVITY_VERBS);
const ACTORS: ReadonlySet<string> = new Set(ACTIVITY_ACTOR_KINDS);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
const text = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function base(id: string, at: string, verb: ActivityVerb, actorKind: ActivityActorKind, actorUserId: string | null): ActivityRow {
  return { id, at, verb, actorKind, actorUserId, targetType: null, targetId: null, itemId: null, itemTitle: null, counterpart: null, priceCents: null, purchaseCents: null, status: "done", data: {} };
}

export function demoActivityRows(st: DemoState, preps: StudioPrepView[]): ActivityRow[] {
  const rows: ActivityRow[] = [];
  const items = new Map(st.items.map((i) => [i.id, i]));
  const customers = new Map(st.customers.map((c) => [c.id, c]));
  const conversations = new Map(st.conversations.map((c) => [c.id, c]));
  const who = (c: Customer | undefined) => (c ? counterpartName(c.displayName, c.handle) : null);
  const auditBy = (action: string, targetId: string): AuditLog | undefined => st.audit.find((a) => a.action === action && a.targetId === targetId);

  for (const e of st.itemEvents) {
    const item = items.get(e.itemId);
    const radar = e.kind === "created" && (e.changes.source as { to?: unknown } | undefined)?.to === "radar";
    const draft = e.kind === "created" && e.note === "Brouillon du générateur";
    const changes = e.changes as Record<string, unknown>;
    const onlyPhotos = "photos" in changes && Object.keys(changes).length === 1;
    const verb: ActivityVerb = e.kind === "imported" ? "item.imported" : e.kind === "captured" ? "item.captured" : draft ? "item.studio_draft" : radar ? "item.radar_bought"
      : e.kind === "created" ? "item.created" : e.note?.startsWith("Republication") ? "item.republished" : e.note === "Photos ajoutées" || onlyPhotos ? "item.photos_added"
      : e.kind === "status_changed" || e.kind === "archived" || e.kind === "restored" ? "item.status_changed" : e.kind === "price_changed" ? "item.price_changed" : "item.updated";
    const actor: ActivityActorKind = draft ? "studio" : radar ? "selio" : e.actorUserId ? "member" : "selio";
    rows.push({ ...base(`ie:${e.id}`, e.createdAt, verb, actor, e.actorUserId), targetType: "item", targetId: e.itemId, itemId: e.itemId, itemTitle: item?.title ?? null, purchaseCents: radar ? item?.purchasePriceCents ?? null : null, data: { changes: e.changes, variant: e.note?.match(/variante .*/)?.[0] ?? null } });
  }

  // Annonces rédigées par l'IA dans le jeu de démonstration (sans préparation Studio enregistrée) : Studio les a rédigées.
  const prepped = new Set(preps.map((p) => p.itemId).filter(Boolean));
  for (const it of st.items) {
    if (it.attributes.generatedBy !== "ai" || prepped.has(it.id)) continue;
    rows.push({ ...base(`sl:item:${it.id}`, it.createdAt, "studio.listing_written", "studio", null), targetType: "item", targetId: it.id, itemId: it.id, itemTitle: it.title, priceCents: it.listedPriceCents });
  }

  for (const p of preps) {
    const item = p.itemId ? items.get(p.itemId) : undefined;
    const fields = p.fields as Record<string, { value?: unknown; source?: unknown } | undefined>;
    const title = item?.title ?? ([text(fields.brand?.value), text(fields.size?.value)].filter(Boolean).join(" ") || null);
    const label = (k: string) => (fields[k]?.source === "label" ? text(fields[k]?.value) : null);
    rows.push({ ...base(`sp:${p.prepId}`, p.createdAt, "studio.prepared", "studio", null), targetType: "studio_prep", targetId: p.prepId, itemId: p.itemId, itemTitle: title, data: { photos: p.photos.length, labelRead: Object.values(fields).some((f) => f?.source === "label"), brand: label("brand"), size: label("size") } });
    if (p.listingGeneratedAt) rows.push({ ...base(`sl:${p.prepId}`, p.listingGeneratedAt, "studio.listing_written", "studio", null), targetType: p.itemId ? "item" : "studio_prep", targetId: p.itemId ?? p.prepId, itemId: p.itemId, itemTitle: title, priceCents: item?.listedPriceCents ?? null });
  }

  for (const m of st.messages) {
    if (m.direction !== "outbound" || m.status !== "sent" || m.source === "automation") continue;
    const conv = conversations.get(m.conversationId);
    const item = conv?.itemId ? items.get(conv.itemId) : undefined;
    const actorUserId = auditBy("message.sent", m.id)?.actorUserId ?? st.user.id;
    rows.push({ ...base(`ms:${m.id}`, m.sentAt ?? m.createdAt, "message.sent", "member", actorUserId), targetType: "conversation", targetId: m.conversationId, itemId: conv?.itemId ?? null, itemTitle: item?.title ?? null, counterpart: who(conv ? customers.get(conv.customerId) : undefined), priceCents: m.offerCents, data: { ai: m.source === "ai" } });
  }

  const rules = new Map(st.rules.map((r) => [r.id, r]));
  for (const j of st.jobs) {
    if (!j.kind.startsWith("automation.") || !["succeeded", "awaiting_approval", "failed"].includes(j.status)) continue;
    const p = j.payload;
    const verb: ActivityVerb = j.kind !== "automation.send_message" ? "automation.action"
      : p.decision === "accept" ? "negotiation.accepted" : p.decision === "counter" ? "negotiation.countered" : p.decision === "decline" || p.decision === "refuse" ? "negotiation.refused"
      : p.followUp === true ? "followup.sent" : p.handoff === true ? "automation.handoff" : "automation.reply_sent";
    const convId = text(p.conversationId);
    const conv = convId ? conversations.get(convId) : undefined;
    const itemId = conv?.itemId ?? text(p.itemId);
    const status: ActivityStatus = j.status === "succeeded" ? "done" : j.status === "awaiting_approval" ? "pending" : "failed";
    const targetType: ActivityTargetType = convId ? "conversation" : text(p.itemId) ? "item" : "job";
    rows.push({ ...base(`jb:${j.id}`, j.finishedAt ?? j.createdAt, verb, "selio", null), targetType, targetId: convId ?? text(p.itemId) ?? j.id, itemId, itemTitle: itemId ? items.get(itemId)?.title ?? null : null, counterpart: who(conv ? customers.get(conv.customerId) : undefined), priceCents: num(p.offerCents), status, data: { ruleName: text(p.ruleName) ?? (j.ruleId ? rules.get(j.ruleId)?.name ?? null : null) } });
  }

  for (const o of st.orders) {
    const item = items.get(o.itemId);
    const actorUserId = auditBy("order.created", o.id)?.actorUserId ?? null;
    rows.push({ ...base(`or:${o.id}`, o.createdAt, "order.created", actorUserId ? "member" : "selio", actorUserId), targetType: "order", targetId: o.id, itemId: o.itemId, itemTitle: item?.title ?? null, counterpart: who(customers.get(o.customerId)), priceCents: o.salePriceCents });
  }
  const orders = new Map(st.orders.map((o) => [o.id, o]));
  for (const s of st.shipments) {
    const o = orders.get(s.orderId);
    if (!o || !s.document) continue;
    rows.push({ ...base(`sh:${s.id}`, s.createdAt, "shipment.label_ready", "selio", null), targetType: "order", targetId: o.id, itemId: o.itemId, itemTitle: items.get(o.itemId)?.title ?? null });
  }

  const opportunities = new Map(st.opportunities.map((o) => [o.id, o]));
  for (const pr of st.purchases) {
    const title = opportunities.get(pr.opportunityId)?.title ?? null;
    const paid = pr.totalCents ?? pr.maxPriceCents;
    // Achat automatique : décidé par Selio, aucun membre ne l'a validé.
    if (pr.confirmedAt && pr.mode !== "auto") rows.push({ ...base(`pv:${pr.id}`, pr.confirmedAt, "purchase.validated", "member", auditBy("purchase.confirmed", pr.id)?.actorUserId ?? st.user.id), targetType: "purchase", targetId: pr.id, itemTitle: title, purchaseCents: paid });
    if (pr.executedAt) rows.push({ ...base(`pd:${pr.id}`, pr.executedAt, "purchase.done", "selio", null), targetType: "purchase", targetId: pr.id, itemId: pr.reportedItemId ?? null, itemTitle: title, purchaseCents: paid, status: pr.status === "simulated" || pr.status === "executed" ? "done" : "failed", data: { simulated: pr.status === "simulated" } });
  }

  const AUDIT_VERBS: Record<string, ActivityVerb> = { "rule.run": "automation.rule_run", "job.approved": "automation.approved", "automation.global_pause": "automation.paused", "automation.global_resume": "automation.resumed", "item.deleted": "item.deleted", "item.bulk": "item.bulk" };
  for (const a of st.audit) {
    const m = a.meta;
    if (a.action === "order.transition" && (m.status === "shipped" || m.status === "delivered") && a.targetId) {
      const o = orders.get(a.targetId);
      if (o) rows.push({ ...base(`ot:${a.id}`, a.createdAt, m.status === "shipped" ? "order.shipped" : "order.delivered", a.actorUserId ? "member" : "selio", a.actorUserId), targetType: "order", targetId: o.id, itemId: o.itemId, itemTitle: items.get(o.itemId)?.title ?? null, counterpart: who(customers.get(o.customerId)) });
      continue;
    }
    if (a.action.startsWith("activity.")) {
      const verb = a.action.slice("activity.".length);
      const actor = text(m.actor) ?? "bot";
      if (!VERBS.has(verb) || !ACTORS.has(actor)) continue;
      rows.push({ ...base(`au:${a.id}`, a.createdAt, verb as ActivityVerb, actor as ActivityActorKind, a.actorUserId), targetType: (text(m.targetType) as ActivityTargetType | null), targetId: text(m.targetId), itemId: text(m.itemId), itemTitle: text(m.itemTitle), counterpart: text(m.counterpart), priceCents: num(m.priceCents), purchaseCents: num(m.purchaseCents), status: (text(m.status) as ActivityStatus | null) ?? "done", data: { summary: text(m.summary) } });
      continue;
    }
    const verb = AUDIT_VERBS[a.action];
    if (!verb || (a.action === "item.bulk" && !num(m.affected))) continue;
    rows.push({ ...base(`au:${a.id}`, a.createdAt, verb, a.actorUserId ? "member" : "selio", a.actorUserId), targetType: a.action === "rule.run" ? "rule" : a.action === "job.approved" ? "job" : null, targetId: a.targetId, itemTitle: a.action === "item.deleted" ? text(m.title) : null, data: { ruleName: a.action === "rule.run" && a.targetId ? rules.get(a.targetId)?.name ?? null : null, created: m.created, affected: m.affected, action: m.action } });
  }
  return rows;
}

/** Page du journal : filtres, tri (plus récent d'abord), curseur, rôle (« org.read », finances). */
export function demoActivityPage(rows: ActivityRow[], raw: ActivityQuery, ctx: { role: Role; memberName: (id: string) => string | null }): ActivityPage {
  if (!can(ctx.role, "org.read")) throw new DataError("forbidden", "Votre rôle ne permet pas de consulter le journal d'activité.", 403);
  const parsed = activityQuery.safeParse(raw ?? {});
  if (!parsed.success) throw new DataError("validation", "Filtres du journal invalides", 400);
  const q = parsed.data;
  const before = parseActivityCursor(q.cursor);
  if (q.cursor && !before) throw new DataError("validation", "Curseur du journal invalide", 400);
  const verbs = q.category ? new Set<string>(activityVerbsOf(q.category)) : null;
  const ms = (iso: string) => new Date(iso).toISOString();
  const list = rows
    .map((r) => ({ ...r, at: ms(r.at) }))
    .filter((r) => !verbs || verbs.has(r.verb))
    .filter((r) => {
      const a = q.actor;
      if (!a) return true;
      if (a === "selio" || a === "studio" || a === "bot") return r.actorKind === a;
      if (a === "members") return r.actorKind === "member";
      return r.actorKind === "member" && r.actorUserId === a;
    })
    .filter((r) => (q.mode === "auto" ? r.actorKind !== "member" : q.mode === "manual" ? r.actorKind === "member" : true))
    .filter((r) => (!q.from || r.at >= ms(q.from)) && (!q.to || r.at < ms(q.to)))
    // Tri stable : à date égale, l'ordre des sources (la plus récente d'abord) est gardé.
    .sort((a, b) => b.at.localeCompare(a.at));
  // Curseur : la ligne qui le porte (identifiants aléatoires en démonstration), sinon la date seule.
  const index = before ? list.findIndex((r) => r.id === before.id) : -1;
  const rest = !before ? list : index >= 0 ? list.slice(index + 1) : list.filter((r) => r.at < ms(before.at));
  const page = rest.slice(0, q.limit);
  const finances = can(ctx.role, "finances.read");
  const last = page[page.length - 1];
  return { entries: page.map((r) => describeActivity(r, { finances, memberName: ctx.memberName })), nextCursor: rest.length > q.limit && last ? activityCursor(last) : null };
}
