# Fiche Chrome Web Store — Selio

Textes à coller dans le tableau de bord du Chrome Web Store (onglet « Fiche Play Store » / « Store listing »). **Rien n'est publié** : le compte développeur (5 $, paiement unique) est **à valider par Ibrahim**, la publication se fait à la main (docs/WEB-STORE.md). Les limites de longueur sont vérifiées par `apps/extension/test/pack.test.ts`.

## Titre

Selio — assistant revendeur

> Repris du champ `name` du manifeste (75 caractères au plus). Le mot « Vinted » n'est pas dans le titre : pas de confusion avec la marque.

## Résumé

Capture d'articles et aide à la rédaction sur vos pages Vinted, avec confirmation avant chaque action. Indépendant de Vinted.

> Identique au champ `description` du manifeste (132 caractères au plus).

## Catégorie

Productivité › Flux de travail et planification (à défaut : Outils).

## Langue

Français.

## Description

Selio est un outil de gestion pour les revendeurs Vinted. Son extension vous aide depuis la page Vinted que vous avez ouverte, sans jamais agir à votre place.

Ce que fait l'extension :
- Sur une page article : un panneau « Selio · article » montre ce que l'extension a lu (titre, marque, taille, état, prix) ; vous pouvez capturer l'article vers votre stock Selio, avec votre prix d'achat.
- Sur une page article, « Comparables Selio » (offres Pro et Agence) : une fourchette de prix tirée de ventes comparables, la position du prix affiché et un délai de vente estimé. C'est une estimation, rien n'est modifié sur la page.
- Sur une page conversation : vos règles de prix (plancher, marge) et un brouillon de réponse conforme à ces règles, inséré dans le champ de réponse. Vous relisez, et c'est vous qui cliquez sur Envoyer.
- Un diagnostic indique si la page est prise en charge et quels champs ont été reconnus.

Ce qu'elle ne fait jamais :
- Elle ne lit ni ne stocke votre mot de passe, vos cookies ou votre session Vinted.
- Elle ne contourne aucun CAPTCHA, n'envoie aucun message et ne clique sur rien à votre place.
- Elle ne suit pas votre navigation : elle ne s'exécute que sur vinted.fr, vinted.be et vinted.com.
- Elle ne charge aucun code distant.

Pour fonctionner, l'extension s'associe à votre compte Selio : créez un jeton dans l'application (Comptes Vinted › Avancé), collez-le dans les options de l'extension. Le jeton se révoque à tout moment depuis Selio et expire après 90 jours.

L'extension est expérimentale : les pages de Vinted peuvent changer, et le diagnostic vous le signale.

Selio est indépendant de Vinted et n'est ni affilié, ni approuvé, ni sponsorisé par Vinted.

## Liens

- Site : `https://selio.fr/extension` (domaine à confirmer).
- Politique de confidentialité : `https://selio.fr/extension/confidentialite` (même texte que `store/privacy-policy.md`).
- Assistance : [adresse email à compléter].

## Visibilité conseillée

« Non répertoriée » pendant la bêta fermée (seules les personnes qui ont le lien l'installent), puis « Publique » une fois les adaptateurs validés sur le site réel. Régions : France et Belgique d'abord.

## Captures

Liste et format : `store/captures.md`.
