import { randomUUID } from "node:crypto";
import { z } from "zod";
import { WORN_OVERAGE_UNIT_CENTS, euroLabel, id, quotasForPlan, wornOverageLine, type InvoiceExtraLine, type WornPhotoJob } from "@selio/contracts";
import { repos, type Tx } from "@selio/db";
import { localParts } from "@selio/domain";
import { AppError, requireAction, withOrg, type OrgContext, type Services, type ServicesConfig } from "../context";

type WornPhotoJobRecord = repos.WornPhotoJobRecord;

/**
 * Photos portées (Studio, §5.11) : une photo de l'article à plat devient une photo « portée ».
 *
 * AUCUN modèle ni service n'est choisi (décision d'Ibrahim, partie 7 : modèle maison à licence commerciale
 * ou service payant à valider). Le code ne dépend que de l'interface `WornPhotoProvider` :
 * - « noop » (défaut) refuse proprement chaque demande : « aucun fournisseur configuré : décision à prendre » ;
 * - « mock » sert aux tests (aucune image produite, une clé factice de l'organisation).
 *
 * Les demandes vont dans une file exécutée LA NUIT (WORN_NIGHT_WINDOW, 22 h – 6 h Europe/Paris par défaut)
 * pour ne pas prendre la carte graphique aux heures où les vendeurs rédigent leurs annonces.
 *
 * Quotas : `wornPhotosPerMonth` du plan (10 en Pro, 30 en Agence), compteur « studio.worn_photo », remis à
 * zéro le 1er du mois (UTC). Au-delà : refus 402, sauf si WORN_OVERAGE_ENABLED (faux par défaut) ET accord
 * explicite du client dans la demande (`acceptOverage: true`) : 0,25 € la photo (PROPOSITION, prix à décider),
 * facturé au renouvellement comme une ligne de dépassement de la facture Revolut. Une photo refusée, échouée
 * ou annulée rend sa place de quota et n'est jamais facturée.
 *
 * Vie privée : la photo d'origine et le résultat ne sont que des clés de stockage de l'organisation
 * (`org/<org>/…`), jamais des URL. Un fournisseur ne doit garder NI la photo envoyée NI aucun visage généré
 * au-delà de la production du résultat (exigence à inscrire au contrat du fournisseur choisi) ; Selio ne
 * conserve que l'image produite, sous la clé de l'organisation, supprimée avec elle.
 */

// ---------------------------------------------------------------- fournisseur

export const WORN_POSES = ["front", "three_quarter", "back"] as const;
export type WornPose = (typeof WORN_POSES)[number];
export const wornPose = z.enum(WORN_POSES);

/** Message du fournisseur « noop » : aucun modèle ni service n'est choisi. */
export const NO_WORN_PROVIDER_MESSAGE = "aucun fournisseur configuré : décision à prendre";

export interface WornPhotoRequest {
  orgId: string;
  jobId: string;
  /** Clé de la photo d'origine (`org/<orgId>/item-photo|studio-photo/<id>.<ext>`). */
  photoKey: string;
  pose: WornPose;
  signal?: AbortSignal;
}

/** Résultat : la clé de l'image produite (stockée par le fournisseur sous le préfixe de l'organisation), ou un refus. */
export type WornPhotoOutcome = { resultKey: string } | { refused: string };

/** Interface minimale d'un fournisseur de photos portées. Une panne est signalée en levant une erreur. */
export interface WornPhotoProvider {
  readonly name: string;
  generate(input: WornPhotoRequest): Promise<WornPhotoOutcome>;
}

/** Fournisseur par défaut : refuse chaque demande, proprement (statut « refused », quota rendu). */
export class NoopWornPhotoProvider implements WornPhotoProvider {
  readonly name = "noop";
  async generate(): Promise<WornPhotoOutcome> {
    return { refused: NO_WORN_PROVIDER_MESSAGE };
  }
}

/**
 * Fournisseur de test : aucune image n'est produite ; rend une clé factice de l'organisation, ou la réponse
 * programmée (`next`) : une clé, un refus ou une erreur levée.
 */
export class FakeWornPhotoProvider implements WornPhotoProvider {
  readonly name = "mock";
  readonly calls: WornPhotoRequest[] = [];
  readonly next: (WornPhotoOutcome | Error)[] = [];

