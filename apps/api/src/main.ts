import { loadEnv } from "./config";
import { buildServer } from "./server";

async function main() {
  const env = loadEnv();
  const { app, services } = await buildServer(env);
  // Contrôle de santé IA au démarrage : informatif, jamais bloquant.
  services.ai.health().then((h) => app.log.info({ provider: h.provider, model: h.model, status: h.status }, `IA : ${h.message}`)).catch(() => {});
  await app.listen({ port: env.PORT, host: env.HOST });
  const shutdown = async (signal: string) => {
    app.log.info(`arrêt (${signal})`);
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
