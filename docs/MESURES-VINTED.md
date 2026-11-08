# Mesurer les limites de Vinted sur un vrai compte

Selio applique trois limites de la messagerie de Vinted : le nombre de contre-offres par conversation, la durée d'une offre et le délai entre deux messages. **Personne ne les connaît avec certitude** : Vinted ne les publie pas. Tant qu'elles n'ont pas été mesurées, Selio applique des **valeurs prudentes** (3 contre-offres, 48 h, 60 s), affichées « À mesurer » et jamais présentées comme vérifiées ([NEGOCIATION.md](NEGOCIATION.md) §6).

Ce document dit **quoi mesurer, comment, combien de fois, où l'enregistrer et quand s'arrêter**. La mesure se fait **à la main**, par une personne de l'équipe. Aucun script, aucune extension, aucun Selio Cloud ne la fait à sa place.

## 1. Les règles, avant tout

- **Uniquement des comptes de l'équipe.** Deux comptes Vinted appartenant à Selio (un vendeur, un acheteur), ouverts normalement, avec leurs propres coordonnées. **Jamais le compte d'un client**, jamais un compte emprunté, jamais un compte créé pour l'occasion avec une fausse identité.
- **Une annonce de test sans valeur**, à un prix bas mais réaliste, retirée après les mesures. Aucune vente réelle n'est conclue ; si une offre est acceptée par erreur, on annule poliment avec le compte acheteur de l'équipe.
- **Aucun contournement.** Pas de VPN, de proxy ni d'adresse IP changée ; pas d'outil d'automatisation, de script de clics ni de second appareil pour accélérer ; aucun CAPTCHA résolu pour continuer ; aucune protection de Vinted désactivée ou trompée. On observe le site **tel qu'un vendeur normal le voit**.
- **Arrêt immédiat** au premier signe de Vinted (§5). On ne réessaie pas le même jour.
- **Rythme humain.** Les messages sont tapés et envoyés à la main, comme dans une vraie conversation.
- **Rien de personnel dans les captures** gardées : seulement les comptes de l'équipe. Une capture qui montre le pseudo ou la photo d'une autre personne est recadrée ou supprimée.

## 2. Quoi mesurer

| Limite | Question | Valeur saisie dans Selio | Bornes acceptées |
|---|---|---|---|
| Contre-offres par conversation | Combien de contre-offres le **vendeur** peut-il envoyer dans une même conversation avant que Vinted refuse, masque le bouton ou avertisse ? | Le plus petit nombre observé | 1 à 20 |
| Durée d'une offre | Combien de temps une offre envoyée reste-t-elle valable avant d'expirer ? | La plus courte durée observée, en heures, arrondie **vers le bas** | 1 à 168 h |
| Délai entre deux messages | En dessous de quel écart entre deux messages du vendeur Vinted ralentit-il, bloque-t-il l'envoi ou avertit-il ? | Un délai **au-dessus** du rythme où le premier signe est apparu (§4.3) | 0 à 3 600 s |

On note aussi, sans les saisir dans Selio : le texte exact des messages affichés par Vinted, l'appareil et le navigateur, la version de l'application si c'est sur téléphone, et tout comportement inattendu.

## 3. Avant de commencer

