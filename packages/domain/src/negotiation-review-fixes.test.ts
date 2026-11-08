import { describe, expect, it } from "vitest";
import { inventoryItem, marginRules, negotiationAutomation, order as orderSchema, type InventoryItem, type MigrationMapping, type Order } from "@selio/contracts";
import { suggestBundles } from "./bundles";
import { endToEndMargin, itemMargins, marginInputFromItem } from "./margin";
import { looksLikeSecret, mentionsSecret, mergeMappingCorrection, normalizeMigrationMapping, suggestMappingFromCandidates } from "./migration";
import { evaluateOffer } from "./negotiation";
import { decideFollowUp, recheckFollowUp } from "./negotiation-limits";
import { bundleArticlesText, bundleMessage, evaluateBundleOffer } from "./negotiation-lots";
import { SUGGESTED_KEYWORD_SITUATIONS, anySituationEscalates, applySituationOverride, escalatingSituation, matchSituation } from "./negotiation-situations";
import { projectedMargin } from "./pricing";

/**
 * Corrections de la relecture du bloc « négociation avancée, migration, fonctions que Bleam n'a pas » :
 * transmission jamais masquée par une situation plus spécifique, relance jamais sur un article vendu ni
 * après une réponse, lots nommés, secrets jamais gardés, marges cohérentes avec le reste de Selio.
 */

const now = new Date("2026-11-07T10:00:00Z");
const ago = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const rules = marginRules.parse({});

describe("situations : une transmission au vendeur n'est jamais masquée", () => {
  const message = "Il y a un petit trou ? Et l'envoi se fait quand, en colis ? 20 €";
  it("« envoi » est la plus spécifique, mais « défaut » (transmission) correspond aussi : la surcharge transmet", () => {
    expect(matchSituation(message, SUGGESTED_KEYWORD_SITUATIONS)?.situation.id).toBe("envoi");
    expect(escalatingSituation(message, SUGGESTED_KEYWORD_SITUATIONS)?.situation.id).toBe("defaut");
    expect(anySituationEscalates(message, SUGGESTED_KEYWORD_SITUATIONS)).toBe(true);
    const ev = evaluateOffer({ item: { purchasePriceCents: 500, purchaseFeesCents: 0, listedPriceCents: 2000, floorPriceCents: 1500 }, offerCents: 2000, rules, roundsSoFar: 0, now });
    expect(ev.decision).toBe("accept");
    expect(applySituationOverride(ev, escalatingSituation(message, SUGGESTED_KEYWORD_SITUATIONS)).decision).toBe("escalate");
  });
  it("ajouter des mots-clés d'autres situations ne permet pas d'éviter la transmission ; situation désactivée ignorée", () => {
    const stuffed = "colis livraison envoi quand délai expédition, ah et une tache";
    expect(anySituationEscalates(stuffed, SUGGESTED_KEYWORD_SITUATIONS)).toBe(true);
    const off = SUGGESTED_KEYWORD_SITUATIONS.map((s) => (s.id === "defaut" ? { ...s, enabled: false } : s));
    expect(anySituationEscalates(stuffed, off)).toBe(false);
    expect(anySituationEscalates("Quand partira le colis ?", SUGGESTED_KEYWORD_SITUATIONS)).toBe(false);
  });
});

describe("relance après 24 h : jamais « toujours disponible » à tort", () => {
  const conversation = { status: "open" as const, lastMessageDirection: "outbound" as const, lastMessageAt: ago(30) };
  it("article vendu, réservé ou commandé : aucune relance (code item_unavailable)", () => {
    expect(decideFollowUp({ conversation, plan: "pro", now, alreadyFollowedUp: false, itemAvailable: false })).toMatchObject({ action: "none", code: "item_unavailable" });
    expect(decideFollowUp({ conversation, plan: "pro", now, alreadyFollowedUp: false, itemAvailable: true }).action).toBe("draft");
    // Conversation sans article : rien n'empêche la relance.
    expect(decideFollowUp({ conversation, plan: "pro", now, alreadyFollowedUp: false }).action).toBe("draft");
  });
  it("revérification au moment d'envoyer : réponse de l'acheteur, article vendu, offre changée", () => {
    const base = { conversation, jobCreatedAt: ago(2), lastInboundAt: ago(40) };
    expect(recheckFollowUp(base)).toEqual({ ok: true });
    expect(recheckFollowUp({ ...base, lastInboundAt: ago(1) })).toMatchObject({ ok: false, code: "buyer_replied" });
    expect(recheckFollowUp({ ...base, conversation: { ...conversation, lastMessageDirection: "inbound" } })).toMatchObject({ ok: false, code: "buyer_replied" });
    expect(recheckFollowUp({ ...base, itemAvailable: false })).toMatchObject({ ok: false, code: "item_unavailable" });
    expect(recheckFollowUp({ ...base, conversation: { ...conversation, status: "archived" } })).toMatchObject({ ok: false, code: "archived" });
    // Cloud : la relance automatique exige encore l'offre Agence (« auto »).
    expect(recheckFollowUp({ ...base, mode: "auto", requireMode: "auto" })).toEqual({ ok: true });
    expect(recheckFollowUp({ ...base, mode: "suggested", requireMode: "auto" })).toMatchObject({ ok: false, code: "plan_changed" });
    expect(recheckFollowUp({ ...base, mode: "none", requireMode: "auto" })).toMatchObject({ ok: false, code: "not_in_plan" });
  });
});