  async generate(input: WornPhotoRequest): Promise<WornPhotoOutcome> {
    this.calls.push({ ...input, signal: undefined });
    const programmed = this.next.shift();
    if (programmed instanceof Error) throw programmed;
    return programmed ?? { resultKey: `org/${input.orgId}/studio-photo/worn-${input.jobId}.jpg` };
  }
}

/**
 * Fournisseur choisi par WORN_PHOTO_PROVIDER : « noop » (défaut) ou « mock » (tests et démonstration, jamais
 * en production). Toute autre valeur retombe sur « noop » : aucun service n'est branché tant qu'Ibrahim n'a
 * pas décidé.
 */
export function createWornPhotoProvider(name: string | undefined, opts: { production?: boolean } = {}): WornPhotoProvider {
  if (name?.trim().toLowerCase() === "mock" && !opts.production) return new FakeWornPhotoProvider();
  return new NoopWornPhotoProvider();
}

// ---------------------------------------------------------------- réglages

export interface NightWindow {
  startHour: number;
  endHour: number;
  timezone: string;
}

export const WORN_NIGHT_WINDOW_DEFAULT: NightWindow = { startHour: 22, endHour: 6, timezone: "Europe/Paris" };
/** Une demande « en cours » depuis plus longtemps (worker interrompu) est close en échec, quota rendu. */
export const WORN_STALE_MS = 60 * 60_000;
/** Prix unitaire maximal accepté depuis l'environnement (5 €), garde-fou contre une faute de frappe. */
const WORN_OVERAGE_UNIT_MAX_CENTS = 500;

const isTrue = (v: unknown): boolean => v === true || (typeof v === "string" && ["1", "true", "yes", "oui"].includes(v.trim().toLowerCase()));

function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

/** « 22-6 », « 22:00-06:00 » ou « 22h-6h » → { startHour, endHour } ; null si illisible ou début = fin. */
export function parseNightWindow(raw: string | undefined): { startHour: number; endHour: number } | null {
  const m = raw?.trim().match(/^(\d{1,2})(?::00|h)?\s*-\s*(\d{1,2})(?::00|h)?$/i);
  if (!m) return null;
  const startHour = Number(m[1]);
  const endHour = Number(m[2]);
  if (startHour > 23 || endHour > 24 || startHour === endHour % 24) return null;
  return { startHour, endHour: endHour % 24 };
}

/**
 * Lit WORN_OVERAGE_ENABLED (faux par défaut), WORN_OVERAGE_UNIT_CENTS (25 par défaut, proposition),
 * WORN_NIGHT_WINDOW (« 22-6 » par défaut) et WORN_NIGHT_TIMEZONE (Europe/Paris) : API et worker.
 */
export function wornConfigFromEnv(env: Record<string, string | undefined> = process.env): ServicesConfig {
  const unit = Number(env.WORN_OVERAGE_UNIT_CENTS);
  const hours = parseNightWindow(env.WORN_NIGHT_WINDOW);
  const tz = env.WORN_NIGHT_TIMEZONE?.trim();
  return {
    wornOverageEnabled: isTrue(env.WORN_OVERAGE_ENABLED),
    wornOverageUnitCents: Number.isInteger(unit) && unit >= 1 && unit <= WORN_OVERAGE_UNIT_MAX_CENTS ? unit : WORN_OVERAGE_UNIT_CENTS,
    wornNightWindow: {
      ...(hours ?? { startHour: WORN_NIGHT_WINDOW_DEFAULT.startHour, endHour: WORN_NIGHT_WINDOW_DEFAULT.endHour }),
      timezone: tz && validTimezone(tz) ? tz : WORN_NIGHT_WINDOW_DEFAULT.timezone,
    },
  };
}

export interface WornSettings {
  overageEnabled: boolean;
  overageUnitCents: number;
  window: NightWindow;
}

