import { afterEach, describe, expect, it, vi } from "vitest";
import { TRACK_UNAVAILABLE_MESSAGE, buildUsageCounter, quotasForPlan } from "@selio/contracts";
import { DataError } from "../data/types";
import { ApiClient } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
const BASE = "https://api.selio.example";

function stubFetch(respond: (url: string, init: RequestInit) => Response) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ method: init.method ?? "GET", url: url.replace(BASE, ""), body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    return respond(url.replace(BASE, ""), init);
  }));
  return calls;
}

const subscription = (plan: "starter" | "pro" | "agence") => ({ plan, status: "active", quotas: quotasForPlan(plan), cycle: "monthly" });

describe("ApiClient : Selio Track et estimation des prix", () => {
  it("appelle les routes /api/track/* et /api/pricing/*", async () => {
    const calls = stubFetch((url, init) => (init.method === "DELETE" ? new Response(null, { status: 204 }) : json({})));
    const api = new ApiClient(BASE);
    await api.trackFilters();
    await api.createTrackFilter({ name: "Levi's", criteria: { brands: ["Levi's"] } });
    await api.updateTrackFilter("f 1", { enabled: false });
    await api.deleteTrackFilter("f 1");
    await api.trackTrends("f-1", 90);
    await api.trackScans();
    await api.runNicheScan({ brand: "Nike", category: "shoes" });
    await api.trackPhotoSearches();
    await api.trackPhotoSearch({ photo: "data:image/jpeg;base64,QUJD", hints: { brand: "Levi's" } });
    await api.trackSalesFeed();
    await api.estimatePrice({ brand: "Nike", category: "shoes", explain: true });
    await api.pricingModelStatus();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET /api/track/filters",
      "POST /api/track/filters",
      "PATCH /api/track/filters/f%201",
      "DELETE /api/track/filters/f%201",
      "GET /api/track/filters/f-1/trends?days=90",
      "GET /api/track/scans",
      "POST /api/track/scans",
      "GET /api/track/photo-search",
      "POST /api/track/photo-search",
      "GET /api/track/sales-feed",
      "POST /api/pricing/estimate",
      "GET /api/pricing/model",
    ]);
    // Une seule photo, réduite, dans le champ « photo » : rien d'autre n'est envoyé.
    expect(calls[8]!.body).toEqual({ photo: "data:image/jpeg;base64,QUJD", hints: { brand: "Levi's" } });
    expect(calls[10]!.body).toEqual({ brand: "Nike", category: "shoes", explain: true });
  });

  it("utilisation de Track : compteurs du serveur, source et historique", async () => {
    stubFetch((url) => {
      if (url === "/api/track/usage") {
        return json({
          plan: "pro",
          period: { from: "2026-11-01T00:00:00.000Z", to: "2026-11-04T12:00:00.000Z" },
          counters: { filtersFollowed: buildUsageCounter(3, 5), scans: buildUsageCounter(4, 10), photoSearches: buildUsageCounter(7, 30) },
          historyMonths: 3,
          history: [{ month: "2026-09", scans: 0, photoSearches: 0 }, { month: "2026-10", scans: 2, photoSearches: 9 }, { month: "2026-11", scans: 4, photoSearches: 7 }],
          source: "demo",
          sourceLabel: "Simulateur (données de démonstration)",
          notices: ["mention"],
        });
      }
      // Offre et quotas lus sur /api/org/plan (ouvert à tout membre) : l'exécuteur reçoit 403 sur l'abonnement.
      if (url === "/api/org/plan") return json(subscription("pro"));
      if (url === "/api/billing/subscription") return json({ error: { code: "finances_forbidden", message: "Réservé" } }, 403);
      return json({}, 404);
    });
    const u = await new ApiClient(BASE).trackUsage();
    expect(u).toMatchObject({ plan: "pro", available: true, salesFeed: false, historyMonths: 3, source: "demo", notices: ["mention"] });
    expect(u.filters).toMatchObject({ used: 3, quota: 5 });
    expect(u.scans).toMatchObject({ used: 4, quota: 10 });
    expect(u.photoSearches).toMatchObject({ used: 7, quota: 30 });
    expect(u.history).toHaveLength(3);
  });

  it("402 « compris à partir de Pro » : vue « indisponible » construite depuis l'abonnement, autres erreurs remontées", async () => {
    stubFetch((url) => {
      if (url === "/api/track/usage") return json({ error: { code: "track_unavailable", message: TRACK_UNAVAILABLE_MESSAGE } }, 402);
      if (url === "/api/org/plan") return json(subscription("starter"));
      if (url === "/api/billing/subscription") return json({ error: { code: "finances_forbidden", message: "Réservé" } }, 403);
      if (url === "/api/billing/usage") {
        const zero = buildUsageCounter(0, 0);
        return json({ period: { from: "2026-11-01T00:00:00.000Z", to: "2026-11-04T12:00:00.000Z" }, track: { scans: zero, photoSearches: zero, filtersFollowed: zero } });
      }
      return json({}, 404);
    });
    const u = await new ApiClient(BASE).trackUsage();
    expect(u).toMatchObject({ plan: "starter", available: false, salesFeed: false });
    expect(u.filters.quota).toBe(0);

    stubFetch(() => json({ error: { code: "internal", message: "Erreur" } }, 500));
    await expect(new ApiClient(BASE).trackUsage()).rejects.toBeInstanceOf(DataError);
  });
});
