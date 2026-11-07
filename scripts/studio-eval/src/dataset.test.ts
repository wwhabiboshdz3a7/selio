import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DatasetError, cmOf, garmentKindOf, loadDataset } from "./dataset";
import { fakeJpeg, writeDataset } from "./testing";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function dataset(spec: Parameters<typeof writeDataset>[0]): Promise<string> {
  const dir = await writeDataset(spec);
  dirs.push(dir);
  return dir;
}

describe("loadDataset — étiquettes", () => {
  it("lit les alias de colonnes français, le séparateur virgule, et écarte les lignes sans photo utilisable", async () => {
    const dir = await dataset({
      labelsCsv: "fichier,marque,taille,matiere,ref\ne1.jpg,Levi's,W32 L32,,04511\ne2.jpg,Zara,M,coton,\nabsente.jpg,Nike,42,,\ne1.jpg,Doublon,,,\nvide.jpg,,,,\n../hors.jpg,Adidas,,,\n",
      labelPhotos: { "e1.jpg": fakeJpeg(800, 600), "e2.jpg": fakeJpeg(1024, 768), "vide.jpg": fakeJpeg(10, 10) },
    });
    const d = await loadDataset(dir);
    expect(d.sections).toEqual({ labels: true, tapes: false });
    expect(d.labels.map((c) => c.photo)).toEqual(["e1.jpg", "e2.jpg"]);
    expect(d.labels[0]).toMatchObject({ id: "E001", truth: { brand: "Levi's", size: "W32 L32", material: null, reference: "04511" }, line: 2, file: path.join(dir, "etiquettes", "e1.jpg") });
    expect(d.labels[1]!.truth).toEqual({ brand: "Zara", size: "M", material: "coton", reference: null });
    expect(d.problems.map((p) => p.message)).toEqual([
      "ligne 4 : photo « absente.jpg » introuvable, ligne ignorée",
      "ligne 5 : photo « e1.jpg » en double, ligne ignorée",
      "ligne 6 : aucune vérité pour « vide.jpg », ligne ignorée",
      "ligne 7 : nom de photo manquant ou invalide (« ../hors.jpg »)",
    ]);
  });

  it("refuse le fichier entier sur une colonne inconnue (pseudo, vendeur…) et sans colonne photo", async () => {
    const bad = await dataset({ labelsCsv: "photo;brand;vendeur\ne1.jpg;Zara;quelquun\n", labelPhotos: { "e1.jpg": fakeJpeg(10, 10) } });
    await expect(loadDataset(bad)).rejects.toThrow(/colonne\(s\) inconnue\(s\) « vendeur »/);
    const noPhoto = await dataset({ labelsCsv: "brand;size\nZara;M\n" });
    await expect(loadDataset(noPhoto)).rejects.toThrow(/« photo » obligatoire/);
    const noTruth = await dataset({ labelsCsv: "photo;note\ne1.jpg;x\n" });
    await expect(loadDataset(noTruth)).rejects.toThrow(/au moins une colonne de vérité/);
  });
});

