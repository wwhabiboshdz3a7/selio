import { z } from "zod";
import { isoDate } from "./common";

/**
 * Selio Comptes (ex « Générateur », §5.15) : accompagnement à la mise en place d'une boutique Vinted, par
 * des CHECKLISTS et des TEXTES à recopier. Selio n'agit jamais à la place du client : aucun compte créé,
 * aucune connexion à Vinted, aucun appel vers Vinted, aucune donnée inventée sur la personne. Le client suit
 * les étapes lui-même dans l'application Vinted et coche ce qu'il a fait (progression par organisation).
 */

/** Mention d'indépendance, affichée sur la checklist et sous les textes rédigés. */
export const COMPTES_INDEPENDENCE_NOTICE = "Selio est indépendant de Vinted et n'est ni affilié, ni approuvé, ni sponsorisé par Vinted.";

/** Ce que Selio Comptes fait et ne fait pas (affiché en tête de la checklist). */
export const COMPTES_SCOPE_NOTICE =
  "Selio Comptes vous guide avec une checklist et des textes à recopier. Selio ne crée aucun compte, ne se connecte pas à Vinted et ne fait aucune action à votre place : vous suivez chaque étape vous-même dans l'application Vinted.";

// ---------------------------------------------------------------- checklist

export const ACCOUNT_CHECKLIST_SECTIONS = ["identity", "profile", "shop", "payment", "avoid"] as const;
export type AccountChecklistSection = (typeof ACCOUNT_CHECKLIST_SECTIONS)[number];

export const ACCOUNT_CHECKLIST_SECTION_LABELS: Record<AccountChecklistSection, string> = {
  identity: "Identité et conformité",
  profile: "Profil",
  shop: "Boutique",
  payment: "Paiement",
  avoid: "À ne pas faire",
};

export const ACCOUNT_CHECKLIST_STEP_IDS = [
  "identity_compliance",
  "username",
  "profile_photo",
  "presentation",
  "shipping_rules",
  "first_listings",
  "payment_settings",
  "what_not_to_do",
] as const;
export const accountChecklistStepId = z.enum(ACCOUNT_CHECKLIST_STEP_IDS);
export type AccountChecklistStepId = z.infer<typeof accountChecklistStepId>;

export interface AccountChecklistStep {
  id: AccountChecklistStepId;
  section: AccountChecklistSection;
  title: string;
  /** Pourquoi l'étape compte, en une phrase. */
  summary: string;
  /** Ce que le client fait lui-même, dans l'application Vinted ou dans Selio. */
  actions: string[];
  /** Point de vigilance (facultatif). */
  caution: string | null;
  /** Texte que Selio Comptes peut rédiger pour cette étape (POST /api/comptes/texts). */
  generatedText: "presentation" | "shippingRules" | "cannedReplies" | null;
}

/**
 * Étapes de la checklist, dans l'ordre. Contenu fixe et relu (aucune IA) : des conseils généraux, jamais un
 * avis juridique ou fiscal, et aucune règle de Vinted affirmée au-delà de « consultez les conditions de Vinted ».
 */
