# Selio — stack "maison" (GitHub + Netlify + Supabase)

Code 100% possede par toi : aucun outil tiers ne liste ou n'heberge ce site
a ta place. Tu crees les comptes (gratuits), tu restes proprietaire du
depot GitHub, du site Netlify et de la base Supabase.

## Architecture

- **Frontend** : React 19 + Vite, appli monopage (SPA), charte Selio integree,
  avec une scene 3D (Three.js) et des effets de survol 3D (cartes "premium").
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
- **Mobile** : une deuxieme application (Expo/React Native, dossier
  `selio-mobile/` a cote de celui-ci) se connecte a la meme API et a la meme
  base de donnees — voir son propre README.

## Espace "Selio Pro" (gestion de revente) — nouveau

Accessible depuis `/pro` une fois connecte. Fonctionnalites :

- **Comptes de vente** (`/pro/accounts`) : organise ton suivi par canal
  (Vinted, Selio...).
- **Dressing & stock** (`/pro/wardrobe`) : journal d'inventaire (achats,
  statut en stock / en vente / vendu / archive).
- **Ventes & comptabilite** (`/pro/sales`) : enregistrement des ventes
  (prix, frais, port, marge) + **export Excel (XLSX)** en un clic.
- **Automatisations** (`/pro/automation`) : regles configurables — message
  automatique a la mise en favori, relance si pas de reponse, negociation
  automatique selon une marge autorisee, message apres-vente (avec jour
  d'envoi : "demain" ou le jour exact), republication automatique d'une
  annonce vendue. Elles tournent **automatiquement toutes les 15 minutes**
  via une Netlify Scheduled Function (gratuite), sans action de ta part.
- **Communaute** (`/pro/community`) : espaces type "Discord interne" —
  creer/rejoindre un espace, publier des docs/annonces (les docs et cadeaux
  sont reserves aux admins de l'espace), classement des vendeurs.
- **Retouche photo automatique** : amelioration locale et gratuite des
  photos (luminosite, contraste, nettete) via la librairie `sharp` —
  disponible comme point de depart technique (endpoint
  `/api/pro/photo-enhance`), pas encore branche sur un bouton dans
  l'interface de vente pour cette version.

### Limites honnetes a connaitre

- **Vinted n'a pas d'API publique pour les vendeurs.** Les automatisations
  ci-dessus agissent uniquement sur les donnees de **ton site Selio**
  (favoris, messages, ventes enregistrees ici) — elles ne se connectent a
  aucun vrai compte Vinted et ne publient rien automatiquement dessus. Une
  vraie integration necessiterait de l'automatisation de navigateur
  (scraping) sur le site de Vinted, ce qui violerait ses conditions
  d'utilisation et risquerait un bannissement de compte : ce choix a ete
  fait deliberement pour rester legal et fiable.
- **La "retouche photo" n'est pas de l'IA generative.** C'est un traitement
  d'image classique (recadrage, luminosite, contraste), gratuit et sans cle
  API. Generer de vraies photos (fond studio recree, mise en scene) avec de
  l'IA necessiterait une cle API payante (OpenAI, Replicate...) a connecter
  plus tard.
- **L'app mobile (Expo) n'est pas publiee sur l'App Store / Google Play.**
  Elle se teste immediatement via l'app gratuite "Expo Go" sur un
  telephone — publier sur les stores necessite des comptes developpeur
  payants (Apple : 99 $/an, Google : 25 $ une fois), non crees ici.
- **Tout reste gratuit.** Supabase, Netlify et GitHub ont des paliers
  gratuits suffisants pour une demo ; aucune cle payante n'est requise pour
  faire fonctionner l'ensemble des fonctionnalites ci-dessus.

## Mise en route (a faire une seule fois)

### 1. Supabase (base de donnees + photos) — ~5 min

1. Va sur https://supabase.com → "Start your project" → cree un compte
   gratuit (avec GitHub ou email).
2. "New project" → choisis un nom (ex. `selio`), un mot de passe de base de
   donnees (note-le), une region proche de toi → "Create new project"
   (patiente ~2 min que le projet soit pret).
3. Menu de gauche → **SQL Editor** → "New query" → colle tout le contenu du
   fichier `supabase/schema.sql` de ce dossier → "Run". Ca cree toutes les
   tables (comptes, annonces, messages, favoris, et les tables de l'espace
   Pro : dressing, ventes, automatisations, communaute).
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
   La fonction d'automatisation (`automation-run`) est une **Netlify
   Scheduled Function** : elle se declenche toute seule toutes les 15
   minutes des que le site est deploye, gratuitement, sans configuration
   supplementaire de ta part.
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

## Application mobile

Le dossier `selio-mobile/` (a cote de celui-ci) contient une application
Android/iOS separee (Expo/React Native) qui parle a la meme API. Une fois
ce site deploye sur Netlify, ouvre `selio-mobile/app.json` et renseigne
l'URL Netlify — voir `selio-mobile/README.md` pour le detail.
# selio
