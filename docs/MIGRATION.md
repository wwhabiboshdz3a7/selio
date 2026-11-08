# Migration depuis Bleam, Clemz ou un autre outil

Un vendeur qui arrive d'un autre outil de gestion Vinted (Bleam, Clemz, V-Tools…) ne doit pas tout régler à nouveau. Selio lui propose de **reprendre ses réglages** à partir de ce qu'il **nous donne lui-même** : mon IA perso propose une correspondance « ancien → nouveau », le vendeur la valide champ par champ (§5.13 du plan). Ce document décrit ce que fait le code au 7 novembre 2026.

Selio est indépendant de Vinted comme de ces outils : ni affilié, ni approuvé, ni sponsorisé. Les noms Bleam, Clemz et V-Tools ne servent qu'à dire d'où vient le vendeur.

## 1. Ce qui est accepté

| Entrée | Comment | Lu par | Gardé |
|---|---|---|---|
| **Texte collé** | Le vendeur copie ses réglages depuis l'autre outil (12 000 caractères au plus) | Mon IA perso (modèle de texte), sinon le catalogue des équivalences, sans IA | 7 jours, puis effacé |
| **Captures d'écran** | 4 au plus, JPEG, PNG ou WebP, réduites dans le navigateur avant l'envoi (3 Mo au plus chacune) | Le **modèle 1** (vision) : il lit seulement les libellés et valeurs visibles. Sans modèle de vision, ou IA désactivée, les captures sont **refusées** : rien n'est deviné | **Jamais** : seul leur nombre est enregistré |
| **Fichier de portabilité RGPD** | Le fichier que l'autre outil remet au vendeur quand il lui demande ses données (article 20 du RGPD). JSON, CSV ou texte, 2 Mo au plus. Le navigateur le lit et l'envoie à l'API | Le catalogue des équivalences, **sans IA** et **sans schéma supposé** (aucun format public fiable n'existe) : toutes les paires libellé / valeur à plat | 7 jours, puis effacé |

Le vendeur peut indiquer l'outil d'origine (« Je ne précise pas » par défaut) ; ce qu'il déclare prime sur ce que le modèle croit reconnaître.

## 2. Ce qui est interdit, et pourquoi

| Interdit | Pourquoi |
|---|---|
| **Demander les identifiants** (adresse, mot de passe, jeton, cookie) d'un autre outil | Ce sont les secrets du vendeur chez un tiers. Les détenir, c'est pouvoir agir en son nom chez ce tiers, sans le contrôle de ce tiers : un risque de sécurité et de responsabilité que Selio ne prend pas. Les conditions de ces outils l'interdisent sans doute aussi |
| **Se connecter** à leurs comptes à la place du client | Même raison, plus l'accès à un système informatique sans l'accord de son exploitant (étude juridique des concurrents, `livraison/Selio-etude-juridique-concurrents.pdf`) |
| **Lire leurs serveurs** (API, pages, exports automatiques, extraction de données) | Collecte sans l'accord de l'éditeur, données d'autres personnes possiblement mêlées, droit des bases de données. Selio ne lit que ce que son client lui remet |
| **Contourner une protection** (CAPTCHA, limitation, chiffrement, blocage) | Interdit partout dans Selio, et pour Vinted comme pour tout autre service |

Conséquences dans le code :

- **aucune requête réseau** vers un domaine concurrent, nulle part dans `packages/` et `apps/`. Un test (`packages/ai/src/migration.test.ts`) parcourt le code et échoue s'il trouve une adresse ou un domaine de Bleam, Clemz ou V-Tools ; le seul appel externe de la migration est le fournisseur d'IA configuré (Ollama sur notre machine, ou le simulateur) ;
- un libellé ou une valeur qui ressemble à un identifiant, un mot de passe, un jeton, une adresse email, un téléphone, un IBAN ou une carte est **écarté** de la correspondance (`looksLikeSecret`), jamais migré ;
- l'écran le dit en toutes lettres (`MIGRATION_FORBIDDEN_NOTE`) : « Selio ne demande jamais vos identifiants d'un autre outil, ne se connecte jamais à votre place, ne lit aucun serveur tiers et ne contourne aucune protection ». L'étape « Vous venez d'un autre outil ? » du Démarrage le dit aussi : « Selio ne vous demande jamais vos identifiants d'un autre outil et ne s'y connecte jamais à votre place. »

## 3. Le parcours : l'écran « ancien → nouveau »

Paramètres › Migration (`/app/settings/migration`), aussi proposé par l'étape « Vous venez d'un autre outil ? » du Démarrage. Réservé au **propriétaire et aux administrateurs** (`org.update`) ; les autres rôles consultent.

