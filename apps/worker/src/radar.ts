import type { RadarCatalogItemInput } from "@selio/contracts";
import { buildSearchUrl, type CatalogItem } from "@selio/connectors/vinted-adapter";
import type { PurchaseResult, PurchaseFailureCode, PurchaseRunner as BrowserPurchaseRunner, RadarReadResult, RadarReader as BrowserRadarReader } from "@selio/cloud";
import { repos } from "@selio/db";
import {
  AppError, radar, radarAlerts,
  type OrgContext, type PurchaseRunInput, type PurchaseRunOutcome, type PurchaseRunner, type RadarReader, type RadarReaderInput, type RadarReaderOutcome, type SendAlertsSummary, type Services,
} from "@selio/core";
import { systemContext, type TaskLogger } from "./tasks";

/**
 * Selio Radar côté worker : le navigateur de Selio Cloud (PlaywrightRunner de @selio/cloud, mêmes
 * créneaux de navigateurs que les actions du Cloud) branché sur le cœur, et les passages planifiés.
 *
 * - `radar.tick` (toutes les 30 s) : pour chaque organisation, `planOrgReads` → `runSearch` des recherches
 *   dues, la dernière lecture datée de l'heure prévue du passage (rythme de 60 s / 30 s tenu même avec
 *   plusieurs recherches), dans le plafond de pages par minute (organisation et machine) ; expiration des paiements
 *   3-D Secure non validés (alerte) ; fermeture des navigateurs d'achat qui n'attendent plus.
 * - `alerts.send` (chaque minute) : envoi des alertes en file (notifications de la PWA).
 * - `radar.auto` (toutes les 30 s, seulement si RADAR_AUTO_ENABLED) : un passage de Radar Auto.
 * - `radar.resume` (file « selio-radar ») : le client a validé le paiement 3-D Secure ; relecture de la
 *   confirmation dans le navigateur tenu ouvert, sans recliquer ni rien saisir.
 *
 * Lecture uniquement depuis le compte Achat relié au Cloud (vérifié par le cœur). Un CAPTCHA, un
 * avertissement, un blocage ou un « trop de requêtes » arrête la lecture : le cœur met le compte en
 * pause (écrite d'abord), déclenche le coupe-circuit de la machine si besoin, alerte le client et
 * enregistre la mesure. Rien n'est contourné ni retenté.
 *
 * Journaux : identifiants, codes et compteurs seulement — jamais de pseudo, de note, de photo ni de
 * titre d'annonce, jamais la session.
 */

/** File et job de reprise 3-D Secure (mêmes noms dans apps/api/src/queue.ts, à garder alignés). */
export const RADAR_QUEUE = "selio-radar";
export const RADAR_RESUME_JOB = "radar.resume";

// ---------------------------------------------------------------- lecture d'une page de recherche

/** Annonce lue par l'adaptateur catalogue → forme attendue par le cœur (revalidée par lui). */
export function toCatalogItemInput(item: CatalogItem): RadarCatalogItemInput {
  return {
    externalRef: item.externalRef,
    title: item.title,
    priceCents: item.priceCents,
    shippingCents: item.shippingCents ?? null,
    brand: item.brand,
    size: item.size,
    condition: item.condition,
    // La catégorie n'est pas visible sur une carte du catalogue.
    category: null,
    url: item.url,
    photoUrl: item.photoUrl,
    photoCount: item.photoCount,
    sellerHandle: item.sellerHandle,
    sellerRating: item.sellerRating ?? null,
    sellerReviews: item.sellerReviews ?? null,
    publishedAt: item.publishedAt,
    // Précision de la date (absolue, ou relative « il y a 3 min ») : seules les dates précises entrent dans la mesure.
    publishedAtSource: item.publishedAtSource,
  };
}

