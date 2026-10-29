/**
 * Protocole de la fenêtre de connexion sécurisée de Selio Cloud (navigateur du client ↔ API).
 *
 * Le client se connecte LUI-MÊME à Vinted dans un navigateur isolé sur notre machine. La page lui
 * parvient en images (JPEG) par un WebSocket ; ses clics et ses frappes repartent tels quels vers ce
 * navigateur. Rien de ce qui est tapé n'est gardé, affiché ni journalisé côté application : chaque
 * événement est construit, envoyé, puis oublié.
 *
 * Messages client → serveur : exactement les événements validés par `loginInputEventSchema`
 * (packages/cloud/src/types.ts) et `wsClientMessageSchema` (apps/api/src/cloud-relay.ts) — souris,
 * touche, texte inséré — plus `{ type: "cancel" }`.
 * Messages serveur → client (apps/api/src/routes/cloud.ts) : `ready` (WebSocket branchée, expiration),
 * `frame` (image JPEG en base64 et sa taille, ou un message binaire contenant le JPEG), `status`
 * (« starting », « open »), `done` (connexion détectée et session enregistrée), `closed` (fenêtre
 * fermée sans connexion, avec sa raison) et `error`.
 */

/** Bornes reprises du schéma serveur (packages/cloud/src/types.ts). */
export const MAX_COORD = 16_384;
export const MAX_WHEEL_DELTA = 4096;
export const MAX_TEXT_CHUNK = 256;
/** Texte collé : au-delà, le reste est ignoré (un identifiant tient largement dedans). */
export const MAX_PASTE_LENGTH = 2048;
/** Intervalle minimal entre deux déplacements de souris transmis (ms). */
export const MOUSE_MOVE_INTERVAL_MS = 50;
/** Taille maximale d'une image reçue en base64 (≈ 3 Mo de JPEG). */
const MAX_FRAME_BASE64 = 4_000_000;

export type MouseAction = "move" | "down" | "up" | "wheel";
export type MouseButton = "none" | "left" | "middle" | "right";

export interface LoginMouseEvent {
  type: "mouse";
  action: MouseAction;
  x: number;
  y: number;
  button?: MouseButton;
  clickCount?: number;
  deltaX?: number;
  deltaY?: number;
  modifiers?: number;
}

export interface LoginKeyEvent {
  type: "key";
  action: "down" | "up";
  key: string;
  code?: string;
  keyCode?: number;
  /** Caractère produit par une touche imprimable (absent pour Entrée seule, Tab, flèches…). */
  text?: string;
  modifiers?: number;
}

export interface LoginTextEvent {
  type: "text";
  text: string;
}

export type LoginInputEvent = LoginMouseEvent | LoginKeyEvent | LoginTextEvent;
export type LoginClientMessage = LoginInputEvent | { type: "cancel" };

/** Raisons d'une fenêtre fermée sans connexion (apps/api : `closed.reason`). */
export const LOGIN_CLOSED_REASONS = ["expired", "cancelled", "error", "no_session", "unavailable", "closed", "vinted_signal", "navigation_refused"] as const;
export type LoginClosedReason = (typeof LOGIN_CLOSED_REASONS)[number];

export const LOGIN_CLOSED_MESSAGES: Record<LoginClosedReason, string> = {
  expired: "La fenêtre a expiré : rien n'a été enregistré.",
  cancelled: "La fenêtre a été fermée : rien n'a été enregistré.",
  error: "La fenêtre de connexion a rencontré une erreur : rien n'a été enregistré.",
  no_session: "Aucune session Vinted détectée : connectez-vous dans la page avant de la fermer.",
  unavailable: "Le navigateur du Cloud est indisponible pour l'instant : réessayez dans quelques minutes.",
  closed: "La fenêtre de connexion a été fermée : rien n'a été enregistré.",
  vinted_signal:
    "Vinted a affiché une vérification (CAPTCHA), un avertissement ou un blocage pendant la connexion. Selio ne contourne jamais ces protections : la fenêtre a été fermée sans rien enregistrer et le compte est en pause. Vérifiez votre compte depuis votre navigateur habituel avant de reprendre.",
  navigation_refused: "La page a quitté Vinted : par sécurité, la fenêtre de connexion a été fermée sans rien enregistrer. Connectez-vous avec votre adresse e-mail et votre mot de passe Vinted.",
};

