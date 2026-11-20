// Tous les textes publicitaires (Meta, Instagram, Google Ads Search et Performance Max), leurs limites
// de longueur vérifiées par script, et l'écriture de ../textes.md et ../google-ads-editeur.csv.
// node textes.mjs        → vérifie puis écrit ; sort en erreur si une limite est dépassée.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const SITE = "https://seliovprod.netlify.app";
const utm = (source, medium, campaign, content) => `utm_source=${source}&utm_medium=${medium}&utm_campaign=${campaign}${content ? `&utm_content=${content}` : ""}`;

/* =============================================================================================
 * META (Facebook, Instagram) — tutoiement, comme les vidéos et les réseaux
 * Limites vérifiées : texte court ≤ 125 (visible sans « Voir plus »), titre ≤ 40, description ≤ 30.
 * =========================================================================================== */
export const META = [
  {
    key: "A", slug: "manager", produit: "Selio Manager", page: "/logiciel-vinted",
    concept: "Toute ton activité Vinted au même endroit",
    accroches: ["Trois comptes, trois onglets, des offres qui attendent ?", "Ton stock est dans un tableur, tes offres dans l'appli, tes marges dans ta tête ?"],
    court: "Stock, messages, offres, commandes et marges de tous tes comptes Vinted, dans un seul tableau. Essai gratuit 14 jours.",
    long: [
      "Trois comptes, trois onglets, des offres qui attendent ?",
      "Selio Manager rassemble toute ton activité de revente au même endroit :",
      "• ton stock et ton dressing, avec les annonces à republier\n• la messagerie et la négociation par IA, selon tes prix planchers\n• les relances des favoris et l'après-vente\n• les commandes et la marge de chaque article\n• jusqu'à 10 comptes connectés, et ton équipe avec des rôles (offre Agence)",
      "Tu fixes les règles, tu gardes la main : un bouton arrête toutes les automatisations.",
      "Essai gratuit de 14 jours, rien n'est débité avant la fin. Selio est un outil indépendant, non affilié à Vinted.",
    ],
    titre: "Tous tes comptes, un seul tableau",
    description: "Essai gratuit 14 jours",
    cta: "S'inscrire",
    instagram: "Trois comptes, trois onglets et des offres qui attendent ? 😮‍💨\n\nSelio Manager rassemble ton stock, tes messages, tes offres, tes commandes et tes marges, sur tous tes comptes. Tu fixes les règles, tu gardes la main.\n\nEssai gratuit 14 jours : lien en bio.\nSelio est indépendant de Vinted.",
    hashtags: ["#revendeur", "#achatrevente", "#secondemain", "#friperie", "#vintage", "#modecirculaire", "#entrepreneur", "#vinted"],
  },
  {
    key: "B", slug: "studio", produit: "Selio Studio", page: "/annonce-vinted-ia",
    concept: "Tes photos deviennent une annonce",
    accroches: ["Tu prends les photos. Selio écrit l'annonce.", "Encore 20 annonces à rédiger ce soir ?"],
    court: "Ajoute tes photos : Selio Studio lit l'étiquette et rédige titre, description et prix conseillé. Tu relis, tu publies.",
    long: [
      "Tu prends les photos. Selio écrit l'annonce.",
      "Exemple avec un jean : Selio Studio lit l'étiquette (marque, taille, matière), relève le tour de taille sur la photo du mètre ruban, puis rédige :",
      "« Jean Levi's 501 Original droit bleu W32 L32 — 100 % coton »\n+ une description complète (coupe, matière, entretien, état, mesures, conseils de taille)\n+ un prix conseillé.",
      "Ce qui n'est pas lu sur les photos n'est pas inventé : une mesure ou une matière inconnue est retirée, et une lecture douteuse te pose une question.",
      "Tu relis, tu modifies si besoin, tu publies. Essai gratuit 14 jours. Selio est indépendant de Vinted.",
    ],
    titre: "Tes photos deviennent une annonce",
    description: "Titre, description et prix",
    cta: "Essayer",
    instagram: "Tu prends les photos. Selio écrit l'annonce. 📸➡️📝\n\nSelio Studio lit l'étiquette, relève les mesures sur la photo du mètre ruban et rédige le titre, la description et le prix conseillé. Rien n'est inventé : tu relis, tu publies.\n\nEssai gratuit 14 jours : lien en bio.\nExemple réalisé avec des photos de démonstration. Selio est indépendant de Vinted.",
    hashtags: ["#revendeur", "#annonce", "#achatrevente", "#secondemain", "#friperie", "#denim", "#vintage", "#vinted"],
  },
  {
    key: "C", slug: "bot", produit: "Selio Bot", page: "/bot-achat-vinted",
    concept: "Trouve les bonnes affaires avant les autres",
    accroches: ["La bonne affaire est partie en 3 minutes. Encore.", "Tu rafraîchis la recherche toutes les 5 minutes ?"],
    court: "Selio Bot surveille tes recherches, note chaque affaire sur 100 et t'alerte. Tu valides l'achat en 1 clic, dans tes limites.",
    long: [
      "La bonne affaire est partie en 3 minutes. Encore.",
      "Selio Bot surveille tes recherches à ta place :",
      "• chaque nouvelle annonce reçoit une note sur 100\n• le prix de revente et la marge sont estimés avant l'achat\n• une alerte arrive dès qu'une affaire dépasse ton seuil\n• tu valides l'achat en 1 clic, avec un budget par jour et un maximum par achat",
      "Les estimations aident à décider, elles ne garantissent pas une revente.",
      "Essai gratuit de 14 jours. Selio est un outil indépendant, non affilié à Vinted.",
    ],
    titre: "Les bonnes affaires, notées sur 100",
    description: "Alerte et achat en 1 clic",
    cta: "S'inscrire",
    instagram: "La bonne affaire est partie en 3 minutes. Encore. ⏱️\n\nSelio Bot surveille tes recherches, note chaque nouvelle annonce sur 100 et t'alerte. Tu valides l'achat en 1 clic, avec tes limites de dépenses.\n\nEssai gratuit 14 jours : lien en bio.\nChiffres de démonstration à l'écran. Selio est indépendant de Vinted.",
    hashtags: ["#revendeur", "#achatrevente", "#bonplan", "#friperie", "#secondemain", "#vintage", "#resell", "#vinted"],
  },
  {
    key: "D", slug: "track", produit: "Selio Track", page: "/prix-revente-vinted",
    concept: "Sache quoi acheter",
    accroches: ["Acheté 8 €. Ça se revend combien ?", "Avant d'acheter, regarde le marché."],
    court: "Niches notées sur 100, prix de revente médian, fourchette et recherche par photo : Selio Track t'aide à savoir quoi acheter.",
    long: [
      "Acheté 8 €. Ça se revend combien ?",
      "Selio Track analyse le marché pour toi :",
      "• chaque niche notée sur 100 (demande, vitesse de vente, concurrence, marge)\n• le prix de revente médian et la fourchette habituelle\n• les annonces disparues, signe de ventes\n• la recherche par photo, en friperie comme en vide-grenier",
      "Track analyse et identifie ; il n'achète rien à ta place.",
      "Essai gratuit de 14 jours. Selio est un outil indépendant, non affilié à Vinted.",
    ],
    titre: "Sache quoi acheter avant d'acheter",
    description: "Prix de revente et niches",
    cta: "En savoir plus",
    instagram: "Acheté 8 €. Ça se revend combien ? 🤔\n\nSelio Track note chaque niche sur 100, donne le prix de revente médian et la fourchette habituelle, et estime un article à partir d'une simple photo.\n\nEssai gratuit 14 jours : lien en bio.\nChiffres d'exemple dans le visuel. Selio est indépendant de Vinted.",
    hashtags: ["#revendeur", "#achatrevente", "#friperie", "#videgrenier", "#secondemain", "#vintage", "#resell", "#vinted"],
  },
];

