import {
  RADAR_LIVE_REQUIRES_CLOUD, filterVintedStorageState, isStorageStateEmpty, normalizeVintedHost, radarCatalogItem,
  type CloudAccount, type CloudStorageState, type MarketplaceConnection, type Organization, type RadarCatalogItem, type RadarCatalogItemInput, type RadarCriteria, type RadarReadOutcome, type RadarSearch, type RadarSourceKind,
} from "@selio/contracts";
import { repos, type Tx } from "@selio/db";
import { hashString, isActiveAccount, localDayKey, resolvePurchaseAccount, seededRandom } from "@selio/domain";
import { AppError, withOrg, type OrgContext, type Services } from "../context";
import { hasValidConsent } from "./cloud";

/**
 * Sources des annonces de Selio Radar.
 *
 * - `DemoSource` : le simulateur de démonstration (déterministe, aucune page lue).
 * - `CloudSource` : lecture EN DIRECT de la page de recherche Vinted depuis le compte ACHAT du client,
 *   par Selio Cloud (session chiffrée du compte Cloud, accord Cloud valide). Jamais depuis un compte
 *   Perso ni un compte de vente, jamais sans accord, aucun mot de passe, aucun cookie hors de la session
 *   vinted.* du compte. Un CAPTCHA, un avertissement, un blocage ou un « trop de requêtes » arrête la
 *   lecture : aucun contournement, la page n'est jamais relue tout de suite.
 *
 * Le navigateur lui-même (Chromium, adaptateur de page) est fourni par le worker via
 * `services.radar.reader` et `services.radar.purchaser` : interfaces minimales ci-dessous.
 */

// ---------------------------------------------------------------- navigateur (interfaces minimales)

/** Signaux de Vinted qui arrêtent immédiatement la lecture ou l'achat (jamais contournés). */
export type RadarSignal = "captcha" | "warning" | "blocked" | "rate_limited";
export const RADAR_SIGNALS: readonly RadarSignal[] = ["captcha", "warning", "blocked", "rate_limited"];

export interface RadarReaderInput {
  orgId: string;
  searchId: string;
  cloudAccountId: string;
  connectionId: string;
  /** Session déchiffrée du compte Achat, limitée aux domaines vinted.* (jamais journalisée). */
  session: CloudStorageState;
  criteria: RadarCriteria;
  /** Domaine Vinted du compte (liste fermée) ; www.vinted.fr par défaut. */
  vintedHost: string;
  now: Date;
}

/** Résultat d'une lecture (forme compatible avec le lecteur de @selio/cloud). Les annonces sont revalidées ici. */
export type RadarReaderOutcome =
  | { ok: true; items: readonly unknown[]; durationMs?: number; session?: unknown }
  | {
      ok: false;
      /** Signal de Vinted (→ pause), session refusée, délai, erreur, ou aucun navigateur libre (`unavailable`). */
      code: RadarSignal | "not_logged_in" | "selector_missing" | "timeout" | "error" | "unavailable";
      message?: string;
      /** Faux : aucun navigateur lancé, aucune page lue (rien n'est compté). */
      launched?: boolean;
      durationMs?: number;
      session?: unknown;
    };

/** Lecture d'une page de recherche : implémentée par le worker (Selio Cloud), `FakeRadarReader` dans les tests. */
export interface RadarReader {
  read(input: RadarReaderInput): Promise<RadarReaderOutcome>;
}

