import { radarSearchCreate, type MarketplaceConnection, type Opportunity, type Organization, type PurchaseRequest, type RadarSearch } from "@selio/contracts";
import { repos } from "@selio/db";
import { autoBuyDecision, canStillCancel, cancelableUntil, comparablesFromSales, estimateResale, hashString, localDayKey, purchaseCost, purchaseOutcome, rankOpportunities, resolvePurchaseAccount, runPurchaseChecks, scoreOpportunity, seededRandom } from "@selio/domain";
import type { Tx } from "@selio/db";
import { AppError, nowIso, requireAction, withOrg, type OrgContext } from "../context";

export const listSearches = (ctx: OrgContext) => withOrg(ctx, (tx) => repos.searches.list(tx));

export function createSearch(ctx: OrgContext, raw: unknown): Promise<RadarSearch> {
  requireAction(ctx, "radar.write");
  const parsed = radarSearchCreate.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", "Recherche invalide", 400, parsed.error.flatten());
  return withOrg(ctx, async (tx) => {
    const s = await repos.searches.create(tx, { ...parsed.data, provider: "demo" });
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "radar.search_created", targetType: "radar_search", targetId: s.id, ip: ctx.ip });
    return s;
  });
}

export function updateSearch(ctx: OrgContext, id: string, raw: Record<string, unknown>): Promise<RadarSearch> {
  requireAction(ctx, "radar.write");
  return withOrg(ctx, async (tx) => {
    const s = await repos.searches.byId(tx, id);
    const merged = radarSearchCreate.safeParse({ ...s, ...raw, criteria: { ...s.criteria, ...((raw.criteria as object) ?? {}) }, provider: "demo" });
    if (!merged.success) throw new AppError("validation", "Recherche invalide", 400, merged.error.flatten());
    return repos.searches.update(tx, id, merged.data);
  });
}

export function deleteSearch(ctx: OrgContext, id: string): Promise<void> {
  requireAction(ctx, "radar.write");
  return withOrg(ctx, async (tx) => {
    await repos.searches.delete(tx, id);
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "radar.search_deleted", targetType: "radar_search", targetId: id, ip: ctx.ip });
  });
}

/** Analyse : simulateur déterministe uniquement (aucune source réelle n'est consultée). */
export async function runSearch(ctx: OrgContext, id: string): Promise<{ found: number; autoBought: number }> {
  const res = await runSearchOnly(ctx, id);
  const org = await ctx.services.db.withGlobal((g) => repos.orgs.byId(g, ctx.orgId));
  const auto = org.settings.autoBuy.enabled ? await runAutoBuy(ctx) : null;
  return { found: res.found, autoBought: auto?.bought ?? 0 };
}

