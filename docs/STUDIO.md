# Selio Studio — façon Kavis : tri des photos, étiquette, mesures, photos portées

_Version du 7 novembre 2026._ Studio rédige une annonce à partir des photos (§5.11 du plan). Ce document décrit le parcours, les règles qui empêchent le modèle d'inventer, l'OCR d'essai, la base des références de tailles, le protocole de validation sur nos photos et l'état des photos portées. Les routes de l'API, les passages du worker et les pages web sont livrés en parallèle : l'état exact est dans [BUILD_STATUS.md](BUILD_STATUS.md).

## En bref

- **Jamais de mesure inventée.** Chaque marque, taille, matière, référence et mesure porte sa **provenance** (lue sur l'étiquette, lue sur le mètre ruban photographié, retrouvée dans la base par la référence, indiquée par le vendeur) ou **reste vide avec une question au vendeur**. Le modèle a l'interdiction écrite d'estimer « à l'œil » ; une mesure sans mètre visible est rejetée par la validation.
- **4 à 6 photos réduites par appel** (côté long ≤ 1 024 px, JPEG ≈ 80, ≤ 1 Mo), jamais 12 en pleine taille : le navigateur réduit, le serveur revérifie les en-têtes et **refuse** (il ne réduit pas lui-même).
- **Précision à mesurer.** Les objectifs (≥ 95 % de marques et tailles justes, 9 mesures sur 10 à 1 cm près) ne sont **pas vérifiés** : `pnpm studio:eval` (section 6) les mesure sur nos propres photos ; tant qu'aucun rapport n'existe, l'interface, l'API (`GET /api/studio/limits`, `accuracy.status = "to_measure"`) et ce document disent « à mesurer ».
- **OCR d'essai facultatif** (`OLLAMA_OCR_MODEL`, vide par défaut) pour les étiquettes difficiles, en second recours seulement ; son absence ne dégrade rien.
- **Photos portées : aucun modèle ni service choisi** (décision d'Ibrahim, partie 7). Interface `WornPhotoProvider`, fournisseur « noop » qui refuse proprement, file de nuit 22 h – 6 h (Europe/Paris), quotas 10 (Pro) / 30 (Agence), dépassement à 0,25 € la photo = **proposition**, derrière `WORN_OVERAGE_ENABLED=false`.

## 1. Où vit quoi

| Où | Rôle |
|---|---|
| `packages/contracts/src/studio.ts` | Schémas et constantes : rôles des photos, lecture d'étiquette (`labelReadOutput`), mesures (`measurementsOutput`), champs avec provenance (`studioTextField`, `namedMeasurementField`), `sizeReference`, `studioPrep`, `wornPhotoJob`, limites (`STUDIO_MODEL_MAX_PHOTOS = 6`, `STUDIO_MODEL_MAX_SIDE_PX = 1024`, `STUDIO_MODEL_MAX_BYTES`, 2 photos d'étiquette, 3 de mètre), seuils de confiance, `STUDIO_ACCURACY_TARGETS` et le libellé « à mesurer » |
| `packages/domain/src/studio.ts` | Fonctions pures : regroupement par article, lots de 6, fusion des champs avec provenance (`mergeFields`), questions au vendeur selon la famille de pièce, correspondance avec la base des références, lecture des dimensions dans les en-têtes JPEG / PNG / WebP (`checkModelImage`), choix des photos pour le modèle |
| `packages/ai` (`prompts.ts`, `policy/validate.ts`, `service.ts`, `providers/ollama.ts`, `providers/mock.ts`) | Consignes au modèle 1 (interdictions écrites, exemple fictif, température 0,1), validation des sorties, `AIService.sortPhotos` / `readLabel` / `readMeasurements` / `ocrLabel`, OCR d'essai, simulateur déterministe |
| `packages/core/src/services/studio.ts` | `prepareListing` (tri → étiquette → mètre → base des références → fusion → questions), `validatePrep` (réponses du vendeur, partage anonyme des mesures), `generateListing` (annonce depuis une préparation validée), base des références côté opérateur, rétention des brouillons |
| `packages/core/src/services/worn-photos.ts` | `WornPhotoProvider` (« noop », « mock »), file de nuit, quotas, dépassement, exécution par le worker ; `billing.ts` ajoute la ligne de dépassement à la facture de renouvellement |
| `packages/db/migrations/0014_studio.sql` | `size_references` (partagée, lecture seule pour `selio_app`, écriture par deux fonctions `SECURITY DEFINER`), `studio_preps` et `worn_photo_jobs` (RLS forcée), `extra_lines` sur `payment_orders` et `invoices` |
| `apps/api/src/routes/studio.ts`, `routes/admin.ts`, `size-references.ts`, `studio-photos.ts` | `GET /api/studio/limits`, `POST /api/studio/prepare`, `GET /api/studio/preps[/:id]`, `POST /api/studio/preps/:id/validate`, `POST /api/studio/generate`, `POST/GET/DELETE /api/studio/worn`, import opérateur `POST /api/admin/size-references`, lecture des photos par clé de stockage |
| `apps/worker/src/studio.ts` | Tâche `studio.worn` (toutes les 10 min, seulement dans la fenêtre de nuit) et rétention : brouillons de préparation et demandes de photo portée terminées (30 jours, objets du stockage effacés) |
| `apps/web/src/app/pages/Studio.tsx`, `pages/studio/*`, `spaces/pages/StudioWornPhotos.tsx`, `lib/studio/*` | Parcours à l'écran (tri, étiquette, mesures, génération), réduction des photos dans le navigateur (`reduce.ts`), page « Photos portées » |
| `scripts/studio-eval/` | Protocole de validation sur nos photos : `pnpm studio:eval` (section 6) |

## 2. Le parcours : préparer → trier → étiquette → mesures → générer

1. **Préparer.** Le vendeur ajoute jusqu'à 12 photos (face, dos, étiquette, défauts, mètre ruban). Le navigateur **réduit chaque photo** (côté long ≤ 1 024 px, JPEG qualité ≈ 80, ≤ 1 Mo, `apps/web/src/lib/studio/reduce.ts`) et relit le résultat avec la même vérification que le serveur. `POST /api/studio/prepare` reçoit les photos réduites (ou leurs clés de stockage, [STOCKAGE.md](STOCKAGE.md)) et, avant tout appel au modèle, **vérifie toutes les photos** dans leurs en-têtes : plus de 12 photos → 413 ; plus de 1,5 Mo → 413 ; plus de 1 600 px → 422 ; plus de 1 024 px ou 1 Mo sans réducteur côté serveur → 422 `photo_rejected` (`needs_reduction`) ; format illisible → 422. Rien n'est envoyé en pleine taille.
2. **Trier.** Le modèle 1 reçoit **6 photos au plus par appel** (12 photos → deux appels) et dit, pour chacune, son rôle (face, dos, étiquette, détail, défaut, mètre ruban, autre) et l'article auquel elle appartient. Le vendeur peut corriger le tri à l'écran (déplacer une photo, changer son rôle) ; un rôle qu'il indique prime sur celui du modèle. Chaque photo porte la **provenance de son rôle** (`roleSource` : `seller` quand le vendeur l'a indiqué, `model` sinon), posée par le serveur et jamais déduite de la confiance : l'écran dit « Rôle indiqué par vous » dans le premier cas seulement, « Tri du modèle · sûr à n % » sinon, même à 100 %. Au-delà de 6 photos, si chaque lot ne contient qu'un article, on suppose que c'est le même ; sinon les groupes restent séparés, et un avertissement demande toujours de vérifier le regroupement.
3. **Étiquette.** Pour chaque article, les photos d'étiquette (**2 au plus**) sont lues : marque, taille, matière, référence, **uniquement ce qui est écrit**, chacune avec la confiance du modèle et la mention `readFrom: "label"`. Une valeur sans cette mention, absente du texte transcrit, recopiée de l'exemple, ou lue avec une confiance sous 0,5 est **écartée** : le champ reste vide avec une question. **Sans aucune transcription** du texte de l'étiquette (`text` vide ou blanc, et pas de texte d'OCR), **rien n'est retenu** — une marque « reconnue » sans texte lu est une déduction depuis le logo ou le style — et l'OCR d'essai est tenté en second recours s'il est configuré ; une transcription trop longue est tronquée à 600 caractères, jamais ramenée à null (ce qui exempterait la lecture du contrôle). Seule exemption, documentée : avec une transcription, la matière n'est pas cherchée mot à mot (le modèle normalise « 100% COTTON » en « 100 % coton ») ; elle reste exigée lue sur l'étiquette, avec sa confiance. **Aucune déduction depuis le style.** Sans photo d'étiquette : marque, taille et matière restent à indiquer, jamais devinées.
4. **Mesures.** Les photos avec mètre ruban (**3 au plus**) sont lues pour la famille de la pièce (haut : poitrine, longueur, épaules, manche ; bas : tour de taille, hanches, entrejambe, montant ; chaussures : semelle…). Chaque mesure porte `evidence: "tape_photo"` ; sans ruban visible (`tapeVisible: false`), **aucune mesure** ; une mesure invraisemblable (bornes par grandeur) ou contradictoire est écartée. Sans photo de mètre : aucun appel, aucune mesure. Si la marque **et** la référence sont connues, la **base des références** (section 5) fournit les mesures manquantes (provenance `reference_db`), dans la taille lue seulement.
5. **Fusion et questions.** Par champ : lecture d'étiquette ou de ruban avec confiance ≥ 0,7, puis base par la référence (mesures seulement), puis indication du vendeur, puis lecture peu sûre (0,5 à 0,7) ; un désaccord entre deux sources à plus de 1 cm (ou deux marques différentes) donne une question au vendeur. Le résultat (`studioPrep`) est enregistré **une ligne par article** dans `studio_preps` : clés et rôles des photos, champs et mesures avec provenance, questions, avertissements, jamais les images. La préparation compte **une requête IA**, pas une annonce du quota Studio.
6. **Valider.** Le vendeur répond aux questions (`POST /api/studio/preps/:id/validate`) : chaque réponse devient une valeur de provenance `seller` ; « inconnue » laisse le champ vide. **Le silence ne vaut pas confirmation** : tant qu'une question `low_confidence` (lecture entre 0,5 et 0,7) ou `conflict` (deux sources en désaccord) reste sans réponse, la validation est **refusée** (409 `prep_unconfirmed`, champs listés dans `details.fields`) et rien n'est généré ; à l'écran, « Générer l'annonce » reste fermé, un bouton « Confirmer « valeur » » renvoie la valeur lue telle quelle (elle devient `seller`), ou le vendeur la corrige. S'il coche **« partager anonymement la mesure »** et que marque, référence et taille sont connues, seules ses mesures **sûres et sans question** rejoignent `size_references` : saisies par lui, ou lues sur le ruban avec une confiance ≥ 0,7 ; jamais une lecture « à confirmer », une mesure en conflit, ni une mesure reprise de la base ; sans aucune donnée personnelle ni d'organisation (section 5). Une marque ou une référence trop courte pour la base (une, puis deux lettres ou chiffres au moins) donne une raison (`shared.reason`) ; un refus de la base elle-même est encaissé dans un point de reprise (`savepoint`) : la validation est gardée et la raison rendue, jamais une erreur SQL.
7. **Générer.** `POST /api/studio/generate` avec `prepId` (préparation validée) rédige l'annonce avec mon IA perso et le modèle 1 : marque, taille et matière sont **imposées** par la préparation ; une marque ou une matière « vue » par le modèle sans étiquette lue est retirée du texte ; **toute mesure en cm absente de la préparation est retirée** (`stripUnknownMeasurements` : la mention dans le titre, la phrase entière dans la description, avertissement « Mesure inventée par le modèle retirée »), la consigne du rédacteur l'interdisant déjà (« n'écris aucune mesure en cm autre que celles fournies », « Matière inconnue : n'en cite aucune ») ; une phrase de mesures déterministe (« Mesures à plat : poitrine 52 cm… ») est ajoutée ; rien n'est relu. Une annonce = un `studio.listing` du quota. L'ancien chemin (photos seules, sans préparation) existe toujours et envoie lui aussi 6 photos au plus.

