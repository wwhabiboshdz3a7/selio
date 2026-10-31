# Selio — ce qu'il reste à développer

> À coller tel quel au début de la session, avec l'accès au dépôt GitHub.

---

Tu reprends **Selio**, une suite d'outils pour les revendeurs Vinted : Selio Manager (gestion des comptes, stock, dressing, messagerie et négociation par l'IA, commandes, marges), Selio Studio (annonces rédigées à partir des photos), Selio Track (analyse du marché), Selio Radar (bot d'achat), Selio Cloud (automatisation quand l'ordinateur du client est éteint) et Selio Comptes (accompagnement). Une grande partie est déjà construite et testée. Ton travail : **finir ce qui reste**, dans l'ordre ci-dessous, sans casser l'existant.

## 1. Avant de coder

1. Vérifie que tu es sur la branche la plus à jour du dépôt : celle qui contient `livraison/Selio-compte-rendu-reunion-2.pdf` et `docs/PROMPT-SUITE-DU-DEVELOPPEMENT.md`. Crée ta propre branche de travail à partir d'elle.
2. Lis, dans cet ordre : `README.md`, `docs/BUILD_STATUS.md` (ce qui est fait, simulé ou absent), `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/SECURITY.md`, `docs/OLLAMA-SETUP.md`, `docs/DEPLOYMENT.md`, `docs/CLES-ET-CONFIGURATION.md`, `brand/GUIDELINES-DEV.md` (la charte, à respecter partout).
3. Les décisions produit sont dans `livraison/` : surtout `Selio-compte-rendu-reunion-2.pdf` (tarifs, trois modèles d'IA, Cloud, bot, Track, paiement), `Selio-reponses-strategie-V3.pdf` (machine, capacité, quotas, ordre de travail) et `Selio-etude-juridique-concurrents.pdf` (ce qu'on s'autorise ou non).
4. Lance `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, puis la démo (`pnpm dev`) pour voir l'application avant de toucher quoi que ce soit.

Le dépôt est un monorepo pnpm : `apps/web` (vitrine + application, React, Vite, PWA), `apps/extension` (Chrome MV3), `apps/api` (Fastify), `apps/worker` (BullMQ), et `packages/` (`ui`, `domain`, `contracts`, `connectors`, `ai`, `core`, `db`, `demo-data`).

## 2. Règles non négociables

- **Aucun secret** dans Git, les journaux, l'analytique, le `localStorage` ou le frontend. Réponses d'API masquées. `.env.example` avec des valeurs factices seulement. Ne demande jamais de coller un secret dans la conversation.
- **Aucun service ou outil payant** sans accord écrit d'Ibrahim. **Aucune mise en ligne** sur une vraie infrastructure sans son autorisation.
- **Vinted :** aucun mot de passe Vinted stocké ; aucun contournement de CAPTCHA ou de protection anti-bot ; **aucune adresse IP masquée ni proxy par compte** ; rythme humain et plafonds par jour ; arrêt et alerte au premier CAPTCHA ; le client valide les actions importantes (prix, achat) sauf réglage explicite.
- **Sessions Vinted :** seule exception, le Cloud garde **une session par compte, avec l'accord du client, chiffrée, isolée, jamais partagée, supprimée dès qu'il se déconnecte ou résilie**. Aucune collecte globale de cookies ou de sessions.
- **Données :** aucune donnée personnelle de vendeurs tiers (pseudos, profils, photos de personnes) dans les bases de Track ou de Radar. Track ne republie jamais d'annonces : il n'en tire que des statistiques.
- **IA :** le navigateur n'appelle jamais le serveur IA directement (seuls l'API et le worker le font). Aucun processus permanent de bot ou d'inférence dans le frontend. Aucune URL interne de production codée en dur.
- **Vocabulaire :** dans l'interface et les documents, le modèle de texte s'appelle **« mon IA perso »**. On ne promet jamais « zéro risque » ni « 100 % légal ». Selio est présenté comme **indépendant de Vinted (ni affilié, ni approuvé, ni sponsorisé)**.
- **Charte :** `brand/GUIDELINES-DEV.md` et les rôles de `packages/ui/src/styles/tokens.css`. Jamais de couleur en dur dans un composant. Clair et sombre, responsive dès 375 px, focus clavier visible, états vide / chargement / erreur / succès.
- **Qualité :** chaque tâche se termine avec `pnpm lint`, `pnpm typecheck` et `pnpm test` au vert, des tests pour ce que tu ajoutes, et `docs/BUILD_STATUS.md` mis à jour. Une fonction risquée se livre derrière un réglage désactivé par défaut.

## 3. Ce qui est déjà fait (ne pas refaire)

Site vitrine, inscription, onboarding ; stock (CRUD, photos, import et export CSV) ; dressing intelligent (note sur 100, republication réglable) ; messagerie et négociation (politique de prix déterministe dans `packages/domain/src/negotiation.ts`, l'IA rédige seulement, sortie vérifiée) ; clients, commandes, marges, analyses ; automatisations (règles, limites, pause, arrêt global) ; comptes Vinted classés vente / achat / perso ; rôles et paramètres ; administration ; extension Chrome **testée sur un vrai compte Vinted** ; intégration IA (file, disjoncteur, quotas, santé, `pnpm ai:diagnose`, `pnpm ai:bench`) ; base PostgreSQL avec RLS ; worker ; note d'affaire de Radar (`packages/domain/src/radar.ts`) et réglages d'achat automatique (`autoBuySettings`, désactivé). Le paiement existe avec un adaptateur Stripe en mode test, **à remplacer**.

## 4. La machine

Tout le service tourne sur notre machine, chez Ibrahim à Marseille : **32 Go de mémoire vive, carte graphique de 16 Go, un bon processeur**. Objectif : **50 comptes en simultané** dans le Cloud (environ 350 Mo par navigateur). Site sur Netlify (statique), le reste en Docker Compose (`deploy/`), relié par un tunnel chiffré (WireGuard ou Tailscale), aucun port ouvert. Un ordinateur portable sert de machine de secours.

## 5. Ce qu'il reste à faire, par ordre de priorité

### Semaine 1 — brancher l'existant

**5.1 Les trois modèles d'IA** (`packages/ai`)
- Trois rôles, tous via Ollama sur la machine :
  - **Modèle 1, les photos :** `qwen3-vl:8b` (variable `OLLAMA_VISION_MODEL`, existe déjà).
  - **Modèle 2, les prix :** `qwen3-embedding:0.6b` (nouvelle variable `OLLAMA_EMBED_MODEL`) pour retrouver les ventes comparables.
  - **Mon IA perso, la voix :** le modèle de texte (`OLLAMA_MODEL`). Ibrahim te donne son nom à part.
- Router chaque tâche vers le bon modèle ; garder les trois chargés (`OLLAMA_MAX_LOADED_MODELS=3`, `OLLAMA_KEEP_ALIVE`).
- Mesurer sur la machine avec `pnpm ai:bench` (réponses par minute, p50/p95), relever le modèle exact de la carte, régler `AI_MAX_CONCURRENCY` et les quotas, reporter les chiffres dans `docs/OLLAMA-SETUP.md`.
- Repère attendu : environ 15 réponses par minute et environ 3,6 s par photo Studio.

**5.2 Les offres et les quotas** (`packages/contracts/src/org.ts`, `packages/core/src/services/billing.ts`, aide en ligne)
- Plans : **Starter** 6,99 € (1 compte, 300 réponses de l'IA par mois), **Pro** 24,99 € (3 comptes, Track essentiel, relance après 24 h proposée, 20 annonces Studio et 10 photos portées par mois, 1 500 réponses), **Agence** 49,99 € (10 comptes, Track complet, relance automatique, Cloud inclus, rôles d'équipe, 60 annonces Studio et 30 photos portées, 5 000 réponses, migration assistée, support prioritaire). Plus de 10 comptes : sur devis.
- **Aucun compte supplémentaire à la carte.**
- Essai de **14 jours** (remplace l'essai Découverte de 7 ou 30 jours), carte enregistrée dès le début, rien n'est débité avant la fin. Annuel : 2 mois offerts. Offre fondateurs pour les 50 premiers : −30 % pendant 6 mois sur Pro et Agence, un mois offert sur le Starter.
- Renommer « Essentiel » en « Starter », ajouter le plan `agence`, mettre à jour libellés, aide, tests.
- **Les prix ne sont pas définitifs** : ils vivent dans une configuration, pas en dur dans les composants.
- Autres filiales, même principe :
  - Studio seul : curseur par nombre de photos, plancher 0,02 € la photo et 4,99 € minimum par achat, valeurs exactes à confirmer.
  - Radar 14,99 €, Radar Auto 29,99 €.
  - Cloud en option à 9,99 € pour Starter et Pro.
  - Selio Comptes : audit 9,99 €, accompagnement 14,99 €, payés une fois.
- **Compteurs par filiale :** annonces et photos Studio, scans et recherches par photo Track, photos portées. Remise à zéro chaque mois (aujourd'hui le 1er du mois dans `getUsage`). Page « Mon utilisation » avec une barre par filiale et une alerte à 80 %. Vue administrateur de l'usage par client.

**5.3 Les gabarits de contre-offre**
- Remplacer « c'est mon meilleur prix » et « c'est mon dernier prix » dans `packages/core/src/services/automation.ts`, `packages/ai/src/policy/validate.ts`, `packages/ai/src/providers/mock.ts`, `packages/demo-data/src/seed.ts` et `packages/contracts/src/org.ts`.
- Règle : **« dernier prix » seulement quand le prix proposé est égal au plancher**, sinon une formule neutre (« Je peux vous le faire à X €. Si cela vous convient, faites l'offre à ce montant. »).
- Retirer « l'article est en très bon état » du message final.
- Tests à jour.

**5.4 Emails transactionnels**
- Invitations, réinitialisation du mot de passe, échec de paiement, alertes.
- Le choix du service est à valider avec Ibrahim avant de brancher.

### Semaine 2 — paiement et fichiers

**5.5 Paiement avec Revolut** (remplace Stripe)
- Garder une interface de fournisseur de paiement (pour pouvoir brancher Mollie en secours) et écrire l'adaptateur Revolut Merchant API.
- **Encaissement :** formulaire Revolut intégré (carte, Apple Pay, Google Pay, Revolut Pay), carte enregistrée « pour le marchand », débit mensuel par l'API depuis le worker, webhooks vérifiés et idempotents.
- **Échecs :** nouvelles tentatives à J+1, J+3 et J+7 avec email ; après trois échecs, retour à l'accès de base, données gardées 30 jours.
- **Factures, résiliation en trois clics**, environnement de test Revolut.
- **Frais :** 1 % + 0,20 € par carte européenne. Prélèvement SEPA à 0,6 %, plafonné à 5 €, prévu plus tard pour l'annuel.
- Clés uniquement en variables d'environnement, placeholders dans `.env.example`.

**5.6 Stockage des photos**
- Stockage objet compatible S3 hébergé sur notre machine (les données restent en France).
- URLs signées, contrôle du type et de la taille, route d'envoi dans l'API.

### Semaine 3 — bêta fermée

Bêta de Manager et Studio avec 15 à 20 testeurs. Suivi des inscriptions sans outil tiers : source, code promo par créateur, entonnoir inscription → essai → paiement → départ. Question à l'inscription : « quel outil utilisez-vous aujourd'hui ? ». La collecte de Track démarre en même temps (voir 5.9).

### Semaines 3 à 5 — Selio Cloud (au lancement)

**5.7 Le Cloud**
- **Isolation :** un profil Chromium isolé par compte Vinted sur la machine. Le client se connecte lui-même dans une fenêtre sécurisée ; le mot de passe n'est jamais enregistré ni journalisé.
- **Session :** chiffrée, une par compte, supprimable par le client.
- **Planificateur :** BullMQ ouvre le navigateur seulement pour agir (republier, répondre, relancer), au rythme humain, avec les plafonds déjà dans le code, puis le referme.
- **Journal des actions** visible par le client et gardé 90 jours ; pause et arrêt en un clic.
- **Écran d'accord** avant activation : risques expliqués, case à cocher, accord enregistré.
- **Adresse partagée :** au lancement, seulement des actions légères dans le Cloud partagé ; pause automatique d'un compte au premier avertissement de Vinted ; 10 comptes maximum par client.
- Capacité visée : 50 navigateurs ouverts en même temps.
- **Sauvegarde** chiffrée chaque nuit avec une copie hors de la machine, test de restauration mensuel. Bascule sur l'ordinateur portable.
- **Plus tard, à concevoir :** la « Selio Box », un petit agent chez le client, piloté depuis Marseille, qui agit avec sa propre connexion.

### Semaines 4 à 6 — Selio Radar

**5.8 Radar et Radar Auto**
- **Surveillance :** recherches du client relues toutes les 60 s (Radar) ou toutes les 30 s sur 3 recherches prioritaires (Radar Auto), depuis son compte Achat.
- **Note et décision :** note d'affaire existante, plus le prix de revente estimé par le modèle 2.
- **Radar :** alerte sur le téléphone (notifications de la PWA) et « 1 clic » qui ouvre l'annonce prête, le client achète lui-même.
- **Radar Auto :** achat automatique avec seuil de note, prix maximum par article et plafond par jour. Paiement par le porte-monnaie Vinted du client ; si la banque demande une validation 3-D Secure, l'achat attend le client.
- **Mesures :** délai entre publication et détection, puis achat ; taux de blocage (CAPTCHA, erreurs « trop de requêtes » pour 1 000 pages, ralentissement automatique au-delà de 1 pour 1 000).
- **Garde-fous :** Radar Auto derrière un réglage désactivé, testé d'abord sur nos propres comptes, **pas activé pour les clients sur l'adresse partagée** tant qu'Ibrahim n'a pas tranché.
- Prix d'achat reporté dans Manager pour suivre la marge.

### Semaines 5 à 8 — Track, prix, Studio avancé, migration

**5.9 Selio Track** (Pro et Agence seulement, inspiré de ResellTrack)

| | Pro | Agence |
|---|---|---|
| Filtres suivis, relus toutes les 2 h | 5 | 25 |
| Scans de niche par mois (score 0 à 100 par marque et catégorie) | 10 | 50 |
| Recherches par photo par mois | 30 | 150 |
| Historique | 3 mois | 12 mois |

- Les filtres identiques entre clients sont lus une seule fois.
- Pour tous : tendances sur 30 jours, comparables dans le panneau de l'extension.
- Agence seulement : flux des ventes, et analyse d'un vendeur concurrent après validation RGPD.
- **Statistiques seulement :** ni annonce republiée, ni photo d'annonce gardée, ni pseudo.

**5.10 L'estimation des prix par l'IA**
- **Données :** base de références (marque, catégorie, taille, matière, état, prix affiché et final, dates, nombre de photos) et nettoyage.
- **Deux moteurs :**
  - les comparables, retrouvés grâce au modèle 2 ;
  - un modèle de prix entraîné, de type gradient boosting, qui prédit les quantiles P25 / P50 / P75. Ça donne trois stratégies : vente rapide, standard, marge maximale.
- Un modèle du délai de vente.
- **Entraînement** sur le passé, test sur le dernier mois, ré-entraînement chaque semaine.
- Service interne sur le processeur, utilisé par Studio, Manager, Radar et Track. Mon IA perso explique le prix en mots.
- Méthode illustrée dans le compte rendu (partie 07).

**5.11 Studio façon Kavis**
- **Tri des photos :** face, dos, étiquettes, défauts ; regroupement par article.
- **Lecture des étiquettes** (marque, taille, matière, référence) avec le modèle 1. Garder GLM-OCR comme essai pour les étiquettes difficiles.
- **Mesures :**
  - lues sur un mètre ruban photographié ;
  - ou retrouvées dans la base par la référence ;
  - sinon champ vide et question au vendeur. **Jamais de mesure inventée** : chaque champ dit d'où il vient.
- Envoyer au modèle 4 à 6 photos réduites, pas 12 en pleine taille (mémoire de travail).
- **Validation sur nos photos :** 200 photos d'étiquettes et 50 articles avec mètre ruban. Objectif : au moins 95 % de marques et tailles justes, et 9 mesures sur 10 justes à 1 cm près.
- **Photos portées :** à construire ; modèle à licence commerciale ou service payant à valider. File d'attente la nuit. Quotas 10 (Pro) et 30 (Agence), 0,25 € au-delà.

**5.12 Négociation avancée**
- Négociation sur les lots.
- **Relance après 24 h :** proposée en Pro, automatique en Agence via le Cloud.
- **Situations personnalisées :** déclencheurs par mots-clés.
- Mesurer sur un vrai compte les limites de Vinted (contre-offres par conversation, durée d'une offre, délai entre messages).

**5.13 Migration depuis Bleam et Clemz**
- Le client colle ses réglages ou envoie des captures ; mon IA perso les convertit.
- Écran « ancien → nouveau » pour valider ou corriger.
- Import d'un fichier si le client en obtient un au titre de la portabilité RGPD.
- **Jamais** de connexion à leurs services à la place du client.

**5.14 Fonctions « que Bleam n'a pas »**
- Prix conseillé par les ventes réelles.
- Marge de bout en bout (prix d'achat Radar → revente).
- Contrôle des photos (floue) et des mesures manquantes par catégorie.
- Lots intelligents.
- Alerte avant les seuils de déclaration (30 ventes ou 2 000 € par an).

**5.15 Le reste**
- **Rôles d'équipe** à vérifier et finir : administrateur ; exécuteur (publie et répond, sans voir les finances) ; contributeur photos (ajoute des photos et lance le générateur, rien d'autre).
- **Parrainage :** un mois offert aux deux.
- **Selio Comptes :** checklists et textes, sans action à la place du client.
- **API Vinted Pro Integrations :** préparer le connecteur pour les comptes Pro (articles, webhooks, commandes). C'est la voie officielle ; l'accès est à demander par Ibrahim.
- **Vitrine :** une page par filiale, « Selio ou Bleam ? » et « Alternative à Bleam » (textes d'Elias), mention d'indépendance vis-à-vis de Vinted, pages légales définitives après l'avocat.
- **Extension :** publication sur le Chrome Web Store (compte développeur à 5 $, à valider).
- **Supervision :** contrôle de `/api/health` et `/api/ai/health` avec alerte sur téléphone.

## 6. Expérience de style : « Liquid Glass »

Ibrahim veut tester une fonctionnalité avec le style **Liquid Glass** (le verre translucide d'iOS 26 : flou de l'arrière-plan, réfraction sur les bords, reflet lumineux, teinte qui s'adapte au contenu derrière).

- **Où :** un **dock flottant en bas de l'application sur mobile** (navigation principale et bouton « Générer »), plus la **carte d'alerte Radar** quand une affaire arrive. Assez visible pour juger, assez petit pour rester rapide.
- **Comment :**
  - un composant `GlassSurface` dans `packages/ui` ;
  - `backdrop-filter: blur() saturate()`, avec le préfixe `-webkit-` pour Safari iOS ;
  - un liseré clair et un reflet en dégradé en haut ;
  - la réfraction des bords par un filtre SVG `feDisplacementMap` là où le navigateur le supporte (Chromium) ;
  - variantes claire et sombre construites à partir des rôles de la charte.
- **Repli obligatoire :**
  - sans `backdrop-filter` : surface opaque ;
  - si `prefers-reduced-transparency` ou `prefers-contrast: more` : surface opaque ;
  - si `prefers-reduced-motion` : pas d'animation du reflet ;
  - contraste du texte d'au moins 4,5:1 sur n'importe quel fond.
- **Activation :** désactivé par défaut, réglage « Essai : verre liquide » dans Paramètres › Apparence (et variable `VITE_EXPERIMENT_GLASS` pour la démo). La charte actuelle ne change pas ailleurs.
- **Livrable :**
  - captures avant / après en clair et en sombre, sur iPhone Safari et Chrome Android ;
  - mesure de fluidité au défilement ;
  - un avis : on garde, on étend, ou on abandonne.

## 7. Ce qui attend une décision d'Ibrahim

Ne bloque pas dessus, prépare avec un réglage désactivé et signale-le :
- prix définitifs de Studio et des filiales ;
- date de remise à zéro des quotas (1er du mois ou date anniversaire) ;
- service d'email ;
- photos portées (modèle maison ou service payant) ;
- adresse fixe par client dans le Cloud ;
- activation de Radar Auto pour les clients ;
- avis de l'avocat sur le Cloud, le bot d'achat, la collecte de Track et les conditions de vente.

## 8. Comment livrer

- Une branche par bloc (par exemple `revolut`, `cloud`, `track`), des commits clairs en français, une pull request par bloc avec ce qui a été testé et comment.
- `docs/BUILD_STATUS.md` à jour à chaque bloc, et une ligne dans `docs/DECISIONS.md` pour chaque choix technique.
- À la fin de chaque semaine : un court point « fait / en cours / bloqué » pour Ibrahim, en français simple, avec les chiffres mesurés (capacité, temps, taux de blocage).