function runSearchOnly(ctx: OrgContext, id: string): Promise<{ found: number }> {
  requireAction(ctx, "radar.write");
  return withOrg(ctx, async (tx) => {
    const search = await repos.searches.byId(tx, id);
    const now = ctx.services.now();
    const org = await ctx.services.db.withGlobal((g) => repos.orgs.byId(g, ctx.orgId));
    const existing = await repos.opportunities.list(tx, { searchId: id });
    const rnd = seededRandom(hashString(search.id + localDayKey(now, org.settings.timezone) + existing.length));
    const brands = search.criteria.brands.length ? search.criteria.brands : ["Nike", "Zara", "Levi's"];
    const cats = search.criteria.categories.length ? search.criteria.categories : (["shoes", "men", "women"] as const);
    const comps = comparablesFromSales(await repos.orders.all(tx), new Map((await repos.items.all(tx)).map((i) => [i.id, i])));
    let found = 0;
    const count = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < count; i++) {
      const brand = brands[Math.floor(rnd() * brands.length)]!;
      const category = cats[Math.floor(rnd() * cats.length)]!;
      const conditions = search.criteria.conditions.length ? search.criteria.conditions : (["very_good", "good", "satisfactory"] as const);
      const condition = conditions[Math.floor(rnd() * conditions.length)]!;
      const priceCents = Math.round((search.criteria.maxPriceCents * (0.5 + rnd() * 0.6)) / 100) * 100;
      const shippingCents = 450 + Math.floor(rnd() * 3) * 100;
      const size = search.criteria.sizes.length ? search.criteria.sizes[Math.floor(rnd() * search.criteria.sizes.length)]! : "M";
      const seenAt = new Date(now.getTime() - Math.floor(rnd() * 20) * 3_600_000).toISOString();
      const est = estimateResale({ priceCents, brand, category, condition }, comps);
      const photoCount = 1 + Math.floor(rnd() * 8);
      const sellerRating = Math.round((3.6 + rnd() * 1.4) * 10) / 10;
      const sellerReviews = Math.floor(rnd() * 180);
      const scored = scoreOpportunity({ priceCents, shippingCents, seenAt }, est, search, 0, now, { condition, photoCount, sellerRating, sellerReviews, fees: org.settings.buyerFees });
      const title = `${brand} ${search.criteria.keywords[0] ?? (category === "shoes" ? "sneakers" : "pièce")} ${size}`;
      if (await repos.opportunities.exists(tx, search.id, title, priceCents)) continue;
      await repos.opportunities.create(tx, { searchId: search.id, title, observed: { priceCents, shippingCents, brand, size, condition, category, sellerHandle: `vendeur_${Math.floor(rnd() * 900 + 100)}`, sellerRating, sellerReviews, photoUrl: null, photoCount, url: null, seenAt, source: "demo_simulator" }, estimate: { resalePriceCents: est.resalePriceCents, expectedFeesCents: 0, marginCents: scored.marginCents, marginRate: scored.marginRate, confidence: est.confidence, method: est.method, comparableCount: est.comparableCount }, score: scored.score, reasons: scored.reasons, breakdown: scored.breakdown, status: "new", createdAt: seenAt });
      found++;
    }
    await repos.searches.update(tx, id, { lastRunAt: nowIso(ctx) });
    await repos.usage.record(tx, "connector.sync", { kind: "radar", searchId: id });
    return { found };
  });
}

export function listOpportunities(ctx: OrgContext, q: { searchId?: string; status?: string }): Promise<Opportunity[]> {
  return withOrg(ctx, async (tx) => rankOpportunities(await repos.opportunities.list(tx, q)));
}

export function setOpportunityStatus(ctx: OrgContext, id: string, status: Opportunity["status"]): Promise<Opportunity> {
  requireAction(ctx, "radar.write");
  if (!["new", "watching", "purchased", "dismissed"].includes(status)) throw new AppError("validation", "Statut inconnu", 400);
  return withOrg(ctx, (tx) => repos.opportunities.update(tx, id, { status }));
}

export const listPurchases = (ctx: OrgContext) => withOrg(ctx, (tx) => repos.purchases.list(tx));

/** Compte « Achat » utilisé : celui choisi dans l'achat auto, sinon le premier compte Achat actif (jamais un compte Perso). */
async function purchaseAccountTx(tx: Tx, org: Organization): Promise<MarketplaceConnection | null> {
  return resolvePurchaseAccount(await repos.connections.list(tx), org.settings.autoBuy.connectionId);
}

export function createPurchase(ctx: OrgContext, raw: { opportunityId?: string; maxPriceCents?: number; budgetCents?: number }): Promise<PurchaseRequest> {
  requireAction(ctx, "purchase.simulate");
  if (!raw.opportunityId || !Number.isInteger(raw.maxPriceCents) || !Number.isInteger(raw.budgetCents)) throw new AppError("validation", "Demande invalide", 400);
  return withOrg(ctx, async (tx) => {
    const org = await ctx.services.db.withGlobal((g) => repos.orgs.byId(g, ctx.orgId));
    const opp = await repos.opportunities.byId(tx, raw.opportunityId!);
    const existing = await repos.purchases.activeForOpportunity(tx, opp.id);
    if (existing) throw new AppError("conflict", "Une demande d'achat existe déjà pour cette opportunité (prévention des doublons).", 409, { existingId: existing.id });
    const account = await purchaseAccountTx(tx, org);
    const p = await repos.purchases.create(tx, { opportunityId: opp.id, dedupeKey: `purchase:${opp.id}`, maxPriceCents: raw.maxPriceCents!, budgetCents: raw.budgetCents!, status: "awaiting_confirmation", mode: "manual", realPurchaseEnabled: false, connectionId: account?.id ?? null });
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "purchase.requested", targetType: "purchase_request", targetId: p.id, ip: ctx.ip });
    return p;
  });
}

