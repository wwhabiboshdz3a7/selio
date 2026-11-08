import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(respond: (url: string) => Response = () => new Response("{}", { status: 200 })) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ method: init.method ?? "GET", url, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    return respond(url);
  }));
  return calls;
}

const BASE = "https://api.selio.example";

describe("ApiClient : rôles, parrainage et supervision", () => {
  it("photos seules, parrainage et supervision : les bonnes routes de l'API Selio", async () => {
    const calls = stubFetch();
    const api = new ApiClient(BASE);
    await api.addItemPhotos("item-1", [{ id: "p1", url: "https://cdn.exemple/p1.jpg", alt: "", position: 0 }]);
    await api.getReferral();
    await api.getHealthDetails();
    expect(calls.map((c) => `${c.method} ${c.url.replace(BASE, "")}`)).toEqual([
      "POST /api/items/item-1/photos",
      "GET /api/referral",
      "GET /api/health/details?perTarget=20",
    ]);
    expect(calls[0]!.body).toEqual({ photos: [{ id: "p1", url: "https://cdn.exemple/p1.jpg", alt: "", position: 0 }] });
  });

  it("parrainage : jamais « proposition » en connecté ; route absente ou programme fermé → page masquée", async () => {
    stubFetch(() => new Response(JSON.stringify({ enabled: true, code: "AB3K7Q", shareUrl: "https://selio.example/inscription?parrain=AB3K7Q", referred: { pending: 1, qualified: 0, credited: 0, refused: 0 }, creditsAvailable: 0, creditsConsumed: 0, referredBy: null }), { status: 200 }));
    await expect(new ApiClient(BASE).getReferral()).resolves.toMatchObject({ enabled: true, proposal: false, code: "AB3K7Q" });
    vi.unstubAllGlobals();
    stubFetch(() => new Response(JSON.stringify({ error: { code: "referral_disabled", message: "Le parrainage n'est pas ouvert pour le moment." } }), { status: 404 }));
    await expect(new ApiClient(BASE).getReferral()).resolves.toMatchObject({ enabled: false, proposal: false, code: null });
    vi.unstubAllGlobals();
    stubFetch(() => new Response(JSON.stringify({ error: { code: "forbidden", message: "Interdit" } }), { status: 403 }));
    await expect(new ApiClient(BASE).getReferral()).rejects.toMatchObject({ status: 403 });
  });

  it("inscription : le code de parrainage n'est envoyé que s'il est saisi", async () => {
    const calls = stubFetch();
    const api = new ApiClient(BASE);
    await api.register({ email: "a@exemple.fr", password: "motdepasse-long", displayName: "A", orgName: "A", referralCode: "  " });
    await api.register({ email: "a@exemple.fr", password: "motdepasse-long", displayName: "A", orgName: "A", referralCode: " AB3K7Q " });
    expect(calls[0]!.body).not.toHaveProperty("referralCode");
    expect(calls[1]!.body).toMatchObject({ referralCode: "AB3K7Q" });
  });
});
