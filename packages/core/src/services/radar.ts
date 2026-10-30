import { createHash } from "node:crypto";
import {
  RADAR_3DS_TIMEOUT_MINUTES, RADAR_AUTO_PRICE_TOLERANCE_CENTS, RADAR_AUTO_SHARED_ADDRESS_NOTICE, RADAR_AUTO_UNSHOWN_SHIPPING_ALLOWANCE_CENTS, RADAR_BLOCKS_PER_1000_THRESHOLD, RADAR_CATCHUP_GAP_MINUTES,
  RADAR_DEMO_INTERVAL_SECONDS, RADAR_DUE_TOLERANCE_SECONDS, RADAR_EMBEDDING_MIN_SIMILARITY, RADAR_EMBEDDING_TOP_K, RADAR_INITIAL_STOCK_GRACE_MINUTES,
  RADAR_LIVE_REQUIRES_CLOUD, RADAR_MAX_CONSECUTIVE_ANOMALIES, RADAR_MAX_PRIORITY_SEARCHES, RADAR_MAX_SLOWDOWN_FACTOR, RADAR_OPPORTUNITY_PERSONAL_DATA_DAYS, RADAR_PRIORITY_INTERVAL_SECONDS, RADAR_READ_INTERVAL_SECONDS,
  RADAR_READS_RETENTION_DAYS, RADAR_SLOWDOWN_RECOVERY_HOURS, RADAR_SLOWDOWN_WINDOW_READS, RADAR_TICK_SECONDS,
  filterVintedStorageState, isStorageStateEmpty, radarAlertPayload, radarSearchCreate, radarSettingsUpdate,
  type AutoBuySettings, type CloudStorageState, type MarketplaceConnection, type Opportunity, type Organization, type PurchaseRequest, type RadarCatalogItem, type RadarMetrics, type RadarReadOutcome, type RadarSearch, type RadarSettings, type RadarSourceKind,
} from "@selio/contracts";
import { repos, type Tx } from "@selio/db";
import {
  autoBuyDecision, canStillCancel, cancelableUntil, comparableText, comparablesFromSales, estimateResale, estimateResaleFromSimilar, isActiveAccount, nearestComparables, purchaseCost, purchaseOutcome,
  rankOpportunities, resolvePurchaseAccount, runPurchaseChecks, scoreOpportunity, titledComparablesFromSales,
  type Comparable, type Estimate, type PurchaseCost, type TitledComparable,
} from "@selio/domain";
import { AppError, nowIso, requireAction, withOrg, type OrgContext, type Services, type ServicesConfig } from "../context";
import { enqueueAutoSuspendedAlert, enqueueBlockedAlert, enqueueOpportunityAlert, enqueuePaymentAlert, enqueueSearchSuspendedAlert, localDayStart, sendDueAlerts, type SendAlertsSummary } from "./alerts";
import * as cloud from "./cloud";
import { checkLiveAccountTx, readLiveSessionTx, safeVintedUrl, sourceFor, type LiveAccount, type PurchaseRunOutcome, type RadarSignal, type RadarSourceResult } from "./radar-sources";

/**
 * Selio Radar et Radar Auto (prompt §5.8).
 *
 * Règles tenues ici :
 * - lecture EN DIRECT seulement depuis le compte ACHAT du client relié à Selio Cloud (compte Cloud actif,
 *   session chiffrée, accord valide) : jamais un compte Perso ni un compte de vente ;
 * - aucun contournement : un CAPTCHA, un avertissement, un blocage ou un « trop de requêtes » arrête la
 *   lecture, le compte Cloud passe en pause (écrite d'abord), le client est alerté (email et notification),
 *   le coupe-circuit de la machine se déclenche après un « trop de requêtes » ou un blocage, et la mesure
 *   est enregistrée ; aucune relecture avant le cycle suivant multiplié par le facteur de ralentissement ;
 * - ralentissement automatique, seule réaction : au-delà de 1 blocage pour 1 000 pages (1 000 dernières
 *   mesures en direct de l'organisation, pages d'achat comprises), l'intervalle double (60 → 120 → 240 s…)
 *   pour TOUTES les recherches en direct de l'organisation (facteur gardé hors des recherches), puis le
 *   facteur est divisé par deux par tranche de 24 h sans blocage ; plafond de pages par minute par
 *   organisation (pages d'achat comprises) ; une recherche dont la page n'est pas reconnue plusieurs fois
 *   de suite est arrêtée (client et opérateur alertés) ;
 * - Radar Auto derrière deux verrous (RADAR_AUTO_ENABLED côté serveur, réglage de l'organisation), pas
 *   ouvert aux clients sur l'adresse partagée tant qu'Ibrahim n'a pas tranché ; paiement par le
 *   porte-monnaie Vinted, validation 3-D Secure attendue du client (jamais saisie à sa place) ; achat réel
 *   désactivé par défaut (D11) : le parcours s'arrête avant le paiement ;
 * - données du vendeur (pseudo, note, photo) gardées le temps de l'affaire seulement (purge) ;
 * - statistiques honnêtes : rien n'est « mesuré » sans lecture en direct (le simulateur ne compte jamais).
 */

const isTrue = (v: unknown): boolean => v === true || (typeof v === "string" && ["1", "true", "yes", "oui"].includes(v.trim().toLowerCase()));

/** Lit RADAR_AUTO_ENABLED, RADAR_AUTO_ORG_IDS et RADAR_REAL_PURCHASE (API et worker). Tout est fermé par défaut. */
export function radarConfigFromEnv(env: Record<string, string | undefined> = process.env): Pick<ServicesConfig, "radarAutoEnabled" | "radarAutoOrgIds" | "radarRealPurchase"> {
  const ids = (env.RADAR_AUTO_ORG_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return { radarAutoEnabled: isTrue(env.RADAR_AUTO_ENABLED), radarAutoOrgIds: ids.length ? ids : undefined, radarRealPurchase: isTrue(env.RADAR_REAL_PURCHASE) };
}

/** Premier verrou de Radar Auto, côté serveur : RADAR_AUTO_ENABLED (et la liste des comptes de l'équipe si elle est renseignée). */
export function radarAutoServerGate(services: Pick<Services, "config">, orgId: string): { allowed: boolean; reason: string | null } {
  const c = services.config ?? {};
  if (c.radarAutoEnabled !== true) return { allowed: false, reason: `Radar Auto est désactivé sur le serveur (RADAR_AUTO_ENABLED) : ${RADAR_AUTO_SHARED_ADDRESS_NOTICE}` };
  if (c.radarAutoOrgIds && c.radarAutoOrgIds.length > 0 && !c.radarAutoOrgIds.includes(orgId)) return { allowed: false, reason: `Organisation hors des comptes de l'équipe autorisés (RADAR_AUTO_ORG_IDS) : ${RADAR_AUTO_SHARED_ADDRESS_NOTICE}` };
  return { allowed: true, reason: null };
}

/** Achat réel (D11) : seulement si Radar Auto ET RADAR_REAL_PURCHASE sont ouverts côté serveur. */
export function realPurchaseEnabled(services: Pick<Services, "config">): boolean {
  return services.config?.radarAutoEnabled === true && services.config?.radarRealPurchase === true;
}

/**
 * Réglage d'exécution passé par le worker et l'API dans `services.config` : CLOUD_3DS_TIMEOUT_MS, la
 * durée pendant laquelle le navigateur d'un achat reste ouvert en attendant la validation 3-D Secure.
 * Le délai enregistré sur la demande d'achat (`awaiting3dsUntil`) est le même : la base et le
 * navigateur expirent ensemble.
 */
export interface RadarRuntimeConfig {
  radar3dsTimeoutMs?: number;
}

/** Attente de la validation 3-D Secure : CLOUD_3DS_TIMEOUT_MS (borné à 1 – 30 min), sinon RADAR_3DS_TIMEOUT_MINUTES (10 min, contrats). */
export function threeDsTimeoutMs(services: Pick<Services, "config">): number {
  const raw = (services.config as (ServicesConfig & RadarRuntimeConfig) | undefined)?.radar3dsTimeoutMs;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return RADAR_3DS_TIMEOUT_MINUTES * 60_000;
  return Math.min(30 * 60_000, Math.max(60_000, Math.round(raw)));
}

function systemContext(services: Services, orgId: string): OrgContext {
  return { services, orgId, userId: "system", role: "owner", isOperator: true, ip: null };
}

const actorOf = (ctx: OrgContext): string | null => (ctx.userId === "system" ? null : ctx.userId);

// ---------------------------------------------------------------- rythme et ralentissement (fonctions pures)

/** Ralentissement d'une organisation (table `radar_org_state`) : facteur fixé au dernier blocage et sa date. */
export interface OrgSlowdown {
  slowdownFactor: number;
  lastBlockAt: string | null;
}

export const NO_SLOWDOWN: OrgSlowdown = { slowdownFactor: 1, lastBlockAt: null };

/**
 * Facteur de ralentissement courant : le facteur fixé au dernier blocage, divisé par deux par tranche de
 * 24 h sans blocage (retour progressif), jamais sous 1.
 */
export function effectiveSlowdownFactor(state: OrgSlowdown, now: Date): number {
  const stored = Math.max(1, Math.min(RADAR_MAX_SLOWDOWN_FACTOR, Math.round(state.slowdownFactor || 1)));
  if (stored === 1 || !state.lastBlockAt) return stored;
  const elapsed = now.getTime() - new Date(state.lastBlockAt).getTime();
  const halvings = Math.max(0, Math.floor(elapsed / (RADAR_SLOWDOWN_RECOVERY_HOURS * 3_600_000)));
  return Math.max(1, Math.floor(stored / 2 ** Math.min(halvings, 16)));
}

/** Blocages pour 1 000 pages (null sans lecture). */
export function blockRatePer1000(reads: number, blocks: number): number | null {
  return reads > 0 ? (blocks * 1000) / reads : null;
}

/**
 * Facteur après une lecture : inchangé sans blocage ; après un blocage, doublé si la fenêtre glissante
 * (lecture comprise) dépasse 1 blocage pour 1 000 pages, plafonné à 64.
 */
export function slowdownAfterRead(current: number, blocked: boolean, window: { reads: number; blocks: number }): number {
  const f = Math.max(1, Math.min(RADAR_MAX_SLOWDOWN_FACTOR, Math.round(current)));
  if (!blocked) return f;
  const rate = blockRatePer1000(window.reads, window.blocks) ?? Number.POSITIVE_INFINITY;
  return rate > RADAR_BLOCKS_PER_1000_THRESHOLD ? Math.min(RADAR_MAX_SLOWDOWN_FACTOR, f * 2) : f;
}

/** Intervalle de base d'une recherche : 60 s en direct, 30 s si prioritaire avec Radar Auto actif, 1 h pour le simulateur. */
export function baseIntervalSeconds(search: Pick<RadarSearch, "source" | "priority">, priorityActive: boolean): number {
  if (search.source !== "cloud") return RADAR_DEMO_INTERVAL_SECONDS;
  return search.priority && priorityActive ? RADAR_PRIORITY_INTERVAL_SECONDS : RADAR_READ_INTERVAL_SECONDS;
}

export interface PlannedRead {
  searchId: string;
  source: RadarSourceKind;
  due: boolean;
  /** `disabled` : recherche désactivée ; `waiting` : pas encore l'heure. */
  reason: "due" | "disabled" | "waiting";
  priority: boolean;
  factor: number;
  intervalSeconds: number;
  nextReadAt: string;
}

type PlanSearch = Pick<RadarSearch, "id" | "enabled" | "source" | "priority" | "lastReadAt" | "lastRunAt" | "createdAt">;

export interface PlanOptions {
  radarAutoActive?: boolean;
  /** Ralentissement de l'organisation (appliqué à toutes ses recherches en direct). */
  slowdown?: OrgSlowdown | null;
  /** Tolérance d'horloge des passages (RADAR_DUE_TOLERANCE_SECONDS par défaut). */
  toleranceSeconds?: number;
}

/**
 * Recherches à relire maintenant (fonction pure, horloge injectée). Intervalle : 60 s en direct, 30 s
 * pour les 3 premières recherches prioritaires quand Radar Auto est actif, 1 h pour le simulateur ;
 * multiplié par le facteur de ralentissement courant DE L'ORGANISATION. Une recherche est due quand sa
 * prochaine lecture tombe au plus 5 s après `now` (horloge des passages : la dernière lecture est datée
 * de l'heure prévue du passage, voir `anchorReadAt`). Les heures calmes ne concernent que les alertes :
 * la lecture continue. Ordre : dues d'abord, prioritaires, puis la plus anciennement lue.
 */
export function planReads(searches: readonly PlanSearch[], now: Date, opts: PlanOptions = {}): PlannedRead[] {
  const toleranceMs = Math.max(0, opts.toleranceSeconds ?? RADAR_DUE_TOLERANCE_SECONDS) * 1000;
  const priorityIds = new Set(
    searches
      .filter((s) => s.enabled && s.source === "cloud" && s.priority)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .slice(0, RADAR_MAX_PRIORITY_SEARCHES)
      .map((s) => s.id),
  );
  const out = searches.map((s) => {
    const priority = priorityIds.has(s.id);
    const factor = s.source === "cloud" ? effectiveSlowdownFactor(opts.slowdown ?? NO_SLOWDOWN, now) : 1;
    const intervalSeconds = baseIntervalSeconds({ source: s.source, priority }, opts.radarAutoActive === true) * factor;
    const last = s.lastReadAt ?? s.lastRunAt;
    const nextAt = last ? new Date(new Date(last).getTime() + intervalSeconds * 1000) : now;
    const due = s.enabled && nextAt.getTime() <= now.getTime() + toleranceMs;
    return { searchId: s.id, source: s.source, due, reason: !s.enabled ? "disabled" : due ? "due" : "waiting", priority, factor, intervalSeconds, nextReadAt: nextAt.toISOString(), last: last ?? "" } as PlannedRead & { last: string };
  });
  return out
    .sort((a, b) => Number(b.due) - Number(a.due) || Number(b.priority) - Number(a.priority) || a.last.localeCompare(b.last) || a.searchId.localeCompare(b.searchId))
    .map(({ last: _last, ...p }) => p);
}

/**
 * Date enregistrée comme « dernière lecture » : l'heure prévue du passage (`slotAt`) quand la lecture a
 * lieu pendant ce passage, sinon l'heure réelle. Les lectures d'une organisation se font l'une après
 * l'autre : sans ce calage, la k-ième recherche serait datée de la fin des lectures précédentes et ne
 * serait plus due au passage suivant (60 s → 90 s, 30 s → 60 s).
 */
export function anchorReadAt(now: Date, slotAt?: Date | null): Date {
  if (!slotAt) return now;
  const lag = now.getTime() - slotAt.getTime();
  return lag >= 0 && lag <= RADAR_TICK_SECONDS * 1000 ? slotAt : now;
}

/** Radar Auto réellement actif pour l'organisation (verrou serveur et réglage) : rythme prioritaire de 30 s. */
export function radarAutoActive(services: Pick<Services, "config">, org: Pick<Organization, "id" | "settings">): boolean {
  return radarAutoServerGate(services, org.id).allowed && org.settings.autoBuy.enabled;
}

/**
 * Plan des lectures d'une organisation (recherches, ralentissement de l'organisation, Radar Auto) : base
 * des passages du worker et de `runDueReads`.
 */
export async function planOrgReads(services: Services, orgId: string, now: Date): Promise<PlannedRead[]> {
  return services.db.withOrg(orgId, async (tx) => {
    const org = await repos.orgs.byId(tx, orgId);
    return planReads(await repos.searches.list(tx), now, { radarAutoActive: radarAutoActive(services, org), slowdown: await repos.radarOrgState.get(tx) });
  });
}

// ---------------------------------------------------------------- recherches

async function validateSearchTx(tx: Tx, input: { source: RadarSourceKind; priority: boolean; connectionId: string | null }, id: string | null): Promise<void> {
  if (input.priority && (await repos.searches.countPriority(tx, id)) >= RADAR_MAX_PRIORITY_SEARCHES) {
    throw new AppError("validation", `${RADAR_MAX_PRIORITY_SEARCHES} recherches prioritaires au plus par organisation (Radar Auto).`, 400);
  }
  if (input.connectionId) {
    const c = await repos.connections.byId(tx, input.connectionId).catch(() => null);
    if (!c || c.usage !== "purchase" || !isActiveAccount(c)) throw new AppError("validation", "Le compte lu par Radar doit être un compte Vinted « Achat » actif (jamais un compte Perso ni un compte de vente).", 400);
  }
}

/** Vue d'une recherche : intervalle effectif et facteur courant (celui de l'organisation) calculés par le serveur. */
function searchView(s: RadarSearch, plan: PlannedRead | undefined, slowdown: OrgSlowdown, now: Date): RadarSearch {
  const factor = s.source === "cloud" ? effectiveSlowdownFactor(slowdown, now) : 1;
  return { ...s, slowdownFactor: factor, intervalSeconds: plan?.intervalSeconds ?? baseIntervalSeconds(s, false) * factor };
}

export function listSearches(ctx: OrgContext): Promise<RadarSearch[]> {
  return withOrg(ctx, async (tx) => {
    const now = ctx.services.now();
    const org = await repos.orgs.byId(tx, ctx.orgId);
    const list = await repos.searches.list(tx);
    const slowdown = await repos.radarOrgState.get(tx);
    const plan = new Map(planReads(list, now, { radarAutoActive: radarAutoActive(ctx.services, org), slowdown }).map((p) => [p.searchId, p]));
    return list.map((s) => searchView(s, plan.get(s.id), slowdown, now));
  });
}

export function createSearch(ctx: OrgContext, raw: unknown): Promise<RadarSearch> {
  requireAction(ctx, "radar.write");
  const parsed = radarSearchCreate.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", "Recherche invalide", 400, parsed.error.flatten());
  return withOrg(ctx, async (tx) => {
    await validateSearchTx(tx, parsed.data, null);
    const s = await repos.searches.create(tx, { ...parsed.data, provider: parsed.data.source === "cloud" ? "vinted" : "demo" });
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "radar.search_created", targetType: "radar_search", targetId: s.id, meta: { source: s.source, priority: s.priority }, ip: ctx.ip });
    return s;
  });
}

