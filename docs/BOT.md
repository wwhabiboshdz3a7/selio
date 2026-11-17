# Selio Bot

**Selio Bot est la quatrième filiale de Selio : la recherche et l'achat d'articles.** Recherches automatisées selon vos critères, surveillance des annonces, alertes, bonnes affaires avec un score d'intérêt sur 100, estimation du prix de revente et du potentiel de marge, limites de dépenses, historique des achats, et deux modes d'achat : l'**achat rapide** validé en 1 clic (achat assisté) et l'**achat automatique** (anciennement « Radar Auto »). Selio Track analyse le marché et identifie ; Selio Bot acquiert. « Radar » n'est plus présenté comme un produit : ses écrans sont ceux de Selio Bot.

Les **automatisations du compte** (négociation par IA, relances 24 h, republication, réponses aux messages, messages aux favoris, après-vente) ne sont **pas** dans Selio Bot : elles sont dans **Selio Manager › Automatisation** (`/app/automatisation`), avec leur tableau d'état et le bouton « Arrêter toutes les automatisations ». Ce document décrit ce que fait le code au 17 novembre 2026.

> **État.** Construit et testé (domaine, cœur, API, worker, pages en démonstration). Selio Cloud reste **fermé par défaut** (`CLOUD_ENABLED=false`, avis de l'avocat attendu) ; l'achat automatique reste derrière ses **deux verrous** (`RADAR_AUTO_ENABLED=false`, `RADAR_REAL_PURCHASE=false`). Rien n'a été exécuté contre Vinted.

## Les écrans de Selio Bot

| Adresse | Écran | Notes |
|---|---|---|
| `/bot` | Accueil « Selio Bot : recherche et achat d'articles » | Recherches actives, bonnes affaires notées sur 100 (revente estimée, marge potentielle), alertes (réglées dans Paramètres › Notifications), limites de dépenses (budget par jour, max par achat, dépensé aujourd'hui), les deux modes d'achat et les deux verrous du serveur, historique des achats |
| `/app/radar` | Recherches et bonnes affaires | Adresse historique gardée (alertes sur le téléphone, journal) ; appartient à l'espace Bot (`SPACE_PREFIXES`, `apps/web/src/app/spaces/paths.ts`) |
| `/app/radar/affaires/:id` | Une affaire (« 1 clic ») | idem |
| `/app/purchase` | À valider (achat rapide) et historique | idem |
| `/bot/achat-auto` | Achat automatique : modes, verrous, réglages, achats | Réglages repris de l'ancien Radar Auto (`AutoBuyBody`) |
| `/app/auto-buy`, `/app/radar/achats/:id` | Achats automatiques, validation 3-D Secure | Adresses gardées, espace Bot |

Les anciennes adresses des automatisations de compte (`/bot/negociation`, `/bot/relance`, `/bot/republication`, `/bot/reponses`, `/bot/favoris`, `/bot/apres-vente`) redirigent vers leur page dans Selio Manager (`/app/automatisation/...`).

## Automatisations du compte (Selio Manager)

Le tableau d'état (ci-dessous « bots », nom technique gardé dans le code et l'API) est en tête de `/app/automatisation`. Les données viennent toujours de `GET /api/bot` (`packages/core/src/services/bot.ts`, `describeBots` dans `packages/domain/src/bot.ts`) ; les routes n'ont pas été renommées. L'achat automatique y figure techniquement (`auto_buy`), mais l'écran du Manager ne le montre pas : il est dans Selio Bot. Relances et republication, sans page de réglages à elles, ont une page d'état : `/app/automatisation/relances` et `/app/automatisation/republication`.

## Où tourne une automatisation

| Lieu | Quand | Limites |
|---|---|---|
| **Selio Cloud** | Forfait qui le comprend (Agence, option Pro), Cloud ouvert sur le serveur, accord accepté, au moins un compte actif avec sa session | Actions légères seulement (répondre, relancer), de 8 h à 23 h, au rythme humain, plafonds du forfait ; voir [CLOUD.md](CLOUD.md) |
| **Extension** | À défaut de Cloud, ordinateur allumé et Vinted ouvert | Les tâches « navigateur » sont remises à l'extension (mention **IV** de BUILD_STATUS : l'exécution automatique par l'extension reste à valider) |
| **Serveur Selio** | Calculs et brouillons (décision de négociation, baisse de prix dans Selio, relance Pro en brouillon) | Rien n'est écrit sur Vinted depuis le serveur |

## Les automatisations (identifiants techniques des « bots »)

