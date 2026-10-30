import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, errors as pwErrors, type Browser, type BrowserContext, type ElementHandle, type JSHandle, type Locator, type Page } from "playwright-core";
import type { CapturedConversation } from "@selio/connectors/vinted-adapter";
import { CLOUD_DEFAULTS } from "../config";
import { detectBlock, type BlockSignal, type DetectOptions } from "../guard";
import { launchLoginWindow } from "../login-window";
import { createProfileDir, discardEmptyProfileDir, prepareProfileDir, removeProfileDir } from "../profile";
import {
  TargetRefusedError,
  type BrowsingPage,
  type BrowsingSession,
  type ClickTarget,
  type FetchPageInput,
  type FetchPageOutcome,
  type OpenBrowsingInput,
  type OpenBrowsingOutcome,
  type PageFetcher,
  type PageOpener,
  type RadarPageKind,
} from "../radar/types";
import { isRadarOrigin, resolveRadarUrl } from "../radar/urls";
import { filterStorageState, isSessionEmpty, isVintedDomain } from "../session";
import { BrowserSlots, BrowserSlotTimeoutError } from "../slots";
import {
  actionLevel,
  cloudActionSchema,
  silentLogger,
  type BrowserRunner,
  type CloudAction,
  type CloudLogger,
  type LoginWindowApi,
  type OpenLoginWindowInput,
  type RunFailureCode,
  type RunInput,
  type RunOutcome,
  type SessionOrigin,
  type StorageState,
} from "../types";
import {
  COMPOSER_SELECTORS,
  REPUBLISH_BUTTON_NAME,
  REPUBLISH_BUTTON_SELECTORS,
  SEND_BUTTON_IN_FORM,
  SEND_BUTTON_NAME,
  VINTED_BASE_URL,
  VINTED_LOGIN_URL,
  detectPage,
  parseConversationPage,
} from "../vinted";
import { InvalidSelectorError, readLiveDom, type DomHandle } from "./dom-bridge";
import { DEFAULT_VIEWPORT, contextOptions, launchOptions } from "./launch";

/**
 * Exécuteur Playwright du Cloud.
 *
 * Pour chaque action : un navigateur Chromium neuf (bac à sable actif,
 * environnement minimal), un contexte de navigation sans enregistrement sur le
 * disque (la session ne vit qu'en mémoire), la session filtrée du compte
 * injectée (cookies et stockage local vinted.* seulement, jamais de cookie de
 * passage anti-robot), l'action faite avec les sélecteurs de l'adaptateur
 * Vinted, la session relue et filtrée, puis tout est refermé et le dossier de
 * travail temporaire supprimé. Aucun processus ne reste ouvert entre deux
 * actions.
 *
 * Aucune furtivité : pas de plugin « stealth », pas d'option qui masque
 * l'automatisation, pas de User-Agent ni d'empreinte modifiés, pas de
 * résolution de CAPTCHA. Au moindre signal de Vinted (`detectBlock`), on
 * s'arrête et on rend le code : le service met le compte en pause.
 *
 * Selio Radar passe par le même lancement (`BrowserLease` : créneau partagé,
 * dossier de travail, minuterie, Chromium, contexte, session injectée) :
 * - `fetchPage` lit une page catalogue ou annonce (HTML) puis referme tout,
 *   sans aucune action sur la page ;
 * - `openBrowsing` tient un navigateur ouvert le temps d'un achat (Radar Auto,
 *   désactivé par défaut) : aller à une annonce, lire, cliquer sur un bouton
 *   nommé, lire l'état d'une case. Aucune méthode n'écrit de texte.
 */

export interface PlaywrightRunnerOptions {
  /** Exécutable Chromium (CLOUD_CHROMIUM_PATH). Aucun navigateur n'est téléchargé. */
  chromiumPath: string;
  headless?: boolean;
  slowMo?: number;
  /** Origine des pages Vinted (défaut https://www.vinted.fr) ; un test l'injecte vers un serveur local. */
  baseUrl?: string;
  /** Durée maximale d'une action, navigateur compris (CLOUD_ACTION_TIMEOUT_MS). */
  actionTimeoutMs?: number;
  /** Délai par étape (navigation, attente d'un élément). */
  stepTimeoutMs?: number;
  /** Attente de l'apparition du message envoyé. */
  confirmTimeoutMs?: number;
  /** Expiration de la fenêtre de connexion (CLOUD_LOGIN_TIMEOUT_MS). */
  loginTimeoutMs?: number;
  loginUrl?: string;
  /** Navigateurs simultanés (CLOUD_MAX_BROWSERS) ou créneaux partagés avec d'autres exécuteurs. */
  maxBrowsers?: number | BrowserSlots;
  /**
   * Dossier sous lequel `fetchPage` et `openBrowsing` créent leur dossier de travail quand
   * l'appelant n'en fournit pas (CLOUD_PROFILE_DIR ; dossier temporaire du système par défaut).
   */
  profileBaseDir?: string;
  /** Durée de vie maximale d'une navigation d'achat, attente 3-D Secure comprise (30 min par défaut). */
  maxBrowsingMs?: number;
  /** Actions lourdes (CLOUD_HEAVY_ACTIONS) : refusées par défaut, en plus du contrôle du service. */
  heavyActions?: boolean;
  /**
   * Bac à sable de Chromium (vrai par défaut). Faux seulement en développement
   * (CLOUD_CHROMIUM_SANDBOX=false, refusé en production par le worker).
   */
  sandbox?: boolean;
  /** Environnement source filtré par la liste blanche (process.env par défaut ; injecté par les tests). */
  sourceEnv?: Record<string, string | undefined>;
  /** Attente d'un créneau de navigateur avant de renoncer (« unavailable », tâche remise en file). */
  slotWaitMs?: number;
  viewport?: { width: number; height: number };
  logger?: CloudLogger;
}