export function updateSearch(ctx: OrgContext, id: string, raw: Record<string, unknown>): Promise<RadarSearch> {
  requireAction(ctx, "radar.write");
  return withOrg(ctx, async (tx) => {
    const s = await repos.searches.byId(tx, id);
    const merged = radarSearchCreate.safeParse({ ...s, ...raw, criteria: { ...s.criteria, ...((raw.criteria as object) ?? {}) } });
    if (!merged.success) throw new AppError("validation", "Recherche invalide", 400, merged.error.flatten());
    await validateSearchTx(tx, merged.data, id);
    // Réactivée par le client après un arrêt décidé par Selio (pages non reconnues) : compteur remis à zéro.
    const resumed = merged.data.enabled && !s.enabled && s.suspendedReason ? { suspendedReason: null, consecutiveFailures: 0 } : {};
    const saved = await repos.searches.update(tx, id, { ...merged.data, ...resumed, provider: merged.data.source === "cloud" ? "vinted" : "demo" });
    if ("suspendedReason" in resumed) await repos.audit.add(tx, { actorUserId: ctx.userId, action: "radar.search_resumed", targetType: "radar_search", targetId: id, ip: ctx.ip });
    return saved;
  });
}

export function deleteSearch(ctx: OrgContext, id: string): Promise<void> {
  requireAction(ctx, "radar.write");
  return withOrg(ctx, async (tx) => {
    await repos.searches.delete(tx, id);
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "radar.search_deleted", targetType: "radar_search", targetId: id, ip: ctx.ip });
  });
}

// ---------------------------------------------------------------- estimation de revente

type EmbeddingKind = Parameters<typeof repos.embeddingsCache.get>[1];

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 32);

/** Ventes de l'organisation vectorisées au plus par lecture (les plus récentes d'abord ; le cache fait le reste). */
const EMBED_POOL_CAP_PER_READ = 200;

function embedModelName(services: Services): string {
  const p = services.ai.provider as { embedModel?: string | null; model: string };
  return (typeof p.embedModel === "string" && p.embedModel) || p.model;
}

/** Vecteurs des textes, depuis le cache `embeddings_cache` (même empreinte de texte), sinon calculés puis gardés. */
async function vectorsFor(ctx: OrgContext, kind: EmbeddingKind, entries: readonly { ref: string; text: string }[], cap: number): Promise<Map<string, number[]>> {
  const model = embedModelName(ctx.services);
  const out = new Map<string, number[]>();
  if (entries.length === 0) return out;
  const cached = await withOrg(ctx, (tx) => repos.embeddingsCache.get(tx, kind, entries.map((e) => e.ref), model));
  const missing: { ref: string; text: string }[] = [];
  for (const e of entries) {
    const c = cached.get(e.ref);
    if (c && c.textHash === sha(e.text)) out.set(e.ref, c.vector);
    else missing.push(e);
  }
  const todo = missing.slice(0, Math.max(0, cap));
  if (todo.length > 0) {
    const res = await ctx.services.ai.embed(ctx.orgId, todo.map((e) => e.text));
    if (res.embeddings.length !== todo.length) throw new Error("embeddings incomplets");
    const rows = todo.map((e, i) => ({ kind, ref: e.ref, model, textHash: sha(e.text), vector: res.embeddings[i]! }));
    await withOrg(ctx, (tx) => repos.embeddingsCache.put(tx, rows));
    for (const r of rows) out.set(r.ref, r.vector);
  }
  return out;
}

/** Estimation par marque et catégorie (méthode d'avant), étiquetée « brand_category ». */
function brandCategoryEstimate(item: Pick<RadarCatalogItem, "priceCents" | "brand" | "category" | "condition">, comps: Comparable[]): Estimate {
  return { ...estimateResale({ priceCents: item.priceCents, brand: item.brand, category: item.category, condition: item.condition }, comps), method: "brand_category" };
}

/**
 * Revente estimée pour chaque annonce : par similarité d'embeddings (modèle 2) quand l'IA sait vectoriser
 * — titre de l'annonce contre les titres des ventes de l'organisation, top 8 au-dessus de 0,6, vecteurs
 * en cache — sinon (ou si moins de 2 ventes proches, ou en cas de panne de l'IA) par marque et catégorie.
 * Les observations de marché « vendues » (Track) rejoindront ce lot quand elles existeront : aujourd'hui,
 * aucune observation vendue n'est relevée en mode connecté.
 */
export async function estimateForItems(ctx: OrgContext, items: readonly RadarCatalogItem[], pools: { comps: Comparable[]; titled: TitledComparable[] }): Promise<Estimate[]> {
  const fallback = items.map((it) => brandCategoryEstimate(it, pools.comps));
  if (items.length === 0 || !ctx.services.ai.canEmbed || pools.titled.length === 0) return fallback;
  try {
    const poolVectors = await vectorsFor(ctx, "sale", pools.titled.map((t) => ({ ref: t.ref, text: t.text })), EMBED_POOL_CAP_PER_READ);
    const pool = pools.titled.filter((t) => poolVectors.has(t.ref)).map((t) => ({ ref: t.ref, vector: poolVectors.get(t.ref)!, comparable: t.comparable }));
    const targets = items.map((it) => {
      const text = comparableText(it.title, it.brand);
      return { ref: sha(text), text };
    });
    const unique = [...new Map(targets.map((t) => [t.ref, t])).values()];
    const targetVectors = await vectorsFor(ctx, "opportunity", unique, unique.length);
    return items.map((it, i) => {
      const v = targetVectors.get(targets[i]!.ref);
      if (!v) return fallback[i]!;
      const near = nearestComparables(v, pool, { k: RADAR_EMBEDDING_TOP_K, minSimilarity: RADAR_EMBEDDING_MIN_SIMILARITY });
      return estimateResaleFromSimilar({ condition: it.condition }, near) ?? fallback[i]!;
    });
  } catch {
    // Panne, disjoncteur ouvert ou quota de l'IA : l'estimation se replie, la lecture continue.
    return fallback;
  }
}

// ---------------------------------------------------------------- lecture d'une recherche

export type RadarSkipReason = "disabled" | "too_soon" | "pages_per_minute" | "global_pause" | "machine_paused" | "not_ready" | "no_reader" | "account_busy" | "unavailable";

export interface RunSearchOptions {
  /** Horloge (tests, worker) ; sinon `services.now()`. */
  now?: Date;
  /**
   * Heure prévue du passage du worker : la dernière lecture est datée de cette heure (voir
   * `anchorReadAt`), pour que le rythme de 60 s (30 s) tienne quand une organisation a plusieurs
   * recherches lues l'une après l'autre.
   */
  slotAt?: Date;
  /** Passage du worker : une recherche en direct non prête est écartée avec sa raison, sans erreur. */
  fromTick?: boolean;
  /** Faux : ni achat automatique ni envoi des alertes après la lecture (le passage du worker les fait une fois). */
  followUp?: boolean;
}

export interface RunSearchResult {
  /** Affaires nouvelles. */
  found: number;
  autoBought: number;
  source: RadarSourceKind;
  /** Résultat de la lecture (null : aucune page lue). */
  outcome: RadarReadOutcome | null;
  skipped: RadarSkipReason | null;
  message?: string;
  itemsSeen: number;
  duplicates: number;
  alertsQueued: number;
  /** Affaires du stock initial (première lecture, annonces antérieures à la lecture précédente) : ni alerte ni Radar Auto. */
  initialStock: number;
  /** Facteur de ralentissement et intervalle effectifs après la lecture. */
  factor: number;
  intervalSeconds: number;
  nextReadAt: string | null;
  /** Vinted a arrêté la lecture : compte Cloud en pause. */
  paused: boolean;
  circuitUntil: string | null;
  /** Lecture de la recherche arrêtée par Selio (pages non reconnues de suite) : raison, sinon null. */
  suspended: string | null;
  /** Vrai : un navigateur a été lancé (la page compte dans les plafonds, même si la suite échoue). */
  launched: boolean;
}

type Prepared =
  | { kind: "skip"; source: RadarSourceKind; skipped: RadarSkipReason; message?: string; factor: number; intervalSeconds: number; nextReadAt: string | null }
  | { kind: "demo"; search: RadarSearch; org: Organization }
  | { kind: "live"; search: RadarSearch; org: Organization; account: LiveAccount; session: CloudStorageState; sessionSavedAt: string | null; factor: number; intervalSeconds: number };

