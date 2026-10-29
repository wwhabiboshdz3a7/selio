import { defineConfig } from "vitest/config";
// Les tests d'intégration (*.int.test.ts) ouvrent Chromium : ils se sautent eux-mêmes sans CLOUD_CHROMIUM_PATH.
export default defineConfig({ test: { name: "cloud", globals: true, environment: "node", include: ["src/**/*.test.ts"], testTimeout: 60_000, hookTimeout: 60_000 } });
