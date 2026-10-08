/**
 * Diagnostic IA : `pnpm ai:diagnose` (lit AI_PROVIDER, OLLAMA_BASE_URL, OLLAMA_MODEL…).
 * Code de sortie 0 si le provider répond et produit une sortie structurée valide.
 */
import { z } from "zod";
import { createProvider, loadAIConfig } from "../src/index";

async function main() {
  const config = loadAIConfig(process.env);
  console.info(`Provider : ${config.AI_PROVIDER}`);
  console.info(`Modèle   : ${config.OLLAMA_MODEL}`);
  console.info(`URL      : ${config.AI_PROVIDER === "ollama" ? config.OLLAMA_BASE_URL : "(simulateur)"}`);
  console.info(`Timeout  : ${config.AI_TIMEOUT_MS} ms · contexte ${config.AI_CONTEXT_LIMIT} · sortie max ${config.AI_MAX_OUTPUT_TOKENS}`);
  const provider = createProvider(config);
  const started = Date.now();
  const health = await provider.health();
  console.info(`Santé    : ${health.status} — ${health.message} (${health.latencyMs ?? "?"} ms)`);
  if (health.details?.models) console.info(`Modèles  : ${(health.details.models as string[]).join(", ") || "aucun"}`);
  if (!health.ok && health.status !== "mock") {
    console.error("Échec du diagnostic : provider indisponible ou modèle absent.");
    process.exit(2);
  }
  try {
    const res = await provider.generateStructured({
      system: "Réponds en JSON.",
      prompt: 'Renvoie {"ok": true, "lang": "fr"}. [[kind: health]]',
      schema: z.object({ ok: z.boolean().optional(), lang: z.string().optional() }).passthrough(),
      schemaName: "health",
      maxOutputTokens: 64,
    });
    console.info(`Génération structurée OK en ${res.latencyMs} ms (${res.usage.promptTokens}+${res.usage.outputTokens} tokens)`);
    console.info(`Durée totale : ${Date.now() - started} ms`);
    console.info("Remarque : cette mesure ne préjuge pas de la capacité sous charge ; voir docs/OLLAMA-SETUP.md.");
  } catch (err) {
    console.error("Génération structurée en échec :", err instanceof Error ? err.message : err);
    process.exit(3);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