export function confirmPurchase(ctx: OrgContext, id: string): Promise<PurchaseRequest> {
  requireAction(ctx, "purchase.simulate");
  return withOrg(ctx, (tx) => confirmPurchaseTx(ctx, tx, id));
}

async function confirmPurchaseTx(ctx: OrgContext, tx: Tx, id: string): Promise<PurchaseRequest> {
  const org = await ctx.services.db.withGlobal((g) => repos.orgs.byId(g, ctx.orgId));
  const p = await repos.purchases.byId(tx, id);
  if (p.status !== "awaiting_confirmation") throw new AppError("conflict", "Cette demande n'est plus en attente de confirmation.", 409);
  const opp = await repos.opportunities.byId(tx, p.opportunityId);
  const confirmedAt = nowIso(ctx);
  const checks = runPurchaseChecks({ opportunity: opp, request: { ...p, confirmedAt }, spentTodayCents: await repos.purchases.spentToday(tx, p.id), dailyBudgetCents: org.settings.autoBuy.dailyCapCents, duplicateExists: false, connectorAllowsPurchase: false, fees: org.settings.buyerFees });
  const outcome = purchaseOutcome(checks, p.realPurchaseEnabled);
  const saved = await repos.purchases.update(tx, id, { confirmedAt, checks: checks.map(({ code, ok, label }) => ({ code, ok, label })), status: outcome, executedAt: outcome === "blocked" ? null : confirmedAt, resultNote: outcome === "blocked" ? "Contrôles non satisfaits : aucun achat (même simulé) n'a été effectué." : "Achat SIMULÉ de bout en bout : aucun paiement ni commande réels. L'achat réel est désactivé et exige un connecteur autorisé." });
  if (outcome !== "blocked") await repos.opportunities.update(tx, opp.id, { status: "purchased" });
  await repos.audit.add(tx, { actorUserId: ctx.userId, action: "purchase.confirmed", targetType: "purchase_request", targetId: id, meta: { outcome }, ip: ctx.ip });
  return saved;
}

export function cancelPurchase(ctx: OrgContext, id: string): Promise<PurchaseRequest> {
  requireAction(ctx, "purchase.simulate");
  return withOrg(ctx, async (tx) => {
    const p = await repos.purchases.byId(tx, id);
    if (p.status === "cancelled") return p;
    if (p.status === "simulated" || p.status === "executed") {
      if (p.mode !== "auto") throw new AppError("conflict", "Cet achat a déjà été effectué : il ne peut plus être annulé depuis Selio.", 409);
      if (!canStillCancel(p.cancelableUntil, ctx.services.now())) throw new AppError("conflict", "Le délai d'annulation de cet achat automatique est dépassé.", 409);
      await repos.opportunities.update(tx, p.opportunityId, { status: "dismissed" });
    }
    const saved = await repos.purchases.update(tx, id, { status: "cancelled", ...(p.mode === "auto" ? { resultNote: "Achat automatique annulé dans le délai prévu (simulation)." } : {}) });
    await repos.audit.add(tx, { actorUserId: ctx.userId, action: "purchase.cancelled", targetType: "purchase_request", targetId: id, meta: { mode: p.mode }, ip: ctx.ip });
    return saved;
  });
}

