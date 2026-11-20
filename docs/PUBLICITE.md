# Publicité payante : le plan de test

Réalisé par Ibrahim, 20 novembre 2026. Version illustrée : [`livraison/ads/Selio-publicites.pdf`](../livraison/ads/Selio-publicites.pdf). Visuels, textes et sources : [`livraison/ads/`](../livraison/ads/) (textes complets dans [`livraison/ads/textes.md`](../livraison/ads/textes.md)).

## En bref

- **Quatre concepts**, un par promesse : **A** « Toute ton activité Vinted au même endroit » (Manager, multi-comptes), **B** « Tes photos deviennent une annonce » (Studio, exemple du jean), **C** « Trouve les bonnes affaires avant les autres » (Bot, note sur 100), **D** « Sache quoi acheter » (Track, chiffres marqués « exemple »).
- **Test de trois semaines, du 1er au 21 décembre**, plafond **450 €** : Meta 10 €/jour, Google Search 8 €/jour, remarketing Display la 3e semaine si la liste est assez grande, le reste en réserve.
- **Une seule chose mesurée pour décider** : le coût par inscription, puis par début d'essai dès que l'événement existe. Le coût d'acquisition visé reste celui du plan réseaux : moins de 100 € par client payant.
- **Pas de Performance Max ni de hausse de budget** avant d'avoir des conversions fiables (30 sur 30 jours).

## Budget de test (1er – 21 décembre)

| Poste | Par jour | 3 semaines | Remarque |
| --- | --- | --- | --- |
| Meta (Facebook, Instagram) | 10 € | 210 € | Budget de campagne (Advantage), 4 publicités |
| Google Search, 5 campagnes | 8 € | 168 € | Annonce IA 2 €, Multi-comptes 2 €, Négociation 1,50 €, Prix de revente 1,50 €, Bot 1 € |
| Remarketing Display (3e semaine) | 2 € | 14 € | Seulement si la liste des visiteurs atteint 100 personnes |
| Réserve | — | 58 € | Renfort du meilleur concept la 3e semaine |
| **Total** | **≈ 20 €** | **450 €** | Ordre de grandeur du budget de départ de la stratégie V1 (400 – 500 €) |

Décembre coûte plus cher (fêtes) : le test donne des ordres de grandeur, pas des coûts définitifs. Hausse de budget : 20 % au plus, tous les 3 à 4 jours, sur ce qui marche.

## Ciblage

- **Zone et langue** : France, français. Belgique et Suisse francophones plus tard, avec leurs propres campagnes.
- **Meta** : 18 – 54 ans, tous genres, audience Advantage+ avec suggestions (intérêts : seconde main, friperie, vintage, achat-revente, entrepreneuriat, Vinted, Leboncoin). Placements Advantage+, chaque placement avec son format (carré pour le fil, 9:16 pour stories et reels, 1,91:1 pour la colonne de droite). Exclusion : les inscrits (audience du site, événement d'inscription, 180 jours).
- **Google Search** : les intentions des 5 campagnes (gestion multi-comptes, annonce par l'IA, prix de revente, bot d'achat, négociation automatique) ; mots-clés exacts et expressions seulement ; Réseau de Recherche seul (ni partenaires ni Display) ; tous appareils.
- **Remarketing Display** : visiteurs des 30 derniers jours non inscrits, plafond de 3 affichages par jour, bannières et images de `livraison/ads/visuels/`.

## Structure des campagnes

**Meta**

- Campagne « Selio · Test concepts », objectif Ventes (ou Prospects), optimisée sur l'**inscription** (assez de volume pour apprendre ; le début d'essai prendra le relais).
- Un ensemble de publicités, quatre publicités (A, B, C, D) ; chacune porte ses trois formats (carré, story, lien) et l'accroche A. Textes : `textes.md`, partie 1.
- Lien vers la page d'arrivée du concept avec `utm_source=meta&utm_medium=paid_social&utm_campaign=selio-<concept>&utm_content={{ad.name}}`.

**Google**

- Cinq campagnes Search, une par intention, un groupe d'annonces et une annonce responsive chacune (15 titres, 4 descriptions), URL finales `/logiciel-vinted`, `/annonce-vinted-ia`, `/prix-revente-vinted`, `/bot-achat-vinted`, `/negociation-automatique-vinted`. Import : `livraison/ads/google-ads-editeur.csv`.
- Liste partagée de mots-clés négatifs et extensions (liens annexes, accroches, extraits) : `textes.md`, partie 3.
- Enchères : « Maximiser les clics » avec un CPC maximum de 0,80 € pendant deux semaines, puis « Maximiser les conversions » dès 15 conversions sur 30 jours.
- Plus tard (janvier, avec 30 conversions sur 30 jours) : Performance Max, une campagne, quatre groupes d'éléments (`textes.md`, partie 4), avec les vidéos 9:16 de `livraison/video/` et leurs versions 16:9 de `livraison/ads/videos/`.

## Suivi des conversions