/** Résultat du lecteur de @selio/cloud → résultat attendu par le cœur (`{ ok, items }` ou `{ ok: false, code, launched }`). */
export function toCoreReadOutcome(r: RadarReadResult): RadarReaderOutcome {
  const base = { durationMs: r.durationMs, ...(r.session ? { session: r.session } : {}) };
  switch (r.outcome) {
    case "ok":
      return { ok: true, items: r.items.map(toCatalogItemInput), ...base };
    case "blocked":
      // Signal de Vinted : le cœur met le compte en pause, alerte, mesure (et coupe-circuit si besoin).
      return { ok: false, code: r.blocked?.code ?? "blocked", launched: true, message: r.message, ...base };
    case "not_logged_in":
      return { ok: false, code: "not_logged_in", launched: true, message: r.message, ...base };
    case "page_changed":
      return { ok: false, code: "selector_missing", launched: true, message: r.message, ...base };
    case "timeout":
      return { ok: false, code: "timeout", launched: r.launched, message: r.message, ...base };
    case "unavailable":
      // Aucun navigateur lancé : rien n'a touché Vinted, rien n'est compté.
      return { ok: false, code: "unavailable", launched: false, message: r.message, ...base };
    default:
      return { ok: false, code: "error", launched: r.launched, message: r.message, ...base };
  }
}

/**
 * Lecteur du cœur bâti sur `RadarReader` de @selio/cloud : adresse de la page catalogue construite à
 * partir des critères (domaine Vinted du compte, liste fermée), session du compte Achat, page lue puis
 * navigateur refermé. Les critères qui ne passent pas dans l'adresse sont filtrés après lecture.
 */
export class CloudRadarReader implements RadarReader {
  constructor(private readonly reader: Pick<BrowserRadarReader, "readSearch">, private readonly log: TaskLogger) {}

  async read(input: RadarReaderInput): Promise<RadarReaderOutcome> {
    let url: string;
    try {
      url = buildSearchUrl(input.criteria, { host: input.vintedHost });
    } catch {
      return { ok: false, code: "error", message: "Domaine Vinted refusé : aucune page lue.", launched: false, durationMs: 0 };
    }
    const r = await this.reader.readSearch({ session: input.session, url, criteria: input.criteria });
    const out = toCoreReadOutcome(r);
    const meta = { orgId: input.orgId, searchId: input.searchId, outcome: r.outcome, items: r.items.length, seen: r.seenCount, ms: r.durationMs };
    if (r.outcome === "blocked") this.log.warn({ ...meta, code: r.blocked?.code ?? null }, "radar : Vinted a arrêté la lecture (aucun contournement, compte Achat mis en pause)");
    else if (r.outcome === "page_changed") this.log.warn({ ...meta, missing: r.missing.length }, "radar : page de recherche non reconnue (adaptateur à revoir)");
    else this.log.info(meta, "radar : page lue");
    return out;
  }
}

/**
 * Selio Cloud désactivé (CLOUD_ENABLED faux ou Chromium absent) : aucune lecture en direct. Le passage
 * ne lit alors que les recherches du simulateur ; ce lecteur ne sert que de garde (rien n'est lancé,
 * rien n'est compté : aucune mesure inventée).
 */
export class CloudOffRadarReader implements RadarReader {
  async read(): Promise<RadarReaderOutcome> {
    return { ok: false, code: "unavailable", message: "Selio Cloud est désactivé sur ce serveur : aucune lecture en direct.", launched: false, durationMs: 0 };
  }
}

// ---------------------------------------------------------------- achat (Radar Auto)

const PURCHASE_CODES: Record<PurchaseFailureCode, Extract<PurchaseRunOutcome, { status: "failed" }>["code"]> = {
  captcha: "captcha",
  warning: "warning",
  blocked: "blocked",
  rate_limited: "rate_limited",
  not_logged_in: "not_logged_in",
  invalid_input: "error",
  real_purchase_disabled: "error",
  item_unavailable: "unavailable",
  selector_missing: "selector_missing",
  wallet_not_selected: "selector_missing",
  wallet_not_offered: "wallet_unavailable",
  payment_failed: "payment_error",
  unexpected_page: "selector_missing",
  unconfirmed: "timeout",
  "3ds_timeout": "timeout",
  timeout: "timeout",
  unavailable: "unavailable",
  error: "error",
};

