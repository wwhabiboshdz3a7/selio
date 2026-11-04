import { repos } from "@selio/db";
import { analyzeMarket } from "@selio/domain";
import { ITEM_CATEGORY_LABELS, TRACK_DEMO_NOTICE, TRACK_GONE_NOTICE, TRACK_LEGAL_NOTICE, type ItemCategory, type MarketObservation } from "@selio/contracts";
import { withOrg, type OrgContext } from "../context";
import type { MarketData } from "../types-data";

/** Niche vue par Selio Track (marque × catégorie) : statistiques seulement, aucun vendeur, aucune annonce. */
export interface TrackNiche {
  key: string;
  brand: string;
  category: ItemCategory;
  label: string;
  /** Annonces en ligne à la dernière lecture qui les a vues. */
  listings: number;
  /** Vendues ou disparues (une disparition est une estimation : vendue OU retirée). */
  sold: number;
  /** Part des « ventes » qui sont des disparitions (prix final estimé). */
  estimatedShare: number;
  sellThrough: number;
  medianPriceCents: number | null;
}

export interface TrackMarketSection {
  niches: TrackNiche[];
  /** Instantanés des filtres suivis par l'organisation sur la fenêtre. */
  snapshots: number;
  /** Vrai : ces chiffres viennent du simulateur (données de démonstration). */
  demo: boolean;
  notices: string[];
}

/**
 * Analyse des revendeurs et des niches en mode connecté : calculée à partir
 * des annonces réellement observées par le radar et l'extension (vendeur,
 * marque, catégorie, prix). Aucune donnée n'est inventée : sans
 * observations, l'analyse est vide et l'interface l'explique.
 *
 * Selio Track complète l'analyse par niche (`track`) : annonces en ligne et disparues des références de
 * prix (base partagée, sans pseudo) et instantanés des filtres suivis. Les données du simulateur ne sont
 * utilisées qu'à défaut de données réelles, et sont alors annoncées comme données de démonstration.
 */
export function getMarketInsights(ctx: OrgContext, raw: Record<string, unknown>): Promise<MarketData & { track: TrackMarketSection }> {
  const windowDays = [7, 30, 90].includes(Number(raw.windowDays)) ? Number(raw.windowDays) : 30;
  const rawCategory = typeof raw.category === "string" && raw.category ? raw.category : undefined;
  const category = rawCategory && rawCategory in ITEM_CATEGORY_LABELS ? (rawCategory as ItemCategory) : undefined;
  return withOrg(ctx, async (tx) => {
    const opportunities = await repos.opportunities.list(tx, {});
    let obs: MarketObservation[] = opportunities
      .filter((o) => o.observed.sellerHandle && o.observed.source !== "demo_simulator")
      .map((o) => ({ id: o.id, sellerHandle: o.observed.sellerHandle!, title: o.title, brand: o.observed.brand, category: o.observed.category ?? "other", priceCents: o.observed.priceCents, status: "listed", seenAt: o.observed.seenAt, soldAt: null, favorites: 0, source: o.observed.source === "extension_capture" ? "extension_capture" : "radar" }));
    if (rawCategory) obs = obs.filter((o) => o.category === rawCategory);

    // Selio Track : niches sans vendeur, depuis la base de références et les instantanés des filtres suivis.
    const now = ctx.services.now();
    const since = new Date(now.getTime() - windowDays * 86_400_000).toISOString();
    let rows = await repos.priceReferences.nicheSummary(tx, { since, includeDemo: false, category });
    let demo = false;
    if (rows.length === 0) {
      rows = await repos.priceReferences.nicheSummary(tx, { since, includeDemo: true, category });
      demo = rows.length > 0;
    }
    let snapshots = 0;
    for (const f of await repos.trackFilters.list(tx)) snapshots += (await repos.trackSnapshots.since(tx, f.fingerprint, since)).length;
    const niches: TrackNiche[] = rows.map((r) => ({
      key: `${r.brand.toLowerCase()}|${r.category}`, brand: r.brand, category: r.category, label: `${r.brand} · ${ITEM_CATEGORY_LABELS[r.category] ?? r.category}`,
      listings: r.listed, sold: r.sold, estimatedShare: r.estimatedShare, sellThrough: r.sold + r.listed > 0 ? Math.round((r.sold / (r.sold + r.listed)) * 1000) / 1000 : 0,
      medianPriceCents: r.medianFinalCents ?? r.medianListedCents,
    }));
    const track: TrackMarketSection = { niches, snapshots, demo, notices: [TRACK_LEGAL_NOTICE, TRACK_GONE_NOTICE, ...(demo ? [TRACK_DEMO_NOTICE] : [])] };
    return { ...analyzeMarket(obs, now, windowDays), source: "observations", observedCount: obs.length, generatedAt: now.toISOString(), track };
  });
}
