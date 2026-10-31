import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@selio/ui";
import { RADAR_AUTO_SHARED_ADDRESS_NOTICE, type PurchaseRequest } from "@selio/contracts";
import { DataProvider, getDemoClient, queryClient } from "../../lib/data/provider";
import type { AutoBuyStatus, OpportunityDetail } from "../../lib/data/types";
import type { PushEnv } from "../../lib/push";
import { RequireSession } from "../layout";
import AutoBuy from "./AutoBuy";
import Radar from "./Radar";
import RadarDeal from "./RadarDeal";
import { RadarPushSettings } from "./settings/Notifications";

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal: () => void; close: () => void };
  if (typeof proto.showModal !== "function") proto.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  if (typeof proto.close !== "function") proto.close = function (this: HTMLDialogElement) { this.removeAttribute("open"); };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function demo() {
  const client = getDemoClient();
  await client.resetDemo();
  await client.login({ email: "marie@demo.selio.local", password: "demo" });
  queryClient.clear();
  return client;
}

function mount(path: string, pattern: string, element: ReactNode) {
  const router = createMemoryRouter([{ path: pattern, element: <RequireSession>{element}</RequireSession> }, { path: "*", element: <p>autre page</p> }], { initialEntries: [path] });
  render(
    <DataProvider forceMode="demo">
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </DataProvider>,
  );
  return router;
}

/** Radar Auto activable (verrou serveur ouvert, comptes de l'équipe) : seule la démonstration simulée le ferme. */
async function unlockedStatus(client: ReturnType<typeof getDemoClient>, patch: Partial<AutoBuyStatus> = {}): Promise<AutoBuyStatus> {
  const base = await client.autoBuyStatus();
  return { ...base, serverEnabled: true, locks: base.locks.map((l) => (l.key === "server" || l.key === "shared_address" ? { ...l, ok: true } : l)), ...patch };
}

