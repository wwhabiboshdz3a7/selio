import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Outlet, RouterProvider, createMemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@selio/ui";
import { quotasForPlan, type BetaStatus, type CheckoutPreview, type ServerCapabilities, type Subscription } from "@selio/contracts";
import { DataProvider, queryClient } from "../lib/data/provider";
import { DataError } from "../lib/data/types";
import { betaGateFor, daysLabel, isBetaEndedError, pathAllowedWhenBetaEnded } from "../lib/beta";
import { BetaBadge, BetaGate, BetaReminderBanner } from "./beta";
import { BillingBanner, RequireSession } from "./layout";
import BetaWelcome from "./pages/BetaWelcome";
import Payment, { PAYMENT_OPENING_TITLE } from "./pages/Payment";
import Register from "../marketing/pages/Register";
import { AccountStatus } from "./pages/admin/Accounts";
import AdminOffers from "./pages/admin/Offers";

/**
 * Bêta (code BETA2026SELIO) côté application : écran de bienvenue, écran de blocage, bandeaux J-7 / J-1, badge,
 * et page de paiement factice SANS aucun champ de carte.
 */
const END = "2026-12-30T09:00:00.000Z";

function beta(over: Partial<BetaStatus> = {}): BetaStatus {
  return { code: "BETA2026SELIO", plan: "pro", startedAt: "2026-11-30T09:00:00.000Z", endsAt: END, state: "running", blocked: false, blockedSince: null, daysLeft: 30, reminder: null, paymentReady: false, welcomeSeen: true, invoiceNumber: "SEL-2026-000001", ...over };
}

function session(b: BetaStatus | null, role = "owner") {
  return {
    mode: "connected",
    user: { id: "u1", email: "alice@beta.test", displayName: "Alice", isOperator: false, operatorRole: null, createdAt: "2026-11-30T09:00:00.000Z", updatedAt: "2026-11-30T09:00:00.000Z" },
    org: { id: "o1", name: "Boutique Alice", slug: "boutique-alice", settings: { onboarding: { completedSteps: [], dismissed: false } }, createdAt: "2026-11-30T09:00:00.000Z", updatedAt: "2026-11-30T09:00:00.000Z" },
    role,
    memberships: [],
    beta: b,
  };
}

const sub = (over: Partial<Subscription> = {}): Subscription => ({
  id: "s1", orgId: "o1", plan: "pro", status: "trialing", provider: "none", externalRef: null, currentPeriodEnd: END, quotas: quotasForPlan("pro"), cardOnFile: false, cancelAtPeriodEnd: false, testMode: true,
  revolutCustomerId: null, paymentMethodId: null, cycle: "monthly", pendingPlan: null, chargeAttempts: 0, nextChargeAt: null, lastChargeError: null, dataRetentionUntil: null, createdAt: END, updatedAt: END, ...over,
});

const CAPS: ServerCapabilities = { demo: false, version: "0.1.0", trackLive: false, cloud: false, radarLive: false, vision: false, pricingModel: false, payment: "simulated", paymentSandbox: null, email: false };

function stubApi(routes: Record<string, (init: RequestInit) => [number, unknown]>) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    calls.push({ url: path, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
    const key = Object.keys(routes).find((k) => path.startsWith(k.split(" ")[1]!) && (init.method ?? "GET") === k.split(" ")[0]);
    const [status, body] = key ? routes[key]!(init) : [404, { error: { code: "not_found", message: `Route inconnue : ${init.method ?? "GET"} ${path}` } }];
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }));
  return calls;
}

function renderApp(routes: Parameters<typeof createMemoryRouter>[0], path: string) {
  // Comme dans l'application : chaque écran est sous RequireSession (session chargée avant le rendu).
  const router = createMemoryRouter([{ element: <RequireSession><Outlet /></RequireSession>, children: routes }], { initialEntries: [path] });
  render(<DataProvider forceMode="connected"><ToastProvider><RouterProvider router={router} /></ToastProvider></DataProvider>);
  return router;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  queryClient.clear();
});

