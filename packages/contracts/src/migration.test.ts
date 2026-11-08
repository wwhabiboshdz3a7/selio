import { describe, expect, it } from "vitest";
import {
  DECLARATION_THRESHOLDS_2026, MIGRATION_INPUT_KINDS, MIGRATION_MAX_SCREENSHOTS, MIGRATION_MAX_TEXT_CHARS, MIGRATION_MIN_CONFIDENCE, MIGRATION_SOURCES, MIGRATION_SOURCE_LABELS, MIGRATION_TARGETS,
  bundleSettings, declarationThresholds, migrationApplyInput, migrationConvertInput, migrationFileInput, migrationMapping, migrationMappingOutput, orgSettings,
} from "./index";

describe("migration : contrats", () => {
  it("sources fermées, entrées acceptées seulement (texte, capture, fichier RGPD), bornes", () => {
    expect(MIGRATION_SOURCES).toEqual(["bleam", "clemz", "vtools", "other", "unknown"]);
    expect(Object.keys(MIGRATION_SOURCE_LABELS).sort()).toEqual([...MIGRATION_SOURCES].sort());
    expect(MIGRATION_INPUT_KINDS).toEqual(["text", "screenshot", "rgpd_file"]);
    expect(MIGRATION_MAX_SCREENSHOTS).toBe(4);
    expect(MIGRATION_MAX_TEXT_CHARS).toBe(12_000);
    expect(MIGRATION_MIN_CONFIDENCE).toBe(0.5);
    expect(new Set(MIGRATION_TARGETS).size).toBe(MIGRATION_TARGETS.length);
    expect(MIGRATION_TARGETS).toContain("marginRules.maxDiscountRate");
    expect(MIGRATION_TARGETS).toContain("schedule");
    expect(MIGRATION_TARGETS).toContain("messages.counter");
    expect(MIGRATION_TARGETS).toContain("followUp.delayHours");
  });
  it("sortie du modèle tolérante : cible inventée → null, champ illisible ignoré, confiance en % ramenée, valeurs numériques en texte source", () => {
    const out = migrationMappingOutput.parse({
      source: "bleam",
      fields: [
        { sourceLabel: "Remise max", sourceValue: 20, target: "marginRules.maxDiscountRate", targetValue: 0.2, confidence: 85 },
        { sourceLabel: "Truc", sourceValue: "x", target: "settings.invente", targetValue: { a: 1 }, confidence: 0.9 },
        { pas: "un champ" },
        null,
      ],
      unknownFields: [{ sourceLabel: "Thème", sourceValue: "sombre" }, "rien"],
      warnings: ["ok"],
    });
    expect(out.fields).toHaveLength(2);
    expect(out.fields[0]).toMatchObject({ sourceValue: "20", confidence: 0.85, target: "marginRules.maxDiscountRate" });
    expect(out.fields[1]).toMatchObject({ target: null, targetValue: null });
    expect(out.unknownFields).toEqual([{ sourceLabel: "Thème", sourceValue: "sombre", note: "" }]);
    expect(migrationMappingOutput.parse({}).source).toBe("unknown");
    expect(migrationMappingOutput.parse({ fields: "non" }).fields).toEqual([]);
  });
  it("correspondance normalisée : identifiants obligatoires ; application : identifiants acceptés", () => {
    const m = migrationMapping.parse({ source: "clemz", fields: [{ id: "f1", sourceLabel: "Remise max", sourceValue: "20 %", target: "marginRules.maxDiscountRate", targetValue: 0.2, confidence: 0.9, note: "" }], unknownFields: [], warnings: [] });
    expect(m.fields[0]!.id).toBe("f1");
    expect(() => migrationMapping.parse({ source: "clemz", fields: [{ sourceLabel: "x", sourceValue: "y", target: null, targetValue: null, confidence: 0.5, note: "" }], unknownFields: [], warnings: [] })).toThrow();
    expect(migrationApplyInput.parse({ mappingId: "m1", mapping: m, acceptedFieldIds: ["f1"] }).acceptedFieldIds).toEqual(["f1"]);
    // Sans identifiant de correspondance enregistrée : refusé (jamais une correspondance venue entièrement du client).
    expect(() => migrationApplyInput.parse({ mapping: m, acceptedFieldIds: ["f1"] })).toThrow();
  });
  it("conversion : texte ou capture obligatoire, captures en data URL image, 4 au plus ; fichier RGPD borné", () => {
    expect(() => migrationConvertInput.parse({})).toThrow(/Collez vos réglages/);
    expect(migrationConvertInput.parse({ text: "Remise max : 20 %" }).declaredSource).toBeNull();
    const img = "data:image/png;base64,AAAA";
    expect(migrationConvertInput.parse({ screenshots: [img], declaredSource: "bleam" }).screenshots).toHaveLength(1);
    expect(() => migrationConvertInput.parse({ screenshots: ["data:text/plain;base64,AAAA"] })).toThrow();
    expect(() => migrationConvertInput.parse({ screenshots: [img, img, img, img, img] })).toThrow();
    expect(() => migrationConvertInput.parse({ text: "x".repeat(MIGRATION_MAX_TEXT_CHARS + 1) })).toThrow();
    expect(migrationFileInput.parse({ content: "a;b" })).toEqual({ fileName: "", content: "a;b", declaredSource: null });
  });
});

describe("réglages de l'organisation : seuils de déclaration et lots", () => {
  it("valeurs par défaut (seuils 2026 paramétrables, lots activés) présentes dans orgSettings", () => {
    const s = orgSettings.parse({});
    expect(DECLARATION_THRESHOLDS_2026).toEqual({ salesCount: 30, revenueCents: 200_000, year: 2026 });
    expect(s.thresholds).toEqual({ enabled: true, salesCount: 30, revenueCents: 200_000, approachingRate: 0.8 });
    expect(s.bundles).toEqual({ enabled: true, maxItems: 4, staleAfterDays: 60, sameBuyerMinItems: 2, maxSuggestions: 10 });
    expect(declarationThresholds.parse({ salesCount: 50, revenueCents: 300_000 })).toMatchObject({ salesCount: 50, revenueCents: 300_000 });
    expect(() => declarationThresholds.parse({ approachingRate: 1.5 })).toThrow();
    expect(() => bundleSettings.parse({ maxItems: 1 })).toThrow();
    expect(() => bundleSettings.parse({ staleAfterDays: 3 })).toThrow();
  });
  it("d'anciens réglages enregistrés sans ces blocs restent lisibles", () => {
    const legacy = orgSettings.parse({ currency: "EUR", margin: { minMarginRate: 0.3 } });
    expect(legacy.thresholds.salesCount).toBe(30);
    expect(legacy.bundles.enabled).toBe(true);
  });
});
