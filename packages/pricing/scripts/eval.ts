/**
 * Évaluation du modèle de prix : `pnpm prix:eval <références.csv|références.json> [options]`.
 *
 * Lit une base de références (format dans packages/pricing/README.md), la nettoie, entraîne le
 * modèle sur le passé, le teste sur le dernier mois jamais vu, imprime le rapport et écrit le
 * modèle JSON. Aucune donnée n'est fournie dans le dépôt ; aucune requête réseau.
 *
 * Options :
 *   --out <chemin.json>   fichier du modèle (défaut : à côté du fichier lu, « <nom>.modele-prix.json »)
 *   --now <AAAA-MM-JJ>    fin du mois de test (défaut : la date la plus récente du fichier)
 *   --seed <n>            graine (42)
 *   --holdout <jours>     durée du test (30)
 *   --backtest [n]        backtest glissant (4 fenêtres d'un mois par défaut)
 *   --source <source>     source des lignes qui n'en ont pas (provided_base)
 *   --synthetic <n>       références SYNTHÉTIQUES (source « demo ») au lieu d'un fichier ;
 *                         le modèle n'est écrit qu'avec --out
 *
 * Codes de sortie : 0 modèle entraîné, 1 erreur, 2 pas assez de références (modèle non écrit).
 * Les chemins relatifs partent du dossier d'où la commande est lancée.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PRICE_REFERENCE_SOURCES, formatTrainingReport, parseReferencesCsv, parseReferencesJson, serializePriceModel, trainPriceModel, type ParseResult, type PriceReferenceSource } from "../src/index";
import { generateSyntheticReferences } from "../src/synthetic";

interface Args {
  input: string | null;
  out: string | null;
  now: string | null;
  seed: number;
  holdout: number;
  backtest: boolean | number;
  source: PriceReferenceSource;
  synthetic: number | null;
}

function usage(message?: string): never {
  if (message) console.error(`Erreur : ${message}`);
  console.error("Usage : pnpm prix:eval <références.csv|références.json> [--out modele.json] [--now AAAA-MM-JJ] [--seed 42] [--holdout 30] [--backtest [4]] [--source provided_base]");
  console.error("        pnpm prix:eval --synthetic 20000 [--out modele.json]");
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const args: Args = { input: null, out: null, now: null, seed: 42, holdout: 30, backtest: false, source: "provided_base", synthetic: null };
  const num = (v: string | undefined, name: string) => {
    if (v === undefined || !/^\d+$/.test(v)) usage(`${name} attend un nombre entier`);
    return Number(v);
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") continue;
    else if (a === "--out") args.out = argv[++i] ?? usage("--out attend un chemin");
    else if (a === "--now") args.now = argv[++i] ?? usage("--now attend une date");
    else if (a === "--seed") args.seed = num(argv[++i], "--seed");
    else if (a === "--holdout") args.holdout = num(argv[++i], "--holdout");
    else if (a === "--synthetic") args.synthetic = num(argv[++i], "--synthetic");
    else if (a === "--source") {
      const s = argv[++i];
      if (!s || !(PRICE_REFERENCE_SOURCES as readonly string[]).includes(s)) usage(`--source attend l'une de : ${PRICE_REFERENCE_SOURCES.join(", ")}`);
      args.source = s as PriceReferenceSource;
    } else if (a === "--backtest") {
      const next = argv[i + 1];
      if (next !== undefined && /^\d+$/.test(next)) {
        args.backtest = Number(next);
        i++;
      } else args.backtest = true;
    } else if (a.startsWith("--")) usage(`option inconnue ${a}`);
    else if (args.input === null) args.input = a;
    else usage(`argument en trop : ${a}`);
  }
  if (args.input === null && args.synthetic === null) usage("indiquez un fichier de références ou --synthetic <n>");
  return args;
}

/** Date la plus récente d'une base (vente, sinon mise en ligne). */
function latestDate(result: ParseResult): string | null {
  let max = -Infinity;
  for (const r of result.references) {
    for (const d of [r.soldAt, r.listedAt]) {
      const t = d instanceof Date ? d.getTime() : typeof d === "string" ? Date.parse(d) : NaN;
      if (Number.isFinite(t) && t > max) max = t;
    }
  }
  return Number.isFinite(max) ? new Date(max).toISOString() : null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const base = process.env.INIT_CWD ?? process.cwd();
  let parsed: ParseResult;
  let defaultOut: string | null = null;
  if (args.synthetic !== null) {
    if (args.synthetic < 1 || args.synthetic > 2_000_000) usage("--synthetic attend un nombre de 1 à 2 000 000");
    const now = args.now ?? "2026-10-30T12:00:00Z";
    parsed = { references: generateSyntheticReferences({ n: args.synthetic, seed: args.seed, now }), errors: [] };
    args.now = now;
    console.info(`${args.synthetic} références SYNTHÉTIQUES générées (source « demo ») : rien de ce qui suit n'est une mesure réelle.`);
  } else {
    const file = path.resolve(base, args.input!);
    const text = await readFile(file, "utf8");
    parsed = /\.json$/i.test(file) ? parseReferencesJson(JSON.parse(text), { defaultSource: args.source }) : parseReferencesCsv(text, { defaultSource: args.source });
    defaultOut = file.replace(/\.(csv|json|txt)$/i, "") + ".modele-prix.json";
    console.info(`Fichier lu : ${file}`);
  }
  console.info(`Références valides : ${parsed.references.length} ; lignes refusées à la lecture : ${parsed.errors.length}`);
  for (const e of parsed.errors.slice(0, 20)) console.info(`  ligne ${e.line} : ${e.message}`);
  if (parsed.errors.length > 20) console.info(`  … et ${parsed.errors.length - 20} autres`);

  const now = args.now ?? latestDate(parsed);
  if (!now) usage("aucune date valide dans le fichier ; précisez --now");
  const { model, report } = trainPriceModel(parsed.references, { now, seed: args.seed, holdoutDays: args.holdout, backtest: args.backtest });
  console.info("");
  console.info(formatTrainingReport(report));
  if (!model) {
    process.exitCode = 2;
    return;
  }
  const out = args.out ? path.resolve(base, args.out) : defaultOut;
  if (!out) {
    console.info("\nModèle non écrit : ajoutez --out <chemin.json> pour l'enregistrer.");
    return;
  }
  await writeFile(out, serializePriceModel(model), "utf8");
  console.info(`\nModèle écrit : ${out}`);
}

main().catch((err: unknown) => {
  console.error(`Erreur : ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
