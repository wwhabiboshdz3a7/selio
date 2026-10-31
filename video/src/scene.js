// Selio — spot publicitaire. Composition pilotée par une timeline GSAP "scrubbable" :
// le moteur de rendu (render.cjs) appelle window.__seek(t) pour chaque image, donc tout
// est déterministe (aucune animation CSS, aucun requestAnimationFrame libre).
import * as THREE from 'three';
import { ICONS } from './icons.js';

const timingFile = new URLSearchParams(location.search).get('timing') || 'timing.json';
const T = await (await fetch(`/${timingFile}`)).json();
const S = T.scenes;
// Durées "de conception" (version 60 s). Si timing.json donne une autre durée à une scène,
// sa chorégraphie est simplement accélérée/ralentie (timeScale) pour tenir dans le créneau.
const DESIGN = { hook: 5.6, reveal: 6.4, explore: 11.8, sell: 9.0, trust: 7.4, pro: 13.2, outro: 9.0 };

const stage = document.getElementById('stage');
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const ico = (name, w = 'light', cls = '') => `<svg class="ic ${cls}" viewBox="0 0 256 256" aria-hidden="true">${ICONS[`${name}:${w}`] ?? ''}</svg>`;
const MARK = `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M6 16 L24 8 L42 16"/><path d="M6 26 L24 18 L42 26" style="opacity:.72"/><path d="M6 36 L24 28 L42 36" style="opacity:.48"/></svg>`;
const center = (node) => { const r = node.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, l: r.left, t: r.top }; };

function splitWords(node) {
  const text = node.textContent; node.innerHTML = '';
  const ws = text.split(' ').filter(Boolean);
  ws.forEach((w, i) => { const s = el('span', 'w'); s.innerHTML = `<span class="wi hid">${w}</span>`; node.appendChild(s); if (i < ws.length - 1) node.appendChild(document.createTextNode(' ')); });
  return $$('.wi', node);
}
function prepType(box, text) {
  const val = $('.val', box); val.innerHTML = '';
  const chars = [...text].map((c) => { const s = el('span', 'ch hid', c); val.appendChild(s); return s; });
  const caret = el('span', 'caret hid'); val.appendChild(caret);
  return { box, chars, caret, ph: $('.ph', box) };
}
// fromTo avec immediateRender:false → l'état initial vient du CSS (.hid), l'état "from" est explicite,
// donc le scrub avant/arrière donne toujours le même résultat.
const ft = (tl, tg, from, to, pos) => tl.fromTo(tg, from, { ...to, immediateRender: false }, pos);

// ---------------------------------------------------------------- fond : rubans WebGL
class Ribbons {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1); this.renderer.setSize(960, 540, false); this.renderer.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 80);
    this.state = { opacity: 0, bright: 1, speed: 1, lift: 0 };
    const colA = new THREE.Color('#ffffff'), colB = new THREE.Color('#7394ae'), colC = new THREE.Color('#204868');
    this.ribbons = []; this.N = 30; this.P = 150;
    for (let i = 0; i < 3; i++) {
      const group = new THREE.Group(); const lines = [];
      for (let j = 0; j < this.N; j++) {
        const geo = new THREE.BufferGeometry(); const pos = new Float32Array(this.P * 3);
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const c = colA.clone().lerp(colB, j / (this.N - 1)).lerp(colC, 0.18 * i);
        const mat = new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
        const line = new THREE.Line(geo, mat); group.add(line); lines.push({ line, pos, j });
      }
      group.rotation.x = -1.02; group.position.y = -0.7 - i * 0.42; group.position.z = -i * 1.6;
      this.scene.add(group); this.ribbons.push({ group, lines, i });
    }
    // particules (poussière lumineuse)
    const rnd = rng(7); const n = 320; const pp = new Float32Array(n * 3); this.p0 = [];
    for (let k = 0; k < n; k++) { const x = (rnd() - 0.5) * 18, y = (rnd() - 0.5) * 8, z = (rnd() - 0.5) * 10 - 1; this.p0.push([x, y, z, 0.4 + rnd() * 0.8]); pp[k * 3] = x; pp[k * 3 + 1] = y; pp[k * 3 + 2] = z; }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
    const cv = document.createElement('canvas'); cv.width = cv.height = 64; const cx = cv.getContext('2d');
    const g = cx.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    cx.fillStyle = g; cx.fillRect(0, 0, 64, 64);
    this.pmat = new THREE.PointsMaterial({ size: 0.11, map: new THREE.CanvasTexture(cv), transparent: true, opacity: 0, color: 0xdbe7f2, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
    this.points = new THREE.Points(pg, this.pmat); this.scene.add(this.points);
  }
  render(t) {
    const st = this.state;
    if (st.opacity < 0.002) { this.renderer.clear(); return; }
    const tt = t * st.speed;
    for (const r of this.ribbons) {
      for (const { line, pos, j } of r.lines) {
        const yo = (j / (this.N - 1) - 0.5) * 2.4;
        for (let k = 0; k < this.P; k++) {
          const x = -12 + 24 * k / (this.P - 1);
          const z = 0.62 * Math.sin(0.48 * x + tt * 0.33 + r.i * 1.9 + j * 0.03) + 0.3 * Math.sin(1.2 * x - tt * 0.42 + j * 0.07 + r.i) + 0.1 * Math.sin(2.5 * x + tt * 0.8 + r.i * 0.7);
          const y = yo + 0.24 * Math.sin(0.85 * x + tt * 0.28 + r.i * 2.2);
          pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
        }
        line.geometry.attributes.position.needsUpdate = true;
        line.material.opacity = Math.min(1, st.opacity * (0.1 + 0.3 * (1 - j / (this.N - 1))) * st.bright);
      }
    }
    const pa = this.points.geometry.attributes.position;
    for (let k = 0; k < this.p0.length; k++) { const [x, y, z, s] = this.p0[k]; pa.setXYZ(k, x + Math.sin(tt * 0.15 * s + k) * 0.4, ((y + tt * 0.06 * s + 4) % 8) - 4, z); }
    pa.needsUpdate = true; this.pmat.opacity = Math.min(1, st.opacity * 0.55 * st.bright);
    this.camera.position.set(0, 1.9 + st.lift, 7.4); this.camera.lookAt(0, -0.3 + st.lift * 0.3, 0);
    this.renderer.render(this.scene, this.camera);
  }
}
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------- polices
const faces = ['500 40px "Playfair Display"', '600 40px "Playfair Display"', '700 40px "Playfair Display"', 'italic 500 40px "Playfair Display"',
  '400 20px "Source Sans 3"', '500 20px "Source Sans 3"', '600 20px "Source Sans 3"', '700 20px "Source Sans 3"'];
await Promise.all(faces.map((f) => document.fonts.load(f, 'Sélection à vélo — été ça 0123456789 €')));
await document.fonts.ready;

const bg = new Ribbons(document.getElementById('bg'));

