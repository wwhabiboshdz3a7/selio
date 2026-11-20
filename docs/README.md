# Documentation de Selio — sommaire

_Mise à jour le 20 novembre 2026. Selio est développé par Ibrahim, avec Elias._

Par où commencer :

- **Comprendre Selio et comment il a été construit** : [GUIDE-TECHNIQUE.md](GUIDE-TECHNIQUE.md) (vision, cinq filiales, architecture, choix techniques, données, sécurité, IA, paiement, tests, déploiement, journal du développement).
- **Activer ou régler quelque chose en production** : [TUTORIELS.md](TUTORIELS.md) (un tutoriel numéroté par sujet, avec vérification et retour en arrière).
- **Savoir où en est chaque module** : [BUILD_STATUS.md](BUILD_STATUS.md).
- **Aider un client** : le centre d'aide de l'application (`/app/help`) et la FAQ publique (`/faq`) reprennent les mêmes questions et des tutoriels pas à pas ; leur contenu est dans `packages/domain/src/help.ts`.

## 1. Vue d'ensemble

| Document | Contenu |
|---|---|
| [GUIDE-TECHNIQUE.md](GUIDE-TECHNIQUE.md) | Le guide complet : comment Selio a été développé, de bout en bout |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Paquets, modèle de données, calculs financiers, flux détaillés (message, commande, Cloud, Track, Bot, Studio, paiement) |
| [DECISIONS.md](DECISIONS.md) | Journal des décisions D01 à D61 (contexte, décision, conséquences) |
| [BUILD_STATUS.md](BUILD_STATUS.md) | État de chaque module (implémenté, testé, simulé, à valider), mesures, prochaines tâches |
| [PROMPT-SUITE-DU-DEVELOPPEMENT.md](PROMPT-SUITE-DU-DEVELOPPEMENT.md) | Feuille de route du développement : règles non négociables et travail restant |
| [POINT-HEBDO.md](POINT-HEBDO.md) | Point de la semaine du 8 novembre 2026 |

## 2. Les filiales et leurs fonctions

| Document | Contenu |
|---|---|
| [NEGOCIATION.md](NEGOCIATION.md) | Selio Manager : négociation avancée (lots, relance après 24 h, situations par mots-clés) |
| [MESURES-VINTED.md](MESURES-VINTED.md) | Protocole de mesure, à la main, des limites de la messagerie de Vinted |
| [MIGRATION.md](MIGRATION.md) | Selio Manager : reprise des réglages d'un autre outil, sans jamais s'y connecter |
| [CLOUD.md](CLOUD.md) | Selio Cloud (fonctionnalité du Manager) : fonctionnement, interdits, capacité, exploitation ; **fermé par défaut** |
| [STUDIO.md](STUDIO.md) | Selio Studio : tri des photos, étiquette et mesures avec provenance, photos portées, `pnpm studio:eval` |
| [TRACK.md](TRACK.md) | Selio Track : filtres suivis, niches, recherche par photo, alertes de tendance, passage au réel (§7) |
| [PRIX.md](PRIX.md) | Estimation des prix : comparables, modèle quantile maison, `pnpm prix:eval` |
| [BOT.md](BOT.md) | Selio Bot : écrans, achat rapide et achat automatique, automatisations du compte, coupe-circuit |
| [RADAR.md](RADAR.md) | Moteur de Selio Bot (ancien Radar) : lecture en direct, note, alertes, achat automatique, procédure de test |
| [CONNECTORS.md](CONNECTORS.md) | Connecteurs : simulateur, Vinted par l'extension (expérimental), Vinted Pro (accès à demander) |
| [EXTENSION-INSTALL.md](EXTENSION-INSTALL.md) | Installer, relier et utiliser l'extension Chrome |
| [WEB-STORE.md](WEB-STORE.md) | Publication de l'extension sur le Chrome Web Store (rien n'est publié) |

## 3. Production et exploitation

| Document | Contenu |
|---|---|
| [INSTALLATION-WINDOWS.md](INSTALLATION-WINDOWS.md) | **Installation de production** sur le PC Windows (WSL 2, Docker Desktop, Ollama, Tailscale Funnel, Netlify), dépannage des 502 |
| [INSTALLATION-MACHINE.md](INSTALLATION-MACHINE.md) | Variante sur une machine Linux dédiée |
| [TUTORIELS.md](TUTORIELS.md) | Tutoriels d'activation : emails, paiement, parrainage, notifications, opérateurs, offres, photos, sauvegardes, mise à jour, domaine, interrupteurs fermés |
| [CLES-ET-CONFIGURATION.md](CLES-ET-CONFIGURATION.md) | Toutes les variables et clés, section par section |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Déploiement détaillé par service (Netlify, Docker Compose, systemd, Cloud, Bot, Track) |
| [OLLAMA-SETUP.md](OLLAMA-SETUP.md) | Les trois modèles d'IA : installation, santé, diagnostic, mesures |
| [STOCKAGE.md](STOCKAGE.md) | Stockage des photos compatible S3 (MinIO), URLs signées |
| [SAUVEGARDE.md](SAUVEGARDE.md) | Sauvegarde chiffrée de la nuit, test de restauration mensuel, bascule sur le portable |
| [SUPERVISION.md](SUPERVISION.md) | Supervision de l'API et de l'IA, alertes sur le téléphone |
| [PRODUCTION-CHECKLIST.md](PRODUCTION-CHECKLIST.md) | Liste de contrôle avant chaque ouverture |
| [SECURITY.md](SECURITY.md) | Sécurité : sessions, RLS, secrets, rôles, paiement, Cloud, Bot, Track, Studio |
| [TEST-REPORT.md](TEST-REPORT.md) | Historique des passages de tests |

## 4. Marque, vitrine et communication

| Document | Contenu |
|---|---|
| [VITRINE.md](VITRINE.md) | Pages de la vitrine, référencement, mention d'indépendance vis-à-vis de Vinted |
| [PUBLICITE.md](PUBLICITE.md) | Publicités : campagnes, visuels, suivi (réglages des régies : CLES-ET-CONFIGURATION.md, section « Publicité ») |
| [RESEAUX-SOCIAUX.md](RESEAUX-SOCIAUX.md) | Plan des réseaux sociaux en bref |

Hors de ce dossier : la charte (`brand/`), les livrables (`livraison/` : rapports, études, plans, vidéos, archive Netlify de démonstration) et le README du dépôt ([../README.md](../README.md)).

## Règles d'écriture de la documentation

- Écrire ce que fait le code aujourd'hui, pas ce qu'il devrait faire ; ce qui n'est pas mesuré est « à mesurer ».
- Aucun secret, jamais : des noms de variables et des valeurs factices seulement.
- Toute fonction fermée par défaut le dit, avec la condition de son ouverture.
- Mettre à jour [BUILD_STATUS.md](BUILD_STATUS.md) à chaque livraison.

_Développé par Ibrahim — Selio._
