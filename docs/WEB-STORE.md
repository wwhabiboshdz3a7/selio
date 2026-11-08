# Publication de l'extension sur le Chrome Web Store

_Version du 8 novembre 2026_

**Rien n'est publié.** Le compte développeur Chrome Web Store (5 $, paiement unique) est **à valider par Ibrahim** : aucun compte n'est créé ni payé. Ce document dit ce qui est prêt, ce qui manque, et la procédure complète le jour où la décision est prise.

## Ce qui est prêt

| Élément | Où | État |
|---|---|---|
| Manifeste relu | `apps/extension/manifest.json` | MV3, permissions `storage` et `activeTab` seulement, `host_permissions` vide, script de contenu limité à `www.vinted.fr/.be/.com` (cadre principal), autorisation de l'API demandée à l'association (`optional_host_permissions`), CSP `script-src 'self'`, description de 125 caractères avec « Indépendant de Vinted », icônes 16 / 32 / 48 / 128 |
| Paquet | `pnpm extension:pack` | Construit l'extension, dérive le manifeste de publication, contrôle tout, écrit `apps/extension/release/selio-extension-<version>.zip` et son SHA-256 |
| Textes de la fiche | `apps/extension/store/listing.md` | Titre, résumé, catégorie, description, liens, visibilité conseillée |
| Justifications | `apps/extension/store/justifications.md` | Objectif unique, chaque permission, code distant (non), données collectées, engagements |
| Politique de confidentialité | `/extension/confidentialite` sur le site et `apps/extension/store/privacy-policy.md` | Même texte (test), **version provisoire, définitive après l'avocat** |
| Liste des captures | `apps/extension/store/captures.md` | 5 captures et la vignette 440 × 280 à produire |

### Ce que fait `pnpm extension:pack`

1. `pnpm build` de l'extension (`dist/`).
2. Manifeste de publication (`scripts/pack-lib.mjs`, `storeManifest`) : les origines `http://127.0.0.1/*` et `http://localhost/*` du développement sont **retirées** (la version publiée ne parle qu'à une API en HTTPS) ; avec `EXTENSION_API_ORIGIN=https://api.<domaine>`, l'autorisation facultative est réduite à cette seule origine.
3. Contrôles bloquants (`validateManifest`, `inspectBundle`) : MV3, longueurs du nom (75) et de la description (132), format de version, icône 128, **aucune permission hors de `storage` et `activeTab`** (une nouvelle permission exige d'abord sa justification), `host_permissions` vide, script de contenu sur Vinted seulement et sans `all_frames`, aucune origine non chiffrée, CSP sans code distant ni `unsafe-eval`, pas d'`externally_connectable`, aucun script distant dans les pages, fichiers de fiche présents.
4. Avertissements : autorisation facultative encore large (`https://*/*`), adresse d'API par défaut locale dans les options.
5. Archive ZIP (sans dépendance, entrées triées, date fixe : la même construction donne la même archive), sans cartes de sources ni fichiers cachés, et son empreinte SHA-256.

Vérifié le 8 novembre 2026 : paquet de 57 fichiers (≈ 810 Ko), archive intègre (`unzip -t`), extension décompressée chargée dans Chromium (service worker actif, popup et options sans erreur, mention d'indépendance affichée).

## Ce qui manque avant de publier

1. **Décision d'Ibrahim** : créer le compte développeur (5 $) au nom de l'entreprise, avec l'adresse de contact de l'éditeur. Vérification d'identité et, pour un éditeur professionnel, statut de « professionnel » (DSA) avec adresse et téléphone publics.
2. **Domaine et API de production** : adresse publique de l'API (`https://api.<domaine>`) pour `EXTENSION_API_ORIGIN` et `VITE_DEFAULT_API_BASE_URL`, et domaine du site pour l'adresse de la politique de confidentialité (`SITE_ORIGIN`, voir docs/VITRINE.md).
3. **Avocat** : version définitive de la politique de confidentialité (et de l'adresse de contact).
4. **Captures** (`store/captures.md`) et vignette 440 × 280.
5. **Validation sur le site réel** : les adaptateurs de page sont construits sur des fixtures et testés sur un vrai compte ; la description dit « expérimentale ». Publier d'abord en « Non répertoriée » pour la bêta fermée.
6. Adresse email d'assistance (fiche et politique).

## Procédure complète (le jour de la décision)

1. **Paquet de publication**
   ```bash
   VITE_DEFAULT_API_BASE_URL=https://api.<domaine> EXTENSION_API_ORIGIN=https://api.<domaine> pnpm extension:pack
   ```
   Aucun avertissement ne doit rester. Noter l'empreinte SHA-256 affichée.
2. **Version** : la version publiée vient de `apps/extension/package.json` (recopiée dans le manifeste par `scripts/finalize.mjs`). Chaque envoi au store exige une version plus grande que la précédente.
3. **Compte** : https://chrome.google.com/webstore/devconsole — compte Google de l'entreprise, frais d'inscription payés (après accord écrit d'Ibrahim), validation de l'identité et de l'adresse de contact.
4. **Nouvel élément** : « Ajouter un élément », envoyer `selio-extension-<version>.zip`.
5. **Fiche** (« Store listing ») : titre, résumé, description et catégorie depuis `store/listing.md` ; langue français ; icône 128 (`public/icons/icon-128.png`) ; captures et vignette (`store/captures.md`) ; site et adresse d'assistance.
6. **Confidentialité** (« Privacy practices ») : objectif unique, justification de `storage`, `activeTab`, des domaines Vinted et de l'autorisation facultative, « code distant : non », cases des données collectées et les trois engagements, depuis `store/justifications.md` ; adresse de la politique : `https://<domaine>/extension/confidentialite`.
7. **Distribution** : « Non répertoriée » pour la bêta fermée ; régions France et Belgique d'abord ; gratuit (l'abonnement se paie dans Selio, jamais dans le store).
8. **Envoyer pour examen.** Une autorisation facultative large (`https://*/*`) déclenche souvent un examen approfondi : c'est pourquoi `EXTENSION_API_ORIGIN` est conseillé. Délai habituel : quelques jours.
9. **Après publication** : reporter l'identifiant de l'extension et le lien de la fiche dans `docs/EXTENSION-INSTALL.md` et sur la page `/extension` (remplacer « Pas encore publiée »), puis mettre à jour `docs/BUILD_STATUS.md`.

### Mise à jour d'une version publiée

Augmenter `version` dans `apps/extension/package.json`, relancer `pnpm extension:pack` avec les mêmes variables, envoyer le nouveau ZIP dans le tableau de bord (« Paquet » › « Importer un nouveau paquet »). Une nouvelle permission impose de mettre à jour `store/justifications.md` **et** `ALLOWED_PERMISSIONS` (le paquet est refusé sinon), et Chrome redemandera l'accord aux utilisateurs.

## Ce que la fiche ne dira jamais

Ni « officielle », ni « partenaire de Vinted », ni « sans risque » ; pas de logo Vinted ni de couleurs qui prêtent à confusion ; le mot « Vinted » n'est pas dans le titre. Les tests (`apps/web/src/marketing/seo.test.ts`) relisent les textes de la fiche à la recherche de ces promesses.

## Vérifier

```bash
pnpm --filter @selio/extension typecheck
pnpm --filter @selio/extension test     # test/pack.test.ts : manifeste, justifications, fiche, archive
pnpm --filter @selio/extension build
pnpm extension:pack
```
