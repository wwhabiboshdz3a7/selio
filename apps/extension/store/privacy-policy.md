# Politique de confidentialité de l'extension Selio

Mise à jour le 8 novembre 2026. **Version provisoire, définitive après l'avocat.**

Adresse publique (à donner au Chrome Web Store) : https://selio.fr/extension/confidentialite — domaine à confirmer. Ce fichier et la page du site ont le même texte (source : `apps/web/src/marketing/extensionPrivacy.ts`, vérifié par `apps/web/src/marketing/seo.test.ts`).

## En bref

L'extension Selio lit la page Vinted que vous avez ouverte et n'envoie des données à Selio que lorsque vous cliquez sur une action du panneau Selio (capturer un article, voir les comparables, voir les règles de prix, préparer une réponse). Ouvrir le panneau ou naviguer dans Vinted n'envoie rien.

Elle ne lit ni ne stocke votre mot de passe, vos cookies ou votre session Vinted, et ne suit pas votre navigation.

## Ce que l'extension lit

Sur une page article de vinted.fr, vinted.be ou vinted.com : le titre, la marque, la taille, l'état, le prix, la description, l'adresse des photos, la référence de l'annonce et le pseudo affiché du vendeur.

Sur une page conversation : les 30 derniers messages au plus, le pseudo de l'acheteur, le titre et le prix de l'article concerné.

Sur les autres sites, l'extension ne lit rien : son script ne s'exécute que sur vinted.fr, vinted.be et vinted.com.

## Ce qui est envoyé à Selio, et quand

Capturer un article : les champs de l'article listés ci-dessus et le prix d'achat que vous saisissez, pour créer l'article dans votre stock.

Préparer une réponse : les 30 derniers messages au plus de la conversation (texte, sens et heure), le pseudo de l'acheteur, le titre et le prix affiché de l'article, l'adresse et la référence de la conversation, la référence de l'article quand elle figure dans l'adresse, si le champ de réponse a été trouvé et la version de l'adaptateur de page, pour rédiger un brouillon selon vos règles de prix. Le brouillon est inséré dans le champ de réponse ; c'est vous qui cliquez sur Envoyer.

Voir les comparables (bouton du panneau, sur une page article) : le titre, la marque, la taille, l'état et le prix de l'article, rien d'autre. Rien n'est enregistré.

Voir les règles de prix (bouton du panneau, sur une page conversation) : la référence de l'article quand elle figure dans l'adresse, son prix affiché et le montant de l'offre détectée dans le dernier message de l'acheteur, pour afficher votre prix plancher et vos règles. Rien n'est enregistré.

Les données partent uniquement vers l'adresse de l'API Selio que vous avez autorisée en associant l'extension, par une connexion chiffrée, avec un jeton propre à votre organisation.

## Ce qui reste dans votre navigateur

Le jeton d'association, l'adresse de l'API, le nom de votre organisation et l'historique des diagnostics de compatibilité (adresse de la page, champs reconnus ou manquants) restent dans le stockage de l'extension.

Le jeton expire après 90 jours et se révoque depuis Selio ; « Dissocier » dans les options efface ce stockage.

## Ce que l'extension ne fait jamais

Elle ne collecte ni mot de passe, ni cookie, ni session, ni historique de navigation.

Elle ne contourne aucun CAPTCHA, n'envoie aucun message et ne clique sur rien à votre place.

Elle ne charge aucun code distant : tout son code est inclus dans le paquet publié.

Les données ne sont ni vendues, ni utilisées pour de la publicité, ni transmises à des tiers, hors de l'hébergement du service Selio.

## Conservation et droits

Les données envoyées à Selio sont conservées selon les durées réglées par votre organisation (Paramètres › Données) et supprimées avec elle.

Vous pouvez demander l'accès, la rectification, l'export ou l'effacement de vos données. Contact : [adresse à compléter].

## Indépendance

Selio est indépendant de Vinted et n'est ni affilié, ni approuvé, ni sponsorisé par Vinted.
