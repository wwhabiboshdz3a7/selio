/**
 * Lecture CSV minimale pour les vérités terrain du protocole : en-tête obligatoire, séparateur détecté sur
 * l'en-tête (`;`, `,` ou tabulation), guillemets doublés (« "" »), BOM et fins de ligne CRLF tolérés.
 * Aucune dépendance : le script doit tourner sur la machine de Marseille sans rien installer de plus.
 */

export interface CsvTable {
  header: string[];
  rows: string[][];
  separator: ";" | "," | "\t";
  /** Numéro de ligne du fichier (1 = en-tête) de chaque ligne de `rows`, pour les messages d'erreur. */
  lineNumbers: number[];
}

const SEPARATORS = [";", ",", "\t"] as const;

/** Séparateur le plus fréquent sur la première ligne (`;` en cas d'égalité : fichiers français). */
export function detectSeparator(firstLine: string): CsvTable["separator"] {
  let best: CsvTable["separator"] = ";";
  let bestCount = -1;
  for (const s of SEPARATORS) {
    const count = firstLine.split(s).length - 1;
    if (count > bestCount) {
      best = s;
      bestCount = count;
    }
  }
  return best;
}

function splitLine(line: string, separator: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === separator) {
      cells.push(cell);
      cell = "";
    } else cell += c;
  }
  cells.push(cell);
  return cells.map((v) => v.trim());
}

export function parseCsv(text: string): CsvTable {
  const clean = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = clean.split("\n");
  const first = lines.find((l) => l.trim().length > 0) ?? "";
  const separator = detectSeparator(first);
  const header: string[] = [];
  const rows: string[][] = [];
  const lineNumbers: number[] = [];
  let headerDone = false;
  lines.forEach((line, i) => {
    if (line.trim().length === 0) return;
    const cells = splitLine(line, separator);
    if (!headerDone) {
      header.push(...cells.map((h) => h.trim()));
      headerDone = true;
      return;
    }
    if (cells.every((c) => c.length === 0)) return;
    rows.push(cells);
    lineNumbers.push(i + 1);
  });
  return { header, rows, separator, lineNumbers };
}
