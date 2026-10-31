# Connecteurs

## Modèle

Un connecteur expose des **capacités** : `read_items`, `read_conversations`, `sync_orders`, `prepare_message`, `send_message`, `shipping_document`. Chaque capacité est déclarée `available` (testée), `experimental` (construite, non vérifiée en réel) ou `unavailable`.

Statuts d'une connexion : `not_configured`, `ready`, `connected`, `degraded`, `expired`, `disconnected`, `unsupported`.

L'écran **Comptes Vinted** (`/app/accounts`, menu « Comptes ») permet : ajout d'un compte (pseudo, nom interne, catégorie), test, synchronisation, révocation, suppression, dernière synchronisation, capacités résumées, chiffres du compte, erreurs lisibles. L'ancienne adresse `/app/settings/connections` redirige vers cette page. Les jetons d'extension sont dans la section repliée « Avancé — relier l'extension Selio ».

### Catégories de comptes (`usage`)

Plusieurs comptes Vinted peuvent être connectés à une même organisation ; chacun a une catégorie, modifiable en un clic (`PATCH /api/connections/:id`, permission `connections.manage`, audit `connection.updated`) :

| Catégorie | Usage dans Selio |
|---|---|
| `sale` — Vente (défaut) | Annonces publiées et négociées : générateur d'annonces, dressing, messagerie, automatisations, Selio Cloud |
| `purchase` — Achat | Compte qui achète les bonnes affaires : achats validés (« À valider ») et achat auto, enregistré sur chaque demande d'achat (`purchase_requests.connection_id`). Seul compte lu par Selio Radar en direct et utilisé par Radar Auto, et seulement s'il est relié à un compte Selio Cloud actif (RADAR.md) |
| `personal` — Perso | Compte personnel : jamais utilisé par les automatisations (tâches ignorées, même déjà planifiées), ni par l'achat auto, ni par Selio Cloud |

Le générateur d'annonces ne propose que les comptes Vente (puis Perso, signalé). L'achat auto utilise le compte Achat choisi dans ses réglages (`autoBuy.connectionId`), sinon le premier compte Achat actif. Une recherche Radar en direct lit le compte Achat choisi sur la recherche (refusé s'il n'est pas un compte Achat actif), sinon celui de l'achat auto, sinon le premier compte Achat actif. Le simulateur de démonstration ne compte pas dans le quota de comptes du plan. `GET /api/connections/stats` renvoie par compte : annonces en ligne, ventes du mois, achats, conversations ouvertes.

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

## Vinted via Selio Cloud (transport `cloud`) — EXPÉRIMENTAL, NON VÉRIFIÉ, DÉSACTIVÉ PAR DÉFAUT

À côté du transport `extension` (le navigateur du client, sa session, sur son ordinateur), le transport `cloud` agit **depuis notre machine**, dans un Chromium ouvert seulement pour une action, avec la session que le client a lui-même ouverte dans la fenêtre de connexion sécurisée. Fonctionnement, règles et limites : [CLOUD.md](CLOUD.md).

C'est la **seule exception** au principe « le serveur ne possède jamais de session Vinted » (D08). Elle est voulue par les règles non négociables du projet : une session par compte, avec l'accord du client, chiffrée, isolée, jamais partagée, supprimée dès qu'il se déconnecte ou résilie. L'entrée correspondante du journal des décisions est à ajouter (voir BUILD_STATUS).

Dans le code, `cloud` n'est pas (encore) une valeur de `transport` dans `ConnectorDescription` : c'est un chemin d'exécution à part. Les domaines reconnus forment une liste fermée (`VINTED_DOMAINS` des contrats), partagée par le filtre de session, l'exécuteur, la fenêtre de connexion et le réglage `vintedHost` d'une connexion (validé à la création). Les tâches `jobs.runs_in = 'cloud'` sont exécutées par le worker (`runDueCloudJobs` dans `packages/core`, `PlaywrightRunner` dans `packages/cloud`). `describe()` du connecteur Vinted ne change pas.

| Action | Niveau | État | Détail |
|---|---|---|---|
| `reply` — répondre à un message | légère | expérimental | Règle « répondre à un nouveau message ». La conversation doit être reconnue par l'adaptateur avant d'écrire. Envoi compté comme fait seulement si le message apparaît, sinon jamais renvoyé |
| `follow_up` — relancer après 24 h | légère | expérimental | Règle « relancer sans réponse », même déroulé |
| `republish` — republier une annonce | lourde | fermé (`CLOUD_HEAVY_ACTIONS=false`, à décider par Ibrahim) | Écrit mais non vérifié |
| `bulk_edit` — modifier en masse | lourde | indisponible | Aucune implémentation navigateur |
| Lecture des conversations, synchronisation | — | indisponible | Le Cloud lit la page seulement pour vérifier ce qu'il fait ; il n'importe rien |

Réutilisation de l'adaptateur DOM : la page de conversation est lue par `parseConversationPage` et `COMPOSER_SELECTORS` de l'adaptateur `v1` (`@selio/connectors/vinted-adapter`), exécutés sur la page vivante sans recopier les sélecteurs. Un test vérifie que le résultat est identique à l'analyse directe des fixtures.

