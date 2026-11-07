import { describe, expect, it } from "vitest";
import { AIError } from "@selio/ai";
import type { LoadedImage } from "./images";
import { ApiReader, DirectReader, ReaderError, toReaderError } from "./readers";
import { FakeAI, fakeJpeg } from "./testing";

const image = (name: string, width = 800): LoadedImage => ({ path: `/jeu/${name}`, name, base64: Buffer.from(fakeJpeg(width, 600)).toString("base64"), format: "jpeg", width, height: 600, bytes: 2_000 });

describe("DirectReader", () => {
  it("décrit le fournisseur depuis la santé (modèle 1, OCR facultatif, simulateur)", async () => {
    const ai = new FakeAI();
    ai.healthResult = { ...ai.healthResult, details: { models: [{ role: "text", name: "t", present: true }, { role: "vision", name: "qwen3-vl:8b", present: false }, { role: "ocr", name: "glm-ocr", present: true, optional: true }] } };
    const info = await new DirectReader(ai).info();
    expect(info).toMatchObject({ mode: "direct", provider: "ollama", visionModel: "qwen3-vl:8b (ABSENT)", ocrModel: "glm-ocr", ocrConfigured: true, simulated: false, status: "healthy" });
    ai.healthResult = { ok: true, status: "mock", message: "simulateur", latencyMs: 0, model: "selio-mock-v1", provider: "mock" };
    expect(await new DirectReader(ai).info()).toMatchObject({ simulated: true, visionModel: "simulateur", ocrConfigured: false });
  });

  it("signale un serveur injoignable comme erreur fatale", async () => {
    const ai = new FakeAI();
    ai.health = async () => {
      throw new Error("ECONNREFUSED");
    };
    await expect(new DirectReader(ai).info()).rejects.toMatchObject({ code: "unavailable", fatal: true });
  });

  it("lit une étiquette : une photo, OCR selon l'option, champs valeur + confiance", async () => {
    const ai = new FakeAI([{ brand: { value: "Levi's", confidence: 0.95 }, size: { value: "M" } }]);
    const r = await new DirectReader(ai).readLabel(image("e1.jpg"), { ocr: false });
    expect(ai.labelCalls).toEqual([{ images: [image("e1.jpg").base64], ocrFallback: false }]);
    expect(r.fields).toEqual({ brand: { value: "Levi's", confidence: 0.95 }, size: { value: "M", confidence: 0.9 }, material: { value: null, confidence: 0 }, reference: { value: null, confidence: 0 } });
    expect(r).toMatchObject({ questions: 2, rejected: 0, ocr: { configured: false, attempted: false, used: false }, latencyMs: 120, simulated: false });
  });

  it("lit les mesures : jusqu'à trois photos, famille transmise, seules les mesures avec preuve de ruban sont gardées", async () => {
    const ai = new FakeAI([], [{ measurements: [{ name: "chest", valueCm: 52 }, { name: "length", valueCm: 68 }] }]);
    const r = await new DirectReader(ai).readMeasurements([image("a.jpg"), image("b.jpg")], "top");
    expect(ai.tapeCalls).toEqual([{ images: [image("a.jpg").base64, image("b.jpg").base64], garmentKind: "top" }]);
    expect(r.tapeVisible).toBe(true);
    expect(r.measurements).toEqual([
      { name: "chest", valueCm: 52, confidence: 0.9 },
      { name: "length", valueCm: 68, confidence: 0.9 },
    ]);
    const none = await new DirectReader(new FakeAI([], [{ tapeVisible: false }])).readMeasurements([image("c.jpg")], "bottom");
    expect(none).toMatchObject({ tapeVisible: false, measurements: [] });
  });

  it("classe les erreurs du service : panne ou configuration = fatale, photo refusée = cas en erreur", async () => {
    const reader = new DirectReader(new FakeAI([new AIError("circuit_open", "disjoncteur ouvert"), new AIError("input_rejected", "photo trop grande"), new AIError("timeout", "délai dépassé", true)]));
    await expect(reader.readLabel(image("e1.jpg"), { ocr: true })).rejects.toMatchObject({ code: "circuit_open", fatal: true });
    await expect(reader.readLabel(image("e1.jpg"), { ocr: true })).rejects.toMatchObject({ code: "input_rejected", fatal: false });
    await expect(reader.readLabel(image("e1.jpg"), { ocr: true })).rejects.toMatchObject({ code: "timeout", fatal: false });
    expect(toReaderError(new Error("autre"))).toMatchObject({ code: "error", fatal: false });
    expect(toReaderError("texte")).toMatchObject({ code: "error", message: "texte" });
    const already = new ReaderError("x", "y", true);
    expect(toReaderError(already)).toBe(already);
  });
});