/** Réglages effectifs : dépassement désactivé par défaut, 0,25 € (proposition), nuit 22 h – 6 h à Paris. */
export function wornSettings(services: Pick<Services, "config">): WornSettings {
  const c = services.config ?? {};
  const unit = c.wornOverageUnitCents;
  const w = c.wornNightWindow;
  const hoursOk = !!w && Number.isInteger(w.startHour) && Number.isInteger(w.endHour) && w.startHour >= 0 && w.startHour <= 23 && w.endHour >= 0 && w.endHour <= 23 && w.startHour !== w.endHour;
  return {
    overageEnabled: c.wornOverageEnabled === true,
    overageUnitCents: typeof unit === "number" && Number.isInteger(unit) && unit >= 1 && unit <= WORN_OVERAGE_UNIT_MAX_CENTS ? unit : WORN_OVERAGE_UNIT_CENTS,
    window: {
      startHour: hoursOk ? w!.startHour : WORN_NIGHT_WINDOW_DEFAULT.startHour,
      endHour: hoursOk ? w!.endHour : WORN_NIGHT_WINDOW_DEFAULT.endHour,
      timezone: w?.timezone && validTimezone(w.timezone) ? w.timezone : WORN_NIGHT_WINDOW_DEFAULT.timezone,
    },
  };
}

// ---------------------------------------------------------------- fenêtre de nuit (fonctions pures)

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function zonedParts(date: Date, timezone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute") };
}