export const ACCOUNT_CHECKLIST: readonly AccountChecklistStep[] = [
  {
    id: "identity_compliance",
    section: "identity",
    title: "Identité et conformité Vinted",
    summary: "Un compte à votre nom, avec des informations exactes, évite les blocages au moment d'encaisser vos ventes.",
    actions: [
      "Créez vous-même votre compte dans l'application Vinted, avec votre vraie identité et une adresse email que vous consultez.",
      "Confirmez votre adresse email et votre numéro de téléphone quand Vinted vous le demande.",
      "Si Vinted vous demande de vérifier votre identité ou vos informations fiscales, faites-le depuis l'application Vinted uniquement.",
      "Lisez les conditions d'utilisation et le règlement du catalogue de Vinted avant de publier.",
      "Si vous achetez pour revendre de façon régulière, renseignez-vous sur le statut qui vous correspond (particulier ou professionnel) : Selio ne donne pas de conseil juridique ni fiscal.",
    ],
    caution: "Selio ne vous demande jamais votre mot de passe Vinted ni vos pièces d'identité.",
    generatedText: null,
  },
  {
    id: "username",
    section: "profile",
    title: "Pseudo",
    summary: "Un pseudo simple et lisible se retient et inspire confiance.",
    actions: [
      "Choisissez un pseudo court, facile à lire et lié à votre boutique.",
      "N'y mettez ni numéro de téléphone, ni adresse email, ni lien.",
      "N'utilisez pas le nom d'une marque qui ne vous appartient pas.",
    ],
    caution: null,
    generatedText: null,
  },
  {
    id: "profile_photo",
    section: "profile",
    title: "Photo de profil",
    summary: "Une photo nette et sobre rend la boutique reconnaissable.",
    actions: [
      "Prenez une photo nette, en lumière naturelle : un logo simple, vos articles ou un fond uni.",
      "N'utilisez pas la photo d'une autre personne, ni une image trouvée en ligne.",
    ],
    caution: null,
    generatedText: null,
  },
  {
    id: "presentation",
    section: "shop",
    title: "Présentation de la boutique",
    summary: "Quelques phrases claires disent ce que vous vendez et comment vous travaillez.",
    actions: [
      "Faites rédiger une présentation par Selio Comptes à partir du style de votre boutique, puis relisez-la.",
      "Corrigez-la pour qu'elle vous ressemble, puis recopiez-la vous-même dans votre profil Vinted.",
    ],
    caution: "Aucune coordonnée, aucun lien et aucune invitation à payer en dehors de Vinted dans la présentation.",
    generatedText: "presentation",
  },
  {
    id: "shipping_rules",
    section: "shop",
    title: "Règles d'envoi",
    summary: "Des règles d'envoi annoncées à l'avance évitent les malentendus avec les acheteurs.",
    actions: [
      "Faites rédiger vos règles d'envoi par Selio Comptes, puis indiquez vous-même vos vrais délais.",
      "Utilisez les modes d'envoi proposés par Vinted et gardez une preuve de dépôt.",
      "Emballez soigneusement et vérifiez l'article avant l'envoi.",
    ],
    caution: "N'annoncez que des délais que vous pouvez tenir.",
    generatedText: "shippingRules",
  },
  {
    id: "first_listings",
    section: "shop",
    title: "Premières annonces",
    summary: "Quelques annonces soignées valent mieux qu'un grand nombre d'annonces bâclées.",
    actions: [
      "Photographiez chaque article en lumière naturelle, de face, de dos, l'étiquette et les éventuels défauts.",
      "Indiquez la marque, la taille, l'état et les mesures ; signalez honnêtement chaque défaut.",
      "Utilisez Selio Studio pour préparer le texte des annonces, relisez-le, puis publiez-les vous-même.",
      "Préparez vos réponses types avec Selio Comptes pour répondre vite et poliment.",
    ],
    caution: "Publiez à un rythme raisonnable : Selio ne publie rien à votre place.",
    generatedText: "cannedReplies",
  },
  {
    id: "payment_settings",
    section: "payment",
    title: "Paramètres de paiement",
    summary: "Vos ventes sont versées sur votre porte-monnaie Vinted, puis sur votre compte bancaire.",
    actions: [
      "Renseignez vous-même vos coordonnées bancaires dans les paramètres de paiement de l'application Vinted.",
      "Vérifiez le nom du titulaire du compte bancaire : il doit correspondre à votre identité.",
      "Acceptez uniquement les paiements faits sur Vinted.",
    ],
    caution: "Selio ne vous demande jamais vos coordonnées bancaires et n'y a jamais accès.",
    generatedText: null,
  },
  {
    id: "what_not_to_do",
    section: "avoid",
    title: "Ce qu'il ne faut pas faire",
    summary: "Ces pratiques exposent votre compte à une suspension par Vinted.",
    actions: [
      "Pas de multi-comptes pour contourner une limite, une note ou une suspension.",
      "Pas de faux avis, d'échange d'avis ni d'achats arrangés pour gonfler votre note.",
      "Pas de vente ni de paiement en dehors de Vinted, ni de coordonnées dans les messages.",
      "Pas de contrefaçon, ni de photos copiées sur une autre annonce.",
      "Pas d'outil qui contourne les protections de Vinted ou agit à un rythme qui n'est pas humain.",
    ],
    caution: "En cas de doute, consultez les conditions d'utilisation de Vinted.",
    generatedText: null,
  },
];

