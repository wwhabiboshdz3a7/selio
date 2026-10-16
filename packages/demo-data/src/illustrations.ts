/**
 * Illustrations vectorielles des articles de démonstration (aucune photo
 * réelle ni image tierce) : silhouette du vêtement, couleur de l'article,
 * plusieurs « prises de vue » (face, dos, détail, étiquette, mesures).
 */

export type Silhouette = "tee" | "sweat" | "knit" | "shirt" | "jacket" | "puffer" | "pants" | "dress" | "skirt" | "sneaker" | "boot" | "bag" | "glasses" | "scarf" | "belt" | "box";

const COLOR_HEX: Record<string, string> = {
  noir: "#2B2B2E",
  blanc: "#F4F3EF",
  bleu: "#3D6FB4",
  "bleu marine": "#1F3256",
  "bleu ciel": "#8DB5DE",
  beige: "#D9C4A0",
  gris: "#9A9AA2",
  rouge: "#C2413A",
  vert: "#4F7A57",
  kaki: "#6F6B45",
  marron: "#7A5236",
  rose: "#E7A3B4",
  camel: "#C08A4E",
  jaune: "#E5C34B",
  écru: "#EDE6D6",
};

export function colorHex(name: string | undefined): string {
  return COLOR_HEX[(name ?? "").toLowerCase()] ?? "#8E8E96";
}

/** Choisit la silhouette d'après le nom de la pièce. */
export function silhouetteFor(name: string, category: string): Silhouette {
  const n = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const has = (...k: string[]) => k.some((x) => n.includes(x));
  if (has("doudoune", "parka", "nuptse")) return "puffer";
  if (has("veste", "blouson", "trench", "manteau", "jacket")) return "jacket";
  if (has("sweat", "hoodie", "capuche")) return "sweat";
  if (has("pull", "cardigan", "maille", "polaire")) return "knit";
  if (has("chemise", "blouse", "flanelle")) return "shirt";
  if (has("t-shirt", "tee", "polo", "pyjama")) return "tee";
  if (has("jean", "pantalon", "cargo", "501")) return "pants";
  if (has("robe")) return "dress";
  if (has("jupe")) return "skirt";
  if (has("bottine", "boots", "1460", "chelsea")) return "boot";
  if (has("basket", "running", "samba", "stan smith", "air max", "pegasus", "sneaker")) return "sneaker";
  if (has("sac", "cabas", "pliage")) return "bag";
  if (has("lunettes", "wayfarer")) return "glasses";
  if (has("echarpe")) return "scarf";
  if (has("ceinture")) return "belt";
  if (category === "shoes") return "sneaker";
  if (category === "bags") return "bag";
  if (category === "women") return "dress";
  return "tee";
}

