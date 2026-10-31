import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "playwright-core";
import { CLOUD_DEFAULTS } from "./config";
import { LoginInputError, LoginWindowClosedError } from "./errors";
import { detectBlock } from "./guard";
import { prepareProfileDir, removeProfileDir } from "./profile";
import { DEFAULT_VIEWPORT, contextOptions, launchOptions } from "./runner/launch";
import { filterStorageState, isVintedDomain } from "./session";
import type { BrowserSlots } from "./slots";
import {
  loginInputEventSchema,
  silentLogger,
  type CloudLogger,
  type LoginBlockSignal,
  type LoginInputEvent,
  type LoginWindowApi,
  type LoginWindowStatus,
  type ScreencastFrame,
  type StorageState,
} from "./types";
import { MEMBER_MENU_SELECTORS, VINTED_LOGIN_URL, VINTED_SESSION_COOKIE_NAMES, isAllowedLoginNavigation, isAllowedLoginUrl, isLocalOrPrivateHost, isLoginPath } from "./vinted";

/**
 * Fenêtre de connexion sécurisée.
 *
 * Le client se connecte LUI-MÊME à Vinted dans un navigateur isolé sur notre
 * machine : il voit la page sous forme d'images (capture d'écran CDP, JPEG
 * qualité 60, 2 à 4 images par seconde) et ses clics et frappes sont relayés au
 * navigateur. Son mot de passe n'est ni lu, ni stocké, ni journalisé : les
 * événements clavier sont transmis tels quels à Chromium et jamais écrits nulle
 * part (pas de journal, pas de message d'erreur qui les cite). À la fin, seule
 * la session filtrée (cookies et stockage local vinted.*, sans cookie de
 * passage anti-robot) est rendue, puis tout est refermé et le dossier de
 * travail temporaire supprimé.
 *
 * Garde-fous :
 * - le cadre principal ne va que sur une page https de Vinted ou d'un
 *   fournisseur de connexion : la première requête est filtrée (`route`), et
 *   chaque étape de redirection ainsi que chaque page affichée sont revérifiées
 *   (le filtre `route` ne voit pas les redirections) ; au moindre écart, la
 *   fenêtre est fermée (« refused ») ;
 * - aucune requête vers la machine elle-même ou le réseau local ;
 * - un CAPTCHA, un blocage, un avertissement ou « trop de requêtes » de Vinted
 *   pendant la connexion est rendu par `blockSignal()` : l'appelant ferme la
 *   fenêtre sans enregistrer de session.
 */

/** Session CDP minimale (celle de Playwright en production, un faux dans les tests). */
export interface CdpLike {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: string, listener: (payload: unknown) => void): void;
  off(event: string, listener: (payload: unknown) => void): void;
  detach(): Promise<void>;
}

export interface LoginPageLike {
  url(): string;
  isVisible(selector: string): Promise<boolean>;
  /** HTML de la page (détection des signaux de Vinted, jamais journalisé). */
  content(): Promise<string>;
}

export interface LoginContextLike {
  cookies(): Promise<{ name: string; value: string; domain: string }[]>;
  storageState(): Promise<unknown>;
  close(): Promise<void>;
}

export interface LoginWindowParts {
  page: LoginPageLike;
  context: LoginContextLike;
  cdp: CdpLike;
  viewport: { width: number; height: number };
  timeoutMs?: number;
  /** Images par seconde au plus (borné entre 2 et 4 ; 3 par défaut). */
  maxFps?: number;
  id?: string;
  now?: () => Date;
  logger?: CloudLogger;
  /** Nettoyage après fermeture (profil temporaire, créneau de navigateur). */
  onDispose?: () => Promise<void> | void;
}

export { LoginInputError, LoginWindowClosedError };

export const SCREENCAST_QUALITY = 60;
export const MIN_FPS = 2;
export const MAX_FPS = 4;

interface FramePayload {
  data: string;
  sessionId: number;
  metadata?: { deviceWidth?: number; deviceHeight?: number };
}

function isFramePayload(p: unknown): p is FramePayload {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  return typeof o.data === "string" && typeof o.sessionId === "number";
}

