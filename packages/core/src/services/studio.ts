import { PRICE_METHOD_LABELS, listingGenerationInput, quotasForPlan, type ListingDraft, type ListingGenerationOutput, type PriceEstimate } from "@selio/contracts";
import { repos } from "@selio/db";
import { AIError } from "@selio/ai";
import { comparablesFromSales, priceListingDraft, suggestFloorPrice, type DraftPricing } from "@selio/domain";
import { AppError, nowIso, requireAction, withOrg, type OrgContext } from "../context";
import * as pricing from "./pricing";

/**
 * Générateur d'annonces : photos → annonce rédigée par le modèle (Ollama,
 * modèle de vision si configuré), prix conseillé par l'estimation des prix
 * (§5.10 : comparables et modèle de prix, trois stratégies, explication en
 * mots par mon IA perso ; le prix plancher et le prix d'achat sont gardés).
 * Rien n'est publié ici : l'utilisateur relit puis enregistre en brouillon
 * ou met en vente.
 */
export async function generateListing(ctx: OrgContext, raw: unknown, signal?: AbortSignal): Promise<ListingDraft & { pricing: PriceEstimate | null }> {
  requireAction(ctx, "ai.use");
  const parsed = listingGenerationInput.safeParse(raw);
  if (!parsed.success) throw new AppError("validation", parsed.error.issues[0]?.message ?? "Demande invalide", 400, parsed.error.flatten());
  const org = await ctx.services.db.withGlobal((g) => repos.orgs.byId(g, ctx.orgId));
  if (!org.settings.ai.enabled) throw new AppError("ai_unavailable", "L'assistant IA est désactivé dans les paramètres.", 409);
  const monthStart = new Date(Date.UTC(ctx.services.now().getUTCFullYear(), ctx.services.now().getUTCMonth(), 1)).toISOString();
  const { photos, hints } = parsed.data;
  const req = await withOrg(ctx, async (tx) => {
    const quotas = (await repos.subscriptions.get(tx))?.quotas ?? quotasForPlan("free");
    // Quota Studio du plan (annonces générées par mois, remis à zéro le 1er du mois UTC).
    const studioQuota = quotas.studioListingsPerMonth;
    if (studioQuota <= 0) throw new AppError("quota_exceeded", "Studio n'est pas inclus dans votre offre.", 402);
    if ((await repos.usage.sumKindSince(tx, "studio.listing", monthStart)) >= studioQuota) throw new AppError("quota_exceeded", `Quota Studio du mois atteint (${studioQuota}).`, 402);
    // Quota IA mensuel (plan et réglage de l'organisation), commun à toutes les requêtes IA.
    const quota = Math.min(quotas.aiRequestsPerMonth, org.settings.ai.monthlyRequestQuota || Infinity);
    if ((await repos.aiRequests.countSince(tx, monthStart)) >= quota) throw new AppError("quota_exceeded", `Quota IA mensuel atteint (${quota}).`, 402);
    return repos.aiRequests.create(tx, { kind: "listing_generation", provider: ctx.services.ai.provider.name, model: ctx.services.ai.provider.model, status: "running" });
  });
  const started = Date.now();
  const fallback = (): ListingGenerationOutput => ({ title: [hints.brand, "Article", hints.size].filter(Boolean).join(" ") || "Article", description: "Article d'occasion en bon état. Complétez la marque, la taille et les mesures. Envoi soigné sous 48 h.", brand: hints.brand ?? null, category: "other", size: hints.size ?? null, condition: "good", colors: [], material: null, hashtags: [], confidence: 0.2 });
  let result;
  try {
    result = await ctx.services.ai.generateListing(ctx.orgId, { images: photos.map((p) => p.url.slice(p.url.indexOf(",") + 1)), fileNames: photos.map((p) => p.alt), hints }, { signal, allowFallback: ctx.services.allowAiFallback, fallback });
  } catch (err) {
    const e = err instanceof AIError ? err : null;
    await withOrg(ctx, (tx) => repos.aiRequests.update(tx, req.id, { status: e?.code === "timeout" ? "timeout" : e?.code === "cancelled" ? "cancelled" : e?.code === "invalid_output" ? "rejected" : "failed", error: (err as Error).message.slice(0, 500), latencyMs: Date.now() - started, finishedAt: nowIso(ctx) }));
    if (e?.code === "quota_exceeded") throw new AppError("quota_exceeded", e.message, 402);
    if (e?.code === "invalid_output") throw new AppError("ai_invalid_output", e.message, 422);
    throw new AppError("ai_unavailable", `Générateur indisponible (${e?.code ?? "erreur"}). Vous pouvez créer l'annonce à la main.`, 503);
  }
  // Prix (§5.10) : comparables et modèle de prix, trois stratégies, explication en mots par mon IA perso.
  // Jamais bloquant : sans estimation (panne, aucune référence), le calcul d'avant s'applique.
  const purchase = hints.purchasePriceCents ?? null;
  const estimate = await pricing.estimate(ctx, {
    title: result.data.title, brand: result.data.brand, category: result.data.category, size: result.data.size, material: result.data.material,
    color: result.data.colors[0] ?? null, condition: result.data.condition, photoCount: photos.length, explain: true,
  }, { signal }).catch(() => null);
  return withOrg(ctx, async (tx) => {
    await repos.aiRequests.update(tx, req.id, { status: "succeeded", validated: true, promptTokens: result.usage.promptTokens, outputTokens: result.usage.outputTokens, latencyMs: Math.max(result.latencyMs, Date.now() - started), finishedAt: nowIso(ctx) });
    await repos.usage.record(tx, "ai.request", { requestId: req.id, kind: "listing_generation", source: result.source });
    // Compteur Studio : une annonce rédigée avec succès.
    await repos.usage.record(tx, "studio.listing", { requestId: req.id, source: result.source, photos: photos.length });
    const warnings = [...result.warnings];
    let price: Omit<DraftPricing, "lowConfidence">;
    if (estimate && estimate.method !== "none" && estimate.strategies) {
      // Plancher : prix d'achat + marge minimale de l'organisation quand le prix d'achat est connu, 1 € sinon.
      const floor = purchase && purchase > 0 ? suggestFloorPrice({ purchasePriceCents: purchase, purchaseFeesCents: 0 }, org.settings.margin) : 100;
      const lift = (c: number) => Math.max(floor, c);
      const s = estimate.strategies;
      if (s.fast < floor || s.standard < floor) warnings.push(`Prix relevé au plancher (${(floor / 100).toFixed(2).replace(".", ",")} € : prix d'achat et marge minimale).`);
      price = { suggestedPriceCents: lift(s.standard), priceLowCents: lift(s.fast), priceHighCents: lift(s.max), priceMethod: PRICE_METHOD_LABELS[estimate.method], comparableCount: estimate.comparableCount };
      if (estimate.confidenceLevel === "low") warnings.push("Peu de ventes comparables : le prix conseillé est une estimation prudente, ajustez-le.");
      if (estimate.demo) warnings.push("Le modèle de prix repose sur des données de démonstration.");
    } else {
      const items = await repos.items.all(tx);
      // Comparables : ventes réelles de l'organisation (les estimations du radar ne sont pas des ventes).
      const comps = comparablesFromSales(await repos.orders.all(tx), new Map(items.map((i) => [i.id, i])));
      const { lowConfidence, ...legacy } = priceListingDraft(result.data, comps, purchase);
      price = legacy;
      if (lowConfidence) warnings.push("Peu de ventes comparables : le prix conseillé est une estimation prudente, ajustez-le.");
    }
    const draft: ListingDraft & { pricing: PriceEstimate | null } = { ...result.data, ...price, source: result.source, provider: result.provider, model: result.model, latencyMs: result.latencyMs, simulated: result.provider === "mock", warnings, pricing: estimate };
    return draft;
  });
}