/** Progression d'une étape (cases cochées par organisation). */
export const accountChecklistProgressEntry = z.object({
  stepId: accountChecklistStepId,
  done: z.boolean(),
  /** Date à laquelle l'étape a été cochée (null si décochée ou jamais cochée). */
  doneAt: isoDate.nullable(),
});
export type AccountChecklistProgressEntry = z.infer<typeof accountChecklistProgressEntry>;

export interface AccountChecklistProgress {
  steps: AccountChecklistProgressEntry[];
  done: number;
  total: number;
  /** Pourcentage arrondi (0 à 100). */
  percent: number;
}

/** GET /api/comptes/checklist : étapes, progression de l'organisation et mentions. */
export interface AccountChecklistView {
  steps: (AccountChecklistStep & { done: boolean; doneAt: string | null })[];
  sections: { id: AccountChecklistSection; label: string }[];
  progress: AccountChecklistProgress;
  scopeNotice: string;
  independenceNotice: string;
}

/** POST /api/comptes/progress : cocher ou décocher une étape. */
export const accountChecklistProgressInput = z.object({
  stepId: accountChecklistStepId,
  done: z.boolean(),
});
export type AccountChecklistProgressInput = z.infer<typeof accountChecklistProgressInput>;

// ---------------------------------------------------------------- textes

export const ACCOUNT_STYLES = ["femme", "homme", "enfant", "vintage", "luxe", "sport", "mixte"] as const;
export const accountStyle = z.enum(ACCOUNT_STYLES);
export type AccountStyle = z.infer<typeof accountStyle>;

export const ACCOUNT_STYLE_LABELS: Record<AccountStyle, string> = {
  femme: "Mode femme",
  homme: "Mode homme",
  enfant: "Mode enfant",
  vintage: "Vintage",
  luxe: "Luxe et créateurs",
  sport: "Sport",
  mixte: "Mixte",
};

/**
 * Ce que vend une boutique de ce style, en mots neutres (fourni à mon IA perso et repris par le gabarit sans
 * IA). Rien sur la personne : seulement le type d'articles.
 */
export const ACCOUNT_STYLE_DESCRIPTIONS: Record<AccountStyle, { articles: string; care: string; hashtags: string[] }> = {
  femme: { articles: "des vêtements et accessoires pour femme", care: "pièces vérifiées, mesures indiquées sur demande", hashtags: ["#modefemme", "#secondemain", "#dressing"] },
  homme: { articles: "des vêtements et accessoires pour homme", care: "pièces vérifiées, mesures indiquées sur demande", hashtags: ["#modehomme", "#secondemain", "#dressing"] },
  enfant: { articles: "des vêtements pour enfant", care: "pièces lavées et vérifiées, tailles indiquées clairement", hashtags: ["#modeenfant", "#secondemain", "#vetementsenfant"] },
  vintage: { articles: "des pièces vintage sélectionnées", care: "état décrit avec précision, défauts d'époque signalés", hashtags: ["#vintage", "#secondemain", "#friperie"] },
  luxe: { articles: "des pièces de marques de luxe et de créateurs", care: "état décrit avec précision, photos détaillées de l'étiquette", hashtags: ["#luxe", "#createurs", "#secondemain"] },
  sport: { articles: "des vêtements et équipements de sport", care: "état et usure décrits honnêtement", hashtags: ["#sport", "#secondemain", "#sportswear"] },
  mixte: { articles: "des vêtements et accessoires pour toute la famille", care: "pièces vérifiées, état décrit honnêtement", hashtags: ["#secondemain", "#dressing", "#mode"] },
};