async function prepareReadTx(tx: Tx, ctx: OrgContext, id: string, now: Date, fromTick: boolean): Promise<Prepared> {
  const search = await repos.searches.byId(tx, id);
  const org = await repos.orgs.byId(tx, ctx.orgId);
  const plan = planReads([search], now, { radarAutoActive: radarAutoActive(ctx.services, org), slowdown: await repos.radarOrgState.get(tx) })[0]!;
  const skip = (skipped: RadarSkipReason, message?: string): Prepared => ({ kind: "skip", source: search.source, skipped, message, factor: plan.factor, intervalSeconds: plan.intervalSeconds, nextReadAt: plan.nextReadAt });
  if (fromTick && !search.enabled) return skip("disabled");
  if (search.source !== "cloud") return { kind: "demo", search, org };
  // Lecture en direct : arrêt global, coupe-circuit, rythme (× facteur), plafond de pages par minute.
  if ((await repos.automationState.get(tx)).globalPaused) return skip("global_pause", "Arrêt global des automatisations : aucune lecture en direct.");
  const circuit = await repos.cloudRuntime.get(tx);
  if (circuit.suspendedUntil && new Date(circuit.suspendedUntil).getTime() > now.getTime()) return skip("machine_paused", "Selio Cloud est suspendu sur la machine après un signal de Vinted.");
  if (new Date(plan.nextReadAt).getTime() > now.getTime() + RADAR_DUE_TOLERANCE_SECONDS * 1000) return skip("too_soon", `Prochaine lecture possible à ${plan.nextReadAt} (rythme de ${plan.intervalSeconds} s).`);
  const perMinute = await repos.radarReads.countLiveSince(tx, new Date(now.getTime() - 60_000).toISOString());
  if (perMinute >= org.settings.radar.maxPagesPerMinute) return skip("pages_per_minute", `Plafond de ${org.settings.radar.maxPagesPerMinute} pages par minute atteint pour l'organisation.`);
  const check = await checkLiveAccountTx(tx, org, search.connectionId, { strict: search.connectionId !== null });
  if (!check.ok) return skip("not_ready", check.message);
  if (!ctx.services.radar?.reader) return skip("no_reader", "La lecture en direct s'exécute dans le worker (navigateur de Selio Cloud).");
  // Verrou du compte : refusé aussi pendant qu'un achat attend la validation 3-D Secure (compte tenu).
  const locked = await repos.cloudAccounts.lock(tx, check.cloudAccount.id, now.toISOString(), new Date(now.getTime() - 15 * 60_000).toISOString());
  if (!locked) return skip("account_busy", "Le compte Achat est déjà utilisé par Selio Cloud (ou un achat attend la validation bancaire) : lecture au prochain passage.");
  const session = await readLiveSessionTx(tx, ctx.services, locked);
  if (!session) {
    await repos.cloudAccounts.unlock(tx, locked.id);
    return skip("not_ready", `${RADAR_LIVE_REQUIRES_CLOUD} : la session du compte Achat est illisible, connexion à refaire.`);
  }
  return { kind: "live", search, org, account: { connection: check.connection, cloudAccount: locked, vintedHost: check.vintedHost }, session, sessionSavedAt: locked.sessionSavedAt, factor: plan.factor, intervalSeconds: plan.intervalSeconds };
}

/** Raison d'un arrêt de la lecture décidé par Selio (pages non reconnues, erreurs ou délais de suite). */
function suspensionReason(failures: number, outcome: RadarReadOutcome): string {
  const what = outcome === "page_changed" ? "page de recherche non reconnue" : outcome === "timeout" ? "délai dépassé" : "erreur de lecture";
  return `Lecture en direct arrêtée par Selio après ${failures} lectures anormales de suite (dernière : ${what}). La page de Vinted a peut-être changé ou affiche une vérification inconnue : vérifiez la recherche sur Vinted, puis réactivez-la.`;
}

/**
 * Stock initial (pas d'alerte, pas de Radar Auto, hors de la mesure du délai) : toute la première lecture
 * en direct d'une recherche ; ensuite, les annonces publiées avant la lecture précédente (marge de
 * 2 min), ou sans date de publication quand la lecture précédente date de plus de 30 min (reprise après
 * une pause ou un coupe-circuit).
 */
export function isInitialStock(item: Pick<RadarCatalogItem, "publishedAt">, search: Pick<RadarSearch, "pagesRead" | "lastReadAt">, now: Date): boolean {
  if (search.pagesRead === 0 || !search.lastReadAt) return true;
  const prev = new Date(search.lastReadAt).getTime();
  if (item.publishedAt) return new Date(item.publishedAt).getTime() < prev - RADAR_INITIAL_STOCK_GRACE_MINUTES * 60_000;
  return now.getTime() - prev > RADAR_CATCHUP_GAP_MINUTES * 60_000;
}

/** Résultat d'un signal de Vinted dans la mesure (`radar_reads.outcome`). */
const SIGNAL_OUTCOME: Record<RadarSignal, RadarReadOutcome> = { captcha: "captcha", rate_limited: "rate_limited", blocked: "blocked", warning: "blocked" };

/**
 * Ralentissement après un blocage (lecture ou achat) : fenêtre glissante des 1 000 dernières mesures en
 * direct de l'organisation (mesure comprise), facteur doublé au-delà de 1 pour 1 000, date du blocage
 * gardée (retour progressif). Rend le facteur fixé.
 */
async function slowDownAfterBlockTx(tx: Tx, now: Date, at: string): Promise<number> {
  const state = await repos.radarOrgState.get(tx);
  const next = slowdownAfterRead(effectiveSlowdownFactor(state, now), true, await repos.radarReads.liveWindow(tx, RADAR_SLOWDOWN_WINDOW_READS));
  await repos.radarOrgState.set(tx, { slowdownFactor: next, blockAt: at });
  return next;
}

/**
 * Lit une recherche (simulateur ou en direct), convertit les annonces en affaires (dédoublonnage par
 * référence Vinted puis par titre et prix), estime la revente, note, met les alertes en file, enregistre
 * la mesure (`radar_reads`) et applique le ralentissement. Signal de Vinted : pause du compte Cloud
 * écrite d'abord, alerte au client, coupe-circuit, aucune relecture avant le cycle × facteur.
 *
 * Dès que la page a été chargée, la mesure, la date de lecture et le compteur de pages sont écrits dans
 * une transaction à part, AVANT le traitement des annonces : une erreur ensuite ne fait jamais relire la
 * page au passage suivant ni ne la sort des plafonds.
 */
export async function runSearch(ctx: OrgContext, id: string, opts: RunSearchOptions = {}): Promise<RunSearchResult> {
  requireAction(ctx, "radar.write");
  const now = opts.now ?? ctx.services.now();
  const iso = now.toISOString();
  const anchorIso = anchorReadAt(now, opts.slotAt).toISOString();
  const prepared = await withOrg(ctx, (tx) => prepareReadTx(tx, ctx, id, now, opts.fromTick === true));
  if (prepared.kind === "skip") {
    const result: RunSearchResult = { found: 0, autoBought: 0, source: prepared.source, outcome: null, skipped: prepared.skipped, message: prepared.message, itemsSeen: 0, duplicates: 0, alertsQueued: 0, initialStock: 0, factor: prepared.factor, intervalSeconds: prepared.intervalSeconds, nextReadAt: prepared.nextReadAt, paused: false, circuitUntil: null, suspended: null, launched: false };
    if (!opts.fromTick && (prepared.skipped === "not_ready" || prepared.skipped === "no_reader")) {
      throw new AppError(prepared.skipped === "no_reader" ? "radar_reader_unavailable" : "radar_live_requires_cloud", prepared.message ?? RADAR_LIVE_REQUIRES_CLOUD, prepared.skipped === "no_reader" ? 503 : 409, { reason: prepared.skipped });
    }
    return result;
  }
  const live = prepared.kind === "live" ? prepared : null;
  const search = prepared.search;
  const org = prepared.org;
  let unlocked = live === null;
  try {
    const read: RadarSourceResult = await sourceFor(search).read(ctx, search, { now, live: live ? { account: live.account, session: live.session } : null });
    if (live && !read.launched) {
      // Aucun navigateur lancé (aucun créneau libre, refus avant lancement) : rien n'est lu ni compté.
      await withOrg(ctx, (tx) => repos.cloudAccounts.unlock(tx, live.account.cloudAccount.id));
      unlocked = true;
      return { found: 0, autoBought: 0, source: "cloud", outcome: null, skipped: "unavailable", message: "Aucun navigateur libre : lecture au prochain passage.", itemsSeen: 0, duplicates: 0, alertsQueued: 0, initialStock: 0, factor: live.factor, intervalSeconds: live.intervalSeconds, nextReadAt: iso, paused: false, circuitUntil: null, suspended: null, launched: false };
    }

    // Signal de Vinted : la pause du compte est écrite SEULE et D'ABORD, puis coupe-circuit et email.
    let circuitUntil: string | null = null;
    let pausedLabel: string | null = null;
    if (live && read.signal) {
      const paused = await cloud.pauseFromSystem(ctx.services, { orgId: ctx.orgId, accountId: live.account.cloudAccount.id, code: read.signal, origin: "radar_read", now, meta: { searchId: search.id } });
      circuitUntil = paused.circuitUntil;
      pausedLabel = paused.label;
    }

    // 1. Mesure de la lecture, à part : compte libéré, session, date de lecture, ralentissement, arrêt.
    const measured = await withOrg(ctx, async (tx) => {
      if (live) {
        const accountId = live.account.cloudAccount.id;
        await repos.cloudAccounts.unlock(tx, accountId);
        if (read.notLoggedIn) {
          // Vinted a refusé la session : effacée (si c'est encore celle de la lecture), connexion à refaire.
          await repos.cloudAccounts.clearSessionIf(tx, accountId, live.sessionSavedAt);
          const acc = await repos.cloudAccounts.byId(tx, accountId);
          if (acc.status === "active") await repos.cloudAccounts.update(tx, accountId, { status: "needs_login" });
          await repos.audit.add(tx, { actorUserId: null, action: "cloud.account.needs_login", targetType: "cloud_account", targetId: accountId, meta: { reason: "session_refused", origin: "radar_read" } });
        } else if (!read.signal && read.session !== undefined) {
          const filtered = filterVintedStorageState(read.session);
          if (!isStorageStateEmpty(filtered)) await repos.cloudAccounts.replaceSessionIf(tx, accountId, ctx.services.secrets.encrypt(JSON.stringify(filtered), accountId), iso, live.sessionSavedAt);
        }
        if (read.signal && pausedLabel !== null) await enqueueBlockedAlert(tx, { accountId, code: read.signal, label: pausedLabel, now });
      }
      const state = live ? await repos.radarOrgState.get(tx) : NO_SLOWDOWN;
      const factorBefore = live ? effectiveSlowdownFactor(state, now) : 1;
      const row = await repos.radarReads.add(tx, { searchId: search.id, connectionId: live?.account.connection.id ?? null, source: live ? "cloud" : "demo", readAt: iso, durationMs: read.durationMs, outcome: read.outcome, itemsSeen: read.items.length, itemsNew: 0, factor: factorBefore, kind: "search", pages: 1 });
      let factorAfter = factorBefore;
      if (live && read.blocked) factorAfter = await slowDownAfterBlockTx(tx, now, iso);
      const anomaly = live ? (read.anomaly ? true : read.outcome === "ok" ? false : null) : null;
      let saved = await repos.searches.recordRead(tx, search.id, { readAt: anchorIso, livePages: live ? 1 : 0, blocked: live !== null && read.blocked, slowdownFactor: factorAfter, anomaly });
      let suspended: string | null = null;
      if (live && anomaly && saved.consecutiveFailures >= RADAR_MAX_CONSECUTIVE_ANOMALIES && saved.enabled) {
        // Page non reconnue (ou erreurs) plusieurs fois de suite : arrêt de la lecture, ralentissement,
        // alerte au client, trace pour l'opérateur. Rien n'est relu tant que le client n'a pas réactivé.
        suspended = suspensionReason(saved.consecutiveFailures, read.outcome);
        saved = await repos.searches.suspend(tx, search.id, suspended);
        factorAfter = Math.min(RADAR_MAX_SLOWDOWN_FACTOR, Math.max(1, effectiveSlowdownFactor(await repos.radarOrgState.get(tx), now)) * 2);
        await repos.radarOrgState.set(tx, { slowdownFactor: factorAfter, blockAt: iso });
        await enqueueSearchSuspendedAlert(tx, { searchId: search.id, name: search.name, now });
        await repos.audit.add(tx, { actorUserId: null, action: "radar.search_suspended", targetType: "radar_search", targetId: search.id, meta: { failures: saved.consecutiveFailures, outcome: read.outcome, factor: factorAfter } });
      }
      if (!live) await repos.usage.record(tx, "connector.sync", { kind: "radar", searchId: search.id });
      return { readId: row.id, saved, suspended, slowdown: live ? await repos.radarOrgState.get(tx) : NO_SLOWDOWN };
    });
    unlocked = true;

    // 2. Annonces nouvelles (avant estimation : l'IA n'est jamais appelée dans une transaction).
    const pre = read.items.length === 0 ? null : await withOrg(ctx, async (tx) => {
      const fresh: RadarCatalogItem[] = [];
      let dup = 0;
      const seen = new Set<string>();
      for (const item of read.items) {
        const key = item.externalRef ? `ref:${item.externalRef}` : `tp:${item.title}\u0000${item.priceCents}`;
        if (seen.has(key)) { dup++; continue; }
        seen.add(key);
        if (item.externalRef ? await repos.opportunities.byExternalRef(tx, item.externalRef) : await repos.opportunities.exists(tx, search.id, item.title, item.priceCents)) { dup++; continue; }
        fresh.push(item);
      }
      if (fresh.length === 0) return { fresh, dup, comps: [] as Comparable[], titled: [] as TitledComparable[] };
      const orders = await repos.orders.all(tx);
      const items = new Map((await repos.items.all(tx)).map((i) => [i.id, i]));
      return { fresh, dup, comps: comparablesFromSales(orders, items), titled: titledComparablesFromSales(orders, items) };
    });
    const estimates = pre && pre.fresh.length ? await estimateForItems(ctx, pre.fresh, { comps: pre.comps, titled: pre.titled }) : [];

    // 3. Affaires et alertes.
    const recorded = !pre || pre.fresh.length === 0 ? { found: 0, duplicates: pre?.dup ?? 0, alertsQueued: 0, initialStock: 0 } : await withOrg(ctx, async (tx) => {
      let found = 0;
      let duplicates = pre.dup;
      let alertsQueued = 0;
      let initialStock = 0;
      for (const [i, item] of pre.fresh.entries()) {
        const est = estimates[i]!;
        const seenAt = item.publishedAt ?? iso;
        const shippingCents = item.shippingCents ?? 0;
        const category = item.category ?? (search.criteria.categories.length === 1 ? search.criteria.categories[0]! : null);
        const scored = scoreOpportunity({ priceCents: item.priceCents, shippingCents, seenAt }, est, search, 0, now, { condition: item.condition, photoCount: item.photoCount, sellerRating: item.sellerRating, sellerReviews: item.sellerReviews, fees: org.settings.buyerFees });
        const reasons = item.shippingCents === null ? [...scored.reasons, "Port non affiché sur la page de recherche : non compté dans le coût (vérifié au paiement)."] : scored.reasons;
        const stock = live ? isInitialStock(item, search, now) : false;
        if (!item.externalRef && (await repos.opportunities.exists(tx, search.id, item.title, item.priceCents))) { duplicates++; continue; }
        const opp = await repos.opportunities.createIfAbsent(tx, {
          searchId: search.id,
          title: item.title,
          observed: {
            priceCents: item.priceCents, shippingCents, brand: item.brand, size: item.size, condition: item.condition, category,
            sellerHandle: item.sellerHandle, sellerRating: item.sellerRating, sellerReviews: item.sellerReviews, photoUrl: item.photoUrl, photoCount: item.photoCount, url: item.url,
            seenAt, source: live ? "connector" : "demo_simulator", externalRef: item.externalRef, publishedAt: item.publishedAt, detectedAt: iso,
            ...(live ? { publishedAtSource: item.publishedAtSource, shippingShown: item.shippingCents !== null, initialStock: stock } : {}),
          },
          estimate: { resalePriceCents: est.resalePriceCents, expectedFeesCents: 0, marginCents: scored.marginCents, marginRate: scored.marginRate, confidence: est.confidence, method: est.method, comparableCount: est.comparableCount },
          score: scored.score,
          reasons: stock ? [...reasons, "Stock déjà en ligne à la mise en service de la lecture (ou avant la lecture précédente) : ni alerte ni achat automatique."] : reasons,
          breakdown: scored.breakdown,
          status: "new",
          // Le simulateur date ses affaires de leur « publication » simulée, comme avant.
          createdAt: live ? iso : seenAt,
        });
        if (!opp) { duplicates++; continue; }
        found++;
        if (stock) initialStock++;
        // Alertes : affaires lues en direct seulement, hors stock initial (jamais une notification simulée).
        if (live && !stock && (await enqueueOpportunityAlert(tx, opp, { now, settings: org.settings.radar, timezone: org.settings.timezone }))) alertsQueued++;
      }
      await repos.radarReads.setItemsNew(tx, measured.readId, found);
      return { found, duplicates, alertsQueued, initialStock };
    });

    const after = planReads([measured.saved], now, { radarAutoActive: radarAutoActive(ctx.services, org), slowdown: measured.slowdown })[0]!;
    let autoBought = 0;
    if (opts.followUp !== false) {
      if (org.settings.autoBuy.enabled && !read.blocked) autoBought = (await runAutoBuy(ctx, { now })).bought;
      if (ctx.services.push && (recorded.alertsQueued > 0 || read.blocked || measured.suspended)) await sendDueAlerts(ctx.services, ctx.orgId, { now });
    }
    return {
      found: recorded.found, autoBought, source: live ? "cloud" : "demo", outcome: read.outcome, skipped: null, message: read.message, itemsSeen: read.items.length, duplicates: recorded.duplicates, alertsQueued: recorded.alertsQueued, initialStock: recorded.initialStock,
      factor: after.factor, intervalSeconds: after.intervalSeconds, nextReadAt: measured.saved.enabled ? after.nextReadAt : null, paused: live !== null && read.blocked, circuitUntil, suspended: measured.suspended, launched: true,
    };
  } finally {
    if (!unlocked && live) await withOrg(ctx, (tx) => repos.cloudAccounts.unlock(tx, live.account.cloudAccount.id)).catch(() => undefined);
  }
}

