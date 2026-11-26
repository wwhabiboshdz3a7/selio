import { describe, expect, it } from "vitest";
import { allowedOrigins, loadEnv } from "../src/config";

// Deux sites web (public et Selio Admin) pour une même API : l'origine du site d'administration rejoint les origines autorisées.
const base = { DATABASE_URL: "postgres://x:y@127.0.0.1:5432/selio", SECRETS_ENCRYPTION_KEY: "a".repeat(44), NODE_ENV: "test", AI_PROVIDER: "mock" };

describe("origines autorisées : site public et site Selio Admin", () => {
  it("sans ADMIN_WEB_URL : CORS_ORIGINS seul (rien ne change pour l'existant)", () => {
    const env = loadEnv({ ...base, CORS_ORIGINS: "https://seliovprod.netlify.app" });
    expect(env.ADMIN_WEB_URL).toBeUndefined();
    expect(allowedOrigins(env)).toEqual(["https://seliovprod.netlify.app"]);
  });

  it("ADMIN_WEB_URL vide (ligne « ADMIN_WEB_URL= » du fichier .env) : ignorée", () => {
    expect(allowedOrigins(loadEnv({ ...base, CORS_ORIGINS: "https://seliovprod.netlify.app", ADMIN_WEB_URL: "" }))).toEqual(["https://seliovprod.netlify.app"]);
  });

  it("avec ADMIN_WEB_URL : son origine est ajoutée une seule fois, sans chemin", () => {
    const env = loadEnv({ ...base, CORS_ORIGINS: "https://seliovprod.netlify.app, ", ADMIN_WEB_URL: "https://selio-admin.netlify.app/admin" });
    expect(allowedOrigins(env)).toEqual(["https://seliovprod.netlify.app", "https://selio-admin.netlify.app"]);
    expect(allowedOrigins({ CORS_ORIGINS: "https://selio-admin.netlify.app", ADMIN_WEB_URL: "https://selio-admin.netlify.app" })).toEqual(["https://selio-admin.netlify.app"]);
  });

  it("ADMIN_WEB_URL invalide : configuration refusée au démarrage", () => {
    expect(() => loadEnv({ ...base, ADMIN_WEB_URL: "pas une adresse" })).toThrow(/ADMIN_WEB_URL/);
  });
});
