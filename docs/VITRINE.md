# Vitrine

_Version du 17 novembre 2026_

La vitrine est la partie publique de `apps/web` (`src/marketing/`), servie en statique par Netlify avec l'application. Ce document dit quelles pages existent, comment elles sont référencées, où figure la mention d'indépendance, et ce qui attend Elias (textes) et l'avocat (pages légales, comparatifs).

## Noms et filiales (organisation officielle, 17 novembre 2026)

« Selio » est la marque (l'entreprise, le logo). Selio est un écosystème de **cinq filiales**, toujours présentées dans cet ordre (accueil, plateforme, pied de page, menus, constellation, tarifs, FAQ), chacune avec son positionnement en une phrase (`tagline` dans `products.ts`) :

1. **Selio Manager** — la gestion complète et l'automatisation de l'activité Vinted (stock centralisé, dressing intelligent, remise en ligne, messagerie automatisée, négociation par IA, relances, commandes et ventes, marges, automatisations, multi-comptes). Message clé, mot pour mot (`MANAGER_KEY_MESSAGE`) : « Selio Manager centralise la gestion et l'automatisation de l'activité Vinted. Selio Cloud et Selio Agent viennent compléter ses possibilités. »
   - **Selio Cloud** — fonctionnalité intégrée : certaines automatisations à distance, sans ordinateur allumé.
   - **Selio Agent** — fonctionnalité intégrée : délégation de tâches et d'accès à des collaborateurs et prestataires.
2. **Selio Studio** — création et optimisation des annonces par l'IA.
3. **Selio Track** — analyse du marché et recherche d'opportunités ; Track analyse et identifie, **il n'achète pas**.
4. **Selio Bot** — recherche et achat d'articles (l'ancien « Selio Radar », fusionné). Distinction, mot pour mot sur les pages Manager et Bot (`MANAGER_BOT_DISTINCTION`) : « Selio Manager gère et automatise votre compte (republication, messages, négociation, relances, marges) ; Selio Bot recherche, détecte et achète. »
5. **Selio Compte** (au singulier) — services liés aux comptes Vinted et accompagnement, en sept services : création de comptes (options selon les offres), comptes préparés ou non, commandes en volume sur devis, configuration personnalisée de Selio Manager, optimisation des messages et de la négociation, accompagnement 30 jours, accompagnement en cas de restriction **sans promesse de déblocage garanti**.