export interface RadarTickSummary {
  read: number;
  found: number;
  blocked: number;
  skipped: { reason: string; count: number }[];
  autoBought: number;
  expired3ds: number;
  alerts: SendAlertsSummary;
}

/**
 * Passage pour une organisation (hors worker : tests, outils) : recherches dues selon `planReads`, dans
 * le plafond de pages par minute ; puis un passage de Radar Auto, l'expiration des paiements 3-D Secure
 * non validés et l'envoi des alertes échues.
 */
export async function runDueReads(services: Services, orgId: string, opts: { now?: Date; shouldStop?: () => boolean } = {}): Promise<RadarTickSummary> {
  const clock = () => opts.now ?? services.now();
  const ctx = systemContext(services, orgId);
  const summary: RadarTickSummary = { read: 0, found: 0, blocked: 0, skipped: [], autoBought: 0, expired3ds: 0, alerts: { sent: 0, failed: 0, expired: 0, disabledSubscriptions: 0, pending: 0 } };
  const skipped = new Map<string, number>();
  const skip = (r: string) => skipped.set(r, (skipped.get(r) ?? 0) + 1);
  const slotAt = clock();
  const org = await services.db.withOrg(orgId, (tx) => repos.orgs.byId(tx, orgId));
  for (const p of await planOrgReads(services, orgId, slotAt)) {
    if (!p.due) continue;
    if (opts.shouldStop?.()) { skip("worker_stopping"); continue; }
    try {
      const res = await runSearch(ctx, p.searchId, { now: clock(), slotAt, fromTick: true, followUp: false });
      if (res.skipped) {
        skip(res.skipped);
        if (res.skipped === "pages_per_minute" || res.skipped === "machine_paused" || res.skipped === "global_pause") break;
        continue;
      }
      summary.read++;
      summary.found += res.found;
      if (res.paused) summary.blocked++;
    } catch {
      skip("error");
    }
  }
  if (org.settings.autoBuy.enabled) {
    const auto = await runAutoBuy(ctx, { now: clock() }).catch(() => null);
    summary.autoBought = auto?.bought ?? 0;
  }
  summary.expired3ds = await expireAwaiting3ds(services, orgId, clock());
  summary.alerts = await sendDueAlerts(services, orgId, { now: clock() });
  summary.skipped = [...skipped.entries()].map(([reason, count]) => ({ reason, count }));
  return summary;
}

// ---------------------------------------------------------------- affaires

export function listOpportunities(ctx: OrgContext, q: { searchId?: string; status?: string }): Promise<Opportunity[]> {
  return withOrg(ctx, async (tx) => rankOpportunities(await repos.opportunities.list(tx, q)));
}

/** Détail d'une affaire (page « 1 clic ») : coût total d'achat, recherche d'origine, demande d'achat en cours. */
export interface OpportunityDetail extends Opportunity {
  search: { id: string; name: string; source: RadarSourceKind } | null;
  /** Article + port + protection acheteur (frais de l'organisation). */
  cost: PurchaseCost;
  /** Demande d'achat active (ni annulée ni bloquée), s'il y en a une. */
  purchase: PurchaseRequest | null;
  /** Adresse de l'annonce sur Vinted (https, liste fermée des domaines), ou null. */
  itemUrl: string | null;
}

/**
 * Une affaire de l'organisation, prête pour le « 1 clic » : le client ouvre l'annonce sur Vinted et
 * achète lui-même. Une affaire d'une autre organisation est introuvable (RLS).
 */
export function getOpportunity(ctx: OrgContext, id: string): Promise<OpportunityDetail> {
  requireAction(ctx, "radar.read");
  return withOrg(ctx, async (tx) => {
    const opp = await repos.opportunities.byId(tx, id);
    const org = await repos.orgs.byId(tx, ctx.orgId);
    const search = await repos.searches.byId(tx, opp.searchId).catch(() => null);
    return {
      ...opp,
      search: search ? { id: search.id, name: search.name, source: search.source } : null,
      cost: purchaseCost(opp.observed, org.settings.buyerFees),
      purchase: await repos.purchases.activeForOpportunity(tx, opp.id),
      itemUrl: safeVintedUrl(opp.observed.url),
    };
  });
}

export function setOpportunityStatus(ctx: OrgContext, id: string, status: Opportunity["status"]): Promise<Opportunity> {
  requireAction(ctx, "radar.write");
  if (!["new", "watching", "purchased", "dismissed"].includes(status)) throw new AppError("validation", "Statut inconnu", 400);
  return withOrg(ctx, (tx) => repos.opportunities.update(tx, id, { status }));
}

export const listPurchases = (ctx: OrgContext) => withOrg(ctx, (tx) => repos.purchases.list(tx));

/** Compte « Achat » utilisé : celui choisi dans l'achat auto, sinon le premier compte Achat actif (jamais un compte Perso). */
async function purchaseAccountTx(tx: Tx, org: Organization): Promise<MarketplaceConnection | null> {
  return resolvePurchaseAccount(await repos.connections.list(tx), org.settings.autoBuy.connectionId);
}

/**
 * Prix d'achat reporté dans Manager : un article « en stock » (pas encore en ligne), prix d'achat = total
 * payé, étiquette « radar », événement qui garde le lien vers l'affaire et la demande d'achat. Sert au
 * suivi de la marge de bout en bout (achat Radar → revente).
 */
async function reportToManagerTx(tx: Tx, ctx: OrgContext, purchase: PurchaseRequest, opp: Opportunity, totalCents: number, at: string): Promise<string> {
  const item = await repos.items.create(tx, {
    title: opp.title.slice(0, 200), brand: opp.observed.brand, size: opp.observed.size, category: opp.observed.category ?? "other", condition: opp.observed.condition ?? "good",
    purchasePriceCents: totalCents, status: "in_stock", tags: ["radar"], purchasedAt: at,
  });
  await repos.itemEvents.add(tx, { itemId: item.id, actorUserId: actorOf(ctx), kind: "created", changes: { source: { from: null, to: "radar" }, opportunityId: { from: null, to: opp.id }, purchaseRequestId: { from: null, to: purchase.id } }, note: "Acheté avec Selio Radar : prix d'achat reporté." });
  return item.id;
}

export function createPurchase(ctx: OrgContext, raw: { opportunityId?: string; maxPriceCents?: number; budgetCents?: number }): Promise<PurchaseRequest> {
  requireAction(ctx, "purchase.simulate");
  if (!raw.opportunityId || !Number.isInteger(raw.maxPriceCents) || !Number.isInteger(raw.budgetCents)) throw new AppError("validation", "Demande invalide", 400);
  return withOrg(ctx, async (tx) => {
    const org = await repos.orgs.byId(tx, ctx.orgId);
    const opp = await repos.opportunities.byId(tx, raw.opportunityId!);
    const existing = await repos.purchases.activeForOpportunity(tx, opp.id);
    if (existing) throw new AppError("conflict", "Une demande d'achat existe déjà pour cette opportunité (prévention des doublons).", 409, { existingId: existing.id });
    const account = await purchaseAccountTx(tx, org);
    const p = await repos.purchases.create(tx, { opportunityId: opp.id, dedupeKey: `purchase:${opp.id}`, maxPriceCents: raw.maxPriceCents!, budgetCents: raw.budgetCents!, status: "awaiting_confirmation", mode: "manual", realPurchaseEnabled: false, connectionId: account?.id ?? null });
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "purchase.requested", targetType: "purchase_request", targetId: p.id, ip: ctx.ip });
    return p;
  });
}

/** Prix réellement payé, saisi par le client (port compris), en centimes : entier de 0 à 10 000 €. */
function parsePaidCents(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > 1_000_000) throw new AppError("validation", "Prix payé invalide (centimes, de 0 à 10 000 €).", 400);
  return raw;
}

export async function confirmPurchase(ctx: OrgContext, id: string, opts: { paidCents?: unknown } = {}): Promise<PurchaseRequest> {
  requireAction(ctx, "purchase.simulate");
  const paidCents = parsePaidCents(opts.paidCents);
  return withOrg(ctx, (tx) => confirmPurchaseTx(ctx, tx, id, paidCents));
}