export type LoginServerMessage =
  | { type: "ready"; width?: number; height?: number; expiresAt?: string }
  | { type: "frame"; data: string; width?: number; height?: number }
  /** « starting » : Chromium démarre ; « open » : la page est prête ; « logged_in » : connexion détectée. */
  | { type: "status"; status: "starting" | "open" | "logged_in" }
  /** Connexion détectée, session filtrée, chiffrée et enregistrée : la fenêtre se ferme. */
  | { type: "done" }
  | { type: "closed"; reason: LoginClosedReason; message?: string }
  | { type: "error"; message: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const dim = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v > 0 && v <= MAX_COORD ? v : null);
const shortText = (v: unknown, max = 300): string | undefined => (typeof v === "string" ? v.slice(0, max) : undefined);

/**
 * Lit un message texte du serveur (donnée non fiable) : JSON connu seulement, sinon null. Un message
 * illisible est ignoré sans être recopié nulle part.
 */
export function parseServerMessage(raw: string): LoginServerMessage | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(v) || typeof v.type !== "string") return null;
  switch (v.type) {
    case "ready": {
      const width = dim(v.width);
      const height = dim(v.height);
      return { type: "ready", ...(width && height ? { width, height } : {}), ...(typeof v.expiresAt === "string" ? { expiresAt: v.expiresAt.slice(0, 40) } : {}) };
    }
    case "frame": {
      if (typeof v.data !== "string" || v.data.length === 0 || v.data.length > MAX_FRAME_BASE64 || !/^[A-Za-z0-9+/=]+$/.test(v.data)) return null;
      const width = dim(v.width);
      const height = dim(v.height);
      return { type: "frame", data: v.data, ...(width && height ? { width, height } : {}) };
    }
    case "status": {
      const status = (["starting", "open", "logged_in"] as const).find((x) => x === v.status);
      return status ? { type: "status", status } : null;
    }
    case "done":
      return { type: "done" };
    case "closed": {
      // `reason` (API) ; `status` accepté aussi. « finished » vaut « done ».
      const raw = typeof v.reason === "string" ? v.reason : v.status;
      if (raw === "finished") return { type: "done" };
      const reason = LOGIN_CLOSED_REASONS.find((x) => x === raw);
      if (!reason) return null;
      const message = shortText(v.message);
      return { type: "closed", reason, ...(message ? { message } : {}) };
    }
    case "error":
      return { type: "error", message: shortText(v.message) ?? "Erreur de la fenêtre de connexion." };
    default:
      return null;
  }
}

/** Masque des touches de modification au format CDP : Alt 1, Ctrl 2, Meta 4, Maj 8. */
export function modifiersOf(e: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }): number {
  return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/**
 * Point de l'écran local → point de la page distante. Le canvas affiche la page à l'échelle : on
 * ramène la position relative dans le canvas à la taille réelle de la page distante.
 */
export function toRemotePoint(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }, remote: { width: number; height: number }): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  const x = ((clientX - rect.left) / rect.width) * remote.width;
  const y = ((clientY - rect.top) / rect.height) * remote.height;
  return { x: Math.round(clamp(x, 0, Math.max(0, remote.width - 1))), y: Math.round(clamp(y, 0, Math.max(0, remote.height - 1))) };
}

const BUTTONS: Record<number, MouseButton> = { 0: "left", 1: "middle", 2: "right" };

export function mouseButtonOf(button: number): MouseButton {
  return BUTTONS[button] ?? "none";
}

export function mouseMessage(action: Exclude<MouseAction, "wheel">, point: { x: number; y: number }, e: { button?: number; detail?: number; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }): LoginMouseEvent {
  const pressing = action === "down" || action === "up";
  return {
    type: "mouse",
    action,
    x: point.x,
    y: point.y,
    button: pressing ? mouseButtonOf(e.button ?? 0) : "none",
    clickCount: pressing ? clamp(e.detail && e.detail > 0 ? e.detail : 1, 1, 3) : 0,
    modifiers: modifiersOf(e),
  };
}

export function wheelMessage(point: { x: number; y: number }, e: { deltaX: number; deltaY: number; deltaMode?: number; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }): LoginMouseEvent {
  // deltaMode 1 = lignes, 2 = pages : ramenés en pixels.
  const factor = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 600 : 1;
  const d = (v: number) => Math.round(clamp((Number.isFinite(v) ? v : 0) * factor, -MAX_WHEEL_DELTA, MAX_WHEEL_DELTA));
  return { type: "mouse", action: "wheel", x: point.x, y: point.y, deltaX: d(e.deltaX), deltaY: d(e.deltaY), modifiers: modifiersOf(e) };
}

