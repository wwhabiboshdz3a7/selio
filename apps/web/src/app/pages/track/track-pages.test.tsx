import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@selio/ui";
import { PRICE_MODEL_DEMO_DATA, PRICE_MODEL_NOT_TRAINED, TRACK_SELLER_ANALYSIS_NOTICE, TRACK_UNAVAILABLE_MESSAGE, type PriceEstimate } from "@selio/contracts";
import { DataProvider, getDemoClient, queryClient } from "../../../lib/data/provider";
import { DataError } from "../../../lib/data/types";
import { RequireSession } from "../../layout";
import { PriceEstimateView } from "../../components/pricing";
import ItemDetail from "../ItemDetail";
import ItemForm from "../ItemForm";
import Ai from "../settings/Ai";
import TrackDashboard from "./Dashboard";
import TrackFilterDetail from "./FilterDetail";
import TrackFilters from "./Filters";
import TrackNiches from "./Niches";
import TrackPhoto from "./Photo";
import TrackSales from "./Sales";
import TrackSellers from "./Sellers";

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal: () => void; close: () => void };
  if (typeof proto.showModal !== "function") proto.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
  if (typeof proto.close !== "function") proto.close = function (this: HTMLDialogElement) { this.removeAttribute("open"); };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function demo(plan?: "starter" | "pro" | "agence") {
  const client = getDemoClient();
  await client.resetDemo();
  await client.login({ email: "marie@demo.selio.local", password: "demo" });
  if (plan) await client.adminSetPlan((await client.getSession())!.org.id, plan);
  queryClient.clear();
  return client;
}

/** Montants « fr-FR » : espaces insécables remplacées par des espaces simples. */
const spaces = (s: string | null) => (s ?? "").replace(/[\u00a0\u202f]/g, " ");

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

