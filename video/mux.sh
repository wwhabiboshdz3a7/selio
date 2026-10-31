#!/usr/bin/env bash
# Assemble la vidéo muette et la bande-son, avec normalisation de sonie (−16 LUFS, crête −1,5 dBTP).
#   ./mux.sh out/video60_noaudio.mp4 audio/mix.wav out/selio-pub-60s.mp4
set -euo pipefail
cd "$(dirname "$0")"
VIDEO="${1:-out/video60_noaudio.mp4}"
AUDIO="${2:-audio/mix.wav}"
OUT="${3:-out/selio-pub-60s.mp4}"
# passe 1 : mesure ; passe 2 : normalisation linéaire avec les valeurs mesurées (plus fidèle qu'une seule passe)
read -r I TP LRA TH < <(ffmpeg -hide_banner -i "$AUDIO" -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 \
  | python3 -c "import sys,json,re; j=json.loads(re.search(r'\{.*\}', sys.stdin.read(), re.S).group(0)); print(j['input_i'], j['input_tp'], j['input_lra'], j['input_thresh'])")
ffmpeg -y -hide_banner -loglevel error -i "$VIDEO" -i "$AUDIO" \
  -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 192k -ar 48000 \
  -af "loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=$I:measured_TP=$TP:measured_LRA=$LRA:measured_thresh=$TH:linear=true:print_format=summary" \
  -movflags +faststart -shortest "$OUT"
ffprobe -v error -show_entries format=duration,size:stream=codec_name,width,height,r_frame_rate,sample_rate,channels -of default=nw=1 "$OUT"
echo "→ $OUT"
