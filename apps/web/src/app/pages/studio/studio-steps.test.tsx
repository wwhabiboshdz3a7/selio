import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StudioTextField } from "@selio/contracts";
import type { StudioDraft, StudioPrepArticleView, StudioPrepResultView } from "../../../lib/data/types";
import { assignmentFrom, toUiPrep, type SortAssignment, type UiPrep } from "../../../lib/studio/flow";
import { emptyEdits, type PrepEdits } from "../../../lib/studio/prep";
import { LabelStep } from "./LabelStep";
import { MeasuresStep } from "./MeasuresStep";
import { SortStep } from "./SortStep";
import { ProvenanceSummary } from "./DraftCard";
import { ProvenanceBadge } from "./shared";

afterEach(cleanup);

const field = (value: string | null, source: StudioTextField["source"] = value ? "label" : null, confidence?: number, question?: string): StudioTextField => ({ value, source, ...(confidence !== undefined ? { confidence } : {}), ...(question ? { question } : {}) });

function article(prepId: string, articleGroup: number, photoIndexes: number[], over: Partial<StudioPrepArticleView> = {}): StudioPrepArticleView {
  return {
    prepId,
    status: "draft",
    articleGroup,
    photoIndexes,
    modelPhotoIndexes: photoIndexes,
    garmentKind: "bottom",
    fields: { brand: field("Levi's", "label", 0.92), size: field("W32 L32", "label", 0.62), material: field(null, null, undefined, "Quelle est la composition ?"), reference: field("501", "label", 0.85) },
    careSymbols: ["Lavage 30 °C"],
    tapeVisible: true,
    measurements: [
      { name: "waist", valueCm: 41, source: "tape_photo", confidence: 0.88 },
      { name: "inseam", valueCm: null, source: null, question: "Mesurez l'entrejambe (de l'entrejambe jusqu'en bas de la jambe) et indiquez-la en cm." },
      { name: "rise", valueCm: 29, source: "reference_db" },
    ],
    sizeReference: { brand: "Levi's", reference: "501", size: "W32 L32" },
    questions: [
      { field: "material", reason: "missing", text: "Quelle est la composition ?" },
      { field: "size", reason: "low_confidence", text: "L'étiquette semble indiquer « W32 L32 » pour la taille : est-ce juste ?" },
      { field: "inseam", reason: "missing", text: "Mesurez l'entrejambe (de l'entrejambe jusqu'en bas de la jambe) et indiquez-la en cm." },
    ],
    warnings: [],
    ...over,
  };
}

const result: StudioPrepResultView = {
  batchId: "lot-1",
  photos: [
    { index: 0, role: "front", articleGroup: 1, confidence: 0.9 },
    { index: 1, role: "label", articleGroup: 1, confidence: 0.95 },
    // Rôle indiqué par le vendeur (provenance posée par le serveur), et un tri du modèle sûr à 100 % : deux choses différentes.
    { index: 2, role: "tape", articleGroup: 1, confidence: 1, roleSource: "seller" },
    { index: 3, role: "front", articleGroup: 2, confidence: 1 },
  ],
  articles: [article("prep-jean", 1, [0, 1, 2]), article("prep-pull", 2, [3], { garmentKind: "top", tapeVisible: false, measurements: [], questions: [] })],
  warnings: [],
  simulated: true,
  ocr: { configured: false, used: false },
  accuracy: { status: "to_measure", brandAndSizeRate: null, measurementRate: null, reportDate: null },
};
const photoIds = ["a", "b", "c", "d"];
const photos = photoIds.map((id, i) => ({ id, url: `data:image/jpeg;base64,${id}`, alt: `photo-${i + 1}.jpg` }));
const prep = (): UiPrep => toUiPrep(result, photoIds);

function LabelHarness({ ui, p }: { ui: UiPrep["articles"][number]; p: UiPrep }) {
  const [edits, setEdits] = useState<PrepEdits>(emptyEdits());
  return <LabelStep ui={ui} prep={p} photos={new Map(photos.map((x) => [x.id, x]))} edits={edits} onEdits={setEdits} onBack={() => {}} onNext={() => {}} canWrite />;
}

function MeasuresHarness({ ui, demo = false }: { ui: UiPrep["articles"][number]; demo?: boolean }) {
  const [edits, setEdits] = useState<PrepEdits>(emptyEdits());
  return <MeasuresStep ui={ui} edits={edits} onEdits={setEdits} onBack={() => {}} onGenerate={() => {}} generating={false} canWrite errors={{}} demo={demo} />;
}