/** Résultat de l'achat de @selio/cloud → résultat attendu par le cœur. */
export function toCorePurchaseOutcome(r: PurchaseResult, maxTotalCents: number): PurchaseRunOutcome {
  const session = "session" in r && r.session ? { session: r.session } : {};
  const pages = typeof r.pages === "number" ? { pages: r.pages } : {};
  switch (r.outcome) {
    case "dry_run":
      return { status: "dry_run", totalCents: r.totalCents, durationMs: r.durationMs, ...pages, ...session };
    case "awaiting_3ds":
      // Échéance du navigateur tenu ouvert : la base enregistre la même (jamais plus tôt que le navigateur).
      return { status: "awaiting_3ds", totalCents: r.totalCents, expiresAt: r.expiresAt, durationMs: r.durationMs, ...pages };
    case "purchased":
      // Le total est relu avant de payer (sinon aucun paiement) : le plafond n'est qu'un dernier repli.
      return { status: "purchased", totalCents: r.totalCents ?? maxTotalCents, orderRef: r.orderRef, durationMs: r.durationMs, ...pages, ...session };
    case "price_changed":
      return { status: "failed", code: "price_changed", sideEffects: "none", launched: true, message: "Prix affiché au-dessus du maximum : arrêt avant de payer.", durationMs: r.durationMs, ...pages, ...session };
    default: {
      if (r.code === "item_unavailable") {
        return { status: "unavailable", reason: r.unavailable === "sold" || r.unavailable === "reserved" ? r.unavailable : "hidden", durationMs: r.durationMs, ...pages, ...session };
      }
      return { status: "failed", code: PURCHASE_CODES[r.code], message: r.message, launched: r.launched, sideEffects: r.sideEffects, durationMs: r.durationMs, ...pages, ...session };
    }
  }
}

/**
 * Exécuteur d'achat du cœur bâti sur `PurchaseRunner` de @selio/cloud. Paiement par le porte-monnaie
 * Vinted du client ; essai à blanc tant que l'achat réel n'est pas ouvert (le cœur passe `dryRun`, et
 * le runner refuse de toute façon sans RADAR_AUTO_ENABLED + RADAR_REAL_PURCHASE). Validation 3-D Secure
 * demandée par la banque : le navigateur reste ouvert (CLOUD_3DS_TIMEOUT_MS), le client valide dans son
 * application, `resume` relit la page. Aucun code n'est jamais saisi à sa place.
 *
 * La reprise ne vit qu'en mémoire : après un redémarrage du worker, elle rend « délai dépassé, effets
 * inconnus » et rien n'est racheté (le client vérifie dans Vinted).
 */
export class CloudPurchaseAdapter implements PurchaseRunner {
  private readonly pending = new Map<string, { token: string; orgId: string }>();

  /**
   * `limiter` : plafond global de pages par minute de la machine (le même que les lectures) ; un achat
   * n'est pas lancé s'il est atteint, et ses pages y sont comptées après coup.
   */
  constructor(private readonly runner: Pick<BrowserPurchaseRunner, "buy" | "resume" | "cancel">, private readonly log: TaskLogger, private readonly limiter: Pick<PageRateLimiter, "used" | "record" | "maxPerMinute"> | null = null, private readonly now: () => Date = () => new Date()) {}

  /** Achats qui attendent la validation 3-D Secure du client (navigateurs tenus ouverts). */
  get pendingCount(): number {
    return this.pending.size;
  }