// ---------------------------------------------------------------- construction des scènes
function buildHook() {
  const sc = el('section', 'scene'); sc.id = 's-hook';
  sc.innerHTML = `<div class="center"><h1 class="h1">Chaque vêtement a une histoire.</h1><div class="rule hid"></div><h2 class="h2">Et si la sienne ne faisait que commencer ?</h2></div>`;
  stage.appendChild(sc);
  return { sc, w1: splitWords($('.h1', sc)), w2: splitWords($('.h2', sc)), rule: $('.rule', sc) };
}
function buildLockup(id, tagline) {
  const sc = el('section', 'scene'); sc.id = id;
  sc.innerHTML = `<div class="flare hid"></div><div class="lockup"><div class="mark hid">${MARK}</div><div class="txt"><h1 class="wordmark">Selio</h1><p class="tagline">${tagline}</p></div></div>`;
  stage.appendChild(sc);
  const paths = $$('.mark path', sc);
  paths.forEach((p) => { const L = p.getTotalLength(); p.style.strokeDasharray = L; p.style.strokeDashoffset = L; });
  return { sc, lockup: $('.lockup', sc), flare: $('.flare', sc), mark: $('.mark', sc), paths, wordmark: $('.wordmark', sc), tagWords: splitWords($('.tagline', sc)), txt: $('.txt', sc) };
}

const PRODUCTS = [
  { t: 'Trench beige oversize', p: '45,00 €', c: 'Très bon état', s: 'marie.l', ic: 'coat-hanger', g: ['#f0e6d6', '#cdb28c'] },
  { t: 'Sneakers blanches', p: '38,00 €', c: 'Très bon état', s: 'theo', ic: 'sneaker', g: ['#f3f5f7', '#c6ced6'] },
  { t: 'Sac cuir camel', p: '62,00 €', c: 'Bon état', s: 'camille', ic: 'handbag', g: ['#e0bf97', '#a9794a'] },
  { t: 'Robe midi fleurie', p: '29,00 €', c: 'Très bon état', s: 'ines', ic: 'dress', g: ['#eddbe4', '#b98ca9'] },
  { t: 'Jean droit vintage', p: '24,00 €', c: 'Bon état', s: 'louis.v', ic: 'pants', g: ['#c3d1df', '#7893ad'] },
  { t: 'Hoodie gris chiné', p: '19,00 €', c: 'Très bon état', s: 'sarah', ic: 'hoodie', g: ['#e1e5e8', '#a7afb6'] },
  { t: 'Lunettes rondes', p: '35,00 €', c: 'Neuf avec étiquette', s: 'nina', ic: 'sunglasses', g: ['#e6dfd3', '#aea48f'] },
  { t: 'Montre acier', p: '49,00 €', c: 'Très bon état', s: 'hugo', ic: 'watch', g: ['#dae3ec', '#8fa3b7'] },
];
const KEEP = [0, 1, 3, 5, 7];
const slot = (i) => ({ x: (i % 4) * (245 + 13), y: Math.floor(i / 4) * (222 + 16) });

function buildExplore() {
  const sc = el('section', 'scene light'); sc.id = 's-explore';
  const waves = `<svg class="waves" viewBox="0 0 150 90">${[0, 1, 2].map((i) => `<path d="M0 ${30 + i * 18} C 30 ${10 + i * 18}, 60 ${50 + i * 18}, 90 ${30 + i * 18} S 150 ${20 + i * 18}, 150 ${30 + i * 18}" style="opacity:${1 - i * 0.3}"/>`).join('')}</svg>`;
  sc.innerHTML = `
    <div class="col">
      <div class="label hid">Explorer</div>
      <div class="lines"><h2 class="h l1">Explorez.</h2><h2 class="h l2">Filtrez.</h2><h2 class="h l3">Trouvez la perle rare.</h2></div>
    </div>
    <div class="winwrap"><div class="floatwrap"><div class="win hid">
      <div class="app-h">
        <div class="app-logo hp hid">${MARK}<span>Selio</span></div>
        <div class="app-search hp hid">${ico('magnifying-glass', 'regular')}Rechercher un article, une marque...</div>
        <div class="app-nav hp hid"><span class="on">Explorer</span><span>Favoris</span><span>Messages</span><span>Espace Pro</span></div>
        <div class="btn btn-p hp hid">Vendre</div>
      </div>
      <div class="hero hid">${waves}<span class="chip">Mode de seconde main</span><h3>Donnez une seconde vie à votre dressing</h3></div>
      <div class="filters">
        <span class="chip fc hid">${ico('sliders-horizontal', 'regular')}Catégorie</span><span class="chip fc hid">Taille</span><span class="chip fc f-etat hid">État</span><span class="chip fc f-prix hid">Prix</span>
        <span class="applied"><span class="chip a-etat hid">Très bon état ${ico('check', 'bold')}</span><span class="chip a-prix hid">≤ 50 € ${ico('check', 'bold')}</span></span>
        <span class="sp"></span><span class="sort fc hid">Tri : Pertinence</span>
      </div>
      <div class="grid">${PRODUCTS.map((p, i) => { const s = slot(i); return `<div class="card hid" style="left:${s.x}px;top:${s.y}px"><div class="img" style="background:linear-gradient(145deg,${p.g[0]},${p.g[1]})"><div class="sheen"></div>${ico(p.ic, 'light')}<div class="fav"><span class="ring hid"></span>${ico('heart', 'regular', 'line')}${ico('heart', 'fill', 'fill hid')}</div></div><div class="info"><div class="t">${p.t}</div><div class="p">${p.p}</div><div class="m">${p.c} · @${p.s}</div></div></div>`; }).join('')}</div>
      <div class="toast hid">${ico('heart', 'fill')}Ajouté à vos favoris</div>
    </div></div></div><div class="flash"></div>`;
  stage.appendChild(sc);
  const cards = $$('.card', sc);
  const applied = $('.applied', sc); const lastChip = $('.f-prix', sc);
  // chips "appliquées" placées juste après "Prix" (mesure après mise en page)
  applied.style.left = (lastChip.offsetLeft + lastChip.offsetWidth + 10) + 'px';
  const pos = { etat: center($('.f-etat', sc)), prix: center($('.f-prix', sc)), card0: center(cards[0]), fav0: center($('.fav', cards[0])) };
  const keepMoves = KEEP.map((idx, k) => ({ card: cards[idx], from: slot(idx), to: slot(k) }));
  return {
    sc, col: $('.col', sc), label: $('.label', sc), l1: $('.l1', sc), l2: $('.l2', sc), l3: $('.l3', sc),
    w1: splitWords($('.l1', sc)), w2: splitWords($('.l2', sc)), w3: splitWords($('.l3', sc)),
    winwrap: $('.winwrap', sc), floatWrap: $('.floatwrap', sc), win: $('.win', sc), hparts: $$('.hp', sc), hero: $('.hero', sc), chips: $$('.fc', sc), flash: $('.flash', sc),
    fEtat: $('.f-etat', sc), fPrix: $('.f-prix', sc), aEtat: $('.a-etat', sc), aPrix: $('.a-prix', sc), cards, gone: cards.filter((_, i) => !KEEP.includes(i)), keepMoves, pos,
    favBtn0: $('.fav', cards[0]), favFill0: $('.fav .fill', cards[0]), favRing0: $('.fav .ring', cards[0]), favIcon0: $('.img > .ic', cards[0]), toast: $('.toast', sc),
  };
}