export interface PurchaseRunInput {
  orgId: string;
  purchaseId: string;
  cloudAccountId: string;
  connectionId: string;
  /**
   * Session déchiffrée du compte Achat (domaines vinted.* seulement). Null pour une reprise 3-D Secure :
   * la reprise relit le navigateur déjà ouvert, sans reprendre ni la session ni le verrou du compte.
   */
  session: CloudStorageState | null;
  /** Annonce à acheter (https, domaine Vinted de la liste fermée). */
  itemUrl: string;
  externalRef: string | null;
  /** Coût total accepté au plus (prix + port + protection) : au-delà, arrêt AVANT de payer. */
  maxTotalCents: number;
  /**
   * Essai à blanc : le parcours va jusqu'au bouton de paiement sans jamais cliquer dessus. Vrai tant que
   * RADAR_AUTO_ENABLED et l'achat réel (RADAR_REAL_PURCHASE, D11) ne sont pas tous deux ouverts.
   */
  dryRun: boolean;
  /** Reprise après la validation 3-D Secure du client : relire la confirmation, sans recliquer. */
  resume?: boolean;
  /** Paiement par le porte-monnaie Vinted du client, uniquement. */
  paymentMethod: "vinted_wallet";
}

/**
 * Résultat d'un achat. `pages` : pages Vinted chargées par le navigateur (annonce, paiement,
 * confirmation), comptées dans les plafonds de pages par minute et dans le taux de blocage.
 */
export type PurchaseRunOutcome =
  | { status: "purchased"; totalCents: number; orderRef?: string | null; durationMs?: number; session?: unknown; pages?: number }
  /**
   * La banque demande une validation 3-D Secure : l'achat attend le client, aucun code n'est saisi à sa
   * place. `expiresAt` : fermeture du navigateur tenu ouvert (le délai enregistré en base est le même).
   */
  | { status: "awaiting_3ds"; totalCents?: number | null; expiresAt?: string | null; durationMs?: number; session?: unknown; pages?: number }
  | { status: "dry_run"; totalCents?: number | null; durationMs?: number; session?: unknown; pages?: number }
  | { status: "unavailable"; reason: "sold" | "reserved" | "hidden"; durationMs?: number; session?: unknown; pages?: number }
  | {
      status: "failed";
      /** `wallet_unavailable` : porte-monnaie Vinted non proposé, arrêt avant « Payer » (jamais la carte à sa place). */
      code: RadarSignal | "not_logged_in" | "price_changed" | "payment_error" | "wallet_unavailable" | "selector_missing" | "timeout" | "error" | "unavailable";
      message?: string;
      /** Faux : aucun navigateur lancé. */
      launched?: boolean;
      /** « unknown » : le paiement a pu partir (jamais relancé automatiquement). */
      sideEffects?: "none" | "unknown";
      durationMs?: number;
      session?: unknown;
      pages?: number;
    };

/** Achat pas à pas (Radar Auto) : implémenté par le worker, `FakePurchaseRunner` dans les tests. */
export interface PurchaseRunner {
  buy(input: PurchaseRunInput): Promise<PurchaseRunOutcome>;
}

type ReaderResponder = RadarReaderOutcome | ((input: RadarReaderInput) => RadarReaderOutcome | Promise<RadarReaderOutcome>);
type PurchaseResponder = PurchaseRunOutcome | ((input: PurchaseRunInput) => PurchaseRunOutcome | Promise<PurchaseRunOutcome>);

/** Lecteur factice : rejoue les résultats mis en file, sinon rend une page vide. Garde les appels (sans session). */
export class FakeRadarReader implements RadarReader {
  readonly calls: (Omit<RadarReaderInput, "session"> & { cookieNames: string[] })[] = [];
  private readonly queue: ReaderResponder[] = [];

  enqueue(...outcomes: ReaderResponder[]): this {
    this.queue.push(...outcomes);
    return this;
  }

  async read(input: RadarReaderInput): Promise<RadarReaderOutcome> {
    const { session, ...rest } = input;
    this.calls.push({ ...rest, criteria: structuredClone(rest.criteria), cookieNames: session.cookies.map((c) => c.name) });
    const next = this.queue.shift();
    if (next) return typeof next === "function" ? next(input) : next;
    return { ok: true, items: [], durationMs: 800 };
  }
}