/* =============================================================================================
 * GOOGLE ADS — Search (annonces responsives) : vouvoiement, comme la vitrine.
 * Titres ≤ 30, descriptions ≤ 90, chemins ≤ 15. « Vinted » limité à quelques titres (marque d'un tiers).
 * =========================================================================================== */
const TRIAL_DESC = "Essai gratuit 14 jours, rien n'est débité avant la fin. Selio est indépendant de Vinted.";

export const SEARCH = [
  {
    campagne: "Search · Gestion multi-comptes", groupe: "Logiciel et multi-comptes", page: "/logiciel-vinted", path1: "logiciel", path2: "multi-comptes",
    titres: [
      "Logiciel pour vendeurs Vinted", "Gérez plusieurs comptes Vinted", "Tous vos comptes, un tableau", "Stock, messages et commandes", "La marge de chaque article",
      "Jusqu'à 10 comptes connectés", "Essai gratuit de 14 jours", "Négociation selon vos règles", "Relances des favoris", "Pensé pour l'achat-revente",
      "Rôles et accès pour l'équipe", "Selio Manager", "Vous gardez la main", "Dressing et remise en ligne", "Résiliable à tout moment",
    ],
    descriptions: [
      "Stock, dressing, messages, commandes et marges de tous vos comptes dans un seul outil.",
      "Négociation par IA et relances selon vos règles : prix plancher et paliers. Vous validez.",
      "De 1 à 10 comptes selon l'offre, en équipe avec des rôles. Au mois, sans engagement.",
      TRIAL_DESC,
    ],
    exact: ["logiciel vinted", "outil vinted", "gestion compte vinted", "gérer plusieurs comptes vinted", "multi compte vinted", "application pour vendeur vinted", "gestion stock vinted", "logiciel achat revente"],
    expression: ["logiciel vinted", "outil vendeur vinted", "plusieurs comptes vinted", "gestion stock vinted", "logiciel achat revente", "outil revendeur vêtements"],
    negatifs: ["acheteur", "comment acheter", "particulier gratuit", "excel gratuit"],
  },
  {
    campagne: "Search · Annonce Vinted IA", groupe: "Annonces par l'IA", page: "/annonce-vinted-ia", path1: "annonce", path2: "ia",
    titres: [
      "Vos annonces Vinted par l'IA", "Générateur d'annonces Vinted", "De la photo à l'annonce", "Titre, description et prix", "L'étiquette lue sur la photo",
      "Marque, taille, matière lues", "Mesures relevées au ruban", "Un prix conseillé par article", "Aucune mesure inventée", "Vous relisez, vous publiez",
      "Selio Studio", "Essai gratuit de 14 jours", "Description claire et complète", "Titres optimisés pour Vinted", "Moins de saisie à la main",
    ],
    descriptions: [
      "Ajoutez vos photos : Selio Studio lit l'étiquette et rédige titre, description et prix.",
      "Marque, taille et matière lues sur l'étiquette ; aucune mesure inventée. Vous validez.",
      "En brouillon ou publiée : vous relisez chaque annonce avant sa mise en ligne.",
      TRIAL_DESC,
    ],
    exact: ["annonce vinted ia", "générateur annonce vinted", "description vinted ia", "titre annonce vinted", "rédiger annonce vinted", "ia vinted", "créer annonce vinted", "description vinted"],
    expression: ["annonce vinted ia", "générateur annonce vinted", "description vinted", "titre annonce vinted", "rédiger annonce vinted", "ia pour vinted"],
    negatifs: ["photo de profil", "logo", "image libre de droits", "annonce immobilière", "leboncoin"],
  },
  {
    campagne: "Search · Prix de revente Vinted", groupe: "Prix de revente et marché", page: "/prix-revente-vinted", path1: "prix", path2: "revente",
    titres: [
      "Prix de revente sur Vinted", "Sachez quoi acheter", "Niches notées sur 100", "Prix médian et fourchette", "Recherche par photo",
      "Estimez avant d'acheter", "Analyse du marché Vinted", "Annonces disparues suivies", "Demande, concurrence, marge", "Selio Track",
      "Essai gratuit de 14 jours", "À quel prix le revendre ?", "Repérez les niches porteuses", "Des chiffres pour décider", "Pour l'achat-revente",
    ],
    descriptions: [
      "Selio Track estime le prix de revente : prix médian, fourchette et ventes comparables.",
      "Chaque niche reçoit une note sur 100 : demande, vitesse de vente, concurrence et marge.",
      "Une photo suffit pour estimer un article avant de l'acheter, en friperie ou en brocante.",
      TRIAL_DESC,
    ],
    exact: ["prix revente vinted", "estimer prix vinted", "combien vendre sur vinted", "quel prix mettre vinted", "analyse marché vinted", "quoi acheter pour revendre", "niche vinted", "article qui se vend bien vinted"],
    expression: ["prix revente vinted", "estimation prix vinted", "quoi revendre sur vinted", "achat revente vinted", "prix vêtement occasion"],
    negatifs: ["voiture", "immobilier", "appartement", "maison", "or", "argus", "téléphone"],
  },
  {
    campagne: "Search · Bot achat Vinted", groupe: "Recherche et achat", page: "/bot-achat-vinted", path1: "bot", path2: "achat",
    titres: [
      "Bot d'achat pour Vinted", "Bonnes affaires notées sur 100", "Alertes dès la publication", "Achat rapide validé en 1 clic", "Limites de dépenses par jour",
      "Revente et marge estimées", "Vos recherches surveillées", "Selio Bot", "Essai gratuit de 14 jours", "Trouvez les bonnes affaires",
      "Repérez les affaires tôt", "Vous validez chaque achat", "Historique des achats", "Pour les pros de la revente", "Score d'intérêt sur 100",
    ],
    descriptions: [
      "Selio Bot surveille vos recherches, note chaque affaire sur 100 et vous alerte aussitôt.",
      "Revente et marge estimées avant l'achat. Des estimations pour décider, sans garantie.",
      "Achat rapide validé par vous en 1 clic, avec un budget par jour et un maximum par achat.",
      TRIAL_DESC,
    ],
    exact: ["bot vinted", "bot achat vinted", "alerte vinted", "alerte nouvelle annonce vinted", "bonnes affaires vinted", "notification nouvelle annonce vinted", "vinted sniper"],
    expression: ["bot vinted", "alerte vinted", "bonnes affaires vinted", "achat revente vinted", "acheter pour revendre"],
    negatifs: ["github", "python", "code source", "script", "tuto", "discord gratuit"],
  },
  {
    campagne: "Search · Négociation automatique", groupe: "Négociation et relances", page: "/negociation-automatique-vinted", path1: "negociation", path2: "auto",
    titres: [
      "Négociation auto sur Vinted", "Contre-offres automatiques", "Prix plancher respecté", "Relance des favoris après 24 h", "Messages aux favoris",
      "Réponses par IA, vos règles", "Vous gardez la main", "Tout s'arrête en un clic", "Selio Manager", "Essai gratuit de 14 jours",
      "Négociation par IA", "Paliers de remise réglables", "Moins de messages à gérer", "Plus d'offre oubliée", "Après-vente et réponses",
    ],
    descriptions: [
      "Selio prépare vos contre-offres selon votre prix plancher et vos paliers de remise.",
      "Relances après 24 h et messages aux favoris selon vos règles. Un bouton arrête tout.",
      "Fonctionne avec l'extension Selio, navigateur ouvert. Vous gardez la main à tout moment.",
      TRIAL_DESC,
    ],
    exact: ["négociation automatique vinted", "répondre offre vinted", "contre offre vinted", "relance favoris vinted", "message favoris vinted", "automatiser vinted", "vinted automatique"],
    expression: ["négociation vinted", "offre vinted", "favoris vinted", "automatiser vinted", "réponse automatique vinted"],
    negatifs: ["faire une offre", "annuler une offre", "offre acheteur", "payer", "code promo vinted"],
  },
];