function buildSell() {
  const sc = el('section', 'scene light'); sc.id = 's-sell';
  const tile = (icn, g) => `<div class="ph-tile">${ico('camera', 'light')}<svg class="ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="16"/></svg><div class="fill hid" style="background:linear-gradient(145deg,${g[0]},${g[1]})">${ico(icn, 'light')}</div></div>`;
  sc.innerHTML = `
    <div class="col">
      <div class="label hid">Vendre</div>
      <h2 class="h">En ligne en quelques minutes.</h2>
      <div class="steps">${['Ajoutez vos photos', 'Fixez votre prix', 'Publiez'].map((s) => `<div class="step hid"><span class="ck">${ico('check', 'bold', 'hid')}</span><span class="st">${s}</span></div>`).join('')}</div>
    </div>
    <div class="phonewrap"><div class="halo hid"></div><div class="phone hid"><div class="notch"></div><div class="screen"><div class="glass"></div><div class="sc">
      <div class="app-logo">${MARK}<span>Selio</span></div>
      <h4>Déposer une annonce</h4><p class="sub">Des photos nettes et une description honnête pour vendre plus vite.</p>
      <span class="lbl">Photos</span><div class="photos">${tile('coat-hanger', ['#f0e6d6', '#cdb28c'])}${tile('tag', ['#ece3d5', '#c4ab86'])}${tile('swatches', ['#f1e8d8', '#d2b994'])}</div>
      <span class="lbl">Titre</span><div class="in f-title"><span class="val"></span></div>
      <span class="lbl">Description</span><div class="in ta f-desc"><span class="val"></span></div>
      <div class="row"><div><span class="lbl">Prix (€)</span><div class="in f-price"><span class="ph">25.00</span><span class="val"></span></div></div><div><span class="lbl">Taille</span><div class="in f-size"><span class="ph">M, 38, unique...</span><span class="val"></span></div></div></div>
      <div class="row"><div><span class="lbl">Catégorie</span><div class="in sel"><span class="val sv hid">Femmes</span>${ico('caret-down', 'bold')}</div></div><div><span class="lbl">État</span><div class="in sel"><span class="val sv hid">Très bon état</span>${ico('caret-down', 'bold')}</div></div></div>
      <div class="pub"><span class="p1">Publier l'annonce</span><span class="p2 hid">Publication…</span></div>
    </div>
    <div class="done hid"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46"/><path d="M30 52 L44 66 L72 36"/></svg><h5 class="dt hid">Annonce publiée</h5><p class="dt hid">Votre trench est visible par toute la communauté.</p></div>
    </div></div></div>`;
  stage.appendChild(sc);
  const fields = {
    title: prepType($('.f-title', sc), 'Trench beige oversize'),
    desc: prepType($('.f-desc', sc), 'Trench oversize porté deux fois, coupe droite.'),
    price: prepType($('.f-price', sc), '45,00'),
    size: prepType($('.f-size', sc), '38'),
  };
  return {
    sc, col: $('.col', sc), label: $('.label', sc), hw: splitWords($('.h', sc)), steps: $$('.step', sc), stepTxt: $$('.step .st', sc), stepCk: $$('.step .ck', sc), stepIc: $$('.step .ck .ic', sc),
    phonewrap: $('.phonewrap', sc), phone: $('.phone', sc), halo: $('.halo', sc), glass: $('.glass', sc), rings: $$('.ph-tile .ring circle', sc), fills: $$('.ph-tile .fill', sc), fields,
    sels: $$('.sv', sc), pub: $('.pub', sc), p1: $('.p1', sc), p2: $('.p2', sc), pos: { pub: center($('.pub', sc)) },
    done: $('.done', sc), doneCircle: $('.done circle', sc), doneCheck: $('.done path', sc), doneTxt: $$('.done .dt', sc),
  };
}

const MSGS = [
  { who: 'in', text: 'Bonjour ! Le trench est-il toujours disponible ?' },
  { who: 'out', text: 'Oui ! Il est comme neuf, porté deux fois.' },
  { who: 'in', text: 'Super. Je vous propose 40 € ?' },
  { who: 'out', text: 'C’est d’accord pour 40 € !' },
];
function buildTrust() {
  const sc = el('section', 'scene light'); sc.id = 's-trust';
  sc.innerHTML = `
    <div class="col">
      <div class="label hid">Acheter</div>
      <div class="lines"><h2 class="h l1">Discutez.</h2><h2 class="h l2">Négociez.</h2><h2 class="h l3">Achetez en confiance.</h2></div>
      <div class="meta"><span class="chip mt hid">${ico('seal-check', 'fill')}48 ventes</span><span class="chip mt hid">${ico('star', 'fill')}4,9 / 5</span><span class="chip mt hid">${ico('chat-circle-dots', 'fill')}Répond en moins d’une heure</span></div>
    </div>
    <div class="chatwrap"><div class="chat hid">
      <div class="top"><div class="avatar">M</div><div><div class="who">Marie</div><div class="what">Trench beige oversize · 45,00 €</div></div><div class="thumb" style="background:linear-gradient(145deg,#f0e6d6,#cdb28c)">${ico('coat-hanger', 'light')}</div></div>
      <div class="msgs"><div class="date">Aujourd’hui</div>${MSGS.map((m) => `<div class="msg ${m.who} hid">${m.text}</div>`).join('')}<div class="deal hid">${ico('check-circle', 'fill')}Prix accepté · 40,00 €</div>
        ${MSGS.map((m) => `<div class="typing ${m.who} hid"><i></i><i></i><i></i></div>`).join('')}</div>
      <div class="foot"><div class="in">Écrire un message…</div><div class="send">${ico('paper-plane-right', 'bold')}</div></div>
    </div></div>`;
  stage.appendChild(sc);
  const msgs = $$('.msg', sc), typings = $$('.typing', sc); const box = $('.msgs', sc).getBoundingClientRect();
  msgs.forEach((m, i) => { const r = m.getBoundingClientRect(); const t = typings[i]; t.style.top = (r.top - box.top) + 'px'; if (m.classList.contains('out')) t.style.right = (box.right - r.right) + 'px'; else t.style.left = (r.left - box.left) + 'px'; });
  return {
    sc, col: $('.col', sc), label: $('.label', sc), l1: $('.l1', sc), l2: $('.l2', sc), l3: $('.l3', sc),
    w1: splitWords($('.l1', sc)), w2: splitWords($('.l2', sc)), w3: splitWords($('.l3', sc)), meta: $$('.mt', sc),
    chat: $('.chat', sc), msgs, typings, dots: typings.map((t) => $$('i', t)), deal: $('.deal', sc),
  };
}