/** Poignée Playwright vue comme un `DomHandle` du pont (lecture seule). */
export function playwrightHandle(h: JSHandle<Element | Document> | ElementHandle<Element>): DomHandle {
  const handle = h as JSHandle<Element | Document>;
  return {
    textContent: () => handle.evaluate((n) => n.textContent),
    getAttribute: (name) => handle.evaluate((n, a) => (n instanceof Element ? n.getAttribute(a) : null), name),
    querySelector: async (selector) => {
      const r = await handle.evaluateHandle((n, s) => {
        try {
          return n.querySelector(s);
        } catch {
          return false;
        }
      }, selector);
      const el = r.asElement();
      if (el) return playwrightHandle(el as ElementHandle<Element>);
      const v = await r.jsonValue();
      await r.dispose();
      if (v === false) throw new InvalidSelectorError();
      return null;
    },
    querySelectorAll: async (selector) => {
      const r = await handle.evaluateHandle((n, s) => {
        try {
          return Array.from(n.querySelectorAll(s));
        } catch {
          return false;
        }
      }, selector);
      const props = await r.getProperties();
      if (props.size === 0 && (await r.jsonValue()) === false) {
        await r.dispose();
        throw new InvalidSelectorError();
      }
      const out = [...props.entries()]
        .filter(([k]) => /^\d+$/.test(k))
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([, v]) => v.asElement())
        .filter((e): e is ElementHandle<Node> => e !== null)
        .map((e) => playwrightHandle(e as ElementHandle<Element>));
      await r.dispose();
      return out;
    },
    dispose: () => handle.dispose(),
  };
}

/** Lit la conversation affichée avec l'adaptateur v1 (via le pont DOM). */
export async function readConversation(page: Page) {
  const doc = await page.evaluateHandle(() => document);
  try {
    return await readLiveDom(playwrightHandle(doc), (d) => parseConversationPage(d, page.url()), { title: await page.title() });
  } finally {
    await doc.dispose().catch(() => {});
  }
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** Nombre de messages sortants dont le corps est le texte envoyé. */
export function countSentCopies(conversation: CapturedConversation | null, text: string): number {
  if (!conversation) return 0;
  const wanted = collapse(text);
  return conversation.messages.filter((m) => m.direction === "outbound" && collapse(m.body) === wanted).length;
}

type Step = { clicked: boolean };
type Failure = { ok: false; code: RunFailureCode; message: string; sideEffects: "none" | "unknown"; launched?: boolean };
type Success = { ok: true; detail: string };

function failure(code: RunFailureCode, message: string, sideEffects: "none" | "unknown" = "none"): Failure {
  return { ok: false, code, message, sideEffects };
}

/** Échec sans navigateur lancé : rien n'a touché Vinted (l'appelant ne compte pas l'action). */
function notLaunched(code: RunFailureCode, message: string): Failure {
  return { ok: false, code, message, sideEffects: "none", launched: false };
}

/** Page vue par `blockAfterError` (sous-ensemble de `Page`, simulé dans les tests). */
export interface BlockCheckPage {
  waitForLoadState(state: "domcontentloaded", options: { timeout: number }): Promise<void>;
  content(): Promise<string>;
  url(): string;
}

/**
 * Après une exception pendant l'action (navigation en cours, élément masqué par
 * un calque, délai d'une étape), relit la page avant de conclure « erreur » :
 * Vinted a pu rediriger vers une page de vérification ou afficher un CAPTCHA
 * par-dessus le bouton. Un signal trouvé est rendu tel quel (pause du compte,
 * rien n'est retenté). Ne lève jamais.
 */
export async function blockAfterError(page: BlockCheckPage, waitMs = 5_000, options: DetectOptions = {}): Promise<BlockSignal | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.waitForLoadState("domcontentloaded", { timeout: waitMs }).catch(() => {});
    try {
      return detectBlock(await page.content(), page.url(), options);
    } catch {
      // page encore en navigation : une seconde lecture après le chargement
    }
  }
  return null;
}