/** Mots-clés négatifs communs (liste partagée, à appliquer aux cinq campagnes Search). */
export const NEGATIFS_COMMUNS = [
  "[vinted]", "[vinted.fr]", "[application vinted]", "[télécharger vinted]", "\"vinted pro\"", "\"vinted go\"",
  "connexion", "se connecter", "login", "mot de passe", "service client", "contact", "numéro", "remboursement", "litige",
  "colis", "suivi", "point relais", "mondial relay", "supprimer compte", "emploi", "recrutement", "stage", "salaire",
  "apk", "crack", "gratuit illimité", "arnaque",
];

export const EXTENSIONS = {
  liens: [
    { texte: "Selio Manager", l1: "Stock, messages et commandes", l2: "Jusqu'à 10 comptes connectés", url: "/logiciel-vinted" },
    { texte: "Selio Studio", l1: "Annonces rédigées par l'IA", l2: "À partir de vos photos", url: "/annonce-vinted-ia" },
    { texte: "Selio Track", l1: "Analyse du marché", l2: "Niches notées sur 100", url: "/prix-revente-vinted" },
    { texte: "Selio Bot", l1: "Bonnes affaires notées", l2: "Achat validé par vous", url: "/bot-achat-vinted" },
    { texte: "Négociation automatique", l1: "Contre-offres et relances", l2: "Selon vos règles", url: "/negociation-automatique-vinted" },
    { texte: "Tarifs", l1: "Starter, Pro et Agence", l2: "Au mois ou à l'année", url: "/tarifs" },
  ],
  accroches: ["Essai gratuit 14 jours", "Rien débité avant la fin", "Résiliable à tout moment", "Jusqu'à 10 comptes", "Vous gardez la main", "2 mois offerts à l'année", "Rôles pour l'équipe", "Sans engagement"],
  extraits: [
    { entete: "Services", valeurs: ["Gestion multi-comptes", "Annonces par l'IA", "Analyse du marché", "Recherche d'articles", "Configuration", "Accompagnement 30 jours"] },
    { entete: "Types", valeurs: ["Starter", "Pro", "Agence"] },
  ],
};

