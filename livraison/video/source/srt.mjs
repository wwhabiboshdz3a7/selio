// Sous-titres SRT de la voix off, tirés de la timeline (mêmes instants que le karaoké).
import { readFileSync, writeFileSync } from "node:fs";
const HERE = new URL(".", import.meta.url).pathname;
const TL = JSON.parse(readFileSync(`${HERE}timeline.json`, "utf8"));
const chunks = TL.CAPS.map((c) => ({ start: c.words.find((w) => w[0] !== "\n")[1], out: c.out, text: c.words.map((w) => w[0]).join(" ").replace(/ ?\n ?/g, "\n") }));
const tail = TL.VO_TAIL.words;
chunks.push({ start: tail[0][1], out: 32.0, text: tail.slice(0, 4).map((w) => w[0]).join(" ") }, { start: tail[4][1], out: TL.VO_TAIL.out, text: tail.slice(4).map((w) => w[0]).join(" ") });
chunks.sort((a, b) => a.start - b.start);
const ts = (s) => { const ms = Math.round(s * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`; };
const srt = chunks.map((c, i) => { const end = Math.min(c.out, i + 1 < chunks.length ? chunks[i + 1].start - 0.05 : c.out, TL.DURATION); return `${i + 1}\n${ts(Math.max(0, c.start - 0.05))} --> ${ts(end)}\n${c.text}\n`; }).join("\n");
writeFileSync(`${HERE}../Selio-video-35s.srt`, srt);
console.log(srt.split("\n\n").length, "sous-titres");