/**
 * Un navigateur loué pour une exécution : créneau, dossier de travail, minuterie, Chromium, puis
 * contexte et page. Fermeture idempotente : contexte, navigateur, dossier de travail supprimé,
 * créneau rendu. La minuterie ferme tout à l'échéance (repoussable par `extend`, attente 3-D Secure).
 */
class BrowserLease {
  browser: Browser | null = null;
  context: BrowserContext | null = null;
  page: Page | null = null;
  release: (() => void) | null = null;
  timedOut = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closing: Promise<void> | null = null;

  constructor(
    readonly profileDir: string,
    private deadline: number,
  ) {}

  get closed(): boolean {
    return this.closing !== null;
  }

  remaining(): number {
    return Math.max(0, this.deadline - Date.now());
  }

  /** Arme la minuterie : à l'échéance, tout est fermé (pendant le lancement, `lease` s'en charge). */
  arm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timedOut = true;
      if (this.browser) void this.close();
    }, this.remaining());
  }

  /** Repousse l'échéance à maintenant + `ms` (sans effet une fois fermé ou expiré). */
  extend(ms: number): void {
    if (this.closed || this.timedOut) return;
    this.deadline = Date.now() + Math.max(0, ms);
    this.arm();
  }

  close(): Promise<void> {
    this.closing ??= (async () => {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      await this.context?.close().catch(() => {});
      await this.browser?.close().catch(() => {});
      await removeProfileDir(this.profileDir).catch(() => {});
      this.release?.();
    })();
    return this.closing;
  }
}

/** Premier élément visible parmi des sélecteurs pris dans l'ordre (priorité de l'adaptateur). */
async function firstVisibleLocator(page: Page, selectors: readonly string[], timeoutMs: number): Promise<Locator | null> {
  if (selectors.length === 0) return null;
  try {
    await page.locator(selectors.join(", ")).first().waitFor({ state: "visible", timeout: timeoutMs });
  } catch (err) {
    if (err instanceof pwErrors.TimeoutError) return null;
    throw err;
  }
  for (const s of selectors) {
    const loc = page.locator(s).first();
    if ((await loc.count()) > 0 && (await loc.isVisible())) return loc;
  }
  return null;
}

/** Rôles cherchés par nom visible quand aucun sélecteur de l'adaptateur ne répond. */
const NAMED_ROLES = ["button", "radio", "link"] as const;

export class PlaywrightRunner implements BrowserRunner, PageFetcher, PageOpener {
  private readonly chromiumPath: string;
  private readonly headless: boolean;
  private readonly slowMo: number | undefined;
  private readonly baseUrl: URL;
  private readonly actionTimeoutMs: number;
  private readonly stepTimeoutMs: number;
  private readonly confirmTimeoutMs: number;
  private readonly loginTimeoutMs: number;
  private readonly loginUrl: string;
  private readonly heavyActions: boolean;
  private readonly sandbox: boolean;
  private readonly sourceEnv: Record<string, string | undefined> | undefined;
  private readonly slotWaitMs: number;
  private readonly viewport: { width: number; height: number };
  private readonly logger: CloudLogger;
  private readonly profileBaseDir: string | undefined;
  private readonly maxBrowsingMs: number;
  readonly slots: BrowserSlots;

  constructor(options: PlaywrightRunnerOptions) {
    if (!options.chromiumPath) throw new Error("CLOUD_CHROMIUM_PATH manquant : le Cloud ne télécharge aucun navigateur.");
    this.chromiumPath = options.chromiumPath;
    this.headless = options.headless ?? true;
    this.slowMo = options.slowMo;
    this.baseUrl = new URL(options.baseUrl ?? VINTED_BASE_URL);
    this.actionTimeoutMs = options.actionTimeoutMs ?? CLOUD_DEFAULTS.actionTimeoutMs;
    this.stepTimeoutMs = Math.min(options.stepTimeoutMs ?? 20_000, this.actionTimeoutMs);
    this.confirmTimeoutMs = Math.min(options.confirmTimeoutMs ?? 15_000, this.actionTimeoutMs);
    this.loginTimeoutMs = options.loginTimeoutMs ?? CLOUD_DEFAULTS.loginTimeoutMs;
    this.loginUrl = options.loginUrl ?? VINTED_LOGIN_URL;
    this.heavyActions = options.heavyActions ?? CLOUD_DEFAULTS.heavyActions;
    this.sandbox = options.sandbox ?? true;
    this.sourceEnv = options.sourceEnv;
    this.slotWaitMs = Math.max(0, options.slotWaitMs ?? 30_000);
    this.viewport = options.viewport ?? { ...DEFAULT_VIEWPORT };
    this.logger = options.logger ?? silentLogger;
    this.slots = options.maxBrowsers instanceof BrowserSlots ? options.maxBrowsers : new BrowserSlots(options.maxBrowsers ?? CLOUD_DEFAULTS.maxBrowsers);
    this.profileBaseDir = options.profileBaseDir;
    this.maxBrowsingMs = Math.max(10_000, options.maxBrowsingMs ?? 30 * 60_000);
  }