export const ACCOUNT_TONES = ["friendly", "neutral", "concise"] as const;
export const accountTone = z.enum(ACCOUNT_TONES);
export type AccountTone = z.infer<typeof accountTone>;

export const ACCOUNT_TONE_LABELS: Record<AccountTone, string> = {
  friendly: "Chaleureux",
  neutral: "Neutre",
  concise: "Concis",
};

/**
 * Demande de textes : style de la boutique, nom de la boutique (facultatif, DONNÉE non fiable : jamais une
 * instruction) et ton. Aucune information sur la personne n'est demandée ni inventée.
 */
export const accountTextsInput = z.object({
  style: accountStyle,
  shopName: z
    .string()
    .trim()
    .max(40)
    .regex(/^[^<>{}[\]\n\r\t]*$/, "Nom de boutique sans caractère spécial")
    .optional()
    .transform((v) => (v ? v : undefined)),
  tone: accountTone.default("friendly"),
});
export type AccountTextsInput = z.infer<typeof accountTextsInput>;

export const ACCOUNT_CANNED_REPLIES_MIN = 3;
export const ACCOUNT_CANNED_REPLIES_MAX = 5;
export const ACCOUNT_HASHTAGS_MAX = 8;

/** Mot-dièse : « # » puis 2 à 30 lettres, chiffres ou « _ » (minuscules, accents permis). */
export const ACCOUNT_HASHTAG_RE = /^#[a-z0-9àâäçéèêëîïôöùûüÿœæ_]{2,30}$/;

export const cannedReply = z.object({
  /** Situation (« Article encore disponible ? »). */
  situation: z.string().trim().min(3).max(80),
  text: z.string().trim().min(10).max(500),
});
export type CannedReply = z.infer<typeof cannedReply>;

/** Sortie attendue de mon IA perso (et du gabarit sans IA). */
export const accountTextsOutput = z.object({
  presentation: z.string().trim().min(40).max(800),
  shippingRules: z.string().trim().min(30).max(700),
  cannedReplies: z.array(cannedReply).min(ACCOUNT_CANNED_REPLIES_MIN).max(ACCOUNT_CANNED_REPLIES_MAX),
  hashtags: z.array(z.string().trim().max(31)).max(12).default([]),
});
export type AccountTextsOutput = z.infer<typeof accountTextsOutput>;

/** Pourquoi les textes rendus viennent du gabarit sans IA plutôt que de mon IA perso. */
export const ACCOUNT_TEXTS_TEMPLATE_REASONS = ["ai_disabled", "quota_exceeded", "ai_unavailable", "invalid_output"] as const;
export type AccountTextsTemplateReason = (typeof ACCOUNT_TEXTS_TEMPLATE_REASONS)[number];

/** POST /api/comptes/texts : textes à relire et recopier soi-même. */
export interface AccountTextsResult {
  texts: AccountTextsOutput;
  /** « ai » : rédigés par mon IA perso et vérifiés ; « template » : gabarit sans IA, signalé comme tel. */
  source: "ai" | "template";
  reason: AccountTextsTemplateReason | null;
  /** Phrase affichable (ce qui a été fait, et rappel : rien n'est publié sur Vinted). */
  message: string;
  style: AccountStyle;
  tone: AccountTone;
  provider: string | null;
  model: string | null;
  /** Vrai si le texte vient du simulateur (démo, tests). */
  simulated: boolean;
  independenceNotice: string;
}