  async buy(input: PurchaseRunInput): Promise<PurchaseRunOutcome> {
    let result: PurchaseResult;
    if (input.resume) {
      // Jeton absent (worker redémarré, attente close) : le runner rend « délai dépassé », effets inconnus.
      // La reprise relit le navigateur déjà ouvert : aucune session n'est reprise ni passée.
      result = await this.runner.resume(this.pending.get(input.purchaseId)?.token ?? "", { waitMs: RESUME_WAIT_MS });
    } else {
      if (this.limiter && this.limiter.used(this.now()) >= this.limiter.maxPerMinute) {
        return { status: "failed", code: "unavailable", launched: false, sideEffects: "none", message: "Plafond de pages par minute de la machine atteint : achat reporté.", durationMs: 0 };
      }
      result = await this.runner.buy({ session: input.session, itemUrl: input.itemUrl, maxTotalCents: input.maxTotalCents, dryRun: input.dryRun });
    }
    if (this.limiter && typeof result.pages === "number" && result.pages > 0) this.limiter.record(this.now(), result.pages);
    if (result.outcome === "awaiting_3ds") this.pending.set(input.purchaseId, { token: result.resumeToken, orgId: input.orgId });
    else this.pending.delete(input.purchaseId);
    const code = result.outcome === "failed" ? result.code : null;
    const meta = { orgId: input.orgId, purchaseId: input.purchaseId, outcome: result.outcome, code, dryRun: input.dryRun, resume: input.resume === true, ms: result.durationMs };
    if (result.outcome === "failed" && result.stop) this.log.warn(meta, "radar auto : Vinted a arrêté l'achat (aucun contournement, compte Achat mis en pause)");
    else this.log.info(meta, "radar auto : achat");
    return toCorePurchaseOutcome(result, input.maxTotalCents);
  }

  /**
   * Ferme les navigateurs dont la demande est TERMINÉE (annulée par le client, expirée, bloquée,
   * achevée) ou introuvable : un créneau de navigateur ne reste jamais pris pour rien. Une demande encore
   * « en cours » (`draft` : le runner vient de rendre l'attente 3-D Secure, la base n'est pas encore
   * écrite) ou en attente de la banque n'est jamais touchée.
   */
  async releaseSettled(services: Services): Promise<number> {
    let released = 0;
    for (const [purchaseId, p] of [...this.pending]) {
      const status = await services.db.withOrg(p.orgId, (tx) => repos.purchases.byId(tx, purchaseId)).then((x) => x.status, (err: unknown) => (err instanceof AppError && err.status === 404 ? "missing" : "unknown"));
      if (!SETTLED_STATUSES.has(status)) continue;
      this.pending.delete(purchaseId);
      await this.runner.cancel(p.token).catch(() => false);
      released++;
    }
    return released;
  }

  /** Arrêt du worker : tous les navigateurs d'achat sont fermés (les demandes expireront, avec alerte). */
  async closeAll(): Promise<void> {
    const all = [...this.pending.values()];
    this.pending.clear();
    for (const p of all) await this.runner.cancel(p.token).catch(() => false);
  }
}

/** Statuts terminaux d'une demande d'achat (ou demande supprimée) : le navigateur tenu ouvert peut être fermé. */
const SETTLED_STATUSES: ReadonlySet<string> = new Set(["cancelled", "blocked", "executed", "simulated", "missing"]);
/** Relecture de la confirmation à la reprise 3-D Secure : quelques secondes (retour de la banque vers Vinted). */
const RESUME_WAIT_MS = 5_000;

// ---------------------------------------------------------------- plafond global de pages

/**
 * Plafond de pages lues en direct par minute sur toute la machine (RADAR_MAX_PAGES_PER_MINUTE_GLOBAL),
 * en plus du plafond par organisation (réglage `settings.radar.maxPagesPerMinute`, vérifié par le cœur).
 * Fenêtre glissante d'une minute ; une lecture qui n'a rien lu rend sa place.
 */
export class PageRateLimiter {
  private stamps: number[] = [];

  constructor(readonly maxPerMinute: number) {}

  private prune(now: number): void {
    this.stamps = this.stamps.filter((t) => t > now - 60_000);
  }

  /** Pages comptées dans la dernière minute. */
  used(now: Date): number {
    this.prune(now.getTime());
    return this.stamps.length;
  }

  /** Réserve une page ; null si le plafond est atteint. */
  tryTake(now: Date): number | null {
    const t = now.getTime();
    this.prune(t);
    if (this.stamps.length >= this.maxPerMinute) return null;
    this.stamps.push(t);
    return t;
  }

  /** Rend une réservation (aucune page lue). */
  release(token: number): void {
    const i = this.stamps.lastIndexOf(token);
    if (i >= 0) this.stamps.splice(i, 1);
  }