describe("règles d'affichage (fonctions pures)", () => {
  it("pages encore ouvertes après la fin du mois : abonnement, factures, export, paiement", () => {
    for (const p of ["/app/settings/billing", "/app/settings/invoices", "/app/settings/invoices/abc", "/app/settings/data", "/app/paiement", "/app/settings/billing/"]) expect(pathAllowedWhenBetaEnded(p)).toBe(true);
    for (const p of ["/app", "/app/items", "/studio", "/app/settings/ai", "/app/settings", "/app/settings/billingx", "/track"]) expect(pathAllowedWhenBetaEnded(p)).toBe(false);
  });

  it("bienvenue tant que l'écran n'est pas vu ; blocage seulement si bloqué ; rien sans bêta", () => {
    expect(betaGateFor(null, "/app")).toBe("page");
    expect(betaGateFor(beta({ welcomeSeen: false }), "/app/items")).toBe("welcome");
    expect(betaGateFor(beta(), "/app/items")).toBe("page");
    expect(betaGateFor(beta({ state: "ended", blocked: true }), "/app/items")).toBe("blocked");
    expect(betaGateFor(beta({ state: "ended", blocked: true, welcomeSeen: false }), "/app/settings/invoices")).toBe("page");
    expect(betaGateFor(beta({ state: "converted", welcomeSeen: false }), "/app")).toBe("page");
    expect(isBetaEndedError(new DataError("beta_ended", "…", 402))).toBe(true);
    expect(isBetaEndedError(new DataError("quota_exceeded", "…", 402))).toBe(false);
    expect([7, 1, 0].map(daysLabel)).toEqual(["7 jours", "1 jour", "aujourd'hui"]);
  });
});

describe("bandeaux J-7 / J-1 et badge", () => {
  it("J-7 : date et lien vers le paiement ; J-1 : « demain » ; rien sans rappel", () => {
    render(<MemoryRouter><BetaReminderBanner beta={beta({ reminder: 7, daysLeft: 7 })} pathname="/app" /></MemoryRouter>);
    const seven = screen.getByTestId("beta-reminder-7");
    expect(seven.textContent).toMatch(/se termine dans 7 jours \(le 30\/12\/2026\) — ajoutez un moyen de paiement pour continuer/);
    expect(seven.querySelector("a")?.getAttribute("href")).toBe("/app/paiement");
    cleanup();
    render(<MemoryRouter><BetaReminderBanner beta={beta({ reminder: 1, daysLeft: 1 })} pathname="/app" /></MemoryRouter>);
    expect(screen.getByTestId("beta-reminder-1").textContent).toMatch(/se termine demain/);
    cleanup();
    render(<MemoryRouter><BetaReminderBanner beta={beta()} pathname="/app" /><BetaReminderBanner beta={null} pathname="/app" /></MemoryRouter>);
    expect(screen.queryByTestId("beta-reminder-7")).toBeNull();
    expect(screen.queryByTestId("beta-reminder-1")).toBeNull();
  });

  it("badge « Bêta » avec la date de fin, seulement pendant la bêta", () => {
    render(<BetaBadge beta={beta()} />);
    expect(screen.getByTestId("beta-badge").textContent).toBe("Bêta· jusqu'au 30/12/2026");
    cleanup();
    render(<BetaBadge beta={beta({ state: "ended", blocked: true })} />);
    expect(screen.queryByTestId("beta-badge")).toBeNull();
  });

  it("le bandeau d'essai s'efface devant celui de la bêta", () => {
    render(<MemoryRouter><BillingBanner s={sub()} pathname="/app" simulated beta={beta()} /></MemoryRouter>);
    expect(screen.queryByTestId("trial-simulated-banner")).toBeNull();
    cleanup();
    render(<MemoryRouter><BillingBanner s={sub()} pathname="/app" simulated beta={null} /></MemoryRouter>);
    expect(screen.getByTestId("trial-simulated-banner")).toBeTruthy();
  });
});

