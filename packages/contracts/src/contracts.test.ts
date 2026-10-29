import { describe, expect, it } from "vitest";
import {
  CHARGE_RETRY_DELAYS_DAYS, DATA_RETENTION_DAYS_AFTER_END, DEFAULT_TRIAL_DAYS, DEFAULT_VAT_RATE, INVOICE_NUMBER_RE, PAID_PLANS, PLANS, PLAN_LABELS, PLAN_QUOTAS, SUBSCRIPTION_PROVIDERS, TRIAL_DAYS, TRIAL_DAYS_OPTIONS, TRIAL_PLAN, USAGE_EVENT_KINDS, USAGE_WARNING_RATE, VAT_FRANCHISE_NOTICE,
  buildUsageCounter, checkoutInput, completeQuotas, inventoryItemCreate, invoice, invoiceAmounts, isLegacyQuotas, negotiationAutomation, nextChargeDelayDays, orderCreate, paymentOrder, planQuotas, quotasForPlan, registerInput, replySuggestion, resolveQuotas, subscription, trialDays, usageEvent, usagePercent,
} from "./index";

describe("contracts", () => {
  it("applique des valeurs par défaut cohérentes à un article", () => {
    const parsed = inventoryItemCreate.parse({ title: "Veste" });
    expect(parsed.status).toBe("in_stock");
    expect(parsed.purchasePriceCents).toBe(0);
    expect(parsed.photos).toEqual([]);
  });
  it("refuse une commande sans prix entier", () => {
    expect(() => orderCreate.parse({ itemId: "a", customerId: "b", salePriceCents: 12.5 })).toThrow();
  });
  it("valide une sortie IA structurée et refuse les intentions inconnues", () => {
    expect(replySuggestion.safeParse({ reply: "Bonjour", intent: "answer" }).success).toBe(true);
    expect(replySuggestion.safeParse({ reply: "Bonjour", intent: "buy_now" }).success).toBe(false);
  });
  it("exige un mot de passe de 10 caractères", () => {
    expect(registerInput.safeParse({ email: "a@b.fr", password: "court", displayName: "A", orgName: "O" }).success).toBe(false);
  });
});

