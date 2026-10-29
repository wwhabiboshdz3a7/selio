import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@selio/ui";
import { CLOUD_CONSENT_VERSION, type Plan } from "@selio/contracts";
import { DataProvider, getDemoClient, queryClient } from "../../../lib/data/provider";
import { AppLayout, RequireSession } from "../../layout";
import CloudAccounts from "../pages/CloudAccounts";
import CloudConsent from "../pages/CloudConsent";
import CloudDashboard from "../pages/CloudDashboard";
import CloudJournal from "../pages/CloudJournal";
import CloudSettings from "../pages/CloudSettings";

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal: () => void; close: () => void };
  if (typeof proto.showModal !== "function") proto.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  if (typeof proto.close !== "function") proto.close = function (this: HTMLDialogElement) { this.removeAttribute("open"); };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Démonstration fraîche ; `plan` change l'offre (opérateur), `consent` enregistre l'accord. */
async function demo({ plan, consent = false }: { plan?: Plan; consent?: boolean } = {}) {
  const client = getDemoClient();
  await client.resetDemo();
  await client.login({ email: "marie@demo.selio.local", password: "demo" });
  if (plan) await client.adminSetPlan((await client.getSession())!.org.id, plan);
  if (consent) await client.acceptCloudConsent({ version: CLOUD_CONSENT_VERSION, accepted: true });
  queryClient.clear();
  return client;
}

function mount(path: string, element: ReactNode) {
  const router = createMemoryRouter([{ path, element: <RequireSession>{element}</RequireSession> }, { path: "*", element: <p>autre page</p> }], { initialEntries: [path] });
  render(
    <DataProvider forceMode="demo">
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </DataProvider>,
  );
  return router;
}

const row = (name: RegExp) => screen.getAllByRole("listitem").find((li) => name.test(li.getAttribute("aria-label") ?? ""))!;

