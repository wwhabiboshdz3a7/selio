// Build du site web pour Netlify (même netlify.toml pour les deux projets) : la cible vient de la variable
// VITE_APP_TARGET du projet Netlify.
//   - « public » (défaut) : vitrine et application des clients, puis l'extension Chrome en zip, servie par le
//     site lui-même (/extension/selio-extension.zip, voir extension-zip.mjs) ;
//   - « admin » : Selio Admin seul (site séparé, non indexé), sans extension.
// Usage : node apps/web/scripts/build-site.mjs (ou « pnpm build:site » à la racine).
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const target = (process.env.VITE_APP_TARGET ?? "").trim() || "public";
if (target !== "public" && target !== "admin") {
  console.error(`✗ VITE_APP_TARGET inconnu : « ${target} » (valeurs possibles : public, admin).`);
  process.exit(1);
}
const run = (cmd) => execSync(cmd, { cwd: root, stdio: "inherit", env: process.env });

console.info(`→ Site Selio, cible « ${target} »${process.env.VITE_API_BASE_URL ? `, API ${process.env.VITE_API_BASE_URL}` : ", sans API (démonstration)"}`);
run("pnpm --filter @selio/web build");
if (target === "public") run("node apps/web/scripts/extension-zip.mjs");
