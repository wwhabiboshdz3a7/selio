import { describe, expect, it } from "vitest";
import { buildUsageCounter, type NamedMeasurementField, type StudioFields } from "@selio/contracts";
import type { WornPhotoStatusView } from "../data/types";
import {
  WORN_NIGHT_DEFAULT, buildPrepAnswers, cmInputValue, emptyEdits, euros, expectedFor, inNightWindow, measurementRows, needsConfirmation,
  nextNightWindow, nightWindowLabel, parseCm, pendingConfirmations, provenanceText, scheduledLabel, wornRequestState,
} from "./prep";

const fields: StudioFields = {
  brand: { value: "Levi's", source: "label", confidence: 0.92 },
  size: { value: "W32 L32", source: "label", confidence: 0.9 },
  material: { value: null, source: null, question: "Quelle est la composition ?" },
  reference: { value: "501", source: "label", confidence: 0.85 },
};
const measurements: NamedMeasurementField[] = [
  { name: "waist", valueCm: 41, source: "tape_photo", confidence: 0.88 },
  { name: "inseam", valueCm: 81, source: "reference_db" },
  { name: "rise", valueCm: null, source: null, question: "Mesurez le montant." },
];

describe("provenance affichée", () => {
  it("dit d'où vient chaque valeur, avec la confiance d'une lecture, et « À renseigner » sans provenance", () => {
    expect(provenanceText("label", 0.92)).toBe("Lue sur l'étiquette · confiance 92 %");
    expect(provenanceText("tape_photo", 0.88)).toBe("Lue sur le mètre ruban · confiance 88 %");
    // La base et le vendeur n'ont pas de confiance de lecture : jamais un pourcentage inventé.
    expect(provenanceText("reference_db", 0.5)).toBe("Base des références");
    expect(provenanceText("seller")).toBe("Indiquée par le vendeur");
    expect(provenanceText(null)).toBe("À renseigner");
  });

  it("une lecture entre 0,5 et 0,7 est à confirmer ; la base et le vendeur ne le sont jamais", () => {
    expect(needsConfirmation("label", 0.62)).toBe(true);
    expect(needsConfirmation("tape_photo", 0.69)).toBe(true);
    expect(needsConfirmation("label", 0.7)).toBe(false);
    expect(needsConfirmation("reference_db", 0.1)).toBe(false);
    expect(needsConfirmation("seller", 0.1)).toBe(false);
    expect(needsConfirmation(null)).toBe(false);
  });
});

describe("saisie des mesures", () => {
  it("lit une longueur en cm (virgule ou point, arrondie au demi-centimètre) et refuse le reste", () => {
    expect(parseCm("52")).toBe(52);
    expect(parseCm("41,5")).toBe(41.5);
    expect(parseCm("41.25")).toBe(41.5);
    expect(parseCm(" 52 cm ")).toBe(52);
    expect(parseCm("")).toBeNull();
    expect(parseCm("   ")).toBeNull();
    for (const bad of ["abc", "0", "301", "-5", "12.345", "1 000"]) expect(parseCm(bad)).toBe("invalid");
  });

  it("un champ vide reste vide : aucune valeur par défaut", () => {
    expect(cmInputValue(null)).toBe("");
    expect(cmInputValue(undefined)).toBe("");
    expect(cmInputValue(41.5)).toBe("41,5");
  });

  it("les mesures attendues pour la famille s'ajoutent vides, sans provenance, dans l'ordre", () => {
    const rows = measurementRows([measurements[0]!], "bottom", ["sole"]);
    expect(rows.map((r) => r.name)).toEqual(["waist", "inseam", "sole"]);
    expect(rows[0]).toMatchObject({ valueCm: 41, source: "tape_photo" });
    for (const r of rows.slice(1)) expect(r).toEqual({ name: r.name, valueCm: null, source: null });
    expect(expectedFor("top")).toEqual(["chest", "length", "shoulders"]);
    expect(expectedFor("bag")).toEqual([]);
  });
});

