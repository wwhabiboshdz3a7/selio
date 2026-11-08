# Supervision

_Version du 8 novembre 2026_

Objectif (§5.15) : savoir sur le téléphone, sans rien surveiller à la main, quand l'API ou l'IA de Selio ne répondent plus, et quand elles reviennent. Ce document décrit ce que fait le code (`packages/core/src/services/supervision.ts`, tâche `supervision.tick` du worker, routes `/api/health*`), les réglages, et l'option externe qui reste à décider.

## Cibles

| Cible | Adresse | Succès | Contenu de la réponse |
|---|---|---|---|
| `api` | `PUBLIC_API_URL` + `/api/health` | HTTP 2xx et `ok` différent de `false` | base, Redis, file de tâches, version, durée de fonctionnement ; **503** si un composant est en panne ; aucun secret, aucun message d'erreur, aucune adresse interne |
| `ia` | `PUBLIC_API_URL` + `/api/ai/health` | idem | santé des trois modèles (mon IA perso, photos, prix) ; protégée par `AI_HEALTH_TOKEN` |

- Sans `SUPERVISION_TARGETS`, ce sont les deux cibles par défaut. La cible `ia` n'est contrôlée que si `AI_HEALTH_TOKEN` est renseigné côté worker (sinon un avertissement au démarrage).
- Avec `SUPERVISION_TARGETS` (JSON `[{ "name": "api", "url": "https://…/api/health" }]`, 20 cibles au plus, noms uniques), la liste remplace les cibles par défaut. **Aucun en-tête dans cette variable** : le jeton de santé de l'IA n'est joint qu'aux adresses `/api/ai/health` servies par `PUBLIC_API_URL`, jamais à un autre hôte.
- Chaque vérification a un délai borné (`SUPERVISION_TIMEOUT_MS`, 10 s par défaut) ; un délai dépassé est un échec.
- `/api/health/details` (opérateurs seulement, `OPERATOR_EMAILS` côté API) : latences, files, état de chaque cible et dernières vérifications (historique de 7 jours, table `supervision_checks`).

## Seuils et machine à états

`nextState`, fonction pure testée :

1. Une cible passe **en panne** après `SUPERVISION_FAILURES_BEFORE_ALERT` échecs consécutifs (3 par défaut, soit environ 3 minutes avec la cadence d'une minute) : **une** alerte.
2. Tant que la panne dure, un **rappel** toutes les `SUPERVISION_REMINDER_MINUTES` (60 par défaut).
3. Au premier succès, **« rétabli »** — seulement si une alerte était partie : un échec isolé ne réveille personne.

L'état de chaque cible est en base (`supervision_targets`, migration 0016) et sa ligne est verrouillée pendant la mise à jour (`for update`) : deux workers ne peuvent pas envoyer deux fois la même alerte (test avec deux passages simultanés).

### Panne de la base de données (la plus probable)

La supervision ne dépend pas du composant qu'elle surveille. Si l'enregistrement échoue (PostgreSQL arrêté, plus de connexion), le worker garde l'état de chaque cible **en mémoire** (même seuil de 3 échecs, même rappel de 60 minutes, aucune alerte en double) et envoie l'alerte **par email seul**, avec la mention « Base de données injoignable depuis le worker » (le Web Push a besoin de la base pour retrouver les abonnements). Au retour de la base, l'état en mémoire sert de point de départ s'il est plus récent : le rétablissement est notifié, rien n'est renvoyé en double. Test : `apps/worker/src/supervision.test.ts` (« db.withGlobal lève → un email part au 3e échec »).

Conséquence : **sans vrai service d'email** (`EMAIL_PROVIDER=noop`, choix d'Ibrahim en attente), une panne de base ne prévient personne. Le worker l'écrit au démarrage.

### Alerte délivrée à personne

Un email n'est compté que s'il part chez un **vrai** fournisseur (le fournisseur `noop` journalise sans rien envoyer : `delivers = false`), un push que s'il est accepté par le service de notification. Si une alerte ou un rappel n'atteint **aucun** canal, le worker journalise en erreur « alerte NON délivrée », n'enregistre pas l'heure de l'alerte et **retente au passage suivant** (une minute plus tard) au lieu d'attendre le rappel de 60 minutes. Le nombre de canaux délivrés est gardé par vérification (`supervision_checks.delivered`, migration 0018) et affiché dans Administration › Supervision (« Alerte NON délivrée », bandeau rouge).

### Historique des alertes

La page Administration › Supervision montre **toutes les alertes des 7 derniers jours** (au plus 200, requête dédiée sur `supervision_checks where event is not null`), pas seulement celles des 20 dernières vérifications : une panne de 3 h du matin reste visible le lendemain.

## Alertes sur le téléphone

