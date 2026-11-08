import { describe, expect, it } from "vitest";
import { MIGRATION_TARGETS, migrationMappingOutput, orgSettings } from "@selio/contracts";
import {
  MIGRATION_CATALOG, MIGRATION_FORBIDDEN_NOTE, MIGRATION_TARGET_PATHS, applyMapping, catalogEntry, catalogLines, checkMessageWording, coerceRate, coerceTargetValue, looksLikeSecret, matchCatalog,
  normalizeMigrationMapping, parseRgpdExport, parseScheduleText, parseSettingsText, suggestMappingFromCandidates,
} from "./migration";

describe("catalogue des équivalences « ancien → nouveau »", () => {
  it("couvre toutes les cibles fermées, une seule fois, avec des chemins d'écriture", () => {
    expect(MIGRATION_CATALOG.map((e) => e.target).sort()).toEqual([...MIGRATION_TARGETS].sort());
    for (const t of MIGRATION_TARGETS) {
      expect(catalogEntry(t).synonyms.length).toBeGreaterThan(0);
      const where = MIGRATION_TARGET_PATHS[t];
      expect(Boolean(where.settings) || Boolean(where.rule)).toBe(true);
    }
    // Chaque chemin d'écriture existe dans les réglages par défaut (pas de faute de frappe silencieuse).
    const defaults = orgSettings.parse({}) as unknown as Record<string, unknown>;
    for (const t of MIGRATION_TARGETS) {
      const path = MIGRATION_TARGET_PATHS[t].settings;
      if (!path) continue;
      const leaf = path.reduce<unknown>((node, key) => (node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined), defaults);
      expect(leaf, `${t} → ${path.join(".")}`).not.toBeUndefined();
    }
    expect(catalogLines().length).toBe(MIGRATION_CATALOG.length);
    expect(catalogLines()[0]).toMatch(/→ marginRules\./);
  });
  it("reconnaît les libellés courants (sans accents ni casse), sinon null", () => {
    expect(matchCatalog("Remise max")).toEqual({ target: "marginRules.maxDiscountRate", score: 1 });
    expect(matchCatalog("REMISE MAXIMALE (%)")?.target).toBe("marginRules.maxDiscountRate");
    expect(matchCatalog("Horaires")?.target).toBe("schedule");
    expect(matchCatalog("Message d'accueil")?.target).toBe("messages.greeting");
    expect(matchCatalog("Délai de relance")?.target).toBe("followUp.delayHours");
    expect(matchCatalog("Réponse automatique")?.target).toBe("autoReply.enabled");
    expect(matchCatalog("Couleur du thème")).toBeNull();
    expect(matchCatalog("")).toBeNull();
  });
});

