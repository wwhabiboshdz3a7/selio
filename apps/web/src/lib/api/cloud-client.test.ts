import { afterEach, describe, expect, it, vi } from "vitest";
import { DataError } from "../data/types";
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

describe("ApiClient : routes /api/cloud/*", () => {
  it("appelle les routes de l'API avec le cookie de session et les bons corps", async () => {
    const calls = stubFetch();
    const api = new ApiClient("https://api.selio.example");
    await api.cloudAvailability();
    await api.cloudConsent();
    await api.acceptCloudConsent({ version: "v1", accepted: true });
    await api.cloudAccounts();
    await api.enableCloudAccount("conn-1");
    await api.pauseCloudAccount("acc-1");
    await api.resumeCloudAccount("acc-1", { acknowledge: true });
    await api.resumeCloudAccount("acc-1");
    await api.stopCloudAccount("acc-1");
    await api.deleteCloudSession("acc-1");
    await api.updateCloudSettings("acc-1", { levels: ["light"] });
    await api.cloudJournal({ status: "failed", page: 2, pageSize: 10 });
    await api.cancelCloudLogin("login-1");
    expect(calls.map((c) => `${c.method} ${c.url.replace("https://api.selio.example", "")}`)).toEqual([
      "GET /api/cloud/availability",
      "GET /api/cloud/consent",
      "POST /api/cloud/consent",
      "GET /api/cloud/accounts",
      "POST /api/cloud/accounts",
      "POST /api/cloud/accounts/acc-1/pause",
      "POST /api/cloud/accounts/acc-1/resume",
      "POST /api/cloud/accounts/acc-1/resume",
      "POST /api/cloud/accounts/acc-1/stop",
      "DELETE /api/cloud/accounts/acc-1/session",
      "PATCH /api/cloud/accounts/acc-1/settings",
      "GET /api/cloud/journal?status=failed&page=2&pageSize=10",
      "POST /api/cloud/login/login-1/cancel",
    ]);
    expect(calls[2]!.body).toEqual({ version: "v1", accepted: true });
    expect(calls[4]!.body).toEqual({ connectionId: "conn-1" });
    expect(calls[6]!.body).toEqual({ acknowledge: true });
    expect(calls[7]!.body).toEqual({ acknowledge: false });
    expect(calls[10]!.body).toEqual({ levels: ["light"] });
  });

  it("fenêtre de connexion : adresse wss avec le ticket ; export CSV brut ; la connexion simulée n'existe qu'en démo", async () => {
    const calls = stubFetch((url) => url.endsWith("/login")
      ? new Response(JSON.stringify({ loginSessionId: "0f8b6c1e-0000-4000-8000-000000000001", ticket: "abcdefghijklmnopqrstuvwxyz0123456789-_AB", expiresAt: "2026-10-29T12:15:00.000Z" }), { status: 201 })
      : new Response("Date;Compte\n", { status: 200 }));
    const api = new ApiClient("https://api.selio.example");
    const start = await api.startCloudLogin("acc-1");
    expect(start).toMatchObject({ simulated: false, loginSessionId: "0f8b6c1e-0000-4000-8000-000000000001" });
    expect(start.socketUrl).toBe("wss://api.selio.example/api/cloud/login/0f8b6c1e-0000-4000-8000-000000000001/ws?ticket=abcdefghijklmnopqrstuvwxyz0123456789-_AB");
    expect(await api.exportCloudJournalCsv({ kind: "reply", page: 3 })).toBe("Date;Compte\n");
    expect(calls.at(-1)!.url).toBe("https://api.selio.example/api/cloud/journal.csv?kind=reply");
    await expect(api.completeSimulatedCloudLogin()).rejects.toBeInstanceOf(DataError);
  });

  it("remonte les erreurs de l'API telles quelles (accord manquant, offre)", async () => {
    stubFetch(() => new Response(JSON.stringify({ error: { code: "consent_required", message: "Acceptez d'abord les conditions de Selio Cloud (écran d'accord)." } }), { status: 409 }));
    const api = new ApiClient("");
    await expect(api.enableCloudAccount("conn-1")).rejects.toMatchObject({ code: "consent_required", status: 409 });
  });
});
