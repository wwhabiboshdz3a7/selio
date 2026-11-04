import {
  CLEANING_REASONS,
  cleanReferences,
  normalizeBrand,
  normalizeCategory,
  normalizeColor,
  normalizeMaterial,
  parseCondition,
  parseSize,
  seasonOf,
} from "./clean";
import type { PriceReference } from "./types";

const ref = (over: Partial<PriceReference> = {}): PriceReference => ({
  brand: "Levi's",
  category: "Jeans",
  subcategory: "Jean droit",
  size: "W32",
  material: "denim",
  color: "Bleu",
  condition: "very_good",
  listedPriceCents: 3000,
  finalPriceCents: 2700,
  listedAt: "2026-09-01T10:00:00Z",
  soldAt: "2026-09-10T10:00:00Z",
  photoCount: 6,
  source: "client_sale",
  ...over,
});

describe("normalisation", () => {
  it("marque : casse, accents, apostrophes, espaces et alias", () => {
    for (const b of ["Levi's", "LEVIS", "levi’s", "Levi Strauss", "  levi's  "]) expect(normalizeBrand(b)).toBe("levis");
    expect(normalizeBrand("H&M")).toBe("hm");
    expect(normalizeBrand("H & M")).toBe("hm");
    expect(normalizeBrand("The North Face")).toBe("thenorthface");
    expect(normalizeBrand("TNF")).toBe("thenorthface");
    expect(normalizeBrand("Sézane")).toBe("sezane");
    expect(normalizeBrand("")).toBe("sansmarque");
    expect(normalizeBrand("Sans marque")).toBe("sansmarque");
    expect(normalizeBrand(null)).toBe("sansmarque");
  });

  it("marque : alias paramétrables", () => {
    expect(normalizeBrand("Petit B.", { petitb: "petitbateau" })).toBe("petitbateau");
    // Les alias par défaut restent actifs.
    expect(normalizeBrand("TNF", { petitb: "petitbateau" })).toBe("thenorthface");
  });

  it("catégorie : pluriels simples et accents", () => {
    expect(normalizeCategory("Jeans")).toBe(normalizeCategory("jean"));
    expect(normalizeCategory("Vêtements enfant")).toBe("vetement enfant");
    expect(normalizeCategory("Robes")).toBe("robe");
  });

  it("taille → classe ordinale commune", () => {
    expect(parseSize("M")).toMatchObject({ system: "letter", ordinal: 3 });
    expect(parseSize("Taille m")).toMatchObject({ system: "letter", ordinal: 3 });
    expect(parseSize("S/M")).toMatchObject({ system: "letter", ordinal: 2.5 });
    expect(parseSize("XXL").ordinal).toBe(parseSize("2XL").ordinal);
    expect(parseSize("M (38)")).toMatchObject({ system: "letter", ordinal: 3 });
    expect(parseSize("W32 L34")).toMatchObject({ system: "waist", ordinal: 4 });
    expect(parseSize("32/34")).toMatchObject({ system: "waist", ordinal: 4 });
    expect(parseSize("38")).toMatchObject({ system: "eu", ordinal: 3 });
    expect(parseSize("FR 40")).toMatchObject({ system: "eu", ordinal: 4 });
    expect(parseSize("38", "basket")).toMatchObject({ system: "shoe" });
    expect(parseSize("42,5")).toMatchObject({ system: "shoe" });
    expect(parseSize("41", "chaussure").ordinal).toBeGreaterThan(parseSize("37", "chaussure").ordinal);
    expect(parseSize("10 ans")).toMatchObject({ system: "kids", ordinal: 10 });
    expect(parseSize("18 mois")).toMatchObject({ system: "kids", ordinal: 1.5 });
    expect(parseSize("Taille unique")).toMatchObject({ system: "one_size", ordinal: -1 });
    expect(parseSize("TU")).toMatchObject({ system: "one_size" });
    expect(parseSize("")).toMatchObject({ system: "unknown", ordinal: -1 });
    expect(parseSize("grand")).toMatchObject({ system: "unknown" });
    // Ordre des lettres respecté.
    const order = ["XS", "S", "M", "L", "XL"].map((s) => parseSize(s).ordinal);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("matière principale d'une composition, couleur", () => {
    expect(normalizeMaterial("80 % coton 20 % polyester")).toBe("coton");
    expect(normalizeMaterial("polyester 30% laine 70%")).toBe("laine");
    expect(normalizeMaterial("Cashmere")).toBe("cachemire");
    expect(normalizeMaterial("Cuir véritable")).toBe("cuir");
    expect(normalizeMaterial("matière mystère")).toBe("autre");
    expect(normalizeMaterial("")).toBeNull();
    expect(normalizeColor("Bleu marine")).toBe("bleu");
    expect(normalizeColor("Navy")).toBe("bleu");
    expect(normalizeColor("Vert kaki")).toBe("vert");
    expect(normalizeColor(null)).toBeNull();
  });

  it("état → code (neuf avec étiquette > neuf > très bon > bon > satisfaisant)", () => {
    expect(parseCondition("Neuf avec étiquette")).toBe("new_with_tags");
    expect(parseCondition("new")).toBe("new_without_tags");
    expect(parseCondition("new_without_tags")).toBe("new_without_tags");
    expect(parseCondition("Très bon état")).toBe("very_good");
    expect(parseCondition("bon état")).toBe("good");
    expect(parseCondition("Satisfaisant")).toBe("satisfactory");
    expect(parseCondition("abîmé ?")).toBeNull();
  });

  it("saison depuis la date de mise en ligne", () => {
    expect(seasonOf(Date.parse("2026-01-15"))).toBe("winter");
    expect(seasonOf(Date.parse("2026-12-15"))).toBe("winter");
    expect(seasonOf(Date.parse("2026-04-15"))).toBe("spring");
    expect(seasonOf(Date.parse("2026-07-15"))).toBe("summer");
    expect(seasonOf(Date.parse("2026-10-15"))).toBe("autumn");
  });
});

describe("cleanReferences", () => {
  it("garde une ligne propre, normalisée, sans aucun champ personnel", () => {
    const { references, report } = cleanReferences([ref()]);
    expect(report).toMatchObject({ input: 1, kept: 1, sold: 1, unsold: 0 });
    const r = references[0]!;
    expect(r).toMatchObject({ brand: "levis", category: "jean", condition: "very_good", conditionOrdinal: 2, targetPriceCents: 2700, sold: true, season: "autumn" });
    expect(r.delayDays).toBeCloseTo(9, 5);
    expect(Object.keys(r).sort()).toEqual(
      ["brand", "category", "color", "condition", "conditionOrdinal", "delayDays", "favorites", "finalPriceCents", "finalPriceEstimated", "listedAt", "listedPriceCents", "material", "photoCount", "season", "size", "sold", "soldAt", "source", "subcategory", "targetPriceCents", "views"].sort(),
    );
  });

  it("une ligne vendue sans prix final apprend sur le prix affiché ; une ligne non vendue n'a pas de cible", () => {
    const { references, report } = cleanReferences([ref({ finalPriceCents: null }), ref({ soldAt: null, finalPriceCents: null, listedPriceCents: 3100 })]);
    expect(references[0]!.targetPriceCents).toBe(3000);
    expect(references[1]!).toMatchObject({ sold: false, targetPriceCents: null, delayDays: null });
    expect(report).toMatchObject({ sold: 1, unsold: 1 });
  });

  it("écarte chaque aberration avec sa raison", () => {
    const rows: PriceReference[] = [
      ref(),
      ref({ listedPriceCents: 50, finalPriceCents: null, soldAt: null }), // < 1 €
      ref({ finalPriceCents: 80 }), // prix final < 1 €
      ref({ soldAt: "2026-08-01T00:00:00Z" }), // vendue avant la mise en ligne
      ref({ condition: "???" }),
      ref({ category: "" }),
      ref({ category: "Lot de vêtements" }),
      ref({ listedPriceCents: 12.5 }),
      ref({ listedAt: "pas une date" }),
      ref({ soldAt: "2027-01-01T00:00:00Z" }), // futur
      { ...ref(), source: "inconnue" } as unknown as PriceReference,
    ];
    const { references, report } = cleanReferences(rows, { now: "2026-10-30T00:00:00Z" });
    expect(references).toHaveLength(1);
    expect(report.dropped).toMatchObject({
      price_too_low: 2,
      negative_delay: 1,
      invalid_condition: 1,
      missing_category: 1,
      bundle: 1,
      invalid_price: 1,
      invalid_date: 1,
      future_date: 1,
      invalid_source: 1,
    });
    const total = CLEANING_REASONS.reduce((s, k) => s + report.dropped[k], 0);
    expect(total + report.kept).toBe(report.input);
  });

  it("refuse une ligne qui porte un champ personnel (jamais propagé)", () => {
    const withPseudo = { ...ref(), pseudo: "vendeuse_du_13" } as unknown as PriceReference;
    const withUrl = { ...ref(), url: "https://www.vinted.fr/items/123" } as unknown as PriceReference;
    const { references, report } = cleanReferences([withPseudo, withUrl, ref()]);
    expect(report.dropped.personal_data).toBe(2);
    expect(references).toHaveLength(1);
    expect(JSON.stringify(references)).not.toMatch(/vendeuse|vinted\.fr/);
  });

  it("dédoublonne (même marque, catégorie, taille, prix et jour) en gardant la ligne vendue la plus complète", () => {
    const unsold = ref({ soldAt: null, finalPriceCents: null, brand: "LEVIS", listedAt: "2026-09-01T08:00:00Z" });
    const sold = ref({ listedAt: "2026-09-01T18:00:00Z" });
    const otherDay = ref({ listedAt: "2026-09-02T10:00:00Z" });
    const otherPrice = ref({ listedPriceCents: 3100 });
    const { references, report } = cleanReferences([unsold, sold, otherDay, otherPrice]);
    expect(report.dropped.duplicate).toBe(1);
    expect(references).toHaveLength(3);
    expect(references.filter((r) => r.listedPriceCents === 3000 && new Date(r.listedAt).getUTCDate() === 1)[0]!.sold).toBe(true);
  });

  it("écarte un prix au-delà de 50 × la médiane de la marque et de la catégorie", () => {
    const rows = Array.from({ length: 8 }, (_, i) => ref({ listedPriceCents: 3000 + i * 100, finalPriceCents: 2800 + i * 100, listedAt: `2026-09-0${i + 1}T10:00:00Z`, soldAt: `2026-09-1${i}T10:00:00Z` }));
    rows.push(ref({ listedPriceCents: 300_000, finalPriceCents: 290_000, listedAt: "2026-09-20T10:00:00Z", soldAt: "2026-09-25T10:00:00Z" }));
    rows.push(ref({ listedPriceCents: 90_000, finalPriceCents: 90_000, listedAt: "2026-09-21T10:00:00Z", soldAt: "2026-09-25T10:00:00Z" })); // 30 × : gardé
    const { references, report } = cleanReferences(rows);
    expect(report.dropped.price_too_high).toBe(1);
    expect(references).toHaveLength(9);
    expect(references.some((r) => r.listedPriceCents === 90_000)).toBe(true);
  });

  it("garde un état absent (ordinal −1) mais écarte un état illisible", () => {
    const { references, report } = cleanReferences([ref({ condition: null }), ref({ condition: "à voir", listedPriceCents: 3100 })]);
    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({ condition: null, conditionOrdinal: -1 });
    expect(report.dropped.invalid_condition).toBe(1);
  });

  it("alias de marque du nettoyage", () => {
    const { references } = cleanReferences([ref({ brand: "Petit B." })], { brandAliases: { petitb: "petitbateau" } });
    expect(references[0]!.brand).toBe("petitbateau");
  });
});