  /**
   * Prépare le dossier de travail, prend un créneau, arme la minuterie et lance Chromium. Toute
   * issue autre qu'un bail rend « unavailable » sans navigateur lancé : rien n'a touché Vinted.
   * `retry` complète les messages (« l'action est remise en file », « la lecture est reportée »).
   */
  private async lease(profileDir: string, deadline: number, event: string, data: Record<string, unknown>, retry: string): Promise<BrowserLease | Failure> {
    try {
      // Dossier refusé (non vide, chemin relatif) : jamais supprimé, il ne nous appartient pas.
      await prepareProfileDir(profileDir);
    } catch (err) {
      return notLaunched("unavailable", err instanceof Error ? err.message : "Dossier de travail inutilisable.");
    }
    try {
      await mkdir(join(profileDir, "artifacts"), { mode: 0o700 });
    } catch {
      await removeProfileDir(profileDir).catch(() => {});
      return notLaunched("unavailable", "Dossier de travail inutilisable.");
    }
    const lease = new BrowserLease(profileDir, deadline);
    try {
      lease.release = await this.slots.acquire(Math.min(this.slotWaitMs, lease.remaining()));
    } catch (err) {
      await lease.close();
      if (err instanceof BrowserSlotTimeoutError) this.logger.warn(`${event}.no_slot`, data);
      return notLaunched("unavailable", `Aucun navigateur libre dans le délai imparti : ${retry}.`);
    }
    lease.arm();
    try {
      lease.browser = await chromium.launch(
        launchOptions({ chromiumPath: this.chromiumPath, headless: this.headless, slowMo: this.slowMo, timeoutMs: Math.min(30_000, lease.remaining()), sandbox: this.sandbox, workDir: profileDir, sourceEnv: this.sourceEnv }),
      );
    } catch {
      // Lancement impossible (exécutable, bac à sable, mémoire) : rien n'a touché Vinted.
      await lease.close();
      this.logger.warn(`${event}.launch_failed`, data);
      return notLaunched("unavailable", `Le navigateur du Cloud n'a pas pu être lancé : ${retry}.`);
    }
    if (lease.timedOut) {
      await lease.close();
      return notLaunched("unavailable", `Délai dépassé au lancement du navigateur : ${retry}.`);
    }
    return lease;
  }

  /** Contexte sans enregistrement (la session reste en mémoire, jamais dans un fichier), session injectée, une page. */
  private async openPage(lease: BrowserLease, session: StorageState): Promise<{ context: BrowserContext; page: Page }> {
    if (!lease.browser) throw new Error("Navigateur non lancé.");
    const context = await lease.browser.newContext(contextOptions(this.viewport));
    lease.context = context;
    context.setDefaultTimeout(this.stepTimeoutMs);
    context.setDefaultNavigationTimeout(this.stepTimeoutMs);
    await injectSession(context, session);
    const page = await context.newPage();
    lease.page = page;
    return { context, page };
  }

  /**
   * URL de l'action : relative à `baseUrl`, ou absolue en https sur un domaine
   * vinted.* ; le chemin doit être celui d'une conversation (réponse, relance)
   * ou d'un article (republication), selon `detectPage` de l'adaptateur.
   */
  resolveTarget(action: CloudAction): URL | null {
    const raw = action.kind === "republish" ? action.itemUrl : action.conversationUrl;
    let u: URL;
    try {
      u = new URL(raw, this.baseUrl);
    } catch {
      return null;
    }
    const sameBase = u.origin === this.baseUrl.origin;
    const vinted = u.protocol === "https:" && isVintedDomain(u.hostname);
    if (!sameBase && !vinted) return null;
    const kind = detectPage(`https://www.vinted.fr${u.pathname}`);
    if (action.kind === "republish" ? kind !== "item" : kind !== "conversation") return null;
    return u;
  }