const MOUSE_TYPES = { move: "mouseMoved", down: "mousePressed", up: "mouseReleased", wheel: "mouseWheel" } as const;

/** Traduit un événement validé en commande CDP `Input.*` (exporté pour les tests). */
export function toCdpInput(e: LoginInputEvent): { method: string; params: Record<string, unknown> } {
  if (e.type === "mouse") {
    const pressing = e.action === "down" || e.action === "up";
    return {
      method: "Input.dispatchMouseEvent",
      params: {
        type: MOUSE_TYPES[e.action],
        x: e.x,
        y: e.y,
        button: e.button ?? (pressing ? "left" : "none"),
        clickCount: e.clickCount ?? (pressing ? 1 : 0),
        modifiers: e.modifiers ?? 0,
        ...(e.action === "wheel" ? { deltaX: e.deltaX ?? 0, deltaY: e.deltaY ?? 0 } : {}),
      },
    };
  }
  if (e.type === "key") {
    const type = e.action === "up" ? "keyUp" : e.text ? "keyDown" : "rawKeyDown";
    return {
      method: "Input.dispatchKeyEvent",
      params: {
        type,
        key: e.key,
        ...(e.code ? { code: e.code } : {}),
        ...(e.keyCode !== undefined ? { windowsVirtualKeyCode: e.keyCode, nativeVirtualKeyCode: e.keyCode } : {}),
        ...(e.action === "down" && e.text ? { text: e.text, unmodifiedText: e.text } : {}),
        modifiers: e.modifiers ?? 0,
      },
    };
  }
  return { method: "Input.insertText", params: { text: e.text } };
}

export class LoginWindow implements LoginWindowApi {
  readonly id: string;
  readonly expiresAt: Date;
  readonly viewport: { width: number; height: number };
  private state: LoginWindowStatus = "open";
  private readonly page: LoginPageLike;
  private readonly context: LoginContextLike;
  private readonly cdp: CdpLike;
  private readonly minIntervalMs: number;
  private readonly now: () => Date;
  private readonly logger: CloudLogger;
  private readonly onDispose: (() => Promise<void> | void) | undefined;
  private readonly frameListeners = new Set<(f: ScreencastFrame) => void>();
  private readonly closeListeners = new Set<(s: LoginWindowStatus) => void>();
  private readonly ackTimers = new Set<ReturnType<typeof setTimeout>>();
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFrameAt = 0;
  private started = false;
  private closing: Promise<void> | null = null;
  private readonly frameHandler = (payload: unknown) => this.handleFrame(payload);

  constructor(parts: LoginWindowParts) {
    this.id = parts.id ?? randomUUID();
    this.page = parts.page;
    this.context = parts.context;
    this.cdp = parts.cdp;
    this.viewport = { ...parts.viewport };
    this.now = parts.now ?? (() => new Date());
    this.logger = parts.logger ?? silentLogger;
    this.onDispose = parts.onDispose;
    const fps = Math.min(MAX_FPS, Math.max(MIN_FPS, parts.maxFps ?? 3));
    this.minIntervalMs = Math.round(1000 / fps);
    const timeoutMs = Math.max(1_000, parts.timeoutMs ?? CLOUD_DEFAULTS.loginTimeoutMs);
    this.expiresAt = new Date(this.now().getTime() + timeoutMs);
    this.expiryTimer = setTimeout(() => void this.close("expired"), timeoutMs);
    this.expiryTimer.unref?.();
  }

  get status(): LoginWindowStatus {
    return this.state;
  }

