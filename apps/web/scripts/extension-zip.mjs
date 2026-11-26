// Extension Chrome servie par le site public : construit apps/extension avec l'adresse de l'API de ce site
// pré-remplie dans ses options, puis écrit apps/web/dist/extension/selio-extension.zip (et sa fiche .json :
// version, taille, empreinte), à télécharger depuis l'application (Démarrage, Comptes Vinted). Rien n'est committé :
// le zip est refait à chaque build Netlify de la cible « public ». Sans dépendance : archive écrite par
// apps/extension/scripts/pack-lib.mjs (deflate de Node).
//
// Adresse de l'API : VITE_API_BASE_URL, sinon URL (adresse du site fournie par Netlify). À lancer APRÈS le build
// du site (Vite vide apps/web/dist).
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createZip, isPackable, storeManifest } from "../../extension/scripts/pack-lib.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const extDist = join(root, "apps/extension/dist");
const webDist = join(root, "apps/web/dist");
const out = join(webDist, "extension");

if (!existsSync(join(webDist, "index.html"))) {
  console.error("✗ apps/web/dist/index.html introuvable : construisez d'abord le site (pnpm build:web).");
  process.exit(1);
}

const apiBase = (process.env.VITE_API_BASE_URL || process.env.URL || "").trim().replace(/\/+$/, "");
execSync("pnpm --filter @selio/extension build", { cwd: root, stdio: "inherit", env: { ...process.env, ...(apiBase ? { VITE_DEFAULT_API_BASE_URL: apiBase } : {}) } });

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const full = join(dir, name);
  return statSync(full).isDirectory() ? walk(full) : [relative(extDist, full).split("\\").join("/")];
});
const files = walk(extDist).filter(isPackable).sort();
const built = JSON.parse(readFileSync(join(extDist, "manifest.json"), "utf8"));
// API en HTTPS : l'extension ne demande l'accès qu'à cette seule origine (les origines locales de développement sont retirées).
let manifest = built;
if (/^https:\/\//.test(apiBase)) manifest = storeManifest(built, { apiOrigin: new URL(apiBase).origin });

const zip = createZip(files.map((name) => ({ name, data: name === "manifest.json" ? Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) : readFileSync(join(extDist, name)) })));
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "selio-extension.zip"), zip);
const info = { name: "selio-extension.zip", version: manifest.version, bytes: zip.length, sha256: createHash("sha256").update(zip).digest("hex"), apiBaseUrl: apiBase || null, builtAt: new Date().toISOString() };
writeFileSync(join(out, "selio-extension.json"), `${JSON.stringify(info, null, 2)}\n`);
console.info(`✓ apps/web/dist/extension/selio-extension.zip — ${files.length} fichiers, ${(zip.length / 1024).toFixed(1)} Ko, version ${info.version}, API ${apiBase || "à saisir dans les options"}`);
