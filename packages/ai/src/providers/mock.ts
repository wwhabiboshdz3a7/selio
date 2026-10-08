import { hashString, seededRandom } from "@selio/domain";
import { AIError, extractJson, type AIProvider, type GenerateOptions, type GenerateRequest, type GenerateResult, type HealthResult, type StructuredRequest, type StructuredResult } from "../types";

export interface MockOptions {
  /** Latence simulée (ms), déterministe. */
  latencyMs?: number;
  /** Force une erreur pour les tests (ex. "timeout"). */
  failWith?: AIError | null;
  /** Retourne une sortie volontairement invalide (tests de validation). */
  invalidOutput?: boolean;
}

/**
 * Provider déterministe : même requête → même sortie. Sert la démo (bandeau
 * « simulé ») et les tests. Il n'imite pas un vrai modèle : il applique des
 * gabarits français à partir des indices présents dans le prompt.
 */
export class MockAIProvider implements AIProvider {
  readonly name = "mock";
  readonly model = "selio-mock-v1";
  constructor(private readonly opts: MockOptions = {}) {}

  async health(): Promise<HealthResult> {
    return { ok: true, status: "mock", message: "Simulateur IA déterministe (aucun modèle réel)", latencyMs: 0, model: this.model, provider: this.name };
  }

  private async simulate(opts?: GenerateOptions): Promise<void> {
    if (this.opts.failWith) throw this.opts.failWith;
    const delay = this.opts.latencyMs ?? 0;
    if (delay > 0) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, delay);
        opts?.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new AIError("cancelled", "Requête annulée"));
        }, { once: true });
      });
    }
    if (opts?.signal?.aborted) throw new AIError("cancelled", "Requête annulée");
  }

  async generate(req: GenerateRequest, opts?: GenerateOptions): Promise<GenerateResult> {
    const started = Date.now();
    await this.simulate(opts);
    const text = this.render(req);
    return { text, usage: { promptTokens: estimateTokens(req.system + req.prompt), outputTokens: estimateTokens(text) }, latencyMs: Date.now() - started, model: this.model, provider: this.name };
  }

  async generateStructured<T>(req: StructuredRequest<T>, opts?: GenerateOptions): Promise<StructuredResult<T>> {
    const started = Date.now();
    await this.simulate(opts);
    const raw = this.opts.invalidOutput ? '{"reply": 42, "intent": "hack"}' : JSON.stringify(this.renderStructured(req));
    const json = extractJson(raw);
    const parsed = req.schema.safeParse(json ? JSON.parse(json) : null);
    if (!parsed.success) throw new AIError("invalid_output", `Sortie simulée invalide : ${parsed.error.issues.map((i) => i.message).join(", ")}`);
    return {
      data: parsed.data,
      raw,
      text: raw,
      usage: { promptTokens: estimateTokens(req.system + req.prompt), outputTokens: estimateTokens(raw) },
      latencyMs: Date.now() - started,
      model: this.model,
      provider: this.name,
    };
  }

  async *stream(req: GenerateRequest, opts?: GenerateOptions): AsyncIterable<string> {
    const { text } = await this.generate(req, opts);
    for (const word of text.split(/(\s+)/)) yield word;
  }

  private render(req: GenerateRequest): string {
    const hints = readHints(req.prompt);
    const rnd = seededRandom(hashString(req.prompt));
    const openers = ["Bonjour", "Hello", "Bonjour et merci pour votre message"];
    const opener = openers[Math.floor(rnd() * openers.length)]!;
    if (hints.kind === "listing_description") {
      return `${hints.title ?? "Article"} ${hints.brand ? `de la marque ${hints.brand}` : ""} en ${hints.condition ?? "bon état"}. Taille ${hints.size ?? "unique"}. Envoi rapide et soigné.`;
    }
    return `${opener}, ${hints.buyerName ?? ""}`.trim() + ". Oui, l'article est toujours disponible. N'hésitez pas si vous avez d'autres questions.";
  }

  private renderStructured(req: StructuredRequest<unknown>): unknown {
    const hints = readHints(req.prompt);
    if (req.schemaName === "listing_description") {
      return {
        title: `${hints.brand ? hints.brand + " " : ""}${hints.title ?? "Article"}`.slice(0, 120),
        description: `${hints.title ?? "Article"}${hints.brand ? ` ${hints.brand}` : ""}, ${hints.condition ?? "bon état"}${hints.size ? `, taille ${hints.size}` : ""}. Photos non retouchées, envoi soigné sous 48 h.`,
        hashtags: [hints.brand, hints.category].filter(Boolean).map((s) => `#${String(s).toLowerCase().replace(/\s+/g, "")}`),
      };
    }
    const decision = hints.decision ?? "answer";
    const name = hints.buyerName ? ` ${hints.buyerName}` : "";
    const price = hints.priceCents != null ? (hints.priceCents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" }) : null;
    const sig = hints.signature ? `\n${hints.signature}` : "";
    const map: Record<string, { reply: string; intent: string }> = {
      accept: { reply: `Bonjour${name}, c'est d'accord pour ${price ?? "ce prix"}. Je vous laisse faire l'offre sur l'annonce et j'accepte dès réception.${sig}`, intent: "accept_offer" },
      counter: { reply: `Bonjour${name}, merci pour votre proposition. Je peux descendre à ${price ?? "un prix intermédiaire"}, c'est mon meilleur prix compte tenu de l'état et du port. Si cela vous convient, faites l'offre à ce montant.${sig}`, intent: "counter_offer" },
      decline: { reply: `Bonjour${name}, merci pour l'intérêt. Je ne peux malheureusement pas descendre à ce prix. L'article reste disponible au prix affiché.${sig}`, intent: "decline_offer" },
      escalate: { reply: `Bonjour${name}, merci pour votre message. Je reviens vers vous très vite avec une réponse précise.${sig}`, intent: "escalate" },
      hold: { reply: `Bonjour${name}, merci pour votre message. Je vous réponds dès que possible.${sig}`, intent: "answer" },
      answer: { reply: `Bonjour${name}, oui l'article est toujours disponible. Les mesures et l'état sont décrits dans l'annonce, je peux ajouter des photos si besoin.${sig}`, intent: "answer" },
    };
    const chosen = map[decision] ?? map.answer!;
    return { reply: chosen.reply, intent: chosen.intent, proposedPriceCents: decision === "counter" || decision === "accept" ? (hints.priceCents ?? null) : null, confidence: 0.9, notes: "Sortie simulée (MockAIProvider)" };
  }
}

interface Hints {
  kind?: string;
  decision?: string;
  priceCents?: number;
  buyerName?: string;
  title?: string;
  brand?: string;
  size?: string;
  condition?: string;
  category?: string;
  signature?: string;
}

/** Lit les indices structurés que le constructeur de prompt insère (`[[clé: valeur]]`). */
function readHints(prompt: string): Hints {
  const out: Hints = {};
  for (const m of prompt.matchAll(/\[\[([a-zA-Z]+):\s*([^\]]*)\]\]/g)) {
    const key = m[1]!;
    const val = m[2]!.trim();
    if (key === "priceCents") out.priceCents = Number.parseInt(val, 10);
    else (out as Record<string, string>)[key] = val;
  }
  return out;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