  /** Démarre la capture d'écran (Page.startScreencast). */
  async start(): Promise<void> {
    if (this.started || this.state !== "open") return;
    this.started = true;
    this.cdp.on("Page.screencastFrame", this.frameHandler);
    await this.cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: SCREENCAST_QUALITY,
      maxWidth: this.viewport.width,
      maxHeight: this.viewport.height,
      everyNthFrame: 1,
    });
    this.logger.info("cloud.login.open", { id: this.id });
  }

  /**
   * Chaque image est transmise puis acquittée ; l'acquittement est retardé pour
   * ne pas dépasser `maxFps` (Chromium n'envoie l'image suivante qu'après lui).
   */
  private handleFrame(payload: unknown): void {
    if (this.state !== "open" || !isFramePayload(payload)) return;
    const at = this.now().getTime();
    const frame: ScreencastFrame = {
      data: payload.data,
      width: payload.metadata?.deviceWidth ?? this.viewport.width,
      height: payload.metadata?.deviceHeight ?? this.viewport.height,
      at,
    };
    for (const cb of this.frameListeners) {
      try {
        cb(frame);
      } catch {
        // un récepteur défaillant ne doit pas bloquer les autres
      }
    }
    const wait = Math.max(0, this.minIntervalMs - (at - this.lastFrameAt));
    this.lastFrameAt = at + wait;
    const ack = () => {
      if (this.state === "open") void this.cdp.send("Page.screencastFrameAck", { sessionId: payload.sessionId }).catch(() => {});
    };
    if (wait === 0) {
      ack();
      return;
    }
    const t = setTimeout(() => {
      this.ackTimers.delete(t);
      ack();
    }, wait);
    this.ackTimers.add(t);
  }

  onFrame(cb: (frame: ScreencastFrame) => void): () => void {
    this.frameListeners.add(cb);
    return () => {
      this.frameListeners.delete(cb);
    };
  }

  onClose(cb: (status: LoginWindowStatus) => void): () => void {
    this.closeListeners.add(cb);
    return () => {
      this.closeListeners.delete(cb);
    };
  }

  /**
   * Relaie un événement souris ou clavier. Validé (donnée non fiable), jamais
   * journalisé ; une erreur ne cite jamais l'événement.
   */
  async dispatchInput(event: LoginInputEvent | unknown): Promise<void> {
    if (this.state !== "open") throw new LoginWindowClosedError();
    const parsed = loginInputEventSchema.safeParse(event);
    if (!parsed.success) throw new LoginInputError();
    const { method, params } = toCdpInput(parsed.data);
    try {
      await this.cdp.send(method, params);
    } catch {
      throw new LoginInputError("Le navigateur a refusé l'entrée.");
    }
  }

  /**
   * Connecté si la page est sur Vinted hors des pages de connexion et
   * d'inscription, et que le menu membre est visible ou qu'un cookie de session
   * Vinted est présent (sélecteurs et noms à valider en réel).
   */
  async isLoggedIn(): Promise<boolean> {
    if (this.state !== "open") return false;
    let url: URL;
    try {
      url = new URL(this.page.url());
    } catch {
      return false;
    }
    if (url.protocol !== "https:" || !isVintedDomain(url.hostname) || isLoginPath(url.pathname)) return false;
    for (const selector of MEMBER_MENU_SELECTORS) {
      if (await this.page.isVisible(selector).catch(() => false)) return true;
    }
    const cookies = await this.context.cookies().catch(() => []);
    return cookies.some((c) => isVintedDomain(c.domain) && VINTED_SESSION_COOKIE_NAMES.includes(c.name) && c.value.length > 0);
  }

  /**
   * Signal de Vinted affiché (CAPTCHA, blocage, avertissement, trop de requêtes), sans attendre de
   * page de membre. Sert uniquement à s'arrêter ; le contenu de la page n'est ni gardé ni journalisé.
   */
  async blockSignal(): Promise<LoginBlockSignal | null> {
    if (this.state !== "open") return null;
    let html: string;
    try {
      html = await this.page.content();
    } catch {
      return null;
    }
    const s = detectBlock(html, this.page.url(), { expectMember: false });
    if (!s || s.code === "not_logged_in") return null;
    return { code: s.code, pattern: s.pattern };
  }

  /** Lit la session, la filtre (vinted.* seulement), puis ferme tout. */
  async finish(): Promise<StorageState> {
    if (this.state !== "open") throw new LoginWindowClosedError();
    let state: StorageState;
    try {
      state = filterStorageState((await this.context.storageState()) as Record<string, unknown>);
    } finally {
      await this.close("finished");
    }
    return state;
  }

  async cancel(): Promise<void> {
    await this.close("cancelled");
  }

  /** Fermeture idempotente : capture arrêtée, contexte fermé, profil supprimé, récepteurs prévenus. */
  close(status: Exclude<LoginWindowStatus, "open"> = "closed"): Promise<void> {
    if (this.closing) return this.closing;
    this.state = status;
    this.closing = (async () => {
      if (this.expiryTimer) clearTimeout(this.expiryTimer);
      for (const t of this.ackTimers) clearTimeout(t);
      this.ackTimers.clear();
      this.cdp.off("Page.screencastFrame", this.frameHandler);
      await this.cdp.send("Page.stopScreencast").catch(() => {});
      await this.cdp.detach().catch(() => {});
      await this.context.close().catch(() => {});
      try {
        await this.onDispose?.();
      } catch {
        // nettoyage au mieux
      }
      this.frameListeners.clear();
      this.logger.info("cloud.login.closed", { id: this.id, status });
      for (const cb of this.closeListeners) {
        try {
          cb(status);
        } catch {
          // idem
        }
      }
      this.closeListeners.clear();
    })();
    return this.closing;
  }
}

