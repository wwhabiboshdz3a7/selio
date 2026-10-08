import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { name: "web", globals: true, environment: "happy-dom", include: ["src/**/*.test.{ts,tsx}"] },
  esbuild: { jsx: "automatic" },
});