  /** Compte des pages déjà chargées (achat Radar Auto), même au-delà du plafond : elles ont eu lieu. */
  record(now: Date, pages: number): void {
    const t = now.getTime();
    this.prune(t);
    for (let i = 0; i < Math.max(0, Math.round(pages)); i++) this.stamps.push(t);
  }
}

// ---------------------------------------------------------------- passages

export interface RadarTickDeps {
  /** Lecture en direct possible (Selio Cloud activé, Chromium prêt) ; sinon seules les recherches du simulateur sont lues. */
  liveEnabled: boolean;
  limiter: PageRateLimiter;
  /** Organisations traitées en parallèle ; les navigateurs restent bornés par les créneaux partagés avec le Cloud. */
  concurrency: number;
  /** Horloge (tests) ; sinon `services.now()`. */
  now?: () => Date;
  shouldStop?: () => boolean;
  /** Exécuteur d'achat : ferme les navigateurs 3-D Secure qui n'attendent plus. */
  purchases?: Pick<CloudPurchaseAdapter, "releaseSettled"> | null;
}

export interface RadarTickSummary {
  orgs: number;
  /** Pages lues (en direct) et lectures du simulateur. */
  liveReads: number;
  demoReads: number;
  found: number;
  /** Lectures arrêtées par un signal de Vinted (compte Achat mis en pause). */
  blocked: number;
  skipped: Record<string, number>;
  expired3ds: number;
  released3ds: number;
  errors: number;
  /** Coupe-circuit de la machine déclenché pendant ce passage (fin), sinon null. */
  circuitUntil: string | null;
}

/** File d'attente simple : `fn` sur chaque élément, `concurrency` à la fois. */
async function eachLimited<T>(items: readonly T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await fn(item);
    }
  });
  await Promise.all(lanes);
}

/** Raisons d'écart du cœur après lesquelles plus rien n'est lu pour l'organisation pendant ce passage. */
const STOP_ORG = new Set(["pages_per_minute", "machine_paused", "global_pause"]);

/**
 * Passage de Radar (toutes les 30 s) : pour chaque organisation ayant une recherche active, une alerte
 * en file ou un paiement 3-D Secure en attente, les recherches dues (`planReads`) sont lues par
 * `runSearch`, la plus en retard d'abord, dans les plafonds de pages par minute. Puis les paiements
 * 3-D Secure échus sont abandonnés (avec alerte) et les navigateurs qui n'attendent plus sont fermés.
 */
export async function radarTick(services: Services, log: TaskLogger, deps: RadarTickDeps): Promise<RadarTickSummary> {
  const clock = () => deps.now?.() ?? services.now();
  const summary: RadarTickSummary = { orgs: 0, liveReads: 0, demoReads: 0, found: 0, blocked: 0, skipped: {}, expired3ds: 0, released3ds: 0, errors: 0, circuitUntil: null };
  const skip = (reason: string) => { summary.skipped[reason] = (summary.skipped[reason] ?? 0) + 1; };
  const orgIds = await radar.radarOrgIds(services);
  summary.orgs = orgIds.length;
  await eachLimited(orgIds, deps.concurrency, async (orgId) => {
    const ctx = systemContext(services, orgId);
    try {
      // Heure prévue du passage : la dernière lecture de chaque recherche en est datée (`anchorReadAt`).
      const slotAt = clock();
      for (const p of await radar.planOrgReads(services, orgId, slotAt)) {
        if (!p.due) continue;
        const live = p.source === "cloud";
        if (deps.shouldStop?.()) { skip("worker_stopping"); continue; }
        if (live && !deps.liveEnabled) { skip("cloud_disabled"); continue; }
        const now = clock();
        const token = live ? deps.limiter.tryTake(now) : null;
        if (live && token === null) { skip("global_pages_per_minute"); continue; }
        let res: Awaited<ReturnType<typeof radar.runSearch>>;
        try {
          res = await radar.runSearch(ctx, p.searchId, { now, slotAt, fromTick: true, followUp: false });
        } catch (err) {
          // La page a pu être chargée avant l'erreur : la place n'est PAS rendue (le cœur a déjà
          // enregistré la mesure et la date de lecture si c'est le cas ; une minute perdue au pire).
          summary.errors++;
          log.warn({ orgId, searchId: p.searchId, error: err instanceof AppError ? err.code : err instanceof Error ? err.name : "Error" }, "radar : lecture en échec");
          continue;
        }
        // Aucun navigateur lancé (écartée, aucun créneau libre) : la place est rendue.
        if (token !== null && !res.launched) deps.limiter.release(token);
        if (res.skipped) {
          skip(res.skipped);
          if (STOP_ORG.has(res.skipped)) break;
          continue;
        }
        if (live) summary.liveReads++;
        else summary.demoReads++;
        summary.found += res.found;
        if (res.paused) {
          summary.blocked++;
          log.warn({ orgId, searchId: p.searchId, outcome: res.outcome, factor: res.factor }, "radar : signal de Vinted — compte Achat en pause, client alerté, mesure enregistrée, rien n'est retenté");
        }
        if (res.circuitUntil) {
          summary.circuitUntil = res.circuitUntil;
          // Alerte de l'opérateur : l'adresse partagée a reçu « trop de requêtes » ou un blocage.
          log.error({ orgId, until: res.circuitUntil }, "radar : COUPE-CIRCUIT de la machine déclenché (trop de requêtes ou blocage de Vinted) — plus aucune lecture ni action Cloud jusqu'à la date indiquée");
          break;
        }
      }
      summary.expired3ds += await radar.expireAwaiting3ds(services, orgId, clock());
    } catch (err) {
      summary.errors++;
      log.error({ orgId, error: err instanceof Error ? err.name : "Error" }, "radar : échec du passage pour une organisation");
    }
  });
  if (deps.purchases) summary.released3ds = await deps.purchases.releaseSettled(services).catch(() => 0);
  return summary;
}