Le site sait déjà charger Google tag et le pixel Meta **après consentement** (bandeau CNIL, mode Consentement v2 : `apps/web/src/marketing/consent.ts`, `tracking.ts`). Il suffit de renseigner au build Netlify : `VITE_GOOGLE_ADS_ID`, `VITE_GOOGLE_ADS_SIGNUP_LABEL`, `VITE_GOOGLE_ADS_TRIAL_LABEL`, `VITE_META_PIXEL_ID` (et `VITE_GA4_ID` pour la mesure d'audience).

| Événement | Déclencheur | Meta | Google Ads | Rôle |
| --- | --- | --- | --- | --- |
| Inscription | compte créé (`Register.tsx`) | `CompleteRegistration` (existe) | conversion « Inscription » (existe) | **principale** pendant le test |
| Clic vers l'essai | tout lien vers `/inscription` | `ClicEssai` (existe) | conversion « Clic essai » (existe) | secondaire, observation seulement |
| Début d'essai | carte enregistrée, essai démarré | `StartTrial` par l'API Conversions | import de conversion (gclid) | **principale** dès qu'elle existe (**à ajouter**, côté serveur) |
| Abonnement payé | premier paiement après l'essai | `Subscribe` avec valeur | import hors ligne avec valeur | coût par client payant |

À prévoir côté application : garder `gclid`, `fbclid` et les `utm` à l'inscription, pour relier un essai ou un abonnement à sa publicité sans dépendre des cookies.

## Calendrier des tests A/B

| Semaine | Meta | Google |
| --- | --- | --- |
| **23 – 30 nov.** (préparation) | Compte publicitaire, page et Instagram reliés, domaine vérifié, pixel et API Conversions, audiences d'exclusion | Compte, balise, conversions, import du CSV, liste de négatifs, extensions ; vérifier les 5 pages d'arrivée en ligne |
| **1er – 7 déc.** | Les 4 concepts face à face (même accroche A, mêmes formats) | Les 5 campagnes ; lecture des termes de recherche 2 fois par semaine, ajout de négatifs |
| **8 – 14 déc.** | Les 2 meilleurs concepts ; accroche A contre accroche B (outil « Test A/B » de Meta) | Couper les mots-clés à plus de 15 € sans inscription ; budget déplacé vers les 2 meilleures campagnes |
| **15 – 21 déc.** | Image fixe contre vidéo 9:16 (Studio 27 s, Track 24 s, Bot 29 s) sur le meilleur concept | Passage à « Maximiser les conversions » si 15 conversions ; remarketing Display si la liste atteint 100 personnes |
| **22 déc.** | Bilan et décision : continuer, augmenter ou arrêter | idem |

Une variante n'est jugée qu'après **au moins 1 000 impressions et 50 clics**, ou deux fois le coût visé dépensé.

## Indicateurs (revue chaque lundi, 30 min, avec celle des réseaux)

| Indicateur | Seuil d'alerte | Visé (hypothèse à confirmer) |
| --- | --- | --- |
| CTR Meta (clics sur le lien) | < 0,6 % après 2 000 impressions : changer le visuel | ≥ 1 % |
| CTR Search | < 3 % : revoir mots-clés et titres | ≥ 5 % |
| CPC Search | > 1,20 € | ≤ 0,80 € |
| Coût par inscription | > 30 € : couper la publicité ou le mot-clé | ≤ 15 € |
| Coût par début d'essai | > 60 € | ≤ 30 € |
| Inscription → début d'essai | < 30 % : regarder la page d'inscription, pas la publicité | ≥ 50 % |
| Répétition Meta | > 3 par semaine : renouveler les visuels | ≤ 2 |

## Règles (rappel)

Aucune promesse de gain chiffrée, aucun faux avis ni nombre d'utilisateurs ; chiffres des visuels marqués « exemple » ; jamais de logo, de couleur ou de capture de Vinted ; « Selio est indépendant de Vinted » sur les visuels et les textes ; l'utilisateur fixe ses règles et valide ses achats (jamais d'achat automatique dans une publicité, il reste fermé) ; l'essai demande une carte, la page d'arrivée doit le dire avant l'inscription.

## Points d'attention

- **Marque « Vinted » dans les annonces Google** : autorisée tant que Vinted ne s'y oppose pas ; si l'usage est restreint, les titres sans « Vinted » (au moins 11 sur 15 par annonce) suffisent. Les mots-clés contenant « vinted » restent possibles.
- **Marques d'articles** (Levi's dans le concept B, étiquette Tommy Hilfiger dans la vidéo Studio) : montrées comme exemple d'annonce, jamais dans un texte Google. En cas de refus, utiliser une autre publicité du concept B ou retirer le nom de marque du visuel (`source/concepts.mjs`).
- **Prix indicatifs** : absents des publicités tant qu'ils ne sont pas définitifs.
- **Adresse du site** : `seliovprod.netlify.app` fonctionne, mais un domaine à soi inspirera plus confiance dans les annonces ; à prévoir avant d'augmenter les budgets.
- **Selio Cloud et l'achat automatique** restent fermés (avis de l'avocat attendu) : les textes parlent de l'extension, navigateur ouvert, et de l'achat validé en 1 clic.
