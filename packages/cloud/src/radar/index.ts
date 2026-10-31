/**
 * Selio Radar côté navigateur (sans base de données : le cœur décide, enregistre et prévient).
 *
 * - `types` : lecture d'une page (`PageFetcher.fetchPage`) et navigation d'achat (`PageOpener.openBrowsing`),
 *   implémentées par `PlaywrightRunner` et `FakeRunner`.
 * - `reader` : `RadarReader.readSearch` — page catalogue lue avec la session du compte Achat, signaux de Vinted.
 * - `metrics` : délais publication → détection → achat, taux de blocage pour 1 000 pages, ralentissement.
 * - `purchase` : `PurchaseRunner.buy` / `resume` — Radar Auto (essai à blanc par défaut, 3-D Secure attendu).
 * - `policy` : conduite imposée par un signal (pause du compte, alerte, mesure, coupe-circuit).
 * - `config` : RADAR_AUTO_ENABLED, CLOUD_3DS_TIMEOUT_MS, budgets.
 */
export * from "./types";
export * from "./urls";
export * from "./policy";
export * from "./config";
export * from "./metrics";
export * from "./reader";
export * from "./purchase";
