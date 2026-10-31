// Copie le manifeste, les icônes et les locales dans dist/ et corrige les chemins HTML générés par Vite.
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dist = new URL("../dist/", import.meta.url).pathname;
mkdirSync(dist, { recursive: true });
cpSync(new URL("../public/", import.meta.url).pathname, dist, { recursive: true });
const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
manifest.version = pkg.version;
writeFileSync(join(dist, "manifest.json"), JSON.stringify(manifest, null, 2));
for (const f of ["popup.html", "options.html"]) {
  if (!existsSync(join(dist, f)) && existsSync(join(dist, "src", f))) renameSync(join(dist, "src", f), join(dist, f));
}
for (const f of ["popup.html", "options.html", "background.js", "content.js", "manifest.json", "icons/icon-128.png"]) {
  if (!existsSync(join(dist, f))) {
    console.error(`Fichier manquant dans dist : ${f}`);
    process.exit(1);
  }
}
console.info("Extension prête : apps/extension/dist (installation non empaquetée, voir docs/EXTENSION-INSTALL.md)");