const RULES = [
  ['heart', 'Message automatique à la mise en favori'], ['bell', 'Relance si pas de réponse sous 48 h'], ['robot', 'Négociation automatique (marge autorisée)'],
  ['chat-circle-dots', 'Message après-vente le lendemain'], ['recycle', 'Republication automatique'],
];
function buildPro() {
  const sc = el('section', 'scene'); sc.id = 's-pro';
  const W = 440, H = 200, vals = [12, 15, 14, 21, 26, 31], months = ['Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.'];
  const pts = vals.map((v, i) => [20 + i * ((W - 40) / 5), H - 24 - (v - 8) * ((H - 50) / 26)]);
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; const cx = (x0 + x1) / 2; d += ` C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`; }
  const area = `${d} L ${pts[5][0]} ${H - 20} L ${pts[0][0]} ${H - 20} Z`;
  sc.innerHTML = `
    <div class="col">
      <div class="chipd hid">${ico('lightning', 'fill')}Pour les vendeurs ambitieux</div>
      <h2 class="pro-h">Selio Pro</h2>
      <p class="pro-sub">Pilotez votre activité de revente.</p>
      <p class="pro-note">Vos règles s’exécutent toutes les 15 minutes — même la nuit.</p>
    </div>
    <div class="dashwrap"><div class="dash hid">
      <div class="ttl dp hid"><h4>Vue d’ensemble</h4><span class="chip">${ico('lightning', 'fill')}5 automatisations actives</span></div>
      <div class="stats">${[['Ventes', 'n'], ['Chiffre d’affaires', 'ca'], ['Marge nette', 'mg'], ['Articles en stock', 'st']].map(([k, id]) => `<div class="stat hid"><div class="k">${k}</div><div class="v v-${id}">0</div></div>`).join('')}</div>
      <div class="mid">
        <div class="panel dp hid"><div class="ph">Ventes · 6 derniers mois <span>+ 158 %</span></div>
          <div class="chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7394ae" stop-opacity=".45"/><stop offset="1" stop-color="#7394ae" stop-opacity="0"/></linearGradient></defs>
            ${[0, 1, 2, 3].map((i) => `<line class="gl" x1="20" x2="${W - 20}" y1="${30 + i * 45}" y2="${30 + i * 45}"/>`).join('')}
            <path class="ar hid" d="${area}"/><path class="ln" d="${d}"/>
            ${pts.map(([x, y]) => `<circle class="dt hid" cx="${x}" cy="${y}" r="5"/>`).join('')}
            ${pts.map(([x], i) => `<text class="mo" x="${x}" y="${H - 2}" text-anchor="middle">${months[i]}</text>`).join('')}
          </svg></div></div>
        <div class="panel dp hid"><div class="ph">Automatisations <span class="auto">${ico('clock', 'bold')}toutes les 15 min</span></div>
          <div class="rules">${RULES.map(([i, t]) => `<div class="rule hid">${ico(i, 'regular')}<span>${t}</span><span class="tg"><i></i></span></div>`).join('')}</div>
          <div class="rules-foot hid">${ico('moon-stars', 'regular')}Dernière exécution il y a 4 min · 12 actions aujourd’hui</div></div>
      </div>
      <div class="pills">
        ${[['coat-hanger', 'Dressing & stock'], ['chart-line-up', 'Ventes & compta'], ['users-three', 'Communauté'], ['sparkle', 'Retouche photo']].map(([i, t]) => `<span class="pill hid">${ico(i, 'regular')}${t}</span>`).join('')}
        <span class="xls hid"><span class="l1">${ico('file-xls', 'regular')}Exporter en Excel</span><span class="l2 hid">${ico('check-circle', 'fill')}Export prêt</span><span class="fly hid">${ico('file-xls', 'fill')}</span></span>
      </div>
    </div></div>`;
  stage.appendChild(sc);
  const ln = $('.chart .ln', sc); const L = ln.getTotalLength(); ln.style.strokeDasharray = L; ln.style.strokeDashoffset = L;
  return {
    sc, col: $('.col', sc), chip: $('.chipd', sc), h: $('.pro-h', sc), subW: splitWords($('.pro-sub', sc)), noteW: splitWords($('.pro-note', sc)),
    dash: $('.dash', sc), dparts: $$('.dp', sc), stats: $$('.stat', sc), vals: { n: $('.v-n', sc), ca: $('.v-ca', sc), mg: $('.v-mg', sc), st: $('.v-st', sc) },
    line: ln, lineLen: L, area: $('.chart .ar', sc), dots: $$('.chart .dt', sc), rules: $$('.rule', sc), rulesFoot: $('.rules-foot', sc), tgs: $$('.tg', sc), knobs: $$('.tg i', sc), auto: $('.auto', sc), autoIc: $('.auto .ic', sc),
    pills: $$('.pill', sc), xls: $('.xls', sc), xl1: $('.xls .l1', sc), xl2: $('.xls .l2', sc), fly: $('.xls .fly', sc), pos: { xls: center($('.xls', sc)) },
  };
}
function buildOutro() {
  const sc = el('section', 'scene'); sc.id = 's-outro';
  sc.innerHTML = `<div class="flare hid"></div><div class="lock"><div class="row"><div class="mark hid">${MARK}</div><div class="txt"><h1 class="wordmark">Selio</h1></div></div>
    <p class="tagline">Donnez une seconde vie à votre dressing.</p>
    <div class="trio hid">Achetez · Vendez · Recommencez</div>
    <div class="avail hid">${ico('device-mobile-camera', 'regular')}Disponible sur le web · s’installe sur votre téléphone</div></div>`;
  stage.appendChild(sc);
  const paths = $$('.mark path', sc); paths.forEach((p) => { const L = p.getTotalLength(); p.style.strokeDasharray = L; p.style.strokeDashoffset = L; });
  return { sc, lock: $('.lock', sc), flare: $('.flare', sc), mark: $('.mark', sc), paths, wordmark: $('.wordmark', sc), txt: $('.txt', sc), tagWords: splitWords($('.tagline', sc)), trio: $('.trio', sc), avail: $('.avail', sc) };
}

const HOOK = buildHook(), REV = buildLockup('s-reveal', 'Donnez une seconde vie à votre dressing.'), EXP = buildExplore(), SELL = buildSell(), TRUST = buildTrust(), PRO = buildPro(), OUT = buildOutro();

