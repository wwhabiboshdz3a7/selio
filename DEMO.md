# Selio — démonstration en ligne

Le dossier `demo/` contient la démonstration de Selio, déjà construite : vitrine et application de gestion.
Toutes les données sont fictives. Aucun message n'est envoyé, aucun achat ni paiement n'est réalisé.
Les données de démonstration sont enregistrées dans le navigateur de chaque visiteur et peuvent être réinitialisées depuis l'application.

## Mettre la démo en ligne sur Netlify

**Option 1 — depuis cette branche (recommandé)**

1. Sur Netlify : *Add new site* → *Import an existing project* → choisir ce dépôt.
2. Choisir la branche `demo`.
3. Laisser les champs de build tels quels : `netlify.toml` indique de publier `demo/` sans build, sans dépendances et sans fonctions serveur.
4. Lancer le déploiement, puis ouvrir l'adresse fournie.

Créer un nouveau site Netlify pour la démo, plutôt que réutiliser celui de la branche `main`.

**Option 2 — glisser-déposer**

Ouvrir https://app.netlify.com/drop et y déposer le dossier `demo/` (ou l'archive `selio-demo.zip`).

## Parcourir la démo

- Page d'accueil : la vitrine (fonctionnalités, extension, assistant IA, tarifs, FAQ).
- Bouton « Voir la démo » ou adresse `/demo` : ouvre l'application avec une boutique fictive.
- Le bandeau « Démonstration — données fictives » reste visible dans l'application.
- L'accueil des espaces (`/app/espaces`) présente Selio Gestion, Selio Studio et les filiales en préparation.
- Fonctionne sur ordinateur, tablette et mobile, en mode clair ou sombre.

## Détails techniques

- `demo/_redirects` : toutes les adresses de l'application renvoient vers `index.html` (application monopage).
- `demo/_headers` : en-têtes de sécurité (CSP stricte, HSTS, interdiction d'intégration en iframe) et `noindex` pour que la démo ne soit pas référencée par les moteurs de recherche.
- Le site fonctionne hors ligne après la première visite (application web progressive).
