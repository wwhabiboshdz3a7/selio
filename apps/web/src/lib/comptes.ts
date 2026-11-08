/**
 * Selio Comptes (§5.15) : accompagnement pour ouvrir et préparer un compte vendeur Vinted, sans aucune
 * action à la place du client. Selio ne crée aucun compte, ne se connecte à rien et n'envoie rien : la
 * checklist se suit dans Vinted, et les textes ci-dessous sont des modèles à copier, rédigés ici à partir
 * de quelques réponses (aucun appel à l'IA, aucune donnée envoyée).
 */

/** Bandeau obligatoire de Selio Comptes : aucune action à la place du client. */
export const COMPTES_NOTICE = "Selio ne crée aucun compte à votre place : vous suivez la checklist dans Vinted.";

export interface ChecklistStep {
  id: string;
  title: string;
  detail: string;
}

export interface ChecklistGroup {
  id: string;
  title: string;
  steps: ChecklistStep[];
}

/** Étapes à faire soi-même dans Vinted, dans l'ordre. Les identifiants sont stables (cases cochées gardées). */
export const COMPTES_CHECKLIST: readonly ChecklistGroup[] = [
  {
    id: "ouverture",
    title: "Ouvrir le compte, à votre nom",
    steps: [
      { id: "inscription", title: "Créer le compte dans l'application Vinted", detail: "Avec votre propre adresse email et un mot de passe que vous seul connaissez. Selio ne le voit jamais." },
      { id: "email", title: "Confirmer l'adresse email", detail: "Cliquez sur le lien reçu de Vinted." },
      { id: "telephone", title: "Vérifier le numéro de téléphone", detail: "Si Vinted le demande : un numéro à votre nom." },
      { id: "regles", title: "Lire les règles du catalogue et les conditions de Vinted", detail: "Ce qui peut être vendu, et comment. Elles s'appliquent à votre compte." },
    ],
  },
  {
    id: "profil",
    title: "Préparer le profil",
    steps: [
      { id: "pseudo", title: "Choisir le pseudo", detail: "Court, facile à retenir, sans marque déposée ni nom de quelqu'un d'autre." },
      { id: "photo", title: "Ajouter une photo de profil", detail: "Un logo simple ou une photo nette, sans visage d'une autre personne." },
      { id: "presentation", title: "Coller la présentation", detail: "Le texte « Présentation » ci-dessous, à relire et ajuster." },
      { id: "ville", title: "Indiquer votre ville", detail: "Elle aide les acheteurs proches et rassure." },
    ],
  },
  {
    id: "envoi",
    title: "Paiement et envoi",
    steps: [
      { id: "porte-monnaie", title: "Activer le porte-monnaie Vinted", detail: "Les vérifications d'identité se font dans Vinted, directement avec eux." },
      { id: "transporteurs", title: "Choisir les transporteurs proposés", detail: "Ceux que vous pouvez déposer facilement près de chez vous." },
      { id: "regles-envoi", title: "Préparer vos règles d'envoi", detail: "Le texte « Règles d'envoi » ci-dessous, à garder sous la main pour vos annonces et vos réponses." },
      { id: "vacances", title: "Connaître le mode vacances", detail: "Pour suspendre vos annonces quand vous ne pouvez pas expédier." },
    ],
  },
  {
    id: "demarrage",
    title: "Premières annonces",
    steps: [
      { id: "annonces", title: "Préparer 5 à 10 premières annonces", detail: "Avec Selio Studio : photos, titre, description et prix conseillé, que vous publiez vous-même." },
      { id: "reponses", title: "Garder les réponses types à portée", detail: "Les textes « Réponses types » ci-dessous, pour répondre vite et poliment." },
      { id: "relier", title: "Relier le compte à Selio", detail: "Dans Comptes Vinted, avec l'extension : c'est vous qui vous connectez, Selio ne garde aucun mot de passe." },
    ],
  },
];