/** Exécuteur d'achat factice : rejoue les résultats mis en file, sinon s'arrête avant de payer (essai à blanc). */
export class FakePurchaseRunner implements PurchaseRunner {
  /** Appels reçus, sans la session (`hadSession` : une session a été passée ; jamais pour une reprise). */
  readonly calls: (Omit<PurchaseRunInput, "session"> & { hadSession: boolean })[] = [];
  private readonly queue: PurchaseResponder[] = [];

  enqueue(...outcomes: PurchaseResponder[]): this {
    this.queue.push(...outcomes);
    return this;
  }

  async buy(input: PurchaseRunInput): Promise<PurchaseRunOutcome> {
    const { session, ...rest } = input;
    this.calls.push({ ...structuredClone(rest), hadSession: session !== null });
    const next = this.queue.shift();
    if (next) return typeof next === "function" ? next(input) : next;
    return { status: "dry_run", totalCents: null, durationMs: 1500 };
  }
}

// ---------------------------------------------------------------- compte Achat relié au Cloud

/** Compte Achat prêt pour une lecture ou un achat en direct (session déchiffrée par l'appelant). */
export interface LiveAccount {
  connection: MarketplaceConnection;
  cloudAccount: CloudAccount;
  vintedHost: string;
}

export type LiveAccountCheck =
  | { ok: true; connection: MarketplaceConnection; cloudAccount: CloudAccount; vintedHost: string }
  | { ok: false; reason: "no_purchase_account" | "not_purchase_account" | "no_cloud_account" | "cloud_not_active" | "no_session" | "no_consent"; message: string; connection: MarketplaceConnection | null };

const LIVE_REASON_TEXT: Record<Exclude<LiveAccountCheck, { ok: true }>["reason"], string> = {
  no_purchase_account: "aucun compte Vinted « Achat » actif",
  not_purchase_account: "le compte choisi n'est pas un compte « Achat » actif (jamais un compte Perso ni un compte de vente)",
  no_cloud_account: "le compte Achat n'est pas activé dans Selio Cloud",
  cloud_not_active: "le compte Achat est en pause, arrêté ou à reconnecter dans Selio Cloud",
  no_session: "le compte Achat n'a pas de session Selio Cloud (connexion à faire)",
  no_consent: "l'accord Selio Cloud n'a pas été accepté (ou le texte a changé)",
};

/**
 * Compte Achat d'une lecture ou d'un achat en direct : celui de la recherche (qui doit être un compte
 * Achat actif), sinon celui de Radar Auto, sinon le premier compte Achat actif ; relié à un compte Cloud
 * actif avec une session ; accord Cloud valide pour la version courante.
 */
export async function checkLiveAccountTx(tx: Tx, org: Organization, preferredConnectionId: string | null, opts: { strict?: boolean } = {}): Promise<LiveAccountCheck> {
  const all = await repos.connections.list(tx);
  let connection: MarketplaceConnection | null;
  // Strict (compte choisi sur la recherche) : ce compte-là ou rien ; sinon, repli sur le premier compte Achat actif.
  if (preferredConnectionId && opts.strict !== false) {
    connection = all.find((c) => c.id === preferredConnectionId) ?? null;
    if (!connection || connection.usage !== "purchase" || !isActiveAccount(connection) || connection.provider !== "vinted") {
      return { ok: false, reason: "not_purchase_account", message: `${RADAR_LIVE_REQUIRES_CLOUD} : ${LIVE_REASON_TEXT.not_purchase_account}.`, connection };
    }
  } else {
    connection = resolvePurchaseAccount(all.filter((c) => c.provider === "vinted"), preferredConnectionId ?? org.settings.autoBuy.connectionId);
    if (!connection) return { ok: false, reason: "no_purchase_account", message: `${RADAR_LIVE_REQUIRES_CLOUD} : ${LIVE_REASON_TEXT.no_purchase_account}.`, connection: null };
  }
  const no = (reason: Exclude<LiveAccountCheck, { ok: true }>["reason"]): LiveAccountCheck => ({ ok: false, reason, message: `${RADAR_LIVE_REQUIRES_CLOUD} : ${LIVE_REASON_TEXT[reason]}.`, connection });
  const cloudAccount = await repos.cloudAccounts.byConnection(tx, connection.id);
  if (!cloudAccount || cloudAccount.status === "stopped") return no("no_cloud_account");
  if (cloudAccount.status !== "active") return no("cloud_not_active");
  if (!cloudAccount.hasSession) return no("no_session");
  if (!(await hasValidConsent(tx))) return no("no_consent");
  return { ok: true, connection, cloudAccount, vintedHost: normalizeVintedHost(connection.config.vintedHost) ?? "www.vinted.fr" };
}

