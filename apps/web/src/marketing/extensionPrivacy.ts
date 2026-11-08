/**
 * Politique de confidentialité de l'extension Selio (page /extension/confidentialite,
 * adresse à donner au Chrome Web Store). Même texte que
 * apps/extension/store/privacy-policy.md : seo.test.ts vérifie que chaque phrase
 * ci-dessous s'y retrouve. Décrit ce que fait le code de apps/extension (messages.ts,
 * service-worker.ts), rien de plus. Version provisoire, définitive après l'avocat.
 */
export const EXTENSION_PRIVACY_UPDATED = "8 novembre 2026";

export const EXTENSION_PRIVACY: readonly { h: string; p: string[] }[] = [
  {
    h: "En bref",
    p: [
      "L'extension Selio lit la page Vinted que vous avez ouverte et n'envoie des données à Selio que lorsque vous cliquez sur une action du panneau Selio (capturer un article, voir les comparables, voir les règles de prix, préparer une réponse). Ouvrir le panneau ou naviguer dans Vinted n'envoie rien.",
      "Elle ne lit ni ne stocke votre mot de passe, vos cookies ou votre session Vinted, et ne suit pas votre navigation.",
    ],
  },
  {
    h: "Ce que l'extension lit",
    p: [
      "Sur une page article de vinted.fr, vinted.be ou vinted.com : le titre, la marque, la taille, l'état, le prix, la description, l'adresse des photos, la référence de l'annonce et le pseudo affiché du vendeur.",
      "Sur une page conversation : les 30 derniers messages au plus, le pseudo de l'acheteur, le titre et le prix de l'article concerné.",
      "Sur les autres sites, l'extension ne lit rien : son script ne s'exécute que sur vinted.fr, vinted.be et vinted.com.",
    ],
  },
  {
    h: "Ce qui est envoyé à Selio, et quand",
    p: [
      "Capturer un article : les champs de l'article listés ci-dessus et le prix d'achat que vous saisissez, pour créer l'article dans votre stock.",
      "Préparer une réponse : les 30 derniers messages au plus de la conversation (texte, sens et heure), le pseudo de l'acheteur, le titre et le prix affiché de l'article, l'adresse et la référence de la conversation, la référence de l'article quand elle figure dans l'adresse, si le champ de réponse a été trouvé et la version de l'adaptateur de page, pour rédiger un brouillon selon vos règles de prix. Le brouillon est inséré dans le champ de réponse ; c'est vous qui cliquez sur Envoyer.",
      "Voir les comparables (bouton du panneau, sur une page article) : le titre, la marque, la taille, l'état et le prix de l'article, rien d'autre. Rien n'est enregistré.",
      "Voir les règles de prix (bouton du panneau, sur une page conversation) : la référence de l'article quand elle figure dans l'adresse, son prix affiché et le montant de l'offre détectée dans le dernier message de l'acheteur, pour afficher votre prix plancher et vos règles. Rien n'est enregistré.",
      "Les données partent uniquement vers l'adresse de l'API Selio que vous avez autorisée en associant l'extension, par une connexion chiffrée, avec un jeton propre à votre organisation.",
    ],
  },
  {
    h: "Ce qui reste dans votre navigateur",
    p: [
      "Le jeton d'association, l'adresse de l'API, le nom de votre organisation et l'historique des diagnostics de compatibilité (adresse de la page, champs reconnus ou manquants) restent dans le stockage de l'extension.",
      "Le jeton expire après 90 jours et se révoque depuis Selio ; « Dissocier » dans les options efface ce stockage.",
    ],
  },
  {
    h: "Ce que l'extension ne fait jamais",
    p: [
      "Elle ne collecte ni mot de passe, ni cookie, ni session, ni historique de navigation.",
      "Elle ne contourne aucun CAPTCHA, n'envoie aucun message et ne clique sur rien à votre place.",
      "Elle ne charge aucun code distant : tout son code est inclus dans le paquet publié.",
      "Les données ne sont ni vendues, ni utilisées pour de la publicité, ni transmises à des tiers, hors de l'hébergement du service Selio.",
    ],
  },
  {
    h: "Conservation et droits",
    p: [
      "Les données envoyées à Selio sont conservées selon les durées réglées par votre organisation (Paramètres › Données) et supprimées avec elle.",
      "Vous pouvez demander l'accès, la rectification, l'export ou l'effacement de vos données. Contact : [adresse à compléter].",
    ],
  },
];