  async run(input: RunInput): Promise<RunOutcome> {
    const started = Date.now();
    const finish = (o: Failure | (Success & { session: StorageState }), session?: StorageState): RunOutcome => {
      const durationMs = Date.now() - started;
      if (o.ok) return { ...o, durationMs };
      return session ? { ...o, session, durationMs } : { ...o, durationMs };
    };

    // Refus avant tout lancement : le dossier de travail fourni est retiré s'il est resté vide.
    const refuse = async (o: Failure) => {
      await discardEmptyProfileDir(input.profileDir);
      return finish(o);
    };
    const parsed = cloudActionSchema.safeParse(input.action);
    if (!parsed.success) return refuse(notLaunched("error", "Action invalide."));
    const action = parsed.data;
    if (actionLevel(action.kind) === "heavy" && !this.heavyActions) {
      return refuse(notLaunched("error", "Action lourde désactivée (CLOUD_HEAVY_ACTIONS=false, à décider par Ibrahim)."));
    }
    const target = this.resolveTarget(action);
    if (!target) return refuse(notLaunched("error", "Adresse refusée : seules les pages de conversation ou d'article Vinted sont acceptées."));
    const session = input.session ? filterStorageState(input.session) : null;
    if (!session || isSessionEmpty(session)) return refuse(notLaunched("not_logged_in", "Aucune session enregistrée : le client doit se connecter dans la fenêtre sécurisée."));

    this.logger.info("cloud.run.start", { kind: action.kind, host: target.hostname });
    const leased = await this.lease(input.profileDir, started + this.actionTimeoutMs, "cloud.run", { kind: action.kind }, "l'action est remise en file");
    if (!(leased instanceof BrowserLease)) return finish(leased);
    const lease = leased;
    const step: Step = { clicked: false };

    try {
      const { context, page } = await this.openPage(lease, session);

      const result = action.kind === "republish" ? await this.republish(page, target, step) : await this.sendMessage(page, target, action.text, step);

      const after = await readSession(context);
      if (result.ok) return finish({ ...result, session: after ?? session });
      this.logger.warn("cloud.run.stopped", { kind: action.kind, code: result.code });
      return finish(result, after);
    } catch (err) {
      const sideEffects = step.clicked ? "unknown" : "none";
      const page = lease.page;
      // Avant de conclure « erreur » ou « délai » : Vinted a pu afficher un CAPTCHA ou rediriger vers une
      // page de vérification pendant l'action. Impossible seulement si le minuteur global a tout fermé.
      if (!lease.timedOut && page && !page.isClosed()) {
        const signal = await blockAfterError(page, Math.min(5_000, Math.max(500, lease.remaining())));
        if (signal) {
          this.logger.warn("cloud.run.stopped", { kind: action.kind, code: signal.code, afterError: true });
          return finish(failure(signal.code, signal.message, sideEffects), lease.context ? await readSession(lease.context) : undefined);
        }
      }
      if (lease.timedOut || err instanceof pwErrors.TimeoutError) {
        this.logger.warn("cloud.run.timeout", { kind: action.kind });
        return finish(failure("timeout", "Délai dépassé : l'action a été interrompue.", sideEffects));
      }
      this.logger.warn("cloud.run.error", { kind: action.kind, error: err instanceof Error ? err.name : "unknown" });
      return finish(failure("error", "Erreur du navigateur pendant l'action.", sideEffects));
    } finally {
      await lease.close();
    }
  }

  /** Ouvre la page et rend le signal de Vinted s'il y en a un (rien n'a encore été fait). */
  private async open(page: Page, target: URL): Promise<Failure | null> {
    const response = await page.goto(target.toString(), { waitUntil: "domcontentloaded" });
    const status = response?.status() ?? null;
    const block = detectBlock(await page.content(), page.url(), { status });
    if (block) return failure(block.code, block.message);
    if (status !== null && status >= 400) return failure("error", `Vinted a répondu avec le statut ${status}.`);
    return null;
  }

  private async checkPage(page: Page, sideEffects: "none" | "unknown"): Promise<Failure | null> {
    const block = detectBlock(await page.content(), page.url());
    return block ? failure(block.code, block.message, sideEffects) : null;
  }

  private firstVisible(page: Page, selectors: readonly string[], timeoutMs: number): Promise<Locator | null> {
    return firstVisibleLocator(page, selectors, timeoutMs);
  }

  /** Bouton d'envoi : `submit` du formulaire du champ de réponse, sinon bouton « Envoyer ». */
  private async sendButton(page: Page, composer: Locator): Promise<Locator | null> {
    const inForm = composer.locator("xpath=ancestor::form[1]").locator(SEND_BUTTON_IN_FORM).first();
    if ((await inForm.count()) > 0 && (await inForm.isVisible())) return inForm;
    const byName = page.getByRole("button", { name: SEND_BUTTON_NAME }).first();
    if ((await byName.count()) > 0 && (await byName.isVisible())) return byName;
    return null;
  }

