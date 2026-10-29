import { defineConfig } from "vitest/config";
export default defineConfig({ test: { name: "email", globals: true, include: ["src/**/*.test.ts"] } });
