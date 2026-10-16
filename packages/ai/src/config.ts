import { z } from "zod";

export const aiConfigSchema = z.object({
  AI_PROVIDER: z.enum(["mock", "ollama"]).default("mock"),
  OLLAMA_BASE_URL: z.string().url().default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().min(1).default("qwen2.5:7b-instruct"),
  /**
   * Modèle multimodal pour lire les photos (générateur d'annonces), ex.
   * « qwen2.5vl:7b » ou « llama3.2-vision ». Vide : le générateur n'envoie
   * que les indications textuelles au modèle principal.
   */
  OLLAMA_VISION_MODEL: z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined)),
  /** En-tête d'autorisation d'une passerelle placée devant Ollama (ex. « Bearer … »). */
  OLLAMA_AUTH_HEADER: z.string().optional().transform((v) => (v && v.trim() ? v.trim() : undefined)),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600_000).default(45_000),
  AI_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
  AI_CONTEXT_LIMIT: z.coerce.number().int().min(512).max(131_072).default(8192),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(32).max(8192).default(700),
  AI_QUEUE_MAX_PENDING: z.coerce.number().int().min(1).max(10_000).default(100),
  AI_CIRCUIT_FAILURES: z.coerce.number().int().min(1).max(100).default(3),
  AI_CIRCUIT_COOLDOWN_MS: z.coerce.number().int().min(1000).max(3_600_000).default(60_000),
  /** Jeton d'accès à l'endpoint de santé IA (protégé). */
  AI_HEALTH_TOKEN: z.string().min(16).optional(),
});
export type AIConfig = z.infer<typeof aiConfigSchema>;

export function loadAIConfig(env: Record<string, string | undefined> = process.env): AIConfig {
  const parsed = aiConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuration IA invalide : ${issues}`);
  }
  return parsed.data;
}