/**
 * Report d'un achat fait À LA MAIN par le client sur Vinted (« 1 clic », « Je l'ai achetée ») : Selio
 * n'achète rien, il enregistre l'achat et reporte le prix dans Manager (article créé) pour suivre la
 * marge. Seul l'anti-doublon bloque : le plafond du jour de Radar Auto, le budget de la recherche et la
 * marge estimée ne sont que des avertissements (le client a déjà payé). Prix reporté : celui que le
 * client saisit (port compris), sinon le coût estimé de l'affaire.
 */
async function confirmPurchaseTx(ctx: OrgContext, tx: Tx, id: string, paidCents: number | null): Promise<PurchaseRequest> {
  const org = await repos.orgs.byId(tx, ctx.orgId);
  const p = await repos.purchases.byId(tx, id);
  if (p.status !== "awaiting_confirmation") throw new AppError("conflict", "Cette demande n'est plus en attente de confirmation.", 409);
  const opp = await repos.opportunities.byId(tx, p.opportunityId);
  const confirmedAt = nowIso(ctx);
  const estimated = purchaseCost(opp.observed, org.settings.buyerFees).totalCents;
  const totalCents = paidCents ?? estimated;
  const checks = runPurchaseChecks({ opportunity: opp, request: { ...p, confirmedAt }, spentTodayCents: 0, dailyBudgetCents: Number.MAX_SAFE_INTEGER, duplicateExists: false, connectorAllowsPurchase: false, fees: org.settings.buyerFees })
    .filter((c) => c.code === "price_within_max" || c.code === "within_request_budget" || c.code === "margin_positive")
    .map(({ code, ok, label }) => ({ code, ok, label }));
  const warnings = checks.filter((c) => !c.ok).map((c) => c.label);
  const shippingNote = paidCents === null && opp.observed.shippingShown === false ? " Port non affiché sur la recherche : corrigez le prix d'achat dans Manager si besoin." : "";
  const reportedItemId = await reportToManagerTx(tx, ctx, p, opp, totalCents, confirmedAt);
  const note = `Acheté par vous sur Vinted : Selio n'a rien payé ni commandé. Prix d'achat ${paidCents === null ? "estimé" : "saisi"} reporté dans Manager (article en stock) pour suivre la marge.${shippingNote}${warnings.length ? ` À vérifier : ${warnings.join(" ; ")}.` : ""}`;
  const saved = await repos.purchases.update(tx, id, {
    confirmedAt, checks, status: "simulated", executedAt: confirmedAt, totalCents, reportedItemId, resultNote: note.slice(0, 500),
  });
  await repos.opportunities.update(tx, opp.id, { status: "purchased" });
  await repos.audit.add(tx, { actorUserId: ctx.userId, action: "purchase.confirmed", targetType: "purchase_request", targetId: id, meta: { outcome: "reported", reportedItemId, paidEntered: paidCents !== null, warnings: warnings.length }, ip: ctx.ip });
  return saved;
}

export function cancelPurchase(ctx: OrgContext, id: string): Promise<PurchaseRequest> {
  requireAction(ctx, "purchase.simulate");
  return withOrg(ctx, async (tx) => {
    const p = await repos.purchases.byId(tx, id);
    if (p.status === "cancelled") return p;
    if (p.status === "simulated" || p.status === "executed") {
      if (p.mode !== "auto") throw new AppError("conflict", "Cet achat a déjà été effectué : il ne peut plus être annulé depuis Selio.", 409);
      if (!canStillCancel(p.cancelableUntil, ctx.services.now())) throw new AppError("conflict", "Le délai d'annulation de cet achat automatique est dépassé.", 409);
      await repos.opportunities.update(tx, p.opportunityId, { status: "dismissed" });
    }
    // Attente 3-D Secure abandonnée par le client : le compte Achat n'est plus tenu (le worker ferme le navigateur).
    if (p.status === "awaiting_3ds" && p.cloudAccountId) await repos.cloudAccounts.release(tx, p.cloudAccountId).catch(() => undefined);
    const note = p.status === "awaiting_3ds"
      ? "Achat abandonné pendant l'attente de la validation bancaire : vérifiez dans Vinted qu'aucune commande n'a été passée."
      : p.mode === "auto" ? "Achat automatique annulé dans le délai prévu (simulation)." : null;
    const saved = await repos.purchases.update(tx, id, { status: "cancelled", ...(note ? { resultNote: note } : {}) });
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "purchase.cancelled", targetType: "purchase_request", targetId: id, meta: { mode: p.mode, from: p.status }, ip: ctx.ip });
    return saved;
  });
}

/**
 * « 1 clic » : le client a acheté lui-même sur Vinted ; un clic crée la demande et la confirme (seul
 * l'anti-doublon bloque), prix d'achat reporté dans Manager (saisi par le client, sinon estimé).
 */
export async function quickBuy(ctx: OrgContext, opportunityId: string, opts: { paidCents?: unknown } = {}): Promise<PurchaseRequest> {
  requireAction(ctx, "purchase.simulate");
  const paidCents = parsePaidCents(opts.paidCents);
  return withOrg(ctx, async (tx) => {
    const org = await repos.orgs.byId(tx, ctx.orgId);
    const opp = await repos.opportunities.byId(tx, opportunityId);
    if (await repos.purchases.activeForOpportunity(tx, opp.id)) throw new AppError("conflict", "Une demande d'achat existe déjà pour cette affaire (prévention des doublons).", 409);
    const total = purchaseCost(opp.observed, org.settings.buyerFees).totalCents;
    const search = await repos.searches.byId(tx, opp.searchId);
    const account = await purchaseAccountTx(tx, org);
    const p = await repos.purchases.create(tx, { opportunityId: opp.id, dedupeKey: `purchase:${opp.id}`, maxPriceCents: Math.max(total, paidCents ?? 0), budgetCents: search.budgetCents, status: "awaiting_confirmation", mode: "manual", realPurchaseEnabled: false, connectionId: account?.id ?? null });
    return confirmPurchaseTx(ctx, tx, p.id, paidCents);
  });
}

// ---------------------------------------------------------------- Radar Auto

export interface AutoBuyRunResult {
  /** Vrai : un verrou est fermé, rien n'a été évalué (`reasons`). */
  disabled: boolean;
  reasons: string[];
  evaluated: number;
  bought: number;
  spentCents: number;
  skipped: { reason: string; count: number }[];
  account: { id: string; label: string } | null;
  /** Achats en attente de la validation 3-D Secure du client. */
  awaiting3ds: number;
  /** Achat réel ouvert ET navigateur disponible ici (sinon : essai à blanc ou simulation, enregistrés « simulé »). */
  realPurchase: boolean;
  notice: string;
}

interface AutoGate {
  reasons: string[];
  connection: MarketplaceConnection | null;
  live: LiveAccount | null;
}

async function autoGateTx(tx: Tx, services: Services, org: Organization): Promise<AutoGate> {
  const reasons: string[] = [];
  const server = radarAutoServerGate(services, org.id);
  if (!server.allowed) reasons.push(server.reason!);
  if (!org.settings.autoBuy.enabled) {
    reasons.push(org.settings.autoBuy.suspendedReason
      ? `Radar Auto a été arrêté par Selio : ${org.settings.autoBuy.suspendedReason}`
      : "Radar Auto n'est pas activé dans les réglages de l'organisation.");
  }
  const check = await checkLiveAccountTx(tx, org, org.settings.autoBuy.connectionId, { strict: false });
  if (!check.ok) reasons.push(check.message);
  if ((await repos.automationState.get(tx)).globalPaused) reasons.push("Arrêt global des automatisations.");
  const circuit = await repos.cloudRuntime.get(tx);
  if (circuit.suspendedUntil && new Date(circuit.suspendedUntil).getTime() > services.now().getTime()) reasons.push("Selio Cloud est suspendu sur la machine après un signal de Vinted.");
  // Un achat attend la banque : le navigateur et la session du compte sont pris, aucun autre achat d'ici là.
  if ((await repos.purchases.awaiting3dsCount(tx)) > 0) reasons.push("Un achat attend la validation bancaire du client : aucun autre achat automatique d'ici là.");
  const connection = check.ok ? check.connection : await purchaseAccountTx(tx, org);
  return { reasons, connection, live: check.ok ? { connection: check.connection, cloudAccount: check.cloudAccount, vintedHost: check.vintedHost } : null };
}

/**
 * Coût total accepté au paiement : coût décidé à la détection + petite marge (arrondis, et port si la
 * page de recherche ne l'affichait pas), jamais au-dessus du prix maximum par article, du reste du
 * plafond du jour, ni du coût qui annulerait la marge estimée. Une hausse de prix au-delà = arrêt avant
 * de payer (`price_changed`).
 */
export function autoMaxTotalCents(input: { decisionTotalCents: number; marginCents: number; shippingShown: boolean | undefined; maxItemCents: number; remainingTodayCents: number }): number {
  const allowance = RADAR_AUTO_PRICE_TOLERANCE_CENTS + (input.shippingShown === false ? RADAR_AUTO_UNSHOWN_SHIPPING_ALLOWANCE_CENTS : 0);
  const breakEven = input.decisionTotalCents + Math.max(0, input.marginCents) - 1;
  return Math.max(0, Math.min(input.decisionTotalCents + allowance, input.maxItemCents, input.remainingTodayCents, breakEven));
}

/**
 * Radar Auto : affaires nouvelles au-dessus du seuil, sous le prix maximum par article et dans le plafond
 * du jour. Exige RADAR_AUTO_ENABLED (serveur), le réglage de l'organisation, le compte Achat relié à un
 * compte Cloud actif et l'accord ; sinon `{ disabled: true, reasons }` sans rien évaluer. Au plus un achat
 * par le navigateur par passage (rythme humain).
 *
 * Par le navigateur (worker) : seules les affaires LUES EN DIRECT, avec une adresse Vinted valide et hors
 * stock initial. Sans navigateur (API) : seules les affaires du simulateur sont « achetées » en
 * simulation ; une affaire lue en direct attend le worker (jamais simulée à sa place).
 */
