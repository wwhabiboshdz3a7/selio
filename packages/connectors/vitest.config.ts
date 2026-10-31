import { defineConfig } from "vitest/config";
export default defineConfig({ test: { name: "connectors", globals: true, environment: "node", include: ["src/**/*.test.ts"] } });
