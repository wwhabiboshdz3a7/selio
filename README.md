# Selio — stack "maison" (GitHub + Netlify + Supabase)

Code 100% possede par toi : aucun outil tiers ne liste ou n'heberge ce site
a ta place. Tu crees les comptes (gratuits), tu restes proprietaire du
depot GitHub, du site Netlify et de la base Supabase.

## Architecture

- **Frontend** : React 19 + Vite, appli monopage (SPA), charte Selio integree.
- **Backend** : Netlify Functions (dossier `netlify/functions/`), une fonction
  par route d'API (`/api/auth/login`, `/api/listings`, etc.).
- **Base de donnees** : PostgreSQL chez Supabase (gratuit) — schema dans
  `supabase/schema.sql`.
- **Photos** : Supabase Storage (bucket `listings`, lecture publique).
- **Comptes/sessions** : systeme maison (mot de passe hache avec scrypt,
  cookie de session), aucune dependance a un fournisseur d'identite externe.
- **Paiement** : aucun paiement reel. Bouton desactive sur la fiche annonce,
  table `escrow_stub` prete a accueillir une vraie integration plus tard
  (ex: Stripe Connect).

## Mise en route (a faire une seule fois)

### 1. Supabase (base de donnees + photos) — ~5 min

1. Va sur https://supabase.com → "Start your project" → cree un compte
   gratuit (avec GitHub ou email).
2. "New project" → choisis un nom (ex. `selio`), un mot de passe de base de
   donnees (note-le), une region proche de toi → "Create new project"
   (patiente ~2 min que le projet soit pret).
3. Menu de gauche → **SQL Editor** → "New query" → colle tout le contenu du
   fichier `supabase/schema.sql` de ce dossier → "Run". Ca cree toutes les
   tables (comptes, annonces, messages, favoris...).
4. Menu de gauche → **Storage** → "Create a new bucket" → nom exact :
   `listings` → coche **Public bucket** → "Create bucket".
5. Menu de gauche → **Project Settings** (icone engrenage) → **API** → note
   deux valeurs, tu en auras besoin a l'etape Netlify :
   - **Project URL** (ex. `https://abcdefgh.supabase.co`)
   - **service_role key** (sous "Project API keys" — clique "Reveal", c'est
     une longue chaine commencant par `eyJ...`). Cette cle est secrete,
     ne la partage jamais publiquement.

### 2. GitHub (heberger le code) — ~5 min

1. Va sur https://github.com → cree un compte gratuit si tu n'en as pas.
2. Clique le "+" en haut a droite → "New repository" → nom `selio` →
   laisse "Public" ou choisis "Private" (les deux fonctionnent) → ne coche
   aucune case d'initialisation → "Create repository".
3. Le plus simple sans ligne de commande : installe **GitHub Desktop**
   (https://desktop.github.com), connecte-toi, "Add" → "Add existing
   repository" → selectionne ce dossier `selio` sur ton ordinateur →
   "Publish repository" (decoche "Keep this code private" si tu veux un
   depot public, ou laisse coche sinon).
   - Si tu preferes la ligne de commande, depuis ce dossier :
     ```
     git init
     git add .
     git commit -m "Selio MVP"
     git branch -M main
     git remote add origin https://github.com/TON-COMPTE/selio.git
     git push -u origin main
     ```

### 3. Netlify (heberger le site + l'API) — ~5 min

1. Va sur https://netlify.com → cree un compte gratuit (le plus simple :
   "Sign up with GitHub", ca connecte directement les deux).
2. "Add new site" → "Import an existing project" → "Deploy with GitHub" →
   autorise Netlify a acceder a ton depot `selio` → selectionne-le.
3. Netlify detecte automatiquement les reglages grace a `netlify.toml`
   (commande `npm run build`, dossier `dist`, fonctions dans
   `netlify/functions`) — tu n'as rien a changer. Avant de cliquer sur
   "Deploy", ouvre "Add environment variables" et ajoute :
   - `SUPABASE_URL` → l'URL notee a l'etape Supabase
   - `SUPABASE_SERVICE_ROLE_KEY` → la cle service_role notee a l'etape Supabase
4. Clique "Deploy selio". Au bout de 1-2 minutes, ton site est en ligne a
   une adresse du type `https://selio-xyz123.netlify.app`.
5. (Optionnel) "Site configuration" → "Change site name" pour choisir une
   adresse plus lisible (ex. `selio-app.netlify.app`), ou "Domain management"
   pour brancher un nom de domaine que tu possedes.

## Ce que tu dois faire vs ce que je peux faire

- **Toi** : creer les 3 comptes gratuits (Supabase, GitHub, Netlify) — ce
  sont des comptes personnels, je ne peux pas les creer a ta place.
- **Moi** : une fois que tu m'auras partage l'URL Netlify (et, si tu veux
  que je verifie/debugge, un acces en lecture au depot GitHub ou les logs
  de build Netlify en cas d'erreur), je peux tester toutes les fonctionnalites
  (inscription, annonces, recherche, messagerie) comme je l'ai fait pour la
  precedente version, et corriger si besoin.

## Installation en PWA (une fois le site en ligne)

- **Android (Chrome)** : ouvrir le site → menu ⋮ → "Installer l'application".
- **iPhone (Safari)** : ouvrir le site → bouton Partager → "Sur l'ecran d'accueil".

## Developpement local (optionnel, si tu as Node.js installe)

```
npm install
npm install -g netlify-cli
netlify dev
```

`netlify dev` lance le site ET les fonctions API ensemble sur
`http://localhost:8888` (necessite le fichier `.env` rempli, voir
`.env.example`).
