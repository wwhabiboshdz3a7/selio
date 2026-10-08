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
1. Dans l'application Selio (mode connecté) : Paramètres › Connexions › **Créer un jeton** (nommer l'appareil). Le secret s'affiche une seule fois.
2. Dans les Options de l'extension : saisir l'URL de l'API (ex. `https://api.exemple.fr`) et coller le jeton, puis **Associer**. Chrome demande l'autorisation d'accès à l'origine de l'API (nécessaire, limitée à cette origine).
3. Le popup indique « Associé » et le nom de l'organisation. Les connexions Vinted de l'organisation passent en « Connecté » tant que l'extension donne signe de vie.

En mode démonstration (sans API), l'association n'est pas possible : l'extension exige un serveur Selio.

## Utiliser
- Page **article** sur vinted.fr : bouton « Selio · article » → aperçu des champs lus, prix d'achat facultatif, **Capturer vers le stock** (statut « en stock », à compléter dans l'application).
- Page **conversation** : « Règles de prix » (plancher, marge, vérification de l'offre détectée) et « Préparer une réponse » (brouillon validé par vos règles). **Insérer dans le champ de réponse** ne fait qu'insérer : vous relisez et cliquez vous-même sur Envoyer.
- Popup : état de l'association, page prise en charge ou non, **Diagnostic** (adaptateur, champs reconnus/manquants) ; l'historique des diagnostics est visible dans les Options.

## Permissions et sécurité
- `storage`, `activeTab`, content script limité à `vinted.fr/.be/.com`, origine API autorisée explicitement (`optional_host_permissions`).
- Aucun mot de passe, cookie ou session Vinted n'est lu ni stocké ; aucun CAPTCHA n'est contourné ; aucun clic n'est effectué à votre place.
- Le jeton reste dans le stockage de l'extension (service worker) ; révocable depuis Selio ; expiration 90 jours.

## Révoquer / dissocier
- Depuis Selio : Paramètres › Connexions › Jetons › **Révoquer** (effet immédiat : le popup affiche « Jeton refusé »).
- Depuis l'extension : Options › **Dissocier** (efface le stockage local).

## Mettre à jour un adaptateur
Lancer le diagnostic sur la page concernée, relever les champs manquants, créer `packages/connectors/src/vinted/adapters/v2.ts` avec une fixture, puis reconstruire l'extension.
