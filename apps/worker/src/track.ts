import { buildSearchUrl, filterCatalogItems } from "@selio/connectors/vinted-adapter";
import type { RadarReadResult, RadarReader as BrowserRadarReader } from "@selio/cloud";
import type { TrackSource } from "@selio/contracts";
import { repos } from "@selio/db";
import { AppError, pricing, track, type Services, type TrainModelResult, type TrackReadResult, type TrackReader, type TrackReaderInput, type TrackReaderOutcome } from "@selio/core";
import { toCoreReadOutcome, type PageRateLimiter } from "./radar";
import type { TaskLogger } from "./tasks";

/**
 * Selio Track et estimation des prix côté worker.
 *
 * - `track.tick` (toutes les 15 min) : empreintes dues (`planTrackReads`), UNE lecture par empreinte quel que
 *   soit le nombre d'organisations qui la suivent (`runTrackRead`). Source : le simulateur par défaut ; les
 *   pages PUBLIQUES du catalogue (lecteur de Selio Cloud, sans session) si TRACK_LIVE_ENABLED et que le
 *   Cloud tourne. Plafond de pages par minute de Track ET de la machine (partagé avec Radar), mêmes créneaux
 *   de navigateurs que le Cloud et Radar. Au premier signal de Vinted : Track en pause (écrite d'abord par
 *   le cœur), facteur de ralentissement partagé doublé, coupe-circuit de la machine après un blocage ou un
 *   « trop de requêtes », journal ; rien n'est retenté, rien n'est contourné.
 * - `pricing.references` (chaque nuit) : ventes des organisations qui l'ont accepté ajoutées à la base de
 *   références, sans donnée personnelle ; ventes remboursées, annulées ou supprimées (ou accord retiré) retirées.
 * - `pricing.train` (chaque dimanche, ou à la demande d'un opérateur) : entraînement du modèle de prix sur
 *   la base (réelle si elle suffit, sinon démonstration, marquée comme telle), chargé en mémoire ensuite.
 * - Rétention (`retentionTick`, tasks.ts) : historique selon le plan, filtres au-delà du quota coupés.
 *
 * Journaux : empreintes abrégées, codes et compteurs seulement — jamais de titre, de pseudo, de photo ni
 * d'adresse d'annonce, jamais de session.
 */

// ---------------------------------------------------------------- lecture d'une page publique

/** Champs d'une annonce que Track ne doit jamais recevoir (pseudo, note du vendeur, photo, adresse). */
function withoutPersonalFields(item: unknown): unknown {
  if (!item || typeof item !== "object") return item;
  return { ...(item as Record<string, unknown>), url: null, photoUrl: null, sellerHandle: null, sellerRating: null, sellerReviews: null };
}

/** Date de publication la plus ancienne parmi les annonces datées (null si aucune). */
function oldestPublished(items: readonly { publishedAt?: string | null }[]): string | null {
  let min: number | null = null;
  for (const it of items) {
    const t = it.publishedAt ? new Date(it.publishedAt).getTime() : NaN;
    if (Number.isFinite(t) && (min === null || t < min)) min = t;
  }
  return min === null ? null : new Date(min).toISOString();
}

/**
 * Résultat du lecteur de @selio/cloud → résultat attendu par Track : comme Radar (signal → code du signal,
 * page non reconnue → `selector_missing`, aucun navigateur → `unavailable` non lancé), mais sans aucune
 * session (page publique) ni aucun champ personnel.
 *
 * La page est lue ENTIÈRE (sans filtre) : `seenCount` et `oldestPublishedAt` décrivent la page avant le
 * filtre local des critères (marques, tailles, états, prix), qui ne garde ensuite que les annonces suivies.
 * Le cœur décide ainsi des disparitions sur la page réelle, et non sur la liste filtrée.
 */
export function toTrackReaderOutcome(r: RadarReadResult, criteria?: TrackReaderInput["criteria"]): TrackReaderOutcome {
  const page = r.outcome === "ok" ? r.items : [];
  const kept = criteria ? filterCatalogItems(page, criteria) : page;
  const out = toCoreReadOutcome({ ...r, items: kept });
  if (out.ok) {
    return {
      ok: true, items: out.items.map(withoutPersonalFields), seenCount: page.length, oldestPublishedAt: oldestPublished(page),
      ...(out.durationMs !== undefined ? { durationMs: out.durationMs } : {}),
    };
  }
  const { session: _session, ...failure } = out;
  return failure;
}