/** Décalage du fuseau à un instant (ms) : heure locale lue comme UTC − instant. */
function tzOffsetMs(date: Date, timezone: string): number {
  const p = zonedParts(date, timezone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(date.getTime() / 60_000) * 60_000;
}

/** Instant UTC d'une heure locale (jour J + `addDays`, heure `hour`:00) dans le fuseau, changements d'heure compris. */
function zonedHour(base: ZonedParts, addDays: number, hour: number, timezone: string): Date {
  const guess = Date.UTC(base.year, base.month - 1, base.day + addDays, hour, 0);
  const first = guess - tzOffsetMs(new Date(guess), timezone);
  const second = guess - tzOffsetMs(new Date(first), timezone);
  return new Date(second);
}

/** L'heure locale `hour` est-elle dans la fenêtre (qui peut passer minuit : 22 h – 6 h) ? */
function hourInWindow(hour: number, w: { startHour: number; endHour: number }): boolean {
  return w.startHour < w.endHour ? hour >= w.startHour && hour < w.endHour : hour >= w.startHour || hour < w.endHour;
}

/** Vrai si `now` est dans la fenêtre de nuit (heure locale du fuseau). */
export function inNightWindow(now: Date, window: NightWindow = WORN_NIGHT_WINDOW_DEFAULT): boolean {
  return hourInWindow(localParts(now, window.timezone).hour, window);
}

/**
 * Prochaine fenêtre de nuit à partir de `now` : si `now` y est déjà, elle commence maintenant ; sinon au
 * prochain `startHour` local. `end` est le `endHour` local qui la termine (le lendemain quand elle passe
 * minuit). Fonction pure, fuseau IANA (changements d'heure gérés).
 */
export function nextNightWindow(now: Date, timezone: string = WORN_NIGHT_WINDOW_DEFAULT.timezone, hours: { startHour: number; endHour: number } = WORN_NIGHT_WINDOW_DEFAULT): { start: Date; end: Date; inWindow: boolean } {
  const p = zonedParts(now, timezone);
  const overnight = hours.startHour > hours.endHour;
  if (hourInWindow(p.hour, hours)) {
    // Dans la fenêtre : elle se termine aujourd'hui (après minuit) ou demain (avant minuit).
    const endDay = overnight && p.hour >= hours.startHour ? 1 : 0;
    return { start: new Date(now), end: zonedHour(p, endDay, hours.endHour, timezone), inWindow: true };
  }
  const startDay = p.hour < hours.startHour ? 0 : 1;
  const start = zonedHour(p, startDay, hours.startHour, timezone);
  const end = zonedHour(p, startDay + (overnight ? 1 : 0), hours.endHour, timezone);
  return { start, end, inWindow: false };
}

// ---------------------------------------------------------------- vues

export type WornPhotoView = WornPhotoJob & {
  pose: WornPose;
  startedAt: string | null;
  finishedAt: string | null;
  /** Prix unitaire du dépassement accepté (centimes) ; 0 = dans le quota du plan. */
  overageCents: number;
  overageAcceptedAt: string | null;
  /** Dépassement déjà facturé (renouvellement). */
  billed: boolean;
};

function toView(j: WornPhotoJobRecord): WornPhotoView {
  return {
    id: j.id,
    orgId: j.orgId,
    itemId: j.itemId,
    photoKey: j.photoKey,
    status: j.status,
    provider: j.provider,
    resultKey: j.resultKey,
    error: j.error,
    scheduledFor: j.scheduledFor,
    createdAt: j.createdAt,
    pose: j.pose,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
    overageCents: j.overageCents,
    overageAcceptedAt: j.overageAcceptedAt,
    billed: j.billedInvoiceId !== null,
  };
}

// ---------------------------------------------------------------- demandes (API)

const PHOTO_KEY_RE = /^org\/([A-Za-z0-9_-]+)\/(item-photo|studio-photo)\/[A-Za-z0-9_-]+\.(jpg|png|webp)$/;
const RESULT_KEY_RE = /^org\/([A-Za-z0-9_-]+)\/[a-z-]+\/[A-Za-z0-9_-]+\.(jpg|png|webp)$/;

export const wornPhotoRequestInput = z.object({
  photoKey: z.string().trim().min(1).max(300),
  itemId: id.nullable().optional(),
  pose: wornPose.default("front"),
  /** Accord explicite pour une photo au-delà du quota (0,25 € facturé au renouvellement). Jamais implicite. */
  acceptOverage: z.boolean().default(false),
  /**
   * Prix unitaire (centimes) que l'écran a affiché au moment de l'accord : s'il diffère du prix du serveur (réglage
   * changé entre l'affichage et l'envoi), la demande est refusée (409) et le client relit le nouveau prix. Le montant
   * enregistré est toujours celui accepté.
   */
  acceptedUnitCents: z.number().int().min(1).max(10_000).optional(),
});
export type WornPhotoRequestInput = z.input<typeof wornPhotoRequestInput>;

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

/**
 * Demande une photo portée : quota du plan (« studio.worn_photo »), puis dépassement seulement avec le réglage
 * WORN_OVERAGE_ENABLED, l'accord explicite (`acceptOverage: true`) et un abonnement payé par carte (il est
 * facturé au renouvellement). La demande est planifiée au début de la prochaine fenêtre de nuit.
 */
export async function requestWornPhoto(ctx: OrgContext, raw: unknown): Promise<WornPhotoView> {
  requireAction(ctx, "ai.use");
  const parsed = wornPhotoRequestInput.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", parsed.error.issues[0]?.message ?? "Demande invalide", 400, parsed.error.flatten());
  const input = parsed.data;
  const keyMatch = PHOTO_KEY_RE.exec(input.photoKey);
  if (!keyMatch) throw new AppError("validation", "Photo attendue : une clé de stockage d'une photo d'article ou de Studio (JPEG, PNG ou WebP).", 400);
  if (keyMatch[1] !== ctx.orgId) throw new AppError("forbidden", "Cette photo n'appartient pas à votre espace.", 403);
  const settings = wornSettings(ctx.services);
  const now = ctx.services.now();
  const at = now.toISOString();
  const provider = ctx.services.wornPhotos?.name ?? "noop";
  const scheduledFor = nextNightWindow(now, settings.window.timezone, settings.window).start.toISOString();
  return withOrg(ctx, async (tx) => {
    if (input.itemId) await repos.items.byId(tx, input.itemId);
    // Deux demandes simultanées de la même organisation passent l'une après l'autre (la seconde voit la première).
    await repos.usage.lock(tx, "studio.worn_photo");
    const sub = await repos.subscriptions.get(tx);
    const quota = (sub?.quotas ?? quotasForPlan("free")).wornPhotosPerMonth;
    if (quota <= 0) throw new AppError("quota_exceeded", "Les photos portées ne sont pas incluses dans votre offre (Pro : 10 par mois, Agence : 30).", 402, { quota, used: 0, overageAvailable: false });
    const used = await repos.usage.sumKindSince(tx, "studio.worn_photo", monthStart(now));
    let overageCents = 0;
    if (used >= quota) {
      const price = euroLabel(settings.overageUnitCents);
      if (!settings.overageEnabled) throw new AppError("quota_exceeded", `Quota de photos portées du mois atteint (${quota}).`, 402, { quota, used, overageAvailable: false });
      if (!input.acceptOverage) {
        throw new AppError("quota_exceeded", `Quota de photos portées du mois atteint (${quota}). Une photo de plus coûte ${price}, facturée au prochain renouvellement : confirmez pour continuer.`, 402, { quota, used, overageAvailable: true, unitCents: settings.overageUnitCents, consentRequired: true });
      }
      const paidByCard = !!sub && sub.cardOnFile && sub.provider === "revolut" && (sub.status === "active" || sub.status === "trialing") && !sub.cancelAtPeriodEnd;
      if (!paidByCard) throw new AppError("quota_exceeded", "Le dépassement est facturé au prochain renouvellement : il faut un abonnement en cours, non résilié, avec une carte enregistrée.", 402, { quota, used, overageAvailable: false });
      // L'accord vaut pour le prix affiché : un prix différent côté serveur n'est jamais facturé en silence.
      if (input.acceptedUnitCents !== settings.overageUnitCents) {
        throw new AppError("overage_price_changed", `Le prix du dépassement est de ${price} la photo${input.acceptedUnitCents ? ` (accord donné sur ${euroLabel(input.acceptedUnitCents)})` : " (prix accepté non précisé)"} : relisez-le et confirmez à nouveau.`, 409, { quota, used, overageAvailable: true, unitCents: settings.overageUnitCents, acceptedUnitCents: input.acceptedUnitCents ?? null, consentRequired: true });
      }
      overageCents = input.acceptedUnitCents;
    }
    const jobId = randomUUID();
    // Place de quota réservée maintenant (compteur du mois de la demande), rendue si la photo n'est pas produite.
    const usageEventId = await repos.usage.record(tx, "studio.worn_photo", { jobId, overageCents }, 1, at);
    const job = await repos.wornPhotoJobs.create(tx, { id: jobId, itemId: input.itemId ?? null, photoKey: input.photoKey, pose: input.pose, provider, scheduledFor, usageEventId, overageCents, overageAcceptedAt: overageCents > 0 ? at : null, createdAt: at });
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "studio.worn_photo_requested", targetType: "worn_photo", targetId: job.id, meta: { pose: input.pose, scheduledFor, provider, overageCents, overageAccepted: overageCents > 0, quota, usedBefore: used }, ip: ctx.ip });
    return toView(job);
  });
}

