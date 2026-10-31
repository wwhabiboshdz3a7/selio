import {
  RADAR_AUTO_SHARED_ADDRESS_NOTICE, RADAR_DEMO_INTERVAL_SECONDS, RADAR_LIVE_REQUIRES_CLOUD, RADAR_MAX_PRIORITY_SEARCHES, RADAR_MAX_SLOWDOWN_FACTOR,
  RADAR_PRIORITY_INTERVAL_SECONDS, RADAR_READ_INTERVAL_SECONDS, RADAR_SLOWDOWN_RECOVERY_HOURS,
  autoBuySettings, isVintedHost,
  type AutoBuySettings, type CloudAccount, type CloudConsentView, type MarketplaceConnection, type Opportunity, type RadarSearch,
} from "@selio/contracts";
import { isActiveAccount, resolvePurchaseAccount } from "@selio/domain";
import type { AutoBuyStatus, PushConfig, RadarAutoLock } from "./data/types";

/**
 * Aides de Selio Radar partagées par les deux clients (API, démonstration) et les pages : lecture
 * tolérante des réponses du serveur, préparation de la lecture en direct, durées en français.
 */

// ---------------------------------------------------------------- durées et intervalles

/** Durée lisible : « 45 s », « 2 min », « 2 min 10 s », « 1 h 05 ». */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r ? `${m} min ${r} s` : `${m} min`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

/** Délai publication → détection d'une affaire (secondes), si la page montrait la date de publication. */
export function detectionDelaySeconds(o: Pick<Opportunity, "observed">): number | null {
  const pub = o.observed.publishedAt ? new Date(o.observed.publishedAt).getTime() : NaN;
  const det = o.observed.detectedAt ? new Date(o.observed.detectedAt).getTime() : NaN;
  if (!Number.isFinite(pub) || !Number.isFinite(det) || det < pub) return null;
  return Math.round((det - pub) / 1000);
}

// ---------------------------------------------------------------- rythme (même règle que packages/core/src/services/radar.ts)

/**
 * Facteur de ralentissement courant : celui fixé au dernier blocage, divisé par deux par tranche de 24 h
 * sans blocage, jamais sous 1. Le serveur le calcule lui-même ; la démonstration l'imite.
 */
export function effectiveSlowdownFactor(search: Pick<RadarSearch, "slowdownFactor" | "lastBlockAt">, now: Date): number {
  const stored = Math.max(1, Math.min(RADAR_MAX_SLOWDOWN_FACTOR, Math.round(search.slowdownFactor || 1)));
  if (stored === 1 || !search.lastBlockAt) return stored;
  const elapsed = now.getTime() - new Date(search.lastBlockAt).getTime();
  const halvings = Math.max(0, Math.floor(elapsed / (RADAR_SLOWDOWN_RECOVERY_HOURS * 3_600_000)));
  return Math.max(1, Math.floor(stored / 2 ** Math.min(halvings, 16)));
}

/** Intervalle effectif : 60 s en direct (30 s si prioritaire avec Radar Auto actif), 1 h pour le simulateur, × facteur. */
export function searchIntervalSeconds(search: Pick<RadarSearch, "source" | "priority" | "slowdownFactor" | "lastBlockAt">, now: Date, priorityActive = false): { factor: number; intervalSeconds: number } {
  if (search.source !== "cloud") return { factor: 1, intervalSeconds: RADAR_DEMO_INTERVAL_SECONDS };
  const factor = effectiveSlowdownFactor(search, now);
  const base = search.priority && priorityActive ? RADAR_PRIORITY_INTERVAL_SECONDS : RADAR_READ_INTERVAL_SECONDS;
  return { factor, intervalSeconds: base * factor };
}

// ---------------------------------------------------------------- annonce Vinted

/**
 * Adresse de l'annonce, seulement si c'est une page https d'un domaine Vinted de la liste fermée.
 * Donnée non fiable (lue sur une page tierce) : toute autre adresse est écartée.
 */
