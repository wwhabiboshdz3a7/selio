# Vitrine

_Version du 16 novembre 2026_

La vitrine est la partie publique de `apps/web` (`src/marketing/`), servie en statique par Netlify avec l'application. Ce document dit quelles pages existent, comment elles sont référencées, où figure la mention d'indépendance, et ce qui attend Elias (textes) et l'avocat (pages légales, comparatifs).

## Noms et gamme

« Selio » est la marque (l'entreprise, le logo). L'outil de gestion s'appelle **Selio Manager** (espace `selio`, `/app` ; l'identifiant de code est gardé). La gamme, toujours présentée dans cet ordre (accueil, plateforme, pied de page, accueil des espaces) :

1. **Selio Manager** — la gestion quotidienne ;
2. **Selio Studio** — les annonces à partir des photos ;
3. **Selio Track** — les statistiques du marché ;
4. **Selio Radar** — les bonnes affaires (vit dans Selio Manager, a sa page) ;
5. **Selio Bot** — les automatisations qui travaillent pour vous (négociation, relances, republications, achat automatique), exécutées dans Selio Cloud ; sans prix séparé, inclus selon le forfait ;
6. **Selio Cloud** — le moteur qui fait tourner Selio Manager, Selio Bot et les équipes Selio Agents 24 h/24, ordinateur éteint ;
7. **Selio Agents** — équipes, rôles, accès, boutiques clientes des agences ;
8. **Selio Comptes** — à la prestation : audit de boutique, mise en place complète, accompagnement 30 jours, payés une fois (prix dans `PRICING.subsidiaries`, `packages/demo-data/src/plans.ts`).

Source unique des pages : `src/marketing/products.ts` (`PRODUCTS`) ; les cartes de la gamme (`RangeCard`, `RangeConstellation`) sont dans `src/marketing/spaces.tsx`. Les espaces de l'application (`app/spaces/spaces.tsx`) suivent le même ordre, Radar en moins.

## Pas de démonstration sur la vitrine

La vitrine ne renvoie jamais vers la démonstration : chaque appel mène à l'inscription (**essai gratuit de 14 jours**) ou à la connexion (`CtaBand`, héro, en-tête, pages produit ; Selio Comptes mène à Contact). Les captures sont légendées « données d'exemple ». En production (`VITE_API_BASE_URL` renseignée, `src/marketing/demoAccess.ts`), `/demo` redirige vers `/inscription` et la connexion comme l'inscription ne proposent plus le choix « Démonstration ». En développement sans API, `/demo` reste ouvert (tests de bout en bout, vidéos, captures). La FAQ de la vitrine masque les trois questions sur la démonstration (`VITRINE_HIDDEN`, `pages/Faq.tsx`).

## Le parcours de l'accueil

« De l'achat à l'étiquette », en huit étapes, chacune avec le produit qui s'en charge : sourcing sur le marché (Track), **sourcing auprès de fournisseurs partenaires (Bientôt)**, achat (Radar), photos et annonce (Studio), vente et négociation (Bot), commande, étiquette et envoi, après-vente (Manager). Les fournisseurs partenaires sont une piste annoncée comme telle : **aucun accord n'est signé, aucun nom ni logo n'est cité** ; la phrase « Aucun partenariat n'est encore signé » est à retirer seulement quand un accord existe. Un article réel (le pull torsadé, photo de la démo) sert de fil rouge.

## Pages

