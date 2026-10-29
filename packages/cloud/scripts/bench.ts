/**
 * Mesure de capacité du Cloud : `pnpm cloud:bench`.
 *
 * Ouvre CLOUD_BENCH_CONTEXTS navigateurs (5 par défaut), lancés comme en
 * production (bac à sable actif, environnement minimal, dossier de travail
 * temporaire, contexte sans enregistrement sur le disque), sur une
 * page LOCALE servie par ce script (la fixture de conversation de l'adaptateur
 * Vinted v1). Jamais contre vinted.fr : aucune adresse extérieure n'est acceptée.
 *
 * Mesures :
 * - temps d'ouverture de chaque navigateur (lancement + page chargée + champ de réponse visible) ;
 * - mémoire des processus Chromium : PSS de /proc/<pid>/smaps_rollup (partage compté une fois),
 *   à défaut RSS de /proc/<pid>/status (surestime : mémoire partagée comptée plusieurs fois) ;
 * - mémoire de Node (process.memoryUsage) et mémoire disponible de la machine (/proc/meminfo).
 *
 * Variables : CLOUD_CHROMIUM_PATH (obligatoire), CLOUD_BENCH_CONTEXTS (5), CLOUD_BENCH_PARALLEL
 * (1 = ouvertures l'une après l'autre), CLOUD_BENCH_HOLD_MS (3000, attente avant la mesure),
 * CLOUD_CHROMIUM_SANDBOX (vrai par défaut ; « false » seulement sur un poste de développement).
 *
 * Le tableau imprimé est à reporter dans docs/CLOUD.md avec la machine utilisée. La cible de
 * 50 navigateurs simultanés reste une hypothèse tant qu'elle n'a pas été mesurée sur la machine
 * de Marseille : la projection imprimée est une extrapolation, pas une mesure.
 */
import { readFileSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { cpus, totalmem } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { createProfileDir, removeProfileDir } from "../src/profile";
import { DEFAULT_VIEWPORT, contextOptions, launchOptions } from "../src/runner/launch";
import { COMPOSER_SELECTORS } from "../src/vinted";

const num = (v: string | undefined, fallback: number, min: number, max: number) => {
  const n = Number(v);
  return v && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
};

const chromiumPath = process.env.CLOUD_CHROMIUM_PATH;
const contexts = num(process.env.CLOUD_BENCH_CONTEXTS, 5, 1, 200);
const parallel = num(process.env.CLOUD_BENCH_PARALLEL, 1, 1, 50);
const holdMs = num(process.env.CLOUD_BENCH_HOLD_MS, 3_000, 0, 120_000);
const sandbox = !/^(0|false|no|non|off)$/i.test(process.env.CLOUD_CHROMIUM_SANDBOX?.trim() ?? "");

const fixture = readFileSync(new URL("../../connectors/src/vinted/fixtures/conversation-page.v1.html", import.meta.url), "utf8");

const MB = 1024 * 1024;
const mb = (bytes: number) => `${(bytes / MB).toFixed(0)} Mo`;
const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;

/** Processus descendants de `root` (lecture de /proc/<pid>/stat), vide hors Linux. */
async function descendants(root: number): Promise<number[]> {
  let names: string[];
  try {
    names = await readdir("/proc");
  } catch {
    return [];
  }
  const parent = new Map<number, number>();
  await Promise.all(
    names
      .filter((n) => /^\d+$/.test(n))
      .map(async (n) => {
        try {
          const stat = await readFile(`/proc/${n}/stat`, "utf8");
          // Le nom du processus est entre parenthèses et peut contenir des espaces.
          const after = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
          parent.set(Number(n), Number(after[1]));
        } catch {
          // processus terminé entre-temps
        }
      }),
  );
  const out: number[] = [];
  const queue = [root];
  while (queue.length) {
    const p = queue.shift()!;
    for (const [pid, ppid] of parent) {
      if (ppid === p) {
        out.push(pid);
        queue.push(pid);
      }
    }
  }
  return out;
}

/** Mémoire d'un processus en octets : PSS si disponible, sinon RSS. */
async function processMemory(pid: number): Promise<{ bytes: number; kind: "pss" | "rss" } | null> {
  try {
    const rollup = await readFile(`/proc/${pid}/smaps_rollup`, "utf8");
    const m = /^Pss:\s+(\d+) kB/m.exec(rollup);
    if (m) return { bytes: Number(m[1]) * 1024, kind: "pss" };
  } catch {
    // pas de smaps_rollup (noyau ancien, droits)
  }
  try {
    const status = await readFile(`/proc/${pid}/status`, "utf8");
    const m = /^VmRSS:\s+(\d+) kB/m.exec(status);
    if (m) return { bytes: Number(m[1]) * 1024, kind: "rss" };
  } catch {
    // processus terminé
  }
  return null;
}

async function chromiumMemory(): Promise<{ bytes: number; processes: number; kind: string }> {
  const pids = await descendants(process.pid);
  let bytes = 0;
  let processes = 0;
  const kinds = new Set<string>();
  for (const pid of pids) {
    const m = await processMemory(pid);
    if (!m) continue;
    bytes += m.bytes;
    processes++;
    kinds.add(m.kind);
  }
  return { bytes, processes, kind: [...kinds].join("+") || "indisponible" };
}

async function memAvailable(): Promise<number | null> {
  try {
    const info = await readFile("/proc/meminfo", "utf8");
    const m = /^MemAvailable:\s+(\d+) kB/m.exec(info);
    return m ? Number(m[1]) * 1024 : null;
  } catch {
    return null;
  }
}

async function main() {
  if (!chromiumPath) {
    console.error("CLOUD_CHROMIUM_PATH manquant (chemin de l'exécutable Chromium). Le Cloud ne télécharge aucun navigateur.");
    process.exit(1);
  }

  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(fixture);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/inbox/987`;
  if (!url.startsWith("http://127.0.0.1:")) throw new Error("Le banc ne vise qu'une page locale.");

  const availableBefore = await memAvailable();
  const baseline = await chromiumMemory();
  const opened: { browser: Browser; profileDir: string }[] = [];
  const openTimes: number[] = [];
  let version = "inconnue";
  let failures = 0;

  console.info(`Ouverture de ${contexts} navigateur(s) sur ${url} (${parallel} à la fois)…`);
  const openOne = async () => {
    const profileDir = await createProfileDir();
    const t0 = performance.now();
    try {
      await mkdir(join(profileDir, "artifacts"), { mode: 0o700 });
      const browser = await chromium.launch(launchOptions({ chromiumPath, headless: true, timeoutMs: 60_000, sandbox, workDir: profileDir }));
      opened.push({ browser, profileDir });
      const context = await browser.newContext(contextOptions({ ...DEFAULT_VIEWPORT }));
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.locator(COMPOSER_SELECTORS.join(", ")).first().waitFor({ state: "visible", timeout: 30_000 });
      openTimes.push(performance.now() - t0);
      version = browser.version();
    } catch (err) {
      failures++;
      console.warn(`Échec d'ouverture : ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
      await removeProfileDir(profileDir);
    }
  };
  for (let i = 0; i < contexts; i += parallel) {
    await Promise.all(Array.from({ length: Math.min(parallel, contexts - i) }, openOne));
  }

  if (holdMs > 0) await new Promise((r) => setTimeout(r, holdMs));
  const loaded = await chromiumMemory();
  const availableAfter = await memAvailable();
  const node = process.memoryUsage();

  const sorted = [...openTimes].sort((a, b) => a - b);
  const browsers = opened.length;
  const chromiumBytes = Math.max(0, loaded.bytes - baseline.bytes);
  const perBrowser = browsers > 0 ? chromiumBytes / browsers : 0;
  const ms = (v: number) => `${v.toFixed(0)} ms`;

  const rows: [string, string][] = [
    ["Date", new Date().toISOString()],
    ["Machine de mesure", `${cpus().length} cœurs (${cpus()[0]?.model ?? "?"}), ${mb(totalmem())} de mémoire`],
    ["Chromium", `${version} (${chromiumPath}), bac à sable ${sandbox ? "actif" : "DÉSACTIVÉ (développement)"}`],
    ["Navigateurs ouverts / demandés", `${browsers} / ${contexts}${failures ? ` (${failures} échec(s))` : ""}`],
    ["Ouvertures simultanées", String(parallel)],
    ["Ouverture p50 / p95 / max", browsers ? `${ms(pct(sorted, 50))} / ${ms(pct(sorted, 95))} / ${ms(sorted.at(-1) ?? 0)}` : "—"],
    [`Mémoire Chromium totale (${loaded.kind}, ${loaded.processes} processus)`, mb(chromiumBytes)],
    ["Mémoire par navigateur (moyenne)", browsers ? mb(perBrowser) : "—"],
    ["Node : RSS / tas utilisé", `${mb(node.rss)} / ${mb(node.heapUsed)}`],
    ["Mémoire disponible avant / après", availableBefore !== null && availableAfter !== null ? `${mb(availableBefore)} / ${mb(availableAfter)}` : "indisponible (/proc absent)"],
    ["Extrapolation linéaire à 50 navigateurs (NON mesurée)", browsers ? `≈ ${mb(perBrowser * 50)} — à confirmer par une mesure réelle à 50` : "—"],
  ];

  console.info("\nRésultat à reporter dans docs/CLOUD.md (page locale, jamais vinted.fr ; une vraie page Vinted pèse plus lourd) :\n");
  console.info("| Mesure | Valeur |");
  console.info("|---|---|");
  for (const [k, v] of rows) console.info(`| ${k} | ${v} |`);

  for (const { browser, profileDir } of opened) {
    await browser.close().catch(() => {});
    await removeProfileDir(profileDir);
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
