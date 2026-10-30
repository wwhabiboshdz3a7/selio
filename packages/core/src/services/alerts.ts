import {
  RADAR_ALERT_MAX_AGE_HOURS, pushSubscriptionInput, radarAlertPayload,
  type Opportunity, type PurchaseRequest, type PushSubscription, type PushSubscriptionView, type RadarAlert, type RadarAlertPayload, type RadarQuietHours, type RadarSettings,
} from "@selio/contracts";
import { repos, type Tx } from "@selio/db";
import { can, localParts } from "@selio/domain";
import { AppError, requireAction, withOrg, type OrgContext, type Services } from "../context";

/**
 * File des alertes de Selio Radar (notifications de la PWA).
 *
 * - Une alerte par affaire (clé `opportunity:<id>`, index unique) : jamais deux notifications pour la
 *   même annonce, même si deux lectures la trouvent.
 * - Seulement au-dessus de la note minimale (`settings.radar.alertMinScore`, 75 par défaut) et si les
 *   alertes sont activées ; pendant les heures calmes, l'envoi est différé à la fin de la plage (la
 *   lecture, elle, continue).
 * - Le contenu ne porte jamais de donnée du vendeur (pseudo, note, photo) : titre de l'annonce, prix,
 *   note de l'affaire, revente estimée et un chemin relatif dans l'application.
 * - Le service de notification répond 404 ou 410 : l'abonnement n'existe plus, il est désactivé.
 * - Destinataires : appareils abonnés des MEMBRES ACTUELS de l'organisation qui peuvent voir Radar ; un
 *   membre retiré perd ses abonnements (et ne recevrait plus rien de toute façon).
 */

// ---------------------------------------------------------------- envoi (interface minimale)

/** Abonnement Web Push tel que le service de notification l'attend. */
export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Réponse d'un envoi. Une exception portant `statusCode` (bibliothèque web-push) est lue de la même façon. */
export interface PushSendResult {
  ok: boolean;
  /** Statut HTTP du service de notification (201 envoyé, 404 / 410 abonnement disparu, 429 trop d'envois…). */
  statusCode?: number | null;
  message?: string;
}

/** Envoi Web Push : implémenté par le worker (clés VAPID), `FakePushSender` dans les tests. */
export interface PushSender {
  send(subscription: PushTarget, payload: RadarAlertPayload): Promise<PushSendResult>;
}

/** Envoi factice : garde chaque notification ; `respond` fixe le statut rendu par adresse. */
export class FakePushSender implements PushSender {
  readonly sent: { endpoint: string; payload: RadarAlertPayload }[] = [];
  readonly statusByEndpoint = new Map<string, number>();

  respond(endpoint: string, statusCode: number): this {
    this.statusByEndpoint.set(endpoint, statusCode);
    return this;
  }

  async send(subscription: PushTarget, payload: RadarAlertPayload): Promise<PushSendResult> {
    const statusCode = this.statusByEndpoint.get(subscription.endpoint) ?? 201;
    if (statusCode >= 200 && statusCode < 300) this.sent.push({ endpoint: subscription.endpoint, payload: structuredClone(payload) });
    return { ok: statusCode >= 200 && statusCode < 300, statusCode };
  }
}

// ---------------------------------------------------------------- heures calmes

/** Vrai si l'heure locale (0–23) est dans les heures calmes `from` → `to` (plage qui peut passer minuit). */
export function isQuietHour(hour: number, quiet: RadarQuietHours | null | undefined): boolean {
  if (!quiet || quiet.from === quiet.to) return false;
  return quiet.from < quiet.to ? hour >= quiet.from && hour < quiet.to : hour >= quiet.from || hour < quiet.to;
}

/**
 * Instant d'envoi d'une alerte : maintenant, ou la fin des heures calmes (heure `to` pile, fuseau de
 * l'organisation) si l'on est dedans.
 */
export function alertScheduleFor(now: Date, timezone: string, quiet: RadarQuietHours | null | undefined): Date {
  const { hour, minute } = localParts(now, timezone);
  if (!quiet || !isQuietHour(hour, quiet)) return now;
  const hoursAhead = (quiet.to - hour + 24) % 24 || 24;
  const ms = hoursAhead * 3_600_000 - minute * 60_000 - now.getUTCSeconds() * 1000 - now.getUTCMilliseconds();
  return new Date(now.getTime() + ms);
}

