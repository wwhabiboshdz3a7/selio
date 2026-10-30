import { randomUUID } from "node:crypto";
import {
  CHECKOUT_SELECTORS,
  ITEM_BUY_BUTTON_NAME,
  ITEM_BUY_BUTTON_SELECTORS,
  PAY_BUTTON_NAME,
  WALLET_OPTION_NAME,
  parseCheckoutPage,
  parseHtmlDocument,
  parseItemPage,
  readItemPurchaseState,
  type CheckoutPageKind,
  type CheckoutPageResult,
  type ItemUnavailableReason,
} from "@selio/connectors/vinted-adapter";
import { BLOCK_MESSAGES, detectBlock } from "../guard";
import { silentLogger, type CloudLogger, type RunFailureCode, type StorageState } from "../types";
import { isLoginPath } from "../vinted";
import { RADAR_BROWSER_DEFAULTS } from "./config";
import { radarStopFor, type RadarStop } from "./policy";
import { TargetRefusedError, type BrowsingPage, type BrowsingSession, type PageOpener } from "./types";

/**
 * Radar Auto — achat d'une annonce depuis le compte Achat du client, pas à pas, sur les sélecteurs
 * de l'adaptateur « checkout-page » (fixtures synthétiques, NON VÉRIFIÉS EN RÉEL).
 *
 * Verrous (tous fermés par défaut) :
 * - `dryRun` : l'essai à blanc s'arrête AVANT le bouton de paiement. Il vaut vrai sauf si l'appelant
 *   passe exactement `false` — ce que le cœur ne fait que si RADAR_AUTO_ENABLED (serveur, comptes de
 *   l'équipe), le réglage de l'organisation et `realPurchaseEnabled` (D11) sont tous vrais ;
 * - `realPurchaseAllowed` : verrou serveur repris ici (RADAR_AUTO_ENABLED) ; sans lui, un achat réel
 *   est refusé avant de lancer quoi que ce soit (`real_purchase_disabled`).
 * Radar Auto n'est pas activable pour les clients sur l'adresse partagée tant qu'Ibrahim n'a pas tranché.
 *
 * Déroulé : annonce ouverte → prix affiché ≤ `maxTotalCents` (sinon `price_changed`, aucun clic) →
 * « Acheter » → page de paiement : porte-monnaie Vinted choisi (s'il n'est PAS proposé — solde
 * insuffisant, sélecteur changé —, arrêt `wallet_not_offered` avant « Payer » : jamais le moyen de
 * paiement enregistré, en général la carte, à la place du porte-monnaie) → total ≤
 * `maxTotalCents` (sinon `price_changed`, aucun paiement) → essai à blanc : arrêt ici (`dry_run`) ;
 * sinon « Payer » → confirmation (`purchased`, référence de commande) ou validation 3-D Secure demandée
 * par la banque (`awaiting_3ds` : le navigateur reste ouvert jusqu'à CLOUD_3DS_TIMEOUT_MS, le client
 * valide LUI-MÊME dans l'application de sa banque ; `resume` relit la page).
 *
 * Jamais de saisie : la page de navigation n'a aucune méthode d'écriture, aucun code bancaire ne peut
 * être tapé à la place du client. Jamais de clic hors des pages Vinted. Un CAPTCHA, un avertissement,
 * un blocage ou un « trop de requêtes » arrête tout (`stop` : pause du compte, alerte, mesure).
 * Après le clic sur « Payer », un échec rend `sideEffects: "unknown"` : ne JAMAIS racheter tout seul.
 */

export type PurchaseFailureCode =
  | "captcha"
  | "warning"
  | "blocked"
  | "rate_limited"
  | "not_logged_in"
  | "invalid_input"
  | "real_purchase_disabled"
  | "item_unavailable"
  | "selector_missing"
  | "wallet_not_selected"
  | "wallet_not_offered"
  | "payment_failed"
  | "unexpected_page"
  | "unconfirmed"
  | "3ds_timeout"
  | "timeout"
  | "unavailable"
  | "error";