describe("conversion des valeurs", () => {
  it("taux : 0,2 / « 20 % » / 20 → 0,2 ; refus au-delà de 100 %", () => {
    expect(coerceRate("20 %")).toBe(0.2);
    expect(coerceRate("0,25")).toBe(0.25);
    expect(coerceRate(15)).toBe(0.15);
    expect(coerceRate(1)).toBe(1);
    expect(coerceRate("150 %")).toBeNull();
    expect(coerceRate("abc")).toBeNull();
  });
  it("centimes, entiers, heures, durées, oui/non, ton, texte, plage horaire", () => {
    expect(coerceTargetValue("marginRules.minMarginCents", "5 €")).toEqual({ ok: true, value: 500 });
    expect(coerceTargetValue("marginRules.minMarginCents", 500)).toEqual({ ok: true, value: 500 });
    expect(coerceTargetValue("marginRules.minMarginCents", 5.5)).toEqual({ ok: true, value: 550 });
    expect(coerceTargetValue("marginRules.maxRoundsPerCustomer", "3 contre-offres")).toEqual({ ok: true, value: 3 });
    expect(coerceTargetValue("schedule.activeFrom", "9h")).toEqual({ ok: true, value: 9 });
    expect(coerceTargetValue("schedule.activeTo", "22:00")).toEqual({ ok: true, value: 22 });
    expect(coerceTargetValue("followUp.delayHours", "2 jours")).toEqual({ ok: true, value: 48 });
    expect(coerceTargetValue("followUp.delayHours", "24 h")).toEqual({ ok: true, value: 24 });
    expect(coerceTargetValue("favorites.delayMinutes", "1 h")).toEqual({ ok: true, value: 60 });
    expect(coerceTargetValue("priceDrops.afterDays", "10")).toEqual({ ok: true, value: 10 });
    expect(coerceTargetValue("autoReply.enabled", "Oui")).toEqual({ ok: true, value: true });
    expect(coerceTargetValue("autoReply.enabled", "désactivé")).toEqual({ ok: true, value: false });
    expect(coerceTargetValue("autoReply.enabled", "peut-être")).toMatchObject({ ok: false });
    expect(coerceTargetValue("ai.tone", "Chaleureux")).toEqual({ ok: true, value: "friendly" });
    expect(coerceTargetValue("ai.tone", "robot")).toMatchObject({ ok: false });
    expect(coerceTargetValue("messages.greeting", "Bonjour {prenom} !")).toEqual({ ok: true, value: "Bonjour {prenom} !" });
    expect(coerceTargetValue("messages.greeting", "")).toMatchObject({ ok: false, reason: "valeur absente" });
    expect(coerceTargetValue("schedule", "de 8h à 22h")).toEqual({ ok: true, value: "8-22" });
    expect(parseScheduleText("08:00 – 21:30")).toEqual({ activeFrom: 8, activeTo: 21 });
    expect(parseScheduleText("22h-8h")).toBeNull();
    expect(parseScheduleText("toute la journée")).toBeNull();
  });
  it("D20 : « meilleur prix » interdit partout, « dernier prix » seulement dans le message de dernière offre", () => {
    expect(checkMessageWording("messages.counter", "Je peux vous le faire à {prix}.")).toEqual({ ok: true });
    expect(checkMessageWording("messages.counter", "C'est mon meilleur prix")).toMatchObject({ ok: false });
    expect(checkMessageWording("messages.counter", "C'est mon dernier prix")).toMatchObject({ ok: false });
    expect(checkMessageWording("messages.final", "C'est mon dernier prix")).toEqual({ ok: true });
    expect(checkMessageWording("messages.final", "Mon meilleur prix")).toMatchObject({ ok: false });
    expect(checkMessageWording("marginRules.maxDiscountRate", "meilleur prix")).toEqual({ ok: true });
  });
  it("identifiants, mots de passe, jetons et contacts sont reconnus et jamais migrés", () => {
    expect(looksLikeSecret("Mot de passe", "abc")).toBe(true);
    expect(looksLikeSecret("Email", "x@y.fr")).toBe(true);
    expect(looksLikeSecret("Clé", "marie@exemple.fr")).toBe(true);
    expect(looksLikeSecret("Token", "x")).toBe(true);
    expect(looksLikeSecret("Note", "a".repeat(40))).toBe(true);
    expect(looksLikeSecret("Remise max", "20 %")).toBe(false);
    expect(MIGRATION_FORBIDDEN_NOTE).toMatch(/ne demande jamais vos identifiants/);
  });
});

const pasted = `Remise max : 20 %
Marge minimum : 5 €
Horaires : 9h-21h
Message d'accueil : Bonjour {prenom}, merci pour votre intérêt !
Message de contre-offre : C'est mon meilleur prix, {prix}.
Relance après : 24 h
Réponse automatique : oui
Couleur du thème : sombre
Email : marie@exemple.fr
Mot de passe : hunter2`;

describe("texte collé et correspondance déterministe", () => {
  it("lit les lignes « libellé : valeur » (ou =, tabulation, →)", () => {
    const c = parseSettingsText("Remise max = 20 %\nHoraires\t9h-21h\n- Relance → 24 h\nligne sans séparateur\n");
    expect(c).toEqual([
      { sourceLabel: "Remise max", sourceValue: "20 %" },
      { sourceLabel: "Horaires", sourceValue: "9h-21h" },
      { sourceLabel: "Relance", sourceValue: "24 h" },
    ]);
  });
  it("propose une correspondance sans IA : cibles connues converties, inconnus listés, secrets ignorés, D20 appliqué", () => {
    const m = suggestMappingFromCandidates(parseSettingsText(pasted), "other");
    expect(m.source).toBe("other");
    expect(m.fields.map((f) => [f.id, f.target, f.targetValue])).toEqual([
      ["f1", "marginRules.maxDiscountRate", 0.2],
      ["f2", "marginRules.minMarginCents", 500],
      ["f3", "schedule", "9-21"],
      ["f4", "messages.greeting", "Bonjour {prenom}, merci pour votre intérêt !"],
      ["f5", "followUp.delayHours", 24],
      ["f6", "autoReply.enabled", true],
    ]);
    // Inconnus du catalogue d'abord, puis les champs écartés à la normalisation (ici : D20).
    expect(m.unknownFields.map((u) => u.sourceLabel)).toEqual(["Couleur du thème", "Message de contre-offre"]);
    expect(m.unknownFields.find((u) => u.sourceLabel === "Message de contre-offre")!.note).toMatch(/meilleur prix/);
    expect(JSON.stringify(m)).not.toContain("hunter2");
    expect(JSON.stringify(m)).not.toContain("marie@exemple.fr");
    expect(m.warnings.join(" ")).toMatch(/identifiant, un mot de passe ou un contact/);
  });
});