/**
 * Session du compte Achat, déchiffrée (données associées = id du compte Cloud) et refiltrée sur les
 * domaines vinted.*. Null si absente ou illisible : la session est alors effacée et la connexion est à
 * refaire (comme pour une action Cloud).
 */
export async function readLiveSessionTx(tx: Tx, services: Services, cloudAccount: CloudAccount): Promise<CloudStorageState | null> {
  const blob = await repos.cloudAccounts.session(tx, cloudAccount.id);
  let session: CloudStorageState | null = null;
  try {
    session = blob ? filterVintedStorageState(JSON.parse(services.secrets.decrypt(blob, cloudAccount.id))) : null;
  } catch {
    session = null;
  }
  if (!isStorageStateEmpty(session)) return session;
  await repos.cloudAccounts.clearSession(tx, cloudAccount.id);
  await repos.cloudAccounts.update(tx, cloudAccount.id, { status: "needs_login" });
  await repos.audit.add(tx, { actorUserId: null, action: "cloud.account.needs_login", targetType: "cloud_account", targetId: cloudAccount.id, meta: { reason: "session_unreadable", origin: "radar" } });
  return null;
}

// ---------------------------------------------------------------- sources

/** Résultat d'une lecture, quelle que soit la source. */
export interface RadarSourceResult {
  source: RadarSourceKind;
  /** Annonces validées (données non fiables d'une page tierce : schéma strict, au plus 96). */
  items: RadarCatalogItem[];
  /** Annonces écartées par la validation. */
  invalidItems: number;
  outcome: RadarReadOutcome;
  /** Signal de Vinted (arrêt immédiat, pause du compte) ou null. */
  signal: RadarSignal | null;
  blocked: boolean;
  /** Vinted a refusé la session : connexion à refaire. */
  notLoggedIn: boolean;
  /** Faux : aucun navigateur lancé, aucune page lue (rien n'est mesuré). */
  launched: boolean;
  /**
   * Lecture anormale : page atteinte mais non reconnue (adaptateur à revoir ou vérification que le
   * détecteur ne connaît pas), erreur ou délai dépassé après le lancement. Comptée par recherche :
   * au-delà de RADAR_MAX_CONSECUTIVE_ANOMALIES de suite, la lecture de la recherche est arrêtée.
   */
  anomaly: boolean;
  durationMs: number;
  /** Session relue par le navigateur (refiltrée avant d'être rechiffrée). */
  session?: unknown;
  message?: string;
}

export interface RadarSourceReadOptions {
  now: Date;
  /** Compte Achat et session déchiffrée (source en direct seulement). */
  live?: { account: LiveAccount; session: CloudStorageState } | null;
}

export interface RadarSource {
  readonly kind: RadarSourceKind;
  read(ctx: OrgContext, search: RadarSearch, opts: RadarSourceReadOptions): Promise<RadarSourceResult>;
}

/** Annonces lues au plus par page (même borne que l'adaptateur catalogue). */
export const RADAR_MAX_ITEMS_PER_READ = 96;