/* =============================================================================================
 * GOOGLE ADS — Performance Max : une campagne, quatre groupes d'éléments (un par concept).
 * Titres ≤ 30 (3 à 15), titres longs ≤ 90 (1 à 5), descriptions ≤ 90 (2 à 5, dont une ≤ 60).
 * =========================================================================================== */
export const PMAX = {
  nomEntreprise: "Selio",
  groupes: [
    {
      nom: "A · Manager", page: "/logiciel-vinted", concept: "A", slug: "manager",
      titres: ["Logiciel pour vendeurs Vinted", "Tous vos comptes, un tableau", "Stock, messages et commandes", "La marge de chaque article", "Essai gratuit de 14 jours", "Vous gardez la main", "Jusqu'à 10 comptes connectés", "Négociation selon vos règles"],
      longs: ["Toute votre activité Vinted au même endroit : stock, messages, offres et marges", "Gérez jusqu'à 10 comptes et votre équipe dans un seul outil. Essai gratuit 14 jours"],
      descriptions: ["Tous vos comptes dans un seul tableau.", "Stock, dressing, messages, commandes et marges de tous vos comptes dans un seul outil.", "Négociation par IA et relances selon vos règles. Un bouton arrête tout.", TRIAL_DESC],
    },
    {
      nom: "B · Studio", page: "/annonce-vinted-ia", concept: "B", slug: "studio",
      titres: ["Vos annonces Vinted par l'IA", "De la photo à l'annonce", "Titre, description et prix", "L'étiquette lue sur la photo", "Aucune mesure inventée", "Vous relisez, vous publiez", "Essai gratuit de 14 jours", "Selio Studio"],
      longs: ["Vos photos deviennent une annonce : titre, description et prix conseillé rédigés pour vous", "Marque, taille et matière lues sur l'étiquette. Vous relisez, vous publiez"],
      descriptions: ["Des photos à l'annonce prête à relire.", "Ajoutez vos photos : Selio Studio lit l'étiquette et rédige titre, description et prix.", "Ce qui n'est pas lu sur les photos n'est pas inventé. Vous validez chaque annonce.", TRIAL_DESC],
    },
    {
      nom: "C · Bot", page: "/bot-achat-vinted", concept: "C", slug: "bot",
      titres: ["Bonnes affaires notées sur 100", "Alertes dès la publication", "Achat rapide validé en 1 clic", "Limites de dépenses par jour", "Vous validez chaque achat", "Essai gratuit de 14 jours", "Selio Bot", "Trouvez les bonnes affaires"],
      longs: ["Trouvez les bonnes affaires avant les autres : chaque annonce notée sur 100", "Alertes, revente estimée et achat rapide validé par vous, dans vos limites de dépenses"],
      descriptions: ["Chaque affaire notée sur 100, une alerte.", "Selio Bot surveille vos recherches, note chaque affaire sur 100 et vous alerte aussitôt.", "Achat rapide validé par vous en 1 clic, avec un budget par jour et un maximum par achat.", TRIAL_DESC],
    },
    {
      nom: "D · Track", page: "/prix-revente-vinted", concept: "D", slug: "track",
      titres: ["Sachez quoi acheter", "Prix de revente sur Vinted", "Niches notées sur 100", "Prix médian et fourchette", "Recherche par photo", "Estimez avant d'acheter", "Essai gratuit de 14 jours", "Selio Track"],
      longs: ["Sachez quoi acheter : niches notées sur 100, prix de revente et recherche par photo", "Estimez le prix de revente d'un article avant de l'acheter. Essai gratuit 14 jours"],
      descriptions: ["Le marché analysé avant d'acheter.", "Selio Track estime le prix de revente : prix médian, fourchette et ventes comparables.", "Chaque niche reçoit une note sur 100 : demande, vitesse de vente, concurrence et marge.", TRIAL_DESC],
    },
  ],
};

