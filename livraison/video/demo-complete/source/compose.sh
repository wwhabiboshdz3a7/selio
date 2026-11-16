#!/usr/bin/env bash
# compose.sh <brut.mp4> <sortie.mp4> : écran 1600x900 centré sur fond sombre, sous-titres dans la bande du bas.
set -euo pipefail
IN="$1"; OUT="$2"; CAPS="${IN%.mp4}.caps.json"; BASE="${OUT%.mp4}"
node - "$CAPS" "$BASE" <<'EOF'
const fs = require('fs');
const [caps, base] = process.argv.slice(2);
const list = JSON.parse(fs.readFileSync(caps, 'utf8'));
const ts = (t, sep) => { const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = Math.floor(t % 60), cs = Math.floor((t % 1) * (sep === ',' ? 1000 : 100)); return sep === ',' ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(cs).padStart(3,'0')}` : `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`; };
let ass = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Sous,Inter,40,&H00F3EBEE,&H00F3EBEE,&H00170F12,&H00170F12,0,0,0,0,100,100,0,0,1,0,0,2,190,190,46,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
let srt = '';
list.forEach((c, i) => {
  const dur = Math.min(9, Math.max(3.5, 1.6 + c.text.length * 0.062));
  // Le sous-titre ne déborde pas sur la page suivante : il s'arrête à son temps de lecture prévu.
  const end = Math.max(c.start + 0.5, Math.min((c.end ?? c.start + 4) - 0.08, c.start + dur + 0.25));
  ass += `Dialogue: 0,${ts(c.start, '.')},${ts(end, '.')},Sous,,0,0,0,,{\\fad(150,150)}${c.text.replace(/\n/g, '\\N')}\n`;
  srt += `${i + 1}\n${ts(c.start, ',')} --> ${ts(end, ',')}\n${c.text}\n\n`;
});
fs.writeFileSync(base + '.ass', ass);
fs.writeFileSync(base + '.srt', srt);
EOF
ffmpeg -v error -y -i "$IN" -filter_complex \
  "color=c=0x121017:s=1920x1080:r=30[bg];[0:v]scale=1600:900:flags=lanczos,format=yuv420p[sc];[bg][sc]overlay=160:14:shortest=1,drawbox=x=160:y=14:w=1600:h=900:color=0x2A2438:t=2,subtitles=${BASE}.ass:fontsdir=/usr/share/fonts/opentype/inter" \
  -c:v libx264 -preset medium -crf 21 -pix_fmt yuv420p -movflags +faststart -an "$OUT"
