#!/bin/bash
# Découpe le film de 80 s en clips courts (réseaux sociaux) à partir des sous-images rendues (frames/) et de mix.wav :
# chaque clip = un passage du film (fondu d'entrée 0,3 s) + fondu croisé 0,25 s + carte de fin (77 → 80 s : logo,
# « Rejoins la bêta fermée », lien en bio). Même qualité que le film (flou de mouvement, H.264 crf 19, −14 LUFS).
#   ./clips.sh            → ../clips/Selio-clip-NN-<nom>.mp4
set -euo pipefail
cd "$(dirname "$0")"
OUT=../clips; mkdir -p "$OUT"
E0=77.0; E1=80.0; X=0.25; I=-14
CLIPS=(
  "01-accroche 0.0 6.55"
  "02-track 6.6 13.5"
  "03-radar 13.5 24.5"
  "04-controle 24.5 31.0"
  "05-studio 31.0 44.5"
  "06-publication-dressing 44.5 54.5"
  "07-ventes 54.5 63.5"
  "08-automatisation-gestion 63.5 73.3"
)
g() { echo "$M" | python3 -c "import json,sys;print(json.load(sys.stdin)['$1'])"; }
for spec in "${CLIPS[@]}"; do
  set -- $spec; name=$1; A=$2; B=$3
  D=$(python3 -c "print($B-$A)"); OFF=$(python3 -c "print($B-$A-$X)")
  SA=$(python3 -c "print(int(round($A*240)))"); NA=$(python3 -c "print(int(round(($B-$A)*240)))")
  SE=$(python3 -c "print(int(round($E0*240)))"); NE=$(python3 -c "print(int(round(($E1-$E0)*240)))")
  TMP=$(mktemp -d)
  # 1. piste audio du clip (passage + carte de fin), puis mesure pour la normalisation en deux passes
  ffmpeg -hide_banner -loglevel error -y -i mix.wav -filter_complex \
    "[0:a]atrim=start=$A:end=$B,asetpts=PTS-STARTPTS,afade=t=in:d=0.3[a0];[0:a]atrim=start=$E0:end=$E1,asetpts=PTS-STARTPTS[a1];[a0][a1]acrossfade=d=$X[a]" \
    -map "[a]" "$TMP/a.wav"
  M=$(ffmpeg -hide_banner -nostats -i "$TMP/a.wav" -af loudnorm=I=$I:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
  AF="loudnorm=I=$I:TP=-1.5:LRA=11:measured_I=$(g input_i):measured_TP=$(g input_tp):measured_LRA=$(g input_lra):measured_thresh=$(g input_thresh):offset=$(g target_offset):linear=true,aresample=48000"
  # 2. image : moyenne des 8 sous-images (flou de mouvement), fondu d'entrée, fondu croisé vers la carte de fin
  ffmpeg -hide_banner -loglevel error -y \
    -framerate 240 -start_number $SA -i frames/s%06d.jpg -framerate 240 -start_number $SE -i frames/s%06d.jpg -i "$TMP/a.wav" \
    -filter_complex "[0:v]trim=end_frame=$NA,tmix=frames=8,select='eq(mod(n\,8)\,7)',setpts=N/(30*TB),fade=t=in:st=0:d=0.3[v0];[1:v]trim=end_frame=$NE,tmix=frames=8,select='eq(mod(n\,8)\,7)',setpts=N/(30*TB)[v1];[v0][v1]xfade=transition=fade:duration=$X:offset=$OFF,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v];[2:a]$AF[a]" \
    -map "[v]" -map "[a]" -r 30 -c:v libx264 -preset slow -crf 19 -maxrate 9M -bufsize 18M -profile:v high -level 4.2 -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -g 60 -bf 2 \
    -c:a aac -b:a 192k -ar 48000 -movflags +faststart "$OUT/Selio-clip-$name.mp4"
  rm -rf "$TMP"
  echo "clip $name : $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/Selio-clip-$name.mp4") s"
done
echo "clips ok"
