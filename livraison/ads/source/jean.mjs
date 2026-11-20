// Photos d'exemple du jean (Selio Studio), dessinées en SVG : aucune photo ni logo de marque.
// Quatre vues au format 3:4 (600 × 800) : face, dos, étiquette (gros plan), mètre ruban (gros plan).
// Le jean est un exemple : ni logo, ni piqûres caractéristiques d'une marque.

const STITCH = "#d39a45";
const COPPER = "#b37a3c";

let uid = 0;

function defs(id) {
  return `<defs>
    <linearGradient id="den${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#55779f"/><stop offset=".55" stop-color="#46668f"/><stop offset="1" stop-color="#3a5880"/>
    </linearGradient>
    <pattern id="twill${id}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)">
      <rect width="6" height="6" fill="transparent"/><line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,255,255,.07)" stroke-width="2"/>
    </pattern>
    <filter id="grain${id}" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="4" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .22 0"/>
      <feComposite in2="SourceGraphic" operator="in"/>
    </filter>
    <filter id="floor${id}" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency=".012 .02" numOctaves="4" seed="9" result="a"/>
      <feTurbulence type="fractalNoise" baseFrequency=".7" numOctaves="2" seed="2" result="b"/>
      <feColorMatrix in="a" type="matrix" values="0 0 0 0 .52  0 0 0 0 .5  0 0 0 0 .48  0 0 0 .55 0" result="a2"/>
      <feColorMatrix in="b" type="matrix" values="0 0 0 0 .2  0 0 0 0 .2  0 0 0 0 .2  0 0 0 .25 0" result="b2"/>
      <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="a2"/><feMergeNode in="b2"/></feMerge>
    </filter>
    <filter id="shadow${id}" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="9"/><feOffset dy="8"/><feComponentTransfer><feFuncA type="linear" slope=".45"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="soft${id}"><feGaussianBlur stdDeviation="14"/></filter>
    <radialGradient id="vig${id}" cx=".5" cy=".45" r=".75"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></radialGradient>
    <linearGradient id="cop${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e2b57a"/><stop offset="1" stop-color="${COPPER}"/></linearGradient>
    <linearGradient id="tape${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6d33a"/><stop offset="1" stop-color="#e7b915"/></linearGradient>
  </defs>`;
}

const floor = (id) => `<rect width="600" height="800" fill="#8d8882"/><rect width="600" height="800" fill="#8d8882" filter="url(#floor${id})"/>`;
const vignette = (id) => `<rect width="600" height="800" fill="url(#vig${id})"/>`;

const SIL = "M150,110 L450,110 L466,262 L437,742 L316,742 L303,392 L297,392 L284,742 L163,742 L134,262 Z";

function denimBody(id) {
  return `<path d="${SIL}" fill="url(#den${id})"/>
  <path d="${SIL}" fill="url(#twill${id})"/>
  <path d="${SIL}" fill="#fff" filter="url(#grain${id})" opacity=".55"/>
  <g clip-path="url(#clip${id})" opacity=".2" filter="url(#soft${id})">
    <ellipse cx="215" cy="300" rx="45" ry="80" fill="#9fb6d4"/><ellipse cx="385" cy="300" rx="45" ry="80" fill="#9fb6d4"/>
    
    <path d="M250,250 l-40,12 M252,268 l-44,16 M348,250 l40,12 M346,268 l44,16" stroke="#b9cbe2" stroke-width="6"/>
  </g>
  <path d="M134,262 L163,742 M466,262 L437,742" stroke="rgba(20,35,60,.45)" stroke-width="3" fill="none"/>
  <path d="M297,392 L284,742 M303,392 L316,742" stroke="rgba(20,35,60,.35)" stroke-width="2" fill="none"/>
  <path d="M168,724 L282,724 M318,724 L432,724" stroke="${STITCH}" stroke-width="2.4" stroke-dasharray="7 5" fill="none"/>`;
}

function waistband(id) {
  const loops = [178, 244, 356, 422].map((x) => `<rect x="${x - 8}" y="104" width="16" height="48" rx="3" fill="#3d5b82"/><path d="M${x - 5},108 v40 M${x + 5},108 v40" stroke="${STITCH}" stroke-width="1.6" stroke-dasharray="4 4"/>`).join("");
  return `<path d="M150,110 L450,110 L453,146 L147,146 Z" fill="#3e5d85"/>
  <path d="M150,110 L450,110 L453,146 L147,146 Z" fill="url(#twill${id})"/>
  <path d="M152,117 L448,117 M149,140 L451,140" stroke="${STITCH}" stroke-width="2" stroke-dasharray="6 4" fill="none"/>
  ${loops}`;
}

