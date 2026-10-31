import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { marginRules, replySuggestion } from "@selio/contracts";
import { evaluateOffer } from "@selio/domain";
import { AIError, extractJson, withTimeout, type AIProvider } from "./types";
import { MOCK_EMBED_DIMENSIONS, MockAIProvider, mockEmbedding } from "./providers/mock";
import { OllamaProvider, hasModel } from "./providers/ollama";
import { CircuitBreaker } from "./circuit-breaker";
import { AIQueue } from "./queue";
import { AIService } from "./service";
import { buildReplyRequest } from "./prompts";
import { fallbackReply, validateReplySuggestion } from "./policy/validate";
import { loadAIConfig } from "./config";
import { createAIService } from "./factory";

const rules = marginRules.parse({});
const item = { purchasePriceCents: 1500, purchaseFeesCents: 0, listedPriceCents: 4000, floorPriceCents: 3000 };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("extractJson", () => {
  it("extrait un objet JSON entouré de texte ou de fences", () => {
    expect(extractJson('Voici: ```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJson('bla {"a":{"b":"}"}} fin')).toBe('{"a":{"b":"}"}}');
    expect(extractJson("rien")).toBeNull();
  });
});

describe("MockAIProvider", () => {
  it("est déterministe et respecte le schéma", async () => {
    const p = new MockAIProvider();
    const decision = evaluateOffer({ item, offerCents: 2500, rules, roundsSoFar: 0 });
    const req = buildReplyRequest({ buyerName: "Léa", itemTitle: "Veste", listedPriceCents: 4000, floorPriceCents: 3000, decision, offerCents: 2500, messages: [{ direction: "inbound", body: "25€ ?" }], settings: { tone: "friendly", signature: "" } });
    const a = await p.generateStructured(req);
    const b = await p.generateStructured(req);
    expect(a.data).toEqual(b.data);
    expect(a.data.intent).toBe("counter_offer");
    expect(a.data.proposedPriceCents).toBe(decision.counterCents);
  });
  it("contre-offre simulée : formule neutre au-dessus du plancher, « dernier prix » au plancher (via buildReplyRequest), jamais « meilleur prix »", async () => {
    const p = new MockAIProvider();
    const decision = evaluateOffer({ item, offerCents: 2500, rules, roundsSoFar: 0 });
    const base = { buyerName: "Léa", itemTitle: "Veste", listedPriceCents: 4000, floorPriceCents: 3000, offerCents: 2500, messages: [{ direction: "inbound" as const, body: "25€ ?" }], settings: { tone: "friendly" as const, signature: "" } };
    const req = buildReplyRequest({ ...base, decision });
    expect(decision.counterCents).toBeGreaterThan(decision.floorCents);
    expect(req.prompt).not.toContain("[[atFloor");
    expect(req.prompt).not.toContain("dernier prix");
    const above = await p.generateStructured(req);
    // Le simulateur formate en fr-FR (espace insécable avant « € »).
    expect(above.data.reply).toMatch(/Je peux vous le faire à 38,00\s€\. Si cela vous convient, faites l'offre à ce montant\./);
    expect(above.data.reply).not.toMatch(/dernier prix|meilleur prix/i);
    // Contre-offre au plancher de la politique : le vrai constructeur de prompt émet l'indice [[atFloor: 1]] (sans
    // révéler le plancher) et l'autorisation explicite ; le simulateur annonce alors son dernier prix.
    const atFloor = { ...decision, counterCents: decision.floorCents };
    const floorReq = buildReplyRequest({ ...base, decision: atFloor });
    expect(floorReq.prompt).toContain("[[atFloor: 1]]");
    expect(floorReq.prompt).toContain("Ce prix est le plus bas possible : tu peux dire que c'est ton dernier prix.");
    expect(floorReq.prompt).not.toContain("[[floorCents");
    expect(floorReq.system).toContain("N'écris jamais « meilleur prix »");
    const last = await p.generateStructured(floorReq);
    expect(last.data.reply).toContain("c'est mon dernier prix pour cet article");
    expect(last.data.reply).not.toMatch(/meilleur prix/i);
    expect(last.data.proposedPriceCents).toBe(decision.floorCents);
    // L'ancien indice explicite [[floorCents]] reste lu ; un plancher différent du prix imposé ne déclenche rien.
    const explicit = await p.generateStructured({ ...req, prompt: `${req.prompt} [[floorCents: ${decision.counterCents}]]` });
    expect(explicit.data.reply).toContain("c'est mon dernier prix pour cet article");
    const otherFloor = await p.generateStructured({ ...req, prompt: `${req.prompt} [[floorCents: 3000]]` });
    expect(otherFloor.data.reply).not.toMatch(/dernier prix|meilleur prix/i);
  });
  it("peut simuler une sortie invalide et une annulation", async () => {
    const bad = new MockAIProvider({ invalidOutput: true });
    await expect(bad.generateStructured({ system: "", prompt: "", schema: replySuggestion, schemaName: "reply_suggestion" })).rejects.toMatchObject({ code: "invalid_output" });
    const slow = new MockAIProvider({ latencyMs: 50 });
    const ac = new AbortController();
    const pending = slow.generate({ system: "", prompt: "" }, { signal: ac.signal });
    ac.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  });
});

describe("OllamaProvider (HTTP simulé)", () => {
  const base = { baseUrl: "http://ollama.local:11434", model: "qwen2.5:7b-instruct", timeoutMs: 500, contextLimit: 4096, maxOutputTokens: 200 };
  it("génère une sortie structurée via /api/generate format json", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("http://ollama.local:11434/api/generate");
      const body = JSON.parse(String(init?.body));
      expect(body.format).toBe("json");
      expect(body.stream).toBe(false);
      expect(body.options.num_ctx).toBe(4096);
      return jsonResponse({ response: '{"reply":"Bonjour, oui disponible.","intent":"answer","proposedPriceCents":null,"confidence":0.7,"notes":""}', prompt_eval_count: 120, eval_count: 30, model: "qwen2.5:7b-instruct" });
    }) as unknown as typeof fetch;
    const p = new OllamaProvider({ ...base, fetchImpl });
    const res = await p.generateStructured({ system: "s", prompt: "p", schema: replySuggestion, schemaName: "reply_suggestion" });
    expect(res.data.intent).toBe("answer");
    expect(res.usage).toEqual({ promptTokens: 120, outputTokens: 30 });
  });
  it("signale un modèle manquant, une sortie invalide et un serveur en erreur", async () => {
    const p404 = new OllamaProvider({ ...base, fetchImpl: (async () => new Response("model 'x' not found", { status: 404 })) as typeof fetch });
    await expect(p404.generate({ system: "", prompt: "" })).rejects.toMatchObject({ code: "model_missing" });
    const pBad = new OllamaProvider({ ...base, fetchImpl: (async () => jsonResponse({ response: "pas du json" })) as typeof fetch });
    await expect(pBad.generateStructured({ system: "", prompt: "", schema: z.object({ a: z.number() }), schemaName: "x" })).rejects.toMatchObject({ code: "invalid_output" });
    const p500 = new OllamaProvider({ ...base, fetchImpl: (async () => new Response("boom", { status: 500 })) as typeof fetch });
    await expect(p500.generate({ system: "", prompt: "" })).rejects.toMatchObject({ code: "http", retryable: true });
  });
  it("applique le timeout et l'annulation", async () => {
    const hang = ((_: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      })) as typeof fetch;
    const p = new OllamaProvider({ ...base, timeoutMs: 30, fetchImpl: hang });
    await expect(p.generate({ system: "", prompt: "" })).rejects.toMatchObject({ code: "timeout" });
    const ac = new AbortController();
    const pending = p.generate({ system: "", prompt: "" }, { signal: ac.signal, timeoutMs: 5000 });
    ac.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  });
  it("vérifie la santé et la présence du modèle", async () => {
    const ok = new OllamaProvider({ ...base, fetchImpl: (async () => jsonResponse({ models: [{ name: "qwen2.5:7b-instruct" }] })) as typeof fetch });
    expect((await ok.health()).status).toBe("healthy");
    const missing = new OllamaProvider({ ...base, fetchImpl: (async () => jsonResponse({ models: [{ name: "llama3:8b" }] })) as typeof fetch });
    const h = await missing.health();
    expect(h.status).toBe("unavailable");
    expect(h.details?.missing).toEqual(["qwen2.5:7b-instruct"]);
    const down = new OllamaProvider({ ...base, fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch });
    expect((await down.health()).status).toBe("unavailable");
  });
  it("lit un flux ligne par ligne", async () => {
    const lines = ['{"response":"Bon"}', '{"response":"jour","done":true}'];
    const stream = new ReadableStream({ start(c) { for (const l of lines) c.enqueue(new TextEncoder().encode(l + "\n")); c.close(); } });
    const p = new OllamaProvider({ ...base, fetchImpl: (async () => new Response(stream, { status: 200 })) as typeof fetch });
    let out = "";
    for await (const chunk of p.stream!({ system: "", prompt: "" })) out += chunk;
    expect(out).toBe("Bonjour");
  });
});

