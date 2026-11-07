/**
 * Protocole de validation de Studio (§5.11) sur NOS photos : `pnpm studio:eval <dossier> [options]`.
 *
 * Lit un jeu hors du dépôt (etiquettes/verite.csv + photos, mesures/verite.csv + photos), fait lire chaque
 * étiquette et chaque article avec mètre ruban par le modèle 1, compare à la vérité terrain et écrit un
 * rapport Markdown daté dans scripts/studio-eval/rapports/ (ignoré par Git). Aucune photo n'est copiée.
 *
 * Modes :
 *   --mode direct (défaut)  service IA du dépôt, variables AI_PROVIDER=ollama, OLLAMA_BASE_URL, OLLAMA_VISION_MODEL,
 *                           OLLAMA_OCR_MODEL (facultatif)… comme pnpm ai:diagnose. Aucune base, aucun quota.
 *   --mode api              API locale (STUDIO_EVAL_API_URL, défaut http://127.0.0.1:8787) avec un compte de l'équipe :
 *                           STUDIO_EVAL_EMAIL et STUDIO_EVAL_PASSWORD (variables, jamais en argument). Chaque lecture
 *                           compte une requête IA et laisse un brouillon de préparation (purgé après 30 jours).
 *
 * Options :
 *   --out <fichier.md>      emplacement du rapport (défaut : rapports/AAAA-MM-JJ-HHMM-studio-eval.md)
 *   --json                  écrit aussi le détail de chaque lecture en JSON à côté du rapport
 *   --only etiquettes|mesures   une seule section
 *   --limit <n>             n premiers cas par section (essai rapide)
 *   --no-ocr                sans l'OCR d'essai en second recours (pour comparer avec et sans)
 *   --allow-mock            accepte AI_PROVIDER=mock : le rapport dit alors qu'il NE MESURE RIEN (code 3)
 *
 * Codes de sortie : 0 rapport écrit (mesure réelle) ; 1 erreur (arguments, jeu, serveur) ; 2 rien n'a pu être
 * évalué ; 3 rapport écrit avec le simulateur (aucune mesure).
 * Les chemins relatifs partent du dossier d'où la commande est lancée.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createAIService, loadAIConfig } from "@selio/ai";
import { pct } from "./report";
import { rate } from "./compare";
import { DatasetError, loadDataset } from "./dataset";
import { ApiReader, DirectReader, ReaderError, type StudioAI, type StudioReader } from "./readers";
import { renderReport, reportFileName } from "./report";
import { runEval } from "./run";

export interface CliArgs {
  dataset: string | null;
  mode: "direct" | "api";
  out: string | null;
  json: boolean;
  only: "labels" | "tapes" | undefined;
  limit: number | undefined;
  ocr: boolean;
  allowMock: boolean;
  help: boolean;
}

export interface CliIo {
  log(line: string): void;
  error(line: string): void;
}

export interface CliDeps {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Service IA à utiliser en mode direct (tests) ; sinon `createAIService` avec les variables d'environnement. */
  createService?: (env: NodeJS.ProcessEnv) => StudioAI;
  /** Dossier des rapports par défaut (tests) ; sinon scripts/studio-eval/rapports/. */
  reportsDir?: string;
}

export const USAGE = [
  "Usage : pnpm studio:eval <dossier-du-jeu> [--mode direct|api] [--out rapport.md] [--json] [--only etiquettes|mesures] [--limit n] [--no-ocr] [--allow-mock]",
  "  Mode direct : AI_PROVIDER=ollama OLLAMA_BASE_URL=http://10.0.0.5:11434 [OLLAMA_OCR_MODEL=…] pnpm studio:eval /chemin/jeu",
  "  Mode api    : STUDIO_EVAL_EMAIL=… STUDIO_EVAL_PASSWORD=… pnpm studio:eval /chemin/jeu --mode api [STUDIO_EVAL_API_URL=http://127.0.0.1:8787]",
  "  Structure du jeu et format des vérités : docs/STUDIO.md (« Protocole de validation ») ; exemple dans scripts/studio-eval/exemple/.",
].join("\n");

export class CliError extends Error {}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dataset: null, mode: "direct", out: null, json: false, only: undefined, limit: undefined, ocr: true, allowMock: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") continue;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--mode") {
      const m = argv[++i];
      if (m !== "direct" && m !== "api") throw new CliError("--mode attend « direct » ou « api »");
      args.mode = m;
    } else if (a === "--out") {
      const o = argv[++i];
      if (!o) throw new CliError("--out attend un chemin de fichier");
      args.out = o;
    } else if (a === "--json") args.json = true;
    else if (a === "--only") {
      const o = argv[++i];
      if (o === "etiquettes" || o === "labels") args.only = "labels";
      else if (o === "mesures" || o === "measures" || o === "tapes") args.only = "tapes";
      else throw new CliError("--only attend « etiquettes » ou « mesures »");
    } else if (a === "--limit") {
      const n = argv[++i];
      if (!n || !/^\d+$/.test(n) || Number(n) < 1) throw new CliError("--limit attend un nombre entier ≥ 1");
      args.limit = Number(n);
    } else if (a === "--no-ocr") args.ocr = false;
    else if (a === "--allow-mock") args.allowMock = true;
    else if (a.startsWith("-")) throw new CliError(`option inconnue ${a}`);
    else if (args.dataset === null) args.dataset = a;
    else throw new CliError(`argument en trop : ${a}`);
  }
  return args;
}

function resolveFrom(env: NodeJS.ProcessEnv, p: string): string {
  return path.resolve(env.INIT_CWD ?? process.cwd(), p);
}

