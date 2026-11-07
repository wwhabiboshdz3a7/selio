import { defineConfig } from "vitest/config";
// Aucune base, aucun réseau : simulateur IA (@selio/ai, provider « mock »), HTTP simulé et images factices
// (en-têtes seulement). Les rapports des tests sont écrits dans un dossier temporaire, jamais dans le dépôt.
export default defineConfig({ test: { name: "studio-eval", globals: true, environment: "node", include: ["src/**/*.test.ts"] } });