describe("Selio Track : tableau de bord et offre", () => {
  it("filtres suivis avec tendance, quotas du mois et source « simulateur »", async () => {
    await demo("pro");
    mount("/track", "/track", <TrackDashboard />);
    expect(await screen.findByRole("heading", { name: "Tableau de bord", level: 1 })).toBeTruthy();
    // Quotas du mois (un seul bandeau d'indicateurs) : 2 filtres sur 5, 0 scan sur 10, 0 recherche sur 30.
    expect(screen.getByText("2 / 5")).toBeTruthy();
    expect(screen.getByText("0 / 10")).toBeTruthy();
    expect(screen.getByText("0 / 30")).toBeTruthy();
    expect(screen.getByText("3 mois")).toBeTruthy();
    // Source : le simulateur, la lecture en direct attend l'avis de l'avocat.
    expect(screen.getByText("Simulateur")).toBeTruthy();
    expect(screen.getByText(/attend l'avis de l'avocat/)).toBeTruthy();
    expect(await screen.findByRole("link", { name: /Levi's 501 · Homme/ })).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText(/disparues \(estimation\)/).length).toBe(2));
  });

  it("free et Starter : page d'explication « compris à partir de Pro », sans appel aux données Track", async () => {
    const client = await demo("starter");
    const filters = vi.spyOn(client, "trackFilters");
    mount("/track", "/track", <TrackDashboard />);
    expect(await screen.findByRole("heading", { name: TRACK_UNAVAILABLE_MESSAGE })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Voir les offres" }).getAttribute("href")).toBe("/app/settings/billing");
    expect(screen.getByRole("columnheader", { name: "Pro" })).toBeTruthy();
    expect(filters).not.toHaveBeenCalled();
  });

  it("Agence : l'analyse d'un vendeur concurrent n'est qu'un écran « à valider juridiquement (RGPD) » ; Pro : réservé à Agence", async () => {
    await demo("agence");
    mount("/track/vendeurs", "/track/vendeurs", <TrackSellers />);
    expect(await screen.findByText("À valider juridiquement (RGPD)")).toBeTruthy();
    expect(screen.getByText(TRACK_SELLER_ANALYSIS_NOTICE)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    cleanup();
    await demo("pro");
    mount("/track/vendeurs", "/track/vendeurs", <TrackSellers />);
    expect(await screen.findByText("Compris dans l'offre Agence.")).toBeTruthy();
  });
});

describe("Selio Track : filtres suivis", () => {
  it("quota 5 visible, « lu toutes les 2 h, partagé entre clients », 402 du serveur affiché dans le formulaire", async () => {
    const client = await demo("pro");
    vi.spyOn(client, "createTrackFilter").mockRejectedValue(new DataError("quota_exceeded", "Quota de filtres suivis atteint (5) : retirez un filtre pour en suivre un autre.", 402));
    mount("/track/filtres", "/track/filtres", <TrackFilters />);
    expect(await screen.findByRole("heading", { name: "Filtres suivis", level: 1 })).toBeTruthy();
    expect(screen.getByText(/lu toutes les 2 h, partagé entre clients/)).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Filtres suivis" }).getAttribute("aria-valuetext")).toBe("40 % (2 sur 5)");
    fireEvent.click(screen.getByRole("button", { name: "Nouveau filtre" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Nom/), { target: { value: "Zara · Femme" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Suivre ce filtre" }));
    expect(await within(dialog).findByText("Limite de votre offre")).toBeTruthy();
    expect(within(dialog).getByText(/Quota de filtres suivis atteint \(5\)/)).toBeTruthy();
  });

  it("limite atteinte : bouton « Nouveau filtre » coupé et lien vers l'offre Agence", async () => {
    const client = await demo("pro");
    for (let i = 0; i < 3; i++) await client.createTrackFilter({ name: `Filtre ${i}`, criteria: { brands: [`Marque ${i}`] } });
    mount("/track/filtres", "/track/filtres", <TrackFilters />);
    expect(await screen.findByText(/Quota atteint \(5 \/ 5\)/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Nouveau filtre" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("link", { name: "Voir les offres" })).toBeTruthy();
  });
});

describe("Selio Track : tendances d'un filtre et flux des ventes", () => {
  it("prix médian, annonces actives, nouvelles, disparues « estimation », parts de marques ; périodes bornées à l'historique", async () => {
    const client = await demo("pro");
    const f = (await client.trackFilters())[0]!;
    mount(`/track/filtres/${f.id}`, "/track/filtres/:id", <TrackFilterDetail />);
    expect(await screen.findByRole("heading", { name: f.name, level: 1 })).toBeTruthy();
    expect(await screen.findByText("Prix médian")).toBeTruthy();
    for (const label of ["Annonces actives", "Nouvelles annonces", "Disparues (estimation)"]) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(screen.getByText("Parts de marques")).toBeTruthy();
    expect(screen.getByText(/Données de démonstration : le simulateur remplace la lecture des pages/)).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Période" })).toBeTruthy();
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual(["7 jours", "30 jours", "90 jours"]);
  });

  it("Agence : flux agrégé par marque et catégorie, sans vendeur ; Pro : réservé à Agence", async () => {
    await demo("agence");
    mount("/track/ventes", "/track/ventes", <TrackSales />);
    expect(await screen.findByRole("heading", { name: "Flux des ventes", level: 1 })).toBeTruthy();
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Marque", "Catégorie", "Ventes", "Dont estimées", "Prix médian", "Dernière vente"]);
    expect(within(table).queryByText(/vendeur_|sellerHandle/)).toBeNull();
    cleanup();
    await demo("pro");
    mount("/track/ventes", "/track/ventes", <TrackSales />);
    expect(await screen.findByText("Compris dans l'offre Agence.")).toBeTruthy();
  });
});

describe("Selio Track : scans de niche", () => {
  it("note sur 100 avec ses composantes, historique et quota", async () => {
    await demo("pro");
    mount("/track/niches", "/track/niches", <TrackNiches />);
    expect(await screen.findByRole("heading", { name: "Scans de niche", level: 1 })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Marque/), { target: { value: "Nike" } });
    fireEvent.change(screen.getByLabelText("Catégorie"), { target: { value: "shoes" } });
    fireEvent.click(screen.getByRole("button", { name: "Scanner" }));
    const result = await screen.findByLabelText("Résultat du scan Nike · Chaussures", {}, { timeout: 3000 });
    expect(within(result).getByRole("list", { name: "Composantes de la note" })).toBeTruthy();
    for (const label of ["Demande", "Vitesse de vente", "Concurrence", "Marge"]) expect(within(result).getByText(label)).toBeTruthy();
    expect(within(result).getByText("Données de démonstration")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("progressbar", { name: "Scans de niche du mois" }).getAttribute("aria-valuetext")).toBe("10 % (1 sur 10)"));
  });

  it("402 (quota du mois) : message de l'offre affiché", async () => {
    const client = await demo("pro");
    vi.spyOn(client, "runNicheScan").mockRejectedValue(new DataError("quota_exceeded", "Quota de scans de niche du mois atteint (10).", 402));
    mount("/track/niches", "/track/niches", <TrackNiches />);
    fireEvent.click(await screen.findByRole("button", { name: "Scanner" }));
    expect(await screen.findByText("Limite de votre offre")).toBeTruthy();
    expect(screen.getAllByText("Quota de scans de niche du mois atteint (10).").length).toBeGreaterThan(0);
  });
});

describe("Selio Track : recherche par photo", () => {
  it("réduit la photo dans le navigateur (≤ 1 200 px), appelle l'API une seule fois et affiche fourchette, stratégies et délai", async () => {
    const client = await demo("pro");
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 4000, height: 3000, close: vi.fn() })));
    const draw = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillStyle: "", fillRect: vi.fn(), drawImage: draw } as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,UkVEVUlURQ==");
    const search = vi.spyOn(client, "trackPhotoSearch");
    mount("/track/photo", "/track/photo", <TrackPhoto />);
    expect(await screen.findByRole("heading", { name: "Recherche par photo", level: 1 })).toBeTruthy();
    expect(screen.getAllByText(/La photo n'est pas conservée/).length).toBeGreaterThan(0);
    const file = new File([new Uint8Array(5_000)], "levis-501.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Choisir une photo"), { target: { files: [file] } });
    expect(await screen.findByText("Réduite à 1200 × 900 px (d'origine 4000 × 3000)")).toBeTruthy();
    expect(draw).toHaveBeenCalledWith(expect.anything(), 0, 0, 1200, 900);
    fireEvent.change(screen.getByLabelText("Marque (facultatif)"), { target: { value: "Levi's" } });
    fireEvent.click(screen.getByRole("button", { name: "Estimer le prix" }));
    const result = await screen.findByLabelText("Résultat de la recherche par photo", {}, { timeout: 4000 });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0]![0]).toEqual({ photo: "data:image/jpeg;base64,UkVEVUlURQ==", hints: { brand: "Levi's", notes: undefined } });
    // La photo réduite est oubliée dès la réponse : plus d'aperçu, et l'estimation affichée.
    expect(screen.queryByText(/Réduite à 1200/)).toBeNull();
    expect(within(result).getByText("Description lue")).toBeTruthy();
    const strategies = within(result).getByRole("list", { name: "Trois stratégies de prix" });
    for (const label of ["Vente rapide", "Standard", "Marge maximale"]) expect(within(strategies).getByText(label)).toBeTruthy();
    expect(within(result).getByText(/^P25/)).toBeTruthy();
    expect(within(result).getAllByText("Délai de vente estimé").length).toBeGreaterThan(0);
    expect(within(result).getAllByText("Ventes comparables et modèle de prix").length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByRole("progressbar", { name: "Recherches par photo du mois" }).getAttribute("aria-valuetext")).toBe("3 % (1 sur 30)"));
    // Rien de la photo n'est gardé dans la démonstration.
    expect(JSON.stringify(localStorage)).not.toContain("UkVEVUlURQ");
  });
});

describe("prix conseillés", () => {
  const estimate: PriceEstimate = {
    p25: 1800, p50: 2400, p75: 3100, delayDays: 8.6, confidence: 0.62, confidenceLevel: "medium", method: "comparables",
    strategies: { fast: 1790, standard: 2390, max: 3090 }, comparableCount: 7, modelVersion: null,
    explanation: "Sept ventes comparables de la même marque situent ce pull autour de 23,90 €.", explanationSource: "ai", factors: [], demo: false, message: null,
  };

  it("trois stratégies, explication en mots, méthode, confiance et « modèle non entraîné »", () => {
    const apply = vi.fn();
    render(<PriceEstimateView estimate={estimate} modelStatus={{ trained: false, version: null, trainedAt: null, nReferences: 0, metrics: null, synthetic: false, label: PRICE_MODEL_NOT_TRAINED }} onApply={apply} floorCents={2000} />);
    const list = screen.getByRole("list", { name: "Trois stratégies de prix" });
    expect(within(list).getAllByRole("listitem").map((li) => spaces(li.getAttribute("aria-label")))).toEqual(["Vente rapide : 17,90 €", "Standard : 23,90 €", "Marge maximale : 30,90 €"]);
    // Sous le plancher : la stratégie ne s'applique pas.
    expect((screen.getByRole("button", { name: /^Appliquer vente rapide/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /^Appliquer standard/ }));
    expect(apply).toHaveBeenCalledWith(2390, "standard");
    expect(screen.getAllByText(PRICE_MODEL_NOT_TRAINED).length).toBeGreaterThan(0);
    expect(screen.getByText(/Modèle non entraîné : Le prix conseillé vient des ventes comparables seulement/)).toBeTruthy();
    expect(screen.getByText("Expliqué par mon IA perso")).toBeTruthy();
    expect(screen.getByText(/L'explication ne change pas le prix/)).toBeTruthy();
    expect(screen.getByText("Moyenne (62 %)")).toBeTruthy();
  });

  it("pas assez de références : aucun prix proposé, à fixer à la main", () => {
    render(<PriceEstimateView estimate={{ ...estimate, p25: null, p50: null, p75: null, method: "none", strategies: null, explanation: null, message: "Pas assez de références pour proposer un prix : fixez-le à la main." }} />);
    expect(screen.getByText("Pas assez de références pour proposer un prix : fixez-le à la main.")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Trois stratégies de prix" })).toBeNull();
  });

  it("Manager › article : panneau « Prix conseillé par les ventes réelles », « Appliquer » et explication à la demande", async () => {
    const client = await demo("pro");
    const item = (await client.listItems({ status: "listed", pageSize: 50 })).items.find((i) => i.brand)!;
    mount(`/app/items/${item.id}`, "/app/items/:id", <ItemDetail />);
    const panel = await screen.findByLabelText("Prix conseillé par les ventes réelles");
    const strategies = await within(panel).findByRole("list", { name: "Trois stratégies de prix" }, { timeout: 3000 });
    expect(within(panel).getAllByText(PRICE_MODEL_DEMO_DATA, { exact: false }).length).toBeGreaterThan(0);
    // « Appliquer » : une stratégie au-dessus du plancher et différente du prix actuel devient le prix affiché.
    const usable = within(strategies).getAllByRole("listitem").find((li) => !(within(li).getByRole("button") as HTMLButtonElement).disabled);
    expect(usable).toBeTruthy();
    const cents = Math.round(Number(spaces(usable!.getAttribute("aria-label")).replace(/[^\d,]/g, "").replace(",", ".")) * 100);
    fireEvent.click(within(usable!).getByRole("button"));
    await waitFor(async () => expect((await client.getItem(item.id)).listedPriceCents).toBe(cents));
    fireEvent.click(within(panel).getByRole("button", { name: "Expliquer en mots" }));
    expect(await within(panel).findByText(/Expliqué par mon IA perso/, {}, { timeout: 3000 })).toBeTruthy();
  });

  it("Manager › nouvel article : suggestion à la saisie de la marque, « Utiliser » remplit le prix affiché", async () => {
    const client = await demo("pro");
    const estimateSpy = vi.spyOn(client, "estimatePrice");
    mount("/app/items/new", "/app/items/new", <ItemForm />);
    expect(await screen.findByText(/Saisissez la marque ou choisissez la catégorie/)).toBeTruthy();
    expect(estimateSpy).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Marque"), { target: { value: "Nike" } });
    const list = await screen.findByRole("list", { name: "Stratégies suggérées" }, { timeout: 3000 });
    // Une seule requête après la saisie (attente de 500 ms sans frappe), sans explication ni requête IA.
    expect(estimateSpy).toHaveBeenCalledTimes(1);
    expect(estimateSpy.mock.calls[0]![0]).toMatchObject({ brand: "Nike", category: "other", condition: "good", explain: false });
    const standard = within(list).getByRole("button", { name: /^Utiliser standard/ });
    const cents = Math.round(Number(standard.getAttribute("aria-label")!.replace(/[^\d,]/g, "").replace(",", ".")) * 100);
    fireEvent.click(standard);
    expect((screen.getByLabelText("Prix affiché") as HTMLInputElement).value).toBe((cents / 100).toFixed(2).replace(".", ","));
  });

  it("Paramètres › IA : état du modèle de prix (démo, puis non entraîné, puis erreur mesurée)", async () => {
    const client = await demo("pro");
    mount("/app/settings/ai", "/app/settings/ai", <Ai />);
    const card = await screen.findByLabelText("Modèle de prix");
    expect(await within(card).findByText("Données de démonstration")).toBeTruthy();
    expect(within(card).getByText(/son erreur n'est pas mesurée sur de vraies ventes/)).toBeTruthy();
    cleanup();

    queryClient.clear();
    vi.spyOn(client, "pricingModelStatus").mockResolvedValue({ trained: false, version: null, trainedAt: null, nReferences: 0, metrics: null, synthetic: false, label: PRICE_MODEL_NOT_TRAINED, references: { real: 120, demo: 0, minimum: 500 } });
    mount("/app/settings/ai", "/app/settings/ai", <Ai />);
    const empty = await screen.findByLabelText("Modèle de prix");
    expect(await within(empty).findByText(PRICE_MODEL_NOT_TRAINED)).toBeTruthy();
    expect(within(empty).getByText("120 / 500 au moins")).toBeTruthy();
    expect(within(empty).queryByText(/Estimations à ± 20 %/)).toBeNull();
    cleanup();

    queryClient.clear();
    vi.spyOn(client, "pricingModelStatus").mockResolvedValue({ trained: true, version: "2026-11-01", trainedAt: "2026-11-01T03:00:00.000Z", nReferences: 6400, metrics: { measured: true, mdape: 0.192, within20: 0.51, nHoldout: 640 }, synthetic: false, label: "Modèle entraîné le 01/11/2026 sur 6400 références", references: { real: 6400, demo: 0, minimum: 500 } });
    mount("/app/settings/ai", "/app/settings/ai", <Ai />);
    const measured = await screen.findByLabelText("Modèle de prix");
    expect(await within(measured).findByText(/Modèle entraîné · erreur 19 %/)).toBeTruthy();
    expect(within(measured).getByText("Estimations à ± 20 %")).toBeTruthy();
    expect(within(measured).getByText("640")).toBeTruthy();
  });
});