### Ce qui exige une validation dans un navigateur réel (en plus de l'adaptateur v1)
- Les compléments propres au Cloud dans `packages/cloud/src/vinted.ts` : bouton d'envoi, menu du membre (« connecté »), noms des cookies de session (`access_token_web`, `refresh_token_web`), URL de la page de connexion, bouton de republication. Une fois validés sur un compte de test de l'équipe, ils sont à reporter dans un adaptateur `v2` du connecteur, avec ses fixtures.
- Les motifs de détection des signaux de Vinted (`detectBlock` : CAPTCHA, avertissement, blocage, « trop de requêtes ») : écrits sans page réelle.
- L'adresse d'une conversation : `https://www.vinted.fr/inbox/<référence>` par défaut. Un autre domaine Vinted peut être réglé par compte dans `connection.config.vintedHost` (contrôlé : vinted.\* seulement).
- La connexion par Google, Facebook ou Apple, non prise en charge : les fenêtres surgissantes sont fermées.
- Le respect des conditions d'utilisation de la plateforme : avis de l'avocat attendu avant toute activation client.

Un compte de catégorie **Perso** n'est jamais utilisé par le Cloud. Déconnecter ou supprimer un compte Vinted arrête son compte Cloud et efface sa session.

## Vinted pour Selio Radar (adaptateurs catalogue et paiement) — EXPÉRIMENTAL, NON VÉRIFIÉ EN RÉEL

Selio Radar lit les pages de recherche de Vinted et Radar Auto peut acheter, **depuis le compte Achat** du client et par Selio Cloud (même session, même Chromium, mêmes règles). Fonctionnement, verrous et procédure de test : [RADAR.md](RADAR.md). Comme pour le transport `cloud`, ce n'est pas une capacité de `describe()` : c'est un chemin d'exécution à part (`RadarReader` et `PurchaseRunner` dans `packages/cloud/src/radar/`, appelés par le cœur). **Rien n'a été vérifié sur le vrai site** ; Radar Auto et l'achat réel sont fermés par défaut (D11).

| Adaptateur | Fichier | Ce qu'il lit | Fixtures (synthétiques) |
|---|---|---|---|
| `vinted-catalog-v1` — page de recherche (`/catalog?…`) | `adapters/v1-catalog.ts` | Grille de résultats : jusqu'à 96 cartes (référence, adresse, titre, marque, taille, état, prix, port s'il est affiché, nombre de photos, photo, pseudo et note du vendeur, date de publication lue ou estimée depuis « il y a … ») ; page de blocage (`blocked`) ; page inconnue (`pageOk=false`, rien n'est inventé). `buildSearchUrl` construit l'adresse de la recherche, `filterCatalogItems` filtre après lecture | `catalog-page.v1.html`, `catalog-blocked.v1.html` |
| `vinted-checkout-v1` — bouton « Acheter » d'une annonce et page de paiement | `adapters/v1-checkout.ts` | Annonce vendue, réservée ou masquée ; bouton « Acheter » ; page de paiement (prix, port, protection, total, porte-monnaie Vinted proposé ou choisi, bouton de paiement) ; demande de validation 3-D Secure (reconnue pour **attendre**, aucun sélecteur de champ de code, volontairement) ; confirmation et référence de commande ; refus de paiement | `item-buy.v1.html`, `checkout-page.v1.html`, `checkout-3ds.v1.html`, `checkout-done.v1.html` |
| Lecteur HTML | `adapters/html.ts` | Le HTML d'une page reçu en texte (le navigateur est déjà refermé), vers l'interface DOM minimale des adaptateurs : tolérant, borné (8 millions de caractères, 300 000 nœuds, profondeur 400), sans exécution ni chargement, sélecteurs CSS limités. Un test vérifie qu'il donne le même résultat qu'un vrai DOM (happy-dom) | — |

Adresse de recherche (`buildSearchUrl`) : `https://<domaine Vinted du compte>/catalog?search_text=…&price_to=…&currency=EUR&order=newest_first`. Seuls les mots-clés (plus la marque quand il n'y en a qu'une) et le prix maximum passent à Vinted ; le domaine doit être dans la liste fermée `VINTED_DOMAINS`. Marques, tailles et états sont filtrés **après** lecture ; la catégorie, invisible sur une carte, n'est pas filtrée.

### Ce qui exige une validation dans un navigateur réel (compte Vinted de l'équipe)
- **Tous les sélecteurs** du catalogue et du paiement : ils suivent les conventions des autres adaptateurs (`data-testid` d'abord, replis ensuite) mais sont construits sur des fixtures synthétiques.
- **Les identifiants numériques de Vinted** pour les marques (`brand_ids[]`), tailles (`size_ids[]`), états (`status_ids[]`) et catégories (`catalog[]`), à relever dans l'adresse d'une vraie recherche filtrée à la main ; rien n'est inventé en attendant.
- **Le format des paramètres** `price_to`, `currency` et `order=newest_first`.
- **La date de publication** : horodatage absolu présent ou non sur les cartes, textes relatifs exacts.
- **Le parcours de paiement** : porte-monnaie Vinted, total, bouton « Payer », page de confirmation et référence ; la validation 3-D Secure (cadre dans la page ou redirection complète vers la banque : ce second cas n'est pas reconnu aujourd'hui et finit en « non confirmé », effets inconnus).
- **Les pages de blocage** réelles (CAPTCHA, avertissement, « trop de requêtes ») pour compléter `detectBlock`.

Procédure : relevé à la main dans un navigateur ordinaire, sans aucune automatisation (RADAR.md §10, étape 1). Un écart se corrige dans un nouvel adaptateur `v2-catalog.ts` ou `v2-checkout.ts` avec ses fixtures, **jamais en modifiant `v1` en place**.

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
