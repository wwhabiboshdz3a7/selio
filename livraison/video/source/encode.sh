#!/bin/bash
# encode.sh <audio.wav> <sortie.mp4> <LUFS cible>
# Moyenne les 8 sous-images de chaque image (flou de mouvement), puis H.264 + AAC, volume normalisé en deux passes.
set -euo pipefail
A="$1"; OUT="$2"; I="${3:--14}"
M=$(ffmpeg -hide_banner -nostats -i "$A" -af loudnorm=I=$I:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
g() { echo "$M" | python3 -c "import json,sys;print(json.load(sys.stdin)['$1'])"; }
AF="loudnorm=I=$I:TP=-1.5:LRA=11:measured_I=$(g input_i):measured_TP=$(g input_tp):measured_LRA=$(g input_lra):measured_thresh=$(g input_thresh):offset=$(g target_offset):linear=true,aresample=48000"
ffmpeg -hide_banner -loglevel error -y -framerate 240 -i frames/s%06d.jpg -i "$A" \
  -vf "tmix=frames=8,select='eq(mod(n\,8)\,7)',setpts=N/(30*TB),scale=out_color_matrix=bt709:out_range=tv,format=yuv420p" -r 30 \
  -c:v libx264 -preset slow -crf 20 -maxrate 9M -bufsize 18M -profile:v high -level 4.2 -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -g 60 -bf 2 \
  -af "$AF" -c:a aac -b:a 192k -ar 48000 -shortest -movflags +faststart "$OUT"
