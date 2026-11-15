// Sous-titres SRT tirés de la timeline (mêmes instants que les sous-titres incrustés). À lancer depuis le dossier source.
//   node ../../commun/srt.mjs ../../Selio-xxx.srt
import { readFileSync, writeFileSync } from "node:fs";
const HERE = process.cwd().replace(/\/?$/, "/");
const TL = JSON.parse(readFileSync(`${HERE}timeline.json`, "utf8"));
const chunks = TL.CAPS.map((c) => ({ start: c.words.find((w) => w[0] !== "\n")[1], out: c.out, text: c.words.map((w) => w[0]).join(" ").replace(/ ?\n ?/g, "\n") }));
chunks.sort((a, b) => a.start - b.start);
const ts = (s) => { const ms = Math.round(s * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`; };
const srt = chunks.map((c, i) => { const end = Math.min(c.out, i + 1 < chunks.length ? chunks[i + 1].start - 0.05 : c.out, TL.DURATION); return `${i + 1}\n${ts(Math.max(0, c.start - 0.05))} --> ${ts(end)}\n${c.text}\n`; }).join("\n");
writeFileSync(process.argv[2] ?? `${HERE}sous-titres.srt`, srt);
console.log(chunks.length, "sous-titres");
