import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, RouterProvider, createMemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@selio/ui";
import { LEGACY_SERVER_CAPABILITIES, SIMULATED_PAYMENT_NOTICE, quotasForPlan, type CheckoutPreview, type ServerCapabilities, type Subscription } from "@selio/contracts";
import { DataProvider, queryClient } from "../lib/data/provider";
import { ApiClient } from "../lib/api/client";
import { DataError } from "../lib/data/types";
import { isServerOutdated } from "../lib/admin";
import { isFeatureLive } from "../lib/capabilities";
import { BillingBanner, spaceNoteFor } from "./layout";
import { offerAction, SimulatedCheckoutDialog } from "./pages/settings/Billing";
import { InviteResult } from "./pages/settings/Access";
import AdminAccounts from "./pages/admin/Accounts";
import { isTrackLive } from "./pages/track/shared";
import { spaceStateLabel } from "./spaces/spaces";

/**
 * Mode connecté sans démo : paiement simulé (aucune carte, aucun débit), capacités du serveur, serveur pas à
 * jour dans Selio Admin, lien d'invitation à copier, états « En cours d'activation ».
 */
const NOW = new Date("2026-11-16T10:00:00Z");

function sub(over: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1", orgId: "org-1", plan: "pro", status: "trialing", provider: "none", externalRef: null, currentPeriodEnd: "2026-11-30T10:00:00Z",
    quotas: quotasForPlan("pro"), cardOnFile: false, cancelAtPeriodEnd: false, testMode: true, revolutCustomerId: null, paymentMethodId: null,
    cycle: "monthly", pendingPlan: null, chargeAttempts: 0, nextChargeAt: null, lastChargeError: null, dataRetentionUntil: null,
    createdAt: "2026-11-16T00:00:00Z", updatedAt: "2026-11-16T00:00:00Z", ...over,
  };
}

const CAPS: ServerCapabilities = { demo: false, version: "0.1.0", trackLive: false, cloud: false, radarLive: false, vision: false, pricingModel: false, payment: "simulated", paymentSandbox: null, email: false };

/** API simulée : chaque route renvoie [statut, corps] ; les appels sont gardés. */
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

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal: () => void; close: () => void };
  if (typeof proto.showModal !== "function") proto.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  if (typeof proto.close !== "function") proto.close = function (this: HTMLDialogElement) { this.removeAttribute("open"); };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  queryClient.clear();
});

