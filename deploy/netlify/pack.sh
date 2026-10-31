#!/usr/bin/env bash
# Construit la vitrine + l'application (mode démonstration si VITE_API_BASE_URL est vide)
# et produit une archive prête à glisser sur https://app.netlify.com/drop
# Usage : deploy/netlify/pack.sh [chemin/de/sortie.zip]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$ROOT/livraison/selio-demo-netlify.zip}"
cd "$ROOT"
pnpm build:web
STAGE="$(mktemp -d)"
cp -R apps/web/dist/. "$STAGE/"
cp deploy/netlify/_headers deploy/netlify/_redirects "$STAGE/"
mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
(cd "$STAGE" && zip -qr -X "$OUT" .)
rm -rf "$STAGE"
echo "Archive prête : $OUT"
