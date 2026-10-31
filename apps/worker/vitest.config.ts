import { defineConfig } from "vitest/config";
export default defineConfig({ test: { name: "worker", globals: true, environment: "node", include: ["src/**/*.test.ts"], testTimeout: 60_000, fileParallelism: false } });
