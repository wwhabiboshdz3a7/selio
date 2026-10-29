import { z } from "zod";

/**
 * Types du socle Selio Cloud.
 *
 * Ce paquet ne touche ni à la base ni au chiffrement : il manipule un état de
 * stockage Playwright déjà filtré (cookies et stockage local des domaines
 * vinted.* seulement). Le chiffrement (SecretBox de @selio/db, clé
 * SECRETS_ENCRYPTION_KEY) et la persistance sont faits par l'appelant.
 *
 * Aucun type de ce fichier ne porte de mot de passe : le client se connecte
 * lui-même dans la fenêtre sécurisée (voir login-window.ts).
 */

/** Sortes d'actions que le Cloud sait exécuter. */
export const CLOUD_ACTION_KINDS = ["reply", "follow_up", "republish"] as const;
export type CloudActionKind = (typeof CLOUD_ACTION_KINDS)[number];

/**
 * Niveau d'une action. Au lancement, l'adresse IP est partagée entre les
 * comptes : seules les actions « légères » sont autorisées ; les « lourdes »
 * (republier, modifier en masse) restent derrière CLOUD_HEAVY_ACTIONS=false,
 * « à décider par Ibrahim ».
 */
export type CloudActionLevel = "light" | "heavy";

export const ACTION_LEVELS: Readonly<Record<CloudActionKind, CloudActionLevel>> = Object.freeze({
  reply: "light",
  follow_up: "light",
  republish: "heavy",
});

export function actionLevel(kind: CloudActionKind): CloudActionLevel {
  return ACTION_LEVELS[kind];
}

/** Action à exécuter dans le navigateur. Les champs servent à la corrélation, jamais à l'authentification. */
export type CloudAction =
  | { kind: "reply"; conversationUrl: string; text: string; id?: string }
  | { kind: "follow_up"; conversationUrl: string; text: string; id?: string }
  | { kind: "republish"; itemUrl: string; id?: string };

const httpUrl = z.string().url().max(2048);
const messageText = z.string().trim().min(1).max(2000);

/** Validation d'une action reçue d'une file ou d'un payload de job (donnée non fiable). */
export const cloudActionSchema: z.ZodType<CloudAction> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("reply"), conversationUrl: httpUrl, text: messageText, id: z.string().max(64).optional() }),
  z.object({ kind: z.literal("follow_up"), conversationUrl: httpUrl, text: messageText, id: z.string().max(64).optional() }),
  z.object({ kind: z.literal("republish"), itemUrl: httpUrl, id: z.string().max(64).optional() }),
]);

/** Cookie tel que renvoyé par `context.storageState()` de Playwright. */
export interface SessionCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Horodatage Unix en secondes ; -1 pour un cookie de session. */
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

export interface SessionOrigin {
  origin: string;
  localStorage: { name: string; value: string }[];
}

/**
 * État de stockage d'un navigateur (sous-ensemble du `storageState` Playwright).
 * Dans ce paquet, un `StorageState` est toujours passé par `filterStorageState`
 * avant d'être rendu à l'appelant.
 */
export interface StorageState {
  cookies: SessionCookie[];
  origins: SessionOrigin[];
}

/**
 * Session d'un compte Cloud, telle que l'appelant la stocke : l'état filtré,
 * chiffré hors de ce paquet (bytea `SecretBox`), et ce qu'on peut en dire
 * sans révéler de valeur.
 */
export interface CloudAccountSession {
  /** État filtré (vinted.* seulement), à chiffrer par l'appelant avant stockage. */
  storageState: StorageState;
  /** Date de capture (fin de la fenêtre de connexion ou dernière action). */
  capturedAt: Date;
}

/**
 * Codes d'échec d'une exécution. `unavailable` : aucun navigateur n'a pu être
 * lancé (créneaux occupés, Chromium absent ou qui plante au lancement) — rien
 * n'a touché Vinted, l'appelant remet la tâche en file sans la compter.
 */
export const RUN_FAILURE_CODES = ["blocked", "captcha", "warning", "rate_limited", "not_logged_in", "selector_missing", "timeout", "error", "unavailable"] as const;
export type RunFailureCode = (typeof RUN_FAILURE_CODES)[number];

/**
 * Codes qui mettent le compte en pause côté service, avec la raison, et
 * préviennent le client : rien n'est jamais retenté automatiquement.
 */
export const PAUSE_CODES: ReadonlySet<RunFailureCode> = new Set<RunFailureCode>(["blocked", "captcha", "warning", "rate_limited"]);

export function isPauseCode(code: RunFailureCode): boolean {
  return PAUSE_CODES.has(code);
}

export type RunOutcome =
  | { ok: true; detail: string; session: StorageState; durationMs?: number }
  | {
      ok: false;
      code: RunFailureCode;
      message: string;
      /** État filtré relu avant la fermeture quand c'était possible. */
      session?: StorageState;
      /**
       * `none` : rien n'a été envoyé (arrêt avant le clic). `unknown` : le clic a eu lieu
       * mais la confirmation manque — l'appelant ne doit pas renvoyer automatiquement.
       */
      sideEffects?: "none" | "unknown";
      /**
       * `false` : aucun navigateur n'a été lancé (refus avant lancement, aucun
       * créneau libre, lancement en échec). Rien n'a touché Vinted : l'action ne
       * compte pas dans les plafonds.
       */
      launched?: boolean;
      durationMs?: number;
    };

