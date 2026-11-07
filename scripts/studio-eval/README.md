# Protocole de validation de Studio : `pnpm studio:eval`

Mesure, **sur nos propres photos**, ce que le modèle 1 lit réellement sur les étiquettes (marque, taille, matière, référence) et sur un mètre ruban photographié (mesures en cm), puis compare à la vérité terrain. Objectifs du plan (§5.11) : **au moins 95 % de marques et tailles justes** sur 200 photos d'étiquettes, **9 mesures sur 10 justes à 1 cm près** sur 50 articles. Tant qu'aucun rapport n'existe, l'interface et les documents disent « précision à mesurer » : rien n'est promis.

Le détail (structure du jeu, format des vérités, options, lecture du rapport, tableau à remplir) est dans [docs/STUDIO.md](../../docs/STUDIO.md), section 6. Ce fichier résume la marche à suivre sur la machine.

## Ce qui n'entre jamais dans le dépôt

Les photos, les vérités terrain et les rapports restent **hors de Git** (`.gitignore` de ce dossier) : seuls le code, les tests et les lignes d'exemple fictives de `exemple/` sont versionnés. Le script ne copie aucune photo, ne la réduit pas et n'écrit ni image, ni mot de passe, ni adresse email dans le rapport.

## Le jeu (hors du dépôt, par exemple `/srv/selio/studio-eval/`)

```
<dossier>/
  etiquettes/
    verite.csv            photo;brand;size;material;reference
    etiquette-001.jpg …   200 photos d'étiquettes, réduites (côté long ≤ 1 024 px, JPEG ≈ 80, ≤ 1 Mo)
  mesures/
    verite.csv            article;garmentKind;photos;chest;length;shoulders;sleeve;waist;hips;inseam;rise;sole
    a01-metre-1.jpg …     1 à 3 photos avec mètre ruban par article, séparées par « | » dans la colonne photos
```

Une cellule vide n'est pas évaluée ; toute colonne inconnue refuse le fichier ; une photo introuvable, en double ou trop grande écarte la ligne (listée dans le rapport, jamais devinée). Exemple des deux fichiers : `exemple/etiquettes/verite.csv` et `exemple/mesures/verite.csv`.

## Lancer

Depuis la racine du dépôt installé (`pnpm install`), sur la machine où tourne Ollama :

```bash
# Lecture directe par le service IA du dépôt (aucune base, aucun quota)
AI_PROVIDER=ollama OLLAMA_BASE_URL=http://10.0.0.5:11434 OLLAMA_VISION_MODEL=qwen3-vl:8b pnpm studio:eval /srv/selio/studio-eval

# Avec l'OCR d'essai, puis sans, pour mesurer son apport
AI_PROVIDER=ollama OLLAMA_BASE_URL=http://10.0.0.5:11434 OLLAMA_OCR_MODEL=<nom exact du modèle OCR> pnpm studio:eval /srv/selio/studio-eval
AI_PROVIDER=ollama OLLAMA_BASE_URL=http://10.0.0.5:11434 OLLAMA_OCR_MODEL=<nom exact du modèle OCR> pnpm studio:eval /srv/selio/studio-eval --no-ocr

# À travers l'API locale (toute la chaîne du serveur), avec un compte de l'équipe sur une organisation de test
STUDIO_EVAL_EMAIL=equipe@exemple.fr STUDIO_EVAL_PASSWORD=… STUDIO_EVAL_API_URL=http://127.0.0.1:8787 pnpm studio:eval /srv/selio/studio-eval --mode api
```

Options : `--only etiquettes|mesures`, `--limit n` (essai rapide), `--out rapport.md`, `--json` (détail de chaque lecture), `--no-ocr`, `--allow-mock` (simulateur : le rapport dit en tête qu'il **ne mesure rien**). Codes de sortie : 0 rapport écrit, 1 erreur (arguments, jeu, serveur injoignable), 2 rien n'a pu être évalué, 3 simulateur.

Le rapport Markdown daté va dans `rapports/` (ignoré par Git) : conditions, taux de justes, de fausses et de non lues par champ et par mesure, verdict de chaque objectif, lectures fausses, photos écartées, latence p50 / p95. Une valeur **fausse** est une invention du modèle (la seule vraie faute) ; une valeur vide avec une question au vendeur est honnête. Reporter le résultat dans le tableau « Mesures sur nos photos » de docs/STUDIO.md.

## Tests

`pnpm --filter @selio/studio-eval test` (simulateur, HTTP simulé, images factices : aucune vraie photo, aucun réseau) et `pnpm --filter @selio/studio-eval typecheck`. Les deux sont compris dans `pnpm test` et `pnpm typecheck` à la racine.