export async function listWornPhotos(ctx: OrgContext, opts: { itemId?: string | null; limit?: number } = {}): Promise<WornPhotoView[]> {
  requireAction(ctx, "items.read");
  return withOrg(ctx, async (tx) => (await repos.wornPhotoJobs.list(tx, opts)).map(toView));
}

/** Rend la place de quota d'une demande (événement d'utilisation réservé), sans erreur s'il n'existe plus. */
async function releaseUsage(tx: Tx, usageEventId: string | null): Promise<void> {
  if (usageEventId) await repos.usage.remove(tx, usageEventId);
}

/**
 * Annule une demande encore en file : elle est supprimée, sa place de quota rendue, son dépassement jamais facturé,
 * et la photo envoyée pour elle effacée du stockage (après la transaction, si elle ne sert à aucune autre demande).
 */
export async function cancelWornPhoto(ctx: OrgContext, jobId: string): Promise<{ cancelled: true; id: string }> {
  requireAction(ctx, "ai.use");
  const removed = await withOrg(ctx, async (tx) => {
    const row = await repos.wornPhotoJobs.deleteQueued(tx, jobId);
    if (!row) {
      const existing = await repos.wornPhotoJobs.byId(tx, jobId);
      if (!existing) throw new AppError("not_found", "Demande introuvable.", 404);
      throw new AppError("conflict", "Cette demande a déjà été traitée ou est en cours : elle ne peut plus être annulée.", 409);
    }
    await releaseUsage(tx, row.usageEventId);
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "studio.worn_photo_cancelled", targetType: "worn_photo", targetId: row.id, meta: { overageCents: row.overageCents }, ip: ctx.ip });
    return row;
  });
  await deleteOrphanStudioPhoto(ctx.services, ctx.orgId, removed.photoKey, removed.id);
  return { cancelled: true, id: removed.id };
}

// ---------------------------------------------------------------- objets du stockage

const STUDIO_PHOTO_KEY_RE = /^org\/([A-Za-z0-9_-]+)\/studio-photo\/[A-Za-z0-9_-]+\.(jpg|png|webp)$/;

export type StudioPhotoDeletion = "deleted" | "kept" | "failed" | "no_store";

/**
 * Efface du stockage la photo d'origine d'une demande qui n'aboutit pas (annulée, refusée, en échec, interrompue)
 * ou purgée : seulement une photo envoyée pour Studio (`studio-photo`, jamais la photo d'un article, qui vit avec
 * lui), de l'organisation, et seulement si aucune autre demande ne l'utilise encore. Sans suppression branchée
 * (`services.studio.photos.delete`), rien n'est fait. Jamais bloquant : l'issue est rendue, pas levée.
 */