describe("réponses du vendeur", () => {
  it("sans modification, rien n'est envoyé : les lectures gardent leur provenance", () => {
    expect(buildPrepAnswers({ fields, measurements }, emptyEdits())).toEqual({ ok: true, answers: { fields: {}, measurements: {} } });
    // Retaper la même valeur n'en change pas la provenance.
    expect(buildPrepAnswers({ fields, measurements }, { fields: { brand: " Levi's " }, measurements: { waist: "41" } })).toEqual({ ok: true, answers: { fields: {}, measurements: {} } });
  });

  it("une valeur changée devient « vous », un champ vidé devient vide (« je ne sais pas »)", () => {
    const r = buildPrepAnswers({ fields, measurements }, { fields: { brand: "Levi Strauss", size: "" , material: "100 % coton" }, measurements: { waist: "42,5", inseam: "", rise: "29" }, garmentKind: "bottom", shareMeasurements: true });
    expect(r).toEqual({
      ok: true,
      answers: { fields: { brand: "Levi Strauss", size: null, material: "100 % coton" }, measurements: { waist: 42.5, inseam: null, rise: 29 }, garmentKind: "bottom", shareMeasurements: true },
    });
  });

  it("une lecture peu sûre ou en désaccord reste « à confirmer » tant qu'elle n'est ni confirmée ni corrigée ; confirmée, elle est renvoyée telle quelle (elle devient « vous »)", () => {
    const current = {
      fields: { ...fields, size: { value: "W32 L32", source: "label" as const, confidence: 0.62 } },
      measurements: [...measurements, { name: "hips" as const, valueCm: 50, source: "tape_photo" as const, confidence: 0.9, question: "Hanches : le mètre ruban indique 50 cm, vous avez indiqué 53 cm. Laquelle est juste ?" }],
    };
    expect(pendingConfirmations(current, emptyEdits())).toEqual([{ field: "size", label: "Taille", step: "label", value: "W32 L32" }, { field: "hips", label: "Hanches", step: "measures", value: "50" }]);
    // Retaper la même valeur ne confirme rien ; la corriger, si.
    expect(pendingConfirmations(current, { fields: { size: " W32 L32 " }, measurements: { hips: "50" } }).map((p) => p.field)).toEqual(["size", "hips"]);
    expect(pendingConfirmations(current, { fields: { size: "W31 L32" }, measurements: { hips: "52" } })).toEqual([]);
    // Confirmée : plus rien en attente, et la valeur part au serveur (provenance « vous ») sans être retapée.
    const confirmed = { fields: {}, measurements: {}, confirmed: { size: true, hips: true } };
    expect(pendingConfirmations(current, confirmed)).toEqual([]);
    expect(buildPrepAnswers(current, confirmed)).toEqual({ ok: true, answers: { fields: { size: "W32 L32" }, measurements: { hips: 50 } } });
    // Une valeur sûre et sans question ne demande rien ; une lecture confirmée puis corrigée envoie la correction.
    expect(pendingConfirmations({ fields, measurements }, emptyEdits())).toEqual([]);
    expect(buildPrepAnswers(current, { fields: { size: "W31 L32" }, measurements: {}, confirmed: { size: true } })).toEqual({ ok: true, answers: { fields: { size: "W31 L32" }, measurements: {} } });
  });

  it("une mesure illisible bloque l'envoi au lieu d'être devinée", () => {
    const r = buildPrepAnswers({ fields, measurements }, { fields: {}, measurements: { waist: "quarante", rise: "29" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors)).toEqual(["waist"]);
  });
});

function status(patch: Partial<WornPhotoStatusView> & { used?: number; quota?: number } = {}): WornPhotoStatusView {
  const { used = 0, quota = 10, ...rest } = patch;
  return {
    counter: buildUsageCounter(used, quota),
    planQuota: quota,
    overage: { enabled: false, unitCents: 25, proposal: true, billable: false },
    window: { ...WORN_NIGHT_DEFAULT },
    nextWindow: { start: "2026-11-04T21:00:00.000Z", end: "2026-11-05T05:00:00.000Z", inWindow: false },
    provider: { name: "noop", configured: false, message: "aucun fournisseur configuré : décision à prendre" },
    ...rest,
  };
}

describe("photos portées : quota et dépassement", () => {
  it("dans le quota : demande possible, case d'accord inutile", () => {
    expect(wornRequestState(status({ used: 3 }), false)).toEqual({ canRequest: true, atQuota: false, consentEnabled: false, reason: null });
  });

  it("offre sans photos portées : rien n'est possible", () => {
    const s = wornRequestState(status({ quota: 0 }), true);
    expect(s.canRequest).toBe(false);
    expect(s.consentEnabled).toBe(false);
    expect(s.reason).toMatch(/pas incluses dans votre offre/);
  });

  it("quota atteint et réglage serveur fermé (WORN_OVERAGE_ENABLED=false) : case désactivée, même avec l'accord", () => {
    const s = wornRequestState(status({ used: 10 }), true);
    expect(s).toMatchObject({ canRequest: false, atQuota: true, consentEnabled: false });
    expect(s.reason).toMatch(/WORN_OVERAGE_ENABLED/);
  });

  it("quota atteint, réglage ouvert mais abonnement non facturable : case désactivée", () => {
    const s = wornRequestState(status({ used: 10, overage: { enabled: true, unitCents: 25, proposal: true, billable: false } }), true);
    expect(s).toMatchObject({ canRequest: false, consentEnabled: false });
    expect(s.reason).toMatch(/carte enregistrée/);
  });

  it("quota atteint, réglage ouvert et facturable : la demande exige l'accord explicite", () => {
    const open = status({ used: 10, overage: { enabled: true, unitCents: 25, proposal: true, billable: true } });
    expect(wornRequestState(open, false)).toMatchObject({ canRequest: false, consentEnabled: true });
    expect(wornRequestState(open, false).reason).toMatch(/cochez l'accord/);
    expect(wornRequestState(open, true)).toEqual({ canRequest: true, atQuota: true, consentEnabled: true, reason: null });
  });

  it("0,25 € s'écrit à la française", () => {
    expect(euros(25)).toMatch(/^0,25\s€$/);
  });
});

describe("file de nuit (22 h – 6 h, heure de Paris)", () => {
  it("prochaine fenêtre depuis l'après-midi, la nuit même, et le petit matin ; heure d'été comprise", () => {
    // 13 h à Paris (novembre, UTC+1) → ce soir 22 h.
    expect(nextNightWindow(new Date("2026-11-04T12:00:00Z"))).toEqual({ start: new Date("2026-11-04T21:00:00Z"), end: new Date("2026-11-05T05:00:00Z"), inWindow: false });
    // 0 h à Paris : déjà dans la fenêtre, qui se termine à 6 h.
    const night = nextNightWindow(new Date("2026-11-04T23:00:00Z"));
    expect(night.inWindow).toBe(true);
    expect(night.start).toEqual(new Date("2026-11-04T23:00:00Z"));
    expect(night.end).toEqual(new Date("2026-11-05T05:00:00Z"));
    // 6 h 30 à Paris : la fenêtre vient de se fermer, la prochaine est le soir même.
    expect(nextNightWindow(new Date("2026-11-05T05:30:00Z"))).toMatchObject({ start: new Date("2026-11-05T21:00:00Z"), inWindow: false });
    // Juillet (UTC+2) : 22 h à Paris = 20 h UTC.
    expect(nextNightWindow(new Date("2026-07-01T12:00:00Z"))).toEqual({ start: new Date("2026-07-01T20:00:00Z"), end: new Date("2026-07-02T04:00:00Z"), inWindow: false });
    expect(inNightWindow(new Date("2026-07-01T21:00:00Z"))).toBe(true);
    expect(inNightWindow(new Date("2026-07-01T12:00:00Z"))).toBe(false);
    expect(inNightWindow(new Date("2026-11-05T04:59:00Z"))).toBe(true);
    expect(inNightWindow(new Date("2026-11-05T05:00:00Z"))).toBe(false);
  });

  it("heure prévue lisible : ce soir, demain, une date, ou dès que possible", () => {
    const now = new Date("2026-11-04T12:00:00Z");
    expect(scheduledLabel("2026-11-04T21:00:00.000Z", now)).toBe("ce soir à 22:00");
    expect(scheduledLabel("2026-11-05T21:00:00.000Z", now)).toBe("demain à 22:00");
    expect(scheduledLabel("2026-11-10T21:00:00.000Z", now)).toMatch(/^le 10 nov\.? à 22:00$/);
    expect(scheduledLabel("2026-11-04T11:00:00.000Z", now)).toBe("dès que possible cette nuit");
    expect(nightWindowLabel(WORN_NIGHT_DEFAULT)).toBe("entre 22 h et 6 h (heure de Paris)");
  });
});
