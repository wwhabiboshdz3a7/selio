import { describe, expect, it } from "vitest";
import {
  CLOUD_ACTION_KINDS, CLOUD_ACTION_LEVEL_BY_KIND, CLOUD_CONSENT_TEXT, CLOUD_CONSENT_VERSION, CLOUD_RULE_ACTIONS, CLOUD_SKIP_REASONS, CLOUD_SKIP_REASON_LABELS,
  CLOUD_RUN_CODES, CLOUD_RUN_CODE_LABELS, cloudAcceptConsentInput, cloudAccount, cloudActionDetail, cloudUpdateSettingsInput, filterVintedStorageState, isStorageStateEmpty,
  isVintedPauseReason,
} from "./cloud";
import { RUN_LOCATIONS, job } from "./automation";
import { connectionCreate } from "./connections";
import { VINTED_DOMAINS, isAntiBotCookie, isVintedHost, isVintedOrigin, normalizeVintedHost } from "./vinted-domains";

describe("Selio Cloud : contrats", () => {
  it("texte d'accord honnête : règles de Vinted, adresse partagée, pause, responsabilité, suppression, aucun mot de passe", () => {
    const lines = CLOUD_CONSENT_TEXT.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(8);
    expect(lines.length).toBeLessThanOrEqual(12);
    expect(CLOUD_CONSENT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    for (const needle of [/conditions d'utilisation de Vinted/, /adresse IP/, /mis en pause/, /responsable/, /supprimer à tout moment/, /mot de passe Vinted n'est jamais enregistré/, /ni affilié, ni approuvé, ni sponsorisé/, /90 jours/]) {
      expect(CLOUD_CONSENT_TEXT).toMatch(needle);
    }
    // Jamais de promesse impossible.
    expect(CLOUD_CONSENT_TEXT).not.toMatch(/100 % légal|sans risque|aucun risque/i);
  });

  it("accord : la case doit être cochée (accepted: true) et la version fournie", () => {
    expect(cloudAcceptConsentInput.safeParse({ version: CLOUD_CONSENT_VERSION, accepted: true }).success).toBe(true);
    expect(cloudAcceptConsentInput.safeParse({ version: CLOUD_CONSENT_VERSION, accepted: false }).success).toBe(false);
    expect(cloudAcceptConsentInput.safeParse({ version: CLOUD_CONSENT_VERSION }).success).toBe(false);
  });

  it("niveaux : répondre et relancer sont légers, republier et modifier en masse sont lourds", () => {
    expect(CLOUD_ACTION_KINDS.filter((k) => CLOUD_ACTION_LEVEL_BY_KIND[k] === "light")).toEqual(["reply", "follow_up"]);
    expect(CLOUD_ACTION_KINDS.filter((k) => CLOUD_ACTION_LEVEL_BY_KIND[k] === "heavy")).toEqual(["republish", "bulk_edit"]);
    // Les règles confiées au Cloud au lancement ne produisent que des actions légères.
    for (const kind of Object.values(CLOUD_RULE_ACTIONS)) expect(CLOUD_ACTION_LEVEL_BY_KIND[kind!]).toBe("light");
    expect(cloudUpdateSettingsInput.safeParse({ levels: [] }).success).toBe(false);
    expect(cloudUpdateSettingsInput.safeParse({ levels: ["light", "heavy"] }).success).toBe(true);
  });

  it("un compte Cloud ne porte jamais le contenu de la session", () => {
    const parsed = cloudAccount.parse({ id: "a", orgId: "o", connectionId: "c", createdAt: "2026-10-29T10:00:00.000Z", updatedAt: "2026-10-29T10:00:00.000Z", sessionCiphertext: "xx", session: { cookies: [] } });
    expect(parsed).not.toHaveProperty("sessionCiphertext");
    expect(parsed).not.toHaveProperty("session");
    expect(parsed).toMatchObject({ status: "needs_login", hasSession: false, warningsCount: 0, settings: { levels: ["light"] } });
  });

  it("détail du journal : clés fermées, aucun texte de message", () => {
    expect(cloudActionDetail.safeParse({ conversationRef: "123", messageLength: 42, code: "ok", durationMs: 1200 }).success).toBe(true);
    expect(cloudActionDetail.safeParse({ text: "Bonjour" }).success).toBe(false);
    expect(cloudActionDetail.safeParse({ cookies: [] }).success).toBe(false);
  });

  it("codes et raisons ont tous un libellé ; seules les pauses venues de Vinted exigent un acquittement", () => {
    for (const c of CLOUD_RUN_CODES) expect(CLOUD_RUN_CODE_LABELS[c]).toBeTruthy();
    for (const r of CLOUD_SKIP_REASONS) expect(CLOUD_SKIP_REASON_LABELS[r]).toBeTruthy();
    expect(["captcha", "warning", "blocked", "rate_limited"].every((r) => isVintedPauseReason(r))).toBe(true);
    expect(isVintedPauseReason("client")).toBe(false);
    expect(isVintedPauseReason(null)).toBe(false);
  });

  it("une tâche peut s'exécuter dans le Cloud", () => {
    expect(RUN_LOCATIONS).toContain("cloud");
    expect(job.shape.runsIn.parse("cloud")).toBe("cloud");
  });
});

describe("Selio Cloud : session limitée aux domaines vinted.*", () => {
  it("reconnaît les hôtes Vinted et refuse les imitations", () => {
    for (const h of ["vinted.fr", "www.vinted.fr", ".vinted.com", "api.vinted.be", "www.vinted.co.uk", "VINTED.DE"]) expect(isVintedHost(h), h).toBe(true);
    for (const h of ["notvinted.fr", "vinted.fr.evil.com", "evil.com", "vinted", "", "vinted.fr:443"]) expect(isVintedHost(h), h).toBe(false);
    expect(isVintedOrigin("https://www.vinted.fr")).toBe(true);
    expect(isVintedOrigin("http://www.vinted.fr")).toBe(false);
    expect(isVintedOrigin("pas une url")).toBe(false);
  });

  it("liste fermée : un domaine « vinted.<deux lettres> » qui n'appartient pas à Vinted est refusé", () => {
    for (const h of ["vinted.xyz", "vinted.lol", "x.vinted.lol", "www.vinted.top", "vinted.co.zz", "vinted.com.br", "a..vinted.fr", "-x.vinted.fr", "vinted.fr.", "127.0.0.1"]) expect(isVintedHost(h), h).toBe(false);
    for (const d of VINTED_DOMAINS) {
      expect(isVintedHost(d), d).toBe(true);
      expect(isVintedHost(`www.${d}`), d).toBe(true);
    }
    expect(isVintedOrigin("https://www.vinted.lol")).toBe(false);
    expect(isVintedOrigin("https://www.vinted.fr:8443")).toBe(false);
    expect(normalizeVintedHost(" WWW.Vinted.BE ")).toBe("www.vinted.be");
    expect(normalizeVintedHost("x.vinted.lol")).toBeNull();
    expect(normalizeVintedHost(42)).toBeNull();
  });

  it("une connexion ne peut pas régler un hôte libre pour les adresses du Cloud", () => {
    const base = { provider: "vinted", label: "Boutique" };
    expect(connectionCreate.safeParse({ ...base, config: { vintedHost: "x.vinted.lol" } }).success).toBe(false);
    expect(connectionCreate.safeParse({ ...base, config: { vintedHost: "127.0.0.1" } }).success).toBe(false);
    expect(connectionCreate.safeParse({ ...base, config: { vintedHost: 12 } }).success).toBe(false);
    expect(connectionCreate.safeParse({ ...base, config: { vintedHost: "www.vinted.de", displayHandle: "ma_boutique" } }).success).toBe(true);
    expect(connectionCreate.safeParse({ ...base, config: { displayHandle: "ma_boutique" } }).success).toBe(true);
  });

  it("cookies de passage anti-robot jamais gardés dans une session", () => {
    for (const n of ["datadome", "cf_clearance", "__cf_bm", "_cfuvid", "_abck", "bm_sz", "ak_bmsc", "reese84", "incap_ses_123_456", "visid_incap_42", "_px3", "_pxhd", "aws-waf-token", "__ddg1_"]) expect(isAntiBotCookie(n), n).toBe(true);
    for (const n of ["access_token_web", "refresh_token_web", "_vinted_fr_session", "anon_id", "v_udt"]) expect(isAntiBotCookie(n), n).toBe(false);
    const filtered = filterVintedStorageState({
      cookies: [
        { name: "access_token_web", value: "a", domain: ".vinted.fr" },
        { name: "datadome", value: "passage", domain: ".vinted.fr" },
        { name: "cf_clearance", value: "passage", domain: "www.vinted.fr" },
      ],
    });
    expect(filtered.cookies.map((c) => c.name)).toEqual(["access_token_web"]);
  });

  it("filtre cookies et stockage local : rien d'autre que vinted.*, champs inconnus retirés", () => {
    const raw = {
      cookies: [
        { name: "_vinted_fr_session", value: "s3cr3t", domain: ".vinted.fr", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax", partitionKey: "x" },
        { name: "NID", value: "google", domain: ".google.com", path: "/" },
        { name: "evil", value: "x", domain: "vinted.fr.evil.com", path: "/" },
      ],
      origins: [
        { origin: "https://www.vinted.fr", localStorage: [{ name: "k", value: "v" }] },
        { origin: "https://accounts.google.com", localStorage: [{ name: "token", value: "t" }] },
        { origin: "http://www.vinted.fr", localStorage: [{ name: "k", value: "v" }] },
      ],
      indexedDB: [{ name: "x" }],
    };
    const filtered = filterVintedStorageState(raw);
    expect(filtered.cookies.map((c) => c.name)).toEqual(["_vinted_fr_session"]);
    expect(filtered.cookies[0]).not.toHaveProperty("partitionKey");
    expect(filtered.origins.map((o) => o.origin)).toEqual(["https://www.vinted.fr"]);
    expect(filtered).not.toHaveProperty("indexedDB");
    expect(isStorageStateEmpty(filtered)).toBe(false);
  });

  it("entrée illisible : session vide, sans exception", () => {
    expect(filterVintedStorageState(null)).toEqual({ cookies: [], origins: [] });
    expect(filterVintedStorageState({ cookies: "nope" })).toEqual({ cookies: [], origins: [] });
    expect(isStorageStateEmpty(filterVintedStorageState(undefined))).toBe(true);
  });
});
