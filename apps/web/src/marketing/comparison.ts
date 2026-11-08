/**
 * Pages « Selio ou Bleam ? » et « Alternative à Bleam ».
 *
 * Règle : ce qui est dit de Selio vient du dépôt (docs/BUILD_STATUS.md, code) ;
 * ce qui est dit de Bleam ne vient que de l'étude juridique interne (relevé du
 * 27 octobre 2026 sur la fiche App Store de Bleam et site officiel de Bleam), avec sa source,
 * et reste « à revérifier avant publication ». Tout le reste est un emplacement
 * « [Texte d'Elias à insérer] » ou « [À vérifier, avec source] » : aucune
 * affirmation non sourcée sur un concurrent (publicité comparative, à faire relire
 * par l'avocat). Les textes d'Elias ne sont pas fournis à ce jour.
 */

/** Emplacement des textes d'Elias, tel qu'affiché sur la page. */
export const ELIAS_PLACEHOLDER = "[Texte d'Elias à insérer]";
/** Case du comparatif sans source vérifiable : rien n'est affirmé. */
export const UNSOURCED_PLACEHOLDER = "[À vérifier, avec source]";

/** Date et origine du relevé des pratiques de Bleam (étude juridique interne). */
export const BLEAM_SOURCE_DATE = "27 octobre 2026";

export interface ComparisonRow {
  criterion: string;
  selio: string;
  /** Texte sur Bleam, toujours accompagné de sa source ; sinon emplacement. */
  bleam: { text: string; source: string } | null;
}

/**
 * Comparatif factuel. Côté Selio : fonctions et principes vérifiables dans le
 * dépôt. Côté Bleam : seulement ce que l'étude juridique a relevé, avec la source.
 */
export const COMPARISON_ROWS: readonly ComparisonRow[] = [
  {
    criterion: "Lien avec Vinted",
    selio: "Indépendant de Vinted : ni affilié, ni approuvé, ni sponsorisé.",
    bleam: { text: "Se présente comme non affilié à Vinted.", source: "fiche App Store de Bleam" },
  },
  {
    criterion: "Discours sur le risque",
    selio: "Aucune promesse d'absence de risque : rythme humain, plafonds par jour, arrêt au premier CAPTCHA ou avertissement.",
    bleam: { text: "Parle d'un risque « faible », jamais nul.", source: "site officiel de Bleam" },
  },
  {
    criterion: "Rythme des publications",
    selio: "Plafonds réglables par jour et par acheteur ; les republications en masse depuis notre machine restent désactivées.",
    bleam: { text: "Conseille moins de 30 publications par jour et par compte.", source: "aide du site officiel de Bleam (« combien republier par jour »)" },
  },
  {
    criterion: "Mot de passe Vinted",
    selio: "Jamais demandé ni stocké : l'extension lit la page que vous avez ouverte ; dans Selio Cloud, vous vous connectez vous-même.",
    bleam: null,
  },
  {
    criterion: "Protections de Vinted",
    selio: "Aucun contournement de CAPTCHA ni de protection anti-robot, aucune adresse IP masquée, aucun proxy par compte.",
    bleam: null,
  },
  {
    criterion: "Où sont vos données",
    selio: "Base de données, photos et mon IA perso sur notre machine, en France ; aucun fournisseur d'IA tiers.",
    bleam: { text: "Dit ne pas vendre les données.", source: "politique de confidentialité du site officiel de Bleam" },
  },
  {
    criterion: "Après un blocage de compte",
    selio: "Le compte est mis en pause avec la raison ; rien n'est retenté, la reprise vous appartient.",
    bleam: { text: "Propose de restaurer le catalogue sur un nouveau compte en cas de bannissement.", source: "site officiel de Bleam" },
  },
  {
    criterion: "Prix conseillé",
    selio: "Tiré des ventes comparables (fourchette et délai) ; l'IA explique le prix, elle ne le choisit pas.",
    bleam: null,
  },
  {
    criterion: "Marge de bout en bout",
    selio: "Prix d'achat (Radar ou saisi) reporté jusqu'à la commande de revente.",
    bleam: null,
  },
  {
    criterion: "Contrôle des annonces et lots",
    selio: "Photo floue et mesures manquantes signalées par catégorie ; lots proposés (même acheteur, même marque et taille).",
    bleam: null,
  },
  {
    criterion: "Venir depuis un autre outil",
    selio: "Vous collez vos réglages, envoyez des captures ou un fichier obtenu au titre du RGPD ; jamais de connexion à l'autre outil à votre place.",
    bleam: null,
  },
];

/** Les principes de Selio, vérifiables dans le code (docs/SECURITY.md, DECISIONS.md). */
export const SELIO_PRINCIPLES: readonly { title: string; text: string }[] = [
  { title: "Pas de contournement", text: "Aucun CAPTCHA contourné, aucune protection anti-robot désactivée, aucune adresse IP masquée. Au premier signal, Selio s'arrête et vous prévient." },
  { title: "Pas de mot de passe", text: "Selio ne demande ni ne stocke votre mot de passe Vinted. La seule session gardée est celle de Selio Cloud, avec votre accord, chiffrée et supprimée dès que vous partez." },
  { title: "Vous validez", text: "Les actions importantes (prix, achat) attendent votre validation, sauf réglage explicite de votre part. Un bouton arrête tout." },
  { title: "Données en France", text: "Base de données, photos et mon IA perso tournent sur notre machine, en France. Track ne garde aucune donnée personnelle de vendeurs ; Radar n'en garde que le temps d'une affaire, 30 jours au plus." },
];

/** Migration depuis Bleam, Clemz ou V-Tools : ce que fait vraiment Selio (D53). */
export const MIGRATION_STEPS: readonly string[] = [
  "Collez vos réglages actuels, ou envoyez des captures d'écran, ou un fichier obtenu au titre de la portabilité RGPD.",
  "Mon IA perso propose une correspondance « ancien → nouveau », champ par champ, avec son niveau de confiance.",
  "Vous cochez ce qui vous convient ; rien n'est appliqué sans votre coche.",
  "Selio ne se connecte jamais à l'autre outil et ne vous demande jamais ses identifiants.",
];