export interface AlertsTickSummary extends SendAlertsSummary {
  orgs: number;
  /** Faux : aucune clé VAPID, les alertes restent en file (et expirent après 12 h). */
  pushEnabled: boolean;
  errors: number;
}

/** Envoi des alertes Radar échues (chaque minute), organisation par organisation. */
export async function alertsTick(services: Services, log: TaskLogger, opts: { now?: Date } = {}): Promise<AlertsTickSummary> {
  const summary: AlertsTickSummary = { orgs: 0, pushEnabled: Boolean(services.push), sent: 0, failed: 0, expired: 0, disabledSubscriptions: 0, pending: 0, errors: 0 };
  for (const orgId of await radar.radarOrgIds(services)) {
    summary.orgs++;
    try {
      const r = await radarAlerts.sendDueAlerts(services, orgId, opts.now ? { now: opts.now } : {});
      summary.sent += r.sent;
      summary.failed += r.failed;
      summary.expired += r.expired;
      summary.disabledSubscriptions += r.disabledSubscriptions;
      summary.pending += r.pending;
    } catch (err) {
      summary.errors++;
      log.error({ orgId, error: err instanceof Error ? err.name : "Error" }, "alertes : échec de l'envoi pour une organisation");
    }
  }
  return summary;
}

export interface RadarAutoTickSummary {
  enabled: boolean;
  orgs: number;
  /** Organisations dont un verrou est fermé (rien n'est évalué). */
  locked: number;
  bought: number;
  awaiting3ds: number;
  errors: number;
}

/**
 * Passage de Radar Auto (toutes les 30 s, seulement si RADAR_AUTO_ENABLED) : pour chaque organisation
 * qui l'a activé, `runAutoBuy` (verrous, seuil, prix maximum, plafond du jour, un achat par le
 * navigateur au plus par passage, essai à blanc tant que l'achat réel est fermé).
 */
