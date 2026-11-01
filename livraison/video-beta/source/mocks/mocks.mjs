// Rend chaque maquette de mocks.html en image @3x (ecrans/page-<id>.png, 1179 px de large, comme les captures)
// et relève la position des éléments marqués data-box (mocks/boxes.json, px de capture, relatifs à la page).
//   node mocks/mocks.mjs
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const HERE = new URL(".", import.meta.url).pathname;
const ROOT = process.env.SELIO_ROOT || new URL("../../../../", import.meta.url).pathname;
const require = createRequire(`${ROOT}apps/web/package.json`);
const { chromium } = require("@playwright/test");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--allow-file-access-from-files"] });
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3 });
await page.goto(`file://${HERE}mocks.html`);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);
const boxes = {};
for (const id of await page.$$eval("section.page", (els) => els.map((e) => e.id))) {
  const sec = page.locator(`#${id}`);
  await sec.screenshot({ path: `${HERE}../ecrans/page-${id}.png` });
  boxes[id] = await page.evaluate((id) => {
    const sec = document.getElementById(id), top = sec.getBoundingClientRect().top + scrollY;
    const out = { _height: Math.round(sec.getBoundingClientRect().height * 3) };
    for (const el of sec.querySelectorAll("[data-box]")) { const b = el.getBoundingClientRect(); out[el.dataset.box] = [b.left, b.top + scrollY - top, b.right, b.bottom + scrollY - top].map((v) => Math.round(v * 3)); }
    return out;
  }, id);
  console.log(id, boxes[id]._height);
}
writeFileSync(`${HERE}boxes.json`, JSON.stringify(boxes, null, 1));
await browser.close();
