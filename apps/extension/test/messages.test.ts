import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isSupportedUrl, toBackground, toContent } from "../src/shared/messages";

describe("extension — contrat de messages et manifeste", () => {
  it("valide les messages et rejette les inconnus", () => {
    expect(toBackground.safeParse({ type: "status" }).success).toBe(true);
    expect(toBackground.safeParse({ type: "capture", item: { externalRef: "1", url: "https://www.vinted.fr/items/1", title: "x", brand: null, size: null, condition: null, priceCents: 100, description: "", photoUrls: [], sellerHandle: null }, adapterVersion: "v1", purchasePriceCents: null }).success).toBe(true);
    expect(toBackground.safeParse({ type: "capture", item: { title: "x" } }).success).toBe(false);
    expect(toBackground.safeParse({ type: "evil" }).success).toBe(false);
    expect(toBackground.safeParse({ type: "pair", apiBaseUrl: "javascript:alert(1)", token: "x".repeat(30) }).success).toBe(false);
    expect(toContent.safeParse({ type: "runDiagnostic" }).success).toBe(true);
  });
  it("ne reconnaît que les hôtes pris en charge", () => {
    expect(isSupportedUrl("https://www.vinted.fr/items/1")).toBe(true);
    expect(isSupportedUrl("https://vinted.fr.evil.example/items/1")).toBe(false);
    expect(isSupportedUrl(undefined)).toBe(false);
  });
  it("déclare des permissions minimales", () => {
    const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(["storage", "activeTab"]);
    expect(manifest.host_permissions).toEqual([]);
    expect(manifest.content_scripts[0].matches.every((m: string) => m.startsWith("https://www.vinted."))).toBe(true);
    expect(manifest.permissions).not.toContain("cookies");
    expect(manifest.permissions).not.toContain("tabs");
    expect(manifest.permissions).not.toContain("webRequest");
  });
});