export const COMPTES_STEP_IDS: readonly string[] = COMPTES_CHECKLIST.flatMap((g) => g.steps.map((s) => `${g.id}.${s.id}`));

export type ShopStyle = "femme" | "homme" | "enfant" | "vintage" | "mixte";

export const SHOP_STYLE_LABELS: Record<ShopStyle, string> = {
  femme: "Mode femme",
  homme: "Mode homme",
  enfant: "Enfant",
  vintage: "Vintage et seconde main choisie",
  mixte: "Un peu de tout",
};

export interface ComptesInput {
  /** Prénom ou nom de boutique, pour signer (facultatif). */
  signature: string;
  style: ShopStyle;
  /** Délai d'expédition annoncé, en jours ouvrés (1 à 7). */
  shippingDays: number;
  /** Lots acceptés (remise sur plusieurs articles). */
  bundles: boolean;
  /** Remise sur les lots, en %, si acceptés (0 à 50). */
  bundleDiscount: number;
  /** Envoi soigné : emballage réutilisé ou recyclé (mention facultative). */
  ecoPackaging: boolean;
}

export const DEFAULT_COMPTES_INPUT: ComptesInput = { signature: "", style: "mixte", shippingDays: 2, bundles: true, bundleDiscount: 10, ecoPackaging: true };

export interface ComptesTexts {
  presentation: string;
  shippingRules: string;
  replies: { id: string; label: string; text: string }[];
}

const STYLE_LINE: Record<ShopStyle, string> = {
  femme: "Des vêtements et accessoires pour femme, choisis avec soin",
  homme: "Des vêtements et accessoires pour homme, choisis avec soin",
  enfant: "Des vêtements pour enfants, propres et prêts à porter",
  vintage: "Des pièces vintage et de seconde main choisies une à une",
  mixte: "Des vêtements et accessoires de seconde main, choisis avec soin",
};

function clampInt(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(Number.isFinite(v) ? v : min)));
}

function days(n: number): string {
  return n <= 1 ? "1 jour ouvré" : `${n} jours ouvrés`;
}

/** Signature nettoyée : une ligne, 40 caractères au plus. */
export function cleanSignature(raw: string): string {
  return raw.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 40);
}

/**
 * Textes à copier, rédigés à partir des réponses. Déterministe : mêmes réponses, mêmes textes.
 * Aucune promesse qui engagerait le vendeur au-delà de ses réponses (délais, remises).
 */
export function generateComptesTexts(input: ComptesInput): ComptesTexts {
  const shippingDays = clampInt(input.shippingDays, 1, 7);
  const discount = clampInt(input.bundleDiscount, 0, 50);
  const bundles = input.bundles && discount > 0;
  const sign = cleanSignature(input.signature);
  const signLine = sign ? `\n\n${sign}` : "";

  const presentation = [
    `Bienvenue ! ${STYLE_LINE[input.style] ?? STYLE_LINE.mixte}.`,
    "Chaque article est vérifié, décrit honnêtement (défauts compris) et photographié à la lumière du jour.",
    `Envoi sous ${days(shippingDays)}${input.ecoPackaging ? ", dans un emballage soigné et réutilisé quand c'est possible" : ", soigneusement emballé"}.`,
    bundles ? `Lots bienvenus : −${discount} % dès 2 articles.` : "Une question ? Écrivez-moi, je réponds vite.",
  ].join("\n") + signLine;

  const shippingRules = [
    `• Expédition sous ${days(shippingDays)} après le paiement.`,
    "• Dépôt chez le transporteur choisi à l'achat ; le suivi est disponible dans Vinted.",
    input.ecoPackaging ? "• Emballage soigné, réutilisé ou recyclé quand c'est possible." : "• Emballage soigné et protégé.",
    bundles ? `• Lots : −${discount} % dès 2 articles, en un seul envoi.` : "• Pas de lot pour le moment : un article par commande.",
    "• En cas de souci à la réception, écrivez-moi avant d'évaluer : on trouve une solution.",
  ].join("\n");

  const replies = [
    { id: "disponible", label: "Article encore disponible ?", text: `Bonjour ! Oui, l'article est toujours disponible. Je l'expédie sous ${days(shippingDays)} après l'achat.${signLine}` },
    { id: "mesures", label: "Demande de mesures", text: `Bonjour ! Je vous envoie les mesures dès que possible, prises à plat. N'hésitez pas si vous avez une autre question.${signLine}` },
    {
      id: "lot",
      label: "Demande de lot",
      text: bundles
        ? `Bonjour ! Avec plaisir : ajoutez les articles à un lot, la remise de ${discount} % s'applique dès 2 articles, en un seul envoi.${signLine}`
        : `Bonjour ! Je ne fais pas de lot pour le moment, mais chaque article part rapidement et bien emballé.${signLine}`,
    },
    { id: "offre", label: "Offre trop basse", text: `Bonjour, merci pour votre offre ! Je ne peux pas descendre aussi bas, mais une proposition un peu plus proche du prix affiché m'intéresse volontiers.${signLine}` },
    { id: "envoye", label: "Colis envoyé", text: `Bonjour ! Votre colis est parti aujourd'hui, le suivi est dans Vinted. Merci pour votre achat et belle journée !${signLine}` },
  ];

  return { presentation, shippingRules, replies };
}