/** Empreinte abrégée pour les journaux. */
const shortFp = (fp: string) => fp.slice(0, 12);

/**
 * Lecteur de Track bâti sur `RadarReader` de @selio/cloud : adresse de la page catalogue construite à partir
 * des critères (domaine de la liste fermée), AUCUNE session (pages publiques), page lue entière puis
 * navigateur refermé ; les critères qui ne passent pas dans l'adresse sont filtrés ensuite ici
 * (`toTrackReaderOutcome`), la taille et la date la plus ancienne de la page entière étant transmises.
 */
export class CloudTrackReader implements TrackReader {
  constructor(private readonly reader: Pick<BrowserRadarReader, "readSearch">, private readonly log: TaskLogger) {}

  async read(input: TrackReaderInput): Promise<TrackReaderOutcome> {
    let url: string;
    try {
      url = buildSearchUrl(input.criteria, { host: input.vintedHost });
    } catch {
      return { ok: false, code: "error", message: "Domaine Vinted refusé : aucune page lue.", launched: false, durationMs: 0 };
    }
    // Page entière (aucun filtre dans le lecteur) : le filtre local est appliqué par `toTrackReaderOutcome`.
    const r = await this.reader.readSearch({ session: null, url });
    const out = toTrackReaderOutcome(r, input.criteria);
    const meta = { fingerprint: shortFp(input.fingerprint), outcome: r.outcome, items: out.ok ? out.items.length : 0, seen: r.seenCount, ms: r.durationMs };
    if (r.outcome === "blocked") this.log.warn({ ...meta, code: r.blocked?.code ?? null }, "track : Vinted a arrêté la lecture (aucun contournement, Track mis en pause)");
    else if (r.outcome === "page_changed") this.log.warn({ ...meta, missing: r.missing.length }, "track : page catalogue non reconnue (adaptateur à revoir)");
    else this.log.info(meta, "track : page publique lue");
    return out;
  }
}

// ---------------------------------------------------------------- passage

export interface TrackTickDeps {
  /** Plafond de pages par minute de Track (TRACK_MAX_PAGES_PER_MINUTE). */
  limiter: PageRateLimiter;
  /** Plafond de pages par minute de la machine, partagé avec Radar (RADAR_MAX_PAGES_PER_MINUTE_GLOBAL). */
  machineLimiter?: PageRateLimiter | null;
  /** Horloge (tests) ; sinon `services.now()`. */
  now?: () => Date;
  shouldStop?: () => boolean;
  /** Empreintes lues au plus par passage (50 par défaut). */
  limit?: number;
  /**
   * Attente cumulée au plus (ms) d'une place dans le plafond de pages par minute de TRACK, sur tout le
   * passage : 0 (défaut) = le passage s'arrête au plafond. Le worker attend (environ 12 min sur un passage
   * de 15) pour lire les empreintes dues AU RYTHME RÉGLÉ, et non une dizaine par passage seulement. Le
   * plafond de la machine n'est jamais attendu : Radar reste prioritaire, le reste attend le passage suivant.
   */
  maxWaitMs?: number;
  /** Pause (tests : horloge simulée). */
  sleep?: (ms: number) => Promise<void>;
}

/** Durée de lecture d'un passage du worker (minutes), sous la cadence de 15 min de CRON_TRACK. */
export const TRACK_TICK_BUDGET_MINUTES = 12;

/** Pause par tranches d'une seconde au plus : l'arrêt du worker est vu sans attendre la fin de l'attente. */
const SLEEP_SLICE_MS = 1_000;
const realSleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms).unref?.(); });

export interface TrackTickSummary {
  source: TrackSource;
  /** Empreintes dues au début du passage (une par empreinte, toutes organisations confondues). */
  due: number;
  /** Lectures faites (page lue ou simulée, résultat enregistré). */
  reads: number;
  ok: number;
  /** Références écrites (annonces vues et disparues), sans donnée personnelle. */
  references: number;
  gone: number;
  /** Lectures anormales (page non reconnue, délai, erreur) : comptées, l'empreinte ralentit après 3 de suite. */
  anomalies: number;
  /** Lectures arrêtées par un signal de Vinted (Track mis en pause). */
  blocked: number;
  skipped: Record<string, number>;
  errors: number;
  /** Track en pause (signal pendant ce passage, ou pause en cours). */
  paused: boolean;
  /** Coupe-circuit de la machine déclenché pendant ce passage, sinon null. */
  circuitUntil: string | null;
  /** Facteur de ralentissement partagé après le passage (lectures en direct). */
  factor: number;
  /** Attente cumulée d'une place dans le plafond de pages par minute de Track (ms). */
  waitedMs: number;
}

