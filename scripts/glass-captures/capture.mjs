#!/usr/bin/env node
/**
 * Essai « verre liquide » (§6) : captures avant / après et mesure de fluidité au défilement.
 *
 * Ce que fait le script :
 *  1. construit l'application web en mode démo avec VITE_EXPERIMENT_GLASS=true (dossier temporaire,
 *     apps/web/dist n'est pas touché), puis la sert en local (vite preview, 127.0.0.1) ;
 *  2. ouvre la démonstration dans Chromium (Playwright, /opt/pw-browsers/chromium par défaut) avec deux
 *     appareils ÉMULÉS : un iPhone 15 (393 × 852, densité 3) et un Android (412 × 915, densité 2,625) ;
 *  3. capture « avant » (essai désactivé) et « après » (essai activé), en clair et en sombre : la vue
 *     d'ensemble (dock au-dessus du contenu) et le Radar (carte d'alerte) ;
 *  4. mesure la fluidité : défilement scripté de 3 s sur la liste des articles, compteur
 *     requestAnimationFrame → images par seconde et pourcentage d'images > 32 ms, pour QUATRE états :
 *     sans dock, dock opaque (même DOM fixe, sans flou), verre sans réfraction ni animation du reflet, verre
 *     complet. Un passage de chauffe est fait et ignoré, puis l'ordre des états alterne d'un passage à
 *     l'autre (ABCD, DCBA…) pour ne pas imputer un effet de démarrage à un état ;
 *     le coût du verre se lit sur l'écart « dock opaque → verre », pas « sans dock → verre » ;
 *  5. écrit livraison/liquid-glass/ : captures PNG, mesures.json et RAPPORT.md (généré).
 *
 * Limites, dites dans le rapport : Chromium headless sur un serveur (sans carte graphique, rendu
 * logiciel), pas un téléphone ; le vrai Safari iOS (WebKit, -webkit-backdrop-filter) est à vérifier sur
 * un iPhone. Pour le profil iPhone, la réfraction des bords (filtre SVG, Chromium seulement) est coupée,
 * captures comprises, pour approcher le rendu de WebKit qui ne l'aura jamais. Aucun service externe, aucune donnée réelle : la démonstration tourne en local.
 *
 * Usage (à la racine du dépôt) :
 *   node scripts/glass-captures/capture.mjs [--skip-build] [--runs=3] [--out=livraison/liquid-glass]
 * Variables : PLAYWRIGHT_CHROMIUM_PATH (exécutable Chromium), GLASS_CAPTURE_PORT (4317 par défaut).
 */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WEB = join(ROOT, "apps/web");
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, "").split("=");
  return [k, v ?? "true"];
}));
const OUT = resolve(ROOT, args.out ?? "livraison/liquid-glass");
const RUNS = Math.max(1, Number(args.runs ?? 3));
const PORT = Number(process.env.GLASS_CAPTURE_PORT ?? 4317);
const BASE = `http://127.0.0.1:${PORT}`;
const BUILD_DIR = join(tmpdir(), "selio-glass-build");
const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";
/** Utilisateur de la démonstration (packages/demo-data) : clé du réglage « verre liquide ». */
const DEMO_USER_ID = "user-demo";
const GLASS_KEY = `selio.glass.${DEMO_USER_ID}`;
const SCROLL_MS = 3000;

const DEVICES = [
  {
    id: "iphone-15",
    label: "iPhone 15 (émulé dans Chromium)",
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    /** WebKit n'a pas la réfraction (filtre SVG dans backdrop-filter) : coupée pour approcher Safari. */
    noRefraction: true,
  },
  {
    id: "android",
    label: "Android 412 × 915 (émulé dans Chromium)",
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  },
];
const THEMES = ["light", "dark"];
/** Captures : avant (essai désactivé) et après (essai activé). */
const STATES = [{ id: "avant", glass: "off" }, { id: "apres", glass: "on" }];
/**
 * Fluidité : quatre états, pour attribuer le coût. « dock-opaque » garde le dock (même DOM fixe, même
 * défilement réservé) mais sans flou, reflet ni réfraction ; « verre-simple » ajoute le flou et le liseré,
 * sans réfraction ni animation du reflet ; « verre-complet » est l'essai tel quel.
 */