/**
 * Résultat d'un achat. `pages` : pages Vinted chargées par le navigateur (annonce, paiement,
 * confirmation), comptées par l'appelant dans les plafonds de pages par minute et le taux de blocage.
 */
export type PurchaseResult = (
  | { outcome: "dry_run"; totalCents: number; itemPriceCents: number; walletOffered: boolean; walletSelected: boolean; durationMs: number; session?: StorageState }
  | { outcome: "awaiting_3ds"; resumeToken: string; totalCents: number | null; expiresAt: string; durationMs: number }
  | { outcome: "purchased"; orderRef: string | null; totalCents: number | null; walletSelected: boolean; durationMs: number; session?: StorageState }
  | { outcome: "price_changed"; stage: "item" | "checkout"; displayedCents: number; maxTotalCents: number; durationMs: number; session?: StorageState }
  | {
      outcome: "failed";
      code: PurchaseFailureCode;
      message: string;
      /** `none` : aucun paiement demandé. `unknown` : « Payer » a été cliqué — vérifier dans Vinted, ne pas racheter. */
      sideEffects: "none" | "unknown";
      /** Faux : aucun navigateur lancé. */
      launched: boolean;
      /** Conduite imposée par un signal de Vinted (pause, alerte, mesure, coupe-circuit). */
      stop: RadarStop | null;
      unavailable?: ItemUnavailableReason | "deleted";
      durationMs: number;
      session?: StorageState;
    }
) & { pages?: number };

export type PurchaseFailure = Extract<PurchaseResult, { outcome: "failed" }>;

export interface BuyInput {
  /** Session filtrée du compte Achat (déchiffrée par l'appelant). */
  session: StorageState | null;
  /** Annonce Vinted (https, liste fermée). */
  itemUrl: string;
  /** Total maximal accepté (article + port + protection), en centimes. */
  maxTotalCents: number;
  /** Essai à blanc : vrai sauf `false` explicite (décidé hors de ce paquet). */
  dryRun: boolean;
  profileDir?: string;
}

export interface PurchaseRunnerOptions {
  opener: PageOpener;
  /** Verrou serveur RADAR_AUTO_ENABLED (faux par défaut) : sans lui, seul l'essai à blanc est permis. */
  realPurchaseAllowed?: boolean;
  /** CLOUD_3DS_TIMEOUT_MS (10 min par défaut). */
  threeDsTimeoutMs?: number;
  /** Durée de vie du navigateur jusqu'au paiement (90 s par défaut). */
  purchaseTimeoutMs?: number;
  /** Attente d'une page (paiement, case cochée) après un clic (15 s par défaut). */
  stepTimeoutMs?: number;
  /** Attente de la confirmation après « Payer » (30 s par défaut). */
  confirmTimeoutMs?: number;
  /** Pas de relecture de la page (500 ms par défaut). */
  pollMs?: number;
  now?: () => Date;
  idFactory?: () => string;
  logger?: CloudLogger;
}

/** Plafond de cohérence d'un total maximal (10 000 €). */
const MAX_TOTAL_CENTS_LIMIT = 1_000_000;