export async function runAutoBuy(ctx: OrgContext, opts: { now?: Date } = {}): Promise<AutoBuyRunResult> {
  requireAction(ctx, "purchase.simulate");
  const now = opts.now ?? ctx.services.now();
  const purchaser = ctx.services.radar?.purchaser ?? null;
  const realPurchase = realPurchaseEnabled(ctx.services) && purchaser !== null;
  const { gate, org } = await withOrg(ctx, async (tx) => {
    const org = await repos.orgs.byId(tx, ctx.orgId);
    return { gate: await autoGateTx(tx, ctx.services, org), org };
  });
  const account = gate.connection ? { id: gate.connection.id, label: gate.connection.label } : null;
  const base: AutoBuyRunResult = { disabled: false, reasons: [], evaluated: 0, bought: 0, spentCents: 0, skipped: [], account, awaiting3ds: 0, realPurchase, notice: RADAR_AUTO_SHARED_ADDRESS_NOTICE };
  if (gate.reasons.length > 0 || !gate.live) return { ...base, disabled: true, reasons: gate.reasons };
  const live = gate.live;
  const settings = org.settings.autoBuy;
  const skipped = new Map<string, number>();
  const skip = (r: string) => skipped.set(r, (skipped.get(r) ?? 0) + 1);
  let evaluated = 0, bought = 0, spentCents = 0, awaiting3ds = 0;
  const candidates = await withOrg(ctx, async (tx) => rankOpportunities(await repos.opportunities.list(tx, { status: "new" })));
  const dayStart = localDayStart(now, org.settings.timezone).toISOString();
  for (const opp of candidates) {
    if (purchaser) {
      if (opp.observed.source !== "connector") { skip("Affaire du simulateur : jamais achetée par le navigateur"); continue; }
      if (!safeVintedUrl(opp.observed.url)) { skip("Adresse de l'annonce inconnue"); continue; }
      if (opp.observed.initialStock) { skip("Stock initial : pas d'achat automatique"); continue; }
    } else if (opp.observed.source !== "demo_simulator") {
      skip("Affaire lue en direct : achetée seulement par le navigateur du worker");
      continue;
    }
    evaluated++;
    const planned = await withOrg(ctx, async (tx) => {
      const spentToday = await repos.purchases.spentSince(tx, dayStart);
      const decision = autoBuyDecision({ opportunity: opp, settings, fees: org.settings.buyerFees, spentTodayCents: spentToday, alreadyPurchased: Boolean(await repos.purchases.activeForOpportunity(tx, opp.id)) });
      if (!decision.buy) return { kind: "skip" as const, reason: /sous le seuil/.test(decision.reason) ? `Note sous le seuil de ${settings.threshold}` : decision.reason };
      const search = await repos.searches.byId(tx, opp.searchId);
      const confirmedAt = now.toISOString();
      if (purchaser) {
        // Les pages d'un achat comptent dans le plafond de pages par minute de l'organisation.
        const perMinute = await repos.radarReads.countLiveSince(tx, new Date(now.getTime() - 60_000).toISOString());
        if (perMinute >= org.settings.radar.maxPagesPerMinute) return { kind: "skip" as const, reason: "Plafond de pages par minute atteint : achat au prochain passage" };
      }
      const maxTotalCents = purchaser
        ? autoMaxTotalCents({ decisionTotalCents: decision.totalCents, marginCents: opp.estimate.marginCents, shippingShown: opp.observed.shippingShown, maxItemCents: settings.maxItemCents, remainingTodayCents: settings.dailyCapCents - spentToday })
        : decision.totalCents;
      const checks = runPurchaseChecks({ opportunity: opp, request: { maxPriceCents: maxTotalCents, budgetCents: search.budgetCents, realPurchaseEnabled: realPurchase, confirmedAt }, spentTodayCents: spentToday, dailyBudgetCents: settings.dailyCapCents, duplicateExists: false, connectorAllowsPurchase: Boolean(purchaser), fees: org.settings.buyerFees });
      const outcome = purchaseOutcome(checks, realPurchase);
      const common = { opportunityId: opp.id, dedupeKey: `purchase:${opp.id}`, maxPriceCents: maxTotalCents, budgetCents: search.budgetCents, mode: "auto" as const, connectionId: live.connection.id, checks: checks.map(({ code, ok, label }) => ({ code, ok, label })), realPurchaseEnabled: realPurchase, confirmedAt };
      if (outcome === "blocked") {
        const p = await repos.purchases.create(tx, { ...common, status: "blocked", resultNote: "Achat automatique bloqué par les contrôles." });
        await repos.audit.add(tx, { actorUserId: actorOf(ctx), action: "purchase.auto", targetType: "purchase_request", targetId: p.id, meta: { outcome, score: opp.score } });
        return { kind: "blocked" as const };
      }
      if (!purchaser) {
        // Aucun navigateur ici (API) : simulation sans navigateur, pour une affaire du simulateur seulement.
        const p = await repos.purchases.create(tx, { ...common, status: "simulated", totalCents: decision.totalCents, cancelableUntil: cancelableUntil(now, settings), executedAt: confirmedAt, resultNote: `Achat automatique SIMULÉ (affaire du simulateur) : ${decision.reason}. Aucun navigateur ouvert, aucun paiement. Annulable pendant ${settings.cancelWindowMinutes} min.`.slice(0, 500) });
        await repos.opportunities.update(tx, opp.id, { status: "purchased" });
        await repos.audit.add(tx, { actorUserId: actorOf(ctx), action: "purchase.auto", targetType: "purchase_request", targetId: p.id, meta: { outcome: "simulated", score: opp.score, browser: false } });
        return { kind: "simulated" as const, totalCents: decision.totalCents };
      }
      // Réservation (« en cours ») : l'index unique empêche un second passage d'acheter la même affaire.
      const p = await repos.purchases.create(tx, { ...common, status: "draft", cloudAccountId: live.cloudAccount.id, resultNote: "Achat automatique en cours." }).catch(() => null);
      if (!p) return { kind: "skip" as const, reason: "Achat déjà en cours pour cette affaire" };
      return { kind: "browser" as const, purchase: p, maxTotalCents };
    });
    if (planned.kind === "skip") { skip(planned.reason); continue; }
    if (planned.kind === "blocked") { skip("Bloqué par les contrôles"); continue; }
    if (planned.kind === "simulated") { bought++; spentCents += planned.totalCents; continue; }
    const res = await executePurchase(ctx, planned.purchase, opp, live, { maxTotalCents: planned.maxTotalCents, dryRun: !realPurchase });
    if (!res.purchase) skip(res.reason ?? "Aucun navigateur lancé : achat au prochain passage");
    else {
      if (res.purchase.status === "executed" || res.purchase.status === "simulated") { bought++; spentCents += res.purchase.totalCents ?? planned.purchase.maxPriceCents; }
      if (res.purchase.status === "awaiting_3ds") awaiting3ds++;
    }
    // Au plus un achat par le navigateur et par passage (rythme humain), et rien après un signal de
    // Vinted ; un compte occupé ou aucun créneau libre vaut pour toutes les affaires du passage.
    break;
  }
  return { ...base, evaluated, bought, spentCents, awaiting3ds, skipped: [...skipped.entries()].map(([reason, count]) => ({ reason, count })) };
}

export type RadarAutoLockKey = "server" | "shared_address" | "organization" | "cloud" | "consent";

export interface RadarAutoLock {
  key: RadarAutoLockKey;
  label: string;
  /** Vrai : ce verrou est ouvert. */
  ok: boolean;
  /** Pourquoi le verrou est fermé (ou la mention qui s'applique), en français simple. */
  detail: string;
}

export interface RadarAutoStatus {
  /** Vrai seulement si tous les verrous sont ouverts et que rien n'arrête les achats (arrêt global, coupe-circuit). */
  active: boolean;
  locks: RadarAutoLock[];
  /** Raisons qui empêchent Radar Auto d'acheter (mêmes textes que `runAutoBuy`). */
  reasons: string[];
  /** Mention visible : pas activable pour les clients sur l'adresse partagée tant qu'Ibrahim n'a pas tranché. */
  notice: string;
  /** Achat réel ouvert côté serveur (sinon essai à blanc, enregistré « simulé », D11). */
  realPurchase: boolean;
  settings: AutoBuySettings;
  /** Compte Achat utilisé (jamais un compte Perso ni un compte de vente). */
  account: { id: string; label: string } | null;
}

/**
 * État des verrous de Radar Auto pour l'organisation : serveur (RADAR_AUTO_ENABLED), adresse partagée
 * (comptes de l'équipe seulement, RADAR_AUTO_ORG_IDS), réglage de l'organisation, compte Achat relié à
 * un compte Selio Cloud actif avec sa session, accord Cloud. Lecture seule, rien n'est évalué ni acheté.
 */
export async function autoStatus(ctx: OrgContext): Promise<RadarAutoStatus> {
  requireAction(ctx, "radar.read");
  return withOrg(ctx, async (tx) => {
    const org = await repos.orgs.byId(tx, ctx.orgId);
    const gate = await autoGateTx(tx, ctx.services, org);
    const c = ctx.services.config ?? {};
    const serverOn = c.radarAutoEnabled === true;
    const server = radarAutoServerGate(ctx.services, org.id);
    const teamList = c.radarAutoOrgIds ?? [];
    const check = await checkLiveAccountTx(tx, org, org.settings.autoBuy.connectionId, { strict: false });
    const consentOk = await cloud.hasValidConsent(tx);
    const cloudOk = check.ok || check.reason === "no_consent";
    const a = org.settings.autoBuy;
    const locks: RadarAutoLock[] = [
      { key: "server", label: "Verrou du serveur (RADAR_AUTO_ENABLED)", ok: serverOn, detail: serverOn ? "Ouvert sur ce serveur, pour les tests de l'équipe." : "Fermé : Radar Auto est désactivé sur ce serveur." },
      {
        key: "shared_address", label: "Adresse partagée : comptes de l'équipe seulement", ok: server.allowed,
        detail: server.allowed
          ? `${teamList.length > 0 ? "Organisation de l'équipe Selio (RADAR_AUTO_ORG_IDS)." : "Aucune liste d'organisations : toutes sont traitées comme comptes de test (hors production seulement)."} ${RADAR_AUTO_SHARED_ADDRESS_NOTICE}`
          : RADAR_AUTO_SHARED_ADDRESS_NOTICE,
      },
      {
        key: "organization", label: "Réglage de l'organisation", ok: a.enabled,
        detail: a.enabled
          ? `Activé${a.enabledAt ? ` le ${a.enabledAt}` : ""}.`
          : a.suspendedReason ? `Arrêté par Selio${a.suspendedAt ? ` le ${a.suspendedAt}` : ""} : ${a.suspendedReason} Vérifiez dans Vinted, puis réactivez Radar Auto.` : "Désactivé dans les réglages de Radar Auto.",
      },
      { key: "cloud", label: "Compte Achat relié à Selio Cloud", ok: cloudOk, detail: cloudOk ? "Compte Achat actif dans Selio Cloud, session enregistrée." : check.ok ? "" : check.message },
      { key: "consent", label: "Accord Selio Cloud", ok: consentOk, detail: consentOk ? "Accord accepté pour la version courante du texte." : "Accord Selio Cloud à accepter (ou à relire : le texte a changé)." },
    ];
    return {
      active: gate.reasons.length === 0 && gate.live !== null,
      locks,
      reasons: gate.reasons,
      notice: RADAR_AUTO_SHARED_ADDRESS_NOTICE,
      realPurchase: realPurchaseEnabled(ctx.services),
      settings: org.settings.autoBuy,
      account: gate.connection ? { id: gate.connection.id, label: gate.connection.label } : null,
    };
  });
}

const PURCHASE_SIGNAL_TEXT: Record<RadarSignal, string> = {
  captcha: "un CAPTCHA",
  warning: "un avertissement",
  blocked: "un blocage",
  rate_limited: "un message « trop de requêtes »",
};
const UNCERTAIN = "Résultat incertain : vérifiez dans Vinted avant de relancer.";

/** Résultat d'un achat dans la mesure (`radar_reads`, sorte « purchase »). */
function purchaseReadOutcome(outcome: PurchaseRunOutcome, signal: RadarSignal | null): RadarReadOutcome {
  if (signal) return SIGNAL_OUTCOME[signal];
  if (outcome.status !== "failed") return "ok";
  if (outcome.code === "timeout") return "timeout";
  if (outcome.code === "selector_missing") return "page_changed";
  return outcome.code === "price_changed" || outcome.code === "payment_error" || outcome.code === "wallet_unavailable" || outcome.code === "not_logged_in" ? "ok" : "error";
}

/**
 * Arrêt de Radar Auto pour l'organisation après une issue incertaine (« Payer » cliqué sans
 * confirmation reconnue, validation 3-D Secure expirée) : réglage remis à « désactivé » avec la date et
 * la raison, alerte au client. Rien n'est racheté tant qu'un humain n'a pas vérifié dans Vinted et
 * réactivé Radar Auto (acquittement).
 */
async function suspendAutoBuyTx(tx: Tx, orgId: string, input: { reason: string; purchaseId: string; now: Date }): Promise<void> {
  const org = await repos.orgs.byId(tx, orgId);
  const autoBuy: AutoBuySettings = { ...org.settings.autoBuy, enabled: false, suspendedAt: input.now.toISOString(), suspendedReason: input.reason.slice(0, 300) };
  await repos.orgs.update(tx, orgId, { settings: { ...org.settings, autoBuy } });
  await enqueueAutoSuspendedAlert(tx, { purchaseId: input.purchaseId, now: input.now });
  await repos.audit.add(tx, { actorUserId: null, action: "radar.auto.suspended", targetType: "purchase_request", targetId: input.purchaseId, meta: { reason: input.reason.slice(0, 200) } });
}

const AUTO_SUSPENDED_UNCERTAIN = "un paiement a pu partir sans confirmation reconnue (« Payer » cliqué).";
const AUTO_SUSPENDED_3DS = "une validation bancaire 3-D Secure n'a pas été reçue à temps (le paiement a pu partir).";

/** Fin de l'attente 3-D Secure : celle du navigateur (`expiresAt`), bornée à [maintenant, maintenant + délai]. */
function threeDsDeadline(services: Services, finishedAt: Date, expiresAt: string | null | undefined): string {
  const max = finishedAt.getTime() + threeDsTimeoutMs(services);
  const fromRunner = expiresAt ? new Date(expiresAt).getTime() : Number.NaN;
  const at = Number.isFinite(fromRunner) ? Math.min(max, Math.max(finishedAt.getTime(), fromRunner)) : max;
  return new Date(at).toISOString();
}

interface SettleInput {
  purchase: PurchaseRequest;
  opp: Opportunity;
  live: LiveAccount;
  outcome: PurchaseRunOutcome;
  signal: RadarSignal | null;
  pausedLabel: string | null;
  resume: boolean;
  /** Session lue pour l'achat (null pour une reprise : jamais réécrite). */
  sessionSavedAt: string | null;
  startedAt: Date;
  finishedAt: Date;
  dryRun: boolean;
}

/**
 * Enregistre l'issue d'un achat (ou d'une reprise) en une transaction : compte libéré ou tenu pendant
 * l'attente 3-D Secure, session (achat seulement, jamais à la reprise), mesure des pages et
 * ralentissement après un signal, demande d'achat, article Manager, arrêt de Radar Auto après une issue
 * incertaine.
 */