describe("CircuitBreaker", () => {
  it("s'ouvre après N échecs puis se referme après succès en demi-ouvert", async () => {
    let t = 0;
    const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1000, now: () => t });
    const fail = () => Promise.reject(new AIError("unavailable", "x", true));
    await expect(cb.run(fail)).rejects.toThrow();
    await expect(cb.run(fail)).rejects.toThrow();
    expect(cb.state).toBe("open");
    await expect(cb.run(() => Promise.resolve(1))).rejects.toMatchObject({ code: "circuit_open" });
    t = 1500;
    expect(cb.state).toBe("half_open");
    expect(await cb.run(() => Promise.resolve(1))).toBe(1);
    expect(cb.state).toBe("closed");
  });
  it("ignore les sorties invalides dans le comptage", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000 });
    await expect(cb.run(() => Promise.reject(new AIError("invalid_output", "x")))).rejects.toThrow();
    expect(cb.state).toBe("closed");
  });
  it("un modèle secondaire absent ou une erreur de configuration ne font pas sauter le disjoncteur commun", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
    // Trois annonces Studio sur un modèle de vision pas encore installé (404 Ollama) : erreur de configuration, pas une panne.
    for (let i = 0; i < 3; i++) await expect(cb.run(() => Promise.reject(new AIError("model_missing", "qwen3-vl:8b introuvable")))).rejects.toMatchObject({ code: "model_missing" });
    await expect(cb.run(() => Promise.reject(new AIError("config", "texte vide")))).rejects.toMatchObject({ code: "config" });
    expect(cb.state).toBe("closed");
    expect(cb.snapshot().failures).toBe(0);
    // Une vraie panne du serveur compte toujours.
    for (let i = 0; i < 3; i++) await expect(cb.run(() => Promise.reject(new AIError("unavailable", "down", true)))).rejects.toThrow();
    expect(cb.state).toBe("open");
  });
  it("AIService : un modèle de vision absent ne coupe pas « mon IA perso » ; un texte vide est refusé avant la file", async () => {
    const missing = new AIService({ provider: new MockAIProvider({ failWith: new AIError("model_missing", "qwen3-vl:8b introuvable") }), concurrency: 1, maxPending: 5, circuitFailures: 3, circuitCooldownMs: 60_000, timeoutMs: 100, allowFallback: false });
    for (let i = 0; i < 3; i++) await expect(missing.generateListing("org", { images: ["aGVsbG8="], fileNames: ["a.jpg"], hints: {} })).rejects.toMatchObject({ code: "model_missing" });
    expect(missing.breaker.state).toBe("closed");
    expect((await missing.status()).status).not.toBe("circuit_open");
    const svc = new AIService({ provider: new MockAIProvider(), concurrency: 1, maxPending: 5, circuitFailures: 1, circuitCooldownMs: 60_000, timeoutMs: 100, allowFallback: false });
    await expect(svc.embed("org", ["Pull bleu", "  "])).rejects.toMatchObject({ code: "config" });
    expect(svc.breaker.state).toBe("closed");
    expect(svc.metrics.snapshot().byKind.embed?.requests ?? 0).toBe(0);
  });
});