/** « À valider » : un clic crée la demande d'achat et la confirme (contrôles compris). */
export function quickBuy(ctx: OrgContext, opportunityId: string): Promise<PurchaseRequest> {
  requireAction(ctx, "purchase.simulate");
  return withOrg(ctx, async (tx) => {
    const org = await ctx.services.db.withGlobal((g) => repos.orgs.byId(g, ctx.orgId));
    const opp = await repos.opportunities.byId(tx, opportunityId);
    if (await repos.purchases.activeForOpportunity(tx, opp.id)) throw new AppError("conflict", "Une demande d'achat existe déjà pour cette affaire (prévention des doublons).", 409);
    const total = purchaseCost(opp.observed, org.settings.buyerFees).totalCents;
    const search = await repos.searches.byId(tx, opp.searchId);
    const account = await purchaseAccountTx(tx, org);
    const p = await repos.purchases.create(tx, { opportunityId: opp.id, dedupeKey: `purchase:${opp.id}`, maxPriceCents: total, budgetCents: search.budgetCents, status: "awaiting_confirmation", mode: "manual", realPurchaseEnabled: false, connectionId: account?.id ?? null });
    return confirmPurchaseTx(ctx, tx, p.id);
  });
}

/** Achat automatique : affaires nouvelles au-dessus du seuil, dans le plafond du jour, annulables pendant le délai. */
export function runAutoBuy(ctx: OrgContext): Promise<{ evaluated: number; bought: number; spentCents: number; skipped: { reason: string; count: number }[]; account: { id: string; label: string } | null }> {
  requireAction(ctx, "purchase.simulate");
  return withOrg(ctx, async (tx) => {
    const org = await ctx.services.db.withGlobal((g) => repos.orgs.byId(g, ctx.orgId));
    const settings = org.settings.autoBuy;
    const account = await purchaseAccountTx(tx, org);
    const via = account ? ` via le compte Achat « ${account.label} »` : "";
    const skipped = new Map<string, number>();
    let evaluated = 0, bought = 0, spentCents = 0;
    const candidates = rankOpportunities(await repos.opportunities.list(tx, { status: "new" }));
    for (const opp of candidates) {
      evaluated++;
      const spentToday = await repos.purchases.spentToday(tx, "");
      const decision = autoBuyDecision({ opportunity: opp, settings, fees: org.settings.buyerFees, spentTodayCents: spentToday, alreadyPurchased: Boolean(await repos.purchases.activeForOpportunity(tx, opp.id)) });
      if (!decision.buy) {
        const reason = /sous le seuil/.test(decision.reason) ? `Note sous le seuil de ${settings.threshold}` : decision.reason;
        skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
        continue;
      }
      const now = ctx.services.now();
      const search = await repos.searches.byId(tx, opp.searchId);
      const checks = runPurchaseChecks({ opportunity: opp, request: { maxPriceCents: decision.totalCents, budgetCents: search.budgetCents, realPurchaseEnabled: false, confirmedAt: now.toISOString() }, spentTodayCents: spentToday, dailyBudgetCents: settings.dailyCapCents, duplicateExists: false, connectorAllowsPurchase: false, fees: org.settings.buyerFees });
      const outcome = purchaseOutcome(checks, false);
      const p = await repos.purchases.create(tx, { opportunityId: opp.id, dedupeKey: `purchase:${opp.id}`, maxPriceCents: decision.totalCents, budgetCents: search.budgetCents, status: outcome, mode: "auto", connectionId: account?.id ?? null, cancelableUntil: outcome === "blocked" ? null : cancelableUntil(now, settings), checks: checks.map(({ code, ok, label }) => ({ code, ok, label })), realPurchaseEnabled: false, confirmedAt: now.toISOString(), executedAt: outcome === "blocked" ? null : now.toISOString(), resultNote: outcome === "blocked" ? "Achat automatique bloqué par les contrôles." : `Achat automatique SIMULÉ${via} : ${decision.reason}. Annulable pendant ${settings.cancelWindowMinutes} min.`.slice(0, 500) });
      if (outcome !== "blocked") {
        await repos.opportunities.update(tx, opp.id, { status: "purchased" });
        bought++;
        spentCents += decision.totalCents;
      }
      await repos.audit.add(tx, { actorUserId: ctx.userId, action: "purchase.auto", targetType: "purchase_request", targetId: p.id, meta: { outcome, score: opp.score }, ip: ctx.ip });
    }
    return { evaluated, bought, spentCents, skipped: [...skipped.entries()].map(([reason, count]) => ({ reason, count })), account: account ? { id: account.id, label: account.label } : null };
  });
}
