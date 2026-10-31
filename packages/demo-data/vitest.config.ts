import { defineConfig } from "vitest/config";
export default defineConfig({ test: { name: "demo-data", globals: true, environment: "node", include: ["src/**/*.test.ts"] } });
