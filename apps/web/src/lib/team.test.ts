import { describe, expect, it } from "vitest";
import { ROLES } from "@selio/contracts";
import { PHOTOS_HOME, hasReducedView, reducedViewAllows, reducedViewTarget, seesFinances } from "./roles";
import { glassEnabled, glassStorageKey, readGlassPreference, writeGlassPreference } from "./glass";
import { COMPTES_NOTICE, COMPTES_STEP_IDS, DEFAULT_COMPTES_INPUT, checklistProgress, cleanSignature, generateComptesTexts, loadComptes, saveComptes } from "./comptes";
import { referralCodeForSignup, referralCodeFromSearch } from "./referral";
import { formatUptime } from "./supervision";
import { demoHealthDetails, demoReferralCode } from "./demo/team";
import { REFERRAL_CODE_RE } from "@selio/contracts";

class MemoryStorage {
  map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
}

describe("rôles côté interface", () => {
  it("seuls le titulaire, l'administrateur et la lecture seule voient les finances", () => {
    expect(ROLES.filter(seesFinances)).toEqual(["owner", "admin", "viewer"]);
  });

  it("vue réduite pour le contributeur photos seulement", () => {
    expect(ROLES.filter(hasReducedView)).toEqual(["photographer"]);
  });

  it("vue réduite : articles → photos, Studio, apparence, sécurité, aide ; le reste est refusé", () => {
    for (const ok of [PHOTOS_HOME, "/app/items/item-001/photos", "/studio", "/studio/annonces", "/app/settings/apparence", "/app/settings/security", "/app/help", "/app/settings"]) {
      expect(reducedViewAllows(ok), ok).toBe(true);
    }
    for (const no of ["/app/items/item-001", "/app/items/item-001/edit", "/app/messages", "/app/orders", "/app/analytics", "/app/settings/billing", "/app/settings/access", "/app/radar", "/cloud", "/admin", "/studiox"]) {
      expect(reducedViewAllows(no), no).toBe(false);
    }
    // Les accueils mènent à la liste des articles à photographier ; une page refusée n'a pas de destination.
    expect(reducedViewTarget("/app")).toBe(PHOTOS_HOME);
    expect(reducedViewTarget("/app/espaces")).toBe(PHOTOS_HOME);
    expect(reducedViewTarget("/app/items")).toBe(PHOTOS_HOME);
    expect(reducedViewTarget("/app/messages")).toBeNull();
    expect(reducedViewTarget("/studio")).toBe("/studio");
  });
});

describe("essai « verre liquide » : réglage", () => {
  it("désactivé par défaut ; VITE_EXPERIMENT_GLASS change la valeur par défaut ; le choix explicite l'emporte", () => {
    expect(glassEnabled(null, false)).toBe(false);
    expect(glassEnabled(null, true)).toBe(true);
    expect(glassEnabled("off", true)).toBe(false);
    expect(glassEnabled("on", false)).toBe(true);
  });

  it("mémorisé par utilisateur : le choix de l'un ne change rien pour l'autre", () => {
    const storage = new MemoryStorage();
    expect(readGlassPreference("user-a", storage)).toBeNull();
    writeGlassPreference("user-a", "on", storage);
    expect(readGlassPreference("user-a", storage)).toBe("on");
    expect(readGlassPreference("user-b", storage)).toBeNull();
    expect(glassStorageKey("user-a")).not.toBe(glassStorageKey("user-b"));
    // Valeur inconnue (ancienne version, saisie à la main) : ignorée.
    storage.setItem(glassStorageKey("user-c"), "peut-être");
    expect(readGlassPreference("user-c", storage)).toBeNull();
  });

  it("stockage indisponible : aucune erreur, valeur par défaut", () => {
    const broken = { getItem: () => { throw new Error("bloqué"); } };
    expect(readGlassPreference("user-a", broken)).toBeNull();
  });
});

