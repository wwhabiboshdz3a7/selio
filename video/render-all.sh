#!/usr/bin/env bash
# Rendu complet en parallèle (N segments encodés séparément puis concaténés sans ré-encodage).
#   ./render-all.sh [workers=3] [timing=timing.json] [out=out/video_noaudio.mp4]
set -euo pipefail
cd "$(dirname "$0")"
WORKERS="${1:-3}"
TIMING="${2:-timing.json}"
OUT="${3:-out/video_noaudio.mp4}"
FPS=$(python3 -c "import json;print(json.load(open('$TIMING'))['fps'])")
DUR=$(python3 -c "import json;print(json.load(open('$TIMING'))['duration'])")
TOTAL=$(python3 -c "print(round($DUR*$FPS))")
mkdir -p out/segs
rm -f out/segs/*.mp4 out/segs/list.txt
pids=()
for ((w=0; w<WORKERS; w++)); do
  START=$(( TOTAL * w / WORKERS ))
  END=$(( TOTAL * (w+1) / WORKERS ))
  node render.cjs --render --timing "$TIMING" --start "$START" --end "$END" --out "out/segs/seg_$w.mp4" --fps "$FPS" --crf 17 --preset slow > "out/segs/seg_$w.log" 2>&1 &
  pids+=($!)
  echo "worker $w : frames $START → $END (pid ${pids[-1]})"
done
fail=0
for p in "${pids[@]}"; do wait "$p" || fail=1; done
if [ "$fail" -ne 0 ]; then echo "un segment a échoué :"; tail -n 5 out/segs/*.log; exit 1; fi
for ((w=0; w<WORKERS; w++)); do echo "file 'seg_$w.mp4'" >> out/segs/list.txt; done
ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i out/segs/list.txt -c copy -movflags +faststart "$OUT"
ffprobe -v error -show_entries format=duration:stream=nb_frames -of default=nw=1 "$OUT"
echo "→ $OUT"
