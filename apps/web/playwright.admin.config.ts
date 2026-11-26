import { defineConfig, devices } from "@playwright/test";

/**
 * Tests end-to-end du site Selio Admin (build VITE_APP_TARGET=admin, ici « vite build --mode admin »), en mode
 * démonstration (build sans API, aucun service externe) : connexion sobre « Selio Admin », puis /admin et ses pages.
 * Lancement : pnpm --filter @selio/web test:e2e:admin (construit apps/web/dist-admin puis le sert sur le port 4175).
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const port = Number(process.env.E2E_ADMIN_PORT ?? 4175);

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["**/admin-site.spec.ts"],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-admin" }]],
  use: {
    baseURL: process.env.E2E_ADMIN_BASE_URL ?? `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: `pnpm exec vite preview --outDir dist-admin --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