async function settlePurchaseTx(tx: Tx, ctx: OrgContext, s: SettleInput): Promise<PurchaseRequest> {
  const { purchase, opp, live, outcome, signal } = s;
  const accountId = live.cloudAccount.id;
  const iso = s.finishedAt.toISOString();
  if (!s.resume) await repos.cloudAccounts.unlock(tx, accountId);
  if (outcome.status === "failed" && outcome.code === "not_logged_in") {
    // Session effacée si c'est encore celle de l'achat (reprise : celle relue à la vérification du compte).
    await repos.cloudAccounts.clearSessionIf(tx, accountId, s.resume ? live.cloudAccount.sessionSavedAt : s.sessionSavedAt);
    const acc = await repos.cloudAccounts.byId(tx, accountId);
    if (acc.status === "active") await repos.cloudAccounts.update(tx, accountId, { status: "needs_login" });
  } else if (!s.resume && !signal && outcome.session !== undefined) {
    const filtered = filterVintedStorageState(outcome.session);
    if (!isStorageStateEmpty(filtered)) await repos.cloudAccounts.replaceSessionIf(tx, accountId, ctx.services.secrets.encrypt(JSON.stringify(filtered), accountId), iso, s.sessionSavedAt);
  }
  if (signal && s.pausedLabel !== null) await enqueueBlockedAlert(tx, { accountId, code: signal, label: s.pausedLabel, now: s.finishedAt });

  // Mesure : les pages de l'achat comptent dans les plafonds et dans le taux de blocage ; un signal ralentit.
  const state = await repos.radarOrgState.get(tx);
  await repos.radarReads.add(tx, {
    kind: "purchase", searchId: opp.searchId, connectionId: live.connection.id, source: "cloud", readAt: iso,
    durationMs: outcome.durationMs ?? s.finishedAt.getTime() - s.startedAt.getTime(), outcome: purchaseReadOutcome(outcome, signal),
    itemsSeen: 0, itemsNew: 0, factor: effectiveSlowdownFactor(state, s.finishedAt), pages: Math.max(signal ? 1 : 0, outcome.pages ?? 1),
  });
  if (signal) await slowDownAfterBlockTx(tx, s.finishedAt, iso);

  const org = await repos.orgs.byId(tx, ctx.orgId);
  let patch: Partial<PurchaseRequest>;
  let oppStatus: Opportunity["status"] | null = null;
  let suspendReason: string | null = null;
  switch (outcome.status) {
    case "purchased": {
      const reportedItemId = await reportToManagerTx(tx, ctx, purchase, opp, outcome.totalCents, iso);
      patch = { status: "executed", executedAt: iso, totalCents: outcome.totalCents, orderRef: outcome.orderRef ? String(outcome.orderRef).slice(0, 120) : null, reportedItemId, paymentAttempted: true, awaiting3dsUntil: null, cancelableUntil: null, resultNote: `Achat réel effectué avec le porte-monnaie Vinted du compte Achat « ${live.connection.label} ». Prix d'achat reporté dans Manager. Une annulation éventuelle se fait dans Vinted.`.slice(0, 500) };
      oppStatus = "purchased";
      break;
    }
    case "awaiting_3ds": {
      const until = s.resume && purchase.awaiting3dsUntil ? purchase.awaiting3dsUntil : threeDsDeadline(ctx.services, s.finishedAt, outcome.expiresAt);
      patch = { status: "awaiting_3ds", awaiting3dsUntil: until, paymentAttempted: true, cloudAccountId: accountId, totalCents: outcome.totalCents ?? purchase.totalCents ?? null, resultNote: "Votre banque demande une validation 3-D Secure : validez le paiement dans votre application bancaire. Selio attend, sans jamais saisir de code à votre place." };
      break;
    }
    case "dry_run": {
      patch = { status: "simulated", executedAt: iso, totalCents: outcome.totalCents ?? purchase.maxPriceCents, cancelableUntil: cancelableUntil(s.finishedAt, org.settings.autoBuy), resultNote: "Achat SIMULÉ : le parcours s'est arrêté avant le bouton de paiement (essai à blanc). Aucun paiement ni commande réels : l'achat réel est désactivé (D11)." };
      oppStatus = "purchased";
      break;
    }
    case "unavailable": {
      patch = { status: "blocked", resultNote: `Annonce ${outcome.reason === "sold" ? "déjà vendue" : outcome.reason === "reserved" ? "réservée" : "masquée"} : rien n'a été acheté.` };
      oppStatus = "dismissed";
      break;
    }
    default: {
      const code = outcome.code;
      const uncertain = outcome.sideEffects === "unknown" && !s.dryRun;
      if (signal) patch = { status: "blocked", resultNote: `Vinted a affiché ${PURCHASE_SIGNAL_TEXT[signal]} : achat arrêté, compte Achat en pause dans Selio Cloud, rien n'est retenté.${uncertain ? ` ${UNCERTAIN}` : ""}` };
      else if (code === "price_changed") patch = { status: "blocked", resultNote: "Coût total au paiement au-dessus du maximum accepté (prix relevé à la détection + petite marge) : arrêt avant de payer." };
      else if (code === "payment_error") patch = { status: "blocked", resultNote: "Paiement refusé par le porte-monnaie Vinted : rien n'a été acheté." };
      else if (code === "wallet_unavailable") patch = { status: "blocked", resultNote: "Porte-monnaie Vinted non proposé au paiement (solde insuffisant ?) : arrêt avant « Payer », jamais de paiement par carte à votre place." };
      else if (code === "not_logged_in") patch = { status: "blocked", resultNote: "Vinted a refusé la session du compte Achat : connexion à refaire dans Selio Cloud." };
      else patch = { status: "blocked", resultNote: (uncertain ? `Erreur pendant l'achat. ${UNCERTAIN}` : "Erreur pendant l'achat : rien n'a été payé.").slice(0, 500) };
      if (uncertain) {
        patch = { ...patch, paymentAttempted: true, resultNote: `${patch.resultNote ?? ""} Radar Auto est arrêté jusqu'à votre vérification.`.slice(0, 500) };
        suspendReason = s.resume && code === "timeout" ? AUTO_SUSPENDED_3DS : AUTO_SUSPENDED_UNCERTAIN;
      }
      // Résultat incertain ou arrêt : l'affaire n'est plus proposée à l'achat automatique.
      oppStatus = "watching";
    }
  }
  // Reprise terminée (ou achat fini) : le compte n'est plus tenu ; attente 3-D Secure : il l'est jusqu'à l'échéance.
  if (patch.status === "awaiting_3ds") {
    if (!s.resume) await repos.cloudAccounts.hold(tx, accountId, patch.awaiting3dsUntil!);
  } else if (s.resume) {
    await repos.cloudAccounts.release(tx, accountId);
  }
  const saved = await repos.purchases.update(tx, purchase.id, patch);
  if (oppStatus) await repos.opportunities.update(tx, opp.id, { status: oppStatus });
  if (saved.status === "awaiting_3ds" && !s.resume) await enqueuePaymentAlert(tx, saved, opp.title, s.finishedAt);
  if (suspendReason && org.settings.autoBuy.enabled) await suspendAutoBuyTx(tx, ctx.orgId, { reason: suspendReason, purchaseId: purchase.id, now: s.finishedAt });
  await repos.audit.add(tx, { actorUserId: actorOf(ctx), action: s.resume ? "purchase.resumed" : "purchase.auto", targetType: "purchase_request", targetId: purchase.id, meta: { outcome: outcome.status, status: saved.status, score: opp.score, dryRun: s.dryRun, ...(signal ? { signal } : {}), ...(suspendReason ? { autoSuspended: true } : {}) } });
  return saved;
}

/** Signal de Vinted rendu par un achat (CAPTCHA, avertissement, blocage, « trop de requêtes »), sinon null. */
function signalOf(outcome: PurchaseRunOutcome): RadarSignal | null {
  return outcome.status === "failed" && (["captcha", "warning", "blocked", "rate_limited"] as const).includes(outcome.code as RadarSignal) ? (outcome.code as RadarSignal) : null;
}

/**
 * Achat par le navigateur (session du compte Achat, porte-monnaie Vinted) et enregistrement du résultat.
 * Un signal de Vinted met le compte Cloud en pause (écrite d'abord). Si aucun navigateur n'a été lancé
 * (compte occupé, session illisible, aucun créneau libre), la réservation est retirée : `purchase` null.
 */
async function executePurchase(ctx: OrgContext, purchase: PurchaseRequest, opp: Opportunity, live: LiveAccount, input: { maxTotalCents: number; dryRun: boolean }): Promise<{ purchase: PurchaseRequest | null; reason?: string }> {
  const purchaser = ctx.services.radar!.purchaser!;
  const accountId = live.cloudAccount.id;
  const itemUrl = safeVintedUrl(opp.observed.url);
  const dropDraft = (reason: string) => withOrg(ctx, async (tx) => { await repos.purchases.deleteDraft(tx, purchase.id); return { purchase: null, reason }; });
  if (!itemUrl) return dropDraft("Adresse de l'annonce inconnue");
  const startedAt = ctx.services.now();
  const prep = await withOrg(ctx, async (tx) => {
    const locked = await repos.cloudAccounts.lock(tx, accountId, startedAt.toISOString(), new Date(startedAt.getTime() - 15 * 60_000).toISOString());
    if (!locked) return null;
    const session = await readLiveSessionTx(tx, ctx.services, locked);
    if (!session) {
      await repos.cloudAccounts.unlock(tx, accountId);
      return null;
    }
    return { session, savedAt: locked.sessionSavedAt };
  });
  if (!prep) return dropDraft("Compte Achat occupé ou session à refaire : achat au prochain passage");
  let outcome: PurchaseRunOutcome;
  try {
    outcome = await purchaser.buy({ orgId: ctx.orgId, purchaseId: purchase.id, cloudAccountId: accountId, connectionId: live.connection.id, session: prep.session, itemUrl, externalRef: opp.observed.externalRef ?? null, maxTotalCents: input.maxTotalCents, dryRun: input.dryRun, resume: false, paymentMethod: "vinted_wallet" });
  } catch (err) {
    outcome = { status: "failed", code: "error", message: err instanceof Error ? err.name : "Error", sideEffects: input.dryRun ? "none" : "unknown" };
  }
  if (outcome.status === "failed" && outcome.code === "unavailable" && outcome.launched === false) {
    // Aucun navigateur lancé (aucun créneau libre, plafond de la machine) : rien n'a touché Vinted.
    await withOrg(ctx, (tx) => repos.cloudAccounts.unlock(tx, accountId));
    return dropDraft("Aucun navigateur libre : achat au prochain passage");
  }
  const finishedAt = ctx.services.now();
  const signal = signalOf(outcome);
  const pausedLabel = signal ? (await cloud.pauseFromSystem(ctx.services, { orgId: ctx.orgId, accountId, code: signal, origin: "radar_purchase", now: finishedAt, meta: { purchaseId: purchase.id } })).label : null;
  const saved = await withOrg(ctx, (tx) => settlePurchaseTx(tx, ctx, { purchase, opp, live, outcome, signal, pausedLabel, resume: false, sessionSavedAt: prep.savedAt, startedAt, finishedAt, dryRun: input.dryRun }));
  return { purchase: saved };
}

/**
 * Le client a validé le paiement 3-D Secure dans son application bancaire : Selio relit la confirmation
 * dans le navigateur tenu ouvert (sans recliquer, sans rien saisir, sans reprendre la session ni le
 * verrou du compte). Seul le compte Achat qui a ouvert ce navigateur est accepté (jamais un repli sur
 * un autre compte). Délai passé : l'achat est abandonné (à vérifier dans Vinted).
 */
export async function resumePurchase(ctx: OrgContext, id: string, opts: { now?: Date } = {}): Promise<PurchaseRequest> {
  requireAction(ctx, "purchase.simulate");
  const now = opts.now ?? ctx.services.now();
  const state = await withOrg(ctx, async (tx) => {
    const p = await repos.purchases.byId(tx, id);
    if (p.status !== "awaiting_3ds") throw new AppError("conflict", "Cet achat n'attend pas de validation bancaire.", 409);
    if (p.awaiting3dsUntil && new Date(p.awaiting3dsUntil).getTime() <= now.getTime()) return { expired: true as const, p };
    if (!p.connectionId) throw new AppError("conflict", "Compte Achat de cet achat inconnu : vérifiez dans Vinted.", 409);
    const org = await repos.orgs.byId(tx, ctx.orgId);
    const check = await checkLiveAccountTx(tx, org, p.connectionId, { strict: true });
    return { expired: false as const, p, opp: await repos.opportunities.byId(tx, p.opportunityId), check };
  });
  if (state.expired) {
    await expireAwaiting3ds(ctx.services, ctx.orgId, now);
    throw new AppError("conflict", "Le délai de validation bancaire est dépassé : l'achat a été abandonné. Vérifiez dans Vinted qu'aucune commande n'a été passée.", 409);
  }
  if (!ctx.services.radar?.purchaser) throw new AppError("radar_purchaser_unavailable", "La vérification du paiement s'exécute dans le worker (navigateur de Selio Cloud).", 503);
  if (!state.check.ok) throw new AppError("radar_live_requires_cloud", state.check.message, 409);
  if (state.p.cloudAccountId && state.check.cloudAccount.id !== state.p.cloudAccountId) {
    throw new AppError("conflict", "Le compte Achat de cet achat a changé pendant l'attente : reprise refusée. Vérifiez dans Vinted qu'aucune commande n'a été passée.", 409);
  }
  const live: LiveAccount = { connection: state.check.connection, cloudAccount: state.check.cloudAccount, vintedHost: state.check.vintedHost };
  const purchaser = ctx.services.radar.purchaser;
  const dryRun = !realPurchaseEnabled(ctx.services);
  const startedAt = ctx.services.now();
  let outcome: PurchaseRunOutcome;
  try {
    outcome = await purchaser.buy({ orgId: ctx.orgId, purchaseId: state.p.id, cloudAccountId: live.cloudAccount.id, connectionId: live.connection.id, session: null, itemUrl: safeVintedUrl(state.opp.observed.url) ?? "", externalRef: state.opp.observed.externalRef ?? null, maxTotalCents: state.p.totalCents ?? state.p.maxPriceCents, dryRun, resume: true, paymentMethod: "vinted_wallet" });
  } catch (err) {
    outcome = { status: "failed", code: "error", message: err instanceof Error ? err.name : "Error", sideEffects: "unknown" };
  }
  const finishedAt = ctx.services.now();
  const signal = signalOf(outcome);
  const pausedLabel = signal ? (await cloud.pauseFromSystem(ctx.services, { orgId: ctx.orgId, accountId: live.cloudAccount.id, code: signal, origin: "radar_purchase", now: finishedAt, meta: { purchaseId: state.p.id } })).label : null;
  return withOrg(ctx, (tx) => settlePurchaseTx(tx, ctx, { purchase: state.p, opp: state.opp, live, outcome, signal, pausedLabel, resume: true, sessionSavedAt: null, startedAt, finishedAt, dryRun }));
}