  private async sendMessage(page: Page, target: URL, text: string, step: Step): Promise<Failure | Success> {
    const blocked = await this.open(page, target);
    if (blocked) return blocked;

    const composer = await this.firstVisible(page, COMPOSER_SELECTORS, this.stepTimeoutMs);
    if (!composer) return (await this.checkPage(page, "none")) ?? failure("selector_missing", "Champ de réponse introuvable : la page de conversation a changé (adaptateur à mettre à jour).");
    // Aucun clic aveugle : la conversation doit être reconnue par l'adaptateur avant d'écrire.
    const before = await readConversation(page);
    if (!before.ok || !before.data) {
      return failure("selector_missing", `Conversation non reconnue (${before.missing.join(", ") || "structure"}) : adaptateur à mettre à jour.`);
    }
    const copiesBefore = countSentCopies(before.data, text);
    const button = await this.sendButton(page, composer);
    if (!button) return failure("selector_missing", "Bouton d'envoi introuvable (adaptateur à mettre à jour).");

    await composer.fill(text);
    const again = await this.checkPage(page, "none");
    if (again) return again;
    step.clicked = true;
    await button.click();

    const until = Date.now() + this.confirmTimeoutMs;
    while (Date.now() < until) {
      const block = await this.checkPage(page, "unknown");
      if (block) return block;
      const now = await readConversation(page);
      if (countSentCopies(now.data, text) > copiesBefore) return { ok: true, detail: "Message envoyé et visible dans la conversation." };
      await page.waitForTimeout(400);
    }
    return failure("timeout", "Envoi non confirmé : le message n'est pas apparu dans la conversation. Ne pas renvoyer automatiquement.", "unknown");
  }

  /**
   * Republication — IMPLÉMENTATION NON VÉRIFIÉE (aucune page réelle étudiée),
   * action lourde désactivée par défaut. S'arrête sur `selector_missing` si le
   * bouton n'est pas reconnu.
   */
  private async republish(page: Page, target: URL, step: Step): Promise<Failure | Success> {
    const blocked = await this.open(page, target);
    if (blocked) return blocked;
    const button = (await this.firstVisible(page, REPUBLISH_BUTTON_SELECTORS, Math.min(5_000, this.stepTimeoutMs))) ?? (await this.byName(page, REPUBLISH_BUTTON_NAME));
    if (!button) return failure("selector_missing", "Bouton de republication introuvable (implémentation non vérifiée).");
    step.clicked = true;
    await button.click();
    await page.waitForLoadState("domcontentloaded");
    const block = await this.checkPage(page, "unknown");
    if (block) return block;
    return { ok: true, detail: "Republication demandée — résultat non vérifié." };
  }

  private async byName(page: Page, name: RegExp): Promise<Locator | null> {
    const loc = page.getByRole("button", { name }).first();
    return (await loc.count()) > 0 && (await loc.isVisible()) ? loc : null;
  }

  /** Vrai si `fetchPage` ou `openBrowsing` accepte cette adresse (vérifié avant tout lancement). */
  allowsTarget(url: string, kind: RadarPageKind): boolean {
    return resolveRadarUrl(url, [kind], this.baseUrl) !== null;
  }

  /** Résolution des adresses Radar (catalogue, annonce) sur Vinted ou l'origine de test injectée. */
  resolveRadarTarget(url: string, kinds: readonly RadarPageKind[] = ["catalog", "item"]): URL | null {
    return resolveRadarUrl(url, kinds, this.baseUrl);
  }

  /** Page affichée sur Vinted ou sur l'origine de test injectée (condition d'un clic). */
  isAllowedOrigin(url: string): boolean {
    return isRadarOrigin(url, this.baseUrl);
  }