describe("provenance affichée", () => {
  it("le badge dit toujours d'où vient la valeur, en toutes lettres", () => {
    render(
      <>
        <ProvenanceBadge source="label" confidence={0.92} />
        <ProvenanceBadge source="tape_photo" confidence={0.62} />
        <ProvenanceBadge source="reference_db" />
        <ProvenanceBadge source="seller" />
        <ProvenanceBadge source={null} />
        <ProvenanceBadge source={null} pending />
      </>,
    );
    expect(screen.getByText("Lue sur l'étiquette · confiance 92 %")).toBeTruthy();
    expect(screen.getByText("Lue sur le mètre ruban · confiance 62 % · à confirmer")).toBeTruthy();
    expect(screen.getByText("Base des références")).toBeTruthy();
    expect(screen.getByText("Indiquée par le vendeur")).toBeTruthy();
    expect(screen.getByText("À renseigner")).toBeTruthy();
    expect(screen.getByText("Indiquée par vous")).toBeTruthy();
  });

  it("le résumé de l'annonce reprend chaque champ et chaque mesure avec sa provenance", () => {
    const draft = {
      title: "Jean Levi's 501", description: "…", brand: "Levi's", category: "men", size: "W32 L32", condition: "good", colors: [], material: null, hashtags: [], confidence: 0.7,
      suggestedPriceCents: 2990, priceLowCents: 2490, priceHighCents: 3490, priceMethod: "comparables", comparableCount: 3, source: "ai", provider: "mock", model: "selio-mock-v1", latencyMs: 10, simulated: true, warnings: [],
      prepId: "prep-jean", fields: result.articles[0]!.fields, measurements: result.articles[0]!.measurements,
    } as StudioDraft;
    render(<ProvenanceSummary draft={draft} />);
    const section = screen.getByRole("region", { name: "Provenance des champs" });
    expect(within(section).getByText("Levi's")).toBeTruthy();
    expect(within(section).getByText("Lue sur l'étiquette · confiance 92 %")).toBeTruthy();
    expect(within(section).getByText("41 cm")).toBeTruthy();
    expect(within(section).getByText("Lue sur le mètre ruban · confiance 88 %")).toBeTruthy();
    expect(within(section).getByText("29 cm")).toBeTruthy();
    expect(within(section).getByText("Base des références")).toBeTruthy();
    // La matière inconnue reste « — » avec « À renseigner » : jamais une valeur devinée.
    expect(within(section).getByText("—")).toBeTruthy();
    expect(within(section).getByText("À renseigner")).toBeTruthy();
    // L'entrejambe sans valeur n'est pas listé parmi les mesures de l'annonce.
    expect(within(section).queryByText("Entrejambe")).toBeNull();
  });
});

describe("écran Étiquette", () => {
  it("affiche les champs lus avec leur confiance, un champ vide avec sa question, et une lecture peu sûre à confirmer", () => {
    const p = prep();
    render(<LabelHarness ui={p.articles[0]!} p={p} />);
    expect((screen.getByLabelText("Marque") as HTMLInputElement).value).toBe("Levi's");
    expect(screen.getByText("Lue sur l'étiquette · confiance 92 %")).toBeTruthy();
    expect((screen.getByLabelText("Taille") as HTMLInputElement).value).toBe("W32 L32");
    expect(screen.getByText("Lue sur l'étiquette · confiance 62 % · à confirmer")).toBeTruthy();
    expect(screen.getByText("L'étiquette semble indiquer « W32 L32 » pour la taille : est-ce juste ?")).toBeTruthy();
    // Matière : rien n'est lu → champ vide (aucune valeur par défaut) et question au vendeur.
    expect((screen.getByLabelText("Matière") as HTMLInputElement).value).toBe("");
    expect(screen.getByText("À renseigner")).toBeTruthy();
    expect(screen.getByText("Quelle est la composition ?")).toBeTruthy();
    expect(screen.getByText(/Entretien lu sur l'étiquette : Lavage 30 °C/)).toBeTruthy();
    expect(screen.getByRole("img", { name: "Étiquette : photo-2.jpg" })).toBeTruthy();
    expect(screen.getByText(/Précision à mesurer/)).toBeTruthy();
  });

  it("une valeur modifiée devient « Indiquée par vous » ; vidée, elle redevient « À renseigner » avec sa question", () => {
    const p = prep();
    render(<LabelHarness ui={p.articles[0]!} p={p} />);
    const brand = screen.getByLabelText("Marque") as HTMLInputElement;
    fireEvent.change(brand, { target: { value: "Levi Strauss" } });
    expect(brand.value).toBe("Levi Strauss");
    expect(screen.getByText("Indiquée par vous")).toBeTruthy();
    expect(screen.queryByText("Lue sur l'étiquette · confiance 92 %")).toBeNull();
    fireEvent.change(brand, { target: { value: "" } });
    expect(screen.getAllByText("À renseigner").length).toBe(2);
    expect(screen.getByText(/Quelle est la marque \?/)).toBeTruthy();
  });

  it("une lecture peu sûre se confirme explicitement (« Confirmer ») ou se corrige : le silence ne vaut pas confirmation", () => {
    const p = prep();
    render(<LabelHarness ui={p.articles[0]!} p={p} />);
    expect(screen.getByText("À confirmer avant de générer")).toBeTruthy();
    expect(screen.getByText(/taille : lecture peu sûre ou en désaccord avec une autre source/)).toBeTruthy();
    const button = screen.getByRole("button", { name: "Confirmer « W32 L32 »" });
    expect(button.getAttribute("aria-describedby")).toBe("label-prep-jean-size-q");
    fireEvent.click(button);
    expect(screen.getByText("Confirmée par vous")).toBeTruthy();
    expect(screen.getByText("Valeur lue, confirmée par vous.")).toBeTruthy();
    expect(screen.queryByText("À confirmer avant de générer")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Confirmer/ })).toBeNull();
    expect((screen.getByLabelText("Taille") as HTMLInputElement).value).toBe("W32 L32");
    // Corrigée à la place : « Indiquée par vous », plus rien à confirmer non plus.
    cleanup();
    render(<LabelHarness ui={p.articles[0]!} p={p} />);
    fireEvent.change(screen.getByLabelText("Taille"), { target: { value: "W31 L32" } });
    expect(screen.queryByText("À confirmer avant de générer")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Confirmer/ })).toBeNull();
    expect(screen.getAllByText("Indiquée par vous")).toHaveLength(1);
  });

  it("sans photo d'étiquette, rien n'est lu ni deviné d'après le style", () => {
    const p = prep();
    render(<LabelHarness ui={p.articles[1]!} p={p} />);
    expect(screen.getByText(/Aucune photo d'étiquette pour cet article : rien n'est lu, aucune valeur n'est devinée/)).toBeTruthy();
  });
});

