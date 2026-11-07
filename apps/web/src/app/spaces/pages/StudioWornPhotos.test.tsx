import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@selio/ui";
import { DataProvider, getDemoClient, queryClient } from "../../../lib/data/provider";
import type * as ReduceModule from "../../../lib/studio/reduce";
import { DataError, type WornPhotosView } from "../../../lib/data/types";
import { RequireSession } from "../../layout";
import StudioWornPhotos from "./StudioWornPhotos";

// La réduction d'une photo (canvas) n'existe pas dans l'environnement de test : la photo choisie est rendue telle quelle.
vi.mock("../../../lib/studio/reduce", async (importOriginal) => ({
  ...(await importOriginal<typeof ReduceModule>()),
  reducePhoto: vi.fn(async (file: File) => ({ id: "photo-choisie", url: "data:image/jpeg;base64,/9j/4AAQ", alt: file.name, width: 10, height: 10, bytes: 10, originalWidth: 10, originalHeight: 10, quality: 0.8 })),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Une heure de jour (11 h à Paris) : hors fenêtre de nuit, la demande reste en file au lieu d'être refusée aussitôt par « noop ». */
const DAYTIME = new Date("2026-11-07T10:00:00Z");

async function demo() {
  const client = getDemoClient();
  await client.resetDemo();
  await client.login({ email: "marie@demo.selio.local", password: "demo" });
  queryClient.clear();
  return client;
}

function mount() {
  const router = createMemoryRouter([{ path: "/studio/photos-portees", element: <RequireSession><StudioWornPhotos /></RequireSession> }, { path: "*", element: <p>autre page</p> }], { initialEntries: ["/studio/photos-portees"] });
  render(
    <DataProvider forceMode="demo">
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </DataProvider>,
  );
}

describe("page Photos portées", () => {
  it("dit honnêtement qu'aucun fournisseur n'est choisi, montre le quota du plan (Pro : 10) et le prix proposé ; dépassement fermé → case désactivée", async () => {
    await demo();
    mount();
    expect(await screen.findByText("Aucun fournisseur configuré : décision à prendre")).toBeTruthy();
    expect(screen.getByText(/refusées proprement la nuit venue/)).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Photos portées ce mois-ci" }).getAttribute("aria-valuetext")).toBe("0 % (0 sur 10)");
    expect(screen.getByText("Pro : 10 par mois, Agence : 30. Une demande refusée, échouée ou annulée rend sa place.")).toBeTruthy();
    expect(screen.getByText(/Au-delà du quota : 0,25\s€ la photo/)).toBeTruthy();
    expect(screen.getByText("Proposition, prix à décider")).toBeTruthy();
    expect(screen.getByText(/Désactivé sur ce serveur : au-delà du quota, la demande est refusée, sans rien facturer/)).toBeTruthy();
    const consent = screen.getByRole("checkbox", { name: /J'accepte de payer 0,25\s€ pour cette photo au-delà de mon quota \(prix proposé, à confirmer\)/ }) as HTMLInputElement;
    expect(consent.disabled).toBe(true);
    expect(consent.checked).toBe(false);
    expect(screen.getByText(/File de nuit, entre 22 h et 6 h \(heure de Paris\)/)).toBeTruthy();
    expect(screen.getByText(/Prochain créneau/)).toBeTruthy();
    // Sans photo choisie, rien ne part.
    expect((screen.getByRole("button", { name: "Mettre en file pour la nuit" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Aucune demande")).toBeTruthy();
  });

  it("quota atteint et dépassement ouvert sur le serveur : l'accord explicite est demandé, case active", async () => {
    const client = await demo();
    const real = await client.wornPhotos();
    const open: WornPhotosView = { ...real, status: { ...real.status, counter: { used: 10, quota: 10, percent: 100, warning: true, exceeded: true }, overage: { ...real.status.overage, enabled: true, billable: true } } };
    vi.spyOn(client, "wornPhotos").mockResolvedValue(open);
    mount();
    const consent = (await screen.findByRole("checkbox", { name: /J'accepte de payer/ })) as HTMLInputElement;
    expect(consent.disabled).toBe(false);
    expect(screen.getByText(/Ouvert sur ce serveur : chaque photo de plus demande votre accord/)).toBeTruthy();
    expect(screen.getByText("Quota du mois atteint : cochez l'accord pour demander une photo de plus.")).toBeTruthy();
    fireEvent.click(consent);
    expect(consent.checked).toBe(true);
    expect(screen.queryByText("Quota du mois atteint : cochez l'accord pour demander une photo de plus.")).toBeNull();
  });

  it("quota atteint, dépassement ouvert mais abonnement sans carte : case désactivée et raison donnée", async () => {
    const client = await demo();
    const real = await client.wornPhotos();
    vi.spyOn(client, "wornPhotos").mockResolvedValue({ ...real, status: { ...real.status, counter: { used: 10, quota: 10, percent: 100, warning: true, exceeded: true }, overage: { ...real.status.overage, enabled: true, billable: false } } });
    mount();
    const consent = (await screen.findByRole("checkbox", { name: /J'accepte de payer/ })) as HTMLInputElement;
    expect(consent.disabled).toBe(true);
    expect(screen.getByText(/il faut un abonnement en cours, non résilié, avec une carte enregistrée/)).toBeTruthy();
  });

  it("liste les demandes avec leur heure prévue et leur état, et permet d'annuler une demande en file", async () => {
    // Entre 22 h et 6 h (heure de Paris), la démonstration traite la file comme le worker : « noop » refuse et rend
    // la place. Pour tester la file elle-même, l'horloge est figée en journée (seule Date est simulée).
    vi.useFakeTimers({ now: DAYTIME, toFake: ["Date"] });
    const client = await demo();
    const { key } = await client.uploadStudioPhoto({ id: "w1", url: "data:image/jpeg;base64,/9j/4AAQ", alt: "pull.jpg" });
    const job = await client.requestWornPhoto({ photoKey: key, pose: "three_quarter" });
    const cancel = vi.spyOn(client, "cancelWornPhoto");
    mount();
    const list = await screen.findByRole("list", { name: "Demandes de photos portées" });
    expect(list.textContent).toMatch(/En file pour la nuit/);
    expect(list.textContent).toMatch(/De trois quarts/);
    expect(list.textContent).toMatch(/Prévue (ce soir|demain|le \d+|dès que possible)/);
    expect(screen.getByRole("progressbar", { name: "Photos portées ce mois-ci" }).getAttribute("aria-valuetext")).toBe("10 % (1 sur 10)");
    fireEvent.click(screen.getByRole("button", { name: "Annuler la demande" }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith(job.id));
    expect(await screen.findByText("Aucune demande")).toBeTruthy();
    expect((await client.wornPhotos()).status.counter.used).toBe(0);
  });

  it("au-delà du quota, l'accord est envoyé avec le prix affiché ; refusé par le serveur après l'envoi, la photo est effacée du stockage et la case décochée", async () => {
    vi.useFakeTimers({ now: DAYTIME, toFake: ["Date"] });
    const client = await demo();
    const real = await client.wornPhotos();
    const open: WornPhotosView = { ...real, status: { ...real.status, counter: { used: 10, quota: 10, percent: 100, warning: true, exceeded: true }, overage: { ...real.status.overage, enabled: true, billable: true } } };
    vi.spyOn(client, "wornPhotos").mockResolvedValue(open);
    const upload = vi.spyOn(client, "uploadStudioPhoto");
    const request = vi.spyOn(client, "requestWornPhoto").mockRejectedValue(new DataError("overage_price_changed", "Le prix du dépassement est de 0,30 € la photo : relisez-le et confirmez à nouveau.", 409, { unitCents: 30, acceptedUnitCents: 25 }));
    const remove = vi.spyOn(client, "deleteStudioPhoto");
    mount();
    const consent = (await screen.findByRole("checkbox", { name: /J'accepte de payer 0,25/ })) as HTMLInputElement;
    fireEvent.click(consent);
    expect(consent.checked).toBe(true);
    fireEvent.change(screen.getByLabelText("Photo de l'article pour la photo portée"), { target: { files: [new File(["photo"], "pull-a-plat.jpg", { type: "image/jpeg" })] } });
    const send = (await screen.findByRole("button", { name: "Mettre en file pour la nuit" })) as HTMLButtonElement;
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    // L'accord porte le prix affiché (25 c) ; la photo part au stockage avant la demande, puis en est effacée quand la demande échoue.
    expect(upload).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ pose: "front", acceptOverage: true, acceptedUnitCents: 25 }));
    const key = (await upload.mock.results[0]!.value as { key: string }).key;
    await waitFor(() => expect(remove).toHaveBeenCalledWith(key));
    await waitFor(() => expect(consent.checked).toBe(false));
  });

  it("si le prix du dépassement a changé entre l'affichage et l'envoi, rien n'est téléversé : l'accord tombe et le nouveau prix est affiché", async () => {
    vi.useFakeTimers({ now: DAYTIME, toFake: ["Date"] });
    const client = await demo();
    const real = await client.wornPhotos();
    const at = (unitCents: number): WornPhotosView => ({ ...real, status: { ...real.status, counter: { used: 10, quota: 10, percent: 100, warning: true, exceeded: true }, overage: { ...real.status.overage, enabled: true, billable: true, unitCents } } });
    let reads = 0;
    vi.spyOn(client, "wornPhotos").mockImplementation(async () => (reads++ === 0 ? at(25) : at(30)));
    const upload = vi.spyOn(client, "uploadStudioPhoto");
    const request = vi.spyOn(client, "requestWornPhoto");
    mount();
    const consent = (await screen.findByRole("checkbox", { name: /J'accepte de payer 0,25/ })) as HTMLInputElement;
    fireEvent.click(consent);
    fireEvent.change(screen.getByLabelText("Photo de l'article pour la photo portée"), { target: { files: [new File(["photo"], "pull-a-plat.jpg", { type: "image/jpeg" })] } });
    const send = (await screen.findByRole("button", { name: "Mettre en file pour la nuit" })) as HTMLButtonElement;
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);
    // Relecture du prix avant l'envoi : 30 c ≠ 25 c affichés → rien ne part, la case est décochée, le prix relu s'affiche.
    await waitFor(() => expect((screen.getByRole("checkbox", { name: /J'accepte de payer/ }) as HTMLInputElement).checked).toBe(false));
    expect(await screen.findByRole("checkbox", { name: /J'accepte de payer 0,30/ })).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
});