- **Destinataires** : les adresses de `OPERATOR_EMAILS` (worker ; les mêmes que l'API).
- **Web Push** sur tous les appareils où ces personnes ont activé les notifications (Paramètres › Notifications, toutes leurs organisations), avec les clés VAPID déjà utilisées par Radar (docs/CLES-ET-CONFIGURATION.md §11). Sur iPhone, Selio doit être ajouté à l'écran d'accueil.
- **Email** en plus, par le fournisseur d'email configuré (`noop` par défaut : rien ne part, le service est à choisir).
- Contenu : « Selio : « api » ne répond plus » / « toujours en panne » / « rétabli », le nombre d'échecs et la durée, un lien vers `/admin`. Ni adresse interne, ni jeton, ni corps de réponse.
- Sans `OPERATOR_EMAILS`, ou avec l'email `noop` et sans clés VAPID, les pannes sont **enregistrées et journalisées, personne n'est prévenu** : le worker l'écrit en avertissement au démarrage (« aucun canal d'alerte utilisable ») et chaque alerte est journalisée « NON délivrée ».

### Activer les alertes, pas à pas

1. Worker : `OPERATOR_EMAILS=vous@domaine.fr`, `PUBLIC_API_URL=https://api.<domaine>` (adresse vue depuis le worker ; sur la même machine, l'adresse interne convient), `AI_HEALTH_TOKEN` identique à celui de l'API, clés VAPID.
2. Sur le téléphone : se connecter à Selio avec une adresse de `OPERATOR_EMAILS`, Paramètres › Notifications › activer sur cet appareil.
3. Essai : arrêter l'API quelques minutes ; l'alerte arrive au troisième échec, « rétabli » au redémarrage.

## Limite assumée et option externe

Le worker tourne sur la même machine que l'API (Marseille). **Si la machine entière, son courant ou sa connexion tombent, le worker ne prévient personne.** **Si Redis tombe**, le planning BullMQ ne déclenche plus aucun passage `supervision.tick` : là non plus, personne n'est prévenu par le worker. Pour ces deux cas, un contrôle externe est **indispensable** (recommandé avant l'ouverture aux clients ; le worker avertit au démarrage tant que `SUPERVISION_HEARTBEAT_URL` est vide). Deux options externes, **préparées mais désactivées**, à choisir avec Ibrahim (service gratuit seulement, aucun n'est retenu) :

- **Sonde externe** : un service de disponibilité gratuit interroge `https://api.<domaine>/api/health` toutes les quelques minutes et alerte sur un 503 ou un silence. Exige que `/api/health` soit joignable depuis Internet (aujourd'hui, l'API passe par le tunnel ; `/api/health` ne dit rien de secret).
- **Battement** (« heartbeat ») : `SUPERVISION_HEARTBEAT_URL=https://…` (HTTPS seulement). À chaque passage où **toutes** les cibles répondent, le worker appelle cette adresse ; le service externe alerte quand les battements cessent (machine éteinte, worker arrêté, panne). Rien ne sort de la machine d'autre que cet appel sans contenu.

## Réglages

| Variable (worker) | Défaut | Rôle |
|---|---|---|
| `CRON_SUPERVISION` | `* * * * *` | Cadence de `supervision.tick` |
| `PUBLIC_API_URL` | `http://127.0.0.1:8787` | Base des cibles par défaut |
| `OPERATOR_EMAILS` | vide | Destinataires des alertes |
| `AI_HEALTH_TOKEN` | vide | Jeton de `/api/ai/health` (absent : cible `ia` non contrôlée) |
| `SUPERVISION_TARGETS` | vide | Cibles explicites (JSON) |
| `SUPERVISION_FAILURES_BEFORE_ALERT` | `3` | Échecs consécutifs avant alerte (1 à 60) |
| `SUPERVISION_REMINDER_MINUTES` | `60` | Rappel pendant une panne (5 à 1 440) |
| `SUPERVISION_TIMEOUT_MS` | `10000` | Délai d'une vérification (1 000 à 60 000) |
| `SUPERVISION_HEARTBEAT_URL` | vide | Option externe (battement), HTTPS seulement |

Détail des variables : docs/CLES-ET-CONFIGURATION.md §16.

## Points d'attention

- `/api/health` répond **503** quand la base, Redis ou la file sont en panne (avant : toujours 200). Une sonde de déploiement qui l'utiliserait redémarrera l'API dans ce cas : vérifier les sondes de `deploy/`.
- Les erreurs sont tronquées, les adresses enregistrées sans requête ni identifiants, les en-têtes ne quittent pas la mémoire du worker.

## Tests

- `packages/core/src/services/supervision.test.ts` : machine à états, vérification des cibles.
- `apps/worker/src/supervision.test.ts` (base dédiée) : 3 échecs → une seule alerte, rappel à 60 min, rétablissement notifié, aucun doublon avec deux passages simultanés, base injoignable (email au 3e échec, resynchronisation), email `noop` jamais compté « envoyé » et retenté, alertes de 7 jours, avertissements de démarrage, lecture des variables.
- `apps/api/test/health.test.ts` (base dédiée) : contenu de `/api/health`, 503, `/api/health/details` réservé aux opérateurs.