// calques globaux
const wipe = el('div'); wipe.id = 'wipe'; stage.appendChild(wipe); gsap.set(wipe, { xPercent: -120, skewX: -12 });
const cursor = el('div'); cursor.id = 'cursor'; cursor.innerHTML = '<div class="ring"></div>'; stage.appendChild(cursor); const cursorRing = $('.ring', cursor);
const grain = el('div'); grain.id = 'grain'; stage.appendChild(grain);
const vignette = el('div'); vignette.id = 'vignette'; stage.appendChild(vignette);
const fade = el('div'); fade.id = 'fade'; stage.appendChild(fade);
{ // tuile de grain (bruit) générée une fois, déplacée à chaque image
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'); const img = x.createImageData(256, 256); const r = rng(42);
  for (let i = 0; i < img.data.length; i += 4) { const v = 110 + r() * 90; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  x.putImageData(img, 0, 0); grain.style.backgroundImage = `url(${c.toDataURL()})`;
}

// ---------------------------------------------------------------- helpers de chorégraphie
const revealWords = (tl, words, at, opts = {}) => ft(tl, words, { autoAlpha: 0, y: opts.y ?? 34, filter: 'blur(14px)' }, { autoAlpha: 1, y: 0, filter: 'blur(0px)', duration: opts.dur ?? 1.0, ease: 'expo.out', stagger: opts.stagger ?? 0.08 }, at);
const muteLine = (tl, line, at) => ft(tl, line, { color: '#0c1b27' }, { color: '#a3b3c0', duration: 0.7, ease: 'power2.out' }, at);
const cursorShow = (tl, x, y, at) => ft(tl, cursor, { autoAlpha: 0, x, y, scale: 0.6 }, { autoAlpha: 1, x, y, scale: 1, duration: 0.4, ease: 'power3.out' }, at);
const cursorMove = (tl, x0, y0, x1, y1, dur, at) => ft(tl, cursor, { x: x0, y: y0 }, { x: x1, y: y1, duration: dur, ease: 'power2.inOut' }, at);
const cursorTap = (tl, at) => { ft(tl, cursor, { scale: 1 }, { scale: 0.76, duration: 0.12, yoyo: true, repeat: 1, ease: 'power2.inOut' }, at); ft(tl, cursorRing, { scale: 1, autoAlpha: 0.9 }, { scale: 2.6, autoAlpha: 0, duration: 0.6, ease: 'power2.out' }, at + 0.06); };
const cursorHide = (tl, at) => ft(tl, cursor, { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.3 }, at);
const show = (tl, tg, at, dur = 0.01) => ft(tl, tg, { autoAlpha: 0 }, { autoAlpha: 1, duration: dur }, at);
const hide = (tl, tg, at, dur = 0.01) => ft(tl, tg, { autoAlpha: 1 }, { autoAlpha: 0, duration: dur }, at);
function typeSeq(tl, f, at, per) {
  ft(tl, f.box, { borderColor: '#e2e8f0', boxShadow: '0 0 0 0px rgba(32,72,104,0)' }, { borderColor: '#204868', boxShadow: '0 0 0 3px rgba(32,72,104,.15)', duration: 0.25 }, at);
  if (f.ph) hide(tl, f.ph, at + 0.1, 0.15);
  show(tl, f.caret, at);
  ft(tl, f.chars, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.01, stagger: per }, at + 0.18);
  const end = at + 0.18 + per * f.chars.length;
  hide(tl, f.caret, end + 0.3);
  ft(tl, f.box, { borderColor: '#204868', boxShadow: '0 0 0 3px rgba(32,72,104,.15)' }, { borderColor: '#e2e8f0', boxShadow: '0 0 0 0px rgba(32,72,104,0)', duration: 0.25 }, end + 0.3);
  return end;
}
const fmtInt = (n) => Math.round(n).toLocaleString('fr-FR');
const fmtEur = (n) => `${Math.round(n).toLocaleString('fr-FR')} €`;
function countUp(tl, node, to, fmt, at, dur = 1.4) { const o = { v: 0 }; ft(tl, o, { v: 0 }, { v: to, duration: dur, ease: 'power2.out', onUpdate: () => { node.textContent = fmt(o.v); } }, at); }

// ---------------------------------------------------------------- timeline maîtresse
const master = gsap.timeline({ paused: true });
function addScene(name, build) { const [a, b] = S[name]; const tl = gsap.timeline(); build(tl); tl.timeScale(DESIGN[name] / (b - a)); master.add(tl, a); }

// S1 — accroche
addScene('hook', (tl) => {
  const { sc, w1, w2, rule } = HOOK;
  show(tl, sc, 0);
  ft(tl, $('.center', sc), { scale: 1 }, { scale: 1.06, duration: 5.6, ease: 'sine.inOut' }, 0);
  ft(tl, bg.state, { opacity: 0, bright: 1, lift: 0 }, { opacity: 0.85, duration: 2.6, ease: 'power2.out' }, 0);
  revealWords(tl, w1, 0.35, { y: 44, dur: 1.3, stagger: 0.11 });
  ft(tl, rule, { scaleX: 0, autoAlpha: 0 }, { scaleX: 1, autoAlpha: 1, duration: 1.0, ease: 'power3.out' }, 1.7);
  revealWords(tl, w2, 2.25, { y: 30, dur: 1.0, stagger: 0.065 });
  ft(tl, [...w1, ...w2], { autoAlpha: 1, y: 0, filter: 'blur(0px)' }, { autoAlpha: 0, y: -26, filter: 'blur(10px)', duration: 0.55, ease: 'power2.in', stagger: 0.02 }, 4.8);
  ft(tl, rule, { scaleX: 1, autoAlpha: 1 }, { scaleX: 0, autoAlpha: 0, duration: 0.45 }, 4.85);
  hide(tl, sc, 5.59);
});

// S2 — révélation du logo
function lockupIn(tl, R, at, speed = 1) {
  const off = (R.txt.offsetWidth + 44) / 2;
  const mc = center(R.mark); R.flare.style.left = `${mc.x}px`; R.flare.style.top = `${mc.y}px`;
  ft(tl, R.mark, { autoAlpha: 0, scale: 0.8, x: off }, { autoAlpha: 1, scale: 1, x: off, duration: 0.8 * speed, ease: 'expo.out' }, at);
  R.paths.slice().reverse().forEach((p, i) => ft(tl, p, { strokeDashoffset: p.getTotalLength() }, { strokeDashoffset: 0, duration: 0.75 * speed, ease: 'power2.inOut' }, at + (0.15 + i * 0.3) * speed));
  // éclat lumineux quand le dernier chevron se referme
  ft(tl, R.flare, { autoAlpha: 0, scale: 0.5, x: off }, { autoAlpha: 0.75, scale: 1.1, x: off, duration: 0.5 * speed, ease: 'power2.out' }, at + 1.0 * speed);
  ft(tl, R.flare, { autoAlpha: 0.75, scale: 1.1 }, { autoAlpha: 0, scale: 1.6, duration: 1.4 * speed, ease: 'power2.out' }, at + 1.5 * speed);
  ft(tl, R.mark, { x: off }, { x: 0, duration: 1.0 * speed, ease: 'expo.inOut' }, at + 1.5 * speed);
  ft(tl, R.wordmark, { clipPath: 'inset(-10% 100% -10% 0%)', x: -40 }, { clipPath: 'inset(-10% 0% -10% 0%)', x: 0, duration: 1.15 * speed, ease: 'expo.inOut' }, at + 1.6 * speed);
  revealWords(tl, R.tagWords, at + 2.55 * speed, { y: 18, dur: 0.8, stagger: 0.05 });
  ft(tl, R.wordmark, { backgroundPositionX: '100%' }, { backgroundPositionX: '0%', duration: 1.5 * speed, ease: 'power2.inOut' }, at + 3.0 * speed);
}
addScene('reveal', (tl) => {
  const R = REV;
  show(tl, R.sc, 0);
  lockupIn(tl, R, 0);
  ft(tl, bg.state, { bright: 1 }, { bright: 1.8, duration: 0.9, ease: 'sine.inOut', yoyo: true, repeat: 1 }, 2.6);
  ft(tl, R.lockup, { scale: 1, autoAlpha: 1, filter: 'blur(0px)' }, { scale: 1.08, autoAlpha: 0, filter: 'blur(10px)', duration: 0.8, ease: 'power2.in' }, 5.5);
  hide(tl, R.sc, 6.39);
});

