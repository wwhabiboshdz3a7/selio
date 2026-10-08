# Connecteurs

## Modèle

Un connecteur expose des **capacités** : `read_items`, `read_conversations`, `sync_orders`, `prepare_message`, `send_message`, `shipping_document`. Chaque capacité est déclarée `available` (testée), `experimental` (construite, non vérifiée en réel) ou `unavailable`.

Statuts d'une connexion : `not_configured`, `ready`, `connected`, `degraded`, `expired`, `disconnected`, `unsupported`.

L'écran **Paramètres › Connexions** permet : configuration adaptée au service, test, synchronisation, révocation, suppression, dernière synchronisation, capacités, erreurs lisibles.

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

## Paiement (Stripe)

`packages/connectors/src/payments/stripe.ts` : vérification de signature (`t`, `v1`, tolérance 5 min), client REST (Checkout, portail). Idempotence par `payment_events.id`. Mode test tant que `STRIPE_LIVE_ALLOWED` n'est pas `true`.

## Ajouter un connecteur

1. Implémenter `Connector` (`packages/connectors/src/types.ts`) avec `describe()` honnête sur l'état de chaque capacité.
2. L'enregistrer dans `registry.ts` et ajouter sa valeur au `provider` des contrats.
3. Tester sur fixtures ; documenter ici ce qui reste à valider en réel.