| Adresse | Page | Indexée | Source |
|---|---|---|---|
| `/` | Accueil (constellation, capture de Selio Manager, parcours, gamme, transparence) | oui | `pages/Home.tsx` |
| `/fonctionnalites` | Les quatorze modules et leur état | oui | `pages/Features.tsx`, `catalog.ts` |
| `/plateforme` | La gamme Selio, liens vers chaque page produit | oui | `pages/Platform.tsx`, `spaces.tsx` |
| `/produits/manager` | Selio Manager (l'outil de gestion, `/app`) | oui | `pages/Product.tsx`, `products.ts` |
| `/produits/studio` | Selio Studio | oui | idem |
| `/produits/track` | Selio Track | oui | idem |
| `/produits/radar` | Selio Radar | oui | idem |
| `/produits/bot` | Selio Bot | oui | idem |
| `/produits/cloud` | Selio Cloud | oui | idem |
| `/produits/agents` | Selio Agents | oui | idem |
| `/produits/comptes` | Selio Comptes (à la prestation) | oui | idem |
| `/selio-ou-bleam` | « Selio ou Bleam ? » | **non, tant que `COMPARISON_READY` est faux** | `pages/SelioOrBleam.tsx`, `comparison.ts` |
| `/alternative-bleam` | « Alternative à Bleam » | **non, idem** | `pages/AlternativeBleam.tsx` |
| `/extension` | Extension navigateur (fiche) | oui | `pages/Extension.tsx` |
| `/extension/confidentialite` | Politique de confidentialité de l'extension (adresse à donner au Chrome Web Store) | non (version provisoire) | `pages/ExtensionPrivacy.tsx`, `extensionPrivacy.ts` |
| `/assistant-ia`, `/tarifs`, `/faq`, `/contact` | inchangées | oui | |
| `/mentions-legales`, `/confidentialite`, `/conditions` | pages légales, **version provisoire, définitive après l'avocat** | non | `pages/Legal.tsx` |

Les pages produit vivent sous `/produits/…` : `/studio`, `/track`, `/bot`, `/cloud`, `/agents` et `/comptes` sont les adresses des espaces de l'application (`app/spaces/paths.ts`), un test vérifie qu'aucune page produit ne les recouvre. `/produits` et un produit inconnu renvoient à `/plateforme`.

### Structure commune des pages de filiale

Une seule source (`src/marketing/products.ts`), un seul gabarit (`pages/Product.tsx`) :

1. **Promesse honnête** (titre) et état réel : Disponible, Aperçu, En développement ou Sur demande (Selio Comptes), avec une phrase qui dit ce qui est simulé (repris de `docs/BUILD_STATUS.md`).
2. **Ce que fait le module** : trois à six fonctions, telles qu'elles existent dans le code.
3. **Ce qu'il ne fait pas** : limites assumées (pas de mot de passe, pas de contournement, pas d'achat à votre place, pas de donnée inventée…).
4. **Capture d'écran** sur données d'exemple, en clair et en sombre (voir « Captures ») ; Selio Bot affiche une illustration en attendant ses pages.
5. **Prix : voir les tarifs**, avec un lien vers l'ancre de `/tarifs` où le module est chiffré. Aucun montant n'est écrit sur la page (les montants restent indicatifs, dans `PRICING`).
6. Le reste de la gamme, la **mention d'indépendance**, et l'appel à l'essai de 14 jours (Selio Comptes : « Demander une prestation », vers Contact).

### Captures

Les captures (`src/marketing/assets/produit-<produit>-clair.webp` et `-sombre.webp`, 1600 × 1000) sont prises sur les données d'exemple, en développement sans API, avec Chromium : `vite` en local, `/demo?vers=/app` pour ouvrir la session, puis chaque espace (`/app/dressing` pour `apercu-*`, `/studio`, `/track`, `/app/radar`, `/cloud`, `/agents`, `/comptes`) en clair et en sombre (`localStorage["selio.theme"]`). Le bandeau « Démonstration — données fictives » de l'application est masqué au moment de la capture (les légendes disent « données d'exemple ») ; les encarts « simulé » des pages restent visibles. Capture PNG convertie en WebP (qualité 0,78) par un `canvas` du navigateur. Manager reprend la capture du dressing de l'accueil. À refaire quand un écran change beaucoup. Dernière série : 16 novembre 2026, après la remise à l'endroit des photos du pull torsadé (`g-x4iv-*`, voir `packages/demo-data/scripts/import-revendo-photos.py`, `GALLERY_UPSIDE_DOWN`).

## Référencement

- **Une liste** : `SEO_PAGES` dans `src/marketing/seo.ts` (titre, description de 160 caractères au plus, indexation, priorité). Chaque page l'utilise par `useMarketingMeta(chemin)`. Les tests (`seo.test.ts`) vérifient que chaque page a sa route, que les titres sont uniques et que les descriptions tiennent dans la limite.
- **Sitemap** : `public/sitemap.xml`, exactement les pages indexables (test). Une page ajoutée à la liste sans être ajoutée au sitemap, ou l'inverse, fait échouer les tests.
- **robots.txt** : l'application et les espaces sont exclus (`/app`, `/studio`, `/track`, `/bot`, `/cloud`, `/agents`, `/comptes`, `/generateur`, `/admin`, `/demo`, `/api/`), le sitemap est déclaré. Les pages de connexion, d'inscription, de démonstration et les pages légales portent `noindex`.
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