interface Pending {
  browsing: BrowsingSession;
  expiresAt: number;
  totalCents: number | null;
  walletSelected: boolean;
  startedAt: number;
  expired: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

type Step = { payClicked: boolean; pages: number };

const MESSAGES = {
  invalidInput: "Achat refusé : adresse d'annonce ou montant maximal invalide.",
  realDisabled: "Achat réel désactivé (RADAR_AUTO_ENABLED=false) : seul l'essai à blanc est permis.",
  unavailable: (r: ItemUnavailableReason | "deleted") =>
    ({ sold: "Annonce déjà vendue.", reserved: "Annonce réservée.", hidden: "Annonce masquée.", deleted: "Annonce supprimée." })[r] + " Aucun clic.",
  priceUnreadable: "Prix de l'annonce illisible (adaptateur à revoir) : aucun clic.",
  noBuyButton: "Bouton « Acheter » introuvable (adaptateur à revoir) : aucun clic.",
  checkoutUnknown: "Page de paiement non reconnue (adaptateur à revoir) : aucun paiement.",
  walletNotSelected: "Le porte-monnaie Vinted est proposé mais n'a pas pu être choisi : aucun paiement.",
  walletNotOffered: "Le porte-monnaie Vinted n'est pas proposé au paiement (solde insuffisant ou page changée) : arrêt avant « Payer », jamais un autre moyen de paiement à sa place.",
  totalUnreadable: "Total à payer illisible (adaptateur à revoir) : aucun paiement.",
  noPayButton: "Bouton de paiement introuvable (adaptateur à revoir) : aucun paiement.",
  paymentRefused: "Paiement refusé (banque ou solde) : aucune commande.",
  unconfirmed: "Paiement demandé mais confirmation non reconnue : vérifier la commande dans Vinted. Ne pas racheter automatiquement.",
  threeDsTimeout: "Le client n'a pas validé le paiement 3-D Secure à temps : vérifier la commande dans Vinted. Ne pas racheter automatiquement.",
  threeDsLost: "Attente 3-D Secure introuvable (terminée ou worker redémarré) : vérifier la commande dans Vinted. Ne pas racheter automatiquement.",
} as const;

export class PurchaseRunner {
  private readonly opener: PageOpener;
  private readonly realPurchaseAllowed: boolean;
  private readonly threeDsTimeoutMs: number;
  private readonly purchaseTimeoutMs: number;
  private readonly stepTimeoutMs: number;
  private readonly confirmTimeoutMs: number;
  private readonly pollMs: number;
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly logger: CloudLogger;
  private readonly pending = new Map<string, Pending>();

  constructor(options: PurchaseRunnerOptions) {
    this.opener = options.opener;
    this.realPurchaseAllowed = options.realPurchaseAllowed === true;
    this.threeDsTimeoutMs = Math.max(1_000, options.threeDsTimeoutMs ?? RADAR_BROWSER_DEFAULTS.threeDsTimeoutMs);
    this.purchaseTimeoutMs = Math.max(1_000, options.purchaseTimeoutMs ?? RADAR_BROWSER_DEFAULTS.purchaseTimeoutMs);
    this.stepTimeoutMs = Math.max(100, options.stepTimeoutMs ?? 15_000);
    this.confirmTimeoutMs = Math.max(100, options.confirmTimeoutMs ?? 30_000);
    this.pollMs = Math.max(10, options.pollMs ?? 500);
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.logger = options.logger ?? silentLogger;
  }

  /** Achats en attente de validation 3-D Secure (navigateurs encore ouverts). */
  get pendingCount(): number {
    let n = 0;
    for (const p of this.pending.values()) if (!p.expired) n++;
    return n;
  }

  async buy(input: BuyInput): Promise<PurchaseResult> {
    const started = Date.now();
    const elapsed = () => Date.now() - started;
    const dryRun = input.dryRun !== false;
    const max = input.maxTotalCents;
    if (!Number.isInteger(max) || max <= 0 || max > MAX_TOTAL_CENTS_LIMIT || typeof input.itemUrl !== "string" || !this.opener.allowsTarget(input.itemUrl, "item")) {
      return failed("invalid_input", MESSAGES.invalidInput, { launched: false, durationMs: elapsed() });
    }
    if (!dryRun && !this.realPurchaseAllowed) return failed("real_purchase_disabled", MESSAGES.realDisabled, { launched: false, durationMs: elapsed() });

    const opened = await this.opener.openBrowsing({ session: input.session, timeoutMs: this.purchaseTimeoutMs, ...(input.profileDir ? { profileDir: input.profileDir } : {}) });
    if (!opened.ok) return failed(asFailureCode(opened.code), opened.message, { launched: opened.launched, durationMs: elapsed() });

    const browsing = opened.browsing;
    const step: Step = { payClicked: false, pages: 0 };
    let keepOpen = false;
    let result: PurchaseResult;
    try {
      result = await this.drive(browsing, { ...input, dryRun }, step, started);
      keepOpen = result.outcome === "awaiting_3ds";
    } catch (err) {
      result = await this.afterError(browsing, err, step, elapsed());
    }
    if (!keepOpen) {
      const session = await browsing.readSession().catch(() => undefined);
      await browsing.close().catch(() => {});
      if (session && result.outcome !== "awaiting_3ds") result = { ...result, durationMs: elapsed(), session };
      else result = { ...result, durationMs: elapsed() };
    }
    result = { ...result, pages: step.pages };
    this.logger.info("radar.buy.outcome", { outcome: result.outcome, ...(result.outcome === "failed" ? { code: result.code } : {}), dryRun });
    return result;
  }

