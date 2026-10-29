# Connecteurs

## Modèle

Un connecteur expose des **capacités** : `read_items`, `read_conversations`, `sync_orders`, `prepare_message`, `send_message`, `shipping_document`. Chaque capacité est déclarée `available` (testée), `experimental` (construite, non vérifiée en réel) ou `unavailable`.

Statuts d'une connexion : `not_configured`, `ready`, `connected`, `degraded`, `expired`, `disconnected`, `unsupported`.

L'écran **Comptes Vinted** (`/app/accounts`, menu « Comptes ») permet : ajout d'un compte (pseudo, nom interne, catégorie), test, synchronisation, révocation, suppression, dernière synchronisation, capacités résumées, chiffres du compte, erreurs lisibles. L'ancienne adresse `/app/settings/connections` redirige vers cette page. Les jetons d'extension sont dans la section repliée « Avancé — relier l'extension Selio ».

### Catégories de comptes (`usage`)

Plusieurs comptes Vinted peuvent être connectés à une même organisation ; chacun a une catégorie, modifiable en un clic (`PATCH /api/connections/:id`, permission `connections.manage`, audit `connection.updated`) :

| Catégorie | Usage dans Selio |
|---|---|
| `sale` — Vente (défaut) | Annonces publiées et négociées : générateur d'annonces, dressing, messagerie, automatisations |
| `purchase` — Achat | Compte qui achète les bonnes affaires : achats validés (« À valider ») et achat auto, enregistré sur chaque demande d'achat (`purchase_requests.connection_id`) |
| `personal` — Perso | Compte personnel : jamais utilisé par les automatisations (tâches ignorées, même déjà planifiées) ni par l'achat auto |

Le générateur d'annonces ne propose que les comptes Vente (puis Perso, signalé). L'achat auto utilise le compte Achat choisi dans ses réglages (`autoBuy.connectionId`), sinon le premier compte Achat actif. Le simulateur de démonstration ne compte pas dans le quota de comptes du plan. `GET /api/connections/stats` renvoie par compte : annonces en ligne, ventes du mois, achats, conversations ouvertes.

## Simulateur de démonstration (`demo`)

Déterministe, sans réseau. Toute action renvoie `simulated: true`. Le marqueur `[échec]` dans un message simule un refus du connecteur (parcours d'erreur). Il prouve le parcours, jamais une intégration.

## Vinted via extension (`vinted`) — EXPÉRIMENTAL, NON VÉRIFIÉ

| Capacité | État | Détail |
|---|---|---|
| `read_items` | expérimental | Capture d'un article visible (`vinted-dom-v1`) |
| `read_conversations` | expérimental | Lecture d'une conversation visible |
| `prepare_message` | expérimental | Pré-remplissage du champ de réponse, envoi manuel |
| `send_message` | indisponible | Aucun envoi automatique |
| `sync_orders` | indisponible | Aucune source fiable sans API officielle |
| `shipping_document` | indisponible | Le bordereau reste généré par Vinted |

Statut calculé depuis la dernière activité de l'extension (`extensionLastSeenAt`, mis à jour par `/api/ext/ping`) : `ready` (jamais vue), `connected` (< 1 h), `degraded` (< 24 h), `expired` (> 24 h).

### Ce qui exige une validation dans un navigateur réel
- Les sélecteurs de `packages/connectors/src/vinted/adapters/v1.ts` sont construits sur des **fixtures synthétiques** (`fixtures/*.html`), pas sur des pages réelles. À vérifier : titre, prix, marque/taille/état, photos, pseudo vendeur ; pseudo acheteur, messages et direction, champ de réponse.
- La détection d'URL (`/items/:id`, `/inbox/:id`) et la navigation SPA.
- Le respect des conditions d'utilisation de la plateforme : aucune automatisation d'envoi, aucune collecte de session, aucun contournement de protection.

Procédure : installer l'extension, ouvrir une page article, lancer « Diagnostic » dans le popup ; les champs manquants sont listés. Mettre à jour l'adaptateur en créant `v2.ts` (jamais modifier `v1` en place) et ajouter une fixture.

## Paiement (Revolut Merchant API)

`packages/connectors/src/payments/` : une interface neutre `PaymentProvider` (`types.ts` : `createCustomer`, `createCheckoutOrder`, `createOrder`, `chargeSavedMethod`, `cancelOrder`, `getOrder`, `listMerchantPaymentMethods`, `verifyWebhook`, erreurs typées) pour pouvoir brancher un fournisseur de secours (Mollie) sans toucher au cœur, et son implémentation `revolut.ts` (`RevolutClient`, sans SDK, `fetch` injectable pour les tests) :
- hôte selon le mode (`https://sandbox-merchant.revolut.com` ou `https://merchant.revolut.com`), en-têtes `Authorization: Bearer sk_…` et `Revolut-Api-Version` ; le mode live est refusé sans `REVOLUT_LIVE_ALLOWED=true` ;
- commandes (`POST /api/orders`, capture `manual` pendant l'essai, `automatic` ensuite), annulation, lecture, paiement avec un moyen enregistré « pour le marchand » (`saved_payment_method`, `initiator: merchant`), clients et moyens de paiement (`/api/1.0/customers`) ;
- webhooks : HMAC-SHA256 de `v1.<horodatage>.<corps brut>`, plusieurs signatures acceptées, tolérance de 5 minutes ; idempotence par `payment_events.id` = `revolut:<order_id>:<event>` ;
- journaux sans clé, sans corps, sans donnée de carte. `config.ts` lit les variables `REVOLUT_*` (API et worker) et construit le fournisseur ; sans clé, le paiement est désactivé et l'interface le dit.

Côté navigateur, `apps/web/src/lib/payments/revolut.ts` charge à la demande le widget `@revolut/checkout` (fenêtre « popup », `savePaymentMethodFor: "merchant"`) avec le jeton public de la commande ; la confirmation finale vient toujours du webhook. Les webhooks sont à enregistrer à la main chez Revolut (voir CLES-ET-CONFIGURATION.md §5).

## Ajouter un connecteur

1. Implémenter `Connector` (`packages/connectors/src/types.ts`) avec `describe()` honnête sur l'état de chaque capacité.
2. L'enregistrer dans `registry.ts` et ajouter sa valeur au `provider` des contrats.
3. Tester sur fixtures ; documenter ici ce qui reste à valider en réel.
