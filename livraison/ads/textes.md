# Selio — textes publicitaires

Réalisé par Ibrahim · 20 novembre 2026 · fichier généré par `source/textes.mjs` (les longueurs entre parenthèses sont comptées par le script ; ne pas modifier ce fichier à la main, modifier le script puis relancer `node textes.mjs`).

**Règles suivies partout** : aucune promesse de gain chiffrée, aucun témoignage ni avis, aucun nombre d'utilisateurs ; chiffres des visuels marqués « exemple » ; aucun logo ni couleur de Vinted (le mot « Vinted » n'apparaît qu'en texte, pour dire à quoi sert Selio) ; mention « Selio est indépendant de Vinted » ; l'utilisateur fixe ses règles et valide ; essai gratuit de 14 jours avec carte enregistrée, rien débité avant la fin (à dire sur la page d'arrivée). Tutoiement sur Meta et Instagram (comme les vidéos et les réseaux), vouvoiement sur Google (comme la vitrine).

Prix (indicatifs, `packages/demo-data/src/plans.ts`) : Starter 6,99 €, Pro 24,99 €, Agence 49,99 € par mois. Ils ne sont pas dans les annonces tant qu'ils ne sont pas définitifs.

## Sommaire

1. Meta et Instagram (4 concepts)
2. Google Ads — Search (5 campagnes par intention)
3. Google Ads — mots-clés négatifs communs et extensions
4. Google Ads — Performance Max
5. Liens et paramètres de suivi

## 1. Meta et Instagram

Limites vérifiées : texte court ≤ 125 caractères (visible sans « Voir plus »), titre ≤ 40, description ≤ 30. Lien : la page d'arrivée du concept, avec les paramètres `utm` (partie 5). Visuels : `visuels/meta/` (carré 1080 × 1080, portrait 1080 × 1350, story/reel 1080 × 1920, lien 1200 × 628). Vidéos : `../video/Selio-*.mp4` (9:16) pour les reels et stories.

### Concept A — « Toute ton activité Vinted au même endroit » (Selio Manager)

- **Page d'arrivée** : `https://seliovprod.netlify.app/logiciel-vinted?utm_source=meta&utm_medium=paid_social&utm_campaign=selio-manager&utm_content={{ad.name}}`
- **Accroche A** : Trois comptes, trois onglets, des offres qui attendent ?
- **Accroche B** (test A/B) : Ton stock est dans un tableur, tes offres dans l'appli, tes marges dans ta tête ?
- **Texte principal court** : Stock, messages, offres, commandes et marges de tous tes comptes Vinted, dans un seul tableau. Essai gratuit 14 jours. *(118)*
- **Titre** : Tous tes comptes, un seul tableau *(33)*
- **Description** : Essai gratuit 14 jours *(22)*
- **Bouton (CTA Meta)** : S'inscrire
- **Visuels** : `visuels/meta/selio-A-manager-meta-*.jpg`

**Texte principal long** :

Trois comptes, trois onglets, des offres qui attendent ?

Selio Manager rassemble toute ton activité de revente au même endroit :

• ton stock et ton dressing, avec les annonces à republier  
• la messagerie et la négociation par IA, selon tes prix planchers  
• les relances des favoris et l'après-vente  
• les commandes et la marge de chaque article  
• jusqu'à 10 comptes connectés, et ton équipe avec des rôles (offre Agence)

Tu fixes les règles, tu gardes la main : un bouton arrête toutes les automatisations.

Essai gratuit de 14 jours, rien n'est débité avant la fin. Selio est un outil indépendant, non affilié à Vinted.

**Légende Instagram** (publication ou publicité) :

Trois comptes, trois onglets et des offres qui attendent ? 😮‍💨  
  
Selio Manager rassemble ton stock, tes messages, tes offres, tes commandes et tes marges, sur tous tes comptes. Tu fixes les règles, tu gardes la main.  
  
Essai gratuit 14 jours : lien en bio.  
Selio est indépendant de Vinted.

#revendeur #achatrevente #secondemain #friperie #vintage #modecirculaire #entrepreneur #vinted

### Concept B — « Tes photos deviennent une annonce » (Selio Studio)

- **Page d'arrivée** : `https://seliovprod.netlify.app/annonce-vinted-ia?utm_source=meta&utm_medium=paid_social&utm_campaign=selio-studio&utm_content={{ad.name}}`
- **Accroche A** : Tu prends les photos. Selio écrit l'annonce.
- **Accroche B** (test A/B) : Encore 20 annonces à rédiger ce soir ?
- **Texte principal court** : Ajoute tes photos : Selio Studio lit l'étiquette et rédige titre, description et prix conseillé. Tu relis, tu publies. *(118)*
- **Titre** : Tes photos deviennent une annonce *(33)*
- **Description** : Titre, description et prix *(26)*
- **Bouton (CTA Meta)** : Essayer
- **Visuels** : `visuels/meta/selio-B-studio-meta-*.jpg`

**Texte principal long** :

Tu prends les photos. Selio écrit l'annonce.

Exemple avec un jean : Selio Studio lit l'étiquette (marque, taille, matière), relève le tour de taille sur la photo du mètre ruban, puis rédige :

« Jean Levi's 501 Original droit bleu W32 L32 — 100 % coton »  
+ une description complète (coupe, matière, entretien, état, mesures, conseils de taille)  
+ un prix conseillé.

Ce qui n'est pas lu sur les photos n'est pas inventé : une mesure ou une matière inconnue est retirée, et une lecture douteuse te pose une question.

Tu relis, tu modifies si besoin, tu publies. Essai gratuit 14 jours. Selio est indépendant de Vinted.

**Légende Instagram** (publication ou publicité) :

Tu prends les photos. Selio écrit l'annonce. 📸➡️📝  
  
Selio Studio lit l'étiquette, relève les mesures sur la photo du mètre ruban et rédige le titre, la description et le prix conseillé. Rien n'est inventé : tu relis, tu publies.  
  
Essai gratuit 14 jours : lien en bio.  
Exemple réalisé avec des photos de démonstration. Selio est indépendant de Vinted.

#revendeur #annonce #achatrevente #secondemain #friperie #denim #vintage #vinted

### Concept C — « Trouve les bonnes affaires avant les autres » (Selio Bot)

- **Page d'arrivée** : `https://seliovprod.netlify.app/bot-achat-vinted?utm_source=meta&utm_medium=paid_social&utm_campaign=selio-bot&utm_content={{ad.name}}`
- **Accroche A** : La bonne affaire est partie en 3 minutes. Encore.
- **Accroche B** (test A/B) : Tu rafraîchis la recherche toutes les 5 minutes ?
- **Texte principal court** : Selio Bot surveille tes recherches, note chaque affaire sur 100 et t'alerte. Tu valides l'achat en 1 clic, dans tes limites. *(124)*
- **Titre** : Les bonnes affaires, notées sur 100 *(35)*
- **Description** : Alerte et achat en 1 clic *(25)*
- **Bouton (CTA Meta)** : S'inscrire
- **Visuels** : `visuels/meta/selio-C-bot-meta-*.jpg`

**Texte principal long** :

La bonne affaire est partie en 3 minutes. Encore.

Selio Bot surveille tes recherches à ta place :

• chaque nouvelle annonce reçoit une note sur 100  
• le prix de revente et la marge sont estimés avant l'achat  
• une alerte arrive dès qu'une affaire dépasse ton seuil  
• tu valides l'achat en 1 clic, avec un budget par jour et un maximum par achat

Les estimations aident à décider, elles ne garantissent pas une revente.

Essai gratuit de 14 jours. Selio est un outil indépendant, non affilié à Vinted.

**Légende Instagram** (publication ou publicité) :

La bonne affaire est partie en 3 minutes. Encore. ⏱️  
  
Selio Bot surveille tes recherches, note chaque nouvelle annonce sur 100 et t'alerte. Tu valides l'achat en 1 clic, avec tes limites de dépenses.  
  
Essai gratuit 14 jours : lien en bio.  
Chiffres de démonstration à l'écran. Selio est indépendant de Vinted.

#revendeur #achatrevente #bonplan #friperie #secondemain #vintage #resell #vinted

### Concept D — « Sache quoi acheter » (Selio Track)

- **Page d'arrivée** : `https://seliovprod.netlify.app/prix-revente-vinted?utm_source=meta&utm_medium=paid_social&utm_campaign=selio-track&utm_content={{ad.name}}`
- **Accroche A** : Acheté 8 €. Ça se revend combien ?
- **Accroche B** (test A/B) : Avant d'acheter, regarde le marché.
- **Texte principal court** : Niches notées sur 100, prix de revente médian, fourchette et recherche par photo : Selio Track t'aide à savoir quoi acheter. *(124)*
- **Titre** : Sache quoi acheter avant d'acheter *(34)*
- **Description** : Prix de revente et niches *(25)*
- **Bouton (CTA Meta)** : En savoir plus
- **Visuels** : `visuels/meta/selio-D-track-meta-*.jpg`

**Texte principal long** :

Acheté 8 €. Ça se revend combien ?

Selio Track analyse le marché pour toi :

• chaque niche notée sur 100 (demande, vitesse de vente, concurrence, marge)  
• le prix de revente médian et la fourchette habituelle  
• les annonces disparues, signe de ventes  
• la recherche par photo, en friperie comme en vide-grenier

Track analyse et identifie ; il n'achète rien à ta place.

Essai gratuit de 14 jours. Selio est un outil indépendant, non affilié à Vinted.

**Légende Instagram** (publication ou publicité) :

Acheté 8 €. Ça se revend combien ? 🤔  
  
Selio Track note chaque niche sur 100, donne le prix de revente médian et la fourchette habituelle, et estime un article à partir d'une simple photo.  
  
Essai gratuit 14 jours : lien en bio.  
Chiffres d'exemple dans le visuel. Selio est indépendant de Vinted.

#revendeur #achatrevente #friperie #videgrenier #secondemain #vintage #resell #vinted

## 2. Google Ads — Search

Annonces responsives sur le Réseau de Recherche : 15 titres (≤ 30 caractères), 4 descriptions (≤ 90), deux chemins d'URL (≤ 15). Toutes les longueurs sont vérifiées par `node textes.mjs`. « Vinted » figure dans 4 titres au plus par annonce : si l'usage de la marque est refusé, les autres titres suffisent. Ne pas épingler de titre (laisser Google combiner), sauf exigence de l'avis juridique. Import possible dans Google Ads Editor : `google-ads-editeur.csv`.

### Search · Gestion multi-comptes

- **Groupe d'annonces** : Logiciel et multi-comptes
- **URL finale** : `https://seliovprod.netlify.app/logiciel-vinted`
- **Suffixe de l'URL finale** : `utm_source=google&utm_medium=cpc&utm_campaign={_campagne}&utm_content={creative}`, avec `{_campagne}` = `search-logiciel-vinted`
- **URL affichée** : seliovprod.netlify.app/logiciel/multi-comptes

**Titres**

1. Logiciel pour vendeurs Vinted *(29)*
2. Gérez plusieurs comptes Vinted *(30)*
3. Tous vos comptes, un tableau *(28)*
4. Stock, messages et commandes *(28)*
5. La marge de chaque article *(26)*
6. Jusqu'à 10 comptes connectés *(28)*
7. Essai gratuit de 14 jours *(25)*
8. Négociation selon vos règles *(28)*
9. Relances des favoris *(20)*
10. Pensé pour l'achat-revente *(26)*
11. Rôles et accès pour l'équipe *(28)*
12. Selio Manager *(13)*
13. Vous gardez la main *(19)*
14. Dressing et remise en ligne *(27)*
15. Résiliable à tout moment *(24)*

**Descriptions**

1. Stock, dressing, messages, commandes et marges de tous vos comptes dans un seul outil. *(86)*
2. Négociation par IA et relances selon vos règles : prix plancher et paliers. Vous validez. *(89)*
3. De 1 à 10 comptes selon l'offre, en équipe avec des rôles. Au mois, sans engagement. *(84)*
4. Essai gratuit 14 jours, rien n'est débité avant la fin. Selio est indépendant de Vinted. *(88)*

**Mots-clés exacts** : `[logiciel vinted]`, `[outil vinted]`, `[gestion compte vinted]`, `[gérer plusieurs comptes vinted]`, `[multi compte vinted]`, `[application pour vendeur vinted]`, `[gestion stock vinted]`, `[logiciel achat revente]`

**Mots-clés en expression** : `"logiciel vinted"`, `"outil vendeur vinted"`, `"plusieurs comptes vinted"`, `"gestion stock vinted"`, `"logiciel achat revente"`, `"outil revendeur vêtements"`

**Mots-clés négatifs de la campagne** : `acheteur`, `comment acheter`, `particulier gratuit`, `excel gratuit`

### Search · Annonce Vinted IA

- **Groupe d'annonces** : Annonces par l'IA
- **URL finale** : `https://seliovprod.netlify.app/annonce-vinted-ia`
- **Suffixe de l'URL finale** : `utm_source=google&utm_medium=cpc&utm_campaign={_campagne}&utm_content={creative}`, avec `{_campagne}` = `search-annonce-vinted-ia`
- **URL affichée** : seliovprod.netlify.app/annonce/ia

**Titres**

1. Vos annonces Vinted par l'IA *(28)*
2. Générateur d'annonces Vinted *(28)*
3. De la photo à l'annonce *(23)*
4. Titre, description et prix *(26)*
5. L'étiquette lue sur la photo *(28)*
6. Marque, taille, matière lues *(28)*
7. Mesures relevées au ruban *(25)*
8. Un prix conseillé par article *(29)*
9. Aucune mesure inventée *(22)*
10. Vous relisez, vous publiez *(26)*
11. Selio Studio *(12)*
12. Essai gratuit de 14 jours *(25)*
13. Description claire et complète *(30)*
14. Titres optimisés pour Vinted *(28)*
15. Moins de saisie à la main *(25)*

**Descriptions**

1. Ajoutez vos photos : Selio Studio lit l'étiquette et rédige titre, description et prix. *(87)*
2. Marque, taille et matière lues sur l'étiquette ; aucune mesure inventée. Vous validez. *(86)*
3. En brouillon ou publiée : vous relisez chaque annonce avant sa mise en ligne. *(77)*
4. Essai gratuit 14 jours, rien n'est débité avant la fin. Selio est indépendant de Vinted. *(88)*

**Mots-clés exacts** : `[annonce vinted ia]`, `[générateur annonce vinted]`, `[description vinted ia]`, `[titre annonce vinted]`, `[rédiger annonce vinted]`, `[ia vinted]`, `[créer annonce vinted]`, `[description vinted]`

**Mots-clés en expression** : `"annonce vinted ia"`, `"générateur annonce vinted"`, `"description vinted"`, `"titre annonce vinted"`, `"rédiger annonce vinted"`, `"ia pour vinted"`

**Mots-clés négatifs de la campagne** : `photo de profil`, `logo`, `image libre de droits`, `annonce immobilière`, `leboncoin`

### Search · Prix de revente Vinted

- **Groupe d'annonces** : Prix de revente et marché
- **URL finale** : `https://seliovprod.netlify.app/prix-revente-vinted`
- **Suffixe de l'URL finale** : `utm_source=google&utm_medium=cpc&utm_campaign={_campagne}&utm_content={creative}`, avec `{_campagne}` = `search-prix-revente-vinted`
- **URL affichée** : seliovprod.netlify.app/prix/revente

**Titres**

1. Prix de revente sur Vinted *(26)*
2. Sachez quoi acheter *(19)*
3. Niches notées sur 100 *(21)*
4. Prix médian et fourchette *(25)*
5. Recherche par photo *(19)*
6. Estimez avant d'acheter *(23)*
7. Analyse du marché Vinted *(24)*
8. Annonces disparues suivies *(26)*
9. Demande, concurrence, marge *(27)*
10. Selio Track *(11)*
11. Essai gratuit de 14 jours *(25)*
12. À quel prix le revendre ? *(25)*
13. Repérez les niches porteuses *(28)*
14. Des chiffres pour décider *(25)*
15. Pour l'achat-revente *(20)*

**Descriptions**

1. Selio Track estime le prix de revente : prix médian, fourchette et ventes comparables. *(86)*
2. Chaque niche reçoit une note sur 100 : demande, vitesse de vente, concurrence et marge. *(87)*
3. Une photo suffit pour estimer un article avant de l'acheter, en friperie ou en brocante. *(88)*
4. Essai gratuit 14 jours, rien n'est débité avant la fin. Selio est indépendant de Vinted. *(88)*

**Mots-clés exacts** : `[prix revente vinted]`, `[estimer prix vinted]`, `[combien vendre sur vinted]`, `[quel prix mettre vinted]`, `[analyse marché vinted]`, `[quoi acheter pour revendre]`, `[niche vinted]`, `[article qui se vend bien vinted]`

**Mots-clés en expression** : `"prix revente vinted"`, `"estimation prix vinted"`, `"quoi revendre sur vinted"`, `"achat revente vinted"`, `"prix vêtement occasion"`

**Mots-clés négatifs de la campagne** : `voiture`, `immobilier`, `appartement`, `maison`, `or`, `argus`, `téléphone`

### Search · Bot achat Vinted

- **Groupe d'annonces** : Recherche et achat
- **URL finale** : `https://seliovprod.netlify.app/bot-achat-vinted`
- **Suffixe de l'URL finale** : `utm_source=google&utm_medium=cpc&utm_campaign={_campagne}&utm_content={creative}`, avec `{_campagne}` = `search-bot-achat-vinted`
- **URL affichée** : seliovprod.netlify.app/bot/achat

**Titres**

1. Bot d'achat pour Vinted *(23)*
2. Bonnes affaires notées sur 100 *(30)*
3. Alertes dès la publication *(26)*
4. Achat rapide validé en 1 clic *(29)*
5. Limites de dépenses par jour *(28)*
6. Revente et marge estimées *(25)*
7. Vos recherches surveillées *(26)*
8. Selio Bot *(9)*
9. Essai gratuit de 14 jours *(25)*
10. Trouvez les bonnes affaires *(27)*
11. Repérez les affaires tôt *(24)*
12. Vous validez chaque achat *(25)*
13. Historique des achats *(21)*
14. Pour les pros de la revente *(27)*
15. Score d'intérêt sur 100 *(23)*

**Descriptions**

1. Selio Bot surveille vos recherches, note chaque affaire sur 100 et vous alerte aussitôt. *(88)*
2. Revente et marge estimées avant l'achat. Des estimations pour décider, sans garantie. *(85)*
3. Achat rapide validé par vous en 1 clic, avec un budget par jour et un maximum par achat. *(88)*
4. Essai gratuit 14 jours, rien n'est débité avant la fin. Selio est indépendant de Vinted. *(88)*

**Mots-clés exacts** : `[bot vinted]`, `[bot achat vinted]`, `[alerte vinted]`, `[alerte nouvelle annonce vinted]`, `[bonnes affaires vinted]`, `[notification nouvelle annonce vinted]`, `[vinted sniper]`

**Mots-clés en expression** : `"bot vinted"`, `"alerte vinted"`, `"bonnes affaires vinted"`, `"achat revente vinted"`, `"acheter pour revendre"`

**Mots-clés négatifs de la campagne** : `github`, `python`, `code source`, `script`, `tuto`, `discord gratuit`

### Search · Négociation automatique

- **Groupe d'annonces** : Négociation et relances
- **URL finale** : `https://seliovprod.netlify.app/negociation-automatique-vinted`
- **Suffixe de l'URL finale** : `utm_source=google&utm_medium=cpc&utm_campaign={_campagne}&utm_content={creative}`, avec `{_campagne}` = `search-negociation-automatique-vinted`
- **URL affichée** : seliovprod.netlify.app/negociation/auto

**Titres**

1. Négociation auto sur Vinted *(27)*
2. Contre-offres automatiques *(26)*
3. Prix plancher respecté *(22)*
4. Relance des favoris après 24 h *(30)*
5. Messages aux favoris *(20)*
6. Réponses par IA, vos règles *(27)*
7. Vous gardez la main *(19)*
8. Tout s'arrête en un clic *(24)*
9. Selio Manager *(13)*
10. Essai gratuit de 14 jours *(25)*
11. Négociation par IA *(18)*
12. Paliers de remise réglables *(27)*
13. Moins de messages à gérer *(25)*
14. Plus d'offre oubliée *(20)*
15. Après-vente et réponses *(23)*

**Descriptions**

1. Selio prépare vos contre-offres selon votre prix plancher et vos paliers de remise. *(83)*
2. Relances après 24 h et messages aux favoris selon vos règles. Un bouton arrête tout. *(84)*
3. Fonctionne avec l'extension Selio, navigateur ouvert. Vous gardez la main à tout moment. *(88)*
4. Essai gratuit 14 jours, rien n'est débité avant la fin. Selio est indépendant de Vinted. *(88)*

**Mots-clés exacts** : `[négociation automatique vinted]`, `[répondre offre vinted]`, `[contre offre vinted]`, `[relance favoris vinted]`, `[message favoris vinted]`, `[automatiser vinted]`, `[vinted automatique]`

**Mots-clés en expression** : `"négociation vinted"`, `"offre vinted"`, `"favoris vinted"`, `"automatiser vinted"`, `"réponse automatique vinted"`

**Mots-clés négatifs de la campagne** : `faire une offre`, `annuler une offre`, `offre acheteur`, `payer`, `code promo vinted`

## 3. Google Ads — mots-clés négatifs communs et extensions

**Liste partagée de mots-clés négatifs** (à associer aux cinq campagnes ; les crochets = correspondance exacte, les guillemets = expression, sinon requête large) :

`[vinted]`, `[vinted.fr]`, `[application vinted]`, `[télécharger vinted]`, `"vinted pro"`, `"vinted go"`, `connexion`, `se connecter`, `login`, `mot de passe`, `service client`, `contact`, `numéro`, `remboursement`, `litige`, `colis`, `suivi`, `point relais`, `mondial relay`, `supprimer compte`, `emploi`, `recrutement`, `stage`, `salaire`, `apk`, `crack`, `gratuit illimité`, `arnaque`

**Liens annexes** (texte ≤ 25, lignes ≤ 35)

| Texte | Ligne 1 | Ligne 2 | URL |
| --- | --- | --- | --- |
| Selio Manager *(13)* | Stock, messages et commandes *(28)* | Jusqu'à 10 comptes connectés *(28)* | `/logiciel-vinted` |
| Selio Studio *(12)* | Annonces rédigées par l'IA *(26)* | À partir de vos photos *(22)* | `/annonce-vinted-ia` |
| Selio Track *(11)* | Analyse du marché *(17)* | Niches notées sur 100 *(21)* | `/prix-revente-vinted` |
| Selio Bot *(9)* | Bonnes affaires notées *(22)* | Achat validé par vous *(21)* | `/bot-achat-vinted` |
| Négociation automatique *(23)* | Contre-offres et relances *(25)* | Selon vos règles *(16)* | `/negociation-automatique-vinted` |
| Tarifs *(6)* | Starter, Pro et Agence *(22)* | Au mois ou à l'année *(20)* | `/tarifs` |

**Accroches** (≤ 25) : Essai gratuit 14 jours *(22)* · Rien débité avant la fin *(24)* · Résiliable à tout moment *(24)* · Jusqu'à 10 comptes *(18)* · Vous gardez la main *(19)* · 2 mois offerts à l'année *(24)* · Rôles pour l'équipe *(19)* · Sans engagement *(15)*

**Extraits de site** (valeurs ≤ 25)

- **Services** : Gestion multi-comptes *(21)*, Annonces par l'IA *(17)*, Analyse du marché *(17)*, Recherche d'articles *(20)*, Configuration *(13)*, Accompagnement 30 jours *(23)*
- **Types** : Starter *(7)*, Pro *(3)*, Agence *(6)*

## 4. Google Ads — Performance Max

Une campagne « PMax · Selio », quatre groupes d'éléments (un par concept), chacun avec sa page d'arrivée. Nom de l'entreprise : **Selio**. Signaux d'audience : les mots-clés des campagnes Search (segment personnalisé « recherches »), les visiteurs du site, et la liste des inscrits en exclusion.

**Éléments communs**

- **Logos** : `visuels/logos/selio-logo-carre-fond-blanc-1200x1200.png` (carré), `visuels/logos/selio-logo-paysage-fond-blanc-1200x300.png` (paysage 4:1) ; variantes sur fond sombre à côté.
- **Images** (sans texte ajouté, comme le recommande Google) : `visuels/google-display/selio-<concept>-display-paysage-1200x628.jpg` (1,91:1), `…-carre-1200x1200.jpg` (1:1), `…-portrait-960x1200.jpg` (4:5).
- **Vidéos** (à mettre sur la chaîne YouTube de Selio, en « non répertoriée » si besoin) : verticales `../video/Selio-Studio-27s.mp4`, `Selio-Bot-29s.mp4` (négociation et relances, fonctions de Selio Manager), `Selio-Track-24s.mp4`, `Selio-video-35s.mp4` ; horizontales 16:9 `videos/Selio-*-16x9.mp4` ; démonstration longue `../video/Selio-demo-complete.mp4` (10 min, pour YouTube seulement).

### Groupe A · Manager

- **URL finale** : `https://seliovprod.netlify.app/logiciel-vinted`
- **Images** : `visuels/google-display/selio-A-manager-display-*.jpg`

**Titres** : Logiciel pour vendeurs Vinted *(29)* · Tous vos comptes, un tableau *(28)* · Stock, messages et commandes *(28)* · La marge de chaque article *(26)* · Essai gratuit de 14 jours *(25)* · Vous gardez la main *(19)* · Jusqu'à 10 comptes connectés *(28)* · Négociation selon vos règles *(28)*

**Titres longs**

- Toute votre activité Vinted au même endroit : stock, messages, offres et marges *(79)*
- Gérez jusqu'à 10 comptes et votre équipe dans un seul outil. Essai gratuit 14 jours *(83)*

**Descriptions**

- Tous vos comptes dans un seul tableau. *(38)*
- Stock, dressing, messages, commandes et marges de tous vos comptes dans un seul outil. *(86)*
- Négociation par IA et relances selon vos règles. Un bouton arrête tout. *(71)*
- Essai gratuit 14 jours, rien n'est débité avant la fin. Selio est indépendant de Vinted. *(88)*

### Groupe B · Studio

- **URL finale** : `https://seliovprod.netlify.app/annonce-vinted-ia`
- **Images** : `visuels/google-display/selio-B-studio-display-*.jpg`

**Titres** : Vos annonces Vinted par l'IA *(28)* · De la photo à l'annonce *(23)* · Titre, description et prix *(26)* · L'étiquette lue sur la photo *(28)* · Aucune mesure inventée *(22)* · Vous relisez, vous publiez *(26)* · Essai gratuit de 14 jours *(25)* · Selio Studio *(12)*

**Titres longs**

- Vos photos deviennent une annonce : titre, description et prix conseillé rédigés pour vous *(90)*
- Marque, taille et matière lues sur l'étiquette. Vous relisez, vous publiez *(74)*

**Descriptions**

- Des photos à l'annonce prête à relire. *(38)*
- Ajoutez vos photos : Selio Studio lit l'étiquette et rédige titre, description et prix. *(87)*
- Ce qui n'est pas lu sur les photos n'est pas inventé. Vous validez chaque annonce. *(82)*
- Essai gratuit 14 jours, rien n'est débité avant la fin. Selio est indépendant de Vinted. *(88)*

### Groupe C · Bot

- **URL finale** : `https://seliovprod.netlify.app/bot-achat-vinted`
- **Images** : `visuels/google-display/selio-C-bot-display-*.jpg`

**Titres** : Bonnes affaires notées sur 100 *(30)* · Alertes dès la publication *(26)* · Achat rapide validé en 1 clic *(29)* · Limites de dépenses par jour *(28)* · Vous validez chaque achat *(25)* · Essai gratuit de 14 jours *(25)* · Selio Bot *(9)* · Trouvez les bonnes affaires *(27)*

**Titres longs**

- Trouvez les bonnes affaires avant les autres : chaque annonce notée sur 100 *(75)*
- Alertes, revente estimée et achat rapide validé par vous, dans vos limites de dépenses *(86)*

**Descriptions**

- Chaque affaire notée sur 100, une alerte. *(41)*
- Selio Bot surveille vos recherches, note chaque affaire sur 100 et vous alerte aussitôt. *(88)*
- Achat rapide validé par vous en 1 clic, avec un budget par jour et un maximum par achat. *(88)*
- Essai gratuit 14 jours, rien n'est débité avant la fin. Selio est indépendant de Vinted. *(88)*

### Groupe D · Track

- **URL finale** : `https://seliovprod.netlify.app/prix-revente-vinted`
- **Images** : `visuels/google-display/selio-D-track-display-*.jpg`

**Titres** : Sachez quoi acheter *(19)* · Prix de revente sur Vinted *(26)* · Niches notées sur 100 *(21)* · Prix médian et fourchette *(25)* · Recherche par photo *(19)* · Estimez avant d'acheter *(23)* · Essai gratuit de 14 jours *(25)* · Selio Track *(11)*

**Titres longs**

- Sachez quoi acheter : niches notées sur 100, prix de revente et recherche par photo *(83)*
- Estimez le prix de revente d'un article avant de l'acheter. Essai gratuit 14 jours *(82)*

**Descriptions**

- Le marché analysé avant d'acheter. *(34)*
- Selio Track estime le prix de revente : prix médian, fourchette et ventes comparables. *(86)*
- Chaque niche reçoit une note sur 100 : demande, vitesse de vente, concurrence et marge. *(87)*
- Essai gratuit 14 jours, rien n'est débité avant la fin. Selio est indépendant de Vinted. *(88)*

## 5. Liens et paramètres de suivi

- Meta : `?utm_source=meta&utm_medium=paid_social&utm_campaign=selio-<concept>&utm_content={{ad.name}}` (paramètres d'URL de l'annonce).
- Google : suffixe d'URL finale au niveau du compte `utm_source=google&utm_medium=cpc&utm_campaign={_campagne}&utm_content={creative}` + suivi automatique (gclid) activé.
- Code promo : `/inscription?code=XXX` seulement avec un code créé au préalable dans Selio Admin › Offres. Pour la publicité payante, le suivi passe par les `utm`, pas par un code.
- Pages d'arrivée prévues : `/logiciel-vinted`, `/annonce-vinted-ia`, `/prix-revente-vinted`, `/bot-achat-vinted`, `/negociation-automatique-vinted` (à vérifier en ligne avant lancement).
