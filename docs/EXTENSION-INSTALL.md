# Extension navigateur — installation non empaquetée

État : **construite et testée sur fixtures, expérimentale**. Les adaptateurs de page doivent être validés sur le site réel avant toute annonce de compatibilité.

## Construire
```bash
pnpm build:extension      # → apps/extension/dist
```
Contrôle facultatif dans Chromium (service worker, popup, options) : `cd apps/extension && node scripts/check-extension.mjs`.

## Installer (Chrome / Chromium / Edge / Brave)
1. Ouvrir `chrome://extensions`, activer le **Mode développeur**.
2. **Charger l'extension non empaquetée** → sélectionner `apps/extension/dist`.
3. La page Options s'ouvre automatiquement à la première installation.

## Associer à un compte Selio
1. Dans l'application Selio (mode connecté) : Comptes Vinted › « Avancé — relier l'extension Selio » › **Créer un jeton** (nommer l'appareil). Le secret s'affiche une seule fois.
2. Dans les Options de l'extension : saisir l'URL de l'API (ex. `https://api.exemple.fr`) et coller le jeton, puis **Associer**. Chrome demande l'autorisation d'accès à l'origine de l'API (nécessaire, limitée à cette origine).
3. Le popup indique « Associé » et le nom de l'organisation. Les connexions Vinted de l'organisation passent en « Connecté » tant que l'extension donne signe de vie.

En mode démonstration (sans API), l'association n'est pas possible : l'extension exige un serveur Selio.

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
