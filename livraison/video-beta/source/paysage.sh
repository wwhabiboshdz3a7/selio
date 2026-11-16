#!/bin/bash
# Version 16:9 (1920 × 1080) d'une vidéo verticale, pour YouTube, le site ou une présentation : la vidéo est centrée,
# et les côtés sont remplis par la même image agrandie, floutée et assombrie. Son recopié tel quel.
#   ./paysage.sh ../Selio-beta-80s.mp4 ../Selio-beta-80s-16x9.mp4
set -euo pipefail
IN="$1"; OUT="$2"
ffmpeg -hide_banner -loglevel error -y -i "$IN" -filter_complex \
  "[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,boxblur=luma_radius=48:luma_power=2:chroma_radius=24:chroma_power=2,eq=brightness=-0.18:saturation=1.15[bg];[0:v]scale=-2:1080:flags=lanczos[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]" \
  -map "[v]" -map 0:a -r 30 -c:v libx264 -preset slow -crf 19 -maxrate 9M -bufsize 18M -profile:v high -level 4.2 -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -g 60 -bf 2 \
  -c:a copy -movflags +faststart "$OUT"
echo "$OUT : $(ffprobe -v error -show_entries stream=width,height -of csv=p=0 "$OUT" | head -1)"