/** Touche dont la valeur n'est pas fiable (clavier virtuel Android, composition) : le texte arrive par `input`. */
export function isCompositionKey(e: { key: string; keyCode?: number; isComposing?: boolean }): boolean {
  return e.isComposing === true || e.key === "Unidentified" || e.key === "Process" || e.keyCode === 229;
}

/**
 * Raccourci de collage : laissé au navigateur local, qui émet `paste` ; le texte collé part alors en
 * `insertText`. Transmettre Ctrl+V collerait le presse-papiers (vide) de la machine distante.
 */
export function isPasteShortcut(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }): boolean {
  return (e.ctrlKey || e.metaKey) === true && e.key.toLowerCase() === "v";
}

/**
 * Événement clavier → message. Pour une touche imprimable sans Ctrl ni Cmd, le caractère est
 * envoyé avec la touche (Chromium l'insère) ; Entrée porte « \r » pour valider un formulaire.
 * Renvoie null pour ce qui ne doit pas partir (composition, collage, touche inconnue).
 */
export function keyMessage(action: "down" | "up", e: { key: string; code?: string; keyCode?: number; isComposing?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }): LoginKeyEvent | null {
  if (!e.key || e.key.length > 32 || isCompositionKey(e) || isPasteShortcut(e)) return null;
  const printable = [...e.key].length === 1 && !e.ctrlKey && !e.metaKey;
  const text = action === "down" ? (printable ? e.key : e.key === "Enter" ? "\r" : undefined) : undefined;
  const keyCode = typeof e.keyCode === "number" && e.keyCode > 0 && e.keyCode <= 255 ? e.keyCode : undefined;
  return {
    type: "key",
    action,
    key: e.key,
    ...(e.code ? { code: e.code.slice(0, 32) } : {}),
    ...(keyCode !== undefined ? { keyCode } : {}),
    ...(text !== undefined ? { text } : {}),
    modifiers: modifiersOf(e),
  };
}

/** Texte collé ou saisi par un clavier virtuel → messages `text` de 256 caractères au plus. */
export function textMessages(text: string): LoginTextEvent[] {
  const chars = [...text.slice(0, MAX_PASTE_LENGTH)];
  const out: LoginTextEvent[] = [];
  for (let i = 0; i < chars.length; i += MAX_TEXT_CHUNK) out.push({ type: "text", text: chars.slice(i, i + MAX_TEXT_CHUNK).join("") });
  return out.filter((m) => m.text.length > 0);
}

/**
 * Limiteur de cadence pour les déplacements de souris : au plus un envoi par intervalle, et le
 * dernier point est toujours envoyé (front descendant) pour que le curseur distant s'arrête au bon
 * endroit.
 */
export function createThrottle<T>(send: (value: T) => void, intervalMs = MOUSE_MOVE_INTERVAL_MS, now: () => number = () => Date.now()) {
  let last = -Infinity;
  let pending: { value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    if (!pending) return;
    const { value } = pending;
    pending = null;
    last = now();
    send(value);
  };
  return {
    push(value: T) {
      const elapsed = now() - last;
      if (elapsed >= intervalMs && !timer) {
        last = now();
        send(value);
        return;
      }
      pending = { value };
      if (!timer) timer = setTimeout(flush, Math.max(0, intervalMs - elapsed));
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}

/** Adresse WebSocket de la fenêtre (ws:// ou wss:// selon l'adresse de l'API). Le ticket n'est jamais affiché. */
export function loginSocketUrl(apiBaseUrl: string, loginSessionId: string, ticket: string, pageHref: string): string {
  const path = `${apiBaseUrl}/api/cloud/login/${encodeURIComponent(loginSessionId)}/ws`;
  let url: URL;
  try {
    url = new URL(path, pageHref);
  } catch {
    // Page sans adresse exploitable (about:blank) : hôte local par défaut.
    url = new URL(path, "http://localhost/");
  }
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("ticket", ticket);
  return url.toString();
}

/** Temps restant « m:ss » avant l'expiration de la fenêtre. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
