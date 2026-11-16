import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, SERVER_UNAVAILABLE_MESSAGE } from "./client";
import { DataError } from "../data/types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const BASE = "https://api.selio.example";
const gateway = () => new Response("<html>Bad Gateway</html>", { status: 502, headers: { "content-type": "text/html" } });

describe("ApiClient : serveur momentanément injoignable (502, 503, 504, réseau)", () => {
  it("une lecture est relancée puis réussit, sans erreur à l'écran", async () => {
    vi.useFakeTimers();
    const replies = [gateway(), new Response(null, { status: 503 }), new Response(JSON.stringify({ ok: true }), { status: 200 })];
    const fetchMock = vi.fn(async () => replies.shift()!);
    vi.stubGlobal("fetch", fetchMock);
    const p = new ApiClient(BASE).getSession();
    await vi.runAllTimersAsync();
    await expect(p).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("après les relances, l'erreur est claire (jamais « Erreur 502 » ni « réponse illisible »)", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => gateway()));
    const p = new ApiClient(BASE).getSession().catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const err = await p;
    expect(err).toBeInstanceOf(DataError);
    expect((err as DataError).code).toBe("unavailable");
    expect((err as DataError).message).toBe(SERVER_UNAVAILABLE_MESSAGE);
  });

  it("une écriture n'est jamais rejouée (pas de double envoi)", async () => {
    const fetchMock = vi.fn(async () => gateway());
    vi.stubGlobal("fetch", fetchMock);
    await expect(new ApiClient(BASE).login({ email: "a@b.fr", password: "x" })).rejects.toMatchObject({ code: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("une coupure réseau est traitée comme un serveur injoignable", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const p = new ApiClient(BASE).getSession().catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    expect((await p as DataError).code).toBe("unavailable");
  });
});