const FLUID_STATES = [
  { id: "sans-dock", label: "sans dock", glass: "off", variant: null },
  { id: "dock-opaque", label: "dock opaque", glass: "on", variant: "opaque" },
  { id: "verre-simple", label: "verre sans réfraction ni animation", glass: "on", variant: "simple" },
  { id: "verre-complet", label: "verre complet", glass: "on", variant: null },
];

/** Feuille injectée pour un état de mesure (et, pour le profil iPhone, réfraction coupée comme sur WebKit). */
function variantCss(variant, device) {
  const rules = [];
  if (variant === "opaque") {
    rules.push('.glass-surface[data-glass="glass"]::before { background-color: var(--_glass-surface) !important; -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }');
    rules.push('.glass-surface[data-glass="glass"]::after { content: none !important; }');
    rules.push('.glass-surface[data-glass="glass"] > .glass-surface__content { background-color: transparent !important; }');
  }
  if (variant === "opaque" || variant === "simple" || device.noRefraction) rules.push(".glass-surface__rim { display: none !important; }");
  if (variant === "opaque" || variant === "simple") rules.push('.glass-surface[data-glass="glass"]::after { animation: none !important; }');
  return rules.join("\n");
}

function log(msg) {
  process.stdout.write(`[verre] ${msg}\n`);
}

