import { defineConfig } from "vitest/config";
export default defineConfig({ test: { name: "domain", globals: true, include: ["src/**/*.test.ts"] } });