describe("offres, quotas et essai", () => {
  it("quatre offres, libellés sans « Essentiel », trois plans payants", () => {
    expect(PLANS).toEqual(["free", "starter", "pro", "agence"]);
    expect(PAID_PLANS).toEqual(["starter", "pro", "agence"]);
    expect(PLAN_LABELS).toEqual({ free: "Accès de base", starter: "Starter", pro: "Pro", agence: "Agence" });
    expect(Object.values(PLAN_LABELS).join(" ")).not.toMatch(/Essentiel/);
  });

  it("quotas décidés : comptes 1/1/3/10, IA 50/300/1 500/5 000, filiales Studio, Track, Cloud et relance", () => {
    expect(PLANS.map((p) => PLAN_QUOTAS[p].connections)).toEqual([1, 1, 3, 10]);
    expect(PLANS.map((p) => PLAN_QUOTAS[p].members)).toEqual([1, 1, 3, 10]);
    expect(PLANS.map((p) => PLAN_QUOTAS[p].items)).toEqual([50, 500, 5000, 20000]);
    expect(PLANS.map((p) => PLAN_QUOTAS[p].aiRequestsPerMonth)).toEqual([50, 300, 1500, 5000]);
    expect(PLANS.map((p) => PLAN_QUOTAS[p].automationActionsPerDay)).toEqual([10, 100, 500, 2000]);
    expect(PLANS.map((p) => PLAN_QUOTAS[p].studioListingsPerMonth)).toEqual([0, 0, 20, 60]);
    expect(PLANS.map((p) => PLAN_QUOTAS[p].wornPhotosPerMonth)).toEqual([0, 0, 10, 30]);
    expect(PLANS.map((p) => PLAN_QUOTAS[p].trackFiltersFollowed)).toEqual([0, 0, 5, 25]);
    expect(PLANS.map((p) => PLAN_QUOTAS[p].trackScansPerMonth)).toEqual([0, 0, 10, 50]);
    expect(PLANS.map((p) => PLAN_QUOTAS[p].trackPhotoSearchesPerMonth)).toEqual([0, 0, 30, 150]);
    expect(PLANS.map((p) => PLAN_QUOTAS[p].trackHistoryMonths)).toEqual([0, 0, 3, 12]);
    expect(PLANS.map((p) => PLAN_QUOTAS[p].cloudIncluded)).toEqual([false, false, false, true]);
    expect(PLANS.map((p) => PLAN_QUOTAS[p].followUp24h)).toEqual(["none", "none", "suggested", "auto"]);
    // Chaque jeu de quotas est complet et valide au sens du schéma.
    for (const p of PLANS) expect(planQuotas.parse(PLAN_QUOTAS[p])).toEqual(PLAN_QUOTAS[p]);
  });

  it("les anciens JSON de quotas (sans les champs par filiale) restent lisibles par le schéma, avec 0 / false / « none »", () => {
    const legacy = { items: 5000, aiRequestsPerMonth: 3000, automationActionsPerDay: 500, connections: 5, members: 10 };
    const parsed = planQuotas.parse(legacy);
    expect(parsed).toMatchObject({ ...legacy, studioListingsPerMonth: 0, wornPhotosPerMonth: 0, trackFiltersFollowed: 0, trackScansPerMonth: 0, trackPhotoSearchesPerMonth: 0, trackHistoryMonths: 0, cloudIncluded: false, followUp24h: "none" });
    expect(completeQuotas(legacy)).toEqual(parsed);
    expect(planQuotas.safeParse({ ...legacy, followUp24h: "parfois" }).success).toBe(false);
    expect(planQuotas.safeParse({ items: 1 }).success).toBe(false);
  });

  it("un ancien abonnement Pro retrouve les quotas du nouveau Pro (20 annonces Studio, 3 comptes), un JSON complet est gardé tel quel", () => {
    const legacyPro = { items: 5000, aiRequestsPerMonth: 3000, automationActionsPerDay: 500, connections: 5, members: 10 };
    expect(isLegacyQuotas(legacyPro)).toBe(true);
    expect(isLegacyQuotas(PLAN_QUOTAS.pro)).toBe(false);
    expect(isLegacyQuotas(null)).toBe(false);
    // Ancien JSON : les valeurs d'avant (3 000 réponses, 5 comptes, 10 membres, Studio absent) ne valent plus.
    expect(resolveQuotas("pro", legacyPro)).toEqual(PLAN_QUOTAS.pro);
    expect(resolveQuotas("pro", legacyPro).studioListingsPerMonth).toBe(20);
    expect(resolveQuotas("starter", legacyPro)).toEqual(PLAN_QUOTAS.starter);
    // JSON complet (devis sur mesure, ou plan réappliqué) : conservé, champs manquants impossibles.
    const custom = { ...PLAN_QUOTAS.agence, connections: 25, aiRequestsPerMonth: 12_000 };
    expect(resolveQuotas("agence", custom)).toEqual(custom);
    // Illisible ou plan inconnu : quotas du plan, accès de base pour un plan inconnu.
    expect(resolveQuotas("pro", { ...PLAN_QUOTAS.pro, followUp24h: "parfois" })).toEqual(PLAN_QUOTAS.pro);
    expect(resolveQuotas("essentiel", legacyPro)).toEqual(PLAN_QUOTAS.free);
    expect(resolveQuotas("pro", undefined)).toEqual(PLAN_QUOTAS.pro);
  });

  it("quotasForPlan renvoie le jeu complet, en copie, et l'accès de base pour un plan inconnu", () => {
    const pro = quotasForPlan("pro");
    expect(pro).toEqual(PLAN_QUOTAS.pro);
    expect(pro).not.toBe(PLAN_QUOTAS.pro);
    expect(Object.keys(pro).sort()).toEqual(Object.keys(planQuotas.shape).sort());
    expect(quotasForPlan("essentiel")).toEqual(PLAN_QUOTAS.free);
  });

  it("essai : 14 jours, seul choix ; 7 et 30 (anciens clients web) ramenés à 14 ; le reste refusé", () => {
    expect(TRIAL_DAYS).toBe(14);
    expect(DEFAULT_TRIAL_DAYS).toBe(14);
    expect(TRIAL_DAYS_OPTIONS).toEqual([14]);
    expect(TRIAL_PLAN).toBe("pro");
    expect(trialDays.parse(14)).toBe(14);
    expect(trialDays.parse(7)).toBe(14);
    expect(trialDays.parse(30)).toBe(14);
    expect(trialDays.safeParse(12).success).toBe(false);
    expect(trialDays.safeParse("14").success).toBe(false);
    const base = { email: "a@b.fr", password: "motdepasse-A1", displayName: "A", orgName: "O" };
    expect(registerInput.parse(base).trialDays).toBe(14);
    expect(registerInput.parse({ ...base, trialDays: 30 }).trialDays).toBe(14);
    expect(registerInput.safeParse({ ...base, trialDays: 21 }).success).toBe(false);
  });

  it("abonnement : carte enregistrée et résiliation en fin de période par défaut à faux, fournisseur Revolut accepté", () => {
    const base = { id: "sub-1", orgId: "org-1", quotas: PLAN_QUOTAS.starter, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" };
    const sub = subscription.parse(base);
    expect(sub).toMatchObject({ plan: "free", status: "none", provider: "none", cardOnFile: false, cancelAtPeriodEnd: false, testMode: true });
    expect(subscription.parse({ ...base, provider: "revolut", plan: "agence", cardOnFile: true, cancelAtPeriodEnd: true })).toMatchObject({ provider: "revolut", plan: "agence", cardOnFile: true, cancelAtPeriodEnd: true });
    expect(subscription.safeParse({ ...base, provider: "paypal" }).success).toBe(false);
    expect(subscription.safeParse({ ...base, plan: "essentiel" }).success).toBe(false);
    // Ancien abonnement en base : quotas sans les champs par filiale.
    expect(subscription.parse({ ...base, quotas: { items: 500, aiRequestsPerMonth: 500, automationActionsPerDay: 100, connections: 2, members: 3 } }).quotas.studioListingsPerMonth).toBe(0);
  });

  it("compteurs d'utilisation : nouveaux types d'événements par filiale", () => {
    expect(USAGE_EVENT_KINDS).toEqual(expect.arrayContaining(["ai.request", "automation.action", "connector.sync", "export.csv", "extension.capture", "studio.listing", "studio.worn_photo", "track.scan", "track.photo_search", "cloud.action"]));
    const base = { id: "u1", orgId: "org-1", createdAt: "2026-10-01T00:00:00.000Z" };
    for (const kind of ["studio.listing", "studio.worn_photo", "track.scan", "track.photo_search", "cloud.action"]) expect(usageEvent.parse({ ...base, kind })).toMatchObject({ kind, quantity: 1 });
    expect(usageEvent.safeParse({ ...base, kind: "studio.video" }).success).toBe(false);
  });

  it("usagePercent et alerte à 80 % par compteur", () => {
    expect(USAGE_WARNING_RATE).toBe(0.8);
    expect(usagePercent(0, 20)).toBe(0);
    expect(usagePercent(5, 20)).toBe(25);
    expect(usagePercent(16, 20)).toBe(80);
    expect(usagePercent(25, 20)).toBe(100);
    expect(usagePercent(1, 3)).toBe(33);
    expect(usagePercent(0, 0)).toBe(0);
    expect(usagePercent(1, 0)).toBe(100);
    expect(usagePercent(-3, 10)).toBe(0);
    expect(buildUsageCounter(15, 20)).toEqual({ used: 15, quota: 20, percent: 75, warning: false, exceeded: false });
    expect(buildUsageCounter(16, 20)).toEqual({ used: 16, quota: 20, percent: 80, warning: true, exceeded: false });
    expect(buildUsageCounter(20, 20)).toEqual({ used: 20, quota: 20, percent: 100, warning: true, exceeded: true });
    expect(buildUsageCounter(0, 0)).toEqual({ used: 0, quota: 0, percent: 0, warning: false, exceeded: true });
  });
});

describe("gabarits de négociation par défaut", () => {
  const messages = negotiationAutomation.parse({}).messages;
  it("contre-offre neutre, « dernier prix » réservé à l'offre finale, sans mention de l'état", () => {
    expect(messages.counter).toBe("Je peux vous le faire à {prix}. Si cela vous convient, faites l'offre à ce montant.");
    expect(messages.counter).not.toMatch(/dernier prix/i);
    expect(messages.final).toBe("Je peux aller jusqu'à {prix}, c'est mon dernier prix pour cet article. Si cela vous convient, faites l'offre à ce montant.");
    expect(messages.final).not.toMatch(/état/i);
  });
  it("aucun gabarit ne contient « meilleur prix » et chaque gabarit de prix garde la variable {prix}", () => {
    for (const text of Object.values(messages)) expect(text).not.toMatch(/meilleur prix/i);
    for (const key of ["counter", "final", "afterFinal", "accepted"] as const) expect(messages[key]).toContain("{prix}");
  });
});

describe("facturation : abonnement Revolut, factures, relances", () => {
  const base = { id: "sub-1", orgId: "org-1", quotas: PLAN_QUOTAS.pro, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" };

  it("l'abonnement porte les identifiants Revolut (jamais de carte), la périodicité et les relances ; seuls « none » et « revolut » sont des fournisseurs", () => {
    expect(SUBSCRIPTION_PROVIDERS).toEqual(["none", "revolut"]);
    expect(subscription.safeParse({ ...base, provider: "autre" }).success).toBe(false);
    const sub = subscription.parse(base);
    expect(sub).toMatchObject({ revolutCustomerId: null, paymentMethodId: null, cycle: "monthly", pendingPlan: null, chargeAttempts: 0, nextChargeAt: null, lastChargeError: null, dataRetentionUntil: null });
    const full = subscription.parse({ ...base, provider: "revolut", revolutCustomerId: "cus_1", paymentMethodId: "pm_1", cycle: "yearly", pendingPlan: "agence", chargeAttempts: 2, nextChargeAt: "2026-11-04T00:00:00.000Z", lastChargeError: "Refusé", dataRetentionUntil: null });
    expect(full).toMatchObject({ provider: "revolut", cycle: "yearly", pendingPlan: "agence", chargeAttempts: 2 });
    expect(subscription.safeParse({ ...base, cycle: "weekly" }).success).toBe(false);
    expect(subscription.safeParse({ ...base, chargeAttempts: -1 }).success).toBe(false);
    expect(subscription.safeParse({ ...base, pendingPlan: "essentiel" }).success).toBe(false);
  });

  it("relances : J+1, J+3, J+7 après l'échéance, puis plus aucune (retour à l'accès de base, données gardées 30 jours)", () => {
    expect(CHARGE_RETRY_DELAYS_DAYS).toEqual([1, 3, 7]);
    expect(nextChargeDelayDays(0)).toBe(1);
    expect(nextChargeDelayDays(1)).toBe(1);
    expect(nextChargeDelayDays(2)).toBe(3);
    expect(nextChargeDelayDays(3)).toBe(7);
    expect(nextChargeDelayDays(4)).toBeNull();
    expect(nextChargeDelayDays(12)).toBeNull();
    expect(DATA_RETENTION_DAYS_AFTER_END).toBe(30);
  });

  it("factures : numéro SEL-AAAA-000001, TVA 20 % par défaut, franchise à 0 % avec la mention légale, décomposition exacte", () => {
    expect(INVOICE_NUMBER_RE.test("SEL-2026-000001")).toBe(true);
    expect(INVOICE_NUMBER_RE.test("SEL-26-1")).toBe(false);
    expect(DEFAULT_VAT_RATE).toBe(20);
    expect(VAT_FRANCHISE_NOTICE).toBe("TVA non applicable, art. 293 B du CGI");
    const inv = invoice.parse({ id: "inv-1", orgId: "org-1", number: "SEL-2026-000001", plan: "pro", cycle: "monthly", amountCents: 2499, vatRate: 20, periodStart: "2026-11-01T00:00:00.000Z", periodEnd: "2026-12-01T00:00:00.000Z", orderId: "ord_1", issuedAt: "2026-11-01T00:00:00.000Z", createdAt: "2026-11-01T00:00:00.000Z" });
    expect(inv.vatNotice).toBeNull();
    expect(invoice.safeParse({ ...inv, number: "FAC-1" }).success).toBe(false);
    expect(invoiceAmounts(2499, 20)).toEqual({ exclVatCents: 2083, vatCents: 416, inclVatCents: 2499 });
    expect(invoiceAmounts(2499, 0)).toEqual({ exclVatCents: 2499, vatCents: 0, inclVatCents: 2499 });
    expect(invoiceAmounts(49990, 20)).toEqual({ exclVatCents: 41658, vatCents: 8332, inclVatCents: 49990 });
  });

  it("commandes de paiement et entrée de paiement : sortes, états, offre payante seulement", () => {
    const po = paymentOrder.parse({ id: "po-1", orgId: "org-1", orderId: "ord_1", kind: "renewal", plan: "pro", cycle: "monthly", amountCents: 2499, captureMode: "automatic", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" });
    expect(po).toMatchObject({ state: "pending", attempt: 0, error: null });
    expect(paymentOrder.safeParse({ ...po, kind: "refund" }).success).toBe(false);
    expect(paymentOrder.safeParse({ ...po, captureMode: "later" }).success).toBe(false);
    expect(checkoutInput.parse({ plan: "pro" })).toEqual({ plan: "pro", cycle: "monthly" });
    expect(checkoutInput.parse({ plan: "agence", cycle: "yearly" }).cycle).toBe("yearly");
    expect(checkoutInput.safeParse({ plan: "free" }).success).toBe(false);
  });
});
