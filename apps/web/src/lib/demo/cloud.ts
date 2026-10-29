import { CLOUD_ACTION_LEVEL_BY_KIND, CLOUD_CONSENT_TEXT, type CloudAccount, type CloudAction, type CloudActionDetail, type CloudActionKind, type CloudActionStatus, type CloudConsent, type CloudLoginSessionStatus, type CloudRunCode, type MarketplaceConnection } from "@selio/contracts";
import { hashString, isAutomatable, seededRandom } from "@selio/domain";

/**
 * Selio Cloud dans la démonstration : état rangé à côté de l'état partagé (`DemoState` ne le connaît
 * pas), persisté avec lui et créé au premier accès. Rien ne touche Vinted : les comptes, la session
 * (« une session existe », jamais de contenu) et le journal sont fictifs ; la connexion est simulée.
 */
export interface DemoCloudLogin {
  id: string;
  accountId: string;
  status: CloudLoginSessionStatus;
  expiresAt: string;
  createdAt: string;
}

export interface DemoCloudState {
  /** Accord enregistré (null au premier lancement : aucune action Cloud sans accord). */
  consent: CloudConsent | null;
  accounts: CloudAccount[];
  /** Journal, du plus récent au plus ancien. */
  actions: CloudAction[];
  logins: DemoCloudLogin[];
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Heures UTC des actions du journal de démonstration (dans les heures actives, 8 h – 23 h à Paris). */
const SLOTS_UTC = [17, 12, 9] as const;

/** Comptes Vinted que la démonstration relie au Cloud : ni Perso, ni déconnectés. */
export function cloudEligibleConnections(connections: MarketplaceConnection[]): MarketplaceConnection[] {
  return connections.filter((c) => c.provider === "vinted" && c.status !== "disconnected" && isAutomatable(c));
}

/** Empreinte SHA-256 (hex) d'un texte ; repli déterministe si l'API de chiffrement du navigateur manque. */
export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return `demo-${hashString(text).toString(16).padStart(16, "0")}`;
}

let consentHash: Promise<string> | null = null;
/** Empreinte du texte d'accord courant (calculée une fois). */
export function currentConsentHash(): Promise<string> {
  consentHash ??= sha256Hex(CLOUD_CONSENT_TEXT);
  return consentHash;
}

interface Planned {
  status: CloudActionStatus;
  code?: CloudRunCode;
  reason?: string;
  sideEffects?: "none" | "unknown";
  message?: string;
}

/** Ce qui arrive à la k-ième action (k = 0 : la plus récente). */
function plannedOutcome(k: number, onSecond: boolean): Planned {
  if (k === 1 && onSecond) return { status: "paused", code: "captcha", sideEffects: "none", message: "CAPTCHA affiché par Vinted : compte mis en pause, rien n'a été envoyé." };
  if (k === 9) return { status: "failed", code: "selector_missing", sideEffects: "none", message: "Page Vinted non reconnue : rien n'a été envoyé." };
  if (k === 17) return { status: "failed", code: "timeout", sideEffects: "unknown", message: "Envoi non confirmé : rien n'est renvoyé automatiquement." };
  if (k === 5) return { status: "skipped", reason: "too_soon" };
  if (k === 14) return { status: "skipped", reason: "expired" };
  if (k === 22) return { status: "skipped", reason: "hourly_limit" };
  return { status: "done", code: "ok", sideEffects: "none" };
}

/**
 * État Cloud de départ : un compte actif, un compte en pause après un CAPTCHA (s'il y a deux comptes
 * Vinted éligibles), un journal de 30 actions légères sur les 10 derniers jours, aucun accord.
 */
export function seedDemoCloud(orgId: string, connections: MarketplaceConnection[], now: Date): DemoCloudState {
  const eligible = cloudEligibleConnections(connections).slice(0, 2);
  if (eligible.length === 0) return { consent: null, accounts: [], actions: [], logins: [] };
  const rand = seededRandom(hashString(`${orgId}:cloud`));
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const iso = (t: number) => new Date(t).toISOString();
  const first: CloudAccount = {
    id: `cloud-${eligible[0]!.id}`,
    orgId,
    connectionId: eligible[0]!.id,
    status: "active",
    pausedReason: null,
    pausedAt: null,
    hasSession: true,
    sessionSavedAt: iso(today - 12 * DAY + 10 * HOUR),
    lastActionAt: null,
    warningsCount: 0,
    settings: { levels: ["light"] },
    createdAt: iso(today - 12 * DAY + 10 * HOUR),
    updatedAt: iso(today - 12 * DAY + 10 * HOUR),
  };
  const second: CloudAccount | null = eligible[1]
    ? { ...first, id: `cloud-${eligible[1].id}`, connectionId: eligible[1].id, status: "paused", pausedReason: "captcha", warningsCount: 1, sessionSavedAt: iso(today - 11 * DAY + 15 * HOUR), createdAt: iso(today - 11 * DAY + 15 * HOUR), updatedAt: iso(today - 11 * DAY + 15 * HOUR) }
    : null;

  const actions: CloudAction[] = [];
  for (let k = 0; k < 30; k++) {
    // Trois actions par jour, d'hier à il y a 10 jours.
    const createdAt = today - (Math.floor(k / 3) + 1) * DAY + SLOTS_UTC[k % 3]! * HOUR + Math.floor(rand() * 50) * 60_000;
    const onSecond = second !== null && k % 3 === 1;
    const account = onSecond ? second : first;
    const kind: CloudActionKind = k % 4 === 3 ? "follow_up" : "reply";
    const planned = plannedOutcome(k, onSecond);
    const ran = planned.status !== "skipped";
    const durationMs = ran ? 18_000 + Math.floor(rand() * 55_000) : undefined;
    const detail: CloudActionDetail = {
      conversationRef: `demo-${4100 + k * 7}`,
      ...(ran ? { messageLength: 40 + Math.floor(rand() * 180), durationMs } : {}),
      ...(planned.code ? { code: planned.code } : {}),
      ...(planned.reason ? { reason: planned.reason } : {}),
      ...(planned.sideEffects ? { sideEffects: planned.sideEffects } : {}),
      ...(planned.message ? { message: planned.message } : {}),
      ruleName: kind === "reply" ? "Réponse automatique" : "Relance après 24 h",
    };
    actions.push({
      id: `cloud-action-${String(30 - k).padStart(2, "0")}`,
      orgId,
      accountId: account.id,
      kind,
      level: CLOUD_ACTION_LEVEL_BY_KIND[kind],
      status: planned.status,
      detail,
      jobId: null,
      startedAt: ran ? iso(createdAt) : null,
      finishedAt: ran ? iso(createdAt + (durationMs ?? 0)) : iso(createdAt),
      createdAt: iso(createdAt),
    });
  }
  // Dernière action ouverte dans le navigateur, par compte ; la pause date du CAPTCHA.
  for (const acc of [first, second]) {
    if (!acc) continue;
    const latest = actions.find((a) => a.accountId === acc.id && a.status !== "skipped");
    acc.lastActionAt = latest?.createdAt ?? null;
    if (acc.status === "paused") {
      acc.pausedAt = latest?.finishedAt ?? latest?.createdAt ?? null;
      acc.updatedAt = acc.pausedAt ?? acc.updatedAt;
    }
  }
  return { consent: null, accounts: second ? [first, second] : [first], actions, logins: [] };
}