export interface LaunchLoginWindowOptions {
  chromiumPath: string;
  headless?: boolean;
  /** Dossier de travail temporaire (HOME, TMPDIR de Chromium), supprimé à la fermeture. */
  profileDir: string;
  /** Bac à sable de Chromium (vrai par défaut). */
  sandbox?: boolean;
  sourceEnv?: Record<string, string | undefined>;
  loginUrl?: string;
  timeoutMs?: number;
  viewport?: { width: number; height: number };
  maxFps?: number;
  slots?: BrowserSlots;
  logger?: CloudLogger;
}

/**
 * Adapte les objets Playwright aux interfaces de `LoginWindow` (exporté pour le test d'intégration).
 * Fermer la fenêtre ferme le contexte puis le navigateur.
 */
export function loginPartsFromPlaywright(context: BrowserContext, page: Page, cdp: CDPSession, browser?: Browser | null): Pick<LoginWindowParts, "page" | "context" | "cdp"> {
  return {
    page: { url: () => page.url(), isVisible: (selector) => page.locator(selector).first().isVisible(), content: () => page.content() },
    context: {
      cookies: () => context.cookies(),
      storageState: () => context.storageState(),
      close: async () => {
        await context.close().catch(() => {});
        await browser?.close().catch(() => {});
      },
    },
    cdp: {
      send: (method, params) => cdp.send(method as never, params as never) as Promise<unknown>,
      on: (event, listener) => {
        cdp.on(event as never, listener as never);
      },
      off: (event, listener) => {
        cdp.off(event as never, listener as never);
      },
      detach: () => cdp.detach(),
    },
  };
}

export interface LoginNavigationGuard {
  /** Adresse acceptée pour une navigation du cadre principal (première requête ou étape de redirection). */
  isAllowedUrl(url: string): boolean;
  /** Page acceptée une fois affichée dans le cadre principal (about:blank et page d'erreur comprises). */
  isAllowedPage(url: string): boolean;
  /** Hôte jamais joint, quel que soit le cadre (machine, réseau local). */
  isBlockedHost(hostname: string): boolean;
  /** Écart constaté (redirection ou page hors liste) : la fenêtre doit être fermée. */
  onViolation(): void;
}

/**
 * Garde de navigation de la fenêtre de connexion (exportée pour le test d'intégration) :
 * - `route` refuse la première requête d'une navigation hors liste et toute requête vers un hôte
 *   bloqué (la page reste où elle était) ;
 * - `route` ne voit pas les étapes d'une redirection HTTP : chaque requête de navigation du cadre
 *   principal issue d'une redirection est revérifiée à l'événement `request` ;
 * - dernier filet, chaque page affichée dans le cadre principal est revérifiée (`framenavigated`).
 * Un écart appelle `onViolation` (la fenêtre est fermée, rien n'est enregistré).
 */