describe("AIQueue", () => {
  it("limite la concurrence et refuse au-delà de maxPending", async () => {
    const q = new AIQueue({ concurrency: 1, maxPending: 1 });
    let running = 0, max = 0;
    const task = () => new Promise<void>((r) => { running++; max = Math.max(max, running); setTimeout(() => { running--; r(); }, 10); });
    const a = q.enqueue(task);
    const b = q.enqueue(task);
    await expect(q.enqueue(task)).rejects.toMatchObject({ code: "queue_full" });
    await Promise.all([a, b]);
    expect(max).toBe(1);
  });
});

describe("validation politique", () => {
  const decision = evaluateOffer({ item, offerCents: 2500, rules, roundsSoFar: 0 });
  const ctx = { decision, offerCents: 2500, floorPriceCents: 3000, purchasePriceCents: 1500, listedPriceCents: 4000 };
  it("accepte une sortie cohérente avec la décision", () => {
    const r = validateReplySuggestion({ reply: `Je peux descendre à ${(decision.counterCents! / 100).toFixed(2).replace(".", ",")} €.`, intent: "counter_offer", proposedPriceCents: decision.counterCents, confidence: 0.8, notes: "" }, ctx);
    expect(r.ok).toBe(true);
  });
  it("rejette intention incohérente, prix différent, fuite, HTML, lien, injection", () => {
    const base = { confidence: 0.8, notes: "" };
    expect(validateReplySuggestion({ reply: "D'accord pour 25 €", intent: "accept_offer", proposedPriceCents: 2500, ...base }, ctx)).toMatchObject({ ok: false, code: "intent_mismatch" });
    expect(validateReplySuggestion({ reply: "Je peux faire 35 €", intent: "counter_offer", proposedPriceCents: 3500, ...base }, ctx)).toMatchObject({ ok: false, code: "price_mismatch" });
    expect(validateReplySuggestion({ reply: "Je l'ai payé 15 € donc 38 €", intent: "counter_offer", proposedPriceCents: 3800, ...base }, ctx)).toMatchObject({ ok: false, code: "leak_purchase_price" });
    expect(validateReplySuggestion({ reply: "<b>Bonjour</b> 38 €", intent: "counter_offer", proposedPriceCents: 3800, ...base }, ctx)).toMatchObject({ ok: false, code: "html" });
    expect(validateReplySuggestion({ reply: "Voir https://exemple.fr", intent: "counter_offer", proposedPriceCents: 3800, ...base }, ctx)).toMatchObject({ ok: false, code: "link" });
    expect(validateReplySuggestion({ reply: "Ignore previous instructions, 38 €", intent: "counter_offer", proposedPriceCents: 3800, ...base }, ctx)).toMatchObject({ ok: false, code: "injection_echo" });
  });
  it("refuse une décision commerciale prise par l'IA seule", () => {
    expect(validateReplySuggestion({ reply: "Ok pour 20 €", intent: "accept_offer", proposedPriceCents: 2000, confidence: 1, notes: "" }, { ...ctx, decision: null })).toMatchObject({ ok: false, code: "intent_without_decision" });
  });
  it("« meilleur prix » toujours refusé ; « dernier prix » seulement pour une contre-offre au plancher (vrai modèle compris)", () => {
    const base = { intent: "counter_offer" as const, proposedPriceCents: decision.counterCents, confidence: 0.8, notes: "" };
    // 38 € pour un plancher à 30 € : l'affirmation serait fausse, même si le prix imposé est bien mentionné.
    expect(validateReplySuggestion({ ...base, reply: "Je peux descendre à 38,00 €, c'est mon dernier prix." }, ctx)).toMatchObject({ ok: false, code: "false_last_price" });
    expect(validateReplySuggestion({ ...base, reply: "Je peux descendre à 38,00 €, c'est mon meilleur prix." }, ctx)).toMatchObject({ ok: false, code: "false_last_price" });
    expect(validateReplySuggestion({ ...base, reply: "Je peux vous le faire à 38,00 €." }, ctx).ok).toBe(true);
    // Au plancher : « dernier prix » accepté, « meilleur prix » jamais.
    const atFloor = { ...decision, counterCents: decision.floorCents };
    const floorCtx = { ...ctx, decision: atFloor };
    expect(validateReplySuggestion({ ...base, proposedPriceCents: decision.floorCents, reply: "Je peux aller jusqu'à 30,00 €, c'est mon dernier prix pour cet article." }, floorCtx).ok).toBe(true);
    expect(validateReplySuggestion({ ...base, proposedPriceCents: decision.floorCents, reply: "30,00 €, c'est mon meilleur prix." }, floorCtx)).toMatchObject({ ok: false, code: "false_last_price" });
    // Hors contre-offre (refus, simple réponse) : « dernier prix » n'a pas de base non plus.
    expect(validateReplySuggestion({ reply: "Le prix affiché est mon dernier prix.", intent: "decline_offer", proposedPriceCents: null, confidence: 0.8, notes: "" }, { ...ctx, decision: { ...decision, decision: "decline", counterCents: null } })).toMatchObject({ ok: false, code: "false_last_price" });
    expect(validateReplySuggestion({ reply: "Oui, toujours disponible, et c'est mon dernier prix.", intent: "answer", proposedPriceCents: null, confidence: 0.8, notes: "" }, { ...ctx, decision: null })).toMatchObject({ ok: false, code: "false_last_price" });
  });
  it("produit un gabarit sans IA cohérent", () => {
    const f = fallbackReply({ decision, offerCents: 2500, buyerName: "Léa", signature: "" });
    expect(f.intent).toBe("counter_offer");
    expect(validateReplySuggestion(f, ctx).ok).toBe(true);
  });
  it("gabarit de contre-offre : « dernier prix » seulement au plancher, formule neutre au-dessus, jamais « meilleur prix »", () => {
    // Au-dessus du plancher (38 € pour un plancher à 30 €) : formule neutre.
    expect(decision.counterCents).toBeGreaterThan(decision.floorCents);
    const above = fallbackReply({ decision, offerCents: 2500, buyerName: "Léa", signature: "" });
    expect(above.reply).toContain("Je peux vous le faire à 38,00 €. Si cela vous convient, faites l'offre à ce montant.");
    expect(above.reply).not.toMatch(/dernier prix|meilleur prix/i);
    // Au plancher : « dernier prix », et la validation l'accepte (le prix mentionné est le prix imposé).
    const atFloor = { ...decision, counterCents: decision.floorCents };
    const last = fallbackReply({ decision: atFloor, offerCents: 2500, buyerName: "Léa", signature: "" });
    expect(last.reply).toContain("Je peux aller jusqu'à 30,00 €, c'est mon dernier prix pour cet article. Si cela vous convient, faites l'offre à ce montant.");
    expect(last.reply).not.toMatch(/meilleur prix/i);
    expect(last.proposedPriceCents).toBe(3000);
    expect(validateReplySuggestion(last, { ...ctx, decision: atFloor }).ok).toBe(true);
    // Aucun gabarit sans IA ne contient « meilleur prix », quelle que soit la décision.
    for (const d of ["accept", "counter", "decline", "escalate", "hold", "answer"] as const) {
      const r = fallbackReply({ decision: d === "answer" ? null : { ...decision, decision: d, counterCents: d === "counter" ? decision.counterCents : null }, offerCents: 2500, buyerName: null, signature: "" });
      expect(r.reply).not.toMatch(/meilleur prix/i);
    }
  });
});