/**
 * Passage de Track : les empreintes dues sont lues une par une, la plus en retard d'abord. En direct,
 * chaque page prend une place dans le plafond de Track et dans celui de la machine (rendue si rien n'a été
 * lu) ; plafond de Track atteint → attente d'une place tant que le budget d'attente du passage le permet
 * (`maxWaitMs`), sinon le reste attend le passage suivant ; plafond de la machine atteint → le reste attend
 * le passage suivant (Radar d'abord). Un signal de Vinted arrête le passage.
 */
export async function trackTick(services: Services, log: TaskLogger, deps: TrackTickDeps): Promise<TrackTickSummary> {
  const clock = () => deps.now?.() ?? services.now();
  const live = track.trackLiveEnabled(services) && !!services.track?.reader;
  const source: TrackSource = live ? "cloud" : "demo";
  const summary: TrackTickSummary = { source, due: 0, reads: 0, ok: 0, references: 0, gone: 0, anomalies: 0, blocked: 0, skipped: {}, errors: 0, paused: false, circuitUntil: null, factor: 1, waitedMs: 0 };
  const sleep = deps.sleep ?? realSleep;
  const maxWaitMs = Math.max(0, deps.maxWaitMs ?? 0);
  const skip = (reason: string) => { summary.skipped[reason] = (summary.skipped[reason] ?? 0) + 1; };
  const start = clock();
  const due = await services.db.withGlobal((tx) => repos.trackReads.due(tx, start.toISOString(), deps.limit ?? 50));
  const planned = track.planTrackReads(due, start);
  summary.due = planned.length;
  for (const p of planned) {
    if (deps.shouldStop?.()) { skip("worker_stopping"); break; }
    let now = clock();
    const taken: { limiter: PageRateLimiter; token: number }[] = [];
    if (live) {
      let t = deps.limiter.tryTake(now);
      // Plafond de Track atteint : attente d'une place (dans la limite du passage), sinon arrêt du passage.
      while (t === null && !deps.shouldStop?.()) {
        const freeIn = deps.limiter.msUntilFree(now);
        if (summary.waitedMs + freeIn > maxWaitMs) break;
        const slice = Math.min(freeIn, SLEEP_SLICE_MS);
        await sleep(slice);
        summary.waitedMs += slice;
        now = clock();
        t = deps.limiter.tryTake(now);
      }
      if (t === null) { skip(deps.shouldStop?.() ? "worker_stopping" : "track_pages_per_minute"); break; }
      taken.push({ limiter: deps.limiter, token: t });
      if (deps.machineLimiter) {
        const m = deps.machineLimiter.tryTake(now);
        if (m === null) { deps.limiter.release(t); skip("global_pages_per_minute"); break; }
        taken.push({ limiter: deps.machineLimiter, token: m });
      }
    }
    let res: TrackReadResult;
    try {
      res = await track.runTrackRead(services, p.fingerprint, source, { now });
    } catch (err) {
      // La page a pu être chargée avant l'erreur : les places ne sont PAS rendues.
      summary.errors++;
      log.warn({ fingerprint: shortFp(p.fingerprint), error: err instanceof AppError ? err.code : err instanceof Error ? err.name : "Error" }, "track : lecture en échec");
      continue;
    }
    // Rien de lu (écartée, ou aucun navigateur libre) : les places sont rendues.
    if (res.outcome === null) for (const x of taken) x.limiter.release(x.token);
    if (res.skipped) {
      skip(res.skipped);
      if (res.skipped === "paused" || res.skipped === "machine_paused") {
        summary.paused = true;
        break;
      }
      continue;
    }
    if (res.outcome === null) { skip("no_browser"); continue; }
    summary.reads++;
    summary.factor = Math.max(summary.factor, res.factor);
    if (res.outcome === "ok") {
      summary.ok++;
      summary.references += res.references;
      summary.gone += res.goneCount;
    } else if (!res.paused) {
      summary.anomalies++;
      log.warn({ fingerprint: shortFp(p.fingerprint), outcome: res.outcome, factor: res.factor }, "track : lecture anormale (comptée ; l'empreinte ralentit après 3 de suite)");
    }
    if (res.paused) {
      summary.blocked++;
      summary.paused = true;
      log.warn({ fingerprint: shortFp(p.fingerprint), outcome: res.outcome, factor: res.factor, nextReadAt: res.nextReadAt }, "track : signal de Vinted — lectures en direct en pause, ralentissement partagé, rien n'est retenté");
    }
    if (res.circuitUntil) {
      summary.circuitUntil = res.circuitUntil;
      log.error({ until: res.circuitUntil }, "track : COUPE-CIRCUIT de la machine déclenché (trop de requêtes ou blocage de Vinted) — plus aucune lecture ni action Cloud jusqu'à la date indiquée");
    }
    if (res.paused) break;
  }
  return summary;
}