export async function installLoginNavigationGuard(context: BrowserContext, page: Page, guard: LoginNavigationGuard): Promise<void> {
  await context.route("**/*", async (route) => {
    const req = route.request();
    let host = "";
    try {
      host = new URL(req.url()).hostname;
    } catch {
      host = "";
    }
    if (host !== "" && guard.isBlockedHost(host)) {
      await route.abort("blockedbyclient");
      return;
    }
    if (req.isNavigationRequest() && req.frame().parentFrame() === null && !guard.isAllowedUrl(req.url())) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  context.on("request", (req) => {
    try {
      if (!req.redirectedFrom() || !req.isNavigationRequest() || req.frame() !== page.mainFrame()) return;
      let host = "";
      try {
        host = new URL(req.url()).hostname;
      } catch {
        host = "";
      }
      if (!guard.isAllowedUrl(req.url()) || (host !== "" && guard.isBlockedHost(host))) guard.onViolation();
    } catch {
      // requête sans cadre (travailleur de service) : hors du cadre principal
    }
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame() && !guard.isAllowedPage(frame.url())) guard.onViolation();
  });
}

/**
 * Ouvre une vraie fenêtre de connexion : Chromium neuf (bac à sable actif,
 * environnement minimal), contexte sans enregistrement sur le disque, sans
 * session ; le cadre principal ne peut naviguer que vers une page https de
 * Vinted ou d'un fournisseur de connexion proposé par Vinted, redirections
 * comprises ; aucune requête vers la machine ou le réseau local ; les fenêtres
 * surgissantes sont refermées (elles ne seraient pas visibles du client).
 */
export async function launchLoginWindow(options: LaunchLoginWindowOptions): Promise<LoginWindow> {
  const loginUrl = new URL(options.loginUrl ?? VINTED_LOGIN_URL);
  if (!isAllowedLoginUrl(loginUrl.toString()) || !isVintedDomain(loginUrl.hostname)) throw new Error("URL de connexion refusée : seule une page https de Vinted est acceptée.");
  const viewport = options.viewport ?? { ...DEFAULT_VIEWPORT };
  const timeoutMs = options.timeoutMs ?? CLOUD_DEFAULTS.loginTimeoutMs;
  await prepareProfileDir(options.profileDir);
  let release: (() => void) | null = null;
  let browser: Browser | null = null;
  const cleanup = async () => {
    await browser?.close().catch(() => {});
    await removeProfileDir(options.profileDir).catch(() => {});
    release?.();
    release = null;
  };
  try {
    await mkdir(join(options.profileDir, "artifacts"), { mode: 0o700 });
    release = options.slots ? await options.slots.acquire(30_000) : null;
    browser = await chromium.launch(
      launchOptions({ chromiumPath: options.chromiumPath, headless: options.headless ?? true, timeoutMs: 30_000, sandbox: options.sandbox ?? true, workDir: options.profileDir, sourceEnv: options.sourceEnv }),
    );
    const context = await browser.newContext(contextOptions(viewport));
    const page = await context.newPage();
    let win: LoginWindow | null = null;
    let violation = false;
    await installLoginNavigationGuard(context, page, {
      isAllowedUrl: isAllowedLoginUrl,
      isAllowedPage: isAllowedLoginNavigation,
      isBlockedHost: isLocalOrPrivateHost,
      onViolation: () => {
        violation = true;
        if (win) void win.close("refused");
      },
    });
    context.on("page", (p) => {
      if (p !== page) void p.close().catch(() => {});
    });
    await page.goto(loginUrl.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (violation) throw new Error("Navigation refusée : la page de connexion a redirigé hors de Vinted.");
    const cdp = await context.newCDPSession(page);
    const launched = browser;
    win = new LoginWindow({
      ...loginPartsFromPlaywright(context, page, cdp, launched),
      viewport,
      timeoutMs,
      maxFps: options.maxFps,
      logger: options.logger,
      onDispose: cleanup,
    });
    await win.start();
    return win;
  } catch (err) {
    await cleanup();
    throw err;
  }
}