describe("Selio Cloud selon l'offre", () => {
  it("Pro : « en option, prix à décider », bouton de contact, rien d'activable", async () => {
    await demo();
    mount("/cloud", <CloudDashboard />);
    expect(await screen.findByText("En option avec Pro, prix à décider")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Nous contacter/ }).getAttribute("href")).toBe("/contact?sujet=selio-cloud");
    expect(screen.getByText(/Rien n'est activable ni facturé/)).toBeTruthy();
    // Chiffres en une seule carte (StatStrip), limite de 10 comptes visible.
    expect(await screen.findByText("10 comptes maximum par organisation")).toBeTruthy();
    expect(await screen.findByText("Accord à donner avant toute action")).toBeTruthy();
  });

  it("Starter : « disponible à partir de Pro » ; Agence : compris, aucun avertissement d'offre", async () => {
    await demo({ plan: "starter" });
    mount("/cloud/reglages", <CloudSettings />);
    expect(await screen.findByText("Disponible à partir de Pro")).toBeTruthy();
    expect(screen.getByText("Cloud à partir de Pro")).toBeTruthy();
    cleanup();
    await demo({ plan: "agence" });
    mount("/cloud/reglages", <CloudSettings />);
    expect(await screen.findByText("Cloud compris")).toBeTruthy();
    expect(screen.queryByText("Disponible à partir de Pro")).toBeNull();
    expect(screen.queryByText("En option avec Pro, prix à décider")).toBeNull();
    // Capacité : hypothèse à mesurer, jamais présentée comme mesurée.
    expect(screen.getByText("Hypothèse à mesurer")).toBeTruthy();
    expect(screen.getByTestId("cloud-capacity-note").textContent).toMatch(/aucun chiffre n'est mesuré/);
    // Heures actives alignées partout (contrats, API, worker, pacing) : 8 h – 23 h.
    expect(screen.getByText("8 h – 23 h")).toBeTruthy();
  });
});

describe("écran d'accord", () => {
  it("le bouton « J'active Selio Cloud » reste désactivé tant que la case n'est pas cochée, puis l'accord s'affiche avec sa date et sa version", async () => {
    const client = await demo({ plan: "agence" });
    mount("/cloud/accord", <CloudConsent />);
    expect(await screen.findByTestId("cloud-consent-text")).toBeTruthy();
    for (const title of ["Les règles de Vinted", "Une adresse partagée", "Pause au premier avertissement", "Votre responsabilité"]) expect(screen.getByText(title)).toBeTruthy();
    const button = screen.getByRole("button", { name: "J'active Selio Cloud" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect((await client.cloudConsent()).accepted).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /J'ai lu ce texte et j'accepte/ }));
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    const recorded = await screen.findByTestId("cloud-consent-recorded");
    expect(recorded.textContent).toMatch(/Accepté le \d{2}\/\d{2}\/\d{4}/);
    expect(recorded.textContent).toContain(`version ${CLOUD_CONSENT_VERSION}`);
    expect(recorded.textContent).toMatch(/par vous/);
    expect(screen.queryByRole("button", { name: "J'active Selio Cloud" })).toBeNull();
    expect((await client.cloudConsent()).current).toBe(true);
  });

  it("sur Pro, l'accord ne peut pas « activer » un Cloud qui n'est pas activable", async () => {
    await demo();
    mount("/cloud/accord", <CloudConsent />);
    expect(await screen.findByText(/n'est pas activable avec votre offre/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "J'active Selio Cloud" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("comptes Cloud", () => {
  it("sans accord, rien ne se relie ; avec l'accord, « Relier » fait passer le compte à « À connecter »", async () => {
    const client = await demo({ plan: "agence" });
    mount("/cloud/comptes", <CloudAccounts />);
    expect(await screen.findByText("Accord à donner avant toute action")).toBeTruthy();
    const purchase = () => row(/^Compte achats/);
    await waitFor(() => expect(purchase()).toBeTruthy());
    expect((within(purchase()).getByRole("button", { name: "Relier" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      await client.acceptCloudConsent({ version: CLOUD_CONSENT_VERSION, accepted: true });
    });
    await waitFor(() => expect((within(purchase()).getByRole("button", { name: "Relier" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(within(purchase()).getByRole("button", { name: "Relier" }));
    await waitFor(() => expect(within(purchase()).getByText("À connecter")).toBeTruthy());
    expect(within(purchase()).getByRole("button", { name: "Se connecter" })).toBeTruthy();
    expect(screen.getByTestId("cloud-accounts-limit").textContent).toMatch(/3\s*\/\s*10 comptes Cloud/);
  });

  it("états lisibles, niveaux d'action (lourdes à décider) et reprise acquittée après un CAPTCHA", async () => {
    await demo({ plan: "agence", consent: true });
    mount("/cloud/comptes", <CloudAccounts />);
    await waitFor(() => expect(row(/^Boutique principale/)).toBeTruthy());
    const main = row(/^Boutique principale/);
    expect(within(main).getByText("Actif")).toBeTruthy();
    expect(within(main).getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(within(main).getByRole("button", { name: "Supprimer la session" })).toBeTruthy();
    const light = within(main).getByRole("checkbox", { name: /Actions légères/ }) as HTMLInputElement;
    const heavy = within(main).getByRole("checkbox", { name: /Actions lourdes/ }) as HTMLInputElement;
    expect([light.checked, light.disabled, heavy.checked, heavy.disabled]).toEqual([true, true, false, true]);
    expect(within(main).getByText("À décider : adresse partagée")).toBeTruthy();
    expect(within(row(/^Compte perso/)).getByText(/Compte Perso : jamais utilisé/)).toBeTruthy();
    expect(within(row(/^Compte perso/)).queryByRole("button", { name: "Relier" })).toBeNull();
    expect(screen.getByText(/10 comptes Cloud maximum par organisation/)).toBeTruthy();

    const vintage = row(/^Boutique vintage/);
    expect(within(vintage).getByText("En pause")).toBeTruthy();
    expect(within(vintage).getByTestId("cloud-account-detail").textContent).toMatch(/Vinted a affiché un CAPTCHA — le /);
    fireEvent.click(within(vintage).getByRole("button", { name: "Reprendre" }));
    const dialog = await screen.findByRole("dialog", { name: "Reprendre après un signal de Vinted" });
    const confirm = within(dialog).getByRole("button", { name: "Reprendre" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /J'ai vérifié mon compte dans Vinted/ }));
    fireEvent.click(confirm);
    await waitFor(() => expect(within(row(/^Boutique vintage/)).getByText("Actif")).toBeTruthy());
  });

  it("supprimer la session demande confirmation puis repasse le compte à « À connecter »", async () => {
    const client = await demo({ plan: "agence", consent: true });
    mount("/cloud/comptes", <CloudAccounts />);
    await waitFor(() => expect(row(/^Boutique principale/)).toBeTruthy());
    fireEvent.click(within(row(/^Boutique principale/)).getByRole("button", { name: "Supprimer la session" }));
    const dialog = await screen.findByRole("dialog", { name: "Supprimer la session de ce compte ?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Supprimer la session" }));
    await waitFor(() => expect(within(row(/^Boutique principale/)).getByText("À connecter")).toBeTruthy());
    expect((await client.cloudAccounts()).find((a) => a.connectionLabel === "Boutique principale")).toMatchObject({ hasSession: false });
  });
});

describe("journal des actions", () => {
  it("paginé, filtré par statut, exportable en CSV, conservé 90 jours", async () => {
    await demo();
    const created = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:selio");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    mount("/cloud/journal", <CloudJournal />);
    const table = await screen.findByRole("table", { name: "Journal des actions Cloud" });
    expect(screen.getByTestId("cloud-journal-retention").textContent).toBe("Conservé 90 jours, puis effacé automatiquement.");
    expect(within(table).getAllByRole("row")).toHaveLength(11);
    expect(screen.getByText("1–10 sur 30")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Page suivante" }));
    expect(await screen.findByText("11–20 sur 30")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Statut"), { target: { value: "failed" } });
    expect(await screen.findByText("1–2 sur 2")).toBeTruthy();
    expect(within(screen.getByRole("table")).getAllByText("Échouée")).toHaveLength(2);
    expect(screen.getByText(/Rien n'est renvoyé automatiquement/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Exporter CSV" }));
    await waitFor(() => expect(created).toHaveBeenCalled());
    const blob = created.mock.calls[0]![0] as Blob;
    const csv = await blob.text();
    expect(csv.split(/\r?\n/).filter(Boolean)).toHaveLength(3);
    fireEvent.change(screen.getByLabelText("Statut"), { target: { value: "running" } });
    expect(await screen.findByText("Aucune action ne correspond à ces filtres")).toBeTruthy();
  });
});

describe("pause globale", () => {
  it("le tableau de bord met tout le Cloud en pause ; la mise en page l'affiche", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const client = await demo({ plan: "agence", consent: true });
    const router = createMemoryRouter([{ path: "/cloud", element: <RequireSession><AppLayout /></RequireSession>, children: [{ index: true, element: <CloudDashboard /> }] }], { initialEntries: ["/cloud"] });
    render(
      <DataProvider forceMode="demo">
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </DataProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Tout mettre en pause" }));
    const dialog = await screen.findByRole("dialog", { name: "Mettre Selio Cloud en pause ?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Tout mettre en pause" }));
    expect(await screen.findByTestId("cloud-paused-banner")).toBeTruthy();
    expect((await client.getAutomationState()).globalPaused).toBe(true);
    const menu = screen.getByRole("navigation", { name: "Navigation de l'application" });
    expect(within(within(menu).getByRole("link", { name: /Tableau de bord/ })).getByText("En pause")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Reprendre le Cloud" }));
    await waitFor(() => expect(screen.queryByTestId("cloud-paused-banner")).toBeNull());
  });
});
