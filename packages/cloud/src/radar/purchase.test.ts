import { readFileSync } from "node:fs";
import { CHECKOUT_SELECTORS } from "@selio/connectors/vinted-adapter";
import { describe, expect, it } from "vitest";
import { FakeRunner } from "../runner/fake";
import type { StorageState } from "../types";
import type { FakeBrowsingPage, FakeSite } from "./fake";
import { PurchaseRunner, type PurchaseRunnerOptions } from "./purchase";

/** Fixtures de l'adaptateur de paiement (pages synthétiques, jamais vinted.fr). Aucun achat réel. */
const fixture = (name: string) => readFileSync(new URL(`../../../connectors/src/vinted/fixtures/${name}`, import.meta.url), "utf8");
const ITEM = fixture("item-buy.v1.html");
const CHECKOUT = fixture("checkout-page.v1.html");
const CHECKOUT_WALLET = CHECKOUT.replace('value="wallet">', 'value="wallet" checked>').replace('value="card" checked>', 'value="card">');
const THREE_DS = fixture("checkout-3ds.v1.html");
const DONE = fixture("checkout-done.v1.html");

const ITEM_URL = "https://www.vinted.fr/items/5012345601-veste-en-jean-levi-s-trucker";
const session: StorageState = {
  cookies: [{ name: "access_token_web", value: "tok", domain: ".vinted.fr", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" }],
  origins: [],
};

/** Site factice : « Acheter » → paiement ; porte-monnaie coché au clic ; « Payer » → `afterPay`. */
function site(afterPay: string | ((p: FakeBrowsingPage) => void) = DONE, overrides: Partial<FakeSite> = {}): FakeSite {
  return {
    pages: { "/items/5012345601-veste-en-jean-levi-s-trucker": ITEM, "/checkout": CHECKOUT, ...overrides.pages },
    clicks: {
      buy: "/checkout",
      select_wallet: (p) => p.setHtml(CHECKOUT_WALLET),
      confirm_payment: typeof afterPay === "string" ? (p) => p.show("https://www.vinted.fr/checkout/result", afterPay) : afterPay,
      ...overrides.clicks,
    },
  };
}

function setup(scenario: FakeSite | "unavailable" | "error" = site(), options: Partial<PurchaseRunnerOptions> = {}) {
  const runner = new FakeRunner({ browsingScenarios: [scenario] });
  let id = 0;
  const purchase = new PurchaseRunner({ opener: runner, pollMs: 10, stepTimeoutMs: 200, confirmTimeoutMs: 200, idFactory: () => `tok-${++id}`, ...options });
  const browsing = () => runner.browsings[0]!;
  return { runner, purchase, browsing };
}

describe("PurchaseRunner — essai à blanc (par défaut)", () => {
  it("annonce → Acheter → porte-monnaie choisi → total lu → arrêt AVANT le paiement", async () => {
    const { purchase, browsing } = setup();
    const r = await purchase.buy({ session, itemUrl: ITEM_URL, maxTotalCents: 2500, dryRun: true });
    expect(r).toMatchObject({ outcome: "dry_run", totalCents: 2248, itemPriceCents: 1800, walletOffered: true, walletSelected: true });
    expect(browsing().page.clicks).toEqual(["buy", "select_wallet"]);
    expect(browsing().page.visited).toEqual([ITEM_URL]);
    expect(browsing().closed).toBe(true);
    expect(r.outcome === "dry_run" && r.session?.cookies.map((c) => c.name)).toEqual(["access_token_web"]);
  });

  it("essai à blanc tant que `dryRun` n'est pas exactement `false`, même avec le verrou serveur ouvert", async () => {
    const { purchase, browsing } = setup(site(), { realPurchaseAllowed: true });
    const r = await purchase.buy({ session, itemUrl: ITEM_URL, maxTotalCents: 2500, dryRun: undefined as unknown as boolean });
    expect(r.outcome).toBe("dry_run");
    expect(browsing().page.clicks).not.toContain("confirm_payment");
  });

  it("achat réel refusé sans le verrou serveur (RADAR_AUTO_ENABLED) : rien n'est lancé", async () => {
    const { purchase, runner } = setup();
    const r = await purchase.buy({ session, itemUrl: ITEM_URL, maxTotalCents: 2500, dryRun: false });
    expect(r).toMatchObject({ outcome: "failed", code: "real_purchase_disabled", launched: false, sideEffects: "none" });
    expect(runner.browsings).toEqual([]);
  });

  it("porte-monnaie déjà coché : aucun clic de plus", async () => {
    const { purchase, browsing } = setup(site(DONE, { pages: { "/checkout": CHECKOUT_WALLET } }));
    expect(await purchase.buy({ session, itemUrl: ITEM_URL, maxTotalCents: 2500, dryRun: true })).toMatchObject({ outcome: "dry_run", walletSelected: true });
    expect(browsing().page.clicks).toEqual(["buy"]);
  });

  it("porte-monnaie non proposé : arrêt avant « Payer » (essai à blanc comme achat réel), jamais la carte à sa place", async () => {
    const noWallet = CHECKOUT.replace(/<label data-testid="payment-method-wallet">[\s\S]*?<\/label>/, "");
    const dry = setup(site(DONE, { pages: { "/checkout": noWallet } }));
    expect(await dry.purchase.buy({ session, itemUrl: ITEM_URL, maxTotalCents: 2500, dryRun: true })).toMatchObject({ outcome: "failed", code: "wallet_not_offered", sideEffects: "none", stop: null });
    const real = setup(site(DONE, { pages: { "/checkout": noWallet } }), { realPurchaseAllowed: true });
    const r = await real.purchase.buy({ session, itemUrl: ITEM_URL, maxTotalCents: 2500, dryRun: false });
    expect(r).toMatchObject({ outcome: "failed", code: "wallet_not_offered", sideEffects: "none", pages: 2 });
    expect(real.browsing().page.clicks).toEqual(["buy"]);
    expect(real.browsing().closed).toBe(true);
  });

  it("porte-monnaie proposé mais impossible à choisir : arrêt, aucun paiement", async () => {
    const { purchase, browsing } = setup(site(DONE, { clicks: { select_wallet: () => {} } }), { realPurchaseAllowed: true });
    expect(await purchase.buy({ session, itemUrl: ITEM_URL, maxTotalCents: 2500, dryRun: false })).toMatchObject({ outcome: "failed", code: "wallet_not_selected", sideEffects: "none" });
    expect(browsing().page.clicks).not.toContain("confirm_payment");
  });
});

describe("PurchaseRunner — prix", () => {
  it("prix affiché au-dessus du maximum : price_changed, AUCUN clic", async () => {
    const { purchase, browsing } = setup();
    const r = await purchase.buy({ session, itemUrl: ITEM_URL, maxTotalCents: 1500, dryRun: true });
    expect(r).toMatchObject({ outcome: "price_changed", stage: "item", displayedCents: 1800, maxTotalCents: 1500 });
    expect(browsing().page.clicks).toEqual([]);
    expect(browsing().closed).toBe(true);
  });

  it("total (port et protection compris) au-dessus du maximum : price_changed, aucun paiement", async () => {
    const { purchase, browsing } = setup(site(), { realPurchaseAllowed: true });
    const r = await purchase.buy({ session, itemUrl: ITEM_URL, maxTotalCents: 2000, dryRun: false });
    expect(r).toMatchObject({ outcome: "price_changed", stage: "checkout", displayedCents: 2248, maxTotalCents: 2000 });
    expect(browsing().page.clicks).toEqual(["buy", "select_wallet"]);
  });

  it("montant maximal invalide ou adresse hors Vinted : refus sans rien lancer", async () => {
    const { purchase, runner } = setup();
    for (const [itemUrl, max] of [
      [ITEM_URL, 0],
      [ITEM_URL, 12.5],
      [ITEM_URL, 5_000_000],
      ["https://www.vinted.lol/items/1-x", 2500],
      ["http://www.vinted.fr/items/1-x", 2500],
      ["https://www.vinted.fr/catalog?search_text=x", 2500],
    ] as const) {
      expect(await purchase.buy({ session, itemUrl, maxTotalCents: max, dryRun: true })).toMatchObject({ outcome: "failed", code: "invalid_input", launched: false });
    }
    expect(runner.browsings).toEqual([]);
  });
});

describe("PurchaseRunner — achat (verrous ouverts, sur fixtures)", () => {
  it("confirmation : purchased, référence de commande, total payé", async () => {
    const { purchase, browsing } = setup(site(DONE), { realPurchaseAllowed: true });
    const r = await purchase.buy({ session, itemUrl: ITEM_URL, maxTotalCents: 2500, dryRun: false });
    // Pages Vinted chargées (annonce, paiement, confirmation) : comptées dans les plafonds de pages.
    expect(r).toMatchObject({ outcome: "purchased", orderRef: "7788990011", totalCents: 2248, walletSelected: true, pages: 3 });
    expect(browsing().page.clicks).toEqual(["buy", "select_wallet", "confirm_payment"]);
    expect(browsing().closed).toBe(true);
  });

  it("3-D Secure : l'achat ATTEND le client (navigateur gardé ouvert), puis se confirme à la relecture", async () => {
    const { purchase, browsing } = setup(site(THREE_DS), { realPurchaseAllowed: true, threeDsTimeoutMs: 600_000 });
    const r = await purchase.buy({ session, itemUrl: ITEM_URL, maxTotalCents: 2500, dryRun: false });
    expect(r).toMatchObject({ outcome: "awaiting_3ds", resumeToken: "tok-1", totalCents: 2248 });
    expect(browsing().closed).toBe(false);
    expect(browsing().extendedMs).toEqual([600_000]);
    expect(purchase.pendingCount).toBe(1);
    // Le client n'a pas encore validé : toujours en attente, même jeton.
    expect(await purchase.resume("tok-1")).toMatchObject({ outcome: "awaiting_3ds", resumeToken: "tok-1" });
    // Il valide dans l'application de sa banque : Vinted affiche la confirmation.
    browsing().page.show("https://www.vinted.fr/checkout/success", DONE);
    const done = await purchase.resume("tok-1");
    expect(done).toMatchObject({ outcome: "purchased", orderRef: "7788990011", totalCents: 2248 });
    expect(browsing().closed).toBe(true);
    expect(purchase.pendingCount).toBe(0);
    expect(await purchase.resume("tok-1")).toMatchObject({ outcome: "failed", code: "3ds_timeout", sideEffects: "unknown" });
    // Aucun clic ni saisie pendant l'attente.
    expect(browsing().page.clicks).toEqual(["buy", "select_wallet", "confirm_payment"]);
  });

  it("3-D Secure non validé à temps : 3ds_timeout, effets inconnus (ne pas racheter), navigateur fermé", async () => {
    let clock = Date.parse("2026-10-29T10:00:00Z");
    const { purchase, browsing } = setup(site(THREE_DS), { realPurchaseAllowed: true, threeDsTimeoutMs: 60_000, now: () => new Date(clock) });
    const r = await purchase.buy({ session, itemUrl: ITEM_URL, maxTotalCents: 2500, dryRun: false });
    expect(r).toMatchObject({ outcome: "awaiting_3ds", expiresAt: "2026-10-29T10:01:00.000Z" });
    clock += 61_000;
    expect(await purchase.resume("tok-1")).toMatchObject({ outcome: "failed", code: "3ds_timeout", sideEffects: "unknown" });
    expect(browsing().closed).toBe(true);
  });

  it("annulation d'une attente 3-D Secure, et fermeture de toutes les attentes", async () => {
    const { purchase, browsing } = setup(site(THREE_DS), { realPurchaseAllowed: true });
    await purchase.buy({ session, itemUrl: ITEM_URL, maxTotalCents: 2500, dryRun: false });
    expect(await purchase.cancel("tok-1")).toBe(true);
    expect(await purchase.cancel("tok-1")).toBe(false);
    expect(browsing().closed).toBe(true);
    await purchase.closeAll();
    expect(purchase.pendingCount).toBe(0);
  });

  it("paiement refusé par la banque : payment_failed", async () => {
    const refused = CHECKOUT.replace("<h1>Paiement</h1>", `<h1>Paiement</h1><div role="alert" data-testid="payment-error">Le paiement a été refusé par ta banque.</div>`);
    const { purchase } = setup(site(refused), { realPurchaseAllowed: true });
    expect(await purchase.buy({ session, itemUrl: ITEM_URL, maxTotalCents: 2500, dryRun: false })).toMatchObject({ outcome: "failed", code: "payment_failed" });
  });

  it("confirmation jamais reconnue après « Payer » : unconfirmed, effets inconnus (jamais de nouvel achat automatique)", async () => {
    const { purchase } = setup(site(fixture("unknown-page.html")), { realPurchaseAllowed: true });
    expect(await purchase.buy({ session, itemUrl: ITEM_URL, maxTotalCents: 2500, dryRun: false })).toMatchObject({ outcome: "failed", code: "unconfirmed", sideEffects: "unknown" });
  });

  it("CAPTCHA après « Payer » : arrêt, pause du compte, effets inconnus", async () => {
    const captcha = `<html><head><title>vinted.fr</title></head><body><iframe src="https://geo.captcha-delivery.com/captcha/?x=1"></iframe></body></html>`;
    const { purchase } = setup(site(captcha), { realPurchaseAllowed: true });
    const r = await purchase.buy({ session, itemUrl: ITEM_URL, maxTotalCents: 2500, dryRun: false });
    expect(r).toMatchObject({ outcome: "failed", code: "captcha", sideEffects: "unknown", stop: { pauseAccount: true, tripMachineCircuit: false } });
  });
});

describe("PurchaseRunner — arrêts avant tout clic", () => {
  it("CAPTCHA ou « trop de requêtes » sur l'annonce : pause du compte (coupe-circuit pour le second), aucun clic", async () => {
    const captcha = fixture("catalog-blocked.v1.html");
    const a = setup(site(DONE, { pages: { "/items/5012345601-veste-en-jean-levi-s-trucker": captcha } }));
    expect(await a.purchase.buy({ session, itemUrl: ITEM_URL, maxTotalCents: 2500, dryRun: true })).toMatchObject({ outcome: "failed", code: "captcha", sideEffects: "none", stop: { code: "captcha", pauseAccount: true } });
    expect(a.browsing().page.clicks).toEqual([]);
    const b = setup(site(DONE, { pages: { "/items/5012345601-veste-en-jean-levi-s-trucker": { html: "<h1>Trop de requêtes</h1>", status: 429 } } }));
    expect(await b.purchase.buy({ session, itemUrl: ITEM_URL, maxTotalCents: 2500, dryRun: true })).toMatchObject({ code: "rate_limited", stop: { tripMachineCircuit: true } });
    expect(b.browsing().page.clicks).toEqual([]);
  });

  it("annonce vendue, supprimée, ou bouton « Acheter » absent : aucun clic", async () => {
    const sold = ITEM.replace(/<button type="button" data-testid="item-buy-button">Acheter<\/button>/, `<div data-testid="item-status--sold">Vendu</div>`);
    const a = setup(site(DONE, { pages: { "/items/5012345601-veste-en-jean-levi-s-trucker": sold } }));
    expect(await a.purchase.buy({ session, itemUrl: ITEM_URL, maxTotalCents: 2500, dryRun: true })).toMatchObject({ code: "item_unavailable", unavailable: "sold" });
    const b = setup(site(DONE, { pages: { "/items/5012345601-veste-en-jean-levi-s-trucker": { html: "<h1>Introuvable</h1>", status: 404 } } }));
    expect(await b.purchase.buy({ session, itemUrl: ITEM_URL, maxTotalCents: 2500, dryRun: true })).toMatchObject({ code: "item_unavailable", unavailable: "deleted" });
    const noButton = ITEM.replace(/<button type="button" data-testid="item-buy-button">Acheter<\/button>/, "");
    const c = setup(site(DONE, { pages: { "/items/5012345601-veste-en-jean-levi-s-trucker": noButton } }));
    expect(await c.purchase.buy({ session, itemUrl: ITEM_URL, maxTotalCents: 2500, dryRun: true })).toMatchObject({ code: "selector_missing" });
    for (const s of [a, b, c]) expect(s.browsing().page.clicks).toEqual([]);
  });

  it("redirection vers la connexion : not_logged_in", async () => {
    const { purchase } = setup(site(DONE, { clicks: { buy: (p) => p.show("https://www.vinted.fr/member/login?ref=checkout", "<h1>Connecte-toi</h1>") } }));
    expect(await purchase.buy({ session, itemUrl: ITEM_URL, maxTotalCents: 2500, dryRun: true })).toMatchObject({ code: "not_logged_in" });
  });

  it("page de paiement non reconnue : selector_missing, aucun paiement", async () => {
    const { purchase, browsing } = setup(site(DONE, { pages: { "/checkout": fixture("unknown-page.html") } }), { realPurchaseAllowed: true });
    expect(await purchase.buy({ session, itemUrl: ITEM_URL, maxTotalCents: 2500, dryRun: false })).toMatchObject({ code: "selector_missing", sideEffects: "none" });
    expect(browsing().page.clicks).toEqual(["buy"]);
  });

  it("sans session, ou aucun navigateur libre : rien n'est lancé", async () => {
    expect(await setup().purchase.buy({ session: null, itemUrl: ITEM_URL, maxTotalCents: 2500, dryRun: true })).toMatchObject({ code: "not_logged_in", launched: false });
    expect(await setup("unavailable").purchase.buy({ session, itemUrl: ITEM_URL, maxTotalCents: 2500, dryRun: true })).toMatchObject({ code: "unavailable", launched: false });
  });

  it("aucun champ de saisie : la page de navigation ne sait ni taper ni remplir", async () => {
    const { purchase, browsing } = setup(site(THREE_DS), { realPurchaseAllowed: true });
    await purchase.buy({ session, itemUrl: ITEM_URL, maxTotalCents: 2500, dryRun: false });
    const page = browsing().page as unknown as Record<string, unknown>;
    for (const m of ["fill", "type", "press", "keyboard", "evaluate", "setInputFiles"]) expect(page[m]).toBeUndefined();
    // Le clic du porte-monnaie vise le bouton radio de l'adaptateur, jamais un champ texte.
    expect(CHECKOUT_SELECTORS.walletClick.join(" ")).not.toMatch(/type="(?:text|tel|number|password)"/);
    await purchase.closeAll();
  });
});
