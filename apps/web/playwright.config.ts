import { defineConfig, devices } from "@playwright/test";

/**
 * Tests end-to-end sur le site public (vitrine et application, cible « public ») en mode démonstration
 * (build sans API, aucun service externe). Selio Admin a son propre site : playwright.admin.config.ts.
 * Le navigateur Chromium pré-installé est utilisé via PLAYWRIGHT_BROWSERS_PATH ou
 * PLAYWRIGHT_CHROMIUM_PATH (chemin explicite de l'exécutable).
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  testDir: "./e2e",
  // Site Selio Admin : build séparé (cible « admin »), voir playwright.admin.config.ts.
  testIgnore: ["**/admin-site.spec.ts"],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } } },
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: "pnpm exec vite preview --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