export async function deleteOrphanStudioPhoto(services: Services, orgId: string, key: string, excludeJobId: string | null): Promise<StudioPhotoDeletion> {
  const store = services.studio?.photos;
  if (!store?.delete) return "no_store";
  const m = STUDIO_PHOTO_KEY_RE.exec(key);
  if (!m || m[1] !== orgId) return "kept";
  const others = await services.db.withOrg(orgId, (tx) => repos.wornPhotoJobs.countByPhotoKey(tx, key, excludeJobId));
  if (others > 0) return "kept";
  try {
    await store.delete(key);
    return "deleted";
  } catch {
    return "failed";
  }
}

/** Demandes terminées gardées 30 jours (comme les brouillons de préparation), puis supprimées avec leurs objets. */
export const WORN_JOB_RETENTION_DAYS = 30;

export interface WornPurgeSummary {
  /** Lignes `worn_photo_jobs` supprimées (produites, refusées ou en échec depuis plus de 30 jours ; dépassement facturé ou nul). */
  jobs: number;
  objectsDeleted: number;
  objectsFailed: number;
}

/**
 * Rétention des photos portées d'une organisation (worker) : les demandes terminées depuis plus de 30 jours sont
 * supprimées, avec la photo d'origine (si plus aucune demande ne l'utilise) et le résultat produit. Un dépassement
 * produit mais pas encore facturé est gardé jusqu'au renouvellement.
 */
export async function purgeFinishedWornPhotos(services: Services, orgId: string, now: Date = services.now()): Promise<WornPurgeSummary> {
  const before = new Date(now.getTime() - WORN_JOB_RETENTION_DAYS * 86_400_000).toISOString();
  const rows = await services.db.withOrg(orgId, (tx) => repos.wornPhotoJobs.purgeFinishedBefore(tx, before));
  const summary: WornPurgeSummary = { jobs: rows.length, objectsDeleted: 0, objectsFailed: 0 };
  const store = services.studio?.photos;
  for (const r of rows) {
    const photo = await deleteOrphanStudioPhoto(services, orgId, r.photoKey, null);
    if (photo === "deleted") summary.objectsDeleted++;
    else if (photo === "failed") summary.objectsFailed++;
    if (r.resultKey && store?.delete && r.resultKey.startsWith(`org/${orgId}/`)) {
      try {
        await store.delete(r.resultKey);
        summary.objectsDeleted++;
      } catch {
        summary.objectsFailed++;
      }
    }
  }
  return summary;
}

// ---------------------------------------------------------------- exécution de nuit (worker)

export interface WornRunSummary {
  /** Hors de la fenêtre de nuit : rien n'est lancé (seules les demandes interrompues sont closes). */
  outsideWindow: boolean;
  done: number;
  refused: number;
  failed: number;
  /** Demandes restées « en cours » (worker interrompu) closes en échec, quota rendu. */
  interrupted: number;
  /** Photos d'origine effacées du stockage (demandes refusées, en échec ou interrompues ; `studio-photo` seulement). */
  objectsDeleted: number;
}

/**
 * Exécute les photos portées dont l'heure est venue, toutes organisations (tâche du worker, la nuit) :
 * prise conditionnelle (jamais deux exécutions), appel du fournisseur (« noop » sans fournisseur : refus
 * « aucun fournisseur configuré : décision à prendre »), clé du résultat vérifiée (préfixe de
 * l'organisation). Refus, panne ou clé invalide : place de quota rendue, dépassement retiré.
 */