  /**
   * Selio Radar — lecture d'une page catalogue ou d'une annonce avec la session du compte Achat :
   * un Chromium neuf (même lancement que `run`), la page chargée, son HTML lu, la session relue et
   * filtrée, puis tout est refermé. Aucune action sur la page (ni clic, ni saisie, ni défilement).
   * La détection des signaux de Vinted se fait sur le HTML rendu (lecteur Radar) ; après une
   * exception, la page est relue (`blockAfterError`) pour ne pas confondre un CAPTCHA avec une erreur.
   */
  async fetchPage(input: FetchPageInput): Promise<FetchPageOutcome> {
    const started = Date.now();
    const notStarted = (code: RunFailureCode, message: string): FetchPageOutcome => ({ ok: false, code, message, launched: false, durationMs: Date.now() - started });
    const target = this.resolveRadarTarget(input.url);
    if (!target) return notStarted("error", "Adresse refusée : Radar ne lit que les pages catalogue et les annonces Vinted.");
    const session = input.session ? filterStorageState(input.session) : null;
    if (!session || isSessionEmpty(session)) return notStarted("not_logged_in", "Aucune session enregistrée pour le compte Achat : le client doit se connecter dans la fenêtre sécurisée.");
    let profileDir = input.profileDir;
    if (!profileDir) {
      try {
        profileDir = await createProfileDir(this.profileBaseDir);
      } catch {
        return notStarted("unavailable", "Dossier de travail inutilisable : la lecture est reportée.");
      }
    }
    const budget = Math.min(this.actionTimeoutMs, Math.max(1_000, input.timeoutMs ?? this.actionTimeoutMs));
    const leased = await this.lease(profileDir, started + budget, "radar.fetch", { host: target.hostname }, "la lecture est reportée");
    if (!(leased instanceof BrowserLease)) return { ok: false, code: leased.code, message: leased.message, launched: false, durationMs: Date.now() - started };
    const lease = leased;
    const done = (o: Omit<Extract<FetchPageOutcome, { ok: false }>, "durationMs" | "launched">): FetchPageOutcome => ({ ...o, launched: true, durationMs: Date.now() - started });
    try {
      const { context, page } = await this.openPage(lease, session);
      const response = await page.goto(target.toString(), { waitUntil: "domcontentloaded" });
      const status = response?.status() ?? null;
      // En-tête de vérification anti-robot (lu seulement pour s'arrêter, jamais pour le contourner).
      const challenge = (await response?.allHeaders().catch(() => ({}) as Record<string, string>))?.["cf-mitigated"]?.toLowerCase() === "challenge";
      // Signal de Vinted dès le chargement (CAPTCHA, « trop de requêtes »…) : arrêt immédiat, aucune attente.
      const signaled = challenge || (status !== null && status >= 400) || detectBlock(await page.content(), page.url(), { status, expectMember: false }) !== null;
      if (!signaled && input.waitForSelectors && input.waitForSelectors.length > 0) {
        // Attente courte de la grille (rendu côté client) ; son absence est constatée par l'adaptateur.
        await page
          .locator(input.waitForSelectors.join(", "))
          .first()
          .waitFor({ state: "attached", timeout: Math.min(5_000, lease.remaining()) })
          .catch(() => {});
      }
      const html = await page.content();
      const finalUrl = page.url();
      const after = await readSession(context);
      return { ok: true, html, finalUrl, status, ...(challenge ? { challenge: true } : {}), durationMs: Date.now() - started, ...(after ? { session: after } : {}) };
    } catch (err) {
      const page = lease.page;
      if (!lease.timedOut && page && !page.isClosed()) {
        const signal = await blockAfterError(page, Math.min(5_000, Math.max(500, lease.remaining())), { expectMember: false });
        if (signal) {
          this.logger.warn("radar.fetch.stopped", { code: signal.code, afterError: true });
          return done({ ok: false, code: signal.code, message: signal.message });
        }
      }
      if (lease.timedOut || err instanceof pwErrors.TimeoutError) {
        this.logger.warn("radar.fetch.timeout", { host: target.hostname });
        return done({ ok: false, code: "timeout", message: "Délai dépassé : la page n'a pas été lue." });
      }
      this.logger.warn("radar.fetch.error", { error: err instanceof Error ? err.name : "unknown" });
      return done({ ok: false, code: "error", message: "Erreur du navigateur pendant la lecture." });
    } finally {
      await lease.close();
    }
  }

  /**
   * Radar Auto — navigateur tenu ouvert le temps d'un achat (et, au plus, de l'attente d'une
   * validation 3-D Secure), fermé automatiquement à l'échéance. Le créneau reste pris pendant ce
   * temps. La page rendue ne sait que naviguer vers une annonce ou un catalogue Vinted, lire, cliquer
   * sur un bouton nommé et lire l'état d'une case : aucune méthode n'écrit de texte.
   */
  async openBrowsing(input: OpenBrowsingInput): Promise<OpenBrowsingOutcome> {
    const started = Date.now();
    const notStarted = (code: RunFailureCode, message: string): OpenBrowsingOutcome => ({ ok: false, code, message, launched: false, durationMs: Date.now() - started });
    const session = input.session ? filterStorageState(input.session) : null;
    if (!session || isSessionEmpty(session)) return notStarted("not_logged_in", "Aucune session enregistrée pour le compte Achat : le client doit se connecter dans la fenêtre sécurisée.");
    let profileDir = input.profileDir;
    if (!profileDir) {
      try {
        profileDir = await createProfileDir(this.profileBaseDir);
      } catch {
        return notStarted("unavailable", "Dossier de travail inutilisable : l'achat est reporté.");
      }
    }
    const ttl = Math.min(this.maxBrowsingMs, Math.max(1_000, input.timeoutMs ?? this.actionTimeoutMs));
    const leased = await this.lease(profileDir, started + ttl, "radar.browse", {}, "l'achat est reporté");
    if (!(leased instanceof BrowserLease)) return { ok: false, code: leased.code, message: leased.message, launched: false, durationMs: Date.now() - started };
    try {
      const { context, page } = await this.openPage(leased, session);
      return { ok: true, browsing: new PlaywrightBrowsing(this, leased, context, page, this.maxBrowsingMs, Math.min(5_000, this.stepTimeoutMs)) };
    } catch {
      const timedOut = leased.timedOut;
      await leased.close();
      return { ok: false, code: timedOut ? "timeout" : "error", message: "Le navigateur d'achat n'a pas pu être préparé.", launched: true, durationMs: Date.now() - started };
    }
  }