/** Début du jour local (fuseau de l'organisation) : base des plafonds journaliers de Radar Auto. */
export function localDayStart(now: Date, timezone: string): Date {
  const { hour, minute } = localParts(now, timezone);
  return new Date(now.getTime() - (hour * 3_600_000 + minute * 60_000 + now.getUTCSeconds() * 1000 + now.getUTCMilliseconds()));
}

// ---------------------------------------------------------------- contenu des alertes

/** Montant en euros, à la française (« 12,50 € »). */
export function formatEur(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")} €`;
}

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

/** Notification d'une affaire : titre de l'annonce, prix, note, revente estimée. Aucune donnée du vendeur. */
export function opportunityAlertPayload(opp: Pick<Opportunity, "id" | "title" | "score" | "observed" | "estimate">): RadarAlertPayload {
  return radarAlertPayload.parse({
    title: clip(`Affaire Radar : ${opp.title.replace(/\s+/g, " ").trim()}`, 200),
    body: clip(`${formatEur(opp.observed.priceCents)} · note ${Math.round(opp.score)} · revente estimée ${formatEur(opp.estimate.resalePriceCents)}`, 400),
    url: `/app/radar/affaires/${opp.id}`,
  });
}

/** Notification d'un paiement à valider (3-D Secure) : Selio attend le client, sans rien saisir à sa place. */
export function paymentAlertPayload(purchase: Pick<PurchaseRequest, "id" | "totalCents" | "maxPriceCents">, title: string): RadarAlertPayload {
  return radarAlertPayload.parse({
    title: "Validez le paiement dans votre application bancaire",
    body: clip(`Radar Auto : ${title.replace(/\s+/g, " ").trim()} (${formatEur(purchase.totalCents ?? purchase.maxPriceCents)}). Votre banque demande une validation : Selio attend, sans jamais saisir de code à votre place.`, 400),
    url: `/app/radar/achats/${purchase.id}`,
  });
}

const SIGNAL_TEXT: Record<"captcha" | "warning" | "blocked" | "rate_limited", string> = {
  captcha: "un CAPTCHA",
  warning: "un avertissement",
  blocked: "un blocage",
  rate_limited: "un message « trop de requêtes »",
};

/** Notification d'une recherche arrêtée par Selio (pages non reconnues de suite). */
export function searchSuspendedAlertPayload(name: string): RadarAlertPayload {
  return radarAlertPayload.parse({
    title: "Radar : recherche arrêtée",
    body: clip(`La page de la recherche « ${name.replace(/\s+/g, " ").trim()} » n'a pas été reconnue plusieurs fois de suite (page de Vinted changée ou vérification inconnue). La lecture est arrêtée et ralentie : vérifiez sur Vinted, puis réactivez la recherche.`, 400),
    url: "/app/radar",
  });
}

/** Notification de l'arrêt de Radar Auto après une issue incertaine (le paiement a pu partir). */
export function autoSuspendedAlertPayload(purchaseId: string): RadarAlertPayload {
  return radarAlertPayload.parse({
    title: "Radar Auto arrêté : achat à vérifier",
    body: "Un achat automatique s'est terminé sans confirmation reconnue (le paiement a pu partir). Vérifiez la commande dans Vinted ; Radar Auto reste arrêté jusqu'à ce que vous le réactiviez.",
    url: `/app/radar/achats/${purchaseId}`,
  });
}

/** Notification d'un arrêt de la lecture (signal de Vinted). */
export function blockedAlertPayload(code: keyof typeof SIGNAL_TEXT, label: string): RadarAlertPayload {
  return radarAlertPayload.parse({
    title: "Radar en pause : Vinted a demandé une vérification",
    body: clip(`Vinted a affiché ${SIGNAL_TEXT[code]} sur le compte Achat « ${label} ». La lecture est arrêtée et le compte est en pause dans Selio Cloud : vérifiez-le dans Vinted, puis reprenez.`, 400),
    url: "/app/cloud",
  });
}

// ---------------------------------------------------------------- mise en file

export interface EnqueueOptions {
  now: Date;
  /** Réglages Radar et fuseau de l'organisation (relus en base s'ils manquent). */
  settings?: RadarSettings;
  timezone?: string;
}