export interface RunInput {
  /** Session filtrée (déchiffrée par l'appelant) ou null pour un compte sans session. */
  session: StorageState | null;
  action: CloudAction;
  /** Dossier de profil Chromium dédié à cette exécution : temporaire, supprimé à la fin. */
  profileDir: string;
}

export interface OpenLoginWindowInput {
  /** Dossier de profil temporaire (supprimé à la fermeture de la fenêtre). */
  profileDir: string;
  /** URL de connexion ; par défaut `VINTED_LOGIN_URL` (vinted.ts). */
  loginUrl?: string;
  /** Expiration de la fenêtre (CLOUD_LOGIN_TIMEOUT_MS, 5 min par défaut). */
  timeoutMs?: number;
}

/** Image de la capture d'écran CDP (JPEG en base64) et ses dimensions. */
export interface ScreencastFrame {
  data: string;
  width: number;
  height: number;
  /** Horodatage de réception (ms epoch). */
  at: number;
}

/**
 * État d'une fenêtre de connexion. `refused` : le cadre principal est allé (ou
 * a été redirigé) hors des pages https de Vinted et des fournisseurs de
 * connexion — la fenêtre est fermée aussitôt, rien n'est enregistré.
 */
export type LoginWindowStatus = "open" | "finished" | "expired" | "cancelled" | "closed" | "refused";

/** Signal de Vinted vu dans la fenêtre de connexion (CAPTCHA, blocage, avertissement, trop de requêtes). */
export interface LoginBlockSignal {
  code: "captcha" | "rate_limited" | "blocked" | "warning";
  /** Identifiant du motif reconnu (diagnostic, aucune donnée de la page). */
  pattern: string;
}

/**
 * Fenêtre de connexion sécurisée vue par l'appelant (API / WebSocket) : le client
 * tape lui-même ses identifiants ; ce paquet ne les voit jamais ailleurs qu'en
 * événements d'entrée relayés tels quels au navigateur, sans journalisation.
 */
export interface LoginWindowApi {
  readonly id: string;
  readonly status: LoginWindowStatus;
  readonly expiresAt: Date;
  readonly viewport: { width: number; height: number };
  /** Abonne un récepteur d'images ; renvoie la fonction de désabonnement. */
  onFrame(cb: (frame: ScreencastFrame) => void): () => void;
  /** Prévient quand la fenêtre se ferme (fin, expiration, annulation). */
  onClose(cb: (status: LoginWindowStatus) => void): () => void;
  /** Relaie un événement souris ou clavier au navigateur. Jamais journalisé. */
  dispatchInput(event: LoginInputEvent): Promise<void>;
  isLoggedIn(): Promise<boolean>;
  /**
   * Signal de Vinted affiché dans la page (`detectBlock`, sans attendre de page
   * de membre), ou null. Sert uniquement à s'arrêter : sur un CAPTCHA pendant la
   * connexion, la fenêtre est fermée sans enregistrer de session.
   */
  blockSignal(): Promise<LoginBlockSignal | null>;
  /** Lit l'état filtré puis ferme tout (contexte, profil). */
  finish(): Promise<StorageState>;
  /** Ferme sans rien rendre. */
  cancel(): Promise<void>;
}

const coord = z.number().finite().min(0).max(16384);
const modifiers = z.number().int().min(0).max(15).optional();

/**
 * Événements d'entrée relayés par la fenêtre de connexion (donnée non fiable
 * venant du navigateur du client : validée, jamais journalisée).
 */
export const loginInputEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("mouse"),
    action: z.enum(["move", "down", "up", "wheel"]),
    x: coord,
    y: coord,
    button: z.enum(["none", "left", "middle", "right"]).optional(),
    clickCount: z.number().int().min(0).max(3).optional(),
    deltaX: z.number().finite().min(-4096).max(4096).optional(),
    deltaY: z.number().finite().min(-4096).max(4096).optional(),
    modifiers,
  }),
  z.object({
    type: z.literal("key"),
    action: z.enum(["down", "up"]),
    key: z.string().min(1).max(32),
    code: z.string().max(32).optional(),
    keyCode: z.number().int().min(0).max(255).optional(),
    /** Caractère produit (touche imprimable) ; absent pour Entrée, Tab, flèches… */
    text: z.string().max(8).optional(),
    modifiers,
  }),
  z.object({ type: z.literal("text"), text: z.string().min(1).max(256) }),
]);

export type LoginInputEvent = z.infer<typeof loginInputEventSchema>;

/** Exécuteur de navigateur : implémentation Playwright en production, `FakeRunner` dans les tests. */
export interface BrowserRunner {
  run(input: RunInput): Promise<RunOutcome>;
  openLoginWindow(input: OpenLoginWindowInput): Promise<LoginWindowApi>;
}

/** Journal minimal injectable (jamais de valeur de cookie, jamais d'événement clavier). */
export interface CloudLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
}

export const silentLogger: CloudLogger = { info: () => {}, warn: () => {} };