  /**
   * Relit un achat en attente de validation 3-D Secure (le client valide dans l'application de sa
   * banque). `waitMs` : relectures pendant au plus ce délai (0 : une seule lecture).
   */
  async resume(resumeToken: string, options: { waitMs?: number } = {}): Promise<PurchaseResult> {
    const started = Date.now();
    const p = this.pending.get(resumeToken);
    if (!p) return failed("3ds_timeout", MESSAGES.threeDsLost, { sideEffects: "unknown", launched: true, durationMs: 0 });
    const finish = async (r: PurchaseResult): Promise<PurchaseResult> => {
      this.drop(resumeToken);
      const session = p.browsing.closed ? undefined : await p.browsing.readSession().catch(() => undefined);
      await p.browsing.close().catch(() => {});
      const durationMs = Date.now() - p.startedAt;
      // Retour de la banque vers la page de confirmation de Vinted : une page de plus.
      return session && r.outcome !== "awaiting_3ds" ? { ...r, durationMs, session, pages: 1 } : { ...r, durationMs, pages: 1 };
    };
    if (p.expired || p.browsing.closed || this.now().getTime() >= p.expiresAt) {
      return finish(failed("3ds_timeout", MESSAGES.threeDsTimeout, { sideEffects: "unknown", launched: true, durationMs: 0 }));
    }
    try {
      const deadline = started + Math.max(0, options.waitMs ?? 0);
      const read = await this.awaitCheckout(p.browsing.page, ["confirmation", "payment_error"], Math.max(0, deadline - Date.now()), "unknown");
      if ("failure" in read) return finish(read.failure);
      const r = read.result;
      if (r.kind === "confirmation") return finish(purchased(r, p.totalCents, p.walletSelected));
      if (r.kind === "payment_error") return finish(failed("payment_failed", MESSAGES.paymentRefused, { sideEffects: "none", launched: true, durationMs: 0 }));
      return { outcome: "awaiting_3ds", resumeToken, totalCents: p.totalCents, expiresAt: new Date(p.expiresAt).toISOString(), durationMs: Date.now() - p.startedAt, pages: 0 };
    } catch (err) {
      return finish(await this.afterError(p.browsing, err, { payClicked: true, pages: 0 }, 0));
    }
  }

  /** Abandonne une attente 3-D Secure (le client annule, ou arrêt du worker) : navigateur fermé. */
  async cancel(resumeToken: string): Promise<boolean> {
    const p = this.pending.get(resumeToken);
    if (!p) return false;
    this.drop(resumeToken);
    await p.browsing.close().catch(() => {});
    return true;
  }

  /** Ferme tous les navigateurs en attente (arrêt du worker). */
  async closeAll(): Promise<void> {
    for (const token of [...this.pending.keys()]) await this.cancel(token);
  }

  private drop(token: string): void {
    const p = this.pending.get(token);
    if (p?.timer) clearTimeout(p.timer);
    this.pending.delete(token);
  }

