// Imprime un document HTML de livraison en PDF A4 (Chromium de Playwright), avec la police Inter du dépôt.
//   node livraison/sources/pdf.mjs livraison/sources/<doc>.html livraison/<doc>.pdf
//   node livraison/sources/pdf.mjs docs/<doc>.md livraison/<doc>.pdf "Titre de la couverture"   (Markdown : couverture ajoutée)
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markdownToHtml } from "./md.mjs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const require = createRequire(`${ROOT}/apps/web/package.json`);
const { chromium } = require("@playwright/test");
const FONT = dirname(require.resolve("@fontsource/inter/package.json")) + "/files";
const [srcArg, out, coverTitle] = process.argv.slice(2);
let src = srcArg;
if (srcArg?.endsWith(".md")) {
  // Markdown : premier titre et première ligne en italique → couverture ; le reste → corps du document.
  const md = readFileSync(srcArg, "utf8");
  const title = coverTitle || (md.match(/^#\s+(.+)$/m)?.[1] ?? "Selio");
  const sub = md.match(/^_(.+)_\s*$/m)?.[1] ?? "";
  const body = md.replace(/^#\s+.+$/m, "").replace(/^_(.+)_\s*$/m, "");
  const logo = `${ROOT}/brand/selio-logo-blanc.png`;
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${title}</title><link rel="stylesheet" href="file://${ROOT}/livraison/sources/style.css"></head><body>
<section class="cover"><div class="logo"><img src="file://${logo}" alt="Selio"></div><div class="eyebrow">Document de mise en service · ${new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</div><h1>${title}</h1><p class="lead">${sub}</p><div class="foot">Selio · ${srcArg.split("/").pop()}</div></section>
<main>${markdownToHtml(body)}</main></body></html>`;
  src = join(mkdtempSync(join(tmpdir(), "selio-pdf-")), "doc.html");
  writeFileSync(src, html);
}
if (!src || !out) { console.error("Usage : node livraison/sources/pdf.mjs <entrée.html> <sortie.pdf>"); process.exit(1); }

const faces = [400, 500, 600].map((w) => `@font-face{font-family:Inter;font-weight:${w};src:url("file://${FONT}/inter-latin-${w}-normal.woff2")}`).join("");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
await page.goto(pathToFileURL(resolve(src)).href);
await page.addStyleTag({ content: faces });
await page.evaluate(() => document.fonts.ready);
const title = await page.title();
await page.pdf({
  path: out, format: "A4", printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate: `<div style="width:100%;font:7pt Inter,sans-serif;color:#A3A0AE;padding:0 15mm;display:flex;justify-content:space-between"><span>${title.replace(/</g, "&lt;")}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
});
await browser.close();
console.log(`${out} écrit (${(readFileSync(out).length / 1024).toFixed(0)} Ko)`);
