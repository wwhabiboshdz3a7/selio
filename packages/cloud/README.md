# @selio/cloud — socle technique de Selio Cloud

Exécution d'actions Vinted dans un navigateur Chromium isolé sur notre machine, quand l'ordinateur du client est éteint. Ce paquet ne touche ni à la base ni au chiffrement : la session est fournie déchiffrée par l'appelant (`@selio/core`), qui la rechiffre (SecretBox de `@selio/db`, clé `SECRETS_ENCRYPTION_KEY`) avant de la stocker.

## Règles tenues par le code

- **Aucun mot de passe Vinted** : le client se connecte lui-même dans la fenêtre sécurisée (`LoginWindow`). Ses frappes sont relayées à Chromium (CDP `Input.*`), jamais journalisées ni citées dans une erreur.
- **Session limitée à vinted.\*** : `filterStorageState` ne garde que les cookies des domaines vinted.\* et le stockage local des origines `https://…vinted.*`. Tout le reste (Google, localhost, imitations comme `vinted.fr.evil.com`) est écarté avant toute sérialisation.
- **Aucun contournement** : pas de plugin « stealth », pas d'option qui masque l'automatisation, pas de User-Agent modifié (le test d'intégration vérifie que Chromium se présente comme `HeadlessChrome`), pas de résolution de CAPTCHA. `detectBlock` sert uniquement à s'arrêter : `captcha`, `warning`, `blocked`, `rate_limited` → pause du compte côté service, aucune nouvelle tentative.
- **Navigateur ouvert seulement pour agir** : un Chromium neuf par action, sur un profil temporaire (0700) supprimé à la fin ; aucun processus permanent par compte. `BrowserSlots` borne les navigateurs simultanés (`CLOUD_MAX_BROWSERS`).
- **Rythme humain** (`pacing.ts`) : 45 à 180 s entre deux actions, heures actives 8 h – 23 h (Paris), 12 actions par heure au plus, plafond du jour du plan (`automationActionsPerDay`, compteur `cloud.action`), décalage de démarrage stable par compte.
- **Adresse IP partagée** : seules les actions légères (`reply`, `follow_up`) ; `republish` (lourde) est refusée tant que `CLOUD_HEAVY_ACTIONS` n'est pas `true` — à décider par Ibrahim. Son implémentation n'est pas vérifiée.
- **Aucun clic aveugle** : la conversation doit être reconnue par l'adaptateur avant d'écrire ; l'envoi n'est « fait » que si le message apparaît. Sinon `timeout` avec `sideEffects: "unknown"` : ne jamais renvoyer automatiquement.

## Réutilisation de l'adaptateur Vinted

La lecture de la page de conversation passe par `parseConversationPage` et `COMPOSER_SELECTORS` de l'adaptateur DOM v1 (`@selio/connectors/vinted-adapter`), sans copie : `readLiveDom` (pont « enregistrer puis rejouer ») exécute l'adaptateur synchrone sur la page distante. Les compléments propres au Cloud (bouton d'envoi, menu membre, cookies de session, URL de connexion, bouton de republication) sont dans `src/vinted.ts`, **non vérifiés en réel**, à reporter dans un adaptateur v2 du connecteur.

## Variables

| Variable | Défaut | Rôle |
|---|---|---|
| `CLOUD_CHROMIUM_PATH` | — | Exécutable Chromium (aucun téléchargement). Sans lui, le Cloud est indisponible. |
| `CLOUD_HEADLESS` | `true` | Navigateur sans fenêtre. |
| `CLOUD_ACTION_TIMEOUT_MS` | `90000` | Durée maximale d'une action, navigateur compris. |
| `CLOUD_LOGIN_TIMEOUT_MS` | `300000` | Expiration de la fenêtre de connexion. |
| `CLOUD_MAX_BROWSERS` | `5` | Navigateurs simultanés. La cible de 50 est une hypothèse à mesurer. |
| `CLOUD_HEAVY_ACTIONS` | `false` | Actions lourdes (republier, modifier en masse) — à décider. |
| `CLOUD_MAX_ACCOUNTS_PER_ORG` | `10` | Comptes Cloud par organisation. |

## Commandes

- `pnpm --filter @selio/cloud test` : tests unitaires ; les tests `*.int.test.ts` se sautent sans `CLOUD_CHROMIUM_PATH`.
- `CLOUD_CHROMIUM_PATH=/chemin/chromium pnpm --filter @selio/cloud test` : avec un vrai Chromium, sur des pages locales (jamais vinted.fr).
- `CLOUD_CHROMIUM_PATH=… pnpm cloud:bench` : ouvre `CLOUD_BENCH_CONTEXTS` navigateurs (5) sur une page locale et imprime le tableau mémoire / temps d'ouverture à reporter dans `docs/CLOUD.md`. Aucun chiffre n'est une mesure de la machine de Marseille tant que le banc n'y a pas tourné.

## Pour les autres paquets

`FakeRunner` (`@selio/cloud/fake` ou l'index) remplace `PlaywrightRunner` dans les tests : scénarios `ok`, `captcha`, `warning`, `blocked`, `rate_limited`, `not_logged_in`, `selector_missing`, `timeout`, `error`, issue complète ou fonction ; `FakeLoginWindow` simule la connexion.
