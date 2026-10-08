# Journal des décisions

Format : contexte → décision → conséquences. Les décisions sont datées du 8 octobre 2026 sauf mention contraire.

## D01 — Repartir du dépôt v1 comme source d'inspiration, pas comme base
Le dépôt contenait un MVP « marketplace » (charte bleue, Playfair, scène 3D) contraire aux guidelines v2 et au produit visé (outil de gestion). **Décision** : suppression du code v1, conservation des idées éprouvées (sessions cookie HttpOnly, hachage scrypt, format fr-FR, Netlify). **Conséquence** : aucune dette visuelle héritée ; l'historique Git conserve la v1.

## D02 — Tailwind v4 avec un thème CSS miroir du preset v3
Le preset livré cible Tailwind v3 (`module.exports`, `presets`). **Décision** : Tailwind v4 (CSS-first) avec `packages/ui/src/styles/theme.css` (`@theme inline`) reproduisant exactement le preset ; le preset est conservé, converti en ESM et corrigé, pour un éventuel projet v3. **Corrections documentées** : `module.exports` → `export default` (monorepo en `type: module`) ; ajout de `inherit` et des gris 300/400/900 (graphiques, toggles) ; `--spacing: 4px` pour garder la grille de 4 px malgré la taille racine de 14 px imposée par tokens.css ; palette Tailwind par défaut retirée (`--color-*: initial`) pour garantir l'absence de bleu.

## D03 — tokens.css : police auto-hébergée
Le fichier livré chargeait Inter depuis Google Fonts (requête tierce, PWA hors-ligne impossible, CSP). **Décision** : retrait de l'`@import` externe, Inter 400/500/600 via `@fontsource/inter`, ajout de `color-scheme` pour les contrôles natifs. Le reste du fichier est inchangé.

## D04 — Logos
Les PNG officiels (4×) sont fournis dans `brand/`. **Décision** : utilisation des PNG (noir sur fond clair, blanc sur fond sombre) dans la vitrine et l'application ; un wordmark SVG monochrome sert de repli (extension, favicon, contextes où un PNG serait flou). **Asset manquant** : la source vectorielle `logo-principal.svg` mentionnée dans les guidelines n'est pas fournie ; les favicons sont dérivés des PNG.

## D05 — PostgreSQL « compatible Supabase » plutôt que le SDK Supabase
**Décision** : PostgreSQL via `pg`, migrations SQL versionnées, authentification maison (scrypt + sessions), RLS forcée pour un rôle applicatif non superuser. La base peut être hébergée chez Supabase (Postgres managé) sans dépendance au SDK ni à Supabase Auth. **Conséquence** : environnement local 100 % Docker, tests d'isolation exécutables partout.

## D06 — Deux implémentations d'un même `DataClient`
**Décision** : l'application web parle à une interface unique ; `DemoClient` tourne dans le navigateur (localStorage, règles `domain`, simulateurs déterministes) et `ApiClient` appelle l'API. **Conséquence** : la démo prouve les règles métier avec le même code que le serveur ; aucun repli silencieux (le mode connecté sans API affiche un message honnête).

## D07 — L'IA rédige, la politique décide
**Décision** : `evaluateOffer` (déterministe) tranche avant tout appel IA ; la sortie IA est validée par schéma puis par politique ; en production (`ALLOW_AI_FALLBACK=false`, `AI_PROVIDER≠mock` imposés), une panne IA produit une erreur explicite. Les automatisations utilisent des gabarits déterministes et continuent sans IA.

## D08 — Connecteur Vinted = extension, expérimental, non vérifié
Pas d'API publique vendeur, pas d'OAuth officiel. **Décision** : le serveur ne possède jamais de session Vinted ; l'extension lit la page ouverte via des adaptateurs DOM versionnés testés sur fixtures synthétiques ; `send_message` est **indisponible** côté serveur (le texte est inséré, l'utilisateur envoie). Statut annoncé partout : expérimental, à valider en navigateur réel.

## D09 — File de tâches : BullMQ pour le déclenchement, table `jobs` pour l'état
**Décision** : la table `jobs` est la source de vérité observable (clé d'idempotence, tentatives, résultat) ; BullMQ (Redis) ne porte que les planifications répétables. Sans Redis, l'API fonctionne en mode inline (exécution immédiate) — documenté.

## D10 — Paiement : Stripe REST minimal, mode test imposé
**Décision** : pas de SDK ; vérification de signature HMAC et idempotence par identifiant d'événement ; clé live refusée sans `STRIPE_LIVE_ALLOWED=true`. Aucun abonnement n'est créé sans configuration explicite.

## D11 — Achat assisté simulé, achat réel désactivé
**Décision** : workflow complet (budget, prix max, contrôles, doublons) avec exécution simulée ; `realPurchaseEnabled=false` sans possibilité de l'activer depuis l'interface tant qu'aucun connecteur autorisé n'existe. Aucun endpoint d'achat n'est improvisé.

## D12 — Secrets
Infrastructure : variables d'environnement validées au démarrage. Par organisation : chiffrement AES-256-GCM (`SECRETS_ENCRYPTION_KEY` hors base). Jetons d'extension hachés, affichés une fois, portées limitées, expiration 90 jours, révocation.

## D13 — Instantanés dans le client de démonstration (correctif)
Le cache de requêtes partageait les objets mutés en place par `DemoClient`, rendant certains changements invisibles aux effets React. **Décision** : toute valeur renvoyée par `DemoClient` est clonée (`structuredClone`) via un proxy.

## D14 — Tarifs
Structure à trois plans avec quotas dans `contracts` ; montants de la vitrine **indicatifs** (`VITE_SHOW_INDICATIVE_PRICING`). Aucun avis client, chiffre d'utilisateurs ou partenariat n'est affiché.

## D15 — Bundles esbuild pour l'API et le worker
La sortie `tsc` d'un monorepo ESM n'est pas exécutable telle quelle (imports sans extension, paquets `@selio/*` pointant vers des sources TypeScript). **Décision** : `pnpm build:api` et `pnpm build:worker` produisent des bundles ESM Node 22 avec esbuild (`apps/*/scripts/build.mjs`) : dépendances npm externes, paquets internes inclus, source maps. L'API expose aussi `dist/migrate.js` et `dist/seed-demo.js` pour les conteneurs. Le typage reste vérifié par `pnpm typecheck` ; le développement utilise `tsx` sans bundle.