describe("loadDataset — mesures", () => {
  const csv = [
    "article;famille;photos;poitrine;longueur;waist_cm;sole",
    "A1;haut;a1-1.jpg|a1-2.jpg;52;68,5;;",
    "A2;bas;a2.jpg;;;41;",
    "A3;ovni;a3.jpg;50;;;",
    "A4;top;a4.jpg;abc;;;",
    "A5;top;a5.jpg;;;;",
    "A6;top;a6-1.jpg|a6-2.jpg|a6-3.jpg|a6-4.jpg;50;;;",
    "A7;top;a1-1.jpg;50;;;",
    "A1;top;a8.jpg;50;;;",
    "A9;top;manquante.jpg;50;;;",
    "A10;shoes;a10.jpg;;;;27,5",
  ].join("\n");
  const photos = Object.fromEntries(["a1-1", "a1-2", "a2", "a3", "a4", "a5", "a6-1", "a6-2", "a6-3", "a6-4", "a8", "a10"].map((n) => [`${n}.jpg`, fakeJpeg(600, 800)]));

  it("lit les articles, leurs photos « | », les mesures en cm (virgule, suffixe cm) et signale chaque ligne écartée", async () => {
    const dir = await dataset({ tapesCsv: csv, tapePhotos: photos });
    const d = await loadDataset(dir);
    expect(d.sections).toEqual({ labels: false, tapes: true });
    expect(d.tapes.map((c) => c.article)).toEqual(["A1", "A2", "A10"]);
    expect(d.tapes[0]).toMatchObject({ id: "M001", garmentKind: "top", photos: ["a1-1.jpg", "a1-2.jpg"], truth: { chest: 52, length: 68.5 } });
    expect(d.tapes[1]).toMatchObject({ garmentKind: "bottom", truth: { waist: 41 } });
    expect(d.tapes[2]).toMatchObject({ garmentKind: "shoes", truth: { sole: 27.5 } });
    expect(d.problems.map((p) => p.message)).toEqual([
      "A3 : famille « ovni » inconnue (top, outerwear, dress, bottom, shoes, bag, accessory, other), ligne ignorée",
      "A4 : chest = « abc » (nombre en cm attendu, 0 à 300), ligne ignorée",
      "A5 : aucune mesure vraie, ligne ignorée",
      "A6 : 4 photos, 3 au plus par lecture de mesures, ligne ignorée",
      "A7 : photo « a1-1.jpg » déjà utilisée par un autre article, ligne ignorée",
      "ligne 9 : article « A1 » en double, ligne ignorée",
      "A9 : photo(s) introuvable(s) « manquante.jpg », ligne ignorée",
    ]);
  });

  it("refuse une colonne inconnue, exige article, famille, photos et une mesure", async () => {
    const unknown = await dataset({ tapesCsv: "article;garmentKind;photos;chest;pseudo\nA1;top;a.jpg;50;x\n" });
    await expect(loadDataset(unknown)).rejects.toThrow(/colonne\(s\) inconnue\(s\) « pseudo »/);
    const noKind = await dataset({ tapesCsv: "article;photos;chest\nA1;a.jpg;50\n" });
    await expect(loadDataset(noKind)).rejects.toThrow(/« garmentKind » obligatoire/);
    const noMeasure = await dataset({ tapesCsv: "article;garmentKind;photos\nA1;top;a.jpg\n" });
    await expect(loadDataset(noMeasure)).rejects.toThrow(/au moins une colonne de mesure/);
  });

  it("applique --only et --limit par section", async () => {
    const dir = await dataset({
      labelsCsv: "photo;brand\ne1.jpg;A\ne2.jpg;B\ne3.jpg;C\n",
      labelPhotos: { "e1.jpg": fakeJpeg(10, 10), "e2.jpg": fakeJpeg(10, 10), "e3.jpg": fakeJpeg(10, 10) },
      tapesCsv: csv,
      tapePhotos: photos,
    });
    const limited = await loadDataset(dir, { limit: 2 });
    expect(limited.labels.map((c) => c.photo)).toEqual(["e1.jpg", "e2.jpg"]);
    expect(limited.tapes.map((c) => c.article)).toEqual(["A1", "A2"]);
    const onlyLabels = await loadDataset(dir, { only: "labels" });
    expect(onlyLabels.labels).toHaveLength(3);
    expect(onlyLabels.tapes).toHaveLength(0);
    const onlyTapes = await loadDataset(dir, { only: "tapes" });
    expect(onlyTapes.labels).toHaveLength(0);
    expect(onlyTapes.tapes).toHaveLength(3);
  });
});

describe("loadDataset — dossier", () => {
  it("refuse un dossier absent ou sans vérité terrain", async () => {
    await expect(loadDataset("/chemin/qui/n/existe/pas")).rejects.toBeInstanceOf(DatasetError);
    const empty = await dataset({});
    await expect(loadDataset(empty)).rejects.toThrow(/Aucune vérité terrain/);
  });

  it("cmOf et garmentKindOf", () => {
    expect(cmOf("52")).toBe(52);
    expect(cmOf(" 52,5 cm ")).toBe(52.5);
    expect(cmOf("")).toBeUndefined();
    expect(cmOf("abc")).toBeNull();
    expect(cmOf("0")).toBeNull();
    expect(cmOf("301")).toBeNull();
    expect(garmentKindOf("Veste ou manteau")).toBe("outerwear");
    expect(garmentKindOf("chaussures")).toBe("shoes");
    expect(garmentKindOf("bottom")).toBe("bottom");
    expect(garmentKindOf("")).toBeNull();
    expect(garmentKindOf("chapeau")).toBeNull();
  });
});