describe("normalisation d'une sortie du modèle", () => {
  it("identifiants posés, cible inconnue → inconnu, confiance faible → inconnu, doublon de cible → le plus sûr gagne, valeur inconvertible → inconnu", () => {
    const out = migrationMappingOutput.parse({
      source: "bleam",
      fields: [
        { sourceLabel: "Remise max", sourceValue: "20 %", target: "marginRules.maxDiscountRate", targetValue: 0.2, confidence: 0.9 },
        { sourceLabel: "Réduction maximale", sourceValue: "25 %", target: "marginRules.maxDiscountRate", targetValue: 0.25, confidence: 0.6 },
        { sourceLabel: "Truc", sourceValue: "x", target: "chemin.invente", targetValue: "x", confidence: 0.9 },
        { sourceLabel: "Horaires", sourceValue: "le matin", target: "schedule", targetValue: "le matin", confidence: 0.9 },
        { sourceLabel: "Relance", sourceValue: "parfois", target: "followUp.delayHours", targetValue: null, confidence: 0.3 },
        { sourceLabel: "Mot de passe", sourceValue: "secret", target: "ai.signature", targetValue: "secret", confidence: 1 },
        42,
      ],
      unknownFields: [{ sourceLabel: "Thème", sourceValue: "sombre" }],
      warnings: ["Unité incertaine pour la relance."],
    });
    const m = normalizeMigrationMapping(out);
    expect(m.source).toBe("bleam");
    expect(m.fields).toEqual([{ id: "f1", sourceLabel: "Remise max", sourceValue: "20 %", target: "marginRules.maxDiscountRate", targetValue: 0.2, confidence: 0.9, note: "" }]);
    expect(m.unknownFields.map((u) => u.sourceLabel)).toEqual(["Thème", "Réduction maximale", "Truc", "Horaires", "Relance"]);
    expect(m.unknownFields.find((u) => u.sourceLabel === "Relance")?.note).toMatch(/Confiance trop faible/);
    expect(m.unknownFields.find((u) => u.sourceLabel === "Horaires")?.note).toMatch(/plage horaire illisible/);
    expect(JSON.stringify(m)).not.toContain("secret");
    expect(m.warnings).toContain("Unité incertaine pour la relance.");
  });
  it("la sortie du modèle est tolérante : source inconnue → unknown, confiance en pourcentage ramenée à 0–1", () => {
    const out = migrationMappingOutput.parse({ source: "autre-outil", fields: [{ sourceLabel: "Remise max", sourceValue: "20 %", target: "marginRules.maxDiscountRate", targetValue: "20 %", confidence: 90 }] });
    expect(out.source).toBe("unknown");
    expect(out.fields[0]!.confidence).toBe(0.9);
    expect(normalizeMigrationMapping(out).fields[0]!.targetValue).toBe(0.2);
  });
});

