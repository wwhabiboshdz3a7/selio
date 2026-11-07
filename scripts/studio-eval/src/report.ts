import { LABEL_FIELDS, LABEL_FIELD_LABELS, MEASUREMENT_LABELS, MEASUREMENT_NAMES } from "@selio/contracts";
import { percentile, rate, readRate, type Tally } from "./compare";
import type { EvalResult, LabelCaseResult, TapeCaseResult } from "./run";

/**
 * Rapport Markdown du protocole, en français, écrit dans un dossier ignoré par Git. Il ne contient que des
 * noms de fichiers, des valeurs lues et des comptes : aucune image, aucun mot de passe, aucune adresse email.
 * Les objectifs (95 % de marques et tailles justes, 9 mesures sur 10 à 1 cm près) y sont confrontés à la
 * mesure ; avec le simulateur, le rapport dit en tête qu'il ne mesure rien.
 */

const MAX_LISTED = 60;

const nbsp = "\u00a0";
const thousands = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, nbsp);
export const pct = (v: number | null): string => (v === null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")}${nbsp}%`);
const cm = (v: number | null) => (v === null ? "—" : `${String(Math.round(v * 10) / 10).replace(".", ",")}${nbsp}cm`);
const msText = (v: number | null) => (v === null ? "—" : `${thousands(v)}${nbsp}ms`);
const md = (s: string) => s.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");

export function reportFileName(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}-studio-eval.md`;
}

function frenchDate(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

/** Verdict d'un objectif : atteint / non atteint / non mesurable, avec la réserve d'échantillon. */
export function objectiveLine(label: string, t: Tally, target: number, sample: number, protocolSize: number, simulated: boolean): string {
  const r = rate(t);
  if (simulated) return `**${label} : non mesuré (simulateur).**`;
  if (r === null) return `**${label} : non mesurable (aucune valeur attendue dans le jeu).**`;
  const verdict = r >= target ? "atteint" : "non atteint";
  const reserve = sample < protocolSize ? ` Échantillon de ${sample} (protocole : ${protocolSize}) : à confirmer sur le jeu complet.` : "";
  return `**${label} : ${pct(r)} (objectif ≥ ${pct(target)}) — ${verdict}.**${reserve}`;
}

function tallyRow(name: string, t: Tally, withUnexpected: boolean): string {
  const cells = [name, String(t.expected), String(t.correct), String(t.wrong), String(t.unread)];
  if (withUnexpected) cells.push(String(t.unexpected));
  cells.push(pct(rate(t)), pct(readRate(t)));
  return `| ${cells.join(" | ")} |`;
}

function wrongLabels(cases: LabelCaseResult[]): string[] {
  const out: string[] = [];
  for (const c of cases) {
    for (const cmp of c.comparisons) {
      if (cmp.outcome !== "wrong") continue;
      out.push(`- ${md(c.photo)} · ${LABEL_FIELD_LABELS[cmp.field]} : attendu « ${md(cmp.expected ?? "")} », lu « ${md(cmp.read ?? "")} » (confiance ${cmp.confidence.toFixed(2).replace(".", ",")})`);
    }
  }
  return out;
}

function unreadLabels(cases: LabelCaseResult[]): string[] {
  const out: string[] = [];
  for (const c of cases) {
    const fields = c.comparisons.filter((x) => x.outcome === "unread").map((x) => LABEL_FIELD_LABELS[x.field].toLowerCase());
    if (fields.length > 0) out.push(`- ${md(c.photo)} : ${fields.join(", ")} (question au vendeur)`);
  }
  return out;
}

function wrongMeasures(cases: TapeCaseResult[]): string[] {
  const out: string[] = [];
  for (const c of cases) {
    for (const cmp of c.comparisons) {
      if (cmp.outcome !== "wrong") continue;
      out.push(`- ${md(c.article)} (${md(c.photos.join(", "))}) · ${MEASUREMENT_LABELS[cmp.name]} : attendu ${cm(cmp.expected)}, lu ${cm(cmp.read)}${cmp.confidence !== null ? ` (confiance ${cmp.confidence.toFixed(2).replace(".", ",")})` : ""}`);
    }
  }
  return out;
}

function unexpectedMeasures(cases: TapeCaseResult[]): string[] {
  const out: string[] = [];
  for (const c of cases) {
    const names = c.comparisons.filter((x) => x.outcome === "unexpected").map((x) => `${MEASUREMENT_LABELS[x.name]} ${cm(x.read)}`);
    if (names.length > 0) out.push(`- ${md(c.article)} : ${names.join(", ")} (vérité inconnue : à vérifier sur l'article)`);
  }
  return out;
}