export function vintedListingUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.username || u.password || u.port || !isVintedHost(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Méthode d'estimation de la revente, en clair. */
export function estimateMethodLabel(method: string): { label: string; detail: string } {
  if (method === "embeddings") return { label: "Ventes proches (similarité)", detail: "Médiane des ventes dont le titre et la marque ressemblent le plus à cette annonce (modèle 2, comparaison par embeddings)." };
  if (method === "brand_category") return { label: "Marque et catégorie", detail: "Médiane des ventes de la même marque et de la même catégorie, ajustée à l'état." };
  return { label: "Marque et catégorie", detail: method };
}

// ---------------------------------------------------------------- lecture en direct

export interface LiveReadiness {
  ready: boolean;
  /** Compte Achat lu (celui de la recherche, sinon celui de Radar Auto, sinon le premier compte Achat actif). */
  account: MarketplaceConnection | null;
  cloudAccount: CloudAccount | null;
  /** Ce qui manque, en clair (null si prête). */
  problem: string | null;
}

/**
 * La lecture en direct exige le compte ACHAT du client relié à Selio Cloud : compte Cloud actif, session
 * enregistrée, accord valide (même règle que `checkLiveAccountTx` côté serveur, qui reste seul juge).
 */
export function liveReadiness(input: {
  search: Pick<RadarSearch, "connectionId"> | null;
  connections: MarketplaceConnection[];
  cloudAccounts: CloudAccount[];
  consent: Pick<CloudConsentView, "current"> | null;
  autoBuyConnectionId: string | null;
}): LiveReadiness {
  const wanted = input.search?.connectionId ?? null;
  const account = wanted
    ? input.connections.find((c) => c.id === wanted && c.usage === "purchase" && isActiveAccount(c)) ?? null
    : resolvePurchaseAccount(input.connections, input.autoBuyConnectionId);
  if (!account) return { ready: false, account: null, cloudAccount: null, problem: `${RADAR_LIVE_REQUIRES_CLOUD} : aucun compte Vinted « Achat » actif. Les comptes Perso et de vente ne sont jamais lus.` };
  const cloudAccount = input.cloudAccounts.find((a) => a.connectionId === account.id) ?? null;
  if (!cloudAccount) return { ready: false, account, cloudAccount: null, problem: `${RADAR_LIVE_REQUIRES_CLOUD} : le compte « ${account.label} » n'est pas relié au Cloud.` };
  if (!input.consent?.current) return { ready: false, account, cloudAccount, problem: `${RADAR_LIVE_REQUIRES_CLOUD} : l'accord Selio Cloud n'est pas donné pour la version actuelle.` };
  if (cloudAccount.status !== "active") return { ready: false, account, cloudAccount, problem: `${RADAR_LIVE_REQUIRES_CLOUD} : le compte « ${account.label} » n'est pas actif dans le Cloud (${cloudAccount.status === "paused" ? "en pause" : cloudAccount.status === "needs_login" ? "connexion à faire" : "arrêté"}).` };
  if (!cloudAccount.hasSession) return { ready: false, account, cloudAccount, problem: `${RADAR_LIVE_REQUIRES_CLOUD} : aucune session enregistrée, connectez-vous dans la fenêtre sécurisée.` };
  return { ready: true, account, cloudAccount, problem: null };
}

/** Recherches prioritaires déjà prises, hors `exceptId` : la 4e est refusée. */
export function priorityCount(searches: readonly Pick<RadarSearch, "id" | "priority">[], exceptId: string | null = null): number {
  return searches.filter((s) => s.priority && s.id !== exceptId).length;
}

export function canAddPriority(searches: readonly Pick<RadarSearch, "id" | "priority">[], exceptId: string | null = null, max = RADAR_MAX_PRIORITY_SEARCHES): boolean {
  return priorityCount(searches, exceptId) < max;
}

// ---------------------------------------------------------------- lecture tolérante des réponses du serveur

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** Configuration des notifications : seule la clé PUBLIQUE est attendue ; sans clé, rien n'est activable. */
export function normalizePushConfig(raw: unknown): PushConfig {
  const r = isObj(raw) ? raw : {};
  const publicKey = str(r.publicKey) ?? str(r.vapidPublicKey) ?? str(r.key);
  const enabled = r.enabled === undefined ? publicKey !== null : r.enabled === true && publicKey !== null;
  const reason = enabled ? null : str(r.reason) ?? "Les notifications ne sont pas configurées sur ce serveur (clés VAPID absentes).";
  return { enabled, publicKey: enabled ? publicKey : null, reason, ...(r.simulated === true ? { simulated: true } : {}) };
}

/** Libellés des verrous de Radar Auto (mêmes clés et même ordre que le serveur). */
export const RADAR_AUTO_LOCK_LABELS: Record<string, string> = {
  server: "Verrou du serveur (RADAR_AUTO_ENABLED)",
  shared_address: "Adresse partagée : comptes de l'équipe seulement",
  organization: "Réglage de l'organisation",
  cloud: "Compte Achat relié à Selio Cloud",
  consent: "Accord Selio Cloud",
};

function normalizeLock(raw: unknown, i: number): RadarAutoLock | null {
  if (!isObj(raw)) return null;
  const key = str(raw.key) ?? `lock-${i}`;
  const label = str(raw.label) ?? RADAR_AUTO_LOCK_LABELS[key] ?? key;
  return { key, ok: raw.ok === true, label, detail: str(raw.detail) ?? str(raw.reason) ?? "" };
}

/**
 * État de Radar Auto rendu par le serveur, lu sans confiance : tout champ absent vaut « fermé ». Un
 * serveur qui ne renvoie que des raisons voit chaque raison affichée comme un verrou fermé.
 */
export function normalizeAutoBuyStatus(raw: unknown, fallback: AutoBuySettings): AutoBuyStatus {
  const r = isObj(raw) ? raw : {};
  const reasons = Array.isArray(r.reasons) ? r.reasons.filter((x): x is string => typeof x === "string") : [];
  const parsedSettings = autoBuySettings.safeParse(r.settings);
  const settings = parsedSettings.success ? parsedSettings.data : fallback;
  let locks = Array.isArray(r.locks) ? r.locks.map(normalizeLock).filter((l): l is RadarAutoLock => l !== null) : [];
  const lockOk = (key: string) => locks.find((l) => l.key === key)?.ok;
  // Verrou serveur ouvert POUR CETTE ORGANISATION : RADAR_AUTO_ENABLED et liste des comptes de l'équipe.
  const serverEnabled = r.serverEnabled === true || (lockOk("server") === true && lockOk("shared_address") !== false);
  if (locks.length === 0) {
    locks = [
      { key: "server", ok: serverEnabled, label: RADAR_AUTO_LOCK_LABELS.server!, detail: serverEnabled ? "Ouvert pour les comptes de l'équipe Selio (tests)." : "Fermé sur le serveur." },
      { key: "organization", ok: settings.enabled, label: RADAR_AUTO_LOCK_LABELS.organization!, detail: settings.enabled ? "Activé." : "Désactivé." },
      ...reasons.map((reason, i) => ({ key: `reason-${i}`, ok: false, label: "À lever", detail: reason })),
    ];
  }
  const account = isObj(r.account) && str(r.account.id) && str(r.account.label) ? { id: r.account.id as string, label: r.account.label as string } : null;
  // « Actif » seulement si le serveur le dit ET qu'aucun verrou affiché n'est fermé.
  const active = r.active === true && locks.every((l) => l.ok);
  return {
    active,
    serverEnabled,
    orgEnabled: settings.enabled,
    realPurchase: r.realPurchase === true,
    locks,
    reasons,
    notice: str(r.notice) ?? RADAR_AUTO_SHARED_ADDRESS_NOTICE,
    account,
    settings,
    ...(r.simulated === true ? { simulated: true } : {}),
  };
}
