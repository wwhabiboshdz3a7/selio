// Paquet Chrome Web Store : lit dist/ (construit juste avant par « pnpm build »), dérive le
// manifeste de publication, contrôle tout et écrit release/selio-extension-<version>.zip
// avec son empreinte SHA-256. Ne publie rien : l'envoi au Chrome Web Store est manuel
// (compte développeur à 5 $ à valider par Ibrahim, voir docs/WEB-STORE.md).
//
// Variables facultatives :
//   EXTENSION_API_ORIGIN=https://api.exemple.fr  restreint l'autorisation facultative à cette origine
//   EXTENSION_ALLOW_LOCAL_API=true               garde les origines http:// de développement (jamais pour la publication)
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createZip, inspectBundle, isPackable, storeManifest, validateManifest } from "./pack-lib.mjs";

const root = new URL("..", import.meta.url).pathname;
const dist = join(root, "dist");
const release = join(root, "release");
const store = join(root, "store");

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (!existsSync(join(dist, "manifest.json"))) fail("dist/manifest.json introuvable : lancez d'abord « pnpm build » (ou « pnpm extension:pack » à la racine).");

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const full = join(dir, name);
  return statSync(full).isDirectory() ? walk(full) : [relative(dist, full).split("\\").join("/")];
});

const files = walk(dist).filter(isPackable).sort();
const skipped = walk(dist).filter((f) => !isPackable(f));

const built = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
let manifest;
try {
  manifest = storeManifest(built, { apiOrigin: process.env.EXTENSION_API_ORIGIN ?? "", allowLocalApi: process.env.EXTENSION_ALLOW_LOCAL_API === "true" });
} catch (e) {
  fail(e.message);
}

const errors = [];
const warnings = [];
const checks = [validateManifest(manifest), inspectBundle(files.filter((f) => /\.(js|html)$/.test(f)).map((f) => [f, readFileSync(join(dist, f), "utf8")]))];
for (const c of checks) {
  errors.push(...c.errors);
  warnings.push(...c.warnings);
}
for (const icon of Object.values(manifest.icons ?? {})) if (!files.includes(icon)) errors.push(`Icône absente de dist : ${icon}`);
for (const f of ["listing.md", "justifications.md", "privacy-policy.md", "captures.md"]) if (!existsSync(join(store, f))) errors.push(`Fichier de fiche manquant : store/${f}`);
if (process.env.EXTENSION_ALLOW_LOCAL_API === "true") warnings.push("EXTENSION_ALLOW_LOCAL_API=true : paquet de test, à ne pas publier.");

for (const w of warnings) console.warn(`! ${w}`);
if (errors.length) fail(`Paquet refusé :\n  - ${errors.join("\n  - ")}`);

const entries = files.map((name) => ({ name, data: name === "manifest.json" ? Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) : readFileSync(join(dist, name)) }));
const zip = createZip(entries);
mkdirSync(release, { recursive: true });
const base = `selio-extension-${manifest.version}`;
const zipPath = join(release, `${base}.zip`);
writeFileSync(zipPath, zip);
const sha = createHash("sha256").update(zip).digest("hex");
writeFileSync(join(release, `${base}.zip.sha256`), `${sha}  ${base}.zip\n`);

console.info(`✓ ${relative(root, zipPath)} — ${files.length} fichiers, ${(zip.length / 1024).toFixed(1)} Ko, version ${manifest.version}`);
console.info(`  SHA-256 ${sha}`);
console.info(`  Permissions : ${(manifest.permissions ?? []).join(", ")} ; autorisation facultative : ${(manifest.optional_host_permissions ?? []).join(", ") || "aucune"}`);
if (skipped.length) console.info(`  Exclus du paquet : ${skipped.join(", ")}`);
console.info("  Rien n'est publié : envoi manuel sur le tableau de bord du Chrome Web Store (docs/WEB-STORE.md).");