describe("écran « Bienvenue dans la bêta »", () => {
  it("titre, mois offert jusqu'au JJ/MM/AAAA, animation qui respecte « réduire les animations », puis « Commencer » → démarrage", async () => {
    const calls = stubApi({
      "GET /api/auth/session": () => [200, session(beta({ welcomeSeen: false }))],
      "POST /api/beta/welcome": () => [200, { beta: beta() }],
    });
    const router = renderApp([{ path: "/app/bienvenue", element: <BetaWelcome /> }, { path: "/app/onboarding", element: <p>Démarrage</p> }, { path: "/app", element: <p>Accueil</p> }], "/app/bienvenue");
    const page = await screen.findByTestId("beta-welcome");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Bienvenue dans la bêta Selio");
    expect(page.textContent).toMatch(/Votre mois de Selio Pro est offert jusqu'au 30\/12\/2026\. Rien à payer, aucune carte demandée\./);
    expect(page.textContent).toMatch(/Vos retours comptent/);
    expect(page.querySelector("svg[role=img]")).toBeTruthy();
    expect(page.querySelector("style")?.textContent).toMatch(/prefers-reduced-motion: reduce/);
    fireEvent.click(screen.getByTestId("beta-welcome-start"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/onboarding"));
    expect(calls.some((c) => c.method === "POST" && c.url === "/api/beta/welcome")).toBe(true);
  });

  it("sans bêta en cours : retour à l'application", async () => {
    stubApi({ "GET /api/auth/session": () => [200, session(null)] });
    const router = renderApp([{ path: "/app/bienvenue", element: <BetaWelcome /> }, { path: "/app", element: <p>Accueil</p> }], "/app/bienvenue");
    await waitFor(() => expect(router.state.location.pathname).toBe("/app"));
  });
});

describe("écran de blocage après la fin du mois", () => {
  const routes = [{
    path: "/app",
    element: <BetaGate><Outlet /></BetaGate>,
    children: [
      { path: "items", element: <p>Articles</p> },
      { path: "settings/invoices", element: <p>Liste des factures</p> },
    ],
  }, { path: "/app/bienvenue", element: <p>Bienvenue</p> }];

  it("toutes les pages métier : message, bouton vers le paiement, pages encore ouvertes et déconnexion", async () => {
    stubApi({ "GET /api/auth/session": () => [200, session(beta({ state: "ended", blocked: true, blockedSince: END, endsAt: null, daysLeft: null }))] });
    renderApp(routes, "/app/items");
    const box = await screen.findByTestId("beta-blocked");
    expect(box.textContent).toMatch(/Votre mois de bêta est terminé/);
    expect(box.textContent).toMatch(/Ajoutez un moyen de paiement pour continuer/);
    expect(box.textContent).toMatch(/Vos données sont conservées/);
    expect(screen.getByTestId("beta-blocked-pay").getAttribute("href")).toBe("/app/paiement");
    expect([...box.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(expect.arrayContaining(["/app/settings/billing", "/app/settings/invoices", "/app/settings/data"]));
    expect(screen.getByRole("button", { name: /Se déconnecter/ })).toBeTruthy();
    expect(screen.queryByText("Articles")).toBeNull();
  });

  it("les factures restent ouvertes", async () => {
    stubApi({ "GET /api/auth/session": () => [200, session(beta({ state: "ended", blocked: true }))] });
    renderApp(routes, "/app/settings/invoices");
    expect(await screen.findByText("Liste des factures")).toBeTruthy();
    expect(screen.queryByTestId("beta-blocked")).toBeNull();
  });

  it("un membre qui ne gère pas l'abonnement est invité à prévenir le titulaire", async () => {
    stubApi({ "GET /api/auth/session": () => [200, session(beta({ state: "ended", blocked: true }), "operator")] });
    renderApp(routes, "/app/items");
    const box = await screen.findByTestId("beta-blocked");
    expect(box.textContent).toMatch(/Demandez au titulaire du compte/);
    expect(screen.queryByTestId("beta-blocked-pay")).toBeNull();
  });

  it("écran de bienvenue pas encore vu : l'application y mène d'abord", async () => {
    stubApi({ "GET /api/auth/session": () => [200, session(beta({ welcomeSeen: false }))] });
    const router = renderApp(routes, "/app/items");
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/bienvenue"));
  });
});

describe("page de paiement factice", () => {
  const preview = (over: Partial<CheckoutPreview> = {}): CheckoutPreview => ({ plan: "pro", cycle: "monthly", planLabel: "Pro", priceCents: 2499, discount: null, dueCents: 2499, trialEndsAt: null, startsTrial: false, paymentMode: "simulated", noCardRequired: true, blockedReason: null, afterBeta: true, ...over });

  it("« Paiement en cours d'ouverture », choix du forfait, 0,00 € aujourd'hui, AUCUN champ de carte, confirmation", async () => {
    const calls = stubApi({
      "GET /api/auth/session": () => [200, session(beta({ state: "ended", blocked: true }))],
      "GET /api/capabilities": () => [200, CAPS],
      "GET /api/billing/subscription": () => [200, sub({ status: "canceled", plan: "free", awaitingPaymentSince: END })],
      "GET /api/billing/checkout/preview": () => [200, preview({ plan: "starter", planLabel: "Starter", priceCents: 699, dueCents: 699 })],
      "POST /api/billing/checkout": () => [200, { orderToken: null, orderId: null, mode: null, amountCents: 0, captureMode: null, simulated: true, message: "Forfait Starter (mensuel, 6,99 €) retenu, sans carte : rien n'est débité." }],
    });
    renderApp([{ path: "/app/paiement", element: <Payment /> }], "/app/paiement");
    const page = await screen.findByTestId("payment-page");
    expect(screen.getByTestId("payment-opening-notice").textContent).toMatch(PAYMENT_OPENING_TITLE);
    expect(PAYMENT_OPENING_TITLE).toBe("Paiement en cours d'ouverture — aucune carte n'est demandée pour l'instant");
    fireEvent.click(await screen.findByTestId("payment-plan-starter"));
    expect(screen.getByTestId("payment-plan-starter").getAttribute("aria-checked")).toBe("true");
    await waitFor(() => expect(screen.getByTestId("payment-due-today").textContent?.replace(/\s/g, " ")).toBe("0,00 €"));
    // Pas un faux formulaire de carte : aucun champ, aucun libellé de carte, aucune imitation d'un prestataire.
    expect(page.querySelectorAll("input, textarea, select, iframe").length).toBe(0);
    expect(page.textContent).not.toMatch(/num[ée]ro de carte|CVC|CVV|date d'expiration|MM\s*\/\s*AA|Stripe/i);
    fireEvent.click(screen.getByTestId("payment-confirm"));
    const done = await screen.findByTestId("payment-done");
    expect(done.textContent).toMatch(/Forfait Starter retenu/);
    expect(done.textContent).toMatch(/rien n'est débité/);
    expect(calls.find((c) => c.method === "POST" && c.url === "/api/billing/checkout")?.body).toEqual({ plan: "starter", cycle: "monthly" });
  });
});

describe("inscription avec le code", () => {
  const fill = () => {
    fireEvent.change(screen.getByLabelText(/^Votre nom/), { target: { value: "Alice" } });
    fireEvent.change(screen.getByLabelText(/^Nom de l'organisation/), { target: { value: "Boutique Alice" } });
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "alice@beta.test" } });
    fireEvent.change(screen.getByLabelText(/^Mot de passe/), { target: { value: "motdepasse-S1" } });
  };

  it("lien ?code=BETA2026SELIO : « Rejoindre la bêta Selio », puis l'écran de bienvenue", async () => {
    const calls = stubApi({
      "POST /api/offers/check-signup": () => [200, { valid: true, beta: { days: 30, plan: "pro" }, message: "Code bêta valable : Selio Pro offert pendant 30 jours, sans carte bancaire." }],
      "POST /api/auth/register": () => [201, { ...session(beta({ welcomeSeen: false })), promo: { applied: true, beta: { days: 30, plan: "pro", endsAt: END }, message: "Bienvenue dans la bêta" } }],
    });
    const router = createMemoryRouter([{ path: "/inscription", element: <Register /> }, { path: "/app/bienvenue", element: <p>Bienvenue</p> }], { initialEntries: ["/inscription?code=beta-2026-selio"] });
    render(<DataProvider forceMode="connected"><ToastProvider><RouterProvider router={router} /></ToastProvider></DataProvider>);
    expect(await screen.findByRole("heading", { name: "Rejoindre la bêta Selio" })).toBeTruthy();
    expect(screen.getByTestId("beta-terms").textContent).toMatch(/30 jours offerts, sans carte bancaire/);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Créer le compte et rejoindre la bêta" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/bienvenue"));
    expect(calls.find((c) => c.url === "/api/auth/register")?.body).toMatchObject({ promoCode: "BETA-2026-SELIO" });
  });

  it("code faux : message clair sous le champ, aucun compte créé ; champ vidé → essai normal", async () => {
    const calls = stubApi({
      "POST /api/offers/check-signup": () => [200, { valid: false, message: "Code promo inconnu. Corrigez-le, ou videz le champ pour commencer l'essai gratuit." }],
      "POST /api/auth/register": () => [201, session(null)],
    });
    const router = createMemoryRouter([{ path: "/inscription", element: <Register /> }, { path: "/app/onboarding", element: <p>Démarrage</p> }], { initialEntries: ["/inscription"] });
    render(<DataProvider forceMode="connected"><ToastProvider><RouterProvider router={router} /></ToastProvider></DataProvider>);
    fill();
    fireEvent.change(screen.getByLabelText(/^Code promo/), { target: { value: "BETA2025SELIO" } });
    fireEvent.click(screen.getByRole("button", { name: "Créer le compte et commencer l'essai" }));
    expect(await screen.findByText(/Code promo inconnu.*videz le champ pour commencer l'essai gratuit/)).toBeTruthy();
    expect(calls.some((c) => c.url === "/api/auth/register")).toBe(false);
    fireEvent.change(screen.getByLabelText(/^Code promo/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Créer le compte et commencer l'essai" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/onboarding"));
  });
});

describe("Selio Admin : comptes bêta et offre bêta", () => {
  it("statut d'un compte : bêta en cours avec sa fin, bêta terminée et bloquée", () => {
    render(<AccountStatus a={{ status: "trialing", grantedUntil: null, currentPeriodEnd: END, awaitingPaymentSince: null, betaEndsAt: END, betaBlocked: false }} />);
    expect(document.body.textContent).toMatch(/Bêta · fin 30\/12\/2026/);
    cleanup();
    render(<AccountStatus a={{ status: "canceled", grantedUntil: null, currentPeriodEnd: END, awaitingPaymentSince: END, betaEndsAt: null, betaBlocked: true }} />);
    expect(document.body.textContent).toMatch(/Bêta terminée · bloqué/);
  });

  it("Offres : la ligne bêta (accès offert, Pro, 30 jours, jamais au bandeau) et son formulaire sans remise", async () => {
    const offer = { id: "of-beta", kind: "beta", betaDays: 30, name: "Bêta Selio", code: "BETA2026SELIO", discountPercent: 100, discountCents: null, plans: ["pro"], durationMonths: 1, startsAt: null, endsAt: null, maxRedemptions: null, redemptions: 12, bannerEnabled: false, bannerText: null, active: true, createdBy: null, createdAt: END, updatedAt: END, archivedAt: null };
    const calls = stubApi({ "GET /api/auth/session": () => [200, session(null)], "GET /api/admin/offers": () => [200, [offer]], "PATCH /api/admin/offers/of-beta": () => [200, { ...offer, betaDays: 45 }] });
    renderApp([{ path: "/admin/offres", element: <AdminOffers /> }], "/admin/offres");
    const row = await screen.findByTestId("offer-row-BETA2026SELIO");
    expect(row.textContent).toMatch(/Accès offert/);
    expect(row.textContent).toMatch(/30 jours/);
    expect(row.textContent).toMatch(/Jamais/);
    expect(row.textContent).toMatch(/12/);
    fireEvent.click(screen.getByRole("button", { name: "Modifier l'offre Bêta Selio" }));
    const editor = await screen.findByTestId("beta-offer-editor");
    expect(editor.textContent).not.toMatch(/Remise \(%\)/);
    fireEvent.change(screen.getByLabelText(/^Durée de l'accès offert/), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(screen.queryByTestId("beta-offer-editor")).toBeNull());
    expect(calls.find((c) => c.method === "PATCH" && c.url === "/api/admin/offers/of-beta")?.body).toMatchObject({ betaDays: 45, code: "BETA2026SELIO", maxRedemptions: null, active: true });
  });
});