// S3 — explorer
addScene('explore', (tl) => {
  const E = EXP;
  show(tl, E.sc, 0);
  ft(tl, E.sc, { clipPath: 'circle(0% at 34% 50%)' }, { clipPath: 'circle(150% at 34% 50%)', duration: 1.2, ease: 'power2.inOut' }, 0);
  ft(tl, E.flash, { autoAlpha: 1 }, { autoAlpha: 0, duration: 1.1, ease: 'power2.out' }, 0.25);
  ft(tl, bg.state, { opacity: 0.85 }, { opacity: 0, duration: 0.8 }, 0.6);
  ft(tl, E.label, { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.7, ease: 'power3.out' }, 0.5);
  revealWords(tl, E.w1, 0.6);
  ft(tl, E.win, { autoAlpha: 0, y: 80, rotateY: -16, rotateX: 6, scale: 0.94 }, { autoAlpha: 1, y: 0, rotateY: 0, rotateX: 0, scale: 1, duration: 1.5, ease: 'expo.out' }, 0.55);
  ft(tl, E.floatWrap, { y: -6 }, { y: 6, duration: 2.9, ease: 'sine.inOut', yoyo: true, repeat: 5 }, 0);
  ft(tl, E.hparts, { autoAlpha: 0, y: -10 }, { autoAlpha: 1, y: 0, duration: 0.6, stagger: 0.07, ease: 'power3.out' }, 0.95);
  ft(tl, E.hero, { autoAlpha: 0, y: 22 }, { autoAlpha: 1, y: 0, duration: 0.8, ease: 'power3.out' }, 1.1);
  ft(tl, E.chips, { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.06, ease: 'power3.out' }, 1.3);
  ft(tl, E.cards, { autoAlpha: 0, y: 54, rotateX: 14 }, { autoAlpha: 1, y: 0, rotateX: 0, duration: 1.0, stagger: 0.075, ease: 'expo.out' }, 1.45);
  // Filtrez.
  revealWords(tl, E.w2, 4.6); muteLine(tl, E.l1, 4.6);
  cursorShow(tl, 1360, 470, 4.7); cursorMove(tl, 1360, 470, E.pos.etat.x, E.pos.etat.y, 0.7, 4.85); cursorTap(tl, 5.6);
  ft(tl, E.fEtat, { backgroundColor: '#f6f8fa', color: '#0c1b27', borderColor: '#e2e8f0' }, { backgroundColor: '#204868', color: '#ffffff', borderColor: '#204868', duration: 0.25 }, 5.65);
  ft(tl, E.aEtat, { autoAlpha: 0, scale: 0.8, x: -10 }, { autoAlpha: 1, scale: 1, x: 0, duration: 0.5, ease: 'back.out(1.6)' }, 5.7);
  cursorMove(tl, E.pos.etat.x, E.pos.etat.y, E.pos.prix.x, E.pos.prix.y, 0.5, 5.95); cursorTap(tl, 6.5);
  ft(tl, E.fPrix, { backgroundColor: '#f6f8fa', color: '#0c1b27', borderColor: '#e2e8f0' }, { backgroundColor: '#204868', color: '#ffffff', borderColor: '#204868', duration: 0.25 }, 6.55);
  ft(tl, E.aPrix, { autoAlpha: 0, scale: 0.8, x: -10 }, { autoAlpha: 1, scale: 1, x: 0, duration: 0.5, ease: 'back.out(1.6)' }, 6.6);
  ft(tl, E.gone, { autoAlpha: 1, scale: 1 }, { autoAlpha: 0, scale: 0.88, duration: 0.45, ease: 'power2.in', stagger: 0.05 }, 6.7);
  E.keepMoves.forEach(({ card, from, to }) => ft(tl, card, { x: 0, y: 0 }, { x: to.x - from.x, y: to.y - from.y, duration: 0.85, ease: 'expo.inOut' }, 6.95));
  // Trouvez la perle rare.
  revealWords(tl, E.w3, 7.9); muteLine(tl, E.l2, 7.9);
  cursorMove(tl, E.pos.prix.x, E.pos.prix.y, E.pos.card0.x, E.pos.card0.y, 0.8, 7.95);
  ft(tl, E.cards[0], { y: 0, scale: 1, boxShadow: '0 1px 2px rgba(12,27,39,.04), 0 12px 28px -14px rgba(12,27,39,.22)' }, { y: -10, scale: 1.045, boxShadow: '0 2px 4px rgba(12,27,39,.06), 0 30px 50px -16px rgba(12,27,39,.38)', duration: 0.6, ease: 'power3.out' }, 8.55);
  ft(tl, E.favIcon0, { scale: 1 }, { scale: 1.1, duration: 0.6, ease: 'power3.out' }, 8.55);
  cursorMove(tl, E.pos.card0.x, E.pos.card0.y, E.pos.fav0.x, E.pos.fav0.y - 10, 0.45, 8.95); cursorTap(tl, 9.45);
  ft(tl, E.favFill0, { autoAlpha: 0, scale: 0.4 }, { autoAlpha: 1, scale: 1, duration: 0.55, ease: 'back.out(2.5)' }, 9.5);
  ft(tl, E.favBtn0, { scale: 1 }, { scale: 1.25, duration: 0.18, yoyo: true, repeat: 1, ease: 'power2.out' }, 9.47);
  ft(tl, E.favRing0, { scale: 0.6, autoAlpha: 0.9 }, { scale: 2.4, autoAlpha: 0, duration: 0.7, ease: 'power2.out' }, 9.5);
  ft(tl, E.toast, { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: 'expo.out' }, 9.65);
  // sortie
  cursorHide(tl, 10.85);
  ft(tl, E.winwrap, { x: 0, scale: 1, autoAlpha: 1, filter: 'blur(0px)' }, { x: 140, scale: 1.2, autoAlpha: 0, filter: 'blur(10px)', duration: 0.8, ease: 'power2.in' }, 11.0);
  ft(tl, E.col, { x: 0, autoAlpha: 1, filter: 'blur(0px)' }, { x: -90, autoAlpha: 0, filter: 'blur(8px)', duration: 0.6, ease: 'power2.in' }, 11.1);
  hide(tl, E.sc, 11.79);
});

