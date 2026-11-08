import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { ALLOWED_PERMISSIONS, CWS_LIMITS, createZip, crc32, inspectBundle, isPackable, storeManifest, validateManifest, type ChromeManifest } from "../scripts/pack-lib.mjs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const manifest = (): ChromeManifest => ({ ...JSON.parse(read("../manifest.json")), version: JSON.parse(read("../package.json")).version });

/** Relit une archive ZIP (répertoire central) et décompresse chaque entrée. */
function unzip(buf: Buffer): Map<string, Buffer> {
  const end = buf.length - 22;
  expect(buf.readUInt32LE(end)).toBe(0x06054b50);
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const comment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    expect(buf.readUInt32LE(local)).toBe(0x04034b50);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = inflateRawSync(buf.subarray(start, start + size));
    expect(crc32(data)).toBe(crc);
    out.set(name, data);
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

describe("extension — paquet Chrome Web Store", () => {
  it("le manifeste réel passe les contrôles de publication", () => {
    const store = storeManifest(manifest());
    const { errors } = validateManifest(store);
    expect(errors).toEqual([]);
    expect([...store.description].length).toBeLessThanOrEqual(CWS_LIMITS.descriptionMax);
    expect(store.name.length).toBeLessThanOrEqual(CWS_LIMITS.nameMax);
    expect(store.permissions).toEqual(ALLOWED_PERMISSIONS);
    expect(store.description).toContain("Indépendant de Vinted");
  });

  it("la version publiée ne garde que des origines HTTPS, et une seule avec EXTENSION_API_ORIGIN", () => {
    const base = manifest();
    expect(base.optional_host_permissions).toContain("http://127.0.0.1/*");
    const store = storeManifest(base);
    expect(store.optional_host_permissions).toEqual(["https://*/*"]);
    expect(validateManifest(store).warnings.join(" ")).toMatch(/EXTENSION_API_ORIGIN/);
    const pinned = storeManifest(base, { apiOrigin: "https://api.exemple.fr" });
    expect(pinned.optional_host_permissions).toEqual(["https://api.exemple.fr/*"]);
    expect(validateManifest(pinned).warnings).toEqual([]);
    expect(() => storeManifest(base, { apiOrigin: "http://api.exemple.fr" })).toThrow(/HTTPS/);
    expect(() => storeManifest(base, { apiOrigin: "https://api.exemple.fr/v1" })).toThrow(/sans chemin/);
    // Le manifeste d'origine n'est pas modifié.
    expect(base.optional_host_permissions).toContain("http://localhost/*");
    // Paquet de test seulement : les origines locales restent, et le contrôle les refuse.
    expect(validateManifest(storeManifest(base, { allowLocalApi: true })).errors.join(" ")).toMatch(/non chiffrée/);
  });

  it("refuse les permissions non justifiées, l'accès permanent aux sites et un texte trop long", () => {
    const m = storeManifest(manifest());
    expect(validateManifest({ ...m, permissions: [...(m.permissions ?? []), "cookies"] }).errors.join(" ")).toMatch(/non justifiée : cookies/);
    expect(validateManifest({ ...m, permissions: ["tabs"] }).errors.join(" ")).toMatch(/tabs/);
    expect(validateManifest({ ...m, host_permissions: ["https://*/*"] }).errors.join(" ")).toMatch(/host_permissions/);
    expect(validateManifest({ ...m, content_scripts: [{ matches: ["<all_urls>"], js: ["content.js"] }] }).errors.join(" ")).toMatch(/hors des pages Vinted/);
    expect(validateManifest({ ...m, description: "x".repeat(133) }).errors.join(" ")).toMatch(/trop longue/);
    expect(validateManifest({ ...m, version: "1.0.0-beta" }).errors.join(" ")).toMatch(/Version invalide/);
    expect(validateManifest({ ...m, content_security_policy: { extension_pages: "script-src 'self' https://cdn.exemple.fr" } }).errors.join(" ")).toMatch(/trop permissive/);
    expect(validateManifest({ ...m, optional_host_permissions: ["<all_urls>"] }).errors.join(" ")).toMatch(/trop large/);
    expect(validateManifest({ ...m, externally_connectable: { matches: ["https://*/*"] } }).errors.join(" ")).toMatch(/externally_connectable/);
  });

  it("chaque permission, domaine et autorisation facultative est justifié dans store/justifications.md", () => {
    const text = read("../store/justifications.md");
    const m = manifest();
    for (const p of m.permissions ?? []) expect(text, p).toContain(`\`${p}\``);
    for (const cs of m.content_scripts ?? []) for (const host of cs.matches ?? []) expect(text, host).toContain(`\`${host}\``);
    for (const o of storeManifest(m).optional_host_permissions ?? []) expect(text, o).toContain(`\`${o}\``);
    expect(text).toMatch(/## Code distant\s+Non\./);
  });

  it("la fiche reprend le titre et le résumé du manifeste, dans les limites", () => {
    const listing = read("../store/listing.md");
    const m = manifest();
    const section = (h: string) => new RegExp(`## ${h}\\n\\n([^\\n]+)`).exec(listing)?.[1];
    expect(section("Titre")).toBe(m.name);
    expect(section("Résumé")).toBe(m.description);
    expect(listing).toContain("Selio est indépendant de Vinted et n'est ni affilié, ni approuvé, ni sponsorisé par Vinted.");
    expect(listing).toMatch(/à valider par Ibrahim/);
  });

  it("exclut cartes de sources et fichiers cachés, refuse les scripts distants", () => {
    expect(isPackable("assets/popup-abc.js")).toBe(true);
    expect(isPackable("assets/popup-abc.js.map")).toBe(false);
    expect(isPackable(".DS_Store")).toBe(false);
    expect(isPackable("icons/.cache/x.png")).toBe(false);
    expect(inspectBundle([["popup.html", '<script src="https://cdn.exemple.fr/x.js"></script>']]).errors).toHaveLength(1);
    expect(inspectBundle([["background.js", 'importScripts("https://cdn.exemple.fr/x.js")']]).errors).toHaveLength(1);
    expect(inspectBundle([["assets/options.js", 'const d="http://127.0.0.1:8787"']]).warnings[0]).toMatch(/VITE_DEFAULT_API_BASE_URL/);
    expect(inspectBundle([["popup.html", '<script type="module" src="./assets/popup.js"></script>']])).toEqual({ errors: [], warnings: [] });
  });

  it("archive ZIP relisible, identique d'une fois sur l'autre, noms dangereux refusés", () => {
    const entries = [
      { name: "manifest.json", data: Buffer.from('{"manifest_version":3}') },
      { name: "icons/icon-128.png", data: Buffer.alloc(4096, 7) },
      { name: "assets/é.js", data: Buffer.from("console.log('é')") },
    ];
    const a = createZip(entries);
    const b = createZip([...entries].reverse());
    expect(a.equals(b)).toBe(true);
    const files = unzip(a);
    expect([...files.keys()]).toEqual(["assets/é.js", "icons/icon-128.png", "manifest.json"]);
    for (const e of entries) expect(files.get(e.name)!.equals(e.data)).toBe(true);
    expect(a.length).toBeLessThan(4096);
    expect(() => createZip([{ name: "../evil", data: Buffer.from("x") }])).toThrow();
    expect(() => createZip([{ name: "/abs", data: Buffer.from("x") }])).toThrow();
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
});