  private register(browsing: BrowsingSession, totalCents: number | null, walletSelected: boolean, startedAt: number): { token: string; expiresAt: number } {
    const token = this.idFactory();
    const expiresAt = this.now().getTime() + this.threeDsTimeoutMs;
    browsing.extend(this.threeDsTimeoutMs);
    const entry: Pending = { browsing, expiresAt, totalCents, walletSelected, startedAt, expired: false, timer: null };
    // À l'échéance : navigateur fermé, l'attente reste connue (une heure) pour rendre « 3ds_timeout ».
    entry.timer = setTimeout(() => {
      entry.expired = true;
      void browsing.close().catch(() => {});
      entry.timer = setTimeout(() => this.pending.delete(token), 60 * 60_000);
      entry.timer.unref?.();
    }, this.threeDsTimeoutMs);
    entry.timer.unref?.();
    this.pending.set(token, entry);
    return { token, expiresAt };
  }

  private async drive(browsing: BrowsingSession, input: BuyInput, step: Step, started: number): Promise<PurchaseResult> {
    const page = browsing.page;
    const max = input.maxTotalCents;
    const elapsed = () => Date.now() - started;

    // 1. Annonce : signaux, disponibilité, prix affiché, bouton « Acheter ». Aucun clic avant ces contrôles.
    const { status } = await page.goto(input.itemUrl);
    step.pages++;
    const itemHtml = await page.content();
    const stopped = this.checkSignals(itemHtml, page.url(), status, "none");
    if (stopped) return stopped;
    if (status === 404 || status === 410) return failed("item_unavailable", MESSAGES.unavailable("deleted"), { unavailable: "deleted" });
    if (status !== null && status >= 400) return failed("error", `Vinted a répondu avec le statut ${status} : aucun clic.`);
    const doc = parseHtmlDocument(itemHtml);
    const state = readItemPurchaseState(doc);
    if (state.unavailable) return failed("item_unavailable", MESSAGES.unavailable(state.unavailable), { unavailable: state.unavailable });
    const priceCents = parseItemPage(doc, page.url()).data?.priceCents ?? null;
    if (priceCents === null) return failed("selector_missing", MESSAGES.priceUnreadable);
    if (priceCents > max) return { outcome: "price_changed", stage: "item", displayedCents: priceCents, maxTotalCents: max, durationMs: elapsed() };
    if (!state.buyButtonFound) return failed("selector_missing", MESSAGES.noBuyButton);

    if (!(await page.click({ intent: "buy", selectors: ITEM_BUY_BUTTON_SELECTORS, name: ITEM_BUY_BUTTON_NAME }))) return failed("selector_missing", MESSAGES.noBuyButton);
    step.pages++;
    await page.settle(this.stepTimeoutMs);

    // 2. Page de paiement.
    const opened = await this.awaitCheckout(page, ["checkout", "payment_error", "three_ds", "confirmation"], this.stepTimeoutMs, "none");
    if ("failure" in opened) return opened.failure;
    let checkout = opened.result;
    if (checkout.kind === "payment_error") return failed("payment_failed", MESSAGES.paymentRefused);
    if (checkout.kind === "confirmation") {
      // Jamais attendu : « Acheter » ne doit qu'ouvrir la page de paiement. Personne n'a cliqué « Payer ».
      return failed("unexpected_page", "Confirmation de commande inattendue après « Acheter » (aucun paiement demandé par Selio) : vérifier le compte dans Vinted.", { sideEffects: "unknown" });
    }
    if (checkout.kind === "three_ds") return failed("unexpected_page", "Validation bancaire demandée avant le paiement : arrêt, aucun paiement demandé par Selio.");
    if (checkout.kind !== "checkout" || !checkout.ok) return failed("selector_missing", `${MESSAGES.checkoutUnknown}${checkout.missing.length ? ` (${checkout.missing.join(", ")})` : ""}`);

    // 3. Porte-monnaie Vinted : imposé. Non proposé → arrêt AVANT « Payer » (essai à blanc compris, pour
    // qu'il dise ce que ferait l'achat réel) : le moyen enregistré (en général la carte) n'est jamais utilisé.
    const walletOffered = checkout.data.wallet.offered;
    if (!walletOffered) return failed("wallet_not_offered", MESSAGES.walletNotOffered);
    let walletSelected = walletOffered && ((await page.isChecked(CHECKOUT_SELECTORS.walletClick)) ?? checkout.data.wallet.selected);
    if (walletOffered && !walletSelected) {
      if (await page.click({ intent: "select_wallet", selectors: CHECKOUT_SELECTORS.walletClick, name: WALLET_OPTION_NAME })) {
        await page.settle(this.stepTimeoutMs);
        const deadline = Date.now() + this.stepTimeoutMs;
        for (let i = 0, n = Math.ceil(this.stepTimeoutMs / this.pollMs); i <= n; i++) {
          const html = await page.content();
          const s = this.checkSignals(html, page.url(), null, "none");
          if (s) return s;
          const r = parseCheckoutPage(html, { url: page.url() });
          if (r.kind === "checkout" && r.ok) checkout = r;
          walletSelected = (await page.isChecked(CHECKOUT_SELECTORS.walletClick)) ?? r.data.wallet.selected;
          if (walletSelected || Date.now() >= deadline) break;
          await page.wait(this.pollMs);
        }
      }
      if (!walletSelected) return failed("wallet_not_selected", MESSAGES.walletNotSelected);
    }

    // 4. Total à payer.
    const totalCents = checkout.data.totalCents;
    if (totalCents === null) return failed("selector_missing", MESSAGES.totalUnreadable);
    if (totalCents > max) return { outcome: "price_changed", stage: "checkout", displayedCents: totalCents, maxTotalCents: max, durationMs: elapsed() };

    // 5. Essai à blanc : arrêt avant le bouton de paiement.
    if (input.dryRun !== false) return { outcome: "dry_run", totalCents, itemPriceCents: priceCents, walletOffered, walletSelected, durationMs: elapsed() };

    // 6. Paiement (achat réel : verrous ouverts hors de ce paquet).
    if (!checkout.data.payButtonFound) return failed("selector_missing", MESSAGES.noPayButton);
    if (!(await page.click({ intent: "confirm_payment", selectors: CHECKOUT_SELECTORS.payButton, name: PAY_BUTTON_NAME }))) return failed("selector_missing", MESSAGES.noPayButton);
    step.payClicked = true;
    step.pages++;
    await page.settle(this.stepTimeoutMs);

    const after = await this.awaitCheckout(page, ["confirmation", "three_ds", "payment_error"], this.confirmTimeoutMs, "unknown");
    if ("failure" in after) return after.failure;
    const r = after.result;
    if (r.kind === "confirmation") return purchased(r, totalCents, walletSelected, elapsed());
    if (r.kind === "payment_error") return failed("payment_failed", MESSAGES.paymentRefused);
    if (r.kind === "three_ds") {
      const { token, expiresAt } = this.register(browsing, totalCents, walletSelected, started);
      this.logger.info("radar.buy.awaiting_3ds", { timeoutMs: this.threeDsTimeoutMs });
      return { outcome: "awaiting_3ds", resumeToken: token, totalCents, expiresAt: new Date(expiresAt).toISOString(), durationMs: elapsed() };
    }
    return failed("unconfirmed", MESSAGES.unconfirmed, { sideEffects: "unknown" });
  }