describe("écran Mesures", () => {
  it("chaque mesure porte sa provenance (ruban, base, vous) ; une mesure vide pose la question, sans valeur par défaut", () => {
    const p = prep();
    render(<MeasuresHarness ui={p.articles[0]!} demo />);
    expect(screen.getByText("Jamais de mesure inventée")).toBeTruthy();
    expect(screen.getByText(/1 photo avec un mètre ruban/)).toBeTruthy();
    expect(screen.getByText(/Base des références : Levi's 501 en W32 L32 \(exemple de démonstration\)/)).toBeTruthy();
    expect((screen.getByLabelText(/^Tour de taille/) as HTMLInputElement).value).toBe("41");
    expect(screen.getByText("Lue sur le mètre ruban · confiance 88 %")).toBeTruthy();
    expect((screen.getByLabelText(/^Montant/) as HTMLInputElement).value).toBe("29");
    expect(screen.getByText("Base des références")).toBeTruthy();
    const inseam = screen.getByLabelText(/^Entrejambe/) as HTMLInputElement;
    expect(inseam.value).toBe("");
    expect(screen.getByText("À renseigner")).toBeTruthy();
    expect(screen.getByText(/Mesurez l'entrejambe/)).toBeTruthy();
    // La question est reliée au champ pour les lecteurs d'écran.
    expect(inseam.getAttribute("aria-describedby")).toBe(`measure-prep-jean-inseam-q`);
    expect(screen.getByRole("checkbox", { name: /Partager anonymement ces mesures/ })).toBeTruthy();
  });

  it("une mesure saisie devient « Indiquée par vous » ; une saisie illisible est signalée, jamais devinée", () => {
    const p = prep();
    render(<MeasuresHarness ui={p.articles[0]!} />);
    const inseam = screen.getByLabelText(/^Entrejambe/) as HTMLInputElement;
    fireEvent.change(inseam, { target: { value: "81,5" } });
    expect(screen.getByText("Indiquée par vous")).toBeTruthy();
    expect(screen.queryByText(/Mesurez l'entrejambe/)).toBeNull();
    fireEvent.change(inseam, { target: { value: "quatre-vingts" } });
    expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" ")).toMatch(/Indiquez une longueur en cm/);
    expect(inseam.getAttribute("aria-invalid")).toBe("true");
  });

  it("« Générer l'annonce » reste fermé tant qu'une lecture reste à confirmer (étiquette ou mesure) ; « Confirmer » la libère, sans rien deviner", () => {
    const p = prep();
    render(<MeasuresHarness ui={p.articles[0]!} />);
    expect((screen.getByRole("button", { name: "Générer l'annonce" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/taille \(étape Étiquette\) : lecture peu sûre ou en désaccord/)).toBeTruthy();
    cleanup();
    const ui = p.articles[0]!;
    const unsure: UiPrep["articles"][number] = {
      ...ui,
      article: {
        ...ui.article,
        fields: { ...ui.article.fields, size: field("W32 L32", "label", 0.9) },
        measurements: ui.article.measurements.map((m) => (m.name === "waist" ? { ...m, confidence: 0.55 } : m)),
        questions: [...ui.article.questions.filter((q) => q.field !== "size"), { field: "waist", reason: "low_confidence", text: "Tour de taille n'a pas pu être lue avec certitude sur le mètre ruban : mesurez-la et indiquez-la en cm." }],
      },
    };
    render(<MeasuresHarness ui={unsure} />);
    const generate = screen.getByRole("button", { name: "Générer l'annonce" }) as HTMLButtonElement;
    expect(generate.disabled).toBe(true);
    expect(screen.getByText("Lue sur le mètre ruban · confiance 55 % · à confirmer")).toBeTruthy();
    expect(screen.getByText(/Tour de taille n'a pas pu être lue avec certitude/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirmer « 41 cm »" }));
    expect(screen.getByText("Confirmée par vous")).toBeTruthy();
    expect(screen.queryByText("À confirmer avant de générer")).toBeNull();
    expect(generate.disabled).toBe(false);
    expect((screen.getByLabelText(/^Tour de taille/) as HTMLInputElement).value).toBe("41");
  });

  it("changer la famille ajoute les mesures attendues, vides, chacune avec sa question", () => {
    const p = prep();
    render(<MeasuresHarness ui={p.articles[0]!} />);
    fireEvent.change(screen.getByLabelText("Famille de la pièce"), { target: { value: "top" } });
    for (const label of [/^Poitrine/, /^Longueur/, /^Épaules/]) expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe("");
    expect(screen.getByText(/^Mesurez la poitrine/)).toBeTruthy();
    expect(screen.getByText(/^Mesurez la largeur d'épaules/)).toBeTruthy();
    // Sans ruban visible sur l'article, la question dit de poser le mètre ou de mesurer soi-même.
    cleanup();
    render(<MeasuresHarness ui={p.articles[1]!} />);
    expect(screen.getByText(/Aucune photo avec un mètre ruban pour cet article/)).toBeTruthy();
    expect(screen.getAllByText(/Aucun mètre ruban n'est visible/).length).toBe(3);
    fireEvent.change(screen.getByLabelText("Ajouter une mesure"), { target: { value: "sleeve" } });
    expect((screen.getByLabelText(/^Manche/) as HTMLInputElement).value).toBe("");
  });
});

describe("écran Tri", () => {
  function SortHarness({ onChange }: { onChange?: (a: SortAssignment) => void }) {
    const p = prep();
    const [assignment, setAssignment] = useState<SortAssignment>(assignmentFrom(p));
    return <SortStep prep={p} photos={photos} assignment={assignment} onChange={(a) => { setAssignment(a); onChange?.(a); }} onContinue={() => {}} onReread={() => {}} busy={false} canWrite />;
  }

  it("montre les photos par article avec leur rôle et la confiance du tri ; une correction demande une relecture", () => {
    const onChange = vi.fn();
    render(<SortHarness onChange={onChange} />);
    expect(screen.getByText(/4 photos rangées en 2 articles/)).toBeTruthy();
    const first = screen.getByRole("region", { name: "Article 1" });
    expect(within(first).getAllByRole("img")).toHaveLength(3);
    expect(within(first).getByText("Tri du modèle · sûr à 95 %")).toBeTruthy();
    // La provenance du rôle vient du serveur : « indiqué par vous » seulement si le vendeur l'a dit, jamais déduite d'une confiance de 100 %.
    expect(within(first).getByText("Rôle indiqué par vous")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Article 2" })).getByText("Tri du modèle · sûr à 100 %")).toBeTruthy();
    expect((screen.getByLabelText("Rôle de photo-2.jpg") as HTMLSelectElement).value).toBe("label");
    expect(screen.getByRole("button", { name: "Continuer vers l'étiquette" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Relire avec ce tri" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Rôle de photo-3.jpg"), { target: { value: "detail" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ c: { group: 1, role: "detail" } }));
    expect(screen.getByRole("button", { name: "Relire avec ce tri" })).toBeTruthy();
    expect(screen.getByText(/Tri modifié : l'étiquette et les mesures seront relues/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Article de photo-4.jpg"), { target: { value: "new" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ d: { group: 3, role: "front" } }));
    expect(screen.getByRole("region", { name: "Article 2" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Article 3" })).toBeNull();
  });
});