describe("Selio Comptes", () => {
  it("le bandeau dit que Selio ne crée aucun compte", () => {
    expect(COMPTES_NOTICE).toBe("Selio ne crée aucun compte à votre place : vous suivez la checklist dans Vinted.");
  });

  it("textes déterministes, à partir des réponses seulement", () => {
    const a = generateComptesTexts({ ...DEFAULT_COMPTES_INPUT, signature: "Marie", shippingDays: 3, bundleDiscount: 15 });
    const b = generateComptesTexts({ ...DEFAULT_COMPTES_INPUT, signature: "Marie", shippingDays: 3, bundleDiscount: 15 });
    expect(a).toEqual(b);
    expect(a.presentation).toContain("3 jours ouvrés");
    expect(a.presentation).toContain("−15 %");
    expect(a.presentation.endsWith("Marie")).toBe(true);
    expect(a.shippingRules).toContain("Expédition sous 3 jours ouvrés");
    expect(a.replies.map((r) => r.id)).toEqual(["disponible", "mesures", "lot", "offre", "envoye"]);
    expect(a.replies.find((r) => r.id === "lot")!.text).toContain("15 %");
  });

  it("sans lots : aucune remise promise ; valeurs hors bornes ramenées dans les bornes", () => {
    const t = generateComptesTexts({ ...DEFAULT_COMPTES_INPUT, bundles: false, shippingDays: 42, bundleDiscount: 90 });
    expect(t.presentation).not.toMatch(/−\d+ %/);
    expect(t.shippingRules).toContain("Pas de lot");
    expect(t.shippingRules).toContain("7 jours ouvrés");
    expect(generateComptesTexts({ ...DEFAULT_COMPTES_INPUT, shippingDays: 1 }).shippingRules).toContain("1 jour ouvré");
    // Aucun texte ne promet ce que le vendeur n'a pas choisi, ni ne se présente comme Vinted.
    for (const text of [t.presentation, t.shippingRules, ...t.replies.map((r) => r.text)]) {
      expect(text).not.toMatch(/partenaire|officiel|garanti|zéro risque/i);
    }
  });

  it("signature : une ligne, 40 caractères au plus", () => {
    expect(cleanSignature("  Marie\n\nAtelier  ")).toBe("Marie Atelier");
    expect(cleanSignature("x".repeat(80))).toHaveLength(40);
  });

  it("checklist cochée gardée sur l'appareil, étapes inconnues ignorées", () => {
    const storage = new MemoryStorage();
    expect(loadComptes("org-1", storage).done).toEqual([]);
    expect(checklistProgress(new Set()).done).toBe(0);
    const done = [COMPTES_STEP_IDS[0]!, COMPTES_STEP_IDS[1]!, "ancienne.etape"];
    saveComptes("org-1", { done, input: { ...DEFAULT_COMPTES_INPUT, shippingDays: 4 } }, storage);
    const back = loadComptes("org-1", storage);
    expect(back.done).toEqual(done.slice(0, 2));
    expect(back.input.shippingDays).toBe(4);
    expect(loadComptes("org-2", storage).done).toEqual([]);
    const p = checklistProgress(new Set(back.done));
    expect(p).toEqual({ done: 2, total: COMPTES_STEP_IDS.length, percent: Math.round((2 / COMPTES_STEP_IDS.length) * 100) });
    storage.setItem("selio.comptes.org-3", "{pas du json");
    expect(loadComptes("org-3", storage)).toEqual({ done: [], input: DEFAULT_COMPTES_INPUT });
  });
});

describe("parrainage à l'inscription", () => {
  it("lit le code du lien partagé (forme libre ramenée à la forme canonique)", () => {
    expect(referralCodeFromSearch("?parrain=ab3-k7q")).toBe("AB3K7Q");
    expect(referralCodeFromSearch("parrain=AB3K7Q&x=1")).toBe("AB3K7Q");
    expect(referralCodeFromSearch("?parrain=0O1IL")).toBe("");
    expect(referralCodeFromSearch("")).toBe("");
  });

  it("jamais bloquant : vide → rien envoyé ; mal formé → envoyé tel quel (le serveur répond par un message)", () => {
    expect(referralCodeForSignup("  ")).toBeUndefined();
    expect(referralCodeForSignup("ab3 k7q")).toBe("AB3K7Q");
    expect(referralCodeForSignup("pas-un-code")).toBe("pas-un-code");
  });

  it("code de démonstration stable et valide", () => {
    expect(demoReferralCode("org-demo")).toBe(demoReferralCode("org-demo"));
    expect(REFERRAL_CODE_RE.test(demoReferralCode("org-demo"))).toBe(true);
    expect(demoReferralCode("org-demo")).not.toBe(demoReferralCode("org-autre"));
  });
});

describe("supervision", () => {
  it("durée de fonctionnement lisible", () => {
    expect(formatUptime(0)).toBe("0 min");
    expect(formatUptime(12 * 60)).toBe("12 min");
    expect(formatUptime(2 * 3600 + 5 * 60)).toBe("2 h 5 min");
    expect(formatUptime(3 * 86_400 + 4 * 3600)).toBe("3 j 4 h");
  });

  it("exemple de la démo : une alerte après 3 échecs, puis le rétablissement, aucun secret", () => {
    const d = demoHealthDetails(new Date("2026-11-08T10:00:00Z"));
    expect(d.simulated).toBe(true);
    // La panne de la nuit est dans les alertes gardées 7 jours, plus dans les dernières vérifications.
    const events = d.supervision.alerts.map((c) => c.event);
    expect(events).toEqual(["recovered", "reminder", "alert"]);
    expect(d.supervision.alerts.every((a) => a.delivered !== null && a.delivered > 0)).toBe(true);
    expect(d.supervision.recent.filter((c) => c.event)).toHaveLength(0);
    expect(JSON.stringify(d)).not.toMatch(/token|secret|password/i);
  });
});