function front(id) {
  return `${defs(id)}<clipPath id="clip${id}"><path d="${SIL}"/></clipPath>${floor(id)}
  <g filter="url(#shadow${id})" transform="translate(300 420) scale(1.12) translate(-300 -420)">${denimBody(id)}${waistband(id)}
    <path d="M168,150 Q200,238 258,148" stroke="rgba(20,35,60,.35)" stroke-width="2" fill="none"/>
    <path d="M172,152 Q203,232 252,150" stroke="${STITCH}" stroke-width="2" stroke-dasharray="6 4" fill="none"/>
    <path d="M432,150 Q400,238 342,148" stroke="rgba(20,35,60,.35)" stroke-width="2" fill="none"/>
    <path d="M428,152 Q397,232 348,150" stroke="${STITCH}" stroke-width="2" stroke-dasharray="6 4" fill="none"/>
    <path d="M372,150 L374,192 Q392,198 410,190 L408,152" stroke="${STITCH}" stroke-width="1.8" stroke-dasharray="5 4" fill="none"/>
    <path d="M318,146 L318,326 Q318,352 296,362" stroke="${STITCH}" stroke-width="2.2" stroke-dasharray="6 4" fill="none"/>
    <path d="M326,146 L326,330 Q324,360 298,372" stroke="${STITCH}" stroke-width="2.2" stroke-dasharray="6 4" fill="none"/>
    <circle cx="300" cy="128" r="10" fill="url(#cop${id})"/><circle cx="300" cy="128" r="4" fill="#8a5a2a"/>
    ${[[170, 152], [256, 149], [344, 149], [430, 152]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.5" fill="url(#cop${id})"/>`).join("")}
  </g>${vignette(id)}`;
}

function back(id) {
  return `${defs(id)}<clipPath id="clip${id}"><path d="${SIL}"/></clipPath>${floor(id)}
  <g filter="url(#shadow${id})" transform="translate(300 420) scale(1.12) translate(-300 -420)">${denimBody(id)}${waistband(id)}
    <path d="M140,196 L300,232 L460,196" stroke="rgba(20,35,60,.5)" stroke-width="3" fill="none"/>
    <path d="M141,203 L300,239 L459,203" stroke="${STITCH}" stroke-width="2" stroke-dasharray="6 4" fill="none"/>
    <path d="M300,232 L300,392" stroke="rgba(20,35,60,.45)" stroke-width="3"/>
    <path d="M182,250 L272,250 L268,352 L227,372 L186,352 Z" fill="#4a6b94" stroke="rgba(20,35,60,.5)" stroke-width="2"/>
    <path d="M188,256 L266,256 L262,348 L227,365 L192,348 Z" fill="none" stroke="${STITCH}" stroke-width="1.8" stroke-dasharray="5 4"/>
    <path d="M328,250 L418,250 L414,352 L373,372 L332,352 Z" fill="#4a6b94" stroke="rgba(20,35,60,.5)" stroke-width="2"/>
    <path d="M334,256 L412,256 L408,348 L373,365 L338,348 Z" fill="none" stroke="${STITCH}" stroke-width="1.8" stroke-dasharray="5 4"/>
    <rect x="362" y="112" width="70" height="30" rx="3" fill="#a77b4f"/><rect x="366" y="116" width="62" height="22" rx="2" fill="none" stroke="#7d5733" stroke-width="1.5"/>
  </g>${vignette(id)}`;
}

/** Gros plan de la ceinture, côté dos : patch (taille) et étiquette de composition. */
function label(id) {
  return `${defs(id)}${floor(id)}
  <g filter="url(#shadow${id})">
    <rect x="-20" y="90" width="640" height="720" fill="url(#den${id})"/><rect x="-20" y="90" width="640" height="720" fill="url(#twill${id})"/>
    <rect x="-20" y="90" width="640" height="720" fill="#fff" filter="url(#grain${id})" opacity=".5"/>
    <rect x="-20" y="90" width="640" height="150" fill="#3e5d85"/><rect x="-20" y="90" width="640" height="150" fill="url(#twill${id})"/>
    <path d="M-20,112 H620 M-20,218 H620" stroke="${STITCH}" stroke-width="4" stroke-dasharray="14 9"/>
    <rect x="70" y="80" width="56" height="190" rx="8" fill="#3a5880"/><path d="M84,90 v170 M112,90 v170" stroke="${STITCH}" stroke-width="3" stroke-dasharray="9 8"/>
    <g transform="rotate(-2 330 170)">
      <rect x="190" y="108" width="300" height="124" rx="6" fill="#a77b4f"/>
      <rect x="198" y="116" width="284" height="108" rx="4" fill="none" stroke="#7d5733" stroke-width="3"/>
      <text x="340" y="160" text-anchor="middle" font-family="Georgia, serif" font-size="34" font-weight="700" fill="#5a3b1c" letter-spacing="2">501</text>
      <text x="340" y="205" text-anchor="middle" font-family="Georgia, serif" font-size="30" font-weight="700" fill="#5a3b1c" letter-spacing="3">W32  L32</text>
    </g>
    <g transform="rotate(4 300 520)">
      <rect x="196" y="330" width="230" height="330" rx="4" fill="#f4f1ea"/>
      <rect x="196" y="330" width="230" height="330" rx="4" fill="#fff" filter="url(#grain${id})" opacity=".25"/>
      <text x="311" y="392" text-anchor="middle" font-family="Inter, sans-serif" font-size="22" font-weight="600" fill="#333">W32 L32</text>
      <line x1="226" y1="414" x2="396" y2="414" stroke="#bbb" stroke-width="2"/>
      <text x="311" y="458" text-anchor="middle" font-family="Inter, sans-serif" font-size="26" font-weight="700" fill="#222">100 % COTON</text>
      <text x="311" y="490" text-anchor="middle" font-family="Inter, sans-serif" font-size="18" fill="#555">100 % COTTON</text>
      <text x="311" y="518" text-anchor="middle" font-family="Inter, sans-serif" font-size="18" fill="#555">100 % ALGODÓN</text>
      <g fill="none" stroke="#444" stroke-width="2.4">
        <path d="M236,572 l8,30 h40 l8,-30 Z"/><path d="M314,572 l18,30 l18,-30 Z"/><rect x="368" y="572" width="30" height="30"/><circle cx="383" cy="587" r="10"/>
      </g>
    </g>
  </g>${vignette(id)}`;
}

/** Gros plan : le mètre ruban posé sur la ceinture, lu à 41 cm. */
function tape(id) {
  const ticks = [];
  for (let cm = 28; cm <= 46; cm++) {
    const x = 40 + (cm - 28) * 34;
    ticks.push(`<line x1="${x}" y1="372" x2="${x}" y2="${cm % 5 === 0 ? 404 : 394}" stroke="#222" stroke-width="2.4"/>`);
    for (let mm = 1; mm < 10; mm++) ticks.push(`<line x1="${x + mm * 3.4}" y1="372" x2="${x + mm * 3.4}" y2="${mm === 5 ? 388 : 381}" stroke="#333" stroke-width="1"/>`);
    ticks.push(`<text x="${x}" y="432" text-anchor="middle" font-family="Inter, sans-serif" font-size="${cm === 41 ? 26 : 20}" font-weight="700" fill="${cm === 41 ? "#c0392b" : "#222"}">${cm}</text>`);
  }
  return `${defs(id)}${floor(id)}
  <g filter="url(#shadow${id})">
    <rect x="-20" y="150" width="640" height="660" fill="url(#den${id})"/><rect x="-20" y="150" width="640" height="660" fill="url(#twill${id})"/>
    <rect x="-20" y="150" width="640" height="660" fill="#fff" filter="url(#grain${id})" opacity=".5"/>
    <rect x="-20" y="150" width="512" height="120" fill="#3e5d85"/>
    <path d="M-20,170 H492 M-20,252 H492" stroke="${STITCH}" stroke-width="4" stroke-dasharray="14 9"/>
    <path d="M492,150 L492,810" stroke="rgba(20,35,60,.6)" stroke-width="4"/>
    <circle cx="420" cy="211" r="22" fill="url(#cop${id})"/><circle cx="420" cy="211" r="9" fill="#8a5a2a"/>
    <g transform="rotate(-1.5 300 400)">
      <rect x="-30" y="360" width="660" height="86" fill="url(#tape${id})"/>
      ${ticks.join("")}
      <line x1="492" y1="340" x2="492" y2="470" stroke="#c0392b" stroke-width="4"/>
    </g>
  </g>${vignette(id)}`;
}

const VIEWS = { face: front, dos: back, etiquette: label, ruban: tape };

/** SVG d'une photo d'exemple du jean. `view` : face | dos | etiquette | ruban. */
export function jeanPhoto(view = "face") {
  const id = `j${++uid}`;
  return `<svg viewBox="0 0 600 800" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" style="display:block;width:100%;height:100%">${VIEWS[view](id)}</svg>`;
}