  /**
   * Relit la page jusqu'à reconnaître l'une des sortes attendues, au plus `timeoutMs` (et un nombre
   * borné de relectures). Un signal de Vinted arrête tout. Rend la dernière lecture sinon.
   */
  private async awaitCheckout(page: BrowsingPage, kinds: readonly CheckoutPageKind[], timeoutMs: number, sideEffects: "none" | "unknown"): Promise<{ result: CheckoutPageResult } | { failure: PurchaseFailure }> {
    const deadline = Date.now() + timeoutMs;
    const attempts = Math.ceil(timeoutMs / this.pollMs);
    let last: CheckoutPageResult | null = null;
    for (let i = 0; ; i++) {
      const html = await page.content();
      const s = this.checkSignals(html, page.url(), null, sideEffects);
      if (s) return { failure: s };
      last = parseCheckoutPage(html, { url: page.url() });
      if (kinds.includes(last.kind) && (last.kind !== "checkout" || last.ok)) return { result: last };
      if (i >= attempts || Date.now() >= deadline) return { result: last };
      await page.wait(this.pollMs);
    }
  }

  /** CAPTCHA, avertissement, blocage, « trop de requêtes », ou page de connexion. */
  private checkSignals(html: string, url: string, status: number | null, sideEffects: "none" | "unknown"): PurchaseFailure | null {
    const signal = detectBlock(html, url, { status, expectMember: false });
    const stop = signal ? radarStopFor(signal.code) : null;
    if (stop) {
      this.logger.warn("radar.buy.stopped", { code: stop.code });
      return failed(stop.code, stop.message, { sideEffects, stop });
    }
    let path = "";
    try {
      path = new URL(url).pathname;
    } catch {
      // adresse illisible
    }
    if (signal?.code === "not_logged_in" || isLoginPath(path)) return failed("not_logged_in", BLOCK_MESSAGES.not_logged_in, { sideEffects });
    return null;
  }