export async function radarAutoTick(services: Services, log: TaskLogger, opts: { now?: Date; shouldStop?: () => boolean } = {}): Promise<RadarAutoTickSummary> {
  const summary: RadarAutoTickSummary = { enabled: services.config?.radarAutoEnabled === true, orgs: 0, locked: 0, bought: 0, awaiting3ds: 0, errors: 0 };
  if (!summary.enabled) return summary;
  for (const orgId of await radar.radarOrgIds(services)) {
    if (opts.shouldStop?.()) break;
    try {
      const org = await services.db.withOrg(orgId, (tx) => repos.orgs.byId(tx, orgId));
      if (!org.settings.autoBuy.enabled) continue;
      summary.orgs++;
      const r = await radar.runAutoBuy(systemContext(services, orgId), opts.now ? { now: opts.now } : {});
      if (r.disabled) {
        summary.locked++;
        continue;
      }
      summary.bought += r.bought;
      summary.awaiting3ds += r.awaiting3ds;
      if (r.bought || r.awaiting3ds) log.info({ orgId, bought: r.bought, awaiting3ds: r.awaiting3ds, realPurchase: r.realPurchase }, "radar auto : passage");
      // Validation 3-D Secure demandée : le délai de la banque est court, le client est prévenu sans attendre « alerts.send ».
      if (r.awaiting3ds > 0) await radarAlerts.sendDueAlerts(services, orgId, opts.now ? { now: opts.now } : {}).catch(() => null);
    } catch (err) {
      summary.errors++;
      log.error({ orgId, error: err instanceof AppError ? err.code : err instanceof Error ? err.name : "Error" }, "radar auto : échec du passage pour une organisation");
    }
  }
  return summary;
}

/**
 * Reprise après la validation 3-D Secure (job « radar.resume » ajouté par l'API) : au nom du membre qui
 * l'a demandée (rôle relu en base), relecture de la confirmation dans le navigateur tenu ouvert.
 */
export async function radarResumeTask(services: Services, data: unknown, log: TaskLogger): Promise<{ status: string | null; error?: string }> {
  const d = (data ?? {}) as { orgId?: unknown; purchaseId?: unknown; userId?: unknown };
  if (typeof d.orgId !== "string" || typeof d.purchaseId !== "string" || typeof d.userId !== "string") return { status: null, error: "invalid_job" };
  const { orgId, purchaseId, userId } = d;
  const membership = await services.db.withGlobal((tx) => repos.memberships.get(tx, orgId, userId));
  if (!membership) return { status: null, error: "not_member" };
  const ctx: OrgContext = { services, orgId, userId, role: membership.role, isOperator: false, ip: null };
  try {
    const p = await radar.resumePurchase(ctx, purchaseId);
    log.info({ orgId, purchaseId, status: p.status }, "radar auto : reprise après la validation 3-D Secure");
    return { status: p.status };
  } catch (err) {
    const code = err instanceof AppError ? err.code : err instanceof Error ? err.name : "Error";
    log.warn({ orgId, purchaseId, error: code }, "radar auto : reprise impossible");
    return { status: null, error: code };
  }
}

// ---------------------------------------------------------------- un seul passage à la fois

/**
 * Un seul passage à la fois dans ce processus : les plannings tournent toutes les 30 s alors qu'un
 * passage peut durer plus longtemps (pages lues au rythme du navigateur). Le job de maintenance rend
 * la main tout de suite pour ne pas retenir les autres tâches (file à un seul exécutant).
 */
export class SingleFlight<T> {
  private running: Promise<T | null> | null = null;
  private stoppingFlag = false;

  constructor(private readonly name: string, private readonly task: () => Promise<T>, private readonly log: TaskLogger, private readonly report?: (result: T) => void) {}

  get stopping(): boolean {
    return this.stoppingFlag;
  }

  stop(): void {
    this.stoppingFlag = true;
  }

  trigger(): { started: boolean } {
    if (this.running || this.stoppingFlag) return { started: false };
    this.running = this.task()
      .then((r) => {
        this.report?.(r);
        return r;
      })
      .catch((err: unknown) => {
        this.log.error({ name: this.name, error: err instanceof Error ? err.name : "Error" }, "passage en échec");
        return null;
      })
      .finally(() => {
        this.running = null;
      });
    return { started: true };
  }

  /** Attend la fin du passage en cours (arrêt du worker), au plus `timeoutMs`. */
  async drain(timeoutMs: number): Promise<void> {
    const current = this.running;
    if (!current) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([current, new Promise((r) => { timer = setTimeout(r, timeoutMs); })]);
    if (timer) clearTimeout(timer);
  }
}