**Selio Cloud et Selio Agent ne sont pas des filiales** : jamais de carte à eux dans la gamme, jamais « sixième » ou « septième » produit. Ils ont une page « fonctionnalité de Selio Manager » (`/produits/cloud`, `/produits/agent` : sur-titre « Selio Cloud · fonctionnalité de Selio Manager », fil d'Ariane visible « Selio Manager › Selio Cloud », données structurées sans `SoftwareApplication`), une section « Fonctionnalités intégrées » sur la page de Selio Manager, un encart sous la carte de Selio Manager, et des liens en retrait sous Selio Manager dans le pied de page. « Selio Radar », « Selio Agents » et « Selio Comptes » ne sont plus écrits dans les textes de la vitrine, sauf dans les légendes des captures qui montrent encore l'ancien nom (tests).

Source unique : `src/marketing/products.ts` (`PRODUCTS` : les cinq filiales ; `MANAGER_FEATURES` : Cloud et Agent ; `PRODUCT_PAGES` : les sept pages ; `LEGACY_PRODUCT_SLUGS` : anciennes adresses). Cartes et constellation de la gamme : `src/marketing/spaces.tsx` (icônes propres à la vitrine, plus de dépendance aux identifiants d'espace de l'application). Les quatorze modules de la constellation de l'accueil et de la page Fonctionnalités portent leur filiale (`product` dans `catalog.ts`) et sont rangés dans l'ordre des filiales (Manager, Studio, Track, Bot, puis l'IA commune).

## Pas de démonstration sur la vitrine

La vitrine ne renvoie jamais vers la démonstration : chaque appel mène à l'inscription (**essai gratuit de 14 jours**) ou à la connexion (`CtaBand`, héro, en-tête, pages produit ; Selio Compte : « Demander un devis », vers Contact). Les captures sont légendées « données d'exemple ». En production (`VITE_API_BASE_URL` renseignée, `src/marketing/demoAccess.ts`), `/demo` redirige vers `/inscription` et la connexion comme l'inscription ne proposent plus le choix « Démonstration ». En développement sans API, `/demo` reste ouvert (tests de bout en bout, vidéos, captures). La FAQ de la vitrine masque les trois questions sur la démonstration (`VITRINE_HIDDEN`, `pages/Faq.tsx`).

## Le parcours de l'accueil

« De l'achat à l'étiquette », en sept étapes, chacune avec la filiale qui s'en charge : sourcing et analyse (Track), **sourcing auprès de fournisseurs partenaires (Bientôt)**, recherche et achat (Bot), photos et annonce (Studio), vente, négociation et relances (Manager), commande, étiquette et envoi (Manager), après-vente (Manager). Les fournisseurs partenaires sont une piste annoncée comme telle : **aucun accord n'est signé, aucun nom ni logo n'est cité** ; la phrase « Aucun partenariat n'est encore signé » est à retirer seulement quand un accord existe. Un article réel (le pull torsadé, photo de la démo) sert de fil rouge.

## Pages

| Adresse | Page | Indexée | Source |
|---|---|---|---|
| `/` | Accueil (constellation, capture de Selio Manager, parcours, gamme, transparence) | oui | `pages/Home.tsx` |
| `/fonctionnalites` | Les quatorze modules et leur état | oui | `pages/Features.tsx`, `catalog.ts` |
| `/plateforme` | Les cinq filiales (constellation, une phrase par filiale, cartes), liens vers chaque page | oui | `pages/Platform.tsx`, `spaces.tsx` |
| `/produits/manager` | Selio Manager (l'outil de gestion, `/app`), avec ses fonctionnalités intégrées | oui | `pages/Product.tsx`, `products.ts` |
| `/produits/studio` | Selio Studio | oui | idem |
| `/produits/track` | Selio Track | oui | idem |
| `/produits/bot` | Selio Bot (recherche et achat) | oui | idem |
| `/produits/compte` | Selio Compte (prestations et devis) | oui | idem |
| `/produits/cloud` | Selio Cloud, fonctionnalité de Selio Manager | oui | idem |
| `/produits/agent` | Selio Agent, fonctionnalité de Selio Manager | oui | idem |
| `/produits/radar`, `/produits/comptes`, `/produits/agents` | anciennes adresses, redirigées vers `/produits/bot`, `/produits/compte`, `/produits/agent` | non (hors sitemap) | `pages/Product.tsx` |
| `/selio-ou-bleam` | « Selio ou Bleam ? » | **non, tant que `COMPARISON_READY` est faux** | `pages/SelioOrBleam.tsx`, `comparison.ts` |
| `/alternative-bleam` | « Alternative à Bleam » | **non, idem** | `pages/AlternativeBleam.tsx` |
| `/extension` | Extension navigateur (fiche) | oui | `pages/Extension.tsx` |
| `/extension/confidentialite` | Politique de confidentialité de l'extension (adresse à donner au Chrome Web Store) | non (version provisoire) | `pages/ExtensionPrivacy.tsx`, `extensionPrivacy.ts` |
| `/assistant-ia`, `/tarifs`, `/faq`, `/contact` | inchangées | oui | |
| `/mentions-legales`, `/confidentialite`, `/conditions` | pages légales, **version provisoire, définitive après l'avocat** | non | `pages/Legal.tsx` |

Les pages produit vivent sous `/produits/…` : `/studio`, `/track`, `/bot`, `/cloud`, `/agents` et `/comptes` sont les adresses de l'application (`app/spaces/paths.ts`), un test vérifie qu'aucune page produit ne les recouvre. `/produits` et un produit inconnu renvoient à `/plateforme`.

### Structure commune des pages de filiale

Une seule source (`src/marketing/products.ts`), un seul gabarit (`pages/Product.tsx`) :

1. **Promesse honnête** (titre) et état réel : Disponible, Aperçu, En développement ou Sur devis (Selio Compte), avec une phrase qui dit ce qui est simulé (repris de `docs/BUILD_STATUS.md`) ; encadré de distinction Manager / Bot sur ces deux pages.
2. **Ce que fait le module** : trois à six fonctions, telles qu'elles existent dans le code.
3. **Ce qu'il ne fait pas** : limites assumées (pas de mot de passe, pas de contournement, pas d'achat à votre place, pas de donnée inventée…).
4. **Capture d'écran** sur données d'exemple, en clair et en sombre (voir « Captures ») ; Selio Compte affiche une illustration en attendant la sienne.
5. **Prix : voir les tarifs**, avec un lien vers l'ancre de `/tarifs` où le module est chiffré (`#filiales`, `#compte`, `#comparer`). Aucun montant n'est écrit sur la page (les montants restent indicatifs, dans `PRICING`).
6. Les autres filiales (les cinq, sur une page de fonctionnalité), la **mention d'indépendance**, et l'appel à l'essai de 14 jours (Selio Compte : « Demander un devis », vers Contact). Sur la page de Selio Manager, la section « Fonctionnalités intégrées » (Selio Cloud, Selio Agent).

### Captures

Les captures (`src/marketing/assets/produit-<produit>-clair.webp` et `-sombre.webp`, 1600 × 1000) sont prises sur les données d'exemple, en développement sans API, avec Chromium : `vite` en local, `/demo?vers=/app` pour ouvrir la session, puis chaque espace (`/app/dressing` pour `apercu-*`, `/studio`, `/track`, `/app/radar`, `/cloud`, `/agents`, `/comptes`) en clair et en sombre (`localStorage["selio.theme"]`). Le bandeau « Démonstration — données fictives » de l'application est masqué au moment de la capture (les légendes disent « données d'exemple ») ; les encarts « simulé » des pages restent visibles. Capture PNG convertie en WebP (qualité 0,78) par un `canvas` du navigateur. Manager reprend la capture du dressing de l'accueil. À refaire quand un écran change beaucoup. Dernière série : 16 novembre 2026, après la remise à l'endroit des photos du pull torsadé (`g-x4iv-*`, voir `packages/demo-data/scripts/import-revendo-photos.py`, `GALLERY_UPSIDE_DOWN`).

**Pas refaites pour la nouvelle organisation** (l'application change en parallèle) : les fichiers gardent leur ancien nom et leurs légendes le disent. `produit-radar-*` illustre Selio Bot (la page y porte encore le nom « Radar »), `produit-agents-*` illustre Selio Agent (« Selio Agents » dans la capture). `produit-comptes-*` (l'ancienne checklist, qui dit « Selio ne crée aucun compte à votre place ») n'est plus affichée : elle contredirait les services de Selio Compte. **À refaire** une fois l'application stabilisée : `/bot`, `/agents`, `/comptes`, et le Manager si son menu change.

## Tarifs

- Configuration unique : `PRICING` dans `packages/demo-data/src/plans.ts` (montants indicatifs). `PRICING.subsidiaries` : `studio` (packs), `bot` (14,99 €/mois, l'ancien prix de Radar), `botAutoBuy` (29,99 €/mois, option d'achat automatique de Selio Bot, l'ancien « Radar Auto », désactivée), `cloudOption` (9,99 €/mois, Selio Cloud en option pour Starter et Pro), `compte` (`prestations` payées une fois : configuration personnalisée de Selio Manager 19 €, configuration + optimisation des messages et de la négociation 49 €, accompagnement 30 jours 89 € ; `onQuote` : création de comptes, comptes préparés ou non, commandes en volume, restriction, sur devis).
- Page `/tarifs` : section « Les autres filiales » (`#filiales` : Studio seul, Selio Bot et son option, Selio Cloud en option, automatisations de Selio Manager incluses selon le forfait), puis `#compte` (prestations, et « Sur devis » avec le bouton « Demander un devis » vers `/contact`). La page Contact accepte `?sujet=compte` (ou l'ancien `?sujet=comptes`) pour pré-choisir le sujet.
- Tableau comparatif (`PLAN_COMPARISON`) : Formule, puis un groupe par filiale dans l'ordre — Selio Manager, Selio Cloud et Selio Agent (« fonctionnalité de Selio Manager »), Selio Studio, Selio Track, Selio Bot, Selio Compte —, puis Assistance.

## Référencement

- **Une liste** : `SEO_PAGES` dans `src/marketing/seo.ts` (titre, description de 160 caractères au plus, indexation, priorité). Chaque page l'utilise par `useMarketingMeta(chemin)`. Les tests (`seo.test.ts`) vérifient que chaque page a sa route, que les titres sont uniques et que les descriptions tiennent dans la limite.
- **Sitemap** : `public/sitemap.xml`, exactement les pages indexables (test). Une page ajoutée à la liste sans être ajoutée au sitemap, ou l'inverse, fait échouer les tests.
- **robots.txt** : l'application et les espaces sont exclus (le test accepte qu'une adresse soit couverte par un préfixe, par exemple `/app/radar` par `/app`) (`/app`, `/studio`, `/track`, `/bot`, `/cloud`, `/agents`, `/comptes`, `/generateur`, `/admin`, `/demo`, `/api/`), le sitemap est déclaré. Les pages de connexion, d'inscription, de démonstration et les pages légales portent `noindex`.
- **Données structurées** (schema.org, JSON-LD) : `Organization` et `WebSite` dans `index.html` (lus même sans JavaScript) ; `SoftwareApplication` et `BreadcrumbList` sur chaque page de filiale et sur la page Extension ; `BreadcrumbList` sur les comparatifs. **Aucun prix, aucune note, aucun avis** dans ces données : les montants sont indicatifs et aucun avis client n'est publié.
- **Domaine** : `SITE_ORIGIN = "https://selio.fr"` dans `seo.ts`, repris dans `sitemap.xml`, `robots.txt` et `index.html` (un test vérifie qu'ils concordent). **Le domaine n'est pas confirmé** : à changer aux quatre endroits avant la mise en ligne.
- La vitrine est une application monopage : le titre, la description et les données structurées des pages sont posés par JavaScript. Google l'exécute ; d'autres moteurs et les aperçus de liens ne voient que ce que dit `index.html`. Un rendu statique des pages publiques (pré-rendu au build) améliorerait cela ; non fait, à décider.

### Mots-clés visés

« alternative à Bleam », « alternative à V-Tools », « alternative à Clemz », « outil revendeur Vinted », « automatisation Vinted », « logiciel Vinted », « gestion Vinted » (`TARGET_KEYWORDS`, test de présence dans les titres et descriptions). Ils sont placés dans les titres, les descriptions et les intertitres, sans bourrage. **Aucune position n'est promise** : ni « première position », ni « top » sur un moteur, et aucun texte n'en parle.

Les mots-clés « alternative à … » ne portent aujourd'hui que sur les deux comparatifs, non indexés tant que les textes d'Elias manquent : ils ne travailleront qu'une fois `COMPARISON_READY` passé à vrai.

## Mention d'indépendance

Mot pour mot, une seule constante (`INDEPENDENCE_NOTICE`, `src/marketing/seo.ts`) :

> Selio est indépendant de Vinted et n'est ni affilié, ni approuvé, ni sponsorisé par Vinted.

Elle figure : dans le pied de page de toute la vitrine ; sur chaque page de filiale, les comparatifs, la plateforme, la page Extension et la politique de l'extension ; dans les mentions légales et les conditions d'utilisation (section « Indépendance ») ; dans `index.html` (description de partage et données structurées) ; dans le popup et les options de l'extension ; dans la fiche Chrome Web Store (`apps/extension/store/listing.md`, `justifications.md`, `privacy-policy.md`). Le manifeste de l'extension, limité à 132 caractères, porte la forme courte « Indépendant de Vinted ». Les tests le vérifient (unitaires et de bout en bout).

## Promesses interdites

`FORBIDDEN_CLAIMS` (`seo.ts`) : classement garanti sur un moteur de recherche, « zéro risque » ou « sans risque », « 100 % légal » ou « 100 % conforme », « partenaire Vinted » ou « approuvé par Vinted » (la forme niée de la mention d'indépendance est tolérée). Deux contrôles :

- `seo.test.ts` relit le source de la vitrine, `index.html`, le code de l'extension, son manifeste, ses locales et les textes de la fiche ;
- `e2e/marketing.spec.ts` relit le texte affiché de chaque page publique, sur les trois formats.

## Comparatifs Bleam

Les textes d'Elias **ne sont pas fournis**. Les deux pages ont leur structure complète ; chaque emplacement est marqué « [Texte d'Elias à insérer] » (filet pointillé, `data-placeholder`) :

- « Selio ou Bleam ? » : introduction, réponse courte, comparatif, ce qui compte pour un revendeur, quand Bleam peut rester le bon choix, questions fréquentes.
- « Alternative à Bleam » : accroche, pourquoi changer, V-Tools et Clemz, questions fréquentes.

**Règle du comparatif** (`src/marketing/comparison.ts`) : côté Selio, seulement ce qui est construit (fonctions et principes vérifiables dans le dépôt : pas de contournement, pas de mot de passe, validation par le client, données en France, migration sans identifiants). Côté Bleam, seulement ce que l'étude juridique a relevé sur ses pages publiques (fiche App Store, bleam.app, relevé du 27 octobre 2026), **avec la source affichée**. Toute autre case dit « [À vérifier, avec source] ». L'affirmation non confirmée de l'étude (identifiants gardés, serveurs partagés) n'est **pas** reprise. Rien n'est affirmé sur V-Tools ni Clemz.

Tant que `COMPARISON_READY` vaut `false` : bandeau « Page en préparation », `noindex`, pages absentes du sitemap et du pied de page. Pour publier :

1. Insérer les textes d'Elias dans `pages/SelioOrBleam.tsx` et `pages/AlternativeBleam.tsx` (les blocs `data-placeholder`).
2. Revérifier chaque ligne Bleam de `COMPARISON_ROWS` sur ses pages publiques, mettre à jour `BLEAM_SOURCE_DATE`.
3. Faire relire par l'avocat (publicité comparative : comparaison objective, vérifiable, non dénigrante ; usage des marques Bleam, V-Tools, Clemz).
4. Passer `COMPARISON_READY` à `true`, ajouter les deux adresses à `public/sitemap.xml` (le test le demandera), relancer les tests.

## Ce qui attend l'avocat

- Mentions légales, politique de confidentialité, conditions d'utilisation, politique de l'extension : marquées « Version provisoire, définitive après l'avocat. », non indexées. Les passages entre crochets sont à renseigner (éditeur, hébergeurs, sous-traitants, contact, clause de responsabilité sans clause abusive).
- Les comparatifs (ci-dessus).
- La mention d'indépendance elle-même est celle recommandée par l'étude juridique ; à confirmer.

## Vérifier

```bash
pnpm --filter @selio/web typecheck
pnpm --filter @selio/web test            # seo.test.ts, pages/vitrine-pages.test.tsx
pnpm build:web
cd apps/web && PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test e2e/marketing.spec.ts --reporter=line
```