// ---------------------------------------------------------------- API locale sur HTTP simulé

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function fakeApi(handlers: { prepare: (call: Call, n: number) => Response | Promise<Response>; login?: (call: Call) => Response; limits?: (call: Call) => Response }) {
  const calls: Call[] = [];
  let prepares = 0;
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const call: Call = { url, method: init?.method ?? "GET", headers, body: typeof init?.body === "string" ? JSON.parse(init.body) : null };
    calls.push(call);
    if (url.endsWith("/api/auth/login")) return handlers.login ? handlers.login(call) : json(200, { ok: true }, { "set-cookie": "selio_session=abc123; Path=/; HttpOnly" });
    if (url.endsWith("/api/studio/limits")) return handlers.limits ? handlers.limits(call) : json(200, { vision: { available: true, simulated: false, ocrConfigured: true }, serverReduction: false });
    if (url.endsWith("/api/studio/prepare")) return handlers.prepare(call, ++prepares);
    return json(404, { error: { code: "not_found", message: "?" } });
  };
  return { calls, fetchImpl, json };
}

const prepBody = (article: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ batchId: "b", articles: [{ fields: {}, tapeVisible: false, measurements: [], questions: [], warnings: [], ...article }], warnings: [], simulated: false, ocr: { configured: false, used: false }, ...extra });