/** Valide les annonces d'une page tierce : schéma strict, adresses https Vinted seulement. */
export function validateCatalogItems(raw: readonly unknown[]): { items: RadarCatalogItem[]; invalid: number } {
  const items: RadarCatalogItem[] = [];
  let invalid = 0;
  for (const r of raw.slice(0, RADAR_MAX_ITEMS_PER_READ)) {
    const parsed = radarCatalogItem.safeParse(r);
    if (!parsed.success) {
      invalid++;
      continue;
    }
    const it = parsed.data;
    items.push({ ...it, url: safeVintedUrl(it.url), photoUrl: it.photoUrl && /^https:\/\/[^\s"'<>]+$/i.test(it.photoUrl) ? it.photoUrl : null });
  }
  invalid += Math.max(0, raw.length - RADAR_MAX_ITEMS_PER_READ);
  return { items, invalid };
}

/** Adresse https d'une annonce sur un domaine Vinted de la liste fermée, sans paramètres ; sinon null. */
export function safeVintedUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || !normalizeVintedHost(u.hostname) || u.username || u.password) return null;
    return `https://${u.hostname.toLowerCase()}${u.pathname}`.slice(0, 500);
  } catch {
    return null;
  }
}

/**
 * Simulateur de démonstration (déplacé tel quel de l'ancien `runSearchOnly`) : même graine (recherche,
 * jour local, nombre d'affaires déjà trouvées), même suite de tirages, mêmes doublons écartés (titre et
 * prix). Aucune page n'est lue ; les affaires sont marquées « demo_simulator » et ne comptent jamais
 * dans les statistiques.
 */
export const DemoSource: RadarSource = {
  kind: "demo",
  async read(ctx, search, opts) {
    const started = Date.now();
    const now = opts.now;
    const raw = await withOrg(ctx, async (tx) => {
      const org = await repos.orgs.byId(tx, ctx.orgId);
      const existing = await repos.opportunities.list(tx, { searchId: search.id });
      const rnd = seededRandom(hashString(search.id + localDayKey(now, org.settings.timezone) + existing.length));
      const brands = search.criteria.brands.length ? search.criteria.brands : ["Nike", "Zara", "Levi's"];
      const cats = search.criteria.categories.length ? search.criteria.categories : (["shoes", "men", "women"] as const);
      const out: RadarCatalogItemInput[] = [];
      const seen = new Set<string>();
      const count = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < count; i++) {
        const brand = brands[Math.floor(rnd() * brands.length)]!;
        const category = cats[Math.floor(rnd() * cats.length)]!;
        const conditions = search.criteria.conditions.length ? search.criteria.conditions : (["very_good", "good", "satisfactory"] as const);
        const condition = conditions[Math.floor(rnd() * conditions.length)]!;
        const priceCents = Math.round((search.criteria.maxPriceCents * (0.5 + rnd() * 0.6)) / 100) * 100;
        const shippingCents = 450 + Math.floor(rnd() * 3) * 100;
        const size = search.criteria.sizes.length ? search.criteria.sizes[Math.floor(rnd() * search.criteria.sizes.length)]! : "M";
        const seenAt = new Date(now.getTime() - Math.floor(rnd() * 20) * 3_600_000).toISOString();
        const photoCount = 1 + Math.floor(rnd() * 8);
        const sellerRating = Math.round((3.6 + rnd() * 1.4) * 10) / 10;
        const sellerReviews = Math.floor(rnd() * 180);
        const title = `${brand} ${search.criteria.keywords[0] ?? (category === "shoes" ? "sneakers" : "pièce")} ${size}`;
        const key = `${title}\u0000${priceCents}`;
        if (seen.has(key) || (await repos.opportunities.exists(tx, search.id, title, priceCents))) continue;
        seen.add(key);
        out.push({ externalRef: null, title, priceCents, shippingCents, brand, size, condition, category, url: null, photoUrl: null, photoCount, sellerHandle: `vendeur_${Math.floor(rnd() * 900 + 100)}`, sellerRating, sellerReviews, publishedAt: seenAt });
      }
      return out;
    });
    const { items, invalid } = validateCatalogItems(raw);
    return { source: "demo", items, invalidItems: invalid, outcome: "ok", signal: null, blocked: false, notLoggedIn: false, launched: true, anomaly: false, durationMs: Date.now() - started };
  },
};