export async function runDueWornPhotos(services: Services, opts: { now?: Date; limit?: number; signal?: AbortSignal } = {}): Promise<WornRunSummary> {
  const now = opts.now ?? services.now();
  const settings = wornSettings(services);
  const provider = services.wornPhotos ?? new NoopWornPhotoProvider();
  const summary: WornRunSummary = { outsideWindow: !inNightWindow(now, settings.window), done: 0, refused: 0, failed: 0, interrupted: 0, objectsDeleted: 0 };
  const nowIsoStr = now.toISOString();
  const staleBefore = new Date(now.getTime() - WORN_STALE_MS).toISOString();
  const due = await services.db.withGlobal((tx) => repos.wornPhotoJobs.due(tx, nowIsoStr, staleBefore, opts.limit ?? 50));
  for (const d of due) {
    if (opts.signal?.aborted) break;
    if (d.status === "running") {
      const closed = await services.db.withOrg(d.orgId, async (tx) => {
        const before = await repos.wornPhotoJobs.byId(tx, d.id);
        const row = await repos.wornPhotoJobs.finish(tx, d.id, { status: "failed", finishedAt: nowIsoStr, error: "Interrompue (redémarrage du worker) : la place du quota est rendue, demandez-la à nouveau.", staleBefore, keepOverage: false });
        if (row) await releaseUsage(tx, before?.usageEventId ?? null);
        return row;
      });
      if (closed) {
        summary.interrupted++;
        if ((await deleteOrphanStudioPhoto(services, d.orgId, closed.photoKey, closed.id)) === "deleted") summary.objectsDeleted++;
      }
      continue;
    }
    if (summary.outsideWindow) continue;
    const job = await services.db.withOrg(d.orgId, (tx) => repos.wornPhotoJobs.claim(tx, d.id, nowIsoStr, provider.name));
    if (!job) continue;
    let outcome: WornPhotoOutcome | null = null;
    let error: string | null = null;
    try {
      outcome = await provider.generate({ orgId: job.orgId, jobId: job.id, photoKey: job.photoKey, pose: job.pose, signal: opts.signal });
    } catch (err) {
      error = `Le fournisseur a échoué : ${(err instanceof Error ? err.message : String(err)).slice(0, 300)}`;
    }
    let status: "done" | "refused" | "failed";
    let resultKey: string | null = null;
    if (outcome && "resultKey" in outcome) {
      const m = RESULT_KEY_RE.exec(outcome.resultKey);
      if (m && m[1] === job.orgId) {
        status = "done";
        resultKey = outcome.resultKey;
      } else {
        status = "failed";
        error = "Résultat refusé : la clé rendue par le fournisseur n'est pas une clé de stockage de cette organisation.";
      }
    } else if (outcome && "refused" in outcome) {
      status = "refused";
      error = (outcome.refused || NO_WORN_PROVIDER_MESSAGE).slice(0, 500);
    } else {
      status = "failed";
    }
    const finished = await services.db.withOrg(job.orgId, async (tx) => {
      const row = await repos.wornPhotoJobs.finish(tx, job.id, { status, finishedAt: services.now().toISOString(), resultKey, error, keepOverage: status === "done" });
      if (row && status !== "done") await releaseUsage(tx, job.usageEventId);
      if (row) await repos.audit.add(tx, { actorUserId: null, action: `studio.worn_photo_${status}`, targetType: "worn_photo", targetId: job.id, meta: { provider: provider.name, overageCents: status === "done" ? job.overageCents : 0, ...(error ? { error: error.slice(0, 200) } : {}) } });
      return row;
    });
    // Sans photo produite, la photo envoyée pour cette demande ne reste pas dans le stockage.
    if (finished && status !== "done" && (await deleteOrphanStudioPhoto(services, job.orgId, job.photoKey, job.id)) === "deleted") summary.objectsDeleted++;
    summary[status]++;
  }
  return summary;
}

// ---------------------------------------------------------------- facturation du dépassement

/**
 * Lignes de dépassement à ajouter au renouvellement d'une organisation : photos produites au-delà du quota,
 * terminées au plus tard à `cutoff` et pas encore facturées. Aucune ligne quand WORN_OVERAGE_ENABLED est faux.
 */
export async function wornOverageLines(services: Services, orgId: string, cutoff: string): Promise<InvoiceExtraLine[]> {
  if (!wornSettings(services).overageEnabled) return [];
  const rows = await services.db.withOrg(orgId, (tx) => repos.wornPhotoJobs.unbilledOverage(tx, cutoff));
  return rows.map((r) => wornOverageLine(r.quantity, r.unitCents)).filter((l): l is InvoiceExtraLine => l !== null);
}

/** Rattache à la facture les photos facturées par ses lignes de dépassement (même filtre et même date limite). */
export async function markWornOverageBilled(tx: Tx, invoiceId: string, lines: readonly InvoiceExtraLine[], cutoff: string, at: string): Promise<number> {
  let n = 0;
  for (const l of lines) {
    if (l.kind !== "overage" || l.product !== "worn_photo") continue;
    n += await repos.wornPhotoJobs.markOverageBilled(tx, { invoiceId, cutoff, unitCents: l.unitCents, quantity: l.quantity, at });
  }
  return n;
}