function limited(lines: string[]): string[] {
  return lines.length > MAX_LISTED ? [...lines.slice(0, MAX_LISTED), `- … et ${lines.length - MAX_LISTED} de plus (détail dans le fichier JSON, option --json)`] : lines;
}

export function renderReport(r: EvalResult): string {
  const L: string[] = [];
  const modeText = r.reader.mode === "direct" ? "service IA du dépôt (lecture directe, `AI_PROVIDER`)" : `API locale (${md(r.reader.model)}, POST /api/studio/prepare)`;
  L.push("# Studio — validation de la lecture des étiquettes et des mesures");
  L.push("");
  L.push(`_Rapport du ${frenchDate(r.generatedAt)} · jeu : \`${r.datasetRoot}\` · mode : ${modeText}_`);
  L.push("");
  if (r.simulated) {
    L.push("> **SIMULATEUR — CE RAPPORT NE MESURE RIEN.** Les lectures viennent du simulateur (`AI_PROVIDER=mock`), qui ne voit pas les photos. Il sert seulement à vérifier le déroulé du protocole. La précision de Studio reste **à mesurer** avec `AI_PROVIDER=ollama` sur la machine.");
    L.push("");
  }
  if (r.stopped) {
    L.push(`> **Protocole interrompu.** ${md(r.stopped)} Les taux ci-dessous ne portent que sur les cas lus avant l'arrêt.`);
    L.push("");
  }

  L.push("## Conditions");
  L.push("");
  L.push(`- Fournisseur : ${md(r.reader.provider)} · état : ${md(r.reader.status)} — ${md(r.reader.message)}`);
  L.push(`- Modèle 1 (photos) : ${md(r.reader.visionModel ?? "aucun")} · modèle de texte : ${md(r.reader.model)}`);
  L.push(`- OCR d'essai (\`OLLAMA_OCR_MODEL\`) : ${r.reader.ocrConfigured ? `configuré (${md(r.reader.ocrModel ?? "")}), ${r.ocrFallback ? "utilisé en second recours" : "désactivé pour cette mesure (--no-ocr)"}` : "non configuré (facultatif)"}`);
  L.push(`- Jeu : ${r.labels.total} photo(s) d'étiquette (protocole : ${r.targets.protocol.labelPhotos}) · ${r.measures.total} article(s) avec mètre ruban (protocole : ${r.targets.protocol.tapeArticles})`);
  L.push(`- Photos envoyées au modèle telles quelles, après la vérification du serveur (côté long ≤ 1${nbsp}024${nbsp}px, ≤ 1${nbsp}Mo) : ${r.labels.skipped.length + r.measures.skipped.length} écartée(s), jamais réduites par le script`);
  L.push(`- Durée : ${thousands(r.durationMs / 1000)}${nbsp}s`);
  L.push("");

  L.push("## Étiquettes (modèle 1)");
  L.push("");
  L.push(`${r.labels.cases.length} lecture(s) sur ${r.labels.total} photo(s) ; ${r.labels.skipped.length} écartée(s), ${r.labels.errors.length} en erreur. Une valeur « non lue » est restée vide avec une question au vendeur (honnête) ; une valeur **fausse** est une invention du modèle (la seule vraie faute).`);
  L.push("");
  L.push("| Champ | Attendues | Justes | Fausses | Non lues | Justes / attendues | Justes / lues |");
  L.push("|---|---|---|---|---|---|---|");
  for (const f of LABEL_FIELDS) L.push(tallyRow(LABEL_FIELD_LABELS[f], r.labels.tally[f], false));
  L.push(tallyRow("**Marques et tailles**", r.labels.brandAndSize, false));
  L.push("");
  L.push(objectiveLine("Marques et tailles justes", r.labels.brandAndSize, r.targets.brandAndSizeRate, r.labels.cases.length, r.targets.protocol.labelPhotos, r.simulated));
  L.push("");
  if (r.reader.ocrConfigured) {
    L.push(r.ocrFallback ? `OCR d'essai : tenté sur ${r.labels.ocr.attempted} étiquette(s) (marque ou taille vide ou peu sûre), retenu pour ${r.labels.ocr.used}. Pour isoler son apport, relancer avec \`--no-ocr\` et comparer.` : "OCR d'essai configuré mais désactivé pour cette mesure (`--no-ocr`).");
    L.push("");
  }
  const wrongL = wrongLabels(r.labels.cases);
  L.push(`### Lectures fausses (${wrongL.length})`);
  L.push("");
  L.push(...(wrongL.length > 0 ? limited(wrongL) : ["Aucune."]));
  L.push("");
  const unreadL = unreadLabels(r.labels.cases);
  L.push(`### Photos avec un champ non lu (${unreadL.length})`);
  L.push("");
  L.push(...(unreadL.length > 0 ? limited(unreadL) : ["Aucune."]));
  L.push("");

  L.push("## Mesures (mètre ruban photographié)");
  L.push("");
  L.push(`${r.measures.cases.length} lecture(s) sur ${r.measures.total} article(s) ; ${r.measures.skipped.length} écarté(s), ${r.measures.errors.length} en erreur ; aucun mètre ruban vu sur ${r.measures.noTape} article(s) (aucune mesure lue, jamais estimée à l'œil). Juste = à ± ${r.targets.measurementToleranceCm}${nbsp}cm de la mesure vraie.`);
  L.push("");
  L.push("| Mesure | Attendues | Justes | Fausses | Non lues | Inattendues | Justes / attendues | Justes / lues |");
  L.push("|---|---|---|---|---|---|---|---|");
  for (const n of MEASUREMENT_NAMES) if (r.measures.byName[n].expected > 0 || r.measures.byName[n].unexpected > 0) L.push(tallyRow(MEASUREMENT_LABELS[n], r.measures.byName[n], true));
  L.push(tallyRow("**Toutes**", r.measures.tally, true));
  L.push("");
  L.push(objectiveLine(`Mesures justes à ${r.targets.measurementToleranceCm}${nbsp}cm près`, r.measures.tally, r.targets.measurementRate, r.measures.cases.length, r.targets.protocol.tapeArticles, r.simulated));
  L.push("");
  const wrongM = wrongMeasures(r.measures.cases);
  L.push(`### Mesures fausses (${wrongM.length})`);
  L.push("");
  L.push(...(wrongM.length > 0 ? limited(wrongM) : ["Aucune."]));
  L.push("");
  const unexpectedM = unexpectedMeasures(r.measures.cases);
  if (unexpectedM.length > 0) {
    L.push(`### Mesures lues sans vérité connue (${unexpectedM.length})`);
    L.push("");
    L.push(...limited(unexpectedM));
    L.push("");
  }

  const skipped = [...r.labels.skipped, ...r.measures.skipped];
  L.push(`## Photos écartées (${skipped.length})`);
  L.push("");
  L.push(skipped.length > 0 ? "Jamais envoyées en pleine taille : réduire (côté long 1 024 px, JPEG qualité 80) puis relancer." : "Aucune.");
  L.push(...limited(skipped.map((s) => `- ${md(s.photo)} : ${md(s.reason)}`)));
  L.push("");

  const errors = [...r.labels.errors, ...r.measures.errors];
  L.push(`## Erreurs de lecture (${errors.length})`);
  L.push("");
  L.push(...(errors.length > 0 ? limited(errors.map((e) => `- ${md(e.photo)} : ${md(e.code)} — ${md(e.message)}`)) : ["Aucune."]));
  L.push("");

  if (r.datasetProblems.length > 0) {
    L.push(`## Lignes de vérité ignorées (${r.datasetProblems.length})`);
    L.push("");
    L.push(...limited(r.datasetProblems.map((p) => `- ${p.section} : ${md(p.message)}`)));
    L.push("");
  }

  L.push("## Latence par lecture");
  L.push("");
  L.push("| Lecture | n | p50 | p95 |");
  L.push("|---|---|---|---|");
  L.push(`| Étiquette (1 photo${r.reader.ocrConfigured && r.ocrFallback ? ", OCR compris" : ""}) | ${r.labels.latencyMs.length} | ${msText(percentile(r.labels.latencyMs, 50))} | ${msText(percentile(r.labels.latencyMs, 95))} |`);
  L.push(`| Mesures (1 à 3 photos) | ${r.measures.latencyMs.length} | ${msText(percentile(r.measures.latencyMs, 50))} | ${msText(percentile(r.measures.latencyMs, 95))} |`);
  L.push("");

  L.push("## Ce que ce rapport dit, et ne dit pas");
  L.push("");
  L.push("- Il mesure le modèle **sur nos propres photos**, dans nos conditions de prise de vue (lumière, cadrage, netteté). Ce n'est pas une promesse de précision pour les clients : l'interface et les documents continuent de dire « à mesurer » tant que le jeu complet n'a pas été passé et le résultat reporté.");
  L.push("- Le script ne réduit ni ne retouche les photos, ne donne aucune indication au modèle, et ne compte comme juste qu'une valeur lue sur l'étiquette ou sur le ruban (provenance `label` / `tape_photo`).");
  L.push("- À reporter dans docs/STUDIO.md (tableau « Mesures sur nos photos ») : date, modèle 1, OCR, nombre de photos, taux de marques et tailles justes, taux de mesures à 1 cm, lectures fausses.");
  L.push("");
  return L.join("\n");
}