  private async afterError(browsing: BrowsingSession, err: unknown, step: Step, durationMs: number): Promise<PurchaseFailure> {
    const sideEffects = step.payClicked ? "unknown" : "none";
    if (err instanceof TargetRefusedError) return failed("invalid_input", err.message, { sideEffects, durationMs });
    if (!browsing.closed) {
      try {
        const s = this.checkSignals(await browsing.page.content(), browsing.page.url(), null, sideEffects);
        if (s) return { ...s, durationMs };
      } catch {
        // page illisible : erreur ci-dessous
      }
      this.logger.warn("radar.buy.error", { error: err instanceof Error ? err.name : "unknown" });
      return failed("error", sideEffects === "unknown" ? `Erreur du navigateur après le paiement : ${MESSAGES.unconfirmed}` : "Erreur du navigateur pendant l'achat : aucun paiement.", { sideEffects, durationMs });
    }
    return failed("timeout", sideEffects === "unknown" ? `Délai dépassé après le paiement : ${MESSAGES.unconfirmed}` : "Délai dépassé : achat interrompu, aucun paiement.", { sideEffects, durationMs });
  }
}

function failed(
  code: PurchaseFailureCode,
  message: string,
  extra: { sideEffects?: "none" | "unknown"; launched?: boolean; stop?: RadarStop | null; unavailable?: ItemUnavailableReason | "deleted"; durationMs?: number } = {},
): PurchaseFailure {
  return {
    outcome: "failed",
    code,
    message,
    sideEffects: extra.sideEffects ?? "none",
    launched: extra.launched ?? true,
    stop: extra.stop ?? radarStopFor(code),
    ...(extra.unavailable ? { unavailable: extra.unavailable } : {}),
    durationMs: extra.durationMs ?? 0,
  };
}

function purchased(r: CheckoutPageResult, fallbackTotal: number | null, walletSelected: boolean, durationMs = 0): PurchaseResult {
  return { outcome: "purchased", orderRef: r.data.orderRef, totalCents: r.data.totalCents ?? fallbackTotal, walletSelected, durationMs };
}

const FAILURE_CODES: ReadonlySet<string> = new Set<PurchaseFailureCode>(["captcha", "warning", "blocked", "rate_limited", "not_logged_in", "timeout", "unavailable", "error"]);

function asFailureCode(code: RunFailureCode): PurchaseFailureCode {
  return FAILURE_CODES.has(code) ? (code as PurchaseFailureCode) : "error";
}