1. **Ce que vous avez** : texte collé, captures, ou fichier RGPD ; outil d'origine facultatif.
2. **Convertir mes réglages** : la correspondance est proposée.
   - Avec mon IA perso : sortie structurée, puis **validation** (`validateMigrationMapping`) : une valeur absente du texte collé (`not_in_source`), une recopie de l'exemple du prompt (`example_echo`), un secret (`secret_like`), un lien, du HTML ou un motif suspect (`unsafe`) sont **écartés** et listés à part. Le texte collé arrive au modèle comme **donnée non fiable**, balisé, ses marqueurs neutralisés.
   - IA désactivée ou indisponible : le texte passe par le **catalogue** seul, avec un avertissement « Vérifiez chaque champ ». Des captures sans IA sont refusées.
   - Une conversion par mon IA perso compte dans le **quota IA mensuel** (refus au-delà).
3. **Ancien → nouveau** : un tableau « Ancien réglage » (libellé et valeur lus) → « Nouveau dans Selio » (réglage et valeur convertie), avec la **confiance** (élevée, moyenne, faible) et une case à cocher par ligne. Le vendeur coche, décoche, **corrige une valeur**. Deux autres listes :
   - **Inconnus** : réglages lus sans équivalent dans Selio, ou de confiance inférieure à 0,5. Montrés par leur **libellé seulement** (la valeur lue n'est jamais conservée : elle pourrait être un secret non reconnu), **jamais appliqués** ; à régler à la main si besoin ;
   - **Écartés par la vérification** : avec la raison.
4. **Appliquer** : seuls les champs **cochés** sont écrits. Chaque champ est posé puis les réglages sont **revalidés par le schéma** ; un champ hors bornes est ignoré et expliqué, sans toucher aux autres. Les messages migrés suivent la règle D20 (« meilleur prix » refusé partout, « dernier prix » seulement dans le message de dernière offre).
5. **Résultat** : nombre de réglages appliqués, liens vers la négociation automatique et la réponse automatique pour vérifier. La relance importée va dans la règle d'automatisation « relancer sans réponse » (`follow_up_no_reply`) : fusionnée dans la règle existante (son état, activée ou non, ne change pas), sinon une règle **nouvelle, arrêtée** et soumise à validation (« Réglage migré (à activer) ») que le vendeur active lui-même.

L'application porte toujours sur la correspondance **enregistrée par la conversion** (`mappingId` obligatoire) : l'écran l'envoie, le serveur la marque « appliquée ». Les corrections de l'écran ne changent que la **cible et la valeur des champs déjà proposés** (`mergeMappingCorrection`) : un champ ajouté par le client, un libellé, une valeur lue, une confiance ou un avertissement réécrits sont ignorés ; jamais une correspondance venue entièrement du client, sans les vérifications de la conversion. Une correspondance appliquée ne se modifie plus : on refait une conversion.

**Secrets** (`looksLikeSecret`, `mentionsSecret`) : un libellé de type mot de passe, code, PIN, compte, pseudo, identifiant, utilisateur, clé d'accès, email, téléphone, IBAN, carte…, ou une valeur qui ressemble à un email, un jeton, un mot de passe (un seul mot mêlant majuscules, minuscules et chiffres) ou un numéro de téléphone : **jamais migré ni conservé**. Les avertissements et notes du modèle qui citent un secret sont remplacés par un message de Selio. Chaque étape est au journal d'audit (`migration.converted`, `migration.file_imported`, `migration.applied`), sans contenu ni valeur collée.

## 4. Conservation : 7 jours

| Donnée | Durée |
|---|---|
| Texte collé, contenu du fichier RGPD (`migration_mappings.raw_input`) | **7 jours** après la conversion, puis effacé par la tâche de rétention du worker (`app_migration_purge_raw_inputs`, chaque nuit avec `CRON_RETENTION`) |
| Captures d'écran | **Jamais stockées** (ni en base, ni sur disque, ni dans un journal) : seul leur nombre |
| Correspondance (libellés, valeurs, statut, champs appliqués) | Avec l'organisation, comme ses réglages |

L'entrée brute n'est jamais renvoyée par l'API : l'écran sait seulement si elle est encore gardée et jusqu'à quand (`rawInputKept`, `rawInputPurgeAt`).

## 5. Catalogue des équivalences

Liste **fermée** (`MIGRATION_TARGETS`, `packages/contracts/src/migration.ts` ; `MIGRATION_CATALOG`, `packages/domain/src/migration.ts`). Le modèle ne peut viser **que** ces réglages ; un chemin inventé devient un champ inconnu. Les libellés reconnus sont des termes courants du métier, comparés sans accent ni casse ; ce ne sont pas des copies d'écrans d'un autre outil. Le catalogue sert aussi au prompt (fourni comme **données**) et à la conversion sans IA.

| Réglage Selio | Cible | Nature | Exemples de libellés reconnus |
|---|---|---|---|
| Marge minimale (montant) | `marginRules.minMarginCents` | montant | marge minimum, marge mini, marge minimale… |
| Marge minimale (taux) | `marginRules.minMarginRate` | taux | marge minimum en %, marge mini %, taux de marge minimum… |
| Remise maximale | `marginRules.maxDiscountRate` | taux | remise max, remise maximale, reduction max… |
| Pas de contre-proposition | `marginRules.counterStepRate` | taux | pas de contre offre, palier de contre proposition, pas de negociation… |
| Contre-propositions maximales par acheteur | `marginRules.maxRoundsPerCustomer` | nombre entier | nombre de contre offres, contre offres max, nombre de negociations… |
| Plage horaire d'activité | `schedule` | plage horaire | horaires, plage horaire, heures actives… |
| Heure de début | `schedule.activeFrom` | heure | heure de debut, debut d'activite, actif a partir de… |
| Heure de fin | `schedule.activeTo` | heure | heure de fin, fin d'activite, actif jusqu'a… |
| Message d'accueil | `messages.greeting` | texte | message d'accueil, message de bienvenue, premier message… |
| Message de contre-proposition | `messages.counter` | texte | message de contre offre, message contre proposition, reponse a une offre… |
| Message de dernière offre | `messages.final` | texte | message de derniere offre, offre finale, dernier prix… |
| Message après la dernière offre | `messages.afterFinal` | texte | message apres refus, relance apres offre finale, message si refus… |
| Message d'acceptation | `messages.accepted` | texte | message d'acceptation, offre acceptee, message quand j'accepte… |
| Message de refus | `messages.fallback` | texte | message de refus, offre refusee, message quand je refuse… |
| Réponse automatique activée | `autoReply.enabled` | oui / non | reponse automatique, reponses auto, message auto… |
| Message d'absence | `autoReply.awayMessage` | texte | message d'absence, message hors horaires, message de nuit… |
| Message aux favoris activé | `favorites.enabled` | oui / non | message aux favoris, relance favoris, offre aux favoris… |
| Message aux favoris | `favorites.message` | texte | texte favoris, message envoye aux favoris, texte de l'offre aux favoris… |
| Remise proposée aux favoris | `favorites.offerRate` | taux | remise favoris, reduction favoris, offre favoris en %… |
| Délai avant le message aux favoris | `favorites.delayMinutes` | minutes | delai favoris, attente avant message favoris, delai avant offre favoris… |
| Remise sur les lots activée | `lot.enabled` | oui / non | remise lot, lots, remise sur les lots… |
| Remise pour 2 articles | `lot.twoItemsRate` | taux | remise 2 articles, lot de 2, reduction 2 articles… |
| Remise pour 3 articles et plus | `lot.threePlusRate` | taux | remise 3 articles, lot de 3, reduction 3 articles et plus… |
| Baisses de prix automatiques activées | `priceDrops.enabled` | oui / non | baisse de prix automatique, baisses auto, reduction automatique du prix… |
| Baisse de prix après (jours) | `priceDrops.afterDays` | jours | baisse apres, jours avant baisse, delai avant baisse de prix… |
| Taux de baisse de prix | `priceDrops.rate` | taux | taux de baisse, pourcentage de baisse, baisse de… |
| Prix minimal après baisses (part du prix initial) | `priceDrops.floorRate` | taux | prix plancher des baisses, ne pas descendre sous, minimum apres baisses… |
| Délai minimal avant une réponse | `timing.minDelayMinutes` | minutes | delai minimum de reponse, attente minimum, delai mini… |
| Délai maximal avant une réponse | `timing.maxDelayMinutes` | minutes | delai maximum de reponse, attente maximum, delai maxi… |
| Envoyer les contre-offres comme offres Vinted | `timing.sendOffers` | oui / non | envoyer une offre, offre vinted, contre offre en offre… |
| Validité d'une offre (heures) | `timing.offerValidityHours` | heures | validite de l'offre, duree de l'offre, expiration de l'offre… |
| Message après la vente | `afterSale.soldMessage` | texte | message apres vente, message vendu, message de remerciement… |
| Message après la validation | `afterSale.completedMessage` | texte | message apres validation, message fin de commande, message apres reception… |
| Rappel de retrait au point relais | `afterSale.pickupReminderText` | texte | rappel point relais, message colis en attente, rappel de retrait… |
| Ton des messages | `ai.tone` | ton | ton, ton des messages, style des reponses… |
| Signature | `ai.signature` | texte | signature, signature des messages, nom de boutique en signature… |
| Validation avant envoi | `ai.requireApproval` | oui / non | validation avant envoi, valider avant d'envoyer, brouillon a valider… |
| Republier après (jours) | `dressing.republishAfterDays` | jours | republication, republier apres, remise en ligne apres… |
| Relance sans réponse après (heures) | `followUp.delayHours` | heures | relance, delai de relance, relance apres… |
| Message de relance | `followUp.template` | texte | message de relance, texte de relance, relance texte… |

Conversions : un taux s'écrit « 20 % », « 0,2 » ou « 20 » (0,2) ; une durée « 24 h », « 2 jours », « 30 min » ; une plage horaire « 8h-22h » ; « oui / non » pour un interrupteur. Un « prix minimum en % du prix affiché » devient une remise maximale (100 % − X). Une valeur inconvertible n'est pas devinée : le champ va dans les inconnus.

Ce que le catalogue **ne reprend pas** (à régler à la main) : les comptes Vinted reliés, le stock, les clients, les commandes, les messages échangés, les situations par mots-clés, les lots sur offre (`negotiation.bundle`), les limites de Vinted, les abonnements et tout identifiant.

## 6. Honnêteté dans la communication (vidéos, vitrine, démonstrations)

- **Aucun import automatique promis.** On ne dit jamais « importez votre compte Bleam en un clic », « connectez votre compte Clemz », « Selio récupère vos réglages automatiquement ». On dit : « collez vos réglages, ajoutez des captures ou importez le fichier que votre outil vous remet ; vous validez chaque réglage ».
- Montrer le vrai parcours : coller, convertir, **cocher**, appliquer, puis vérifier. Montrer aussi les **inconnus** : tout ne se reprend pas.
- Ne jamais montrer, dans une vidéo, l'écran d'un autre outil avec des données réelles, ni ses logos ; utiliser un texte d'exemple écrit par l'équipe.
- Ne pas promettre la lecture d'un fichier RGPD précis : les formats ne sont pas publics, Selio lit les paires libellé / valeur qu'il trouve, sans plus.
- « Mon IA perso propose, vous validez » : jamais « l'IA règle tout pour vous ».

## 7. API

| Route | Rôle |
|---|---|
| `POST /api/migration/convert` | Texte et/ou captures → correspondance (brouillon). 14 Mo au plus, 10 par minute |
| `POST /api/migration/import`, `POST /api/migration/file` | Fichier RGPD → correspondance (brouillon), sans IA. 3 Mo au plus, 10 par minute |
| `GET /api/migration`, `GET /api/migration/:id` | Liste et détail (sans l'entrée brute) |
| `PATCH /api/migration/:id` | Enregistre les corrections (cible et valeur des champs proposés, brouillon seulement) |
| `POST /api/migration/apply` (`mappingId` obligatoire), `POST /api/migration/:id/apply` | Applique les champs acceptés (`acceptedFieldIds`) de la correspondance enregistrée, avec les corrections si besoin, revalidées ; sans identifiant : 400 ; déjà appliquée : 409 |

Base : table `migration_mappings` (migration `0015_negociation_migration.sql`), RLS forcée par organisation. Aucune variable d'environnement propre à la migration.

## 8. Limites connues

- **Précision non mesurée** : la conversion par mon IA perso n'a pas été évaluée sur de vraies exports ou captures de ces outils (nous n'en avons pas, et n'en collectons pas). Le vendeur valide tout ; rien n'est appliqué sans sa coche.
- **Fichier RGPD gardé en entier 7 jours** : le contenu brut est nettoyé des caractères de contrôle mais **pas filtré** ; un export peut contenir des données de tiers (acheteurs, messages) ou un identifiant. Le filtre des secrets ne s'applique qu'à la correspondance. À trancher : ne garder que les lignes reconnues, ou ne rien garder du fichier.
- **Captures** : lisibles seulement si le modèle 1 est installé et désigné (`OLLAMA_VISION_MODEL`) ; sinon refus explicite, le vendeur colle du texte.
- La relance migrée remplit `follow_up_no_reply`, pas la relance après 24 h (`follow_up_24h`, selon l'offre) : le vendeur choisit dans Automatisation.