const OUTCOME_BY_CODE: Record<Exclude<RadarReaderOutcome, { ok: true }>["code"], RadarReadOutcome> = {
  captcha: "captcha",
  rate_limited: "rate_limited",
  blocked: "blocked",
  // Avertissement de Vinted : compté comme un blocage (contrats).
  warning: "blocked",
  timeout: "timeout",
  not_logged_in: "error",
  // Page non reconnue : mesurée à part (adaptateur à revoir, ou vérification inconnue du détecteur).
  selector_missing: "page_changed",
  error: "error",
  unavailable: "error",
};

/**
 * Lecture EN DIRECT par Selio Cloud, depuis le compte Achat. Exige le lecteur du worker et un compte
 * Achat prêt (session déchiffrée par l'appelant) ; sinon erreur claire, rien n'est lancé.
 */
export const CloudSource: RadarSource = {
  kind: "cloud",
  async read(ctx, search, opts) {
    const reader = ctx.services.radar?.reader;
    if (!reader) throw new AppError("radar_reader_unavailable", "La lecture en direct s'exécute dans le worker (navigateur de Selio Cloud) : aucun lecteur n'est disponible ici.", 503);
    if (!opts.live) throw new AppError("radar_live_requires_cloud", RADAR_LIVE_REQUIRES_CLOUD, 409);
    const { account, session } = opts.live;
    const started = Date.now();
    let outcome: RadarReaderOutcome;
    try {
      outcome = await reader.read({ orgId: ctx.orgId, searchId: search.id, cloudAccountId: account.cloudAccount.id, connectionId: account.connection.id, session, criteria: search.criteria, vintedHost: account.vintedHost, now: opts.now });
    } catch (err) {
      // Le message d'une exception peut contenir n'importe quoi (adresse, extrait de page) : seul son type est gardé.
      outcome = { ok: false, code: "error", message: err instanceof Error ? err.name : "Error" };
    }
    const durationMs = typeof outcome.durationMs === "number" && Number.isFinite(outcome.durationMs) ? Math.max(0, Math.round(outcome.durationMs)) : Date.now() - started;
    if (outcome.ok) {
      const { items, invalid } = validateCatalogItems(Array.isArray(outcome.items) ? outcome.items : []);
      return { source: "cloud", items, invalidItems: invalid, outcome: "ok", signal: null, blocked: false, notLoggedIn: false, launched: true, anomaly: false, durationMs, session: outcome.session };
    }
    const code = (Object.keys(OUTCOME_BY_CODE) as (keyof typeof OUTCOME_BY_CODE)[]).includes(outcome.code) ? outcome.code : "error";
    const signal = (RADAR_SIGNALS as readonly string[]).includes(code) ? (code as RadarSignal) : null;
    const launched = signal !== null || outcome.launched !== false;
    const anomaly = launched && signal === null && (code === "selector_missing" || code === "error" || code === "timeout");
    return {
      source: "cloud", items: [], invalidItems: 0, outcome: OUTCOME_BY_CODE[code], signal, blocked: signal !== null, notLoggedIn: code === "not_logged_in",
      launched, anomaly, durationMs, session: outcome.session, message: typeof outcome.message === "string" ? outcome.message.slice(0, 200) : undefined,
    };
  },
};

/** Source d'une recherche : le simulateur, ou la lecture en direct (Selio Cloud). */
export function sourceFor(search: Pick<RadarSearch, "source">): RadarSource {
  return search.source === "cloud" ? CloudSource : DemoSource;
}
