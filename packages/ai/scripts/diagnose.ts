/**
 * Diagnostic IA : `pnpm ai:diagnose` (lit AI_PROVIDER, OLLAMA_BASE_URL, OLLAMA_MODEL,
 * OLLAMA_VISION_MODEL, OLLAMA_EMBED_MODEL…).
 * Vérifie la joignabilité, la présence des trois modèles, puis une génération
 * structurée (modèle de texte) et un embedding (modèle 2).
 * Codes de sortie : 0 OK, 2 provider injoignable ou modèle de texte absent,
 * 3 génération en échec, 4 embedding en échec. Un modèle secondaire absent
 * (vision, embed) est signalé mais n'interrompt pas le diagnostic.
 */
import { z } from "zod";
import { createProvider, loadAIConfig, type ExpectedModel } from "../src/index";

const ROLE_LABEL: Record<ExpectedModel["role"], string> = { text: "mon IA perso (texte)", vision: "modèle 1, les photos", embed: "modèle 2, les prix" };

async function main() {
  const config = loadAIConfig(process.env);
  console.info(`Provider : ${config.AI_PROVIDER}`);
  console.info(`URL      : ${config.AI_PROVIDER === "ollama" ? config.OLLAMA_BASE_URL : "(simulateur)"}`);
  console.info(`Texte    : ${config.OLLAMA_MODEL} (mon IA perso)`);
  console.info(`Photos   : ${config.OLLAMA_VISION_MODEL ?? "désactivé"} (modèle 1)`);
  console.info(`Prix     : ${config.OLLAMA_EMBED_MODEL ?? "désactivé"} (modèle 2, embeddings)`);
  console.info(`Timeout  : ${config.AI_TIMEOUT_MS} ms · contexte ${config.AI_CONTEXT_LIMIT} · sortie max ${config.AI_MAX_OUTPUT_TOKENS} · ${config.AI_MAX_CONCURRENCY} en parallèle`);
  const provider = createProvider(config);
  const started = Date.now();
  const health = await provider.health();
  console.info(`Santé    : ${health.status} — ${health.message} (${health.latencyMs ?? "?"} ms)`);
  for (const m of health.details?.models ?? []) console.info(`  ${m.present ? "présent" : "ABSENT "}  ${ROLE_LABEL[m.role]} : ${m.name}`);
  if (health.details?.installed) console.info(`Installés : ${health.details.installed.join(", ") || "aucun"}`);
  if (health.status === "unavailable" || health.status === "unconfigured") {
    console.error("Échec du diagnostic : provider injoignable ou modèle de texte absent.");
    process.exit(2);
  }
  if (health.status === "degraded") console.warn(`Attention : ${(health.details?.missing ?? []).map((m) => `ollama pull ${m}`).join(" ; ")}`);
  try {
    const res = await provider.generateStructured({
      system: "Réponds en JSON.",
      prompt: 'Renvoie {"ok": true, "lang": "fr"}. [[kind: health]]',
      schema: z.object({ ok: z.boolean().optional(), lang: z.string().optional() }).passthrough(),
      schemaName: "health",
      maxOutputTokens: 64,
    });
    console.info(`Génération structurée OK en ${res.latencyMs} ms (${res.usage.promptTokens}+${res.usage.outputTokens} tokens, ${res.model})`);
  } catch (err) {
    console.error("Génération structurée en échec :", err instanceof Error ? err.message : err);
    process.exit(3);
  }
  const embedPresent = (health.details?.models ?? []).some((m) => m.role === "embed" && m.present);
  if (provider.embed && (health.status === "mock" || embedPresent)) {
    try {
      const res = await provider.embed(["Pull Ralph Lauren bleu marine taille M", "Jean Levi's 501 W32"]);
      console.info(`Embedding OK en ${res.latencyMs} ms : ${res.embeddings.length} vecteurs de dimension ${res.dimensions} (${res.model})`);
    } catch (err) {
      console.error("Embedding en échec :", err instanceof Error ? err.message : err);
      process.exit(4);
    }
  } else {
    console.warn("Embedding non testé : modèle 2 absent ou désactivé (OLLAMA_EMBED_MODEL).");
  }
  console.info(`Durée totale : ${Date.now() - started} ms`);
  console.info("Remarque : cette mesure ne préjuge pas de la capacité sous charge ; voir docs/OLLAMA-SETUP.md et pnpm ai:bench.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
