# Extension navigateur — installation non empaquetée

_Mis à jour le 26 novembre 2026 : téléchargement et installation guidée depuis le site._

État : **construite et testée sur fixtures, expérimentale**. Les adaptateurs de page doivent être validés sur le site réel avant toute annonce de compatibilité.

## Installer depuis le site (parcours guidé, recommandé)
Le site public sert lui-même l'extension : **`/extension/selio-extension.zip`** (avec sa fiche `/extension/selio-extension.json` : version, taille, empreinte). Le zip est **reconstruit à chaque build Netlify** de la cible « public » (`pnpm build:site` → `apps/web/scripts/extension-zip.mjs`) ; il n'est jamais committé. L'adresse de l'API (`VITE_API_BASE_URL` du projet Netlify, sinon l'adresse du site) est **pré-remplie** dans les options de l'extension, et l'autorisation demandée est limitée à cette seule origine (`optional_host_permissions`).

Dans l'application, après l'inscription : **Démarrage** (`/app/onboarding`, étape « Extension et comptes Vinted ») ou **Comptes Vinted** (`/app/accounts`, section « Installer l'extension Selio, pas à pas », ouverte tant qu'aucun compte Vinted n'est connecté). Le parcours, avec des schémas :

1. **Télécharger** : bouton « Télécharger l'extension » (fichier `selio-extension.zip`). Sur un ordinateur, avec Chrome, Edge ou Brave.
2. **Installer** :
   - décompresser le zip (clic droit › « Extraire tout… » sous Windows, double-clic sur Mac) et ranger le dossier `selio-extension` à un endroit stable (Documents) : le navigateur le relit à chaque démarrage ;
   - ouvrir `chrome://extensions` (ou `edge://extensions`, `brave://extensions`), à coller dans la barre d'adresse (un site ne peut pas ouvrir ces pages) ;
   - activer le **Mode développeur** (en haut à droite ; dans Edge, colonne de gauche) ;
   - **Charger l'extension non empaquetée** → choisir le dossier décompressé (celui qui contient `manifest.json`) ;
   - **épingler** : pièce de puzzle à droite de la barre d'adresse, puis l'épingle à côté de « Selio — assistant revendeur ».
3. **Relier** : la page Options s'ouvre seule à l'installation (sinon clic droit sur le logo › Options). L'adresse de Selio y est déjà remplie (`https://seliovprod.netlify.app` en production) ; créer un jeton dans le parcours (« Créer un jeton », affiché une seule fois, bouton « Copier »), le coller dans « Jeton d'extension », **Associer**, accepter l'autorisation du navigateur. La fenêtre de l'extension affiche « Associée ».
4. **Ajouter les comptes Vinted** : se connecter à Vinted comme d'habitude dans ce même navigateur, puis « Ajouter un compte Vinted » (pseudo et catégorie : vente, achat ou perso). **Aucun mot de passe Vinted n'est jamais demandé** : l'extension lit seulement les pages Vinted ouvertes. En ouvrant une page Vinted, le compte passe à « Connecté ».
5. **Configuration de départ** (Comptes Vinted ; dans Démarrage, c'est l'étape suivante) : marges et négociation, automatisations, première annonce avec Selio Studio.

Sur une installation sans archive (développement, build sans extension), le bouton est grisé et un message le dit.

## Construire à la main (développement)
```bash
pnpm build:extension      # → apps/extension/dist (adresse par défaut : VITE_DEFAULT_API_BASE_URL, sinon http://127.0.0.1:8787)
VITE_API_BASE_URL=https://seliovprod.netlify.app pnpm build:site   # site public + apps/web/dist/extension/selio-extension.zip
```
Contrôle facultatif dans Chromium (service worker, popup, options) : `cd apps/extension && node scripts/check-extension.mjs`. Pour une installation manuelle, « Charger l'extension non empaquetée » → `apps/extension/dist`.

## Associer à un compte Selio (détail)
1. Le jeton se crée dans le parcours guidé, ou dans Comptes Vinted › « Avancé — relier l'extension Selio » › **Créer un jeton** (nommer l'appareil). Le secret s'affiche une seule fois. Cette section « Avancé » liste aussi les jetons et permet de les révoquer.
2. Dans les Options de l'extension : l'URL de l'API est pré-remplie (zip du site) ; coller le jeton, puis **Associer**. Chrome demande l'autorisation d'accès à l'origine de l'API (nécessaire, limitée à cette origine).
3. Le popup indique « Associé » et le nom de l'organisation. Les connexions Vinted de l'organisation passent en « Connecté » tant que l'extension donne signe de vie.

L'extension exige un serveur Selio (mode connecté) : elle appelle `/api/ext/*` à l'adresse du site, relayée par Netlify vers l'API.

## Utiliser
- Page **article** sur vinted.fr : bouton « Selio · article » → aperçu des champs lus, prix d'achat facultatif, **Capturer vers le stock** (statut « en stock », à compléter dans l'application).
- Page **article**, section **« Comparables Selio »** (Selio Track, offres Pro et Agence) : à l'ouverture du panneau, Selio estime le prix de l'article et affiche la fourchette **P25 / P50 / P75**, la position du prix affiché (sous, dans ou au-dessus de la fourchette), les **trois stratégies** (vente rapide, standard, marge maximale), le délai de vente estimé, le **nombre de comparables**, la **méthode** (ventes proches, même marque et catégorie, modèle de prix, ou les deux) et la confiance. « Données de démonstration » s'affiche quand le modèle de prix a été entraîné sur le simulateur, « Pas assez de références » quand aucun prix ne peut être proposé. C'est une estimation : rien n'est modifié sur la page. Méthode : [PRIX.md](PRIX.md).
  - **Ce qui part vers Selio** : le titre, la marque, la taille, l'état et le prix de l'article, rien d'autre (la catégorie n'est pas lue par l'adaptateur v1 et part vide : les comparables sont alors cherchés dans toutes les catégories). Jamais le pseudo du vendeur, les photos, la description, l'adresse ni la référence de l'annonce. Rien n'est enregistré.
  - **États** : « Recherche des ventes comparables… » ; **hors ligne** (Selio injoignable, bouton « Réessayer ») ; **non relié** (extension sans jeton : rien n'est envoyé) ; **« Track est compris à partir de Pro »** (offre Free ou Starter) ; erreur (trop de demandes, réponse inattendue) avec « Réessayer ».
- Page **conversation** : « Règles de prix » (plancher, marge, vérification de l'offre détectée) et « Préparer une réponse » (brouillon validé par vos règles). **Insérer dans le champ de réponse** ne fait qu'insérer : vous relisez et cliquez vous-même sur Envoyer.
- Popup : état de l'association, page prise en charge ou non, **Diagnostic** (adaptateur, champs reconnus/manquants) ; l'historique des diagnostics est visible dans les Options.

## Permissions et sécurité
- `storage`, `activeTab`, content script limité à `vinted.fr/.be/.com`, origine API autorisée explicitement (`optional_host_permissions`).
- Aucun mot de passe, cookie ou session Vinted n'est lu ni stocké ; aucun CAPTCHA n'est contourné ; aucun clic n'est effectué à votre place.
- Le jeton reste dans le stockage de l'extension (service worker) ; révocable depuis Selio ; expiration 90 jours.
- Comparables : le content script n'envoie au service worker que les six champs de l'article (schéma strict, toute autre donnée est refusée) ; le service worker, seul détenteur du jeton, les revalide avant d'appeler `POST /api/ext/comparables` (côté API, livré en parallèle : portée `capture:items`, 30 appels par minute et par membre ; voir BUILD_STATUS.md) et revalide la réponse ; le panneau l'affiche en texte seulement. Le panneau suit la charte (rôles de `tokens.css`, clair et sombre selon le système).

## Révoquer / dissocier
- Depuis Selio : Comptes Vinted › « Avancé » › Jetons › **Révoquer** (effet immédiat : le popup affiche « Jeton refusé »).
- Depuis l'extension : Options › **Dissocier** (efface le stockage local).

## Mettre à jour un adaptateur
Lancer le diagnostic sur la page concernée, relever les champs manquants, créer `packages/connectors/src/vinted/adapters/v2.ts` avec une fixture, puis reconstruire l'extension.