// S4 — vendre
addScene('sell', (tl) => {
  const L = SELL;
  show(tl, L.sc, 0, 0.5);
  ft(tl, L.col, { x: 110, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 1.0, ease: 'expo.out' }, 0);
  ft(tl, L.label, { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.6 }, 0.3);
  revealWords(tl, L.hw, 0.4);
  ft(tl, L.steps, { autoAlpha: 0, x: -24 }, { autoAlpha: 1, x: 0, duration: 0.7, stagger: 0.1, ease: 'power3.out' }, 1.0);
  ft(tl, L.halo, { autoAlpha: 0, scale: 0.7 }, { autoAlpha: 0.7, scale: 1, duration: 1.6, ease: 'power2.out' }, 0.4);
  ft(tl, L.phone, { autoAlpha: 0, y: 100, rotateY: -24, rotateX: 5 }, { autoAlpha: 1, y: 0, rotateY: -8, rotateX: 2, duration: 1.4, ease: 'expo.out' }, 0.4);
  ft(tl, L.phone, { rotateY: -8 }, { rotateY: -3, duration: 6.6, ease: 'sine.inOut' }, 1.8);
  ft(tl, L.glass, { xPercent: -120 }, { xPercent: 120, duration: 1.7, ease: 'power2.inOut' }, 1.0);
  const stepOn = (i, at) => { ft(tl, L.stepCk[i], { backgroundColor: '#ffffff', borderColor: '#cfd8e0' }, { backgroundColor: '#204868', borderColor: '#204868', duration: 0.3 }, at); ft(tl, L.stepIc[i], { autoAlpha: 0, scale: 0.4 }, { autoAlpha: 1, scale: 1, duration: 0.45, ease: 'back.out(2)' }, at + 0.05); ft(tl, L.stepTxt[i], { color: '#8a9bab' }, { color: '#0c1b27', duration: 0.3 }, at); };
  [0, 1, 2].forEach((i) => { const at = 1.6 + i * 0.55; ft(tl, L.rings[i], { strokeDashoffset: 100, autoAlpha: 1 }, { strokeDashoffset: 0, duration: 0.5, ease: 'power2.inOut' }, at); hide(tl, L.rings[i], at + 0.5, 0.2); ft(tl, L.fills[i], { autoAlpha: 0, scale: 0.85 }, { autoAlpha: 1, scale: 1, duration: 0.5, ease: 'back.out(1.8)' }, at + 0.45); });
  stepOn(0, 3.2);
  typeSeq(tl, L.fields.title, 3.3, 0.045);
  typeSeq(tl, L.fields.desc, 4.4, 0.02);
  typeSeq(tl, L.fields.price, 5.25, 0.08); typeSeq(tl, L.fields.size, 5.75, 0.1);
  ft(tl, L.sels, { autoAlpha: 0, scale: 0.94 }, { autoAlpha: 1, scale: 1, duration: 0.4, stagger: 0.14, ease: 'power3.out' }, 5.95);
  stepOn(1, 6.2);
  cursorShow(tl, L.pos.pub.x + 170, L.pos.pub.y + 130, 6.0); cursorMove(tl, L.pos.pub.x + 170, L.pos.pub.y + 130, L.pos.pub.x, L.pos.pub.y, 0.6, 6.15); cursorTap(tl, 6.8);
  ft(tl, L.pub, { scale: 1 }, { scale: 0.96, duration: 0.12, yoyo: true, repeat: 1 }, 6.8);
  hide(tl, L.p1, 6.9, 0.2); show(tl, L.p2, 6.95, 0.2);
  cursorHide(tl, 7.05);
  show(tl, L.done, 7.35, 0.4);
  ft(tl, L.doneCircle, { strokeDashoffset: 290 }, { strokeDashoffset: 0, duration: 0.75, ease: 'power2.inOut' }, 7.4);
  ft(tl, L.doneCheck, { strokeDashoffset: 60 }, { strokeDashoffset: 0, duration: 0.4, ease: 'power2.out' }, 7.95);
  ft(tl, L.doneTxt, { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.1 }, 7.85);
  ft(tl, L.halo, { autoAlpha: 0.7, scale: 1 }, { autoAlpha: 1, scale: 1.25, duration: 0.6, yoyo: true, repeat: 1, ease: 'sine.inOut' }, 7.4);
  stepOn(2, 8.05);
  ft(tl, L.col, { x: 0, autoAlpha: 1 }, { x: -110, autoAlpha: 0, duration: 0.6, ease: 'power2.in' }, 8.4);
  ft(tl, L.phonewrap, { x: 0, autoAlpha: 1 }, { x: -140, autoAlpha: 0, duration: 0.7, ease: 'power2.in' }, 8.35);
  hide(tl, L.sc, 8.99);
});

// S5 — confiance / messagerie
addScene('trust', (tl) => {
  const C = TRUST;
  show(tl, C.sc, 0, 0.5);
  ft(tl, C.col, { x: 110, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 1.0, ease: 'expo.out' }, 0);
  ft(tl, C.label, { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.6 }, 0.3);
  revealWords(tl, C.w1, 0.4);
  ft(tl, C.chat, { autoAlpha: 0, y: 70, rotateX: 9 }, { autoAlpha: 1, y: 0, rotateX: 0, duration: 1.2, ease: 'expo.out' }, 0.45);
  const starts = [1.2, 2.5, 3.9, 5.1];
  starts.forEach((at, i) => {
    show(tl, C.typings[i], at, 0.25);
    ft(tl, C.dots[i], { y: 0 }, { y: -5, duration: 0.22, yoyo: true, repeat: 3, ease: 'sine.inOut', stagger: 0.08 }, at + 0.1);
    hide(tl, C.typings[i], at + 0.8, 0.15);
    ft(tl, C.msgs[i], { autoAlpha: 0, y: 12, scale: 0.96 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.5, ease: 'back.out(1.4)' }, at + 0.85);
  });
  revealWords(tl, C.w2, 3.6); muteLine(tl, C.l1, 3.6);
  revealWords(tl, C.w3, 5.3); muteLine(tl, C.l2, 5.3);
  ft(tl, C.meta, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.6, stagger: 0.1, ease: 'power3.out' }, 5.6);
  ft(tl, C.deal, { autoAlpha: 0, scale: 0.8, y: 8 }, { autoAlpha: 1, scale: 1, y: 0, duration: 0.55, ease: 'back.out(1.8)' }, 6.0);
  // balayage bleu vers Selio Pro
  ft(tl, wipe, { autoAlpha: 1, xPercent: -120 }, { xPercent: 0, duration: 0.75, ease: 'power3.inOut' }, 6.45);
  ft(tl, wipe, { xPercent: 0 }, { xPercent: 120, duration: 0.75, ease: 'power3.inOut' }, 7.25);
  hide(tl, wipe, 8.0);
  hide(tl, C.sc, 7.39);
});