describe("application des champs acceptés", () => {
  const current = orgSettings.parse({ ai: { signature: "— Marie" } });
  const mapping = suggestMappingFromCandidates(parseSettingsText(pasted), "clemz");
  it("n'écrit que les champs acceptés, revalide par zod, rend les cibles de règle à part", () => {
    const r = applyMapping(current, mapping, ["f1", "f3", "f5", "f6"]);
    expect(r.applied.map((a) => a.target)).toEqual(["marginRules.maxDiscountRate", "schedule", "followUp.delayHours", "autoReply.enabled"]);
    expect(r.settings.margin.maxDiscountRate).toBe(0.2);
    expect(r.settings.margin.minMarginCents).toBe(current.margin.minMarginCents);
    expect(r.settings.automation.negotiation.timing).toMatchObject({ activeFrom: 9, activeTo: 21 });
    expect(r.settings.automation.negotiation.messages.greeting).toBe(current.automation.negotiation.messages.greeting);
    expect(r.settings.automation.autoReply.enabled).toBe(true);
    expect(r.settings.ai.signature).toBe("— Marie");
    expect(r.ruleConfigs).toEqual({ follow_up_no_reply: { delayHours: 24 } });
    expect(r.skipped).toEqual([]);
    expect(orgSettings.parse(r.settings)).toEqual(r.settings);
  });
  it("rien d'accepté : réglages identiques ; un champ hors bornes est ignoré et expliqué sans toucher aux autres", () => {
    expect(applyMapping(current, mapping, []).settings).toEqual(current);
    const bad = normalizeMigrationMapping({
      source: "other",
      fields: [
        { sourceLabel: "Contre-offres max", sourceValue: "25", target: "marginRules.maxRoundsPerCustomer", targetValue: 25, confidence: 1, note: "" },
        { sourceLabel: "Remise max", sourceValue: "10 %", target: "marginRules.maxDiscountRate", targetValue: 0.1, confidence: 1, note: "" },
      ],
      unknownFields: [],
      warnings: [],
    });
    const r = applyMapping(current, bad, ["f1", "f2"]);
    expect(r.applied.map((a) => a.target)).toEqual(["marginRules.maxDiscountRate"]);
    expect(r.skipped).toEqual([{ id: "f1", reason: expect.stringMatching(/hors bornes/) }]);
    expect(r.settings.margin.maxRoundsPerCustomer).toBe(current.margin.maxRoundsPerCustomer);
  });
  it("un message qui contredirait D20 est refusé à l'application aussi (défense en profondeur)", () => {
    const forged = { ...mapping, fields: [{ id: "x1", sourceLabel: "Contre-offre", sourceValue: "mon meilleur prix", target: "messages.counter" as const, targetValue: "mon meilleur prix", confidence: 1, note: "" }] };
    const r = applyMapping(current, forged, ["x1"]);
    expect(r.applied).toEqual([]);
    expect(r.skipped[0]!.reason).toMatch(/meilleur prix/);
  });
});

describe("fichier de portabilité RGPD (format libre, aucun schéma supposé)", () => {
  it("JSON : clés/valeurs à plat, chemins pointés", () => {
    const r = parseRgpdExport(JSON.stringify({ settings: { negotiation: { maxDiscount: "20%", messages: ["Bonjour", "Merci"] }, enabled: true }, account: { email: "x@y.fr" } }));
    expect(r.format).toBe("json");
    expect(r.candidates).toEqual([
      { sourceLabel: "settings.negotiation.maxDiscount", sourceValue: "20%" },
      { sourceLabel: "settings.negotiation.messages[0]", sourceValue: "Bonjour" },
      { sourceLabel: "settings.negotiation.messages[1]", sourceValue: "Merci" },
      { sourceLabel: "settings.enabled", sourceValue: "true" },
      { sourceLabel: "account.email", sourceValue: "x@y.fr" },
    ]);
    expect(r.warnings.join(" ")).toMatch(/sans schéma supposé/);
    const m = suggestMappingFromCandidates(r.candidates);
    expect(JSON.stringify(m)).not.toContain("x@y.fr");
  });
  it("CSV à deux colonnes (en-tête clé/valeur ignoré, guillemets gérés) et CSV à plusieurs colonnes", () => {
    const two = parseRgpdExport('clé;valeur\n"Remise max";"20 %"\nHoraires;"9h-21h"\n');
    expect(two.format).toBe("csv");
    expect(two.candidates).toEqual([{ sourceLabel: "Remise max", sourceValue: "20 %" }, { sourceLabel: "Horaires", sourceValue: "9h-21h" }]);
    const many = parseRgpdExport("nom,remise,horaires\nBoutique,15 %,8h-20h\n");
    expect(many.candidates).toEqual([
      { sourceLabel: "ligne 2 › nom", sourceValue: "Boutique" },
      { sourceLabel: "ligne 2 › remise", sourceValue: "15 %" },
      { sourceLabel: "ligne 2 › horaires", sourceValue: "8h-20h" },
    ]);
  });
  it("texte libre, JSON cassé et fichier vide", () => {
    expect(parseRgpdExport("Remise max : 20 %\n").format).toBe("text");
    const broken = parseRgpdExport("{ pas du json\nRemise max : 20 %");
    expect(broken.format).toBe("text");
    expect(broken.candidates).toEqual([{ sourceLabel: "Remise max", sourceValue: "20 %" }]);
    expect(parseRgpdExport("   ")).toEqual({ format: "empty", candidates: [], warnings: ["Fichier vide."] });
  });
});
