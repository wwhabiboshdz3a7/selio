import { defineConfig } from "vitest/config";
export default defineConfig({ test: { name: "extension", globals: true, environment: "node", include: ["test/**/*.test.ts"] } });