// ---------------------------------------------------------------- prix

/** Toutes les organisations (même liste que les autres passages du worker). */
async function allOrgIds(services: Services): Promise<string[]> {
  return (await services.db.withGlobal((tx) => repos.admin.orgSummary(tx))).map((o) => o.id);
}

export interface PricingReferencesSummary {
  orgs: number;
  /** Organisations qui ont accepté le partage de leurs ventes. */
  sharing: number;
  /** Références écrites (ajoutées ou mises à jour). */
  references: number;
  /** Références retirées (ventes remboursées, annulées ou supprimées ; accord retiré). */
  removed: number;
  errors: number;
}

/**
 * Ventes des organisations qui l'ont accepté → base de références (sans client, titre, identifiant ni photo) ;
 * ventes devenues inéligibles et ventes des organisations sans accord retirées.
 */
export async function pricingReferencesTick(services: Services, log: TaskLogger): Promise<PricingReferencesSummary> {
  const summary: PricingReferencesSummary = { orgs: 0, sharing: 0, references: 0, removed: 0, errors: 0 };
  for (const orgId of await allOrgIds(services)) {
    summary.orgs++;
    try {
      const r = await pricing.addReferencesFromSales(services, orgId);
      if (r.shared) summary.sharing++;
      summary.references += r.written;
      summary.removed += r.removed;
    } catch (err) {
      summary.errors++;
      log.error({ orgId, error: err instanceof Error ? err.name : "Error" }, "prix : références d'une organisation en échec");
    }
  }
  return summary;
}

export interface PricingTrainSummary {
  trained: boolean;
  version: string | null;
  /** Vrai : entraîné sur des données de démonstration (aucune mesure réelle). */
  synthetic: boolean;
  references: number;
  reason: string | null;
  /** Modèle chargé en mémoire après l'entraînement (null : aucun). */
  loaded: string | null;
  referencesAdded: number;
  ms: number;
}

/**
 * Entraînement du modèle de prix (dimanche, ou demande d'un opérateur) : ventes de la semaine ajoutées à la
 * base, puis `trainActiveModel` (réel si la base suffit, sinon démonstration ; refus sous le seuil). Le
 * nouveau modèle devient actif et est chargé dans `services.pricing.model`.
 */
export async function pricingTrainTask(services: Services, log: TaskLogger, opts: { minReferences?: number; now?: Date; refreshReferences?: boolean } = {}): Promise<PricingTrainSummary> {
  const started = Date.now();
  const added = opts.refreshReferences === false ? { references: 0 } : await pricingReferencesTick(services, log);
  const r: TrainModelResult = await pricing.trainActiveModel(services, { ...(opts.now ? { now: opts.now } : {}), ...(opts.minReferences ? { minReferences: opts.minReferences } : {}) });
  const loaded = services.pricing?.model?.version ?? null;
  const summary: PricingTrainSummary = r.trained
    ? { trained: true, version: r.record.version, synthetic: r.synthetic, references: r.references, reason: null, loaded, referencesAdded: added.references, ms: Date.now() - started }
    : { trained: false, version: null, synthetic: false, references: r.references, reason: r.reason, loaded, referencesAdded: added.references, ms: Date.now() - started };
  if (r.trained) {
    const m = r.record.metrics;
    log.info({ version: r.record.version, synthetic: r.synthetic, references: r.references, measured: m.measured ?? false, mdape: m.mdape ?? null, within20: m.within20 ?? null, coverage50: m.coverage50 ?? null, loaded, ms: summary.ms }, r.synthetic ? "prix : modèle entraîné sur les données de DÉMONSTRATION (aucune mesure réelle) et chargé" : "prix : modèle entraîné, testé sur le dernier mois et chargé");
  } else {
    log.warn({ reason: r.reason, references: r.references, loaded }, "prix : modèle non entraîné");
  }
  return summary;
}