/**
 * Paiements 3-D Secure non validés dans le délai : abandonnés (à vérifier dans Vinted), compte Achat
 * libéré, affaire mise en observation, Radar Auto arrêté (le paiement a pu partir) et le client alerté
 * (une notification par demande d'achat). La demande reste comptée dans le plafond du jour.
 */
export async function expireAwaiting3ds(services: Services, orgId: string, now: Date = services.now()): Promise<number> {
  return services.db.withOrg(orgId, async (tx) => {
    const expired = await repos.purchases.awaiting3dsExpired(tx, now.toISOString());
    for (const p of expired) {
      await repos.purchases.update(tx, p.id, { status: "cancelled", paymentAttempted: true, resultNote: "Validation bancaire non reçue dans le délai : achat abandonné. Vérifiez dans Vinted qu'aucune commande n'a été passée. Radar Auto est arrêté jusqu'à votre vérification." });
      if (p.cloudAccountId) await repos.cloudAccounts.release(tx, p.cloudAccountId).catch(() => undefined);
      await repos.opportunities.update(tx, p.opportunityId, { status: "watching" }).catch(() => null);
      await repos.radarAlerts.enqueue(tx, {
        kind: "payment_3ds", purchaseId: p.id, dedupeKey: `payment_3ds_expired:${p.id}`, scheduledFor: now.toISOString(),
        payload: radarAlertPayload.parse({ title: "Paiement non validé : achat abandonné", body: "Radar Auto : la validation bancaire n'a pas été reçue à temps. Vérifiez dans Vinted qu'aucune commande n'a été passée ; Radar Auto est arrêté et rien ne sera racheté automatiquement.", url: `/app/radar/achats/${p.id}` }),
      });
      await repos.audit.add(tx, { actorUserId: null, action: "purchase.3ds_expired", targetType: "purchase_request", targetId: p.id });
      const org = await repos.orgs.byId(tx, orgId);
      if (p.mode === "auto" && org.settings.autoBuy.enabled) {
        const autoBuy: AutoBuySettings = { ...org.settings.autoBuy, enabled: false, suspendedAt: now.toISOString(), suspendedReason: AUTO_SUSPENDED_3DS };
        await repos.orgs.update(tx, orgId, { settings: { ...org.settings, autoBuy } });
        await repos.audit.add(tx, { actorUserId: null, action: "radar.auto.suspended", targetType: "purchase_request", targetId: p.id, meta: { reason: "3ds_expired" } });
      }
    }
    return expired.length;
  });
}

// ---------------------------------------------------------------- réglages

/**
 * Réglages Radar (alertes, heures calmes, plafond de pages) et Radar Auto (seuil, prix maximum par
 * article, plafond du jour, compte Achat). Activer Radar Auto exige le verrou serveur (sinon refus avec
 * la mention de l'adresse partagée) ; la date et l'auteur de l'activation sont enregistrés.
 */
export async function updateRadarSettings(ctx: OrgContext, raw: unknown): Promise<{ radar: RadarSettings; autoBuy: Organization["settings"]["autoBuy"] }> {
  requireAction(ctx, "radar.write");
  const parsed = radarSettingsUpdate.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", "Réglages Radar invalides", 400, parsed.error.flatten());
  if (parsed.data.autoBuy) requireAction(ctx, "purchase.execute");
  return withOrg(ctx, async (tx) => {
    const org = await repos.orgs.byId(tx, ctx.orgId);
    const radar = { ...org.settings.radar, ...(parsed.data.radar ?? {}) };
    const autoBuy = { ...org.settings.autoBuy, ...(parsed.data.autoBuy ?? {}) };
    const enabling = autoBuy.enabled && !org.settings.autoBuy.enabled;
    if (enabling) {
      const server = radarAutoServerGate(ctx.services, ctx.orgId);
      if (!server.allowed) throw new AppError("radar_auto_disabled", server.reason!, 403, { notice: RADAR_AUTO_SHARED_ADDRESS_NOTICE });
      autoBuy.enabledAt = ctx.services.now().toISOString();
      autoBuy.enabledBy = ctx.userId;
      // Réactivation après un arrêt décidé par Selio (issue incertaine) : vaut acquittement du client.
      autoBuy.suspendedAt = null;
      autoBuy.suspendedReason = null;
    }
    if (parsed.data.autoBuy?.connectionId) {
      const c = await repos.connections.byId(tx, parsed.data.autoBuy.connectionId).catch(() => null);
      if (!c || c.usage !== "purchase" || !isActiveAccount(c)) throw new AppError("validation", "Radar Auto n'utilise qu'un compte Vinted « Achat » actif (jamais un compte Perso).", 400);
    }
    const updated = await repos.orgs.update(tx, ctx.orgId, { settings: { ...org.settings, radar, autoBuy } });
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "radar.settings_updated", targetType: "organization", targetId: ctx.orgId, meta: { radar: parsed.data.radar ?? null, autoBuy: parsed.data.autoBuy ? { ...parsed.data.autoBuy } : null, enabling }, ip: ctx.ip });
    return { radar: updated.settings.radar, autoBuy: updated.settings.autoBuy };
  });
}

// ---------------------------------------------------------------- statistiques (mesures honnêtes)

function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : Math.round((v[mid - 1]! + v[mid]!) / 2);
}

/**
 * Statistiques de Radar sur `days` jours : délai médian publication → détection, détection → achat
 * (achats réels), taux de blocage pour 1 000 pages, facteur courant par recherche, lectures par jour.
 * Seules les lectures EN DIRECT comptent : sans elles, tout vaut null et le statut est « à mesurer ».
 */
export async function radarMetrics(ctx: OrgContext, opts: { days?: number } = {}): Promise<RadarMetrics> {
  requireAction(ctx, "radar.read");
  const days = Math.min(90, Math.max(1, Math.round(opts.days ?? 30)));
  const now = ctx.services.now();
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  return withOrg(ctx, async (tx) => {
    const org = await repos.orgs.byId(tx, ctx.orgId);
    const daily = await repos.radarReads.dailyLive(tx, since);
    const liveReads = daily.reduce((s, d) => s + d.reads, 0);
    const blocks = daily.reduce((s, d) => s + d.blocks, 0);
    const list = await repos.searches.list(tx);
    const plan = new Map(planReads(list, now, { radarAutoActive: radarAutoActive(ctx.services, org), slowdown: await repos.radarOrgState.get(tx) }).map((p) => [p.searchId, p]));
    const searches = list.filter((s) => s.source === "cloud").map((s) => ({ id: s.id, name: s.name, factor: plan.get(s.id)?.factor ?? 1, intervalSeconds: plan.get(s.id)?.intervalSeconds ?? RADAR_READ_INTERVAL_SECONDS, lastBlockAt: s.lastBlockAt }));
    if (liveReads === 0) {
      return { days, status: "to_measure", label: "à mesurer", liveReads: 0, blocks: 0, blockRatePer1000: null, medianPublishToDetectSeconds: null, medianDetectToPurchaseSeconds: null, readsPerDay: [], searches };
    }
    const detect = (await repos.opportunities.detectionDelays(tx, since)).map((d) => (new Date(d.detectedAt).getTime() - new Date(d.publishedAt).getTime()) / 1000);
    const buy = (await repos.purchases.detectToPurchaseDelays(tx, since)).map((d) => (new Date(d.executedAt).getTime() - new Date(d.detectedAt).getTime()) / 1000);
    const rate = blockRatePer1000(liveReads, blocks);
    return {
      days, status: "measured", label: `mesuré sur ${liveReads} lecture(s) en direct`, liveReads, blocks,
      blockRatePer1000: rate === null ? null : Math.round(rate * 100) / 100,
      medianPublishToDetectSeconds: median(detect), medianDetectToPurchaseSeconds: median(buy), readsPerDay: daily, searches,
    };
  });
}

export interface AdminRadarOrg {
  orgId: string;
  name: string;
  plan: string;
  /** Recherches actives : en direct (Selio Cloud) et simulées. */
  liveSearches: number;
  demoSearches: number;
  prioritySearches: number;
  /** Lectures EN DIRECT et blocages sur la période (le simulateur ne compte jamais). */
  liveReads: number;
  blocks: number;
  blockRatePer1000: number | null;
  /** Facteur de ralentissement courant de l'organisation, appliqué à ses recherches en direct (1 = rythme normal). */
  maxFactor: number;
  lastBlockAt: string | null;
  radarAutoEnabled: boolean;
}

export interface AdminRadarOverview {
  days: number;
  /** « à mesurer » tant qu'aucune lecture en direct n'existe sur la période, toutes organisations confondues. */
  status: "measured" | "to_measure";
  liveReads: number;
  blocks: number;
  blockRatePer1000: number | null;
  /** Coupe-circuit de la machine (adresse partagée) en cours : fin, sinon null. */
  machinePausedUntil: string | null;
  orgs: AdminRadarOrg[];
}

/**
 * Vue opérateur de Radar : lectures, blocages et facteurs de ralentissement par organisation. Aucune
 * donnée de vendeur ni d'annonce (ni titre, ni pseudo, ni photo, ni adresse) : seulement des compteurs.
 */
export async function adminRadarOverview(ctx: OrgContext, opts: { days?: number } = {}): Promise<AdminRadarOverview> {
  if (!ctx.isOperator) throw new AppError("forbidden", "Accès réservé aux opérateurs Selio.", 403);
  const services = ctx.services;
  const days = Math.min(90, Math.max(1, Math.round(opts.days ?? 7)));
  const now = services.now();
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const { summary, circuit } = await services.db.withGlobal(async (tx) => ({ summary: await repos.admin.orgSummary(tx), circuit: await repos.cloudRuntime.get(tx) }));
  const orgs: AdminRadarOrg[] = [];
  for (const o of summary) {
    const row = await services.db.withOrg(o.id, async (tx) => {
      const org = await repos.orgs.byId(tx, o.id);
      const searches = (await repos.searches.list(tx)).filter((s) => s.enabled);
      const daily = await repos.radarReads.dailyLive(tx, since);
      const live = searches.filter((s) => s.source === "cloud");
      const liveReads = daily.reduce((s, d) => s + d.reads, 0);
      const blocks = daily.reduce((s, d) => s + d.blocks, 0);
      const slowdown = await repos.radarOrgState.get(tx);
      const lastBlockAt = [slowdown.lastBlockAt, ...live.map((s) => s.lastBlockAt)].filter((x): x is string => Boolean(x)).sort().at(-1) ?? null;
      return {
        orgId: o.id, name: o.name, plan: o.plan,
        liveSearches: live.length, demoSearches: searches.length - live.length, prioritySearches: live.filter((s) => s.priority).length,
        liveReads, blocks, blockRatePer1000: blockRatePer1000(liveReads, blocks),
        maxFactor: effectiveSlowdownFactor(slowdown, now),
        lastBlockAt, radarAutoEnabled: radarAutoActive(services, org),
      };
    });
    if (row.liveSearches + row.demoSearches > 0 || row.liveReads > 0) orgs.push(row);
  }
  orgs.sort((a, b) => b.blocks - a.blocks || b.maxFactor - a.maxFactor || b.liveReads - a.liveReads || a.name.localeCompare(b.name, "fr"));
  const liveReads = orgs.reduce((s, o) => s + o.liveReads, 0);
  const blocks = orgs.reduce((s, o) => s + o.blocks, 0);
  return {
    days, status: liveReads > 0 ? "measured" : "to_measure", liveReads, blocks, blockRatePer1000: blockRatePer1000(liveReads, blocks),
    machinePausedUntil: circuit.suspendedUntil && new Date(circuit.suspendedUntil).getTime() > now.getTime() ? circuit.suspendedUntil : null,
    orgs,
  };
}

// ---------------------------------------------------------------- rétention

/**
 * Rétention de Radar : mesures de lecture 90 jours ; données du vendeur gardées le temps de l'affaire
 * (affaires écartées supprimées après 30 jours, pseudo, note et photo effacés des autres après 30 jours) ;
 * alertes envoyées ou abandonnées 90 jours.
 */
export async function purgeRadarData(services: Services, orgId: string, now: Date = services.now()): Promise<{ reads: number; deleted: number; stripped: number; alerts: number }> {
  return services.db.withOrg(orgId, async (tx) => {
    const reads = await repos.radarReads.purgeOlderThan(tx, RADAR_READS_RETENTION_DAYS, now);
    const { deleted, stripped } = await repos.opportunities.purgeSellerData(tx, RADAR_OPPORTUNITY_PERSONAL_DATA_DAYS, now);
    const alerts = await repos.radarAlerts.purgeOlderThan(tx, RADAR_READS_RETENTION_DAYS, now);
    return { reads, deleted, stripped, alerts };
  });
}

/** Organisations à passer par le worker (recherche active, alerte en file ou paiement 3-D Secure en attente). */
export function radarOrgIds(services: Services): Promise<string[]> {
  return services.db.withGlobal((tx) => repos.radarOrgs.ids(tx));
}
