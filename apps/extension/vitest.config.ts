import { defineConfig } from "vitest/config";
export default defineConfig({ test: { name: "extension", globals: true, environment: "node", include: ["test/**/*.test.ts"],
  // Le panneau embarque tokens.css en texte (`?raw`) : Vitest doit le servir tel quel, comme Vite au build.
  css: { include: [/tokens\.css/] } } });