/**
 * Met en file l'alerte d'une affaire : alertes activées, note ≥ `alertMinScore`, affaire encore
 * nouvelle ; différée à la fin des heures calmes. Null si elle n'est pas due ou existe déjà.
 */
export async function enqueueOpportunityAlert(tx: Tx, opp: Opportunity, opts: EnqueueOptions): Promise<RadarAlert | null> {
  let settings = opts.settings;
  let timezone = opts.timezone;
  if (!settings || !timezone) {
    const org = await repos.orgs.byId(tx, tx.orgId!);
    settings ??= org.settings.radar;
    timezone ??= org.settings.timezone;
  }
  // Stock initial (première lecture, annonce antérieure à la lecture précédente) : jamais d'alerte.
  if (!settings.alertsEnabled || opp.status !== "new" || opp.observed.initialStock === true || opp.score < settings.alertMinScore) return null;
  const scheduledFor = alertScheduleFor(opts.now, timezone, settings.quietHours);
  return repos.radarAlerts.enqueue(tx, { kind: "opportunity", opportunityId: opp.id, dedupeKey: `opportunity:${opp.id}`, payload: opportunityAlertPayload(opp), scheduledFor: scheduledFor.toISOString() });
}

/** Alerte de paiement 3-D Secure : envoyée tout de suite (le délai de la banque est court), une par demande. */
export async function enqueuePaymentAlert(tx: Tx, purchase: PurchaseRequest, title: string, now: Date): Promise<RadarAlert | null> {
  return repos.radarAlerts.enqueue(tx, { kind: "payment_3ds", purchaseId: purchase.id, dedupeKey: `payment_3ds:${purchase.id}`, payload: paymentAlertPayload(purchase, title), scheduledFor: now.toISOString() });
}

/** Alerte d'arrêt de la lecture (une par pause du compte). L'email des propriétaires part aussi (service Cloud). */
export async function enqueueBlockedAlert(tx: Tx, input: { accountId: string; code: keyof typeof SIGNAL_TEXT; label: string; now: Date }): Promise<RadarAlert | null> {
  return repos.radarAlerts.enqueue(tx, { kind: "blocked", dedupeKey: `blocked:${input.accountId}:${input.now.toISOString()}`, payload: blockedAlertPayload(input.code, input.label), scheduledFor: input.now.toISOString() });
}

/** Alerte d'une recherche arrêtée par Selio (une par arrêt). */
export async function enqueueSearchSuspendedAlert(tx: Tx, input: { searchId: string; name: string; now: Date }): Promise<RadarAlert | null> {
  return repos.radarAlerts.enqueue(tx, { kind: "blocked", dedupeKey: `search_suspended:${input.searchId}:${input.now.toISOString()}`, payload: searchSuspendedAlertPayload(input.name), scheduledFor: input.now.toISOString() });
}

/** Alerte de l'arrêt de Radar Auto après une issue incertaine (une par demande d'achat). */
export async function enqueueAutoSuspendedAlert(tx: Tx, input: { purchaseId: string; now: Date }): Promise<RadarAlert | null> {
  return repos.radarAlerts.enqueue(tx, { kind: "payment_3ds", purchaseId: input.purchaseId, dedupeKey: `auto_suspended:${input.purchaseId}`, payload: autoSuspendedAlertPayload(input.purchaseId), scheduledFor: input.now.toISOString() });
}

// ---------------------------------------------------------------- envoi des alertes échues

/** Échecs d'envoi consécutifs avant la désactivation d'un abonnement. */
export const PUSH_MAX_FAILURES = 5;
/** Essais d'envoi d'une alerte avant l'abandon. */
export const ALERT_MAX_ATTEMPTS = 3;
/** Délai pendant lequel une alerte prise n'est pas reprise par un autre passage. */
const ALERT_LEASE_MS = 2 * 60_000;

export interface SendAlertsSummary {
  sent: number;
  failed: number;
  expired: number;
  /** Abonnements désactivés (404 / 410 ou trop d'échecs). */
  disabledSubscriptions: number;
  /** Alertes laissées en file : aucun envoi possible ici (`services.push` absent). */
  pending: number;
}