  openLoginWindow(input: OpenLoginWindowInput): Promise<LoginWindowApi> {
    return launchLoginWindow({
      chromiumPath: this.chromiumPath,
      headless: this.headless,
      profileDir: input.profileDir,
      loginUrl: input.loginUrl ?? this.loginUrl,
      timeoutMs: input.timeoutMs ?? this.loginTimeoutMs,
      viewport: this.viewport,
      slots: this.slots,
      logger: this.logger,
      sandbox: this.sandbox,
      sourceEnv: this.sourceEnv,
    });
  }
}

/**
 * Navigation d'achat sur un vrai Chromium. Volontairement pauvre : aller à une annonce ou un
 * catalogue Vinted, lire le HTML et l'adresse, cliquer sur un élément désigné par l'adaptateur (ou
 * par son nom visible), lire l'état coché d'une case. Aucune saisie de texte n'existe : aucun code
 * bancaire ne peut être tapé à la place du client. Aucun clic hors des pages Vinted.
 */
class PlaywrightBrowsing implements BrowsingSession {
  readonly page: BrowsingPage;

  constructor(
    runner: PlaywrightRunner,
    private readonly lease: BrowserLease,
    private readonly context: BrowserContext,
    pwPage: Page,
    private readonly maxMs: number,
    clickWaitMs: number,
  ) {
    this.page = {
      goto: async (url: string) => {
        const target = runner.resolveRadarTarget(url);
        if (!target) throw new TargetRefusedError();
        const response = await pwPage.goto(target.toString(), { waitUntil: "domcontentloaded" });
        return { status: response?.status() ?? null };
      },
      content: async () => {
        // Page en pleine navigation (redirection de Vinted ou de la banque) : relue après le chargement.
        for (let attempt = 0; ; attempt++) {
          try {
            return await pwPage.content();
          } catch (err) {
            if (attempt >= 2 || pwPage.isClosed() || this.closed) throw err;
            await pwPage.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => {});
          }
        }
      },
      url: () => pwPage.url(),
      click: async (target: ClickTarget) => {
        if (!runner.isAllowedOrigin(pwPage.url())) return false;
        let loc = await firstVisibleLocator(pwPage, target.selectors, clickWaitMs);
        if (!loc && target.name) {
          for (const role of NAMED_ROLES) {
            const byName = pwPage.getByRole(role, { name: target.name }).first();
            if ((await byName.count()) > 0 && (await byName.isVisible())) {
              loc = byName;
              break;
            }
          }
        }
        if (!loc) return false;
        await loc.click();
        return true;
      },
      isChecked: async (selectors: readonly string[]) => {
        for (const s of selectors) {
          const loc = pwPage.locator(s).first();
          if ((await loc.count()) === 0) continue;
          try {
            return await loc.isChecked({ timeout: 1_000 });
          } catch {
            // élément qui n'est ni case ni bouton radio : sélecteur suivant
          }
        }
        return null;
      },
      settle: async (timeoutMs: number) => {
        await pwPage.waitForLoadState("domcontentloaded", { timeout: Math.max(1, timeoutMs) }).catch(() => {});
      },
      wait: (ms: number) => pwPage.waitForTimeout(Math.max(0, ms)),
    };
  }

  get closed(): boolean {
    return this.lease.closed || this.lease.timedOut;
  }

  extend(ms: number): void {
    this.lease.extend(Math.min(this.maxMs, Math.max(0, ms)));
  }

  readSession(): Promise<StorageState | undefined> {
    return this.closed ? Promise.resolve(undefined) : readSession(this.context);
  }

  close(): Promise<void> {
    return this.lease.close();
  }
}

/** Session relue et filtrée avant la fermeture, ou undefined si le contexte ne répond plus. */
async function readSession(context: BrowserContext): Promise<StorageState | undefined> {
  try {
    return filterStorageState(await context.storageState());
  } catch {
    return undefined;
  }
}

/**
 * Injecte la session filtrée : cookies vinted.* dans le contexte, stockage
 * local des origines vinted.* au chargement de la page de même origine (cadre
 * principal seulement, sans écraser une valeur déjà présente).
 */
export async function injectSession(context: BrowserContext, session: StorageState): Promise<void> {
  const safe = filterStorageState(session);
  if (safe.cookies.length > 0) {
    await context.addCookies(
      safe.cookies.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite })),
    );
  }
  if (safe.origins.length > 0) {
    await context.addInitScript((origins: SessionOrigin[]) => {
      try {
        if (window.top !== window) return;
        const o = origins.find((x) => x.origin === window.location.origin);
        if (!o) return;
        for (const e of o.localStorage) if (window.localStorage.getItem(e.name) === null) window.localStorage.setItem(e.name, e.value);
      } catch {
        // stockage local indisponible : la session reste celle des cookies
      }
    }, safe.origins);
  }
}