1. Les deux comptes de l'équipe sont connectés sur **deux navigateurs ou appareils différents**, chacun avec son propre réseau habituel (pas de changement d'adresse pendant la mesure).
2. L'annonce de test est en ligne depuis au moins un jour.
3. Une **fiche de mesure** est ouverte (modèle en §7), avec l'heure de début.
4. La personne qui mesure a relu le §5 (critères d'arrêt).

## 4. Comment mesurer

### 4.1 Contre-offres par conversation

1. Le compte acheteur fait une offre basse sur l'annonce de test.
2. Le compte vendeur contre-propose (bouton de contre-offre de Vinted), un peu au-dessus de l'offre.
3. L'acheteur refuse ou fait une nouvelle offre ; le vendeur contre-propose à nouveau, **au moins 2 minutes** après sa contre-offre précédente.
4. Répéter jusqu'à ce que Vinted refuse la contre-offre, masque le bouton ou affiche un message ; **ne jamais dépasser 10 contre-offres** dans une conversation.
5. Noter le nombre de contre-offres **acceptées par Vinted** (envoyées et visibles chez l'acheteur) et le texte exact du message de refus. Si 10 contre-offres passent sans refus, noter « 10 au moins, aucune limite atteinte ».

### 4.2 Durée d'une offre

1. L'acheteur fait une offre ; le vendeur ne répond pas.
2. Noter l'heure exacte d'envoi et, si Vinted l'affiche, l'heure d'expiration annoncée.
3. Regarder l'état de l'offre chez le vendeur et chez l'acheteur à H+12, H+24, H+36, H+48, puis toutes les 24 h jusqu'à 7 jours.
4. Noter le premier relevé où l'offre est expirée ; la durée retenue est l'intervalle **le plus court** compatible avec les relevés (par exemple, valide à H+24 et expirée à H+36 : saisir 24 h, pas 36 h).
5. Faire de même pour une contre-offre envoyée par le vendeur.

### 4.3 Délai entre deux messages

Ici, on **ralentit d'abord** et on accélère par paliers, jamais l'inverse :

1. Dans une conversation entre les deux comptes de l'équipe, le vendeur envoie un message, attend **120 s**, en envoie un second.
2. Si rien ne se passe, une autre fois (une autre conversation ou un autre jour), passer à **60 s**, puis **30 s**, puis **15 s**. Jamais en dessous de 15 s.
3. **Au plus 10 messages par session**, et au plus une session par jour et par compte.
4. Au premier signe (ralentissement, envoi bloqué, avertissement, CAPTCHA) : arrêt (§5). Le délai saisi est le palier **précédent** multiplié par 2 (exemple : signe à 30 s, palier précédent 60 s, saisir 120 s).
5. Si aucun signe n'apparaît, même à 15 s : **ne pas** saisir 15 s. Garder la valeur prudente (60 s) ou saisir le palier le plus lent où trois répétitions sont passées sans signe, et noter « aucune limite observée » dans la fiche : l'absence d'avertissement n'est pas une preuve.

## 5. Critères d'arrêt (immédiat, sans nouvel essai le même jour)

- Un **CAPTCHA**, une vérification « êtes-vous un humain », ou une demande de reconnexion.
- Un message de Vinted parlant d'activité inhabituelle, de spam, de trop de messages ou de trop de requêtes.
- Un envoi refusé, un bouton masqué, un message qui n'arrive pas chez l'acheteur.
- Une restriction, une suspension ou une alerte sur l'un des deux comptes.
- Un doute : on s'arrête, on note, on en parle à Ibrahim.

Après un arrêt : remplir la fiche, ne rien retenter pendant au moins 24 h, et ne reprendre que si le compte n'a aucune restriction. Si un compte est restreint, la mesure s'arrête pour de bon et Ibrahim décide de la suite. Les **valeurs prudentes restent appliquées** tant qu'aucune mesure complète n'est enregistrée.

## 6. Combien de fois, et quelle valeur retenir

- Chaque limite est mesurée **3 fois**, sur **2 jours différents** au moins, dans des conversations différentes.
- Si les résultats diffèrent, on retient **la valeur la plus prudente** : le plus petit nombre de contre-offres, la durée d'offre la plus courte, le délai entre messages le plus long.
- Si une limite n'a pas pu être mesurée (arrêt, résultat incohérent), on **ne l'invente pas** : on reporte la valeur prudente par défaut et on l'écrit dans la note de la mesure.
- **Refaire la mesure chaque trimestre** et après tout changement visible de l'interface de Vinted (nouveau bouton d'offre, nouvelle application, message d'information de Vinted). Une valeur mesurée reste une **observation datée** : Vinted peut changer sans prévenir.

## 7. Où enregistrer

1. **Fiche de mesure** (texte ou tableur), gardée **hors du dépôt Git**, avec les captures d'écran, dans le dossier partagé de l'équipe. Modèle :

   | Date et heure | Limite | Compte vendeur / acheteur (de l'équipe) | Appareil, navigateur | Essai n° | Ce qui a été fait | Ce que Vinted a affiché (texte exact) | Résultat | Arrêt ? |
   |---|---|---|---|---|---|---|---|---|

2. **Dans Selio**, une fois les trois limites mesurées (ou la valeur prudente reportée pour celles qui ne l'ont pas été) :
   - pour une organisation : Automatisation › Négociation automatique › étape « Limites de Vinted » › « Enregistrer une mesure » (propriétaire ou administrateur), case « J'ai fait cette mesure moi-même, à la main, sur un compte de l'équipe » cochée ;
   - pour **toute l'équipe** (mesure globale, lue par toutes les organisations qui n'ont pas leur propre mesure) : un **opérateur Selio** appelle `POST /api/negotiation/limits` avec `{ "scope": "global", "maxCounterOffersPerConversation": …, "offerDurationHours": …, "minDelayBetweenMessagesSeconds": …, "note": "…" }`. La note (500 caractères au plus) renvoie à la fiche : dates, nombre d'essais, limites non mesurées.
3. Selio fixe lui-même la **date** et la **source** (`measured`), garde chaque mesure dans l'historique `negotiation_limits` (jamais modifiée ni supprimée par l'application ; une nouvelle mesure s'ajoute) et l'écrit au journal d'audit (`negotiation.limits_measured`). L'écran affiche alors « Mesurées » avec la date.
4. Reporter le résultat et la date dans docs/BUILD_STATUS.md (ligne « Limites de Vinted »).

## 8. Ce que la mesure change dans Selio

| Limite mesurée | Effet |
|---|---|
| Contre-offres par conversation | Au-delà, la contre-offre automatique est **transmise au vendeur** au lieu d'être envoyée ; revérifié au moment d'envoyer, même pour une tâche validée à la main (les contre-offres en attente comptent) |
| Délai entre deux messages | Un message **automatique** plus rapproché **attend** le délai (remis en file à l'heure permise, serveur et Cloud) ; une tâche validée à la main part comme un envoi depuis Messages |
| Durée d'une offre | Affichée ; pas encore utilisée par les règles (NEGOCIATION.md §9) |

Ordre d'application : mesure de l'organisation, sinon mesure de l'équipe, sinon valeurs prudentes des réglages.

## 9. Ce qu'on ne fait jamais

- Mesurer avec le compte d'un client, ou demander à un client ses identifiants pour mesurer.
- Automatiser la mesure (script, extension, Selio Cloud, navigateur piloté).
- Insister après un avertissement, résoudre un CAPTCHA pour continuer, changer d'adresse IP ou d'appareil pour « repartir à zéro ».
- Présenter une valeur comme « la limite de Vinted » : c'est ce que **nous avons observé, à une date donnée**, sur nos comptes.
- Saisir une valeur moins prudente que l'observation la plus prudente.