/** Avancement de la checklist : étapes cochées connues seulement (une ancienne étape retirée ne compte plus). */
export function checklistProgress(done: ReadonlySet<string>): { done: number; total: number; percent: number } {
  const total = COMPTES_STEP_IDS.length;
  const count = COMPTES_STEP_IDS.filter((id) => done.has(id)).length;
  return { done: count, total, percent: total === 0 ? 0 : Math.round((count / total) * 100) };
}

const CHECKLIST_KEY = (orgId: string) => `selio.comptes.${orgId}`;

export interface ComptesSaved {
  done: string[];
  input: ComptesInput;
}

/** Cases cochées et réponses, gardées sur cet appareil (rien n'est envoyé au serveur ni à Vinted). */
export function loadComptes(orgId: string, storage: Pick<Storage, "getItem"> | null = safeStorage()): ComptesSaved {
  try {
    const raw = JSON.parse(storage?.getItem(CHECKLIST_KEY(orgId)) ?? "null") as Partial<ComptesSaved> | null;
    const done = Array.isArray(raw?.done) ? raw!.done.filter((x): x is string => typeof x === "string" && COMPTES_STEP_IDS.includes(x)) : [];
    const i = (raw?.input ?? {}) as Partial<ComptesInput>;
    const style = typeof i.style === "string" && i.style in SHOP_STYLE_LABELS ? (i.style as ShopStyle) : DEFAULT_COMPTES_INPUT.style;
    return {
      done,
      input: {
        signature: typeof i.signature === "string" ? cleanSignature(i.signature) : "",
        style,
        shippingDays: typeof i.shippingDays === "number" ? clampInt(i.shippingDays, 1, 7) : DEFAULT_COMPTES_INPUT.shippingDays,
        bundles: typeof i.bundles === "boolean" ? i.bundles : DEFAULT_COMPTES_INPUT.bundles,
        bundleDiscount: typeof i.bundleDiscount === "number" ? clampInt(i.bundleDiscount, 0, 50) : DEFAULT_COMPTES_INPUT.bundleDiscount,
        ecoPackaging: typeof i.ecoPackaging === "boolean" ? i.ecoPackaging : DEFAULT_COMPTES_INPUT.ecoPackaging,
      },
    };
  } catch {
    return { done: [], input: DEFAULT_COMPTES_INPUT };
  }
}

export function saveComptes(orgId: string, value: ComptesSaved, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(CHECKLIST_KEY(orgId), JSON.stringify(value));
  } catch {
    // stockage indisponible : la checklist vaut pour cette visite
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