describe("lots : l'accord porte sur des articles nommés", () => {
  const items = [
    { purchasePriceCents: 1500, purchaseFeesCents: 0, listedPriceCents: 4000, floorPriceCents: 3000 },
    { purchasePriceCents: 1000, purchaseFeesCents: 0, listedPriceCents: 2000, floorPriceCents: 1600 },
  ];
  const messages = negotiationAutomation.parse({}).messages;
  it("titres ajoutés au message quand le gabarit ne les cite pas ; {articles} quand il les cite", () => {
    const result = evaluateBundleOffer({ items, offerCents: 5800, rules, bundlePolicy: { maxDiscountRate: 0.2, minItems: 2 }, roundsSoFar: 0, now });
    expect(result.decision).toBe("accept");
    const text = bundleMessage(result, messages, { prenom: "Léa", titles: ["Veste en jean", "Pull marine"] })!;
    expect(text).toContain("Articles du lot : « Veste en jean » et « Pull marine ».");
    const custom = bundleMessage(result, { ...messages, bundleAccepted: "D'accord pour {articles} à {prix}." }, { titles: ["Veste", "Pull"] })!;
    expect(custom).toBe("D'accord pour « Veste » et « Pull » à 58,00 €.");
    expect(bundleArticlesText(["A", "B", "C"])).toBe("« A », « B » et « C »");
  });
});

describe("migration : aucun secret conservé", () => {
  it("libellés et valeurs élargis : code, compte, pseudo, PIN, mot de passe probable, téléphone", () => {
    for (const [label, value] of [["Code d'accès", "Azerty123!"], ["Compte", "jean.dupont"], ["Pseudo", "jeannot"], ["PIN", "1234"], ["Nom d'utilisateur", "jd"], ["Remarque", "Azerty123!"], ["Contact", "06 12 34 56 78"], ["Note", "écrire à jean@exemple.fr"]] as const) {
      expect(looksLikeSecret(label, value), `${label} : ${value}`).toBe(true);
    }
    // Réglages légitimes : jamais confondus avec un secret.
    for (const [label, value] of [["Remise max", "20 %"], ["Horaires", "9h-21h"], ["Relance après", "24 h"], ["Message de bienvenue", "Bonjour {prenom}, merci pour votre message !"], ["Mots-clés", "défaut, tache"]] as const) {
      expect(looksLikeSecret(label, value), `${label} : ${value}`).toBe(false);
    }
    expect(mentionsSecret("J'ai ignoré le mot de passe Azerty123!")).toBe(true);
    expect(mentionsSecret("Format libre : vérifiez chaque correspondance.")).toBe(false);
  });
  it("réglage inconnu : le libellé seulement, jamais la valeur ; note du modèle citant un secret écartée", () => {
    const m = normalizeMigrationMapping({
      source: "bleam",
      fields: [{ sourceLabel: "Remise max", sourceValue: "20 %", target: "marginRules.maxDiscountRate", targetValue: 0.2, confidence: 0.9, note: "Le mot de passe hunter2 a été ignoré" }],
      unknownFields: [{ sourceLabel: "Thème", sourceValue: "sombre", note: "" }, { sourceLabel: "Code d'accès", sourceValue: "Azerty123!", note: "" }],
      warnings: [],
    });
    expect(m.unknownFields).toEqual([{ sourceLabel: "Thème", sourceValue: "", note: "" }]);
    expect(JSON.stringify(m)).not.toMatch(/hunter2|Azerty123|sombre/);
    const fromFile = suggestMappingFromCandidates([{ sourceLabel: "Couleur", sourceValue: "bleu nuit" }]);
    expect(fromFile.unknownFields).toEqual([{ sourceLabel: "Couleur", sourceValue: "", note: "Aucun équivalent connu dans Selio." }]);
  });
  it("corrections de l'écran : seules la cible et la valeur des champs proposés sont reprises", () => {
    const stored: MigrationMapping = {
      source: "bleam",
      fields: [{ id: "f1", sourceLabel: "Remise max", sourceValue: "20 %", target: "marginRules.maxDiscountRate", targetValue: 0.2, confidence: 0.9, note: "" }],
      unknownFields: [],
      warnings: ["Vérifiez chaque correspondance."],
    };
    const corrected: MigrationMapping = {
      source: "clemz",
      fields: [
        { id: "f1", sourceLabel: "Inventé", sourceValue: "99 %", target: "marginRules.maxDiscountRate", targetValue: 0.15, confidence: 1, note: "" },
        { id: "f9", sourceLabel: "Ajouté", sourceValue: "1", target: "marginRules.minMarginCents", targetValue: 1, confidence: 1, note: "" },
      ],
      unknownFields: [],
      warnings: [],
    };
    const merged = mergeMappingCorrection(stored, corrected);
    expect(merged.fields).toEqual([{ ...stored.fields[0]!, targetValue: 0.15 }]);
    expect(merged.source).toBe("bleam");
    expect(merged.warnings).toEqual(stored.warnings);
    expect(mergeMappingCorrection(stored, null)).toEqual(stored);
  });
});