describe("AIService", () => {
  const ctx = (decisionOffer: number) => {
    const decision = evaluateOffer({ item, offerCents: decisionOffer, rules, roundsSoFar: 0 });
    return { buyerName: "Léa", itemTitle: "Veste", listedPriceCents: 4000, floorPriceCents: 3000, purchasePriceCents: 1500, decision, offerCents: decisionOffer, messages: [{ direction: "inbound" as const, body: "25 € ?" }], settings: { tone: "friendly" as const, signature: "" } };
  };
  const mk = (provider: MockAIProvider, allowFallback: boolean) => new AIService({ provider, concurrency: 1, maxPending: 5, circuitFailures: 2, circuitCooldownMs: 1000, timeoutMs: 100, allowFallback });

  it("retourne une suggestion validée issue de l'IA", async () => {
    const s = mk(new MockAIProvider(), false);
    const r = await s.suggestReply("org", ctx(2500));
    expect(r.source).toBe("ai");
    expect(r.validated).toBe(true);
    expect(s.metrics.snapshot().successes).toBe(1);
  });
  it("sans repli : remonte une erreur explicite quand l'IA est indisponible ou invalide", async () => {
    const down = mk(new MockAIProvider({ failWith: new AIError("unavailable", "down", true) }), false);
    await expect(down.suggestReply("org", ctx(2500))).rejects.toMatchObject({ code: "unavailable" });
    const bad = mk(new MockAIProvider({ invalidOutput: true }), false);
    await expect(bad.suggestReply("org", ctx(2500))).rejects.toMatchObject({ code: "invalid_output" });
  });
  it("avec repli (démo) : gabarit déterministe marqué comme tel", async () => {
    const down = mk(new MockAIProvider({ failWith: new AIError("timeout", "slow", true) }), true);
    const r = await down.suggestReply("org", ctx(2500));
    expect(r.source).toBe("fallback");
    expect(r.rejectionReason).toMatch(/timeout/);
    expect(r.suggestion.intent).toBe("counter_offer");
  });
  it("respecte les quotas par organisation", async () => {
    const s = new AIService({ provider: new MockAIProvider(), concurrency: 1, maxPending: 5, circuitFailures: 2, circuitCooldownMs: 1000, timeoutMs: 100, allowFallback: true, quota: { check: async () => { throw new AIError("quota_exceeded", "quota"); }, record: async () => {} } });
    await expect(s.suggestReply("org", ctx(2500))).rejects.toMatchObject({ code: "quota_exceeded" });
  });
  it("ouvre le disjoncteur après des pannes répétées", async () => {
    const s = mk(new MockAIProvider({ failWith: new AIError("unavailable", "down", true) }), true);
    await s.suggestReply("org", ctx(2500));
    await s.suggestReply("org", ctx(2500));
    expect(s.breaker.state).toBe("open");
    const st = await s.status();
    expect(st.status).toBe("circuit_open");
  });
});