describe("page d'affaire « 1 clic »", () => {
  it("photo, prix + frais + total, note expliquée, revente et méthode, vendeur, délai de détection, mention honnête", async () => {
    const client = await demo();
    const opp = (await client.listOpportunities({})).find((o) => o.observed.publishedAt && o.status === "new")!;
    mount(`/app/radar/affaires/${opp.id}`, "/app/radar/affaires/:id", <RadarDeal />);
    expect(await screen.findByRole("heading", { name: opp.title, level: 1 })).toBeTruthy();
    expect(screen.getByText("Vous achetez vous-même sur Vinted")).toBeTruthy();
    expect(screen.getByText(/L'achat réel par Selio est désactivé \(D11\)/)).toBeTruthy();
    expect(screen.getByRole("img", { name: opp.title })).toBeTruthy();
    expect(screen.getByText("= Total à payer")).toBeTruthy();
    expect(screen.getByText(`Pourquoi ${Math.round(opp.score)}/100`)).toBeTruthy();
    expect(screen.getByText("Revente estimée")).toBeTruthy();
    expect(screen.getByText("Marque et catégorie")).toBeTruthy();
    expect(screen.getByText(/· \d+ avis/)).toBeTruthy();
    expect(screen.getByText(/après la publication/)).toBeTruthy();
    // Démonstration : annonce fictive, le bouton principal ne mène nulle part.
    const open = screen.getByRole("button", { name: "Ouvrir l'annonce sur Vinted" }) as HTMLButtonElement;
    expect(open.disabled).toBe(true);
    expect(screen.getByText(/annonce fictive, aucun lien vers Vinted/)).toBeTruthy();
  });

  it("« Ouvrir l'annonce sur Vinted » : lien externe dans un nouvel onglet ; « Je l'ai achetée » reporte le prix dans Manager", async () => {
    const client = await demo();
    const opp = (await client.listOpportunities({ status: "new" })).find((o) => o.score >= 75)!;
    const real = client.getOpportunity.bind(client);
    vi.spyOn(client, "getOpportunity").mockImplementation(async (id: string) => ({ ...(await real(id)), itemUrl: "https://www.vinted.fr/items/4123456789-pull" }) as OpportunityDetail);
    mount(`/app/radar/affaires/${opp.id}`, "/app/radar/affaires/:id", <RadarDeal />);
    const link = (await screen.findByRole("link", { name: /Ouvrir l'annonce sur Vinted/ })) as HTMLAnchorElement;
    expect(link.href).toBe("https://www.vinted.fr/items/4123456789-pull");
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
    fireEvent.click(screen.getByRole("button", { name: "Je l'ai achetée" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/crée l'article « en stock » dans Manager/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Oui, je l'ai achetée" }));
    expect(await screen.findByText(/Achat enregistré ·/)).toBeTruthy();
    const itemLink = (await screen.findByRole("link", { name: "Voir l'article dans le stock" })) as HTMLAnchorElement;
    const itemId = itemLink.getAttribute("href")!.split("/").pop()!;
    expect(await client.getItem(itemId)).toMatchObject({ status: "in_stock", tags: ["radar"] });
    expect((await client.getOpportunity(opp.id)).status).toBe("purchased");
  });

  it("« Ignorer » écarte l'affaire", async () => {
    const client = await demo();
    const opp = (await client.listOpportunities({ status: "new" }))[0]!;
    mount(`/app/radar/affaires/${opp.id}`, "/app/radar/affaires/:id", <RadarDeal />);
    fireEvent.click(await screen.findByRole("button", { name: "Ignorer" }));
    await waitFor(async () => expect((await client.getOpportunity(opp.id)).status).toBe("dismissed"));
  });
});

describe("Radar Auto : verrous", () => {
  it("affiche chaque verrou, la mention de l'adresse partagée, et tout en lecture seule tant que le serveur est fermé", async () => {
    await demo();
    mount("/app/auto-buy", "/app/auto-buy", <AutoBuy />);
    const locks = await screen.findByRole("list", { name: "Verrous de Radar Auto" });
    const rows = within(locks).getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("data-lock"))).toEqual(["server", "shared_address", "organization", "cloud", "consent"]);
    expect(rows[0]!.getAttribute("data-ok")).toBe("false");
    expect(within(rows[0]!).getByText("Fermé")).toBeTruthy();
    expect(within(rows[3]!).getByRole("link", { name: "Comptes Cloud" }).getAttribute("href")).toBe("/cloud/comptes");
    expect(within(rows[4]!).getByRole("link", { name: "Accord Cloud" }).getAttribute("href")).toBe("/cloud/accord");
    expect(screen.getByText("Non activé pour les clients")).toBeTruthy();
    expect(screen.getAllByText(RADAR_AUTO_SHARED_ADDRESS_NOTICE).length).toBeGreaterThan(0);
    expect(screen.getByText("Radar Auto verrouillé")).toBeTruthy();
    expect(screen.getByTestId("auto-readonly").textContent).toMatch(/le verrou du serveur est fermé/);
    expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Seuil de note") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Lancer maintenant" }) as HTMLButtonElement).disabled).toBe(true);
    // Seuls les frais d'achat (communs au « 1 clic ») restent modifiables : un seul « Enregistrer ».
    expect(screen.getAllByRole("button", { name: "Enregistrer" })).toHaveLength(1);
    expect(screen.getByText("Achat réel désactivé (D11)")).toBeTruthy();
  });

  it("paiement en attente de validation bancaire (3-D Secure) : « J'ai validé » relance la vérification", async () => {
    const client = await demo();
    const opp = (await client.listOpportunities({ status: "new" }))[0]!;
    const waiting: PurchaseRequest & { opportunity: typeof opp } = { id: "p-3ds", orgId: opp.orgId, opportunityId: opp.id, dedupeKey: `purchase:${opp.id}`, maxPriceCents: 1800, budgetCents: 5000, status: "awaiting_3ds", mode: "auto", cancelableUntil: null, connectionId: null, checks: [], realPurchaseEnabled: true, confirmedAt: new Date().toISOString(), executedAt: null, resultNote: "Votre banque demande une validation 3-D Secure.", totalCents: 1800, awaiting3dsUntil: new Date(Date.now() + 9 * 60_000).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), opportunity: opp };
    vi.spyOn(client, "listPurchaseRequests").mockResolvedValue([waiting]);
    const resume = vi.spyOn(client, "resumePurchase").mockResolvedValue({ queued: true, purchase: waiting });
    mount("/app/radar/achats/p-3ds", "/app/radar/achats/:id", <AutoBuy />);
    const row = await screen.findByRole("listitem", { name: `Achat ${opp.title}` });
    expect(within(row).getByText("En attente de validation bancaire (3-D Secure)")).toBeTruthy();
    expect(within(row).getByText(/Encore \d+ min pour valider/)).toBeTruthy();
    expect(row.className).toMatch(/ring-1/);
    fireEvent.click(within(row).getByRole("button", { name: "J'ai validé" }));
    await waitFor(() => expect(resume).toHaveBeenCalledWith("p-3ds"));
    expect(await screen.findByText(/Vérification du paiement lancée/)).toBeTruthy();
  });

  it("verrou serveur ouvert : réglages modifiables par le propriétaire", async () => {
    const client = await demo();
    vi.spyOn(client, "autoBuyStatus").mockResolvedValue(await unlockedStatus(client));
    mount("/app/auto-buy", "/app/auto-buy", <AutoBuy />);
    await screen.findByRole("list", { name: "Verrous de Radar Auto" });
    expect(screen.queryByTestId("auto-readonly")).toBeNull();
    expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("Radar : recherches, priorité et mesures", () => {
  it("recherche en direct : source, intervalle effectif, facteur de ralentissement, dernier blocage, compte Achat à relier au Cloud", async () => {
    await demo();
    mount("/app/radar", "/app/radar", <Radar />);
    const live = (await screen.findAllByRole("group")).find((g) => /En direct · Selio Cloud/.test(g.textContent ?? ""))!;
    expect(within(live).getByText(/Toutes les/).textContent).toMatch(/2 min/);
    expect(within(live).getByText(/ralenti × 2 après un blocage/)).toBeTruthy();
    expect(within(live).getByText(/dernier blocage/)).toBeTruthy();
    expect(await within(live).findByText(/Radar en direct demande Selio Cloud activé sur le compte Achat/)).toBeTruthy();
    expect(within(live).getByRole("link", { name: "Comptes Cloud" }).getAttribute("href")).toBe("/cloud/comptes");
    // Priorité invisible tant que Radar Auto n'est pas activable.
    expect(within(live).queryByText("Prioritaire")).toBeNull();
  });

  it("mesures de démonstration marquées « Démo » ; « à mesurer » sans lecture en direct", async () => {
    const client = await demo();
    mount("/app/radar", "/app/radar", <Radar />);
    const panel = await screen.findByRole("region", { name: "Mesures" });
    expect(await within(panel).findByText("Démo")).toBeTruthy();
    expect(within(panel).getByText(/Démo : chiffres fictifs/)).toBeTruthy();
    cleanup();
    vi.spyOn(client, "radarMetrics").mockResolvedValue({ days: 30, status: "to_measure", label: "à mesurer", liveReads: 0, blocks: 0, blockRatePer1000: null, medianPublishToDetectSeconds: null, medianDetectToPurchaseSeconds: null, readsPerDay: [], searches: [] });
    queryClient.clear();
    mount("/app/radar", "/app/radar", <Radar />);
    await screen.findByText("À mesurer");
    expect(screen.getAllByText("à mesurer")).toHaveLength(4);
    for (const label of ["Publication → détection", "Détection → achat", "Blocages pour 1 000 pages", "Lectures par jour"]) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByText("Démo")).toBeNull();
  });

  it("4e recherche prioritaire refusée : le réglage est grisé avec l'explication", async () => {
    const client = await demo();
    for (const name of ["P1", "P2", "P3"]) await client.createSearch({ name, criteria: { maxPriceCents: 2000 }, source: "cloud", priority: true });
    vi.spyOn(client, "autoBuyStatus").mockResolvedValue(await unlockedStatus(client));
    mount("/app/radar", "/app/radar", <Radar />);
    expect((await screen.findAllByText("Prioritaire")).length).toBe(3);
    fireEvent.click(screen.getByRole("button", { name: "Nouvelle recherche" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: "En direct (Selio Cloud)" }));
    const toggle = within(dialog).getByRole("switch", { name: /Recherche prioritaire/ }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(within(dialog).getByText(/3 recherches prioritaires au plus/)).toBeTruthy();
    // Et le client refuse aussi une 4e priorité envoyée directement (même règle que le serveur).
    await expect(client.createSearch({ name: "P4", criteria: { maxPriceCents: 2000 }, source: "cloud", priority: true })).rejects.toMatchObject({ code: "validation" });
  });
});

/** Appareil simulé : PushManager, service worker prêt, permission accordée au clic. */
function fakeEnv() {
  let current: PushSubscription | null = null;
  const endpoint = "https://fcm.googleapis.com/fcm/send/telephone-1";
  const pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async () => (current = { endpoint, toJSON: () => ({ endpoint, keys: { p256dh: "BCdemoCleP256dh0123456789", auth: "authdemo1234" } }), unsubscribe: vi.fn(async () => { current = null; return true; }) } as unknown as PushSubscription)),
  };
  const registration = { pushManager, showNotification: vi.fn(async () => undefined) } as unknown as ServiceWorkerRegistration;
  const notification = { permission: "default" as NotificationPermission, requestPermission: vi.fn(async () => { notification.permission = "granted"; return "granted" as const; }) };
  const env: PushEnv = { isSecureContext: true, serviceWorker: { ready: Promise.resolve(registration), getRegistration: async () => registration } as unknown as PushEnv["serviceWorker"], hasPushManager: true, Notification: notification as unknown as PushEnv["Notification"], userAgent: "Test" };
  return { env, pushManager, registration, endpoint };
}

describe("Paramètres › Notifications : alertes Radar sur ce téléphone", () => {
  it("abonnement (PushManager simulé) : permission, clé publique du serveur, abonnement envoyé à l'API, test", async () => {
    const client = await demo();
    const device = fakeEnv();
    vi.spyOn(client, "pushConfig").mockResolvedValue({ enabled: true, publicKey: `B${"A".repeat(86)}` /* factice : aucune clé VAPID réelle dans le dépôt */, reason: null });
    const subscribe = vi.spyOn(client, "subscribePush");
    const test = vi.spyOn(client, "testPush").mockResolvedValue({ devices: 1, sent: 1, failed: 0, disabled: 0 });
    mount("/app/settings/notifications", "/app/settings/notifications", <RadarPushSettings env={device.env} />);
    expect(await screen.findByText("Alertes Radar sur ce téléphone")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Envoyer une notification de test" }) as HTMLButtonElement).disabled).toBe(true);
    const enable = await screen.findByRole("button", { name: "Activer les alertes sur ce téléphone" });
    await waitFor(() => expect((enable as HTMLButtonElement).disabled).toBe(false));
    await act(async () => { fireEvent.click(enable); });
    await waitFor(() => expect(subscribe).toHaveBeenCalledWith({ endpoint: device.endpoint, keys: { p256dh: "BCdemoCleP256dh0123456789", auth: "authdemo1234" }, userAgent: "Test" }));
    expect(device.pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(await screen.findByText("Activées sur cet appareil")).toBeTruthy();
    const send = screen.getByRole("button", { name: "Envoyer une notification de test" }) as HTMLButtonElement;
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);
    await waitFor(() => expect(test).toHaveBeenCalled());
    expect(await screen.findByText("Notification de test envoyée à 1 appareil(s)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Désactiver sur ce téléphone" })).toBeTruthy();
  });

  it("serveur sans clés ou navigateur sans PushManager : désactivé, avec l'explication", async () => {
    const client = await demo();
    vi.spyOn(client, "pushConfig").mockResolvedValue({ enabled: false, publicKey: null, reason: "Les notifications ne sont pas configurées sur ce serveur (clés VAPID absentes)." });
    mount("/app/settings/notifications", "/app/settings/notifications", <RadarPushSettings env={fakeEnv().env} />);
    expect(await screen.findByText("Notifications indisponibles sur ce serveur")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Activer les alertes sur ce téléphone" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    queryClient.clear();
    const noPush = { ...fakeEnv().env, hasPushManager: false };
    mount("/app/settings/notifications", "/app/settings/notifications", <RadarPushSettings env={noPush} />);
    expect(await screen.findByText("Ce navigateur ne reçoit pas les notifications")).toBeTruthy();
    await waitFor(() => expect((screen.getByRole("button", { name: "Activer les alertes sur ce téléphone" }) as HTMLButtonElement).disabled).toBe(true));
  });

  it("démonstration : explication, rien n'est envoyé, aperçu en bandeau sans permission ; seuil et heures calmes", async () => {
    const client = await demo();
    mount("/app/settings/notifications", "/app/settings/notifications", <RadarPushSettings env={{ ...fakeEnv().env, Notification: null, hasPushManager: false }} />);
    expect(await screen.findByText("Démonstration : rien n'est envoyé")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Envoyer une notification de test" }));
    const preview = await screen.findByRole("status", { name: "Aperçu de la notification" });
    expect(within(preview).getByText("Selio Radar : notification de test")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Note minimale d'une alerte"), { target: { value: "88" } });
    fireEvent.click(screen.getByRole("switch", { name: /Heures calmes/ }));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(async () => expect((await client.getSession())!.org.settings.radar).toMatchObject({ alertMinScore: 88, quietHours: { from: 22, to: 8 } }));
  });
});