describe("marge de bout en bout : mêmes règles que les analyses et le Stock", () => {
  const item = (over: Partial<InventoryItem> = {}): InventoryItem =>
    inventoryItem.parse({ id: "it-1", orgId: "org", title: "Veste", purchasePriceCents: 2000, purchaseFeesCents: 300, listedPriceCents: 5000, status: "listed", listedAt: "2026-09-01T10:00:00Z", createdAt: "2026-08-20T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z", ...over });
  const order = (over: Partial<Order> = {}): Order =>
    orderSchema.parse({ id: "o-1", orgId: "org", itemId: "it-1", customerId: "c-1", dedupeKey: "k", status: "paid", salePriceCents: 4500, platformFeeCents: 0, shippingCostCents: 0, otherCostsCents: 0, purchasePriceCents: 2000, purchaseFeesCents: 300, createdAt: "2026-10-05T10:00:00Z", updatedAt: "2026-10-05T10:00:00Z", ...over });
  it("vente : l'instantané de la commande, même si le prix d'achat de l'article a été corrigé ensuite", () => {
    const corrected = item({ status: "sold", purchasePriceCents: 3000 });
    const m = endToEndMargin(marginInputFromItem(corrected, order()));
    expect(m.costCents).toBe(2300);
    expect(m.marginCents).toBe(4500 - 2300);
  });
  it("stock : frais attendus déduits comme la marge projetée du Stock et de la fiche article", () => {
    const withFees = marginRules.parse({ defaultPlatformFeeRate: 0.05, defaultShippingCostCents: 250 });
    const it1 = item();
    const projected = projectedMargin(it1, withFees)!;
    const [dated] = itemMargins([it1], [], null, withFees);
    expect(dated!.margin.marginCents).toBe(projected.marginCents);
    // Sans règles : comportement inchangé (aucun frais attendu).
    expect(itemMargins([it1], [])[0]!.margin.marginCents).toBe(5000 - 2300);
  });
});

describe("lots intelligents : un lot ne réunit jamais deux comptes Vinted", () => {
  const item = (over: Partial<InventoryItem> = {}): InventoryItem =>
    inventoryItem.parse({ id: "it-1", orgId: "org", title: "Pull", brand: "Sézane", size: "M", category: "women", status: "listed", purchasePriceCents: 1000, purchaseFeesCents: 0, listedPriceCents: 4000, floorPriceCents: 3000, listedAt: "2026-10-20T10:00:00Z", createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-20T10:00:00Z", ...over });
  it("même acheteur et même marque : regroupés par compte", () => {
    const items = [item({ id: "a", connectionId: "c1" }), item({ id: "b", connectionId: "c2" }), item({ id: "c", connectionId: "c1" })];
    const out = suggestBundles({ items, signals: { buyerInterest: [{ customerId: "k", itemIds: ["a", "b"] }] }, negotiation: negotiationAutomation.parse({}), rules, now });
    for (const s of out) {
      const accounts = new Set(s.itemIds.map((id) => items.find((i) => i.id === id)!.connectionId));
      expect(accounts.size).toBe(1);
    }
    expect(out.some((s) => s.itemIds.includes("a") && s.itemIds.includes("c"))).toBe(true);
  });
});