/* =============================================================================================
 * Vérification des longueurs
 * =========================================================================================== */
const len = (s) => [...s].length;
export function verifier() {
  const err = [];
  const max = (s, n, ou) => { if (len(s) > n) err.push(`${ou} : ${len(s)} > ${n} — « ${s} »`); };
  const tous = (a, n, ou) => a.forEach((s) => max(s, n, ou));
  const unique = (a, ou) => { const d = a.filter((x, i) => a.indexOf(x) !== i); if (d.length) err.push(`${ou} : doublons ${d.join(", ")}`); };
  const sansPoint = (a, ou) => a.forEach((s) => { if (/!/.test(s)) err.push(`${ou} : point d'exclamation interdit dans un titre — « ${s} »`); });
  for (const m of META) {
    max(m.court, 125, `Meta ${m.key} texte court`); max(m.titre, 40, `Meta ${m.key} titre`); max(m.description, 30, `Meta ${m.key} description`);
    max(m.instagram + "\n\n" + m.hashtags.join(" "), 2200, `Instagram ${m.key} légende`);
  }
  for (const c of SEARCH) {
    if (c.titres.length !== 15) err.push(`${c.campagne} : ${c.titres.length} titres au lieu de 15`);
    if (c.descriptions.length !== 4) err.push(`${c.campagne} : ${c.descriptions.length} descriptions au lieu de 4`);
    tous(c.titres, 30, `${c.campagne} titre`); tous(c.descriptions, 90, `${c.campagne} description`);
    max(c.path1, 15, `${c.campagne} chemin 1`); max(c.path2, 15, `${c.campagne} chemin 2`);
    unique(c.titres, c.campagne); sansPoint(c.titres, c.campagne);
    const avecMarque = c.titres.filter((t) => /vinted/i.test(t)).length;
    if (avecMarque > 4) err.push(`${c.campagne} : ${avecMarque} titres citent Vinted (4 au plus)`);
  }
  for (const l of EXTENSIONS.liens) { max(l.texte, 25, "Lien annexe"); max(l.l1, 35, "Lien annexe ligne 1"); max(l.l2, 35, "Lien annexe ligne 2"); }
  tous(EXTENSIONS.accroches, 25, "Accroche");
  for (const e of EXTENSIONS.extraits) tous(e.valeurs, 25, `Extrait ${e.entete}`);
  max(PMAX.nomEntreprise, 25, "PMax nom");
  for (const g of PMAX.groupes) {
    tous(g.titres, 30, `PMax ${g.nom} titre`); tous(g.longs, 90, `PMax ${g.nom} titre long`); tous(g.descriptions, 90, `PMax ${g.nom} description`);
    if (!g.descriptions.some((d) => len(d) <= 60)) err.push(`PMax ${g.nom} : aucune description de 60 caractères au plus`);
    if (g.titres.length < 3 || g.titres.length > 15 || g.longs.length < 1 || g.longs.length > 5 || g.descriptions.length < 2 || g.descriptions.length > 5) err.push(`PMax ${g.nom} : nombre d'éléments hors limites`);
    sansPoint(g.titres, `PMax ${g.nom}`);
  }
  return err;
}

