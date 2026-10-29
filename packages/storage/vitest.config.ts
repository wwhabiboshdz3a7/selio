import { defineConfig } from "vitest/config";
export default defineConfig({ test: { name: "storage", globals: true, include: ["src/**/*.test.ts"] } });