function build() {
  log("construction du site en mode démo, VITE_EXPERIMENT_GLASS=true…");
  rmSync(BUILD_DIR, { recursive: true, force: true });
  const r = spawnSync("pnpm", ["exec", "vite", "build", "--outDir", BUILD_DIR, "--emptyOutDir"], {
    cwd: WEB,
    env: { ...process.env, VITE_EXPERIMENT_GLASS: "true", VITE_API_BASE_URL: "" },
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (r.status !== 0) throw new Error(`échec de la construction (code ${r.status})`);
}

async function startPreview() {
  const child = spawn("pnpm", ["exec", "vite", "preview", "--outDir", BUILD_DIR, "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
    cwd: WEB,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return child;
    } catch {
      // pas encore prêt
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  child.kill();
  throw new Error(`le serveur local ne répond pas sur ${BASE}`);
}

/** Ouvre la démo dans un contexte neuf, règle l'essai, recharge. `variant` : feuille de mesure injectée. */
async function openDemo(browser, device, theme, glass, variant = null) {
  const context = await browser.newContext({
    viewport: device.viewport,
    deviceScaleFactor: device.deviceScaleFactor,
    isMobile: true,
    hasTouch: true,
    userAgent: device.userAgent,
    colorScheme: theme,
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    // Pas de service worker : chaque mesure part de la même page servie.
    serviceWorkers: "block",
  });
  const css = variantCss(variant, device);
  if (css) {
    // Injectée à chaque document (navigations comprises), avant le premier rendu.
    await context.addInitScript((text) => {
      const add = () => { const st = document.createElement("style"); st.dataset.mesure = "verre"; st.textContent = text; document.documentElement.appendChild(st); };
      if (document.documentElement) add(); else document.addEventListener("DOMContentLoaded", add, { once: true });
    }, css);
  }
  const page = await context.newPage();
  await page.goto(`${BASE}/demo?vers=/app`);
  await page.waitForURL((u) => u.pathname === "/app", { timeout: 30_000 });
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [GLASS_KEY, glass]);
  await page.reload();
  await page.waitForLoadState("networkidle");
  return { context, page };
}

async function settle(page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(400);
}

/** État du dock et de la carte d'alerte (mode verre ou opaque, flou, réfraction, sous-couche). */
async function surfaceInfo(page) {
  return page.evaluate(() => {
    const read = (el) => {
      if (!el) return null;
      const before = getComputedStyle(el, "::before");
      const box = el.getBoundingClientRect();
      const rim = el.querySelector(":scope > .glass-surface__rim");
      return {
        mode: el.getAttribute("data-glass"),
        // Réfraction réellement rendue (anneau affiché), et non la seule capacité détectée par le composant.
        refraction: rim && getComputedStyle(rim).display !== "none" ? "affichée" : "non",
        motion: el.getAttribute("data-glass-motion"),
        fallback: el.getAttribute("data-glass-fallback"),
        backdropFilter: before.backdropFilter || before.webkitBackdropFilter || "none",
        height: Math.round(box.height),
        bottomGap: Math.round(window.innerHeight - box.bottom),
      };
    };
    return { dock: read(document.querySelector('[data-testid="mobile-dock"]')), alertCard: read(document.querySelector('[data-testid="radar-alert-card"]')) };
  });
}

async function captures(browser) {
  const shots = [];
  const surfaces = {};
  for (const device of DEVICES) {
    for (const theme of THEMES) {
      for (const state of STATES) {
        const { context, page } = await openDemo(browser, device, theme, state.glass);
        // Vue d'ensemble, défilée pour que du contenu passe sous le dock.
        await settle(page);
        await page.evaluate(() => window.scrollTo(0, Math.min(520, document.documentElement.scrollHeight)));
        await page.waitForTimeout(300);
        const overview = `${device.id}-${theme}-${state.id}-vue-ensemble.png`;
        await page.screenshot({ path: join(OUT, overview) });
        shots.push({ file: overview, device: device.id, theme, state: state.id, page: "/app" });
        if (state.id === "apres") surfaces[`${device.id}-${theme}`] = { overview: await surfaceInfo(page) };
        // Radar : la carte d'alerte d'une bonne affaire.
        await page.goto(`${BASE}/app/radar`);
        await settle(page);
        const card = page.locator('section[aria-label="Affaires repérées"] .card, [data-testid="radar-alert-card"]').first();
        if (await card.count()) await card.scrollIntoViewIfNeeded();
        await page.evaluate(() => window.scrollBy(0, -80));
        await page.waitForTimeout(300);
        const radar = `${device.id}-${theme}-${state.id}-radar.png`;
        await page.screenshot({ path: join(OUT, radar) });
        shots.push({ file: radar, device: device.id, theme, state: state.id, page: "/app/radar" });
        if (state.id === "apres") surfaces[`${device.id}-${theme}`].radar = await surfaceInfo(page);
        await context.close();
        log(`captures ${device.id} · ${theme} · ${state.id}`);
      }
    }
  }
  return { shots, surfaces };
}

/** Défilement scripté (aller-retour, 3 s) avec un compteur requestAnimationFrame. */
async function scrollRun(page) {
  return page.evaluate(async (durationMs) => {
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo(0, 0);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const deltas = [];
    return new Promise((resolve) => {
      const start = performance.now();
      let last = start;
      const step = (now) => {
        deltas.push(now - last);
        last = now;
        const t = Math.min(1, (now - start) / durationMs);
        // Aller puis retour, vitesse douce (comme un doigt qui lance la page).
        window.scrollTo(0, max * (0.5 - 0.5 * Math.cos(2 * Math.PI * t)));
        if (now - start < durationMs) requestAnimationFrame(step);
        else resolve({ deltas: deltas.slice(1), scrollable: max });
      };
      requestAnimationFrame(step);
    });
  }, SCROLL_MS);
}

function summarize(deltas) {
  const total = deltas.reduce((a, b) => a + b, 0);
  const sorted = [...deltas].sort((a, b) => a - b);
  const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return {
    frames: deltas.length,
    durationMs: Math.round(total),
    fps: total > 0 ? Math.round((deltas.length / (total / 1000)) * 10) / 10 : 0,
    slowFramesPercent: deltas.length ? Math.round((deltas.filter((d) => d > 32).length / deltas.length) * 1000) / 10 : 0,
    p95FrameMs: Math.round(p(0.95) * 10) / 10,
    maxFrameMs: Math.round((sorted.at(-1) ?? 0) * 10) / 10,
  };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : Math.round(((s[s.length / 2 - 1] + s[s.length / 2]) / 2) * 10) / 10) : 0;
};

/**
 * Fluidité : pour chaque appareil, une page par état (contextes ouverts une fois), un passage de chauffe
 * ignoré sur chacune, puis RUNS passages en alternant l'ordre des états (ABCD, DCBA, ABCD…).
 */
async function fluidity(browser, mode) {
  const results = [];
  for (const device of DEVICES) {
    const pages = [];
    for (const state of FLUID_STATES) {
      const { context, page } = await openDemo(browser, device, "light", state.glass, state.variant);
      await page.goto(`${BASE}/app/items`);
      await settle(page);
      const dockPresent = (await page.locator('[data-testid="mobile-dock"]').count()) > 0;
      const refraction = await page.evaluate(() => {
        const rim = document.querySelector(".glass-surface__rim");
        return rim ? getComputedStyle(rim).display !== "none" : false;
      });
      pages.push({ state, context, page, dockPresent, refraction, runs: [] });
    }
    try {
      // Chauffe : un passage par état, ignoré (compilation, caches, premières peintures).
      for (const p of pages) await scrollRun(p.page);
      for (let i = 0; i < RUNS; i++) {
        const order = i % 2 === 0 ? pages : [...pages].reverse();
        for (const p of order) {
          const r = await scrollRun(p.page);
          p.runs.push({ ...summarize(r.deltas), scrollablePx: Math.round(r.scrollable), order: order.indexOf(p) });
          await p.page.waitForTimeout(250);
        }
      }
    } finally {
      for (const p of pages) await p.context.close();
    }
    for (const p of pages) {
      results.push({
        mode,
        device: device.id,
        state: p.state.id,
        label: p.state.label,
        dock: p.dockPresent ? "présent" : "absent",
        refraction: p.refraction,
        runs: p.runs,
        median: { fps: median(p.runs.map((r) => r.fps)), slowFramesPercent: median(p.runs.map((r) => r.slowFramesPercent)), p95FrameMs: median(p.runs.map((r) => r.p95FrameMs)) },
      });
      log(`fluidité (${mode}) ${device.id} · ${p.state.label} : ${results.at(-1).median.fps} i/s, ${results.at(-1).median.slowFramesPercent} % > 32 ms`);
    }
  }
  return results;
}

/** Budget d'une image à 60 Hz, en millisecondes. */
const BUDGET_MS = 1000 / 60;
const fmt = (n) => String(Math.round(n * 100) / 100).replace(".", ",");

/**
 * Avis à partir des deux mesures : images lentes à 60 Hz (ce que voit l'utilisateur) et temps de rendu
 * par image sans limite de cadence (ce que coûte le flou), rapporté au budget de 16,7 ms.
 */
function verdict(fluid, raw) {
  const notes = [];
  let slowDelta = 0;
  let worstShare = 0;
  let worstFactor = 1;
  const find = (list, device, state) => list.find((r) => r.device === device && r.state === state);
  const msOf = (r) => (r && r.median.fps > 0 ? 1000 / r.median.fps : null);
  for (const device of DEVICES) {
    // À 60 Hz : images lentes ajoutées par le verre, par rapport au dock opaque (même DOM, sans flou).
    const opaque60 = find(fluid, device.id, "dock-opaque");
    const full60 = find(fluid, device.id, "verre-complet");
    if (opaque60 && full60) {
      const dSlow = Math.round((full60.median.slowFramesPercent - opaque60.median.slowFramesPercent) * 10) / 10;
      slowDelta = Math.max(slowDelta, dSlow);
      notes.push(`${device.label}, à 60 Hz, dock opaque → verre complet : ${fmt(opaque60.median.fps)} → ${fmt(full60.median.fps)} images/s, images > 32 ms ${fmt(opaque60.median.slowFramesPercent)} % → ${fmt(full60.median.slowFramesPercent)} %.`);
    }
    // Sans limite de cadence : coût par image de chaque étape.
    const [none, opaque, simple, full] = ["sans-dock", "dock-opaque", "verre-simple", "verre-complet"].map((st) => msOf(find(raw, device.id, st)));
    if (opaque && full) {
      const share = full / BUDGET_MS;
      worstShare = Math.max(worstShare, share);
      worstFactor = Math.max(worstFactor, full / opaque);
      const steps = [
        none ? `sans dock ${fmt(none)} ms` : null,
        `dock opaque ${fmt(opaque)} ms`,
        simple ? `verre sans réfraction ni animation ${fmt(simple)} ms` : null,
        `verre complet ${fmt(full)} ms`,
      ].filter(Boolean).join(" → ");
      notes.push(`${device.label}, sans limite de cadence, par image : ${steps} (${Math.round(share * 100)} % du budget de 16,7 ms à 60 Hz)${device.noRefraction ? " ; réfraction coupée comme sur WebKit" : ""}.`);
    }
  }
  // Décomposition : flou seul (dock opaque → verre sans réfraction ni animation), puis réfraction et
  // animation du reflet (verre sans réfraction ni animation → verre complet).
  let blurFactor = 1;
  let extrasFactor = 1;
  for (const device of DEVICES) {
    const [opaque, simple, full] = ["dock-opaque", "verre-simple", "verre-complet"].map((st) => msOf(find(raw, device.id, st)));
    if (opaque && simple) blurFactor = Math.max(blurFactor, simple / opaque);
    if (simple && full) extrasFactor = Math.max(extrasFactor, full / simple);
  }
  const split = `le flou et le liseré seuls coûtent au plus ${fmt(Math.round((blurFactor - 1) * 1000) / 10)} % de plus que le même dock opaque ; c'est l'animation du reflet (repeinte à chaque image)${DEVICES.some((d) => !d.noRefraction) ? " et, sur Android, la réfraction" : ""} qui multiplie(nt) le coût par ${fmt(Math.round(extrasFactor * 100) / 100)}`;
  notes.push(`Décomposition : ${split}.`);
  const cost = `le verre complet multiplie par ${fmt(worstFactor)} le temps de rendu d'une image par rapport au même dock opaque (jusqu'à ${Math.round(worstShare * 100)} % du budget à 60 Hz, en rendu logiciel sur serveur) ; ${split}`;
  const avis = slowDelta <= 1 && worstShare <= 0.25
    ? `On garde l'essai, limité au dock mobile et à la carte d'alerte du Radar, désactivé par défaut. On ne l'étend pas encore : ${cost}. Aucune image lente de plus à 60 Hz ici. Piste si le coût gêne sur un vrai téléphone : figer le reflet (comme avec « réduire les animations ») plutôt que retirer le flou. À confirmer au doigt sur un iPhone (Safari) et un Android d'entrée de gamme avant toute extension.`
    : slowDelta <= 3 && worstShare <= 0.5
      ? `On garde l'essai limité au dock et à la carte d'alerte, sans l'étendre : ${cost}. À confirmer sur de vrais téléphones.`
      : `On n'étend pas, et on envisage d'abandonner : ${cost}, avec des images lentes en plus. À vérifier sur de vrais téléphones avant de trancher.`;
  return { notes, avis, slowFramesDeltaPoints: slowDelta, worstBudgetShare: Math.round(worstShare * 1000) / 1000, worstCostFactor: Math.round(worstFactor * 100) / 100, blurOnlyFactor: Math.round(blurFactor * 1000) / 1000, refractionAndMotionFactor: Math.round(extrasFactor * 100) / 100, baseline: "dock-opaque" };
}

function report({ shots, surfaces, fluid, raw, meta }) {
  const v = verdict(fluid, raw);
  const lines = [];
  lines.push("# Essai « verre liquide » — captures et mesures");
  lines.push("");
  lines.push(`Généré le ${new Date(meta.generatedAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })} par \`scripts/glass-captures/capture.mjs\`.`);
  lines.push("");
  lines.push("> **Conditions de mesure : Chromium headless sur un serveur (sans carte graphique), pas un téléphone.** Les appareils sont **émulés** (taille d'écran, densité, agent utilisateur) ; le moteur reste Chromium. Le vrai Safari iOS (WebKit, préfixe `-webkit-backdrop-filter`, pas de réfraction) et un vrai Chrome Android sont **à vérifier par Ibrahim** sur ses téléphones.");
  lines.push("");
  lines.push(`Chromium ${meta.chromium} · ${RUNS} passage(s) de ${SCROLL_MS / 1000} s par cas, après un passage de chauffe ignoré, ordre des états alterné · page mesurée : liste des articles (/app/items) · profil iPhone sans réfraction (comme WebKit) · démo locale, aucun service externe.`);
  lines.push("");
  lines.push("## Fluidité au défilement (médiane des passages)");
  lines.push("");
  lines.push("### À 60 Hz (cadence normale)");
  lines.push("");
  lines.push("| Appareil (émulé) | État | Images/s | Images > 32 ms | 95e centile |");
  lines.push("|---|---|---:|---:|---:|");
  for (const r of fluid) {
    const d = DEVICES.find((x) => x.id === r.device);
    lines.push(`| ${d.label} | ${r.label} | ${fmt(r.median.fps)} | ${fmt(r.median.slowFramesPercent)} % | ${fmt(r.median.p95FrameMs)} ms |`);
  }
  lines.push("");
  lines.push("En headless, la cadence de 60 Hz est donnée par une horloge : elle reste à 60 tant que le rendu tient, et ne dit donc pas ce que coûte chaque image. La seconde mesure lance Chromium **sans limite de cadence** (`--disable-frame-rate-limit`, `--disable-gpu-vsync`) : le nombre d'images par seconde y reflète le coût du rendu, et l'écart entre **dock opaque** et **verre** (même DOM fixe, même défilement) est le chiffre à regarder : l'écart « sans dock → verre » mêlerait le coût du dock lui-même, du flou, de la réfraction et de l'animation du reflet. Un passage de chauffe est ignoré et l'ordre des états alterne d'un passage à l'autre.");
  lines.push("");
  lines.push("### Sans limite de cadence (coût du rendu)");
  lines.push("");
  lines.push("| Appareil (émulé) | État | Images/s sans limite | ms par image | Réfraction | 95e centile |");
  lines.push("|---|---|---:|---:|---|---:|");
  for (const r of raw) {
    const d = DEVICES.find((x) => x.id === r.device);
    lines.push(`| ${d.label} | ${r.label} | ${fmt(r.median.fps)} | ${r.median.fps > 0 ? fmt(1000 / r.median.fps) : "—"} | ${r.refraction ? "oui" : "non"} | ${fmt(r.median.p95FrameMs)} ms |`);
  }
  lines.push("");
  lines.push("### Lecture");
  lines.push("");
  for (const n of v.notes) lines.push(`- ${n}`);
  lines.push("");
  lines.push("## Rendu observé (après, essai actif)");
  lines.push("");
  lines.push("| Appareil · thème | Dock | Flou | Réfraction | Hauteur | Carte d'alerte Radar |");
  lines.push("|---|---|---|---|---:|---|");
  for (const [k, s] of Object.entries(surfaces)) {
    const dock = s.overview?.dock;
    const card = s.radar?.alertCard;
    lines.push(`| ${k} | ${dock?.mode ?? "absent"} | ${dock?.backdropFilter ?? "—"} | ${dock?.refraction ?? "—"} | ${dock?.height ?? "—"} px | ${card ? `${card.mode}${card.fallback ? ` (${card.fallback})` : ""}` : "absente"} |`);
  }
  lines.push("");
  lines.push("La réfraction des bords (filtre SVG) n'est activée que dans Chromium ; sur Safari iOS, le verre reste flou + liseré + reflet, sans réfraction : elle est donc coupée pour le profil iPhone (captures et mesures), et reste active pour le profil Android. Les replis (sans flou, moins de transparence, plus de contraste) donnent une surface opaque ; « réduire les animations » fige le reflet.");
  lines.push("");
  lines.push("## Captures");
  lines.push("");
  lines.push("| Appareil | Thème | Page | Avant | Après |");
  lines.push("|---|---|---|---|---|");
  for (const device of DEVICES) for (const theme of THEMES) for (const page of ["vue-ensemble", "radar"]) {
    const a = shots.find((s) => s.device === device.id && s.theme === theme && s.state === "avant" && s.file.endsWith(`${page}.png`));
    const b = shots.find((s) => s.device === device.id && s.theme === theme && s.state === "apres" && s.file.endsWith(`${page}.png`));
    lines.push(`| ${device.label} | ${theme === "light" ? "clair" : "sombre"} | ${page === "radar" ? "Radar" : "Vue d'ensemble"} | ![](${a?.file}) | ![](${b?.file}) |`);
  }
  lines.push("");
  lines.push("## Avis provisoire");
  lines.push("");
  lines.push(v.avis);
  lines.push("");
  lines.push("Ce chiffre ne remplace pas un essai au doigt sur un iPhone (Safari) et un Android d'entrée de gamme : c'est là que le verre (reflet animé, flou) coûte le plus.");
  lines.push("");
  return { markdown: lines.join("\n"), verdict: v };
}

async function main() {
  if (!existsSync(CHROMIUM)) throw new Error(`Chromium introuvable : ${CHROMIUM} (PLAYWRIGHT_CHROMIUM_PATH)`);
  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(OUT)) if (f.endsWith(".png")) rmSync(join(OUT, f));
  if (args["skip-build"] !== "true" || !existsSync(join(BUILD_DIR, "index.html"))) build();
  const preview = await startPreview();
  const { chromium } = createRequire(join(WEB, "package.json"))("@playwright/test");
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const meta = { generatedAt: new Date().toISOString(), chromium: browser.version(), headless: true, runs: RUNS, warmup: 1, alternatingOrder: true, scrollMs: SCROLL_MS, states: FLUID_STATES.map(({ id, label }) => ({ id, label })), devices: DEVICES.map(({ id, label, viewport, deviceScaleFactor, noRefraction }) => ({ id, label, viewport, deviceScaleFactor, emulated: true, refraction: !noRefraction })) };
    const { shots, surfaces } = await captures(browser);
    // 1) Cadence normale (60 Hz) : ce que verrait l'utilisateur si le rendu suit.
    const fluid = await fluidity(browser, "60hz");
    // 2) Sans limite de cadence : en headless, la cadence de 60 Hz est imposée par une horloge et masque
    //    le coût du rendu ; sans limite, le nombre d'images par seconde reflète ce que coûte chaque image.
    const unthrottled = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ["--disable-frame-rate-limit", "--disable-gpu-vsync"] });
    let raw = [];
    try {
      raw = await fluidity(unthrottled, "sans-limite");
    } finally {
      await unthrottled.close();
    }
    const { markdown, verdict: v } = report({ shots, surfaces, fluid, raw, meta });
    writeFileSync(join(OUT, "mesures.json"), `${JSON.stringify({ meta, note: "Chromium headless sur serveur, appareils émulés : pas un téléphone. Safari iOS réel à vérifier.", fluidity: fluid, fluidityUnthrottled: raw, surfaces, captures: shots, verdict: v }, null, 2)}\n`);
    writeFileSync(join(OUT, "RAPPORT.md"), markdown);
    log(`terminé : ${shots.length} captures, mesures.json et RAPPORT.md dans ${OUT}`);
  } finally {
    await browser.close();
    preview.kill();
  }
}

main().catch((e) => {
  process.stderr.write(`[verre] ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
