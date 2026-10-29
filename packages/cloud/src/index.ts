/**
 * @selio/cloud — socle technique de Selio Cloud (sans base de données : tout
 * est injecté par l'appelant).
 *
 * - `types` : actions, niveaux (légère / lourde), issues d'exécution, fenêtre de connexion.
 * - `session` : filtrage vinted.* de l'état du navigateur, sérialisation (l'appelant chiffre).
 * - `guard` : détection des signaux de Vinted (CAPTCHA, trop de requêtes, blocage,
 *   avertissement, session expirée) pour s'arrêter, jamais pour contourner.
 * - `pacing` : rythme humain, heures actives, plafonds, décalage de démarrage.
 * - `runner/playwright` : exécution réelle (Chromium local, bac à sable actif,
 *   environnement minimal, contexte sans enregistrement sur le disque).
 * - `runner/probe` : vérification de démarrage (Chromium et son bac à sable).
 * - `runner/fake` : exécuteur factice pour les tests (aussi exporté par `@selio/cloud/fake`).
 * - `login-window` : fenêtre de connexion sécurisée (capture d'écran CDP, entrées relayées).
 */
export * from "./types";
export * from "./session";
export * from "./guard";
export * from "./pacing";
export * from "./config";
export * from "./slots";
export * from "./profile";
export * from "./errors";
export * from "./vinted";
export { LoginWindow, launchLoginWindow, loginPartsFromPlaywright, toCdpInput, SCREENCAST_QUALITY, MIN_FPS, MAX_FPS } from "./login-window";
export type { CdpLike, LoginPageLike, LoginContextLike, LoginWindowParts, LaunchLoginWindowOptions } from "./login-window";
export { readLiveDom, InvalidSelectorError, LiveDomIncompleteError } from "./runner/dom-bridge";
export type { DomHandle, LiveDomOptions } from "./runner/dom-bridge";
export { CHROMIUM_ARGS, CHROMIUM_ENV_ALLOWLIST, DEFAULT_VIEWPORT, chromiumEnv, contextOptions, launchOptions } from "./runner/launch";
export { PlaywrightRunner, blockAfterError, injectSession, readConversation, countSentCopies, playwrightHandle } from "./runner/playwright";
export type { BlockCheckPage, PlaywrightRunnerOptions } from "./runner/playwright";
export { probeChromium, SANDBOX_UNAVAILABLE_MESSAGE } from "./runner/probe";
export type { ChromiumProbeInput, ChromiumProbeResult } from "./runner/probe";
export { FakeRunner, FakeLoginWindow, fakeOutcome } from "./runner/fake";
export type { FakeRunCall, FakeRunnerOptions, FakeScenario, FakeScenarioName } from "./runner/fake";