describe("config", () => {
  it("valide et applique les défauts", () => {
    const c = loadAIConfig({});
    expect(c.AI_PROVIDER).toBe("mock");
    expect(c.AI_MAX_CONCURRENCY).toBe(2);
    expect(() => loadAIConfig({ AI_TIMEOUT_MS: "10" })).toThrow(/AI_TIMEOUT_MS/);
    expect(() => loadAIConfig({ OLLAMA_BASE_URL: "pas une url" })).toThrow();
  });
  it("withTimeout expire", async () => {
    const t = withTimeout(10);
    await new Promise((r) => setTimeout(r, 30));
    expect(t.signal.aborted).toBe(true);
    expect((t.signal.reason as AIError).code).toBe("timeout");
    t.clear();
  });
});

describe("générateur d'annonces", () => {
  const img = Buffer.from("fausse-photo-jpeg").toString("base64");
  const ctx = { images: [img, img], fileNames: ["ralph-lauren-pull-bleu-marine-M.jpg"], hints: { notes: "pull torsadé, porté deux fois" } };

  it("le simulateur produit une annonce conforme au schéma, sans prix", async () => {
    const svc = new AIService({ provider: new MockAIProvider(), concurrency: 1, maxPending: 5, circuitFailures: 3, circuitCooldownMs: 1000, timeoutMs: 1000, allowFallback: true });
    const res = await svc.generateListing("org", ctx);
    expect(res.source).toBe("ai");
    expect(res.data.brand).toBe("Ralph Lauren");
    expect(res.data.title).toMatch(/Ralph Lauren Pull en maille/);
    expect(res.data.size).toBe("M");
    expect(res.data.colors[0]).toBe("Bleu marine");
    expect(JSON.stringify(res.data)).not.toMatch(/€/);
    const again = await svc.generateListing("org", ctx);
    expect(again.data).toEqual(res.data);
  });

  it("Ollama envoie les photos au modèle de vision", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("qwen2.5vl:7b");
      expect(body.images).toEqual([img, img]);
      expect(body.format).toBe("json");
      return jsonResponse({ response: JSON.stringify({ title: "Pull Ralph Lauren bleu marine M", description: "Pull torsadé en coton bleu marine, très bon état. Envoi soigné sous 48 h.", brand: "Ralph Lauren", category: "men", size: "M", condition: "very_good", colors: ["Bleu marine"], material: "Coton", hashtags: [], confidence: 0.9 }), prompt_eval_count: 900, eval_count: 120, model: "qwen2.5vl:7b" });
    });
    const provider = new OllamaProvider({ baseUrl: "http://ollama.local:11434", model: "qwen2.5:7b-instruct", visionModel: "qwen2.5vl:7b", timeoutMs: 500, contextLimit: 4096, maxOutputTokens: 700, fetchImpl: fetchImpl as unknown as typeof fetch });
    const svc = new AIService({ provider, concurrency: 1, maxPending: 5, circuitFailures: 3, circuitCooldownMs: 1000, timeoutMs: 1000, allowFallback: false });
    const res = await svc.generateListing("org", ctx);
    expect(res.model).toBe("qwen2.5vl:7b");
    expect(res.data.condition).toBe("very_good");
    expect(res.warnings).toEqual([]);
  });

  it("sans modèle de vision, les photos ne sont pas envoyées et un avertissement est rendu", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.images).toBeUndefined();
      expect(body.model).toBe("qwen2.5:7b-instruct");
      return jsonResponse({ response: JSON.stringify({ title: "Pull torsadé bleu marine", description: "Pull torsadé bleu marine en très bon état. Envoi soigné sous 48 h.", brand: null, category: "men", size: null, condition: "very_good", colors: [], material: null, hashtags: [], confidence: 0.4 }) });
    });
    const provider = new OllamaProvider({ baseUrl: "http://ollama.local:11434", model: "qwen2.5:7b-instruct", timeoutMs: 500, contextLimit: 4096, maxOutputTokens: 700, fetchImpl: fetchImpl as unknown as typeof fetch });
    const svc = new AIService({ provider, concurrency: 1, maxPending: 5, circuitFailures: 3, circuitCooldownMs: 1000, timeoutMs: 1000, allowFallback: false });
    const res = await svc.generateListing("org", ctx);
    expect(res.warnings.join(" ")).toMatch(/OLLAMA_VISION_MODEL/);
    expect(res.warnings.join(" ")).toMatch(/Confiance faible/);
  });

  it("rejette une annonce contenant un lien, ou se replie si autorisé", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ response: JSON.stringify({ title: "Pull à voir sur https://exemple.fr", description: "Description assez longue pour passer le schéma, avec un lien.", category: "men", condition: "good" }) }));
    const provider = new OllamaProvider({ baseUrl: "http://o:11434", model: "m", timeoutMs: 500, contextLimit: 4096, maxOutputTokens: 700, fetchImpl: fetchImpl as unknown as typeof fetch });
    const strict = new AIService({ provider, concurrency: 1, maxPending: 5, circuitFailures: 3, circuitCooldownMs: 1000, timeoutMs: 1000, allowFallback: false });
    await expect(strict.generateListing("org", ctx)).rejects.toMatchObject({ code: "invalid_output" });
    const lenient = new AIService({ provider, concurrency: 1, maxPending: 5, circuitFailures: 3, circuitCooldownMs: 1000, timeoutMs: 1000, allowFallback: true });
    const res = await lenient.generateListing("org", ctx, { fallback: () => ({ title: "Pull", description: "Gabarit déterministe de secours.", brand: null, category: "other", size: null, condition: "good", colors: [], material: null, hashtags: [], confidence: 0.2 }) });
    expect(res.source).toBe("fallback");
  });

  it("lit le modèle de vision et l'en-tête de passerelle dans la configuration", () => {
    const cfg = loadAIConfig({ AI_PROVIDER: "ollama", OLLAMA_VISION_MODEL: "llama3.2-vision", OLLAMA_AUTH_HEADER: "Bearer x" });
    expect(cfg.OLLAMA_VISION_MODEL).toBe("llama3.2-vision");
    expect(cfg.OLLAMA_AUTH_HEADER).toBe("Bearer x");
    // Absent : modèle 1 par défaut ; explicitement vide : désactivé.
    expect(loadAIConfig({}).OLLAMA_VISION_MODEL).toBe("qwen3-vl:8b");
    expect(loadAIConfig({ OLLAMA_VISION_MODEL: "" }).OLLAMA_VISION_MODEL).toBeUndefined();
    expect(loadAIConfig({ OLLAMA_VISION_MODEL: "   " }).OLLAMA_VISION_MODEL).toBeUndefined();
  });
});

