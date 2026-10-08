/**
 * Les messages acheteurs et contenus marketplace sont des données NON FIABLES.
 * Ils ne sont jamais interprétés comme des instructions ; on les nettoie,
 * on les borne et on repère les tentatives d'injection pour l'audit.
 */

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g;

export function sanitizeUntrustedText(input: string, maxLength = 4000): string {
  return input.replace(CONTROL_CHARS, "").replace(/\r\n?/g, "\n").trim().slice(0, maxLength);
}

const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |previous |the )?(instructions|rules|prompts?)/i,
  /ignore[sz]? (toutes |les )?(instructions|consignes|règles)/i,
  /(you are|tu es|vous êtes) (now |désormais |maintenant )?(an? |un |une )?(assistant|ai|ia|système|system)/i,
  /system prompt|prompt système|developer message/i,
  /\b(accept|accepte[rz]?) (the |l')?(offer|offre) (at|à) \d/i,
  /<\s*\/?\s*(script|iframe|img|svg|object|embed)\b/i,
  /\bjavascript:/i,
  /\{\{.*\}\}/,
];

export interface InjectionScan {
  suspicious: boolean;
  matches: string[];
}

export function scanForInjection(text: string): InjectionScan {
  const matches: string[] = [];
  for (const re of INJECTION_PATTERNS) {
    const m = text.match(re);
    if (m) matches.push(m[0].slice(0, 80));
  }
  return { suspicious: matches.length > 0, matches };
}

/** Échappe le HTML (affichage de texte non fiable dans une page web ou l'extension). */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