En démonstration, le simulateur ne voit pas les photos : il ne « lit » que ce que décrivent les photos d'exemple ; pour une photo du vendeur, l'étiquette est illisible et aucun ruban n'est visible, et l'écran le dit (`simulated: true`).

## 3. Les règles

### 3.1 Jamais de mesure inventée : la provenance

| Provenance | Valeur | Qui la donne |
|---|---|---|
| `label` | marque, taille, matière, référence | lue sur l'étiquette par le modèle 1 (avec sa confiance), ou relue avec le texte de l'OCR d'essai |
| `tape_photo` | mesure en cm | lue sur le mètre ruban photographié par le modèle 1 (avec sa confiance) |
| `reference_db` | mesure en cm | retrouvée dans `size_references` par la marque et la référence lues, dans la taille lue |
| `seller` | les deux | indiquée par le vendeur (indications avant la préparation, ou réponses à la validation) |
| _vide_ | — | aucune source : le champ reste `null` avec une **question au vendeur** (`missing`, `low_confidence`, `conflict`, `no_tape`, `rejected`) |

Le schéma l'impose (`studioTextField`, `namedMeasurementField` : « une valeur porte toujours sa provenance ; sans provenance, elle reste vide ») et la base vérifie les bornes (0,5 à 300 cm). La règle vaut pour la marque, la taille, la matière et la référence comme pour les mesures : **pas de déduction depuis le style**, le logo ou la coupe.