describe("paiement simulé : boutons et bandeaux", () => {
  it("on choisit son offre sans carte : jamais « Payer » ni « Enregistrer ma carte »", () => {
    expect(offerAction(sub(), "starter", NOW, true)).toEqual({ kind: "button", label: "Choisir cette offre" });
    expect(offerAction(sub({ pendingPlan: "agence" }), "agence", NOW, true)).toEqual({ kind: "pending", label: "Offre retenue" });
    expect(offerAction(sub({ status: "canceled", plan: "free" }), "pro", NOW, true)).toEqual({ kind: "button", label: "Choisir cette offre" });
    // Sans paiement simulé, le parcours Revolut reste inchangé.
    expect(offerAction(sub(), "starter", NOW)).toEqual({ kind: "button", label: "Enregistrer ma carte" });
  });

  it("bandeau : « Choisissez votre offre » sans carte pendant l'essai ; « en attente du paiement » à la fin", () => {
    render(<MemoryRouter><BillingBanner s={sub()} pathname="/app" simulated /></MemoryRouter>);
    expect(screen.getByTestId("trial-simulated-banner").textContent).toMatch(/aucune carte demandée, rien ne sera débité/);
    expect(screen.queryByTestId("trial-card-banner")).toBeNull();
    cleanup();
    render(<MemoryRouter><BillingBanner s={sub({ pendingPlan: "starter" })} pathname="/app" simulated /></MemoryRouter>);
    expect(screen.queryByTestId("trial-simulated-banner")).toBeNull();
    cleanup();
    render(<MemoryRouter><BillingBanner s={sub({ status: "canceled", plan: "free", awaitingPaymentSince: "2026-11-30T10:00:00Z" })} pathname="/app" /></MemoryRouter>);
    expect(screen.getByTestId("awaiting-payment-banner").textContent).toMatch(/Essai terminé, en attente du paiement/);
  });

  it("récapitulatif puis confirmation : forfait, prix, remise, fin d'essai ; aucun champ de carte", async () => {
    const preview: CheckoutPreview = { plan: "pro", cycle: "monthly", planLabel: "Pro", priceCents: 2999, discount: { label: "Remise : Lancement −20 %", amountCents: 600 }, dueCents: 2399, trialEndsAt: "2026-11-30T10:00:00Z", startsTrial: false, paymentMode: "simulated", noCardRequired: true, blockedReason: null };
    stubApi({ "GET /api/billing/checkout/preview": () => [200, preview] });
    const onConfirm = vi.fn();
    render(<DataProvider forceMode="connected"><SimulatedCheckoutDialog plan="pro" cycle="monthly" onClose={() => {}} onConfirm={onConfirm} confirming={false} /></DataProvider>);
    const box = await screen.findByTestId("simulated-checkout");
    await waitFor(() => expect(box.textContent).toMatch(/Première échéance/));
    expect(box.textContent).toMatch(/Paiement pas encore activé/);
    expect(box.textContent).toMatch(/Aucune carte demandée, rien ne sera débité/);
    expect(box.textContent).toMatch(/Lancement −20 %/);
    expect(box.textContent).toMatch(/30 novembre 2026/);
    // Ce n'est pas un faux formulaire de carte : aucun champ à remplir.
    expect(within(box).queryAllByRole("textbox")).toHaveLength(0);
    expect(document.querySelectorAll("input").length).toBe(0);
    fireEvent.click(screen.getByTestId("simulated-confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(SIMULATED_PAYMENT_NOTICE).toMatch(/aucune carte demandée, rien ne sera débité/);
  });

  it("essai terminé : la confirmation est bloquée avec la raison", async () => {
    stubApi({ "GET /api/billing/checkout/preview": () => [200, { plan: "pro", cycle: "monthly", planLabel: "Pro", priceCents: 2999, discount: null, dueCents: 2999, trialEndsAt: null, startsTrial: false, paymentMode: "simulated", noCardRequired: true, blockedReason: "Votre essai est terminé et le paiement n'est pas encore activé." }] });
    render(<DataProvider forceMode="connected"><SimulatedCheckoutDialog plan="pro" cycle="monthly" onClose={() => {}} onConfirm={() => {}} confirming={false} /></DataProvider>);
    expect(await screen.findByText(/Votre essai est terminé/)).toBeTruthy();
    expect((screen.getByTestId("simulated-confirm") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("capacités du serveur et serveur pas à jour", () => {
  it("API plus ancienne que le frontal : capacités prudentes au lieu d'une erreur", async () => {
    stubApi({});
    expect(await new ApiClient("").getCapabilities()).toEqual(LEGACY_SERVER_CAPABILITIES);
    stubApi({ "GET /api/capabilities": () => [200, CAPS] });
    expect(await new ApiClient("").getCapabilities()).toEqual(CAPS);
  });

  it("démonstration : tout est visible ; mode connecté : seulement ce qui est branché", () => {
    expect(isFeatureLive(undefined, "trackLive", "demo")).toBe(true);
    expect(isFeatureLive(CAPS, "trackLive", "connected")).toBe(false);
    expect(isFeatureLive({ ...CAPS, cloud: true }, "cloud", "connected")).toBe(true);
    expect(isFeatureLive(undefined, "vision", "connected")).toBe(false);
    expect(isTrackLive({ source: "demo" }, "connected")).toBe(false);
    expect(isTrackLive({ source: "cloud" }, "connected")).toBe(true);
    expect(isTrackLive({ source: "demo" }, "demo")).toBe(true);
  });

  it("404 « Route inconnue » = serveur pas à jour ; un 404 métier n'en est pas un", () => {
    expect(isServerOutdated(new DataError("not_found", "Route inconnue : GET /api/admin/accounts", 404))).toBe(true);
    expect(isServerOutdated(new DataError("not_found", "Compte introuvable.", 404))).toBe(false);
    expect(isServerOutdated(new DataError("forbidden", "Accès réservé", 403))).toBe(false);
  });

  it("Selio Admin › Comptes sur une API ancienne : « Le serveur n'est pas à jour », pas une liste vide", async () => {
    stubApi({});
    const router = createMemoryRouter([{ path: "/admin/comptes", element: <AdminAccounts /> }], { initialEntries: ["/admin/comptes"] });
    render(<DataProvider forceMode="connected"><ToastProvider><RouterProvider router={router} /></ToastProvider></DataProvider>);
    const box = await screen.findByTestId("server-outdated");
    expect(box.textContent).toMatch(/Le serveur n'est pas à jour : relancez la mise à jour/);
    expect(screen.queryByText(/Aucun compte ne correspond/)).toBeNull();
  });
});

describe("invitation : lien à copier (email pas encore branché)", () => {
  it("nouveau compte : lien affiché et copiable ; compte existant : ajouté, aucun lien", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const link = "https://seliovprod.netlify.app/invitation?token=abcdefghijklmnopqrstuvwxyz0123456789";
    render(<InviteResult email="nouvelle@exemple.fr" invite={{ link, expiresAt: "2026-11-23T10:00:00Z", existingAccount: false, emailDelivered: false }} onClose={() => {}} />);
    const box = screen.getByTestId("invite-link");
    expect((within(box).getByLabelText("Lien d'invitation") as HTMLInputElement).value).toBe(link);
    expect(box.textContent).toMatch(/Aucun email n'est parti/);
    fireEvent.click(within(box).getByRole("button", { name: /Copier le lien/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(link));
    cleanup();
    render(<InviteResult email="elias@exemple.fr" invite={{ link: null, expiresAt: null, existingAccount: true, emailDelivered: false }} onClose={() => {}} />);
    expect(screen.getByText(/a déjà un compte Selio/)).toBeTruthy();
    expect(screen.queryByTestId("invite-link")).toBeNull();
  });
});

describe("mode connecté : plus d'étiquettes « aperçu » ni « en développement »", () => {
  it("libellés des espaces et note sous le sélecteur selon le mode", () => {
    expect(spaceStateLabel("development", "demo")).toBe("En développement");
    expect(spaceStateLabel("preview", "demo")).toBe("Aperçu");
    expect(spaceStateLabel("development", "connected")).toBe("Disponible prochainement");
    expect(spaceStateLabel("preview", "connected")).toBe("En cours d'activation");
    expect(spaceNoteFor("track", "connected", CAPS)).toEqual({ label: "En cours d'activation", text: expect.stringMatching(/créer vos filtres/) });
    expect(spaceNoteFor("track", "connected", { ...CAPS, trackLive: true })).toBeNull();
    expect(spaceNoteFor("agents", "connected", CAPS)).toBeNull();
    expect(spaceNoteFor("agents", "demo", CAPS)?.label).toBe("Aperçu");
  });
});
