import { repos } from "@selio/db";
import { analyzeMarket } from "@selio/domain";
import type { MarketObservation } from "@selio/contracts";
import { withOrg, type OrgContext } from "../context";
import type { MarketData } from "../types-data";

/**
 * Analyse des revendeurs et des niches en mode connecté : calculée à partir
 * des annonces réellement observées par le radar et l'extension (vendeur,
 * marque, catégorie, prix). Aucune donnée n'est inventée : sans
 * observations, l'analyse est vide et l'interface l'explique.
 */
export function getMarketInsights(ctx: OrgContext, raw: Record<string, unknown>): Promise<MarketData> {
  const windowDays = [7, 30, 90].includes(Number(raw.windowDays)) ? Number(raw.windowDays) : 30;
  const category = typeof raw.category === "string" && raw.category ? raw.category : undefined;
  return withOrg(ctx, async (tx) => {
    const opportunities = await repos.opportunities.list(tx, {});
    let obs: MarketObservation[] = opportunities
      .filter((o) => o.observed.sellerHandle && o.observed.source !== "demo_simulator")
      .map((o) => ({ id: o.id, sellerHandle: o.observed.sellerHandle!, title: o.title, brand: o.observed.brand, category: o.observed.category ?? "other", priceCents: o.observed.priceCents, status: "listed", seenAt: o.observed.seenAt, soldAt: null, favorites: 0, source: o.observed.source === "extension_capture" ? "extension_capture" : "radar" }));
    if (category) obs = obs.filter((o) => o.category === category);
    return { ...analyzeMarket(obs, ctx.services.now(), windowDays), source: "observations", observedCount: obs.length, generatedAt: ctx.services.now().toISOString() };
  });
}
