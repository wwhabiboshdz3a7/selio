import { defineConfig } from "vitest/config";
export default defineConfig({ test: { name: "core", globals: true, environment: "node", include: ["src/**/*.test.ts"], testTimeout: 30_000, fileParallelism: false } });
