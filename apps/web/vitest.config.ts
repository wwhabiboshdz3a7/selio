import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Tests : cible « public », démonstration disponible (comme un build sans API) ; voir vite.config.ts.
  define: { __SELIO_TARGET__: JSON.stringify("public"), __SELIO_DEMO__: "true" },
  test: { name: "web", globals: true, environment: "happy-dom", include: ["src/**/*.test.{ts,tsx}"], setupFiles: ["./src/test-setup.ts"] },
  esbuild: { jsx: "automatic" },
});