/* =============================================================================================
 * Écriture de textes.md et du CSV pour Google Ads Editor
 * =========================================================================================== */
const n = (s) => `${s} *(${len(s)})*`;
const md = [];
md.push(`# Selio — textes publicitaires

Réalisé par Ibrahim · 20 novembre 2026 · fichier généré par \`source/textes.mjs\` (les longueurs entre parenthèses sont comptées par le script ; ne pas modifier ce fichier à la main, modifier le script puis relancer \`node textes.mjs\`).

**Règles suivies partout** : aucune promesse de gain chiffrée, aucun témoignage ni avis, aucun nombre d'utilisateurs ; chiffres des visuels marqués « exemple » ; aucun logo ni couleur de Vinted (le mot « Vinted » n'apparaît qu'en texte, pour dire à quoi sert Selio) ; mention « Selio est indépendant de Vinted » ; l'utilisateur fixe ses règles et valide ; essai gratuit de 14 jours avec carte enregistrée, rien débité avant la fin (à dire sur la page d'arrivée). Tutoiement sur Meta et Instagram (comme les vidéos et les réseaux), vouvoiement sur Google (comme la vitrine).

Prix (indicatifs, \`packages/demo-data/src/plans.ts\`) : Starter 6,99 €, Pro 24,99 €, Agence 49,99 € par mois. Ils ne sont pas dans les annonces tant qu'ils ne sont pas définitifs.

## Sommaire

1. Meta et Instagram (4 concepts)
2. Google Ads — Search (5 campagnes par intention)
3. Google Ads — mots-clés négatifs communs et extensions
4. Google Ads — Performance Max
5. Liens et paramètres de suivi
`);