### 3.2 Quatre niveaux de contrôle

1. **Consignes** (`packages/ai/src/prompts.ts`) : interdictions écrites mot pour mot (« n'estime jamais une mesure à l'œil », « marque lue sur l'étiquette ou null »), exemple fictif que la validation reconnaît s'il est recopié, température 0,1, taille des photos rappelée, 6 / 2 / 3 photos par appel.
2. **Validation des sorties** (`policy/validate.ts`) : mesure rejetée si aucun ruban n'est visible ou sans `evidence` ; confiance sous 0,5 → valeur vide et question ; marque, taille ou référence sans `readFrom` ou absente du texte lu → écartée, et **sans aucune transcription rien n'est retenu** ; recopie de l'exemple, HTML, lien ou prix → écartés ; mesures hors bornes ou contradictoires → écartées. Un rôle de photo inconnu devient « autre », jamais un rôle inventé.
3. **Fusion** (`@selio/domain`, `mergeFields`) : priorités de la section 2, désaccord → question.
4. **Service** (`core`) : sans modèle de vision, **refus** (503) plutôt qu'une invention ; photos vérifiées avant tout appel ; une lecture d'étiquette ou de ruban indisponible laisse les champs vides avec un avertissement, elle ne fait pas échouer la préparation ; une validation laissant une lecture peu sûre ou un désaccord sans réponse est refusée (409) : le silence ne vaut pas confirmation.

### 3.3 4 à 6 photos réduites, jamais 12 en pleine taille

| Limite | Valeur | Où |
|---|---|---|
| Photos par envoi | 12 | `STUDIO_MAX_PHOTOS`, 413 au-delà |
| Photo reçue par l'API | ≤ 1,5 Mo, côté long ≤ 1 600 px | `studio.STUDIO_RECEIVED_MAX_*`, 413 / 422 |
| Photo envoyée au modèle | côté long ≤ **1 024 px**, ≤ **1 Mo**, JPEG qualité ≈ **80** (PNG et WebP acceptés) | `STUDIO_MODEL_MAX_SIDE_PX`, `STUDIO_MODEL_MAX_BYTES`, `STUDIO_MODEL_JPEG_QUALITY` ; réduction dans le navigateur, vérification serveur (`checkModelImage`) |
| Photos par appel au modèle | **6** pour le tri, **2** pour l'étiquette, **3** pour le mètre ruban | `STUDIO_MODEL_MAX_PHOTOS`, `STUDIO_LABEL_MAX_PHOTOS`, `STUDIO_TAPE_MAX_PHOTOS` |

Le serveur n'a pas de bibliothèque d'image : il lit les en-têtes et **refuse** (422 `photo_rejected`, raison `needs_reduction`, limites rappelées dans `details.limits` et par `GET /api/studio/limits`). Un réducteur côté serveur (`services.studio.reducer`) peut être branché plus tard ; sans lui, c'est au navigateur de réduire. Une photo qui serait encore refusée par `@selio/ai` (`input_rejected` : trop de photos, trop grande ou illisible) suit le même chemin — `photo_rejected` 413 / 422 par le cœur et l'API, ou 422 `ai_input_rejected` si elle échappait au cœur — jamais un 503 « indisponible ».

### 3.4 Quotas et compteurs

- Préparation : une requête IA (`ai_requests`, quota de mon IA perso), **aucune** annonce comptée.
- Génération : un `studio.listing` (20 par mois en Pro, 60 en Agence ; « non inclus » en Starter).
- Photos portées : un `studio.worn_photo` (10 en Pro, 30 en Agence), place rendue si la photo n'est pas produite.

## 4. L'OCR d'essai (facultatif)

Le compte rendu de réunion garde **GLM-OCR comme essai** pour les étiquettes difficiles (petits caractères, étiquettes froissées). Il est branché ainsi :

- `OLLAMA_OCR_MODEL` est **vide par défaut** (API et worker). Vide, rien ne change : les étiquettes sont lues par le modèle 1 seul, et `/api/ai/health` reste `healthy`.
- Défini (nom d'un modèle OCR installé dans Ollama), il n'est utilisé qu'en **second recours** : si, après la première lecture, la marque ou la taille reste vide ou peu sûre (confiance < 0,7), `AIService.readLabel` demande le texte brut de l'image de l'étiquette à l'OCR (`OllamaProvider.ocr()`, `POST /api/generate`, température 0, consigne seule, sans aucun indice), puis **donne ce texte au modèle 1 comme une donnée à relire** sur la photo. Le texte de l'OCR n'est jamais retenu tel quel : la relecture garde, champ par champ, la lecture validée la plus sûre, et toujours avec `readFrom: "label"`.
- Une panne de l'OCR garde la première lecture (avertissement). La santé liste le modèle OCR avec `optional: true` ; absent du serveur, il figure dans `details.optionalMissing` sans dégrader le statut. `pnpm ai:diagnose` affiche la ligne « OCR ».
- Le résultat dit si l'OCR a servi (`studioPrep.ocr = { configured, used }`, `LabelReadResult.ocr` : tenté, utilisé, texte).

À vérifier sur la machine de Marseille : le **nom exact** du modèle GLM-OCR dans Ollama et sa consigne (« Text Recognition: »), non vérifiés ici. Le protocole de la section 6 mesure l'apport de l'OCR en comparant deux rapports, avec et sans (`--no-ocr`).

## 5. La base des références de tailles

### 5.1 Ce qu'elle contient

`size_references` (migration 0014) : **marque, référence, taille** (null quand les mesures ne dépendent pas de la taille : sac, accessoire), **famille de la pièce** (`top`, `outerwear`, `dress`, `bottom`, `shoes`, `bag`, `accessory`, `other`), **mesures en cm** (`chest`, `length`, `shoulders`, `sleeve`, `waist`, `hips`, `inseam`, `rise`, `sole`) et **source** :

- `provided` : fournie par Selio (import de l'opérateur) ; une ligne fournie n'est jamais modifiée par un vendeur ;
- `seller_validated` : mesure validée par un vendeur qui a coché « partager anonymement la mesure » ; une contribution n'ajoute que les mesures manquantes, elle ne remplace rien.

**Aucune donnée personnelle ni d'organisation** : ni identifiant d'organisation, ni d'utilisateur, ni photo, ni titre d'annonce. La table est partagée entre toutes les organisations ; le rôle applicatif `selio_app` ne peut que la **lire**, l'écriture passe par deux fonctions `SECURITY DEFINER` (`app_size_reference_provide`, `app_size_reference_contribute`). Les clés sont normalisées (« Levi's » = « levis », « AB-123 » = « ab 123 ») et une ligne est unique par marque, référence et taille.

### 5.2 D'où viennent les mesures

Fiches techniques et guides de tailles des marques, nos propres articles mesurés (section 6), et les partages anonymes des vendeurs. **Jamais** des données d'annonces ou de profils Vinted (règle du plan : aucune donnée personnelle de vendeurs tiers dans nos bases).

### 5.3 Format d'import (opérateur)

`POST /api/admin/size-references` (opérateurs Selio seulement, `?dryRun=true` pour vérifier sans écrire) accepte un **CSV** (`Content-Type: text/csv`, ou `{ "csv": "…" }`, séparateur `,` `;` ou tabulation, en-tête obligatoire) ou un **JSON** (tableau d'objets, ou `{ "references": [...] }`), 5 000 lignes au plus par fichier.

| Colonne | Obligatoire | Contenu |
|---|---|---|
| `brand` (ou `marque`) | oui | marque telle qu'écrite sur l'étiquette |
| `reference` (ou `ref`) | oui | référence du modèle (2 lettres ou chiffres au moins, 80 caractères au plus) |
| `size` | oui, sauf sac et accessoire (laisser vide) | taille mesurée (40 caractères au plus) |
| `category` (ou `garmentKind`, `famille`) | non (défaut `other`) | `top`, `outerwear`, `dress`, `bottom`, `shoes`, `bag`, `accessory`, `other`, ou le libellé français (haut, veste, robe, bas, chaussures, sac, accessoire) |
| `chest`, `length`, `shoulders`, `sleeve`, `waist`, `hips`, `inseam`, `rise`, `sole` (suffixe `_cm` accepté) | au moins une | mesure en cm (« 52 », « 52,5 », « 52.5 cm »), dans les bornes plausibles de chaque grandeur |
| `measurements` | — | en JSON seulement : objet `{ "chest": 52, … }` à la place des colonnes |

```csv
brand;reference;size;category;chest;length;shoulders;sleeve
Levi's;04511-0001;W32 L32;bottom;;;;
Zara;4387/320;M;top;52;68;44;63
```

(Valeurs fictives.) Règles : **tout ou rien** (une ligne invalide refuse l'import, rien n'est écrit, le numéro de ligne est rendu) ; **toute colonne inconnue est refusée** ; **le fichier entier est refusé s'il contient une colonne personnelle** (pseudo, vendeur, email, nom, adresse, photo, lien, titre, identifiant…). L'import est journalisé dans l'audit (`admin.size_references_imported`, nombre de lignes et de marques, jamais le contenu). `GET /api/admin/size-references` liste la base (opérateur).

### 5.4 Limites

- Une mesure partagée est **premier arrivé, premier servi** : elle n'est pas recoupée entre plusieurs vendeurs. Elle est affichée « Base des références » et le vendeur la confirme à la validation. Un seuil de confirmation (≥ 2 vendeurs concordants) pourrait s'ajouter plus tard.
- La base réelle est vide au départ : elle se remplit par l'import de l'opérateur et les partages.

## 6. Protocole de validation sur nos photos et objectifs « à mesurer »

### 6.1 Les objectifs

| Objectif (§5.11) | Cible | Mesure | État |
|---|---|---|---|
| Marques et tailles justes (lecture de l'étiquette) | ≥ 95 % | 200 photos d'étiquettes de nos articles, vérité terrain relue à la main | **à mesurer** |
| Mesures justes à 1 cm près (lecture du mètre ruban) | 9 sur 10 | 50 articles photographiés avec un mètre ruban et mesurés à la main | **à mesurer** |

Tant qu'aucun rapport n'existe, **aucune précision n'est promise** : `STUDIO_ACCURACY_TO_MEASURE_LABEL` à l'écran, `accuracy.status = "to_measure"` dans `GET /api/studio/limits` et dans chaque préparation. Ces chiffres, une fois mesurés, décrivent le modèle **sur nos photos, dans nos conditions** ; ils ne deviennent pas une promesse aux clients.

### 6.2 Le jeu de photos (hors du dépôt)

Aucune photo n'entre dans le dépôt (`scripts/studio-eval/.gitignore` ignore images, CSV et rapports ; seul `exemple/` montre le format, et `scripts/studio-eval/README.md` résume la marche à suivre). Le jeu vit dans un dossier de la machine, par exemple `/srv/selio/studio-eval/` :

```
<dossier>/
  etiquettes/
    verite.csv            photo;brand;size;material;reference
    etiquette-001.jpg …   200 photos d'étiquettes, réduites (côté long ≤ 1 024 px, JPEG ≈ 80, ≤ 1 Mo)
  mesures/
    verite.csv            article;garmentKind;photos;chest;length;shoulders;sleeve;waist;hips;inseam;rise;sole
    a01-metre-1.jpg …     1 à 3 photos avec mètre ruban par article, séparées par « | » dans la colonne photos
```

- **Étiquettes** : une ligne par photo ; `brand`, `size`, `material`, `reference` tels qu'écrits sur l'étiquette (la comparaison ignore accents, casse, ponctuation et espaces : « Levi's » = « LEVIS », « W32 L32 » = « W32/L32 », mais « 38 » ≠ « 38 FR ») ; une cellule vide n'est pas évaluée.
- **Mesures** : une ligne par article ; `garmentKind` parmi `top`, `outerwear`, `dress`, `bottom`, `shoes`, `bag`, `accessory`, `other` (ou le libellé français) ; mesures vraies en cm (virgule ou point, « 52,5 cm » accepté), prises à plat comme l'écran l'explique (`MEASUREMENT_HOWTO`) ; une cellule vide n'est pas évaluée.
- Toute **colonne inconnue refuse le fichier** ; une photo introuvable, en double, ou plus de 3 photos par article, écarte la ligne (listée dans le rapport). Les photos ne sont **pas réduites par le script** : une photo au-delà de 1 024 px ou 1 Mo est écartée et comptée (réduire avant, par exemple avec l'écran Studio ou un outil libre).
- Prise de vue conseillée, pour mesurer le modèle dans les conditions des clients : étiquette à plat et nette, mètre ruban tendu le long de la mesure, chiffres lisibles, lumière du jour ; varier les marques, les tailles (lettres et chiffres, W/L), les matières et les étiquettes usées.

### 6.3 Lancer la mesure : `pnpm studio:eval`

Depuis la racine du dépôt installé (`pnpm install`, aucune dépendance de plus), sur la machine où tourne Ollama (lecture directe par le service IA du dépôt : aucune base, aucun quota, rien d'écrit en dehors du rapport) :

```bash
AI_PROVIDER=ollama OLLAMA_BASE_URL=http://10.0.0.5:11434 OLLAMA_VISION_MODEL=qwen3-vl:8b pnpm studio:eval /srv/selio/studio-eval
# avec l'OCR d'essai, puis sans, pour mesurer son apport :
AI_PROVIDER=ollama … OLLAMA_OCR_MODEL=<nom exact du modèle OCR> pnpm studio:eval /srv/selio/studio-eval
AI_PROVIDER=ollama … OLLAMA_OCR_MODEL=<nom exact du modèle OCR> pnpm studio:eval /srv/selio/studio-eval --no-ocr
```

Ou à travers l'**API locale** (toute la chaîne du serveur : vérification des photos, lots, fusion avec provenance), avec un compte de l'équipe sur une organisation de test — chaque lecture compte une requête IA et laisse un brouillon de préparation, purgé après 30 jours, et l'API limite à 10 préparations par minute (le script attend) :

```bash
STUDIO_EVAL_EMAIL=equipe@… STUDIO_EVAL_PASSWORD=… STUDIO_EVAL_API_URL=http://127.0.0.1:8787 pnpm studio:eval /srv/selio/studio-eval --mode api
```

Options : `--only etiquettes|mesures`, `--limit n` (essai rapide), `--out rapport.md`, `--json` (détail de chaque lecture), `--no-ocr`, `--allow-mock` (simulateur : le rapport dit alors en tête qu'il **ne mesure rien**, code de sortie 3). Codes de sortie : 0 rapport écrit, 1 erreur (arguments, jeu, serveur injoignable), 2 rien n'a pu être évalué, 3 simulateur. Le mot de passe de l'API ne passe que par la variable, jamais en argument ni dans le rapport.

### 6.4 Lire le rapport

Le rapport Markdown daté (`scripts/studio-eval/rapports/AAAA-MM-JJ-HHMM-studio-eval.md`, ignoré par Git) donne : les conditions (fournisseur, modèle 1, OCR, nombre de photos, durée) ; pour l'étiquette, par champ et pour « marques et tailles » réunies, les **attendues, justes, fausses, non lues**, le taux de justes sur attendues (vides comptées comme non justes) et sur lues ; pour les mesures, la même chose par grandeur, à ± 1 cm ; le verdict de chaque objectif (**atteint / non atteint**, avec la réserve d'échantillon si le jeu est plus petit que le protocole) ; la liste des **lectures fausses** (la seule vraie faute : une valeur fausse est une invention, une valeur vide avec une question est honnête) ; les photos écartées, les erreurs, les lignes de vérité ignorées ; la latence p50 / p95 par lecture. Il ne contient ni image, ni mot de passe, ni adresse email.

### 6.5 Mesures sur nos photos

| Date | Modèle 1 | OCR d'essai | Photos d'étiquettes | Marques et tailles justes (≥ 95 %) | Lectures fausses | Articles avec mètre | Mesures à 1 cm (≥ 90 %) | Mesures fausses | Rapport |
|---|---|---|---|---|---|---|---|---|---|
| à remplir | | | | | | | | | |

Une fois le tableau rempli, reporter le résultat dans [BUILD_STATUS.md](BUILD_STATUS.md) ; l'interface ne passera de « à mesurer » à un chiffre que sur décision, avec le rapport comme pièce.

## 7. Photos portées (décision en attente)

Une photo de l'article à plat deviendrait une photo « portée ». **Rien n'est choisi** : un modèle maison à licence commerciale (à faire tourner la nuit sur la carte graphique, licence et qualité à vérifier) ou un service payant (aucun service payant sans accord écrit d'Ibrahim). Ce qui existe, derrière un réglage fermé :

- **Interface** `WornPhotoProvider` (`generate({ orgId, jobId, photoKey, pose }) → { resultKey } | { refused }`, une panne = erreur levée) avec un fournisseur **« noop »** (défaut : refuse proprement « aucun fournisseur configuré : décision à prendre », quota rendu, rien facturé) et un **« mock »** de test (aucune image produite, **interdit en production**). `WORN_PHOTO_PROVIDER` choisit, `createWornPhotoProvider` refuse « mock » en production.
- **File de nuit** : `POST /api/studio/worn` met la demande en file pour le prochain créneau `WORN_NIGHT_WINDOW` (22 h – 6 h, `WORN_NIGHT_TIMEZONE=Europe/Paris`, heure d'été comprise) ; le worker (`studio.worn`, toutes les 10 min) ne traite **que dans la fenêtre**, 20 demandes par passage, une demande prise une seule fois ; hors fenêtre il clôt seulement les demandes interrompues. Le vendeur voit l'heure prévue et peut **annuler** une demande encore en file (`DELETE /api/studio/worn/:id`, supprimée, quota rendu).
- **Quotas** : `wornPhotosPerMonth` 10 (Pro) / 30 (Agence), compteur `studio.worn_photo` (page « Mon utilisation »), 402 au-delà.
- **Dépassement = proposition** : 0,25 € la photo (`WORN_OVERAGE_CENTS=25`, 5 € au plus), seulement si `WORN_OVERAGE_ENABLED=true` **et** si le client coche l'accord pour cette photo (`acceptOverage: true`, date enregistrée) **et** si l'abonnement est actif avec une carte. L'accord vaut pour le **prix affiché** : l'écran envoie `acceptedUnitCents` (le prix qu'il montrait) et le serveur répond 409 `overage_price_changed` s'il diffère de `WORN_OVERAGE_CENTS` (rien n'est enregistré, l'écran décoche et relit) ; le montant enregistré est celui accepté. Facturé **au renouvellement** comme ligne « Photos portées au-delà du quota : n × 0,25 € » de la facture Revolut (`extra_lines`), marqué facturé une seule fois ; une photo refusée ou en échec n'est jamais facturée. Prix définitif : décision d'Ibrahim.
- **Données** : seules des **clés de stockage** de l'organisation (`org/<org>/…`) pour la photo d'origine et le résultat, jamais une image ni une URL en base ; voir [SECURITY.md](SECURITY.md) pour les visages et la conservation. **Rien n'est gardé sans nécessité** : l'écran relit le quota avant d'envoyer la photo au stockage et l'efface (`DELETE /api/uploads/object`, `studio-photo` de l'organisation seulement) si la demande échoue après l'envoi ; le serveur efface la photo d'origine à l'annulation, au refus, à l'échec et à l'interruption (`StorageClient.deleteObject`, DELETE signé exécuté par l'API ou le worker, jamais rendu au navigateur) quand aucune autre demande ne l'utilise ; les demandes terminées sont purgées après **30 jours** avec leurs objets (photo d'origine, résultat), sauf un dépassement produit pas encore facturé.

## 8. Ce qui n'est pas fait

- **Précision non mesurée** : aucun rapport `pnpm studio:eval` n'a été produit (Ollama absent de la machine de développement). Les objectifs restent « à mesurer » partout.
- **OCR d'essai** : nom exact du modèle GLM-OCR dans Ollama et sa consigne à vérifier sur place ; apport à mesurer avec et sans `--no-ocr`.
- **Photos portées** : aucun fournisseur ; décision modèle maison / service payant, prix du dépassement et date de remise à zéro des quotas (partie 7). Un dépassement accepté par un client qui résilie avant le renouvellement n'est jamais facturé ; l'email d'échec de paiement ne mentionne pas le dépassement.
- **Réducteur côté serveur** : aucun (pas de bibliothèque d'image) ; une photo au-delà de 1 024 px ou de 1 Mo est refusée (422 `needs_reduction`) **sur tous les chemins**, générateur historique (sans préparation) compris : le serveur réduit ou refuse, jamais il n'envoie une photo plus grande au modèle. Seule une image dont les dimensions ne se lisent pas dans les en-têtes passe telle quelle sur ce chemin (≤ 1,5 Mo), par compatibilité. L'ancien client web réduisait à 1 100 px : la PWA se met à jour seule (`registerType: "autoUpdate"`, `skipWaiting`, `clientsClaim`), un client externe suivant l'ancien contrat doit réduire à 1 024 px.
- **Base des références** : vide au départ ; mesures partagées non recoupées entre vendeurs.
- **Journalisation des appels** : `AI_REQUEST_KINDS` (`packages/contracts/src/ai.ts`) ne connaît pas encore `photo_sort`, `label_read`, `measurements_read` ni `label_ocr` ; la préparation est journalisée comme une seule ligne `ai_requests` de sorte `listing_generation` (le compteur d'usage `ai.request` porte `kind: "studio_prep"`, le nombre d'appels et de photos). Ces sortes restent à ajouter pour distinguer les lectures dans les métriques.
- **Rôle « contributeur photos »** (ajoute des photos et lance le générateur, rien d'autre) : à finir avec les rôles d'équipe (§5.15).

## 9. Variables

Toutes dans [CLES-ET-CONFIGURATION.md](CLES-ET-CONFIGURATION.md) (sections 4 et 13) : `OLLAMA_VISION_MODEL` (modèle 1), `OLLAMA_OCR_MODEL` (vide par défaut), `WORN_PHOTO_PROVIDER` (`noop`), `WORN_NIGHT_WINDOW` (`22-6`), `WORN_NIGHT_TIMEZONE` (`Europe/Paris`), `WORN_OVERAGE_ENABLED` (`false`), `WORN_OVERAGE_CENTS` (`25`, proposition), `CRON_STUDIO_WORN` (`*/10 * * * *`, worker). Pour le protocole : `STUDIO_EVAL_API_URL`, `STUDIO_EVAL_EMAIL`, `STUDIO_EVAL_PASSWORD` (mode `api` seulement). Aucun secret propre à Studio.
