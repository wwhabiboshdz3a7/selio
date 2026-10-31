import { z } from "zod";

export const aiConfigSchema = z.object({
  AI_PROVIDER: z.enum(["mock", "ollama"]).default("mock"),
  OLLAMA_BASE_URL: z.string().url().default("http://127.0.0.1:11434"),
  /**
   * « Mon IA perso », la voix : modèle de texte (réponses aux acheteurs,
   * annonces, aide). Son nom est donné à part par Ibrahim ; la valeur par
   * défaut ne sert qu'au démarrage.
   */
  OLLAMA_MODEL: z.string().min(1).default("qwen2.5:7b-instruct"),
  /**
   * Modèle 1, « les photos » : modèle multimodal (Studio, lecture et contrôle
   * des photos). Absent de l'environnement : « qwen3-vl:8b ». Explicitement
   * vide : le générateur n'envoie que les indications textuelles au modèle
   * de texte, et l'écran le signale.
   */
  OLLAMA_VISION_MODEL: z.string().default("qwen3-vl:8b").transform((v) => (v.trim() ? v.trim() : undefined)),
  /**
   * Modèle 2, « les prix » : modèle d'embedding (vecteurs pour retrouver les
   * ventes comparables). Absent : « qwen3-embedding:0.6b ». Explicitement
   * vide : les embeddings sont désactivés (AIError « config »).
   */
  OLLAMA_EMBED_MODEL: z.string().default("qwen3-embedding:0.6b").transform((v) => (v.trim() ? v.trim() : undefined)),
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