function shade(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((n >> 16) & 255) + amount);
  const g = clamp(((n >> 8) & 255) + amount);
  const b = clamp((n & 255) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function shape(s: Silhouette, fill: string, dark: string): string {
  const stroke = `stroke="${dark}" stroke-width="3" stroke-linejoin="round"`;
  switch (s) {
    case "tee":
      return `<path d="M160 120 L205 98 Q240 122 275 98 L320 120 L378 178 L340 212 L320 196 L320 378 L160 378 L160 196 L140 212 L102 178 Z" fill="${fill}" ${stroke}/><path d="M205 98 Q240 132 275 98" fill="none" ${stroke}/>`;
    case "sweat":
      return `<path d="M160 128 L200 104 Q240 92 280 104 L320 128 L372 300 L338 310 L322 214 L322 372 L158 372 L158 214 L142 310 L108 300 Z" fill="${fill}" ${stroke}/><path d="M196 106 Q240 40 284 106 Q240 136 196 106 Z" fill="${shade(fill, -18)}" ${stroke}/><rect x="158" y="350" width="164" height="22" fill="${shade(fill, -14)}" ${stroke}/><path d="M228 120 L226 168 M252 120 L254 168" ${stroke} fill="none"/><rect x="198" y="250" width="84" height="44" rx="6" fill="${shade(fill, -10)}" ${stroke}/>`;
    case "knit":
      return `<path d="M160 120 L205 100 Q240 124 275 100 L320 120 L372 304 L338 314 L322 214 L322 376 L158 376 L158 214 L142 314 L108 304 Z" fill="${fill}" ${stroke}/>${[200, 226, 254, 280].map((x) => `<path d="M${x} 140 q8 20 0 40 q-8 20 0 40 q8 20 0 40 q-8 20 0 40 q8 20 0 30" fill="none" stroke="${shade(fill, -30)}" stroke-width="3"/>`).join("")}<rect x="158" y="356" width="164" height="20" fill="${shade(fill, -16)}" ${stroke}/>`;
    case "shirt":
      return `<path d="M160 118 L208 98 L240 130 L272 98 L320 118 L370 300 L338 310 L322 210 L322 380 L158 380 L158 210 L142 310 L110 300 Z" fill="${fill}" ${stroke}/><path d="M208 98 L230 150 L240 130 L250 150 L272 98" fill="${shade(fill, 12)}" ${stroke}/><path d="M240 132 L240 380" ${stroke}/>${[170, 210, 250, 290, 330].map((y) => `<circle cx="248" cy="${y}" r="4" fill="${dark}"/>`).join("")}`;
    case "jacket":
      return `<path d="M156 118 L206 96 L240 120 L274 96 L324 118 L374 312 L340 320 L326 214 L326 388 L154 388 L154 214 L140 320 L106 312 Z" fill="${fill}" ${stroke}/><path d="M206 96 L226 180 L240 120 L254 180 L274 96" fill="${shade(fill, -16)}" ${stroke}/><path d="M240 122 L240 388" ${stroke}/><rect x="176" y="270" width="40" height="34" rx="4" fill="${shade(fill, -12)}" ${stroke}/><rect x="264" y="270" width="40" height="34" rx="4" fill="${shade(fill, -12)}" ${stroke}/>`;
    case "puffer":
      return `<path d="M150 118 L204 94 Q240 84 276 94 L330 118 L378 318 L342 328 L328 214 L328 384 L152 384 L152 214 L138 328 L102 318 Z" fill="${fill}" ${stroke}/>${[160, 210, 260, 310, 352].map((y) => `<path d="M154 ${y} Q240 ${y + 14} 326 ${y}" fill="none" stroke="${shade(fill, -28)}" stroke-width="3"/>`).join("")}<path d="M240 96 L240 384" stroke="${shade(fill, 40)}" stroke-width="4"/><path d="M204 94 Q240 70 276 94 L276 112 Q240 98 204 112 Z" fill="${shade(fill, -20)}" ${stroke}/>`;
    case "pants":
      return `<path d="M168 96 L312 96 L330 392 L262 392 L240 186 L218 392 L150 392 Z" fill="${fill}" ${stroke}/><rect x="168" y="96" width="144" height="22" fill="${shade(fill, -16)}" ${stroke}/><path d="M240 118 L240 186" ${stroke}/><path d="M178 132 Q200 150 214 128 M302 132 Q280 150 266 128" fill="none" stroke="${shade(fill, 30)}" stroke-width="3"/>`;
    case "dress":
      return `<path d="M206 96 L218 70 M274 96 L262 70" ${stroke}/><path d="M204 96 L276 96 L288 168 L352 392 L128 392 L192 168 Z" fill="${fill}" ${stroke}/><path d="M192 168 Q240 184 288 168" fill="none" stroke="${shade(fill, -26)}" stroke-width="4"/>${[230, 290, 350].map((y) => `<path d="M${170 - (y - 230) / 5} ${y} Q240 ${y + 10} ${310 + (y - 230) / 5} ${y}" fill="none" stroke="${shade(fill, 22)}" stroke-width="2"/>`).join("")}`;
    case "skirt":
      return `<path d="M188 130 L292 130 L346 370 L134 370 Z" fill="${fill}" ${stroke}/><rect x="188" y="116" width="104" height="18" fill="${shade(fill, -16)}" ${stroke}/>${[160, 200, 240, 280, 320].map((x) => `<path d="M${x + (x - 240) * 0.05} 136 L${x + (x - 240) * 0.45} 368" stroke="${shade(fill, -22)}" stroke-width="2"/>`).join("")}`;
    case "sneaker":
      return `<path d="M86 300 Q96 238 168 232 L228 196 Q262 186 284 214 L330 252 Q392 262 402 302 L402 322 L86 322 Z" fill="${fill}" ${stroke}/><path d="M86 322 L402 322 L402 342 Q240 352 86 342 Z" fill="${shade(fill, fill === "#F4F3EF" ? -40 : 60)}" ${stroke}/><path d="M200 236 L270 224 M210 250 L282 238 M222 264 L292 252" stroke="${dark}" stroke-width="4" stroke-linecap="round"/><path d="M140 290 Q220 270 300 300" fill="none" stroke="${shade(fill, -40)}" stroke-width="6" stroke-linecap="round"/>`;
    case "boot":
      return `<path d="M172 108 L258 108 L262 262 Q336 270 368 304 L368 336 L166 336 Z" fill="${fill}" ${stroke}/><path d="M166 336 L368 336 L368 360 L166 360 Z" fill="${shade(fill, -30)}" ${stroke}/><path d="M166 348 L368 348" stroke="#E5C34B" stroke-width="3" stroke-dasharray="6 6"/>${[140, 170, 200, 230].map((y) => `<circle cx="248" cy="${y}" r="5" fill="none" stroke="${shade(fill, 60)}" stroke-width="3"/>`).join("")}<rect x="172" y="108" width="86" height="14" fill="${shade(fill, -20)}"/>`;
    case "bag":
      return `<path d="M178 190 Q178 110 240 110 Q302 110 302 190" fill="none" stroke="${dark}" stroke-width="12" stroke-linecap="round"/><path d="M126 190 L354 190 L376 380 L104 380 Z" fill="${fill}" ${stroke}/><path d="M126 190 L240 250 L354 190" fill="${shade(fill, -14)}" ${stroke}/><circle cx="240" cy="252" r="8" fill="${shade(fill, 50)}" ${stroke}/>`;
    case "glasses":
      return `<circle cx="172" cy="240" r="62" fill="${shade(fill, -10)}" ${stroke} fill-opacity="0.85"/><circle cx="308" cy="240" r="62" fill="${shade(fill, -10)}" ${stroke} fill-opacity="0.85"/><path d="M234 236 Q240 222 246 236" fill="none" stroke="${dark}" stroke-width="8"/><path d="M110 226 L64 210 M370 226 L416 210" stroke="${dark}" stroke-width="8" stroke-linecap="round"/><path d="M146 212 Q160 202 176 206" stroke="#fff" stroke-width="5" stroke-opacity="0.5" fill="none"/>`;
    case "scarf":
      return `<path d="M120 140 Q240 100 360 140 L360 200 Q240 160 120 200 Z" fill="${fill}" ${stroke}/><path d="M300 180 L340 380 L290 380 L262 190 Z" fill="${shade(fill, -12)}" ${stroke}/>${[300, 312, 324, 336].map((x) => `<path d="M${x - 4} 380 L${x - 4} 404" stroke="${dark}" stroke-width="3"/>`).join("")}<path d="M120 170 Q240 130 360 170" fill="none" stroke="${shade(fill, 30)}" stroke-width="3" stroke-dasharray="10 8"/>`;
    case "belt":
      return `<rect x="70" y="214" width="340" height="52" rx="10" fill="${fill}" ${stroke}/><rect x="96" y="204" width="70" height="72" rx="10" fill="none" stroke="#C9A64A" stroke-width="10"/>${[220, 260, 300, 340].map((x) => `<circle cx="${x}" cy="240" r="6" fill="${dark}"/>`).join("")}`;
    default:
      return `<rect x="130" y="140" width="220" height="200" rx="24" fill="${fill}" ${stroke}/>`;
  }
}

const BACKGROUNDS = ["#F5F5F7", "#EDE8E1", "#E7ECF2", "#F1EDE4", "#E9EFE8", "#F4ECEC", "#ECEAF3", "#EFEFEF"];

/**
 * Une « photo » de démonstration : vue 0 = face, 1 = dos, 2 = détail matière,
 * 3 = étiquette, 4 = à plat sur fond bois, 5+ = vues alternatives.
 */
export function illustration(opts: { silhouette: Silhouette; color: string; brand: string | null; view: number; seed: number }): string {
  const fill = colorHex(opts.color);
  const dark = shade(fill, fill === "#F4F3EF" ? -120 : -70);
  const bg = BACKGROUNDS[(opts.seed + opts.view) % BACKGROUNDS.length]!;
  const v = opts.view % 8;
  let body = shape(opts.silhouette, fill, dark);
  let extra = "";
  if (v === 1) body = `<g transform="translate(480 0) scale(-1 1)">${body}</g>`;
  if (v === 2) body = `<g transform="translate(-200 -180) scale(1.8)">${body}</g>`;
  if (v === 3) {
    body = `<g transform="translate(-120 -60) scale(1.5)" opacity="0.9">${body}</g>`;
    extra = `<g transform="rotate(-6 240 260)"><rect x="150" y="190" width="180" height="120" rx="8" fill="#FBFAF7" stroke="#C9C6BE" stroke-width="2"/><text x="240" y="238" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="600" fill="#2B2B2E">${(opts.brand ?? "MARQUE").toUpperCase().slice(0, 16).replace(/&/g, "&amp;").replace(/</g, "")}</text><text x="240" y="272" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="15" fill="#71717A">Étiquette · démo</text></g>`;
  }
  if (v === 4) extra = `<g opacity="0.18">${[60, 140, 220, 300, 380, 460].map((y) => `<path d="M0 ${y} Q240 ${y + 18} 480 ${y}" stroke="#7A5236" stroke-width="2" fill="none"/>`).join("")}</g>`;
  if (v === 5) body = `<g transform="translate(40 30) scale(0.84) rotate(-8 240 240)">${body}</g>`;
  if (v === 6) extra = `<path d="M110 110 L370 110" stroke="#C4501B" stroke-width="3" stroke-dasharray="8 6"/><text x="240" y="100" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="16" fill="#C4501B">mesures à plat</text>`;
  if (v === 7) body = `<g transform="translate(-60 -60) scale(1.25)">${body}</g>`;
  const back = v === 4 ? "#E9DFD1" : bg;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 480 480"><rect width="480" height="480" fill="${back}"/>${extra && v === 4 ? extra : ""}<ellipse cx="240" cy="420" rx="170" ry="16" fill="#000" opacity="0.06"/>${body}${extra && v !== 4 ? extra : ""}</svg>`;
}

export function illustrationUrl(opts: Parameters<typeof illustration>[0]): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(illustration(opts))}`;
}