// S6 — Selio Pro
addScene('pro', (tl) => {
  const P = PRO;
  show(tl, P.sc, 0);
  ft(tl, bg.state, { opacity: 0, bright: 1 }, { opacity: 0.6, duration: 1.6 }, 0.2);
  ft(tl, P.chip, { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: 'power3.out' }, 0.5);
  ft(tl, P.h, { clipPath: 'inset(-10% 100% -10% 0%)', x: -40 }, { clipPath: 'inset(-10% 0% -10% 0%)', x: 0, duration: 1.15, ease: 'expo.inOut' }, 0.6);
  ft(tl, P.h, { backgroundPositionX: '100%' }, { backgroundPositionX: '0%', duration: 1.5, ease: 'power2.inOut' }, 1.9);
  revealWords(tl, P.subW, 1.3, { y: 20, dur: 0.8, stagger: 0.05 });
  ft(tl, P.dash, { autoAlpha: 0, y: 90, rotateX: 10, scale: 0.96 }, { autoAlpha: 1, y: 0, rotateX: 0, scale: 1, duration: 1.4, ease: 'expo.out' }, 1.0);
  ft(tl, P.dparts, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.6, stagger: 0.12, ease: 'power3.out' }, 1.5);
  ft(tl, P.stats, { autoAlpha: 0, y: 22 }, { autoAlpha: 1, y: 0, duration: 0.7, stagger: 0.09, ease: 'power3.out' }, 1.7);
  countUp(tl, P.vals.n, 128, fmtInt, 1.9); countUp(tl, P.vals.ca, 4860, fmtEur, 2.0); countUp(tl, P.vals.mg, 1920, fmtEur, 2.1); countUp(tl, P.vals.st, 36, fmtInt, 2.2);
  ft(tl, P.line, { strokeDashoffset: P.lineLen }, { strokeDashoffset: 0, duration: 1.4, ease: 'power2.inOut' }, 2.7);
  ft(tl, P.area, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.8 }, 3.5);
  ft(tl, P.dots, { autoAlpha: 0, scale: 0, transformOrigin: '50% 50%' }, { autoAlpha: 1, scale: 1, duration: 0.4, stagger: 0.1, ease: 'back.out(2)' }, 3.1);
  ft(tl, P.rules, { autoAlpha: 0, x: -16 }, { autoAlpha: 1, x: 0, duration: 0.5, stagger: 0.09, ease: 'power3.out' }, 3.4);
  P.knobs.forEach((k, i) => { const at = 4.5 + i * 0.3; ft(tl, k, { x: 0 }, { x: 18, duration: 0.3, ease: 'power2.inOut' }, at); ft(tl, P.tgs[i], { backgroundColor: 'rgba(255,255,255,0.14)' }, { backgroundColor: '#7394ae', duration: 0.3 }, at); });
  ft(tl, P.rulesFoot, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: 'power3.out' }, 6.0);
  ft(tl, P.auto, { scale: 1 }, { scale: 1.1, duration: 0.35, yoyo: true, repeat: 1, ease: 'sine.inOut' }, 6.2);
  ft(tl, P.autoIc, { rotate: 0 }, { rotate: 360, duration: 1.2, ease: 'power2.inOut' }, 6.1);
  ft(tl, [...P.pills, P.xls], { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.55, stagger: 0.08, ease: 'power3.out' }, 6.6);
  cursorShow(tl, P.pos.xls.x - 160, P.pos.xls.y + 120, 7.6); cursorMove(tl, P.pos.xls.x - 160, P.pos.xls.y + 120, P.pos.xls.x, P.pos.xls.y, 0.6, 7.75); cursorTap(tl, 8.4);
  ft(tl, P.xls, { scale: 1 }, { scale: 0.95, duration: 0.12, yoyo: true, repeat: 1 }, 8.4);
  hide(tl, P.xl1, 8.55, 0.2); show(tl, P.xl2, 8.6, 0.25);
  ft(tl, P.fly, { autoAlpha: 0, y: 0, scale: 0.6 }, { autoAlpha: 1, y: -70, scale: 1, duration: 0.6, ease: 'power2.out' }, 8.55);
  ft(tl, P.fly, { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.3 }, 9.1);
  cursorHide(tl, 9.1);
  revealWords(tl, P.noteW, 9.6, { y: 16, dur: 0.7, stagger: 0.04 });
  ft(tl, P.dash, { scale: 1, y: 0, autoAlpha: 1, filter: 'blur(0px)' }, { scale: 0.93, y: 40, autoAlpha: 0, filter: 'blur(10px)', duration: 0.8, ease: 'power2.in' }, 12.2);
  ft(tl, P.col, { autoAlpha: 1, y: 0 }, { autoAlpha: 0, y: -30, duration: 0.6, ease: 'power2.in' }, 12.4);
  hide(tl, P.sc, 13.19);
});

// S7 — signature
addScene('outro', (tl) => {
  const O = OUT;
  show(tl, O.sc, 0, 0.6);
  ft(tl, bg.state, { opacity: 0.6, bright: 1, lift: 0 }, { opacity: 1, bright: 1.5, lift: 0.7, duration: 6.5, ease: 'sine.inOut' }, 0);
  lockupIn(tl, O, 0.3, 0.85);
  ft(tl, O.trio, { autoAlpha: 0, letterSpacing: '.7em' }, { autoAlpha: 1, letterSpacing: '.34em', duration: 1.3, ease: 'power3.out' }, 3.3);
  ft(tl, O.avail, { autoAlpha: 0, y: 22 }, { autoAlpha: 1, y: 0, duration: 0.8, ease: 'expo.out' }, 4.3);
  ft(tl, O.lock, { scale: 1 }, { scale: 1.04, duration: 9, ease: 'sine.inOut' }, 0);
  ft(tl, fade, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.8, ease: 'power2.in' }, 8.2);
});

// halos lumineux qui dérivent sur toute la durée ; vignette allégée sur les scènes claires
master.fromTo($('.b1'), { x: 0, y: 0 }, { x: 320, y: 180, duration: T.duration, ease: 'sine.inOut' }, 0);
master.fromTo($('.b2'), { x: 0, y: 0 }, { x: -260, y: 220, duration: T.duration, ease: 'sine.inOut' }, 0);
master.fromTo(vignette, { opacity: 1 }, { opacity: 0.4, duration: 0.8, immediateRender: false }, S.explore[0]);
master.fromTo(vignette, { opacity: 0.4 }, { opacity: 1, duration: 0.6, immediateRender: false }, S.pro[0] - 0.4);

gsap.globalTimeline.pause();
const FPS = T.fps || 30;
window.__duration = T.duration;
window.__seek = (t) => new Promise((resolve) => {
  const tt = Math.max(0, Math.min(t, T.duration - 1e-4));
  master.seek(tt, false);
  bg.render(tt);
  const f = Math.round(tt * FPS);
  grain.style.backgroundPosition = `${(f * 97) % 256}px ${(f * 61) % 256}px`;
  requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
});
await window.__seek(0);
window.__ready = true;
