import { listingGenerationInput, quotasForPlan, type ListingDraft, type ListingGenerationOutput } from "@selio/contracts";
import { repos } from "@selio/db";
import { AIError } from "@selio/ai";
import { comparablesFromSales, priceListingDraft } from "@selio/domain";
import { AppError, nowIso, requireAction, withOrg, type OrgContext } from "../context";

/**
 * Générateur d'annonces : photos → annonce rédigée par le modèle (Ollama,
 * modèle de vision si configuré), prix conseillé par les ventes comparables.
 * Rien n'est publié ici : l'utilisateur relit puis enregistre en brouillon
 * ou met en vente.
 */
export async function generateListing(ctx: OrgContext, raw: unknown, signal?: AbortSignal): Promise<ListingDraft> {
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
  return withOrg(ctx, async (tx) => {
    await repos.aiRequests.update(tx, req.id, { status: "succeeded", validated: true, promptTokens: result.usage.promptTokens, outputTokens: result.usage.outputTokens, latencyMs: Math.max(result.latencyMs, Date.now() - started), finishedAt: nowIso(ctx) });
    await repos.usage.record(tx, "ai.request", { requestId: req.id, kind: "listing_generation", source: result.source });
    // Compteur Studio : une annonce rédigée avec succès.
    await repos.usage.record(tx, "studio.listing", { requestId: req.id, source: result.source, photos: photos.length });
    const items = await repos.items.all(tx);
    // Comparables : ventes réelles de l'organisation (les estimations du radar ne sont pas des ventes).
    const comps = comparablesFromSales(await repos.orders.all(tx), new Map(items.map((i) => [i.id, i])));
    const pricing = priceListingDraft(result.data, comps, hints.purchasePriceCents ?? null);
    const { lowConfidence, ...price } = pricing;
    return { ...result.data, ...price, source: result.source, provider: result.provider, model: result.model, latencyMs: result.latencyMs, simulated: result.provider === "mock", warnings: [...result.warnings, ...(lowConfidence ? ["Peu de ventes comparables : le prix conseillé est une estimation prudente, ajustez-le."] : [])] };
  });
}
