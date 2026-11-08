# Préparation Chrome Web Store

Tout ce qu'il faut pour publier l'extension, **sans rien publier** : la procédure complète est dans `docs/WEB-STORE.md`.

| Fichier | Contenu |
|---|---|
| `listing.md` | Titre, résumé, catégorie, description, liens, visibilité conseillée |
| `justifications.md` | Objectif unique, justification de chaque permission, code distant, données collectées, engagements |
| `privacy-policy.md` | Politique de confidentialité (même texte que la page `/extension/confidentialite` du site) |
| `captures.md` | Captures et vignette à fournir, avec leur format |

Paquet : `pnpm extension:pack` à la racine → `apps/extension/release/selio-extension-<version>.zip` et son empreinte SHA-256 (dossier ignoré par Git).
