import { defineConfig } from "vitest/config";
export default defineConfig({ test: { name: "api", globals: true, environment: "node", include: ["test/**/*.test.ts"], testTimeout: 60_000, fileParallelism: false } });