describe("trois modèles : configuration et routage", () => {
  it("applique les défauts des trois rôles et permet de désactiver un modèle secondaire", () => {
    const c = loadAIConfig({});
    expect(c.OLLAMA_MODEL).toBe("qwen2.5:7b-instruct");
    expect(c.OLLAMA_VISION_MODEL).toBe("qwen3-vl:8b");
    expect(c.OLLAMA_EMBED_MODEL).toBe("qwen3-embedding:0.6b");
    expect(loadAIConfig({ OLLAMA_EMBED_MODEL: " nomic-embed-text " }).OLLAMA_EMBED_MODEL).toBe("nomic-embed-text");
    expect(loadAIConfig({ OLLAMA_EMBED_MODEL: "" }).OLLAMA_EMBED_MODEL).toBeUndefined();
  });

  it("hasModel : nom exact, « :latest » sans étiquette, jamais une autre étiquette", () => {
    const installed = ["qwen3-vl:8b", "qwen3-embedding:latest", "qwen2.5:7b-instruct"];
    expect(hasModel(installed, "qwen3-vl:8b")).toBe(true);
    expect(hasModel(installed, "qwen3-embedding")).toBe(true);
    expect(hasModel(installed, "qwen3-embedding:0.6b")).toBe(false);
    expect(hasModel(installed, "qwen3-vl:4b")).toBe(false);
    expect(hasModel([], "qwen3-vl:8b")).toBe(false);
  });

  it("route les images vers le modèle 1, les embeddings vers le modèle 2, le reste vers le texte", async () => {
    const calls: { url: string; model: string }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push({ url: String(url), model: body.model });
      if (String(url).endsWith("/api/embed")) return jsonResponse({ model: body.model, embeddings: body.input.map(() => [0.1, 0.2]), prompt_eval_count: 4 });
      return jsonResponse({ response: "ok", model: body.model });
    }) as unknown as typeof fetch;
    const p = new OllamaProvider({ baseUrl: "http://o:11434", model: "ma-voix:8b", visionModel: "qwen3-vl:8b", embedModel: "qwen3-embedding:0.6b", timeoutMs: 500, contextLimit: 4096, maxOutputTokens: 100, fetchImpl });
    await p.generate({ system: "", prompt: "texte" });
    await p.generate({ system: "", prompt: "photo", images: ["YWJj"] });
    await p.embed(["Pull bleu"]);
    expect(calls).toEqual([
      { url: "http://o:11434/api/generate", model: "ma-voix:8b" },
      { url: "http://o:11434/api/generate", model: "qwen3-vl:8b" },
      { url: "http://o:11434/api/embed", model: "qwen3-embedding:0.6b" },
    ]);
  });
});

