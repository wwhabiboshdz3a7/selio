# Selio Bot

Selio Bot regroupe les **automatisations qui agissent pour le revendeur**, présentées comme des bots qu'on allume, règle et surveille dans l'espace `/bot`. Aucun bot n'a de logique propre : chacun s'appuie sur ce qui existe déjà (règles d'automatisation, réglages de `settings.automation`, Radar Auto). Ce document décrit ce que fait le code au 16 novembre 2026.

> **État.** Construit et testé (domaine, cœur, API, worker, pages en démonstration). Selio Cloud reste **fermé par défaut** (`CLOUD_ENABLED=false`, avis de l'avocat attendu) ; l'achat automatique reste derrière ses **deux verrous** (`RADAR_AUTO_ENABLED=false`, `RADAR_REAL_PURCHASE=false`). Rien n'a été exécuté contre Vinted.

## Où tourne un bot

| Lieu | Quand | Limites |
|---|---|---|
| **Selio Cloud** | Forfait qui le comprend (Agence, option Pro), Cloud ouvert sur le serveur, accord accepté, au moins un compte actif avec sa session | Actions légères seulement (répondre, relancer), de 8 h à 23 h, au rythme humain, plafonds du forfait ; voir [CLOUD.md](CLOUD.md) |
| **Extension** | À défaut de Cloud, ordinateur allumé et Vinted ouvert | Les tâches « navigateur » sont remises à l'extension (mention **IV** de BUILD_STATUS : l'exécution automatique par l'extension reste à valider) |
| **Serveur Selio** | Calculs et brouillons (décision de négociation, baisse de prix dans Selio, relance Pro en brouillon) | Rien n'est écrit sur Vinted depuis le serveur |

## Les bots

| Bot | S'appuie sur | Où | État possible |
|---|---|---|---|
| Négociation | règle `auto_negotiate`, planchers et paliers (`/app/automatisation/negociation`) | décision serveur, envoi par l'extension (le Cloud ne négocie pas) | allumé, arrêté |
| Relance 24 h | règles `follow_up_24h`, `follow_up_no_reply`, quota `followUp24h` | Cloud en Agence, brouillons à valider en Pro | allumé, arrêté, en attente de Selio Cloud, indisponible sur ce forfait (Accès de base, Starter) |
| Republication | règles `relist_stale`, `price_drop_stale`, dressing | extension (la republication par le Cloud est une action lourde, fermée) | allumé, arrêté |
| Réponses aux messages | règles `reply_on_new_message`, `keyword_situation` | Cloud si prêt, sinon extension | allumé, arrêté |
| Favoris | réglages `favorites` seulement | — | **bientôt** : Selio ne lit pas encore les mises en favori, aucun message n'est envoyé |
| Achat auto | Radar Auto et achat assisté (`/bot/achat-auto`) | Cloud (compte Achat) | allumé, arrêté, verrouillé, en attente de Selio Cloud |
| Après-vente | règle `post_sale_message` | extension | allumé, arrêté |

Chaque bot affiche son état et pourquoi, où il tourne, la limite du forfait, ses règles (allumer ou arrêter ; horaires et limites dans le journal des tâches), des liens vers ses réglages existants et ses **cinq dernières actions** (journal des tâches, demandes d'achat de Radar Auto). La logique est une fonction pure, `describeBots` (`packages/domain/src/bot.ts`), partagée par le serveur et la démonstration.

## Achat auto

Deux façons d'acheter, côte à côte :

- **Achat assisté** : toujours disponible. Les affaires notées 75/100 ou plus arrivent dans « À valider » ; le revendeur **valide chaque achat en 1 clic**.
- **Achat automatique (Radar Auto)** : note minimale, budget max par jour, prix max par article, porte-monnaie Vinted, 3-D Secure validé par le client. Derrière **deux verrous du serveur**, visibles et expliqués : `RADAR_AUTO_ENABLED` (Radar Auto n'évalue rien sans lui, comptes de l'équipe seulement sur l'adresse partagée) et `RADAR_REAL_PURCHASE` (sans lui, arrêt avant le bouton de paiement, achat « simulé »). Puis les verrous de l'organisation (réglage, compte Achat dans le Cloud, accord). Verrous serveur fermés, le Bot dit : « L'achat automatique s'ouvrira après validation juridique ; en attendant, l'achat assisté vous propose chaque affaire à valider. »

Les réglages sont ceux de Radar Auto (`AutoBuyBody`, repris tels quels), modifiables par le titulaire seulement quand le verrou serveur est ouvert. Détail : [RADAR.md §6](RADAR.md).

## « Tout arrêter » (coupe-circuit de l'organisation)

- `POST /api/bot/stop` et `POST /api/bot/resume` : **titulaire et administrateur** (`automations.write`) ; l'exécuteur et la lecture seule voient l'état (`GET /api/bot`, `automations.read`) ; le contributeur photos n'y a pas accès.
- C'est **le même interrupteur** que l'arrêt global des automatisations (`automation_state.global_paused`) : aucune migration. Audit `bot.stopped` / `bot.resumed`, et une ligne dans le journal d'activité de Selio Manager (`recordActivity`, verbe `bot.action`).
- Respecté **avant chaque action automatique** : passage des règles (`automationTick`, `gateRule`), file des tâches serveur (`processDueJobs`, ajouté), file de l'extension (`GET /api/ext/jobs` rend une liste vide, ajouté), planificateur Selio Cloud (`planAccountRun`, puis relecture sous verrou), lecture en direct de Radar, Radar Auto (`autoGateTx`). Les tâches en file attendent la reprise ; une action déjà commencée se termine. Une validation faite à la main par le revendeur reste possible (c'est lui qui agit), sauf par le Cloud, qui reste coupé.

## Ce qu'aucun bot ne fait

Contourner un CAPTCHA ou une protection anti-robot (arrêt au premier signal, rien n'est retenté), garder un mot de passe Vinted, collecter des cookies hors de la session filtrée du compte, ouvrir Selio Cloud ou l'achat réel par défaut.

## Reste à faire

- Bot Favoris : lire les mises en favori (connecteur à construire et à valider).
- Exécution automatique des tâches « navigateur » par l'extension (aujourd'hui : brouillons et insertion à la main).
- Ouverture de Selio Cloud et de l'achat automatique : décisions d'Ibrahim après l'avis de l'avocat.