describe("ApiReader", () => {
  const options = (fetchImpl: typeof fetch, sleeps: number[] = []) => ({ baseUrl: "http://127.0.0.1:8787/", email: "equipe@selio.test", password: "mot-de-passe-de-test", fetchImpl, sleep: async (ms: number) => void sleeps.push(ms), maxRetries: 2 });

  it("se connecte une fois, garde le cookie, décrit l'API par /api/studio/limits", async () => {
    const api = fakeApi({ prepare: () => api.json(201, prepBody({})) });
    const reader = new ApiReader(options(api.fetchImpl));
    const info = await reader.info();
    expect(info).toMatchObject({ mode: "api", simulated: false, ocrConfigured: true, status: "healthy", model: "http://127.0.0.1:8787/" });
    expect(api.calls[0]).toMatchObject({ url: "http://127.0.0.1:8787/api/auth/login", method: "POST", body: { email: "equipe@selio.test", password: "mot-de-passe-de-test" } });
    expect(api.calls[1]).toMatchObject({ url: "http://127.0.0.1:8787/api/studio/limits", headers: { cookie: "selio_session=abc123" } });
    await reader.readLabel(image("e1.jpg"), { ocr: true });
    expect(api.calls.filter((c) => c.url.endsWith("/api/auth/login"))).toHaveLength(1);
  });

  it("refuse une connexion rejetée (fatal) et une API injoignable", async () => {
    const api = fakeApi({ prepare: () => api.json(201, prepBody({})), login: () => api.json(401, { error: { code: "invalid_credentials", message: "non" } }) });
    await expect(new ApiReader(options(api.fetchImpl)).info()).rejects.toMatchObject({ code: "auth", fatal: true });
    const down: typeof fetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    await expect(new ApiReader(options(down)).info()).rejects.toMatchObject({ code: "unavailable", fatal: true });
  });

  it("lit une étiquette : rôle « label » imposé, aucune indication, seules les valeurs de provenance étiquette comptent", async () => {
    const api = fakeApi({
      prepare: () => api.json(201, prepBody({
        fields: { brand: { value: "Levi's", source: "label", confidence: 0.91 }, size: { value: "M", source: "seller" }, material: { value: null, source: null, question: "Quelle matière ?" }, reference: { value: "04511", source: "label", confidence: 0.6 } },
        questions: [{ field: "material", reason: "missing", text: "?" }],
        warnings: ["avertissement article"],
      }, { ocr: { configured: true, used: true }, warnings: ["avertissement général"] })),
    });
    const r = await new ApiReader(options(api.fetchImpl)).readLabel(image("e1.jpg"), { ocr: true });
    const prepare = api.calls.find((c) => c.url.endsWith("/api/studio/prepare"))!;
    expect(prepare.body).toEqual({ photos: [{ id: "etiquette", url: `data:image/jpeg;base64,${image("e1.jpg").base64}`, role: "label" }] });
    expect(prepare.headers.cookie).toBe("selio_session=abc123");
    expect(r.fields).toEqual({ brand: { value: "Levi's", confidence: 0.91 }, size: { value: null, confidence: 0 }, material: { value: null, confidence: 0 }, reference: { value: "04511", confidence: 0.6 } });
    expect(r).toMatchObject({ questions: 1, ocr: { configured: true, used: true }, simulated: false, warnings: ["avertissement général", "avertissement article"] });
  });

  it("lit les mesures : rôle « tape », famille transmise, seules les mesures lues sur le ruban comptent", async () => {
    const api = fakeApi({
      prepare: () => api.json(201, prepBody({ tapeVisible: true, measurements: [{ name: "chest", valueCm: 52, source: "tape_photo", confidence: 0.88 }, { name: "length", valueCm: 68, source: "reference_db" }, { name: "waist", valueCm: null, source: null }] }, { simulated: true })),
    });
    const r = await new ApiReader(options(api.fetchImpl)).readMeasurements([image("a.jpg"), image("b.jpg")], "top");
    const prepare = api.calls.find((c) => c.url.endsWith("/api/studio/prepare"))!;
    expect(prepare.body).toMatchObject({ garmentKind: "top", photos: [{ id: "metre-1", role: "tape" }, { id: "metre-2", role: "tape" }] });
    expect(r).toMatchObject({ tapeVisible: true, measurements: [{ name: "chest", valueCm: 52, confidence: 0.88 }], simulated: true });
  });

  it("attend après un 429 (Retry-After) puis réessaie ; abandonne au-delà des tentatives", async () => {
    const sleeps: number[] = [];
    const api = fakeApi({ prepare: (_c, n) => (n === 1 ? api.json(429, { error: { code: "rate_limited", message: "trop" } }, { "retry-after": "7" }) : api.json(201, prepBody({}))) });
    await new ApiReader(options(api.fetchImpl, sleeps)).readLabel(image("e1.jpg"), { ocr: true });
    expect(sleeps).toEqual([7_000]);
    const always = fakeApi({ prepare: () => api.json(429, { error: { code: "rate_limited", message: "trop" } }) });
    await expect(new ApiReader(options(always.fetchImpl, sleeps)).readLabel(image("e1.jpg"), { ocr: true })).rejects.toMatchObject({ code: "rate_limited", fatal: true });
    expect(sleeps.slice(1)).toEqual([6_000, 6_000]);
  });

  it("classe les refus de l'API : photo refusée = cas en erreur ; 402, 503, 401 = fatal", async () => {
    const statuses: [number, string][] = [[422, "photo_rejected"], [402, "quota_exceeded"], [503, "ai_unavailable"], [401, "unauthorized"], [500, "internal"]];
    let i = 0;
    const api = fakeApi({ prepare: () => api.json(statuses[i]![0], { error: { code: statuses[i++]![1], message: "m" } }) });
    const reader = new ApiReader(options(api.fetchImpl));
    await expect(reader.readLabel(image("e1.jpg"), { ocr: true })).rejects.toMatchObject({ code: "input_rejected", fatal: false });
    await expect(reader.readLabel(image("e1.jpg"), { ocr: true })).rejects.toMatchObject({ code: "quota_exceeded", fatal: true });
    await expect(reader.readLabel(image("e1.jpg"), { ocr: true })).rejects.toMatchObject({ code: "ai_unavailable", fatal: true });
    await expect(reader.readLabel(image("e1.jpg"), { ocr: true })).rejects.toMatchObject({ code: "auth", fatal: true });
    await expect(reader.readLabel(image("e1.jpg"), { ocr: true })).rejects.toMatchObject({ code: "internal", fatal: true });
    const empty = fakeApi({ prepare: () => api.json(201, { ...prepBody({}), articles: [] }) });
    await expect(new ApiReader(options(empty.fetchImpl)).readLabel(image("e1.jpg"), { ocr: true })).rejects.toMatchObject({ code: "empty", fatal: false });
  });
});
