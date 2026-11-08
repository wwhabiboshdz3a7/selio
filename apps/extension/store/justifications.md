# Justifications pour le Chrome Web Store — onglet « Confidentialité »

Réponses à coller dans l'onglet « Pratiques de confidentialité » du tableau de bord. Chaque permission du manifeste a sa justification ici ; `scripts/pack-lib.mjs` refuse toute permission absente de `ALLOWED_PERMISSIONS`, et `test/pack.test.ts` vérifie que chaque permission, chaque domaine du script de contenu et chaque autorisation facultative est cité dans ce fichier.

## Objectif unique (single purpose)

Aider un revendeur, depuis la page Vinted qu'il a ouverte, à capturer un article vers son stock Selio, à voir les prix comparables et ses règles de prix, et à préparer une réponse conforme à ces règles, avec sa confirmation avant chaque action. Rien n'est envoyé à Selio sans un clic sur un bouton du panneau.

## Permissions

| Permission | Pourquoi | Ce qui n'est pas fait |
|---|---|---|
| `storage` | Garder dans l'extension le jeton d'association à Selio, l'adresse de l'API, le nom de l'organisation et l'historique des diagnostics. | Aucune donnée de navigation, aucun cookie, aucun mot de passe. |
| `activeTab` | Quand l'utilisateur ouvre le popup, savoir si l'onglet actif est une page Vinted prise en charge et y lancer le diagnostic ou ouvrir le panneau. | Pas d'accès aux autres onglets ; pas de permission `tabs`. |

## Domaines du script de contenu

| Domaine | Pourquoi |
|---|---|
| `https://www.vinted.fr/*` | Lire la page article ou conversation que l'utilisateur a ouverte et afficher le panneau Selio. |
| `https://www.vinted.be/*` | Idem, site belge. |
| `https://www.vinted.com/*` | Idem, site international. |

Le script de contenu ne s'exécute que dans le cadre principal (`all_frames: false`), à la fin du chargement.

## Autorisation facultative (optional_host_permissions)

| Valeur | Pourquoi |
|---|---|
| `https://*/*` (version actuelle) ou l'origine exacte de l'API Selio (`EXTENSION_API_ORIGIN`) | Joindre l'API Selio de l'utilisateur. L'autorisation est demandée **au moment de l'association**, pour la seule origine saisie (`chrome.permissions.request({ origins: [origine] })`) ; rien n'est accordé à l'installation. |

Les origines `http://127.0.0.1/*` et `http://localhost/*` du manifeste de développement sont **retirées du paquet publié** par `pnpm extension:pack`. Dès que l'adresse de production est connue, fixer `EXTENSION_API_ORIGIN=https://api.<domaine>` : l'autorisation facultative se réduit alors à cette seule origine.

## Code distant

Non. Tout le code est dans le paquet (politique `script-src 'self'; object-src 'none'; base-uri 'none'`) ; aucune page, aucun script ni aucune donnée exécutable n'est chargé depuis un serveur.

## Données collectées (cases à cocher)

| Catégorie du formulaire | Cochée | Détail |
|---|---|---|
| Informations permettant d'identifier une personne | Oui | Pseudo du vendeur affiché sur une page article capturée ; pseudo de l'acheteur d'une conversation (avec le titre et le prix de l'article, l'adresse et la référence de la conversation) quand l'utilisateur demande un brouillon. Toujours au clic, jamais à l'ouverture du panneau ni à la navigation. |
| Communications personnelles | Oui | Les 30 derniers messages au plus d'une conversation, envoyés quand l'utilisateur demande un brouillon de réponse. |
| Informations d'authentification | Oui | Le jeton d'association Selio, gardé dans le stockage de l'extension (jamais un mot de passe Vinted). |
| Contenu du site Web | Oui | Titre, marque, taille, état, prix, description et adresse des photos de l'article capturé ; titre, marque, taille, état et prix pour « Voir les comparables » (rien d'enregistré) ; référence de l'article, prix affiché et offre détectée pour « Règles de prix » (rien d'enregistré). Chaque envoi suit un clic sur un bouton du panneau Selio. |
| Historique de navigation, activité de l'utilisateur, localisation, informations financières ou de santé | Non | — |

## Engagements (certifications)

- Les données ne sont ni vendues ni transférées à des tiers, hors des cas permis (hébergement du service Selio).
- Elles ne servent à rien d'autre que l'objectif unique ci-dessus.
- Elles ne servent pas à évaluer la solvabilité ni à accorder un prêt.

## Indépendance

Selio est indépendant de Vinted et n'est ni affilié, ni approuvé, ni sponsorisé par Vinted.
