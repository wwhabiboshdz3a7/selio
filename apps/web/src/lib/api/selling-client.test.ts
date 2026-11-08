import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch() {
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ method: init.method ?? "GET", url, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    return new Response("{}", { status: 200 });
  }));
  return calls;
}

describe("ApiClient : négociation avancée, migration et fonctions « que Bleam n'a pas »", () => {
  it("n'appelle que l'API Selio ; la migration n'envoie que ce que le client fournit, jamais un identifiant", async () => {
    const calls = stubFetch();
    const api = new ApiClient("https://api.selio.example");
    await api.recordVintedLimits({ maxCounterOffersPerConversation: 2, offerDurationHours: 24, minDelayBetweenMessagesSeconds: 30 });
    await api.convertMigration({ text: "Remise max : 20 %", declaredSource: "bleam" });
    await api.importMigrationFile({ fileName: "export.json", content: "{}", declaredSource: null });
    await api.applyMigration({ mappingId: "m1", mapping: { source: "bleam", fields: [], unknownFields: [], warnings: [] }, acceptedFieldIds: [] });
    await api.suggestBundles();
    await api.getEndToEndMargins("90d");
    await api.getDeclarationThresholds();
    expect(calls.map((c) => `${c.method} ${c.url.replace("https://api.selio.example", "")}`)).toEqual([
      "POST /api/org/vinted-limits",
      "POST /api/migration/convert",
      "POST /api/migration/file",
      "POST /api/migration/apply",
      "GET /api/items/bundles",
      "GET /api/analytics/margins?period=90d",
      "GET /api/analytics/thresholds",
    ]);
    // La mesure ne porte ni source ni date : c'est le serveur qui la date et la marque « measured ».
    expect(calls[0]!.body).toEqual({ maxCounterOffersPerConversation: 2, offerDurationHours: 24, minDelayBetweenMessagesSeconds: 30 });
    expect(calls[1]!.body).toEqual({ text: "Remise max : 20 %", declaredSource: "bleam" });
    expect(calls.every((c) => c.url.startsWith("https://api.selio.example/api/"))).toBe(true);
    expect(JSON.stringify(calls)).not.toMatch(/password|mot de passe|identifiant|cookie/i);
  });
});