| Bot | S'appuie sur | Où | État possible |
|---|---|---|---|
| Négociation | règle `auto_negotiate`, planchers et paliers (`/app/automatisation/negociation`) | décision serveur, envoi par l'extension (le Cloud ne négocie pas) | allumé, arrêté |
| Relance 24 h | règles `follow_up_24h`, `follow_up_no_reply`, quota `followUp24h` | Cloud en Agence, brouillons à valider en Pro | allumé, arrêté, en attente de Selio Cloud, indisponible sur ce forfait (Accès de base, Starter) |
| Republication | règles `relist_stale`, `price_drop_stale`, dressing | extension (la republication par le Cloud est une action lourde, fermée) | allumé, arrêté |
| Réponses aux messages | règles `reply_on_new_message`, `keyword_situation` | Cloud si prêt, sinon extension | allumé, arrêté |
| Favoris | réglages `favorites` seulement | — | **bientôt** : Selio ne lit pas encore les mises en favori, aucun message n'est envoyé |
| Achat automatique (Selio Bot) | achat automatique et achat rapide (`/bot/achat-auto`) | Cloud (compte Achat) | allumé, arrêté, verrouillé, en attente de Selio Cloud |
| Après-vente | règle `post_sale_message` | extension | allumé, arrêté |

Chaque bot affiche son état et pourquoi, où il tourne, la limite du forfait, ses règles (allumer ou arrêter ; horaires et limites dans le journal des tâches), des liens vers ses réglages existants et ses **cinq dernières actions** (journal des tâches, demandes d'achat de Radar Auto). La logique est une fonction pure, `describeBots` (`packages/domain/src/bot.ts`), partagée par le serveur et la démonstration.

## Achat rapide et achat automatique (Selio Bot)

Deux façons d'acheter, côte à côte :

- **Achat rapide (achat assisté)** : toujours disponible. Les affaires notées 75/100 ou plus arrivent dans « À valider » ; le revendeur **valide chaque achat en 1 clic**.
- **Achat automatique (anciennement Radar Auto)** : note minimale, budget max par jour, prix max par article, porte-monnaie Vinted, 3-D Secure validé par le client. Derrière **deux verrous du serveur**, visibles et expliqués : `RADAR_AUTO_ENABLED` (Radar Auto n'évalue rien sans lui, comptes de l'équipe seulement sur l'adresse partagée) et `RADAR_REAL_PURCHASE` (sans lui, arrêt avant le bouton de paiement, achat « simulé »). Puis les verrous de l'organisation (réglage, compte Achat dans le Cloud, accord). Verrous serveur fermés, Selio Bot dit : « L'achat automatique s'ouvrira après validation juridique ; en attendant, l'achat rapide vous propose chaque affaire à valider en 1 clic. »

Les réglages sont ceux de Radar Auto (`AutoBuyBody`, repris tels quels), modifiables par le titulaire seulement quand le verrou serveur est ouvert. Détail : [RADAR.md §6](RADAR.md).

## « Arrêter toutes les automatisations » (coupe-circuit de l'organisation)

- Bouton dans Selio Manager › Automatisation. `POST /api/bot/stop` et `POST /api/bot/resume` (routes gardées) : **titulaire et administrateur** (`automations.write`) ; l'exécuteur et la lecture seule voient l'état (`GET /api/bot`, `automations.read`) ; le contributeur photos n'y a pas accès.
- C'est **le même interrupteur** que l'arrêt global des automatisations (`automation_state.global_paused`) : aucune migration. Audit `bot.stopped` / `bot.resumed`, et une ligne dans le journal d'activité de Selio Manager (`recordActivity`, verbe `bot.action`, « a arrêté toutes les automatisations »). Il coupe aussi la lecture en direct et l'achat automatique de Selio Bot ; l'achat rapide reste possible (c'est le revendeur qui agit).
- Respecté **avant chaque action automatique** : passage des règles (`automationTick`, `gateRule`), file des tâches serveur (`processDueJobs`, ajouté), file de l'extension (`GET /api/ext/jobs` rend une liste vide, ajouté), planificateur Selio Cloud (`planAccountRun`, puis relecture sous verrou), lecture en direct de Radar, Radar Auto (`autoGateTx`). Les tâches en file attendent la reprise ; une action déjà commencée se termine. Une validation faite à la main par le revendeur reste possible (c'est lui qui agit), sauf par le Cloud, qui reste coupé.

## Ce qu'aucune automatisation ni Selio Bot ne fait

Contourner un CAPTCHA ou une protection anti-robot (arrêt au premier signal, rien n'est retenté), garder un mot de passe Vinted, collecter des cookies hors de la session filtrée du compte, ouvrir Selio Cloud ou l'achat réel par défaut.

## Reste à faire

- Messages aux favoris (Selio Manager) : lire les mises en favori (connecteur à construire et à valider).
- Exécution automatique des tâches « navigateur » par l'extension (aujourd'hui : brouillons et insertion à la main).
- Ouverture de Selio Cloud et de l'achat automatique : décisions d'Ibrahim après l'avis de l'avocat.
- Textes encore marqués « Radar Auto » côté serveur (notifications de `packages/core/src/services/alerts.ts`, messages d'erreur et verrous de `packages/core/src/services/radar.ts`) : à renommer « achat automatique » / « Selio Bot » avec leurs tests d'API.