md.push(`## 1. Meta et Instagram

Limites vérifiées : texte court ≤ 125 caractères (visible sans « Voir plus »), titre ≤ 40, description ≤ 30. Lien : la page d'arrivée du concept, avec les paramètres \`utm\` (partie 5). Visuels : \`visuels/meta/\` (carré 1080 × 1080, portrait 1080 × 1350, story/reel 1080 × 1920, lien 1200 × 628). Vidéos : \`../video/Selio-*.mp4\` (9:16) pour les reels et stories.
`);
for (const m of META) {
  md.push(`### Concept ${m.key} — « ${m.concept} » (${m.produit})

- **Page d'arrivée** : \`${SITE}${m.page}?${utm("meta", "paid_social", `selio-${m.slug}`, "{{ad.name}}")}\`
- **Accroche A** : ${m.accroches[0]}
- **Accroche B** (test A/B) : ${m.accroches[1]}
- **Texte principal court** : ${n(m.court)}
- **Titre** : ${n(m.titre)}
- **Description** : ${n(m.description)}
- **Bouton (CTA Meta)** : ${m.cta}
- **Visuels** : \`visuels/meta/selio-${m.key}-${m.slug}-meta-*.jpg\`

**Texte principal long** :

${m.long.map((p) => p.split("\n").join("  \n")).join("\n\n")}

**Légende Instagram** (publication ou publicité) :

${m.instagram.split("\n").join("  \n")}

${m.hashtags.join(" ")}
`);
}

md.push(`## 2. Google Ads — Search

Annonces responsives sur le Réseau de Recherche : 15 titres (≤ 30 caractères), 4 descriptions (≤ 90), deux chemins d'URL (≤ 15). Toutes les longueurs sont vérifiées par \`node textes.mjs\`. « Vinted » figure dans 4 titres au plus par annonce : si l'usage de la marque est refusé, les autres titres suffisent. Ne pas épingler de titre (laisser Google combiner), sauf exigence de l'avis juridique. Import possible dans Google Ads Editor : \`google-ads-editeur.csv\`.
`);
for (const c of SEARCH) {
  md.push(`### ${c.campagne}

- **Groupe d'annonces** : ${c.groupe}
- **URL finale** : \`${SITE}${c.page}\`
- **Suffixe de l'URL finale** : \`${utm("google", "cpc", "{_campagne}", "{creative}")}\`, avec \`{_campagne}\` = \`search-${c.page.slice(1)}\`
- **URL affichée** : seliovprod.netlify.app/${c.path1}/${c.path2}

**Titres**

${c.titres.map((t, i) => `${i + 1}. ${n(t)}`).join("\n")}

**Descriptions**

${c.descriptions.map((t, i) => `${i + 1}. ${n(t)}`).join("\n")}

**Mots-clés exacts** : ${c.exact.map((k) => `\`[${k}]\``).join(", ")}

**Mots-clés en expression** : ${c.expression.map((k) => `\`"${k}"\``).join(", ")}

**Mots-clés négatifs de la campagne** : ${c.negatifs.map((k) => `\`${k}\``).join(", ")}
`);
}

md.push(`## 3. Google Ads — mots-clés négatifs communs et extensions

**Liste partagée de mots-clés négatifs** (à associer aux cinq campagnes ; les crochets = correspondance exacte, les guillemets = expression, sinon requête large) :

${NEGATIFS_COMMUNS.map((k) => `\`${k}\``).join(", ")}

**Liens annexes** (texte ≤ 25, lignes ≤ 35)

| Texte | Ligne 1 | Ligne 2 | URL |
| --- | --- | --- | --- |
${EXTENSIONS.liens.map((l) => `| ${n(l.texte)} | ${n(l.l1)} | ${n(l.l2)} | \`${l.url}\` |`).join("\n")}

**Accroches** (≤ 25) : ${EXTENSIONS.accroches.map(n).join(" · ")}

**Extraits de site** (valeurs ≤ 25)

${EXTENSIONS.extraits.map((e) => `- **${e.entete}** : ${e.valeurs.map(n).join(", ")}`).join("\n")}
`);

md.push(`## 4. Google Ads — Performance Max