describe("santé à trois modèles", () => {
  const mk = (installed: string[], models: Partial<{ visionModel: string; embedModel: string }> = { visionModel: "qwen3-vl:8b", embedModel: "qwen3-embedding:0.6b" }) =>
    new OllamaProvider({ baseUrl: "http://o:11434", model: "ma-voix:8b", ...models, timeoutMs: 500, contextLimit: 4096, maxOutputTokens: 100, fetchImpl: (async () => jsonResponse({ models: installed.map((name) => ({ name })) })) as typeof fetch });

  it("liste les trois modèles attendus et leur présence", async () => {
    const h = await mk(["ma-voix:8b", "qwen3-vl:8b", "qwen3-embedding:0.6b", "autre:1b"]).health();
    expect(h.ok).toBe(true);
    expect(h.status).toBe("healthy");
    expect(h.details?.models).toEqual([
      { role: "text", name: "ma-voix:8b", present: true },
      { role: "vision", name: "qwen3-vl:8b", present: true },
      { role: "embed", name: "qwen3-embedding:0.6b", present: true },
    ]);
    expect(h.details?.missing).toEqual([]);
    expect(h.details?.installed).toContain("autre:1b");
  });

  it("est dégradé quand un modèle secondaire manque, et dit lequel", async () => {
    const h = await mk(["ma-voix:8b", "qwen3-vl:8b"]).health();
    expect(h.ok).toBe(false);
    expect(h.status).toBe("degraded");
    expect(h.details?.missing).toEqual(["qwen3-embedding:0.6b"]);
    expect(h.message).toMatch(/ollama pull qwen3-embedding:0\.6b/);
    expect(h.message).toMatch(/prix comparables/);
    const both = await mk(["ma-voix:8b"]).health();
    expect(both.status).toBe("degraded");
    expect(both.details?.missing).toEqual(["qwen3-vl:8b", "qwen3-embedding:0.6b"]);
    expect(both.message).toMatch(/photos ne seront pas lues/);
  });

  it("est indisponible quand le modèle de texte manque, même si les autres sont là", async () => {
    const h = await mk(["qwen3-vl:8b", "qwen3-embedding:0.6b"]).health();
    expect(h.status).toBe("unavailable");
    expect(h.details?.missing).toEqual(["ma-voix:8b"]);
    expect(h.details?.models?.[0]).toEqual({ role: "text", name: "ma-voix:8b", present: false });
  });

  it("n'attend que les modèles configurés", async () => {
    const h = await mk(["ma-voix:8b"], {}).health();
    expect(h.status).toBe("healthy");
    expect(h.details?.models?.map((m) => m.role)).toEqual(["text"]);
  });

  it("le simulateur annonce ses trois rôles présents", async () => {
    const h = await new MockAIProvider().health();
    expect(h.status).toBe("mock");
    expect(h.details?.models?.map((m) => m.role)).toEqual(["text", "vision", "embed"]);
    expect(h.details?.missing).toEqual([]);
  });
});

