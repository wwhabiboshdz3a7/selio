import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(respond: (url: string, init: RequestInit) => Response = () => new Response("{}", { status: 200 })) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ method: init.method ?? "GET", url, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    return respond(url, init);
  }));
  return calls;
}

describe("ApiClient : routes Studio façon Kavis et photos portées", () => {
  it("appelle les routes de l'API avec les bons corps ; les indices du simulateur ne quittent jamais le navigateur", async () => {
    const calls = stubFetch();
    const api = new ApiClient("https://api.selio.example");
    await api.prepareStudio({ photos: [{ id: "a", url: "data:image/jpeg;base64,/9j/", role: "label" }], garmentKind: "top", hints: { brand: "Zara" } }, { simulator: { photos: { a: { name: "secret.jpg", label: { brand: "Jamais envoyé" } } } } });
    await api.getStudioPrep("prep-1");
    await api.validateStudioPrep("prep-1", { fields: { size: "M" }, measurements: { chest: 50 }, shareMeasurements: true });
    await api.generateListing({ prepId: "prep-1", photos: [] });
    await api.requestWornPhoto({ photoKey: "org/o/studio-photo/p.jpg", pose: "back", acceptOverage: true, acceptedUnitCents: 25 });
    await api.cancelWornPhoto("job-1");
    await api.deleteStudioPhoto("org/o/studio-photo/p.jpg");
    expect(calls.map((c) => `${c.method} ${c.url.replace("https://api.selio.example", "")}`)).toEqual([
      "POST /api/studio/prepare",
      "GET /api/studio/preps/prep-1",
      "POST /api/studio/preps/prep-1/validate",
      "POST /api/studio/generate",
      "POST /api/studio/worn",
      "DELETE /api/studio/worn/job-1",
      "DELETE /api/uploads/object?key=org%2Fo%2Fstudio-photo%2Fp.jpg",
    ]);
    expect(JSON.stringify(calls[0]!.body)).not.toMatch(/simulator|secret\.jpg|Jamais envoyé/);
    expect(calls[0]!.body).toMatchObject({ photos: [{ id: "a", role: "label" }], garmentKind: "top", hints: { brand: "Zara" } });
    expect(calls[2]!.body).toEqual({ fields: { size: "M" }, measurements: { chest: 50 }, shareMeasurements: true });
    // L'accord de dépassement porte le prix affiché : le serveur le compare au sien (409 s'il a changé).
    expect(calls[4]!.body).toEqual({ photoKey: "org/o/studio-photo/p.jpg", pose: "back", acceptOverage: true, acceptedUnitCents: 25 });
  });

  it("photos portées : état construit depuis GET /api/studio/worn et l'abonnement (facturable = carte enregistrée, en cours, non résilié)", async () => {
    const worn = { jobs: [], quota: { used: 2, quota: 10, remaining: 8 }, provider: { name: "noop", configured: false, message: "aucun fournisseur configuré : décision à prendre" }, overage: { enabled: false, unitCents: 25, proposal: true }, nightWindow: { startHour: 22, endHour: 6, timezone: "Europe/Paris", nextStart: "2026-11-04T21:00:00.000Z", nextEnd: "2026-11-05T05:00:00.000Z", inWindow: false } };
    const sub = { plan: "pro", status: "active", provider: "revolut", cardOnFile: true, cancelAtPeriodEnd: false, quotas: { wornPhotosPerMonth: 10 } };
    stubFetch((url) => new Response(JSON.stringify(url.includes("/api/studio/worn") ? worn : sub), { status: 200 }));
    const api = new ApiClient("https://api.selio.example");
    const view = await api.wornPhotos();
    expect(view.jobs).toEqual([]);
    expect(view.status.counter).toMatchObject({ used: 2, quota: 10 });
    expect(view.status.overage).toMatchObject({ enabled: false, unitCents: 25, proposal: true, billable: true });
    expect(view.status.provider).toMatchObject({ name: "noop", configured: false });
    expect(view.status.window).toEqual({ startHour: 22, endHour: 6, timezone: "Europe/Paris" });
    expect(view.status.nextWindow).toEqual({ start: "2026-11-04T21:00:00.000Z", end: "2026-11-05T05:00:00.000Z", inWindow: false });
  });
});