function buildReader(args: CliArgs, env: NodeJS.ProcessEnv, deps: CliDeps, io: CliIo): StudioReader {
  if (args.mode === "api") {
    const baseUrl = (env.STUDIO_EVAL_API_URL ?? "http://127.0.0.1:8787").trim();
    const email = env.STUDIO_EVAL_EMAIL?.trim();
    const password = env.STUDIO_EVAL_PASSWORD;
    if (!email || !password) throw new CliError("Mode api : STUDIO_EVAL_EMAIL et STUDIO_EVAL_PASSWORD sont nécessaires (variables d'environnement, jamais en argument).");
    if (!/^https?:\/\//.test(baseUrl)) throw new CliError(`STUDIO_EVAL_API_URL invalide : ${baseUrl}`);
    io.log(`Mode api : ${baseUrl} (chaque lecture compte une requête IA et laisse un brouillon de préparation, purgé après 30 jours).`);
    return new ApiReader({ baseUrl, email, password, fetchImpl: deps.fetchImpl });
  }
  // Service fourni par l'appelant (tests) : il tient lieu de fournisseur ; sa santé dit s'il simule.
  if (deps.createService) {
    io.log("Mode direct : service IA fourni par l'appelant.");
    return new DirectReader(deps.createService(env));
  }
  const config = loadAIConfig(env);
  if (config.AI_PROVIDER !== "ollama" && !args.allowMock) {
    throw new CliError(`Mode direct : AI_PROVIDER=${config.AI_PROVIDER}. Le protocole mesure un vrai modèle (AI_PROVIDER=ollama) ; pour vérifier seulement le déroulé avec le simulateur, ajoutez --allow-mock (le rapport dira qu'il ne mesure rien).`);
  }
  io.log(`Mode direct : ${config.AI_PROVIDER === "ollama" ? config.OLLAMA_BASE_URL : "SIMULATEUR (aucune mesure)"} · modèle 1 : ${config.OLLAMA_VISION_MODEL ?? "désactivé"} · OCR d'essai : ${config.OLLAMA_OCR_MODEL ?? "non configuré"}${args.ocr ? "" : " (désactivé par --no-ocr)"}`);
  return new DirectReader(createAIService({ config, allowFallback: false, fetchImpl: deps.fetchImpl }));
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env, io: CliIo = console, deps: CliDeps = {}): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    io.error(`Erreur : ${(err as Error).message}`);
    io.error(USAGE);
    return 1;
  }
  if (args.help) {
    io.log(USAGE);
    return 0;
  }
  if (!args.dataset) {
    io.error("Erreur : indiquez le dossier du jeu de validation.");
    io.error(USAGE);
    return 1;
  }
  try {
    const dataset = await loadDataset(resolveFrom(env, args.dataset), { only: args.only, limit: args.limit });
    io.log(`Jeu : ${dataset.root} · ${dataset.labels.length} photo(s) d'étiquette · ${dataset.tapes.length} article(s) avec mètre ruban${dataset.problems.length > 0 ? ` · ${dataset.problems.length} ligne(s) de vérité ignorée(s)` : ""}`);
    for (const p of dataset.problems) io.log(`  ${p.section} : ${p.message}`);
    if (dataset.labels.length === 0 && dataset.tapes.length === 0) {
      io.error("Rien à évaluer : aucune ligne de vérité utilisable.");
      return 2;
    }
    const reader = buildReader(args, env, deps, io);
    const result = await runEval({ dataset, reader, ocr: args.ocr, now: deps.now, log: (line) => io.log(line) });

    const now = deps.now ? deps.now() : new Date();
    const defaultDir = deps.reportsDir ?? fileURLToPath(new URL("../rapports/", import.meta.url));
    const outFile = args.out ? resolveFrom(env, args.out) : path.join(defaultDir, reportFileName(now));
    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, renderReport(result), "utf8");
    if (args.json) await writeFile(outFile.replace(/\.md$/i, "") + ".json", JSON.stringify(result, null, 2), "utf8");

    const evaluated = result.labels.cases.length + result.measures.cases.length;
    io.log("");
    io.log(`Étiquettes : ${result.labels.cases.length} lue(s) · marques et tailles justes ${pct(rate(result.labels.brandAndSize))} (objectif ≥ ${pct(result.targets.brandAndSizeRate)}) · fausses ${result.labels.brandAndSize.wrong}`);
    io.log(`Mesures    : ${result.measures.cases.length} article(s) lu(s) · justes à ${result.targets.measurementToleranceCm} cm ${pct(rate(result.measures.tally))} (objectif ≥ ${pct(result.targets.measurementRate)}) · fausses ${result.measures.tally.wrong}`);
    if (result.stopped) io.error(`Protocole interrompu : ${result.stopped}`);
    io.log(`Rapport : ${outFile}${args.json ? " (+ .json)" : ""}`);
    if (result.simulated) {
      io.error("SIMULATEUR : ce rapport ne mesure rien. Relancez avec AI_PROVIDER=ollama sur la machine.");
      return 3;
    }
    if (evaluated === 0) {
      io.error("Rien n'a pu être évalué (photos écartées ou erreurs) : voir le rapport.");
      return 2;
    }
    return 0;
  } catch (err) {
    if (err instanceof CliError || err instanceof DatasetError || err instanceof ReaderError) {
      io.error(`Erreur : ${err.message}`);
      if (err instanceof CliError) io.error(USAGE);
      return 1;
    }
    io.error(`Erreur : ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

const isEntry = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