describe("embeddings (modèle 2)", () => {
  const base = { baseUrl: "http://ollama.local:11434", model: "ma-voix:8b", embedModel: "qwen3-embedding:0.6b", timeoutMs: 500, contextLimit: 4096, maxOutputTokens: 200 };

  it("Ollama : POST /api/embed { model, input } → number[][]", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("http://ollama.local:11434/api/embed");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({ model: "qwen3-embedding:0.6b", input: ["Pull Ralph Lauren M", "Jean Levi's 501"] });
      return jsonResponse({ model: "qwen3-embedding:0.6b", embeddings: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]], prompt_eval_count: 12 });
    }) as unknown as typeof fetch;
    const p = new OllamaProvider({ ...base, fetchImpl });
    const res = await p.embed(["Pull Ralph Lauren M", "Jean Levi's 501"]);
    expect(res.embeddings).toEqual([[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]);
    expect(res.dimensions).toBe(3);
    expect(res.usage).toEqual({ promptTokens: 12, outputTokens: 0 });
    expect(res.model).toBe("qwen3-embedding:0.6b");
    expect(res.provider).toBe("ollama");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("Ollama : modèle absent, erreur HTTP, réponse hors format, texte vide, délai", async () => {
    const p404 = new OllamaProvider({ ...base, fetchImpl: (async () => new Response(JSON.stringify({ error: "model 'qwen3-embedding:0.6b' not found" }), { status: 404 })) as typeof fetch });
    await expect(p404.embed(["a"])).rejects.toMatchObject({ code: "model_missing", retryable: false });
    await expect(p404.embed(["a"])).rejects.toThrow(/ollama pull qwen3-embedding:0\.6b/);
    const p500 = new OllamaProvider({ ...base, fetchImpl: (async () => new Response("boom", { status: 500 })) as typeof fetch });
    await expect(p500.embed(["a"])).rejects.toMatchObject({ code: "http", retryable: true });
    const pErr = new OllamaProvider({ ...base, fetchImpl: (async () => jsonResponse({ error: "out of memory" })) as typeof fetch });
    await expect(pErr.embed(["a"])).rejects.toMatchObject({ code: "http" });
    const pShort = new OllamaProvider({ ...base, fetchImpl: (async () => jsonResponse({ embeddings: [[0.1]] })) as typeof fetch });
    await expect(pShort.embed(["a", "b"])).rejects.toMatchObject({ code: "invalid_output" });
    const pNaN = new OllamaProvider({ ...base, fetchImpl: (async () => jsonResponse({ embeddings: [["x"]] })) as typeof fetch });
    await expect(pNaN.embed(["a"])).rejects.toMatchObject({ code: "invalid_output" });
    const fetchImpl = vi.fn();
    const pEmpty = new OllamaProvider({ ...base, fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(pEmpty.embed(["ok", "  "])).rejects.toMatchObject({ code: "config" });
    expect((await pEmpty.embed([])).embeddings).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    const hang = ((_: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))); })) as typeof fetch;
    const slow = new OllamaProvider({ ...base, timeoutMs: 30, fetchImpl: hang });
    await expect(slow.embed(["a"])).rejects.toMatchObject({ code: "timeout" });
  });

  it("Ollama : sans OLLAMA_EMBED_MODEL, erreur de configuration sans appel réseau", async () => {
    const fetchImpl = vi.fn();
    const p = new OllamaProvider({ ...base, embedModel: undefined, fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(p.embed(["a"])).rejects.toMatchObject({ code: "config" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("le simulateur produit des vecteurs déterministes de dimension 64, normalisés", async () => {
    const p = new MockAIProvider();
    const a = await p.embed(["Pull Ralph Lauren bleu marine M", "Jean Levi's 501 W32"]);
    const b = await p.embed(["Pull Ralph Lauren bleu marine M", "Jean Levi's 501 W32"]);
    expect(a.embeddings).toEqual(b.embeddings);
    expect(a.dimensions).toBe(MOCK_EMBED_DIMENSIONS);
    expect(a.embeddings).toHaveLength(2);
    for (const v of a.embeddings) {
      expect(v).toHaveLength(64);
      expect(Math.hypot(...v)).toBeCloseTo(1, 6);
    }
    expect(a.embeddings[0]).not.toEqual(a.embeddings[1]);
    expect(a.model).toBe("selio-mock-embed-v1");
    expect(mockEmbedding("Pull Ralph Lauren bleu marine M")).toEqual(a.embeddings[0]);
    expect(Math.hypot(...mockEmbedding("   "))).toBeCloseTo(1, 6);
  });

  it("le simulateur rapproche les textes qui partagent des mots (ventes comparables)", () => {
    const cos = (x: number[], y: number[]) => x.reduce((acc, v, i) => acc + v * y[i]!, 0);
    const ref = mockEmbedding("Pull Ralph Lauren bleu marine taille M");
    const proche = mockEmbedding("Pull Ralph Lauren bleu marine taille L");
    const loin = mockEmbedding("Baskets Nike Air Force 1 blanches 42");
    expect(cos(ref, proche)).toBeGreaterThan(cos(ref, loin));
    expect(cos(ref, proche)).toBeGreaterThan(0.5);
  });

  it("AIService.embed passe par la file, le disjoncteur et les métriques du rôle « embed »", async () => {
    const svc = new AIService({ provider: new MockAIProvider({ latencyMs: 5 }), concurrency: 1, maxPending: 5, circuitFailures: 2, circuitCooldownMs: 1000, timeoutMs: 1000, allowFallback: false });
    expect(svc.canEmbed).toBe(true);
    const res = await svc.embed("org", ["Pull bleu", "Jean brut"]);
    expect(res.embeddings).toHaveLength(2);
    expect(res.dimensions).toBe(64);
    const m = svc.metrics.snapshot();
    expect(m.requests).toBe(1);
    expect(m.successes).toBe(1);
    expect(m.byKind.embed).toMatchObject({ requests: 1, successes: 1, failures: 0 });
    // Latence simulée de 5 ms : on vérifie qu'elle est mesurée sous le rôle « embed » (arrondi d'horloge toléré).
    expect(m.byKind.embed!.p50LatencyMs).toBeGreaterThanOrEqual(1);
    expect(m.byKind.embed!.p95LatencyMs).toBeGreaterThanOrEqual(1);
    expect(m.byKind.embed!.totalLatencyMs).toBe(m.byKind.embed!.p50LatencyMs);
    expect((await svc.embed("org", [])).embeddings).toEqual([]);
    expect(svc.metrics.snapshot().requests).toBe(1);
  });

  it("AIService.embed : quota, disjoncteur et fournisseur sans embeddings", async () => {
    const quota = new AIService({ provider: new MockAIProvider(), concurrency: 1, maxPending: 5, circuitFailures: 2, circuitCooldownMs: 1000, timeoutMs: 100, allowFallback: false, quota: { check: async (_org, kind) => { if (kind === "embed") throw new AIError("quota_exceeded", "quota"); }, record: async () => {} } });
    await expect(quota.embed("org", ["a"])).rejects.toMatchObject({ code: "quota_exceeded" });
    const down = new AIService({ provider: new MockAIProvider({ failWith: new AIError("unavailable", "down", true) }), concurrency: 1, maxPending: 5, circuitFailures: 2, circuitCooldownMs: 1000, timeoutMs: 100, allowFallback: false });
    await expect(down.embed("org", ["a"])).rejects.toMatchObject({ code: "unavailable" });
    await expect(down.embed("org", ["a"])).rejects.toMatchObject({ code: "unavailable" });
    expect(down.breaker.state).toBe("open");
    await expect(down.embed("org", ["a"])).rejects.toMatchObject({ code: "circuit_open" });
    expect(down.metrics.snapshot().byKind.embed).toMatchObject({ requests: 3, failures: 3 });
    const inner = new MockAIProvider();
    const noEmbed: AIProvider = { name: inner.name, model: inner.model, health: () => inner.health(), generate: (r, o) => inner.generate(r, o), generateStructured: (r, o) => inner.generateStructured(r, o) };
    const svc = new AIService({ provider: noEmbed, concurrency: 1, maxPending: 5, circuitFailures: 2, circuitCooldownMs: 1000, timeoutMs: 100, allowFallback: false });
    expect(svc.canEmbed).toBe(false);
    await expect(svc.embed("org", ["a"])).rejects.toMatchObject({ code: "config" });
  });

  it("createAIService branche OLLAMA_EMBED_MODEL sur le provider Ollama", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("http://o:11434/api/embed");
      expect(JSON.parse(String(init?.body)).model).toBe("qwen3-embedding:0.6b");
      return jsonResponse({ embeddings: [[1, 0]] });
    }) as unknown as typeof fetch;
    const svc = createAIService({ env: { AI_PROVIDER: "ollama", OLLAMA_BASE_URL: "http://o:11434" }, allowFallback: false, fetchImpl });
    const res = await svc.embed("org", ["a"]);
    expect(res.embeddings).toEqual([[1, 0]]);
    expect((svc.provider as OllamaProvider).visionModel).toBe("qwen3-vl:8b");
  });
});