function statusOf(err: unknown): number | null {
  const s = (err as { statusCode?: unknown } | null)?.statusCode;
  return typeof s === "number" ? s : null;
}

/**
 * Envoie les alertes échues d'une organisation : pour chaque alerte, une notification par appareil
 * abonné et actif (ou du seul destinataire). 404 / 410 → abonnement désactivé ; une alerte est
 * « envoyée » dès qu'un appareil l'a reçue, sinon retentée (3 essais au plus), et abandonnée au-delà
 * de 12 h de retard ou si l'affaire a déjà été traitée.
 */
export async function sendDueAlerts(services: Services, orgId: string, opts: { now?: Date; limit?: number } = {}): Promise<SendAlertsSummary> {
  const now = opts.now ?? services.now();
  const nowIso = now.toISOString();
  const summary: SendAlertsSummary = { sent: 0, failed: 0, expired: 0, disabledSubscriptions: 0, pending: 0 };
  const due = await services.db.withOrg(orgId, (tx) => repos.radarAlerts.due(tx, nowIso, opts.limit ?? 50));
  const tooOld = (alert: RadarAlert) => now.getTime() - new Date(alert.scheduledFor).getTime() > RADAR_ALERT_MAX_AGE_HOURS * 3_600_000;
  if (!services.push) {
    // Sans clés VAPID : rien n'est envoyé, mais les alertes trop anciennes expirent quand même (sinon la
    // file grossit sans fin et l'organisation reste dans les passages du worker).
    for (const alert of due) {
      if (!tooOld(alert)) {
        summary.pending++;
        continue;
      }
      await services.db.withOrg(orgId, (tx) => repos.radarAlerts.markFailed(tx, alert.id, `Alerte expirée : plus de ${RADAR_ALERT_MAX_AGE_HOURS} h de retard.`));
      summary.expired++;
    }
    return summary;
  }
  for (const alert of due) {
    if (tooOld(alert)) {
      await services.db.withOrg(orgId, (tx) => repos.radarAlerts.markFailed(tx, alert.id, `Alerte expirée : plus de ${RADAR_ALERT_MAX_AGE_HOURS} h de retard.`));
      summary.expired++;
      continue;
    }
    const prepared = await services.db.withOrg(orgId, async (tx) => {
      if (alert.kind === "opportunity" && alert.opportunityId) {
        const opp = await repos.opportunities.byId(tx, alert.opportunityId).catch(() => null);
        if (!opp || (opp.status !== "new" && opp.status !== "watching")) {
          await repos.radarAlerts.markFailed(tx, alert.id, "Affaire déjà traitée : alerte inutile.");
          return null;
        }
      }
      const claimed = await repos.radarAlerts.claim(tx, alert.id, alert.attempts, new Date(now.getTime() + ALERT_LEASE_MS).toISOString());
      if (!claimed) return null;
      // Membres actuels seulement (jointure sur les adhésions), avec le droit de voir Radar.
      const subs = (await repos.pushSubscriptions.listActive(tx, alert.userId)).filter((sub) => can(sub.role, "radar.read"));
      return { claimed, subs };
    });
    if (!prepared) continue;
    const { claimed, subs } = prepared;
    if (subs.length === 0) {
      await services.db.withOrg(orgId, (tx) => repos.radarAlerts.markFailed(tx, claimed.id, "Aucun appareil abonné aux notifications."));
      summary.failed++;
      continue;
    }
    const payload = radarAlertPayload.parse(claimed.payload);
    let delivered = 0;
    let lastError = "";
    const outcomes: { sub: PushSubscription; kind: "ok" | "gone" | "error" }[] = [];
    for (const sub of subs) {
      let statusCode: number | null = null;
      let ok = false;
      try {
        const res = await services.push.send({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
        ok = res.ok;
        statusCode = res.statusCode ?? null;
        if (!ok) lastError = `Service de notification : ${statusCode ?? "erreur"}`;
      } catch (err) {
        statusCode = statusOf(err);
        // Le message d'une exception peut contenir l'adresse de l'abonnement : seul le statut est gardé.
        lastError = `Service de notification : ${statusCode ?? (err instanceof Error ? err.name : "erreur")}`;
      }
      if (ok) delivered++;
      outcomes.push({ sub, kind: ok ? "ok" : statusCode === 404 || statusCode === 410 ? "gone" : "error" });
    }
    await services.db.withOrg(orgId, async (tx) => {
      for (const o of outcomes) {
        if (o.kind === "ok") await repos.pushSubscriptions.markUsed(tx, o.sub.id, nowIso);
        else if (o.kind === "gone") {
          await repos.pushSubscriptions.disable(tx, o.sub.id, nowIso);
          summary.disabledSubscriptions++;
        } else {
          const after = await repos.pushSubscriptions.markFailure(tx, o.sub.id, nowIso, PUSH_MAX_FAILURES);
          if (after?.disabledAt) summary.disabledSubscriptions++;
        }
      }
      if (delivered > 0) {
        await repos.radarAlerts.markSent(tx, claimed.id, nowIso);
        summary.sent++;
      } else if (claimed.attempts >= ALERT_MAX_ATTEMPTS || outcomes.every((o) => o.kind === "gone")) {
        await repos.radarAlerts.markFailed(tx, claimed.id, lastError || "Envoi impossible.");
        summary.failed++;
      } else {
        await repos.radarAlerts.retryLater(tx, claimed.id, new Date(now.getTime() + 2 ** claimed.attempts * 60_000).toISOString(), lastError || "Envoi impossible.");
      }
    });
  }
  return summary;
}

// ---------------------------------------------------------------- abonnements (PWA)

function subscriptionView(s: PushSubscription): PushSubscriptionView {
  const { p256dh: _p, auth: _a, ...view } = s;
  return view;
}

/** Abonne l'appareil de l'utilisateur aux alertes Radar (adresse unique : un appareil, une organisation). */
export async function subscribePush(ctx: OrgContext, raw: unknown): Promise<PushSubscriptionView> {
  requireAction(ctx, "radar.read");
  const parsed = pushSubscriptionInput.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", "Abonnement aux notifications invalide", 400, parsed.error.flatten());
  return withOrg(ctx, async (tx) => {
    const saved = await repos.pushSubscriptions.upsert(tx, { userId: ctx.userId, endpoint: parsed.data.endpoint, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth, userAgent: parsed.data.userAgent?.slice(0, 120) ?? null });
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "radar.push.subscribed", targetType: "push_subscription", targetId: saved.id, ip: ctx.ip });
    return subscriptionView(saved);
  });
}