Une campagne « PMax · Selio », quatre groupes d'éléments (un par concept), chacun avec sa page d'arrivée. Nom de l'entreprise : **${PMAX.nomEntreprise}**. Signaux d'audience : les mots-clés des campagnes Search (segment personnalisé « recherches »), les visiteurs du site, et la liste des inscrits en exclusion.

**Éléments communs**

- **Logos** : \`visuels/logos/selio-logo-carre-fond-blanc-1200x1200.png\` (carré), \`visuels/logos/selio-logo-paysage-fond-blanc-1200x300.png\` (paysage 4:1) ; variantes sur fond sombre à côté.
- **Images** (sans texte ajouté, comme le recommande Google) : \`visuels/google-display/selio-<concept>-display-paysage-1200x628.jpg\` (1,91:1), \`…-carre-1200x1200.jpg\` (1:1), \`…-portrait-960x1200.jpg\` (4:5).
- **Vidéos** (à mettre sur la chaîne YouTube de Selio, en « non répertoriée » si besoin) : verticales \`../video/Selio-Studio-27s.mp4\`, \`Selio-Bot-29s.mp4\` (négociation et relances, fonctions de Selio Manager), \`Selio-Track-24s.mp4\`, \`Selio-video-35s.mp4\` ; horizontales 16:9 \`videos/Selio-*-16x9.mp4\` ; démonstration longue \`../video/Selio-demo-complete.mp4\` (10 min, pour YouTube seulement).
`);
for (const g of PMAX.groupes) {
  md.push(`### Groupe ${g.nom}

- **URL finale** : \`${SITE}${g.page}\`
- **Images** : \`visuels/google-display/selio-${g.concept}-${g.slug}-display-*.jpg\`

**Titres** : ${g.titres.map(n).join(" · ")}

**Titres longs**

${g.longs.map((t) => `- ${n(t)}`).join("\n")}

**Descriptions**

${g.descriptions.map((t) => `- ${n(t)}`).join("\n")}
`);
}

md.push(`## 5. Liens et paramètres de suivi

- Meta : \`?${utm("meta", "paid_social", "selio-<concept>", "{{ad.name}}")}\` (paramètres d'URL de l'annonce).
- Google : suffixe d'URL finale au niveau du compte \`${utm("google", "cpc", "{_campagne}", "{creative}")}\` + suivi automatique (gclid) activé.
- Code promo : \`/inscription?code=XXX\` seulement avec un code créé au préalable dans Selio Admin › Offres. Pour la publicité payante, le suivi passe par les \`utm\`, pas par un code.
- Pages d'arrivée prévues : \`/logiciel-vinted\`, \`/annonce-vinted-ia\`, \`/prix-revente-vinted\`, \`/bot-achat-vinted\`, \`/negociation-automatique-vinted\` (à vérifier en ligne avant lancement).
`);

const csvRows = [["Campaign", "Ad Group", "Final URL", "Path 1", "Path 2", ...Array.from({ length: 15 }, (_, i) => `Headline ${i + 1}`), ...Array.from({ length: 4 }, (_, i) => `Description ${i + 1}`)]];
for (const c of SEARCH) csvRows.push([c.campagne, c.groupe, SITE + c.page, c.path1, c.path2, ...c.titres, ...c.descriptions]);
csvRows.push([]);
csvRows.push(["Campaign", "Ad Group", "Keyword", "Criterion Type"]);
for (const c of SEARCH) {
  for (const k of c.exact) csvRows.push([c.campagne, c.groupe, k, "Exact"]);
  for (const k of c.expression) csvRows.push([c.campagne, c.groupe, k, "Phrase"]);
  for (const k of c.negatifs) csvRows.push([c.campagne, "", k, "Campaign Negative Broad"]);
}
const csv = csvRows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const err = verifier();
  if (err.length) { console.error(err.join("\n")); process.exit(1); }
  const out = join(fileURLToPath(new URL("..", import.meta.url)));
  writeFileSync(join(out, "textes.md"), md.join("\n"));
  writeFileSync(join(out, "google-ads-editeur.csv"), "﻿" + csv + "\n");
  const nb = SEARCH.reduce((a, c) => a + c.titres.length + c.descriptions.length, 0);
  console.log(`OK : ${META.length} concepts Meta, ${SEARCH.length} campagnes Search (${nb} titres et descriptions vérifiés), ${PMAX.groupes.length} groupes PMax. textes.md et google-ads-editeur.csv écrits.`);
}
