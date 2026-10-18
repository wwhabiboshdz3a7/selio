/**
 * Outils de texte de l'aide (sans dépendance) : normalisation, mots vides et racines.
 * Séparés du contenu de la FAQ (./help, importé par « @selio/domain/help ») pour que les
 * contrôles de l'IA puissent s'en servir sans embarquer toute la FAQ.
 */

const STOPWORDS_TEXT = "a ai alors au aussi aux avec avez avoir c ca ce ceci cela ces cet cette comment d dans de des du elle elles en est et etre "
  + "fait faire faut il ils j je l la le les leur leurs lui m ma mais me mes moi mon n ne nos notre nous on ont ou par pas peut peux "
  + "plus pour pourquoi puis qu quand que quel quelle quelles quels qui quoi s sa se ses si son sont suis sur t ta te tes toi ton tous tout "
  + "toute toutes tu un une vos votre vous y bonjour merci svp stp";
let STOPWORDS: Set<string> | null = null;
function stopwords(): Set<string> {
  STOPWORDS ??= new Set(STOPWORDS_TEXT.split(" "));
  return STOPWORDS;
}

/** Minuscules, sans accents ni ponctuation (apostrophes et tirets deviennent des espaces). */
export function normalizeHelpText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/(\d)[\s  ](?=\d{3}\b)/g, "$1")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const SUFFIXES = ["issements", "issement", "ations", "ation", "ements", "ement", "ateurs", "ateur", "atrices", "atrice", "euses", "euse", "ables", "able", "ions", "ion", "ees", "es", "ee", "er", "ez", "ent", "e", "s", "x"];

/** Racine grossière d'un mot français (déjà normalisé) : retire un suffixe courant. */
export function helpStem(word: string): string {
  for (const s of SUFFIXES) if (word.length - s.length >= 4 && word.endsWith(s)) return word.slice(0, -s.length);
  return word;
}

/** Mots utiles d'un texte : normalisés, sans mots vides, réduits à leur racine. */
export function helpTokens(text: string): string[] {
  const words = normalizeHelpText(text).split(" ").filter((w) => w.length > 0);
  const stop = stopwords();
  const useful = words.filter((w) => !stop.has(w) && (w.length >= 2 || /\d/.test(w)));
  return useful.map(helpStem);
}