/** Désabonne un appareil de l'utilisateur. */
export async function unsubscribePush(ctx: OrgContext, endpoint: string): Promise<{ removed: boolean }> {
  requireAction(ctx, "radar.read");
  if (typeof endpoint !== "string" || !endpoint.startsWith("https://") || endpoint.length > 1000) throw new AppError("validation", "Adresse d'abonnement invalide", 400);
  return withOrg(ctx, async (tx) => ({ removed: await repos.pushSubscriptions.removeByEndpoint(tx, endpoint, ctx.userId) }));
}

/** Retire un appareil abonné de l'utilisateur (appareil perdu, ancien téléphone), par son identifiant. */
export async function removePushSubscription(ctx: OrgContext, id: string): Promise<{ removed: boolean }> {
  requireAction(ctx, "radar.read");
  if (typeof id !== "string" || id.length === 0 || id.length > 100) throw new AppError("validation", "Appareil inconnu", 400);
  return withOrg(ctx, async (tx) => {
    const removed = await repos.pushSubscriptions.removeById(tx, id, ctx.userId);
    if (removed) await repos.audit.add(tx, { actorUserId: ctx.userId, action: "radar.push.unsubscribed", targetType: "push_subscription", targetId: id, ip: ctx.ip });
    return { removed };
  });
}

/** Appareils abonnés de l'utilisateur (sans les clés). */
export async function listPushSubscriptions(ctx: OrgContext): Promise<PushSubscriptionView[]> {
  requireAction(ctx, "radar.read");
  return withOrg(ctx, async (tx) => (await repos.pushSubscriptions.list(tx)).filter((s) => s.userId === ctx.userId).map(subscriptionView));
}

/** Dernières alertes de l'organisation (contenu sans donnée du vendeur). */
export async function listAlerts(ctx: OrgContext, limit = 50): Promise<RadarAlert[]> {
  requireAction(ctx, "radar.read");
  return withOrg(ctx, (tx) => repos.radarAlerts.list(tx, limit));
}
