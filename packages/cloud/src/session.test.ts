import { describe, expect, it } from "vitest";
import { CloudSessionError, filterStorageState, isSessionEmpty, isVintedDomain, isVintedOrigin, parseSession, sessionBytes, sessionSummary } from "./session";
import { isAllowedLoginHost, isAllowedLoginNavigation, isAllowedLoginUrl, isLocalOrPrivateHost } from "./vinted";

const cookie = (domain: string, name = "c", value = "v") => ({ name, value, domain, path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" as const });

/** État « mélangé » tel que Playwright le rendrait après une navigation qui a touché d'autres sites. */
const mixed = {
  cookies: [
    cookie(".google.com", "NID", "google-secret"),
    cookie("accounts.google.com", "SID", "google-sid"),
    cookie(".vinted.fr", "access_token_web", "tok-fr"),
    cookie("www.vinted.fr", "_vinted_fr_session", "sess-fr"),
    cookie("vinted.com", "anon_id", "a1"),
    cookie(".vinted.co.uk", "uk", "u1"),
    cookie("localhost", "dev", "local"),
    cookie("127.0.0.1", "ip", "local-ip"),
    cookie("notvinted.fr", "trap", "x"),
    cookie("vinted.fr.evil.com", "trap2", "y"),
    { ...cookie(".facebook.com", "big"), value: "x".repeat(20_000) },
  ],
  origins: [
    { origin: "https://www.vinted.fr", localStorage: [{ name: "consent", value: "1" }] },
    { origin: "http://www.vinted.fr", localStorage: [{ name: "insecure", value: "1" }] },
    { origin: "https://accounts.google.com", localStorage: [{ name: "g", value: "secret" }] },
    { origin: "http://localhost:5173", localStorage: [{ name: "selio", value: "x" }] },
  ],
  // Champs étrangers au format : jamais recopiés.
  indexedDB: [{ name: "db" }],
};

describe("domaines Vinted", () => {
  it("reconnaît vinted.* et ses sous-domaines, refuse les imitations", () => {
    for (const d of ["vinted.fr", ".vinted.fr", "www.vinted.fr", "vinted.com", "www.vinted.be", ".vinted.co.uk", "api.vinted.lt"]) expect(isVintedDomain(d)).toBe(true);
    for (const d of ["notvinted.fr", "vinted.fr.evil.com", "vinted", "google.com", "localhost", "127.0.0.1", ""]) expect(isVintedDomain(d)).toBe(false);
  });

  it("liste fermée : vinted.lol, vinted.xyz ou x.vinted.top ne sont pas Vinted (ni session, ni fenêtre de connexion)", () => {
    for (const d of ["vinted.lol", "x.vinted.lol", "vinted.xyz", "www.vinted.top", "api.vinted.co.zz"]) {
      expect(isVintedDomain(d), d).toBe(false);
      expect(isAllowedLoginHost(d), d).toBe(false);
    }
    expect(filterStorageState({ cookies: [cookie(".vinted.lol", "access_token_web", "pris")], origins: [{ origin: "https://www.vinted.lol", localStorage: [{ name: "a", value: "b" }] }] })).toEqual({ cookies: [], origins: [] });
  });

  it("les cookies de passage anti-robot ne sont jamais gardés ni réinjectés", () => {
    const s = filterStorageState({ cookies: [cookie(".vinted.fr", "datadome", "passage"), cookie(".vinted.fr", "cf_clearance", "x"), cookie(".vinted.fr", "access_token_web", "tok")], origins: [] });
    expect(s.cookies.map((c) => c.name)).toEqual(["access_token_web"]);
    expect(JSON.stringify(parseSession(sessionBytes({ cookies: [cookie(".vinted.fr", "datadome", "passage")], origins: [] })))).not.toContain("passage");
  });

  it("n'accepte que les origines https de Vinted", () => {
    expect(isVintedOrigin("https://www.vinted.fr")).toBe(true);
    expect(isVintedOrigin("http://www.vinted.fr")).toBe(false);
    expect(isVintedOrigin("https://accounts.google.com")).toBe(false);
    expect(isVintedOrigin("pas une url")).toBe(false);
  });
});

describe("filterStorageState", () => {
  it("ne garde que les cookies et le stockage local vinted.* (google, localhost et imitations écartés)", () => {
    const s = filterStorageState(mixed);
    expect(s.cookies.map((c) => c.domain).sort()).toEqual([".vinted.co.uk", ".vinted.fr", "vinted.com", "www.vinted.fr"]);
    expect(s.origins).toEqual([{ origin: "https://www.vinted.fr", localStorage: [{ name: "consent", value: "1" }] }]);
    expect(Object.keys(s).sort()).toEqual(["cookies", "origins"]);
    const json = JSON.stringify(s);
    for (const leaked of ["google", "local-ip", '"dev"', "trap", "insecure", "selio", "indexedDB", "x".repeat(50)]) expect(json).not.toContain(leaked);
  });

  it("un cookie tiers mal formé n'efface pas les cookies Vinted", () => {
    const s = filterStorageState({ cookies: [{ domain: "x.com", name: "", value: 42 }, cookie(".vinted.fr", "ok", "1")], origins: [] });
    expect(s.cookies).toHaveLength(1);
  });

  it("rend un état vide pour une entrée absente ou illisible", () => {
    expect(filterStorageState(null)).toEqual({ cookies: [], origins: [] });
    expect(filterStorageState({ cookies: "nope" } as unknown as Record<string, unknown>)).toEqual({ cookies: [], origins: [] });
    expect(isSessionEmpty(filterStorageState(undefined))).toBe(true);
  });
});

describe("sérialisation", () => {
  it("sessionBytes / parseSession font l'aller-retour, filtré", () => {
    const bytes = sessionBytes(mixed as never);
    const back = parseSession(bytes);
    expect(back).toEqual(filterStorageState(mixed));
    expect(parseSession(bytes.toString("utf8"))).toEqual(back);
  });

  it("refuse un contenu illisible", () => {
    expect(() => parseSession("{pas du json")).toThrow(CloudSessionError);
    expect(() => parseSession(JSON.stringify({ cookies: [{ name: 1 }] }))).toThrow(CloudSessionError);
  });

  it("résume une session sans révéler aucune valeur", () => {
    const summary = sessionSummary({
      cookies: [{ ...cookie(".vinted.fr", "a", "SECRET1"), expires: 2_000_000_000 }, cookie("www.vinted.fr", "b", "SECRET2")],
      origins: [{ origin: "https://www.vinted.fr", localStorage: [{ name: "k", value: "SECRET3" }] }],
    });
    expect(summary).toMatchObject({ cookieCount: 2, domains: ["vinted.fr", "www.vinted.fr"], origins: ["https://www.vinted.fr"], empty: false });
    expect(summary.earliestExpiry?.toISOString()).toBe(new Date(2_000_000_000_000).toISOString());
    expect(JSON.stringify(summary)).not.toMatch(/SECRET/);
  });
});

describe("fenêtre de connexion : adresses autorisées", () => {
  it("cadre principal : https seulement, Vinted ou fournisseur de connexion, port par défaut", () => {
    expect(isAllowedLoginUrl("https://www.vinted.fr/member/login")).toBe(true);
    expect(isAllowedLoginUrl("https://accounts.google.com/o/oauth2")).toBe(true);
    expect(isAllowedLoginUrl("http://www.vinted.fr/member/login")).toBe(false);
    expect(isAllowedLoginUrl("https://www.vinted.fr:8443/")).toBe(false);
    expect(isAllowedLoginUrl("https://user:pass@www.vinted.fr/")).toBe(false);
    expect(isAllowedLoginUrl("https://127.0.0.1/")).toBe(false);
    expect(isAllowedLoginUrl("https://www.vinted.lol/")).toBe(false);
    expect(isAllowedLoginUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedLoginUrl("pas une url")).toBe(false);
    expect(isAllowedLoginNavigation("about:blank")).toBe(true);
    expect(isAllowedLoginNavigation("chrome-error://chromewebdata/")).toBe(true);
    expect(isAllowedLoginNavigation("http://10.0.0.1/admin")).toBe(false);
  });

  it("hôtes locaux et privés toujours refusés", () => {
    for (const h of ["localhost", "a.localhost", "127.0.0.1", "127.1.2.3", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.100.1.1", "0.0.0.0", "[::1]", "::1", "fd12:3456::1", "fe80::1", "::ffff:127.0.0.1", "nas.local", "router.internal", ""]) expect(isLocalOrPrivateHost(h), h).toBe(true);
    for (const h of ["www.vinted.fr", "8.8.8.8", "172.32.0.1", "accounts.google.com", "2001:4860::8888"]) expect(isLocalOrPrivateHost(h), h).toBe(false);
  });
});
