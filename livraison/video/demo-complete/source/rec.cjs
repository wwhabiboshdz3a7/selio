// Démo complète de Selio : enregistrement d'écran (CDP screencast) + sous-titres horodatés.
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const B = process.env.BASE || 'http://127.0.0.1:4180';
const OUT = process.env.OUT || 'raw.mp4';
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const FPS = 30;

const caps = [];
let t0 = null, nextAllowed = 0, cur = { x: 800, y: 450 };
const now = () => Date.now() / 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${t0 ? (now() - t0).toFixed(1) : '-'}]`, ...a);

let page;
const any = (name) => ['button','tab','radio','link','checkbox','menuitem','option'].map((r) => page.getByRole(r, { name })).reduce((a, b) => a.or(b)).first();

async function say(text, ms) {
  const d = ms ?? Math.min(9000, Math.max(3500, 1600 + text.length * 62));
  const w = nextAllowed - Date.now();
  if (w > 0) await sleep(w);
  const t = now() - t0;
  if (caps.length && caps[caps.length - 1].end == null) caps[caps.length - 1].end = t;
  caps.push({ start: t, end: null, text });
  nextAllowed = Date.now() + d;
  log('SAY', text);
}
async function flush() { const w = nextAllowed - Date.now(); if (w > 0) await sleep(w); }
async function hold(ms) { await sleep(ms); }

async function moveTo(x, y, speed = 1) {
  const dist = Math.hypot(x - cur.x, y - cur.y);
  const steps = Math.max(8, Math.round(dist / (14 * speed)));
  for (let i = 1; i <= steps; i++) {
    const k = i / steps, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    await page.mouse.move(cur.x + (x - cur.x) * e, cur.y + (y - cur.y) * e);
    await sleep(12);
  }
  cur = { x, y };
}
async function reveal(loc) {
  await loc.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  await sleep(900);
}
async function point(loc) {
  await reveal(loc);
  const b = await loc.boundingBox();
  if (!b) throw new Error('pas de boîte');
  await moveTo(b.x + Math.min(b.width / 2, 60), b.y + b.height / 2);
  await sleep(300);
}
async function click(loc) { await point(loc); await page.mouse.down(); await sleep(70); await page.mouse.up(); await sleep(700); }
async function typeIn(loc, text) { await click(loc); await page.keyboard.press('Control+A'); await page.keyboard.type(text, { delay: 85 }); await sleep(400); }

// Défilement doux de la page (ou du conteneur principal qui défile).
async function scroll(px, ms = 3000) {
  await page.evaluate(async ({ px, ms }) => {
    const cands = [document.scrollingElement, ...document.querySelectorAll('main, main *, [data-scroll], div')];
    let el = null;
    for (const c of cands) { if (!c) continue; const cs = c === document.scrollingElement ? null : getComputedStyle(c); if ((c === document.scrollingElement || /(auto|scroll)/.test(cs.overflowY)) && c.scrollHeight > c.clientHeight + 40) { el = c; break; } }
    if (!el) return;
    const start = el.scrollTop, t0 = performance.now();
    await new Promise((res) => { const f = (t) => { const k = Math.min(1, (t - t0) / ms); const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; el.scrollTop = start + px * e; if (k < 1) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  }, { px, ms });
  await sleep(250);
}
async function scrollTop() { await page.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll('main, main *').forEach((e) => { if (e.scrollTop) e.scrollTop = 0; }); }); }
async function go(path) { await page.goto(B + path); try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch {} await sleep(700); }
async function step(name, fn) { try { await fn(); } catch (e) { log('ÉCHEC', name, e.message.split('\n')[0]); } }

function card(title, sub, small) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;font-family:Inter,Arial,sans-serif;background:linear-gradient(135deg,#121017 0%,#1E1A2B 60%,#2A2042 100%);color:#EEEBF3;overflow:hidden}
  .w{height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 140px;gap:26px}
  .e{letter-spacing:.3em;text-transform:uppercase;color:#B5A3FF;font-weight:600;font-size:20px}
  h1{font-size:84px;line-height:1.02;margin:0;font-weight:800;letter-spacing:-2px;opacity:0;transform:translateY(16px);animation:in .9s .2s forwards}
  p{font-size:32px;margin:0;color:#D9D4E6;opacity:0;animation:in .9s .7s forwards}
  small{font-size:22px;color:#9E98AE;opacity:0;animation:in .9s 1.2s forwards;max-width:1100px;line-height:1.45}
  @keyframes in{to{opacity:1;transform:none}}</style></head><body><div class="w"><div class="e">Selio</div><h1>${title}</h1><p>${sub}</p><small>${small}</small></div></body></html>`;
}

const SCENES = {
  async intro() {
    await page.setContent(card('Démonstration complète', 'L’écosystème Selio · novembre 2026', 'Selio : un écosystème de cinq filiales pour les vendeurs Vinted.<br>Vidéo sans son : tout est expliqué en sous-titres. Les données affichées sont des exemples.'));
    await moveTo(1590, 890);
    await say('Voici une visite complète de Selio, l’écosystème des vendeurs et des pros de l’achat-revente sur Vinted.', 7000);
    await say('Selio, ce sont cinq filiales : Manager, Studio, Track, Bot et Compte. La vidéo est sans son, et les données sont des exemples.', 7500);
    await flush();
  },

  async vitrine() {
    await go('/');
    await say('Voici la vitrine publique de Selio, en ligne sur seliovprod.netlify.app.');
    await hold(1500);
    await scroll(650, 4500);
    await say('Cinq filiales, chacune avec sa mission : gérer, créer les annonces, analyser le marché, trouver et acheter, accompagner.');
    await scroll(800, 6000);
    await say('Le parcours complet : Track analyse le marché, Bot trouve et achète, Studio crée l’annonce, Manager vend, négocie et expédie.');
    await scroll(1500, 9000);
    await say('Le sourcing auprès de fournisseurs partenaires arrivera ensuite : aucun accord n’est encore signé.');
    await scroll(1200, 6000);
    await flush();
    await go('/produits/manager');
    await say('Chaque filiale a sa page. Selio Manager : la gestion complète et l’automatisation de l’activité Vinted.');
    await scroll(700, 5500);
    await say('Selio Cloud et Selio Agent ne sont pas des filiales : ce sont deux fonctionnalités intégrées à Selio Manager.');
    await scroll(900, 6500);
    await flush();
    await go('/tarifs');
    await say('Les tarifs : 14 jours d’essai gratuit, puis Starter, Pro ou Agence, au mois ou à l’année.');
    await scroll(650, 5000);
    await say('Le tableau compare tout, filiale par filiale. Selio Compte se règle à la prestation ou sur devis.');
    await scroll(1500, 8000);
    await flush();
  },

  async hub() {
    await go('/demo?vers=/app/espaces');
    await page.waitForURL((u) => u.pathname === '/app/espaces', { timeout: 20000 }).catch(() => {});
    await sleep(800);
    await say('Pour la démo, on entre avec un compte d’exemple : Marie, revendeuse, boutique « Atelier Seconde Main ».');
    await hold(1500);
    await say('L’accueil réunit les cinq filiales : Selio Manager, Studio, Track, Bot et Compte.');
    await scroll(900, 7000);
    await say('Et, intégrés à Selio Manager, ses deux fonctionnalités : Selio Cloud et Selio Agent.');
    await scroll(1200, 6000);
    await flush();
  },

  async manager() {
    await go('/app');
    await say('Filiale 1 — Selio Manager : la gestion complète de l’activité Vinted, au même endroit, pour tous vos comptes.');
    await step('raccourcis', async () => { await point(page.getByText('Vos raccourcis').first()); });
    await say('La vue d’ensemble : vos raccourcis, puis le chiffre d’affaires, le bénéfice, les ventes, le stock et ce qu’il reste à traiter.');
    await step('kpi', async () => { await point(page.getByText('Chiffre d\'affaires').first()); });
    await hold(2000);
    await scroll(800, 5000);
    await say('Plus bas : ventes et marge, objectif du mois, catégories, meilleurs jours de vente, rendement du dressing.');
    await scroll(1200, 6500);
    await flush();
    await go('/app/journal');
    await say('Le journal d’activité raconte tout ce que Selio et l’équipe ont fait : réponses, négociations, ventes, bordereaux.');
    await scroll(500, 5000);
    await flush();
  },

  async items() {
    await go('/app/items');
    await say('Gestion du stock, centralisée : tous les articles de tous les comptes, avec filtres rapides et compteurs.');
    await step('republier', async () => {
      await click(any(/^À republier/));
      await say('Exemple : les articles à remettre en ligne, en un clic.');
      await hold(2500);
      await click(any(/^Tous actifs/));
    });
    await step('prix', async () => {
      await click(page.getByRole('button', { name: /^Modifier le prix de/ }).first());
      await say('Le prix se modifie directement dans la liste. On peut aussi agir sur plusieurs articles à la fois.');
      await hold(2500);
      await page.keyboard.press('Escape');
      const boxes = page.getByRole('checkbox', { name: /^Sélectionner / });
      await click(boxes.nth(0)); await click(boxes.nth(1));
      await hold(2500);
      await page.keyboard.press('Escape');
    });
    await step('fiche', async () => {
      await click(any('Pull col roulé Tommy Hilfiger rouge'));
      await say('La fiche d’un article : photos, prix, marge, rendement de l’annonce et prix conseillé.');
      await scroll(800, 5500);
    });
    await flush();
    await go('/app/dressing');
    await say('Le dressing intelligent note chaque annonce sur 100 et prépare la remise en ligne automatique au bon moment.');
    await scroll(600, 5500);
    await flush();
  },

  async messages() {
    await go('/app/messages');
    await say('La messagerie automatisée réunit les conversations de tous vos comptes.');
    await step('conv', async () => {
      await click(any(/Léa M\./));
      await say('Négociation par intelligence artificielle : Selio accepte, refuse ou fait une contre-offre, jamais sous votre prix plancher.');
      await hold(3000);
      await scroll(500, 4500);
    });
    await flush();
    await go('/app/orders');
    await say('Le suivi des commandes et des ventes, avec le bordereau d’envoi.');
    await scroll(400, 4000);
    await flush();
    await go('/app/analytics');
    await say('La gestion des marges : de l’achat à la revente, par catégorie, canal et marque, avec alerte avant les seuils fiscaux.');
    await scroll(900, 7000);
    await flush();
  },

  async automatisation() {
    await go('/app/automatisation');
    await say('Les automatisations du Manager : négociation par IA, relances, republication, réponses, messages aux favoris, après-vente.');
    await scroll(600, 5500);
    await say('Chacune montre son état et se règle selon vos limites. Un bouton arrête toutes les automatisations d’un coup.');
    await step('stop', async () => {
      await scrollTop(); await sleep(400);
      await click(any('Arrêter toutes les automatisations'));
      await hold(3000);
      await click(page.getByRole('button', { name: 'Annuler' }).first());
    });
    await scroll(1200, 6000);
    await flush();
  },

  async cloudAgent() {
    await go('/cloud');
    await say('Fonctionnalité du Manager — Selio Cloud : fait tourner certaines automatisations à distance, sans laisser votre ordinateur allumé.');
    await scroll(500, 5000);
    await say('Tout est prêt techniquement ; son ouverture attend la validation juridique.');
    await scroll(500, 4000);
    await flush();
    await go('/agents');
    await say('Fonctionnalité du Manager — Selio Agent : déléguer des tâches et des accès à des collaborateurs ou prestataires.');
    await scroll(500, 5000);
    await say('Chaque personne a son identifiant et un rôle qui décide de ce qu’elle voit et fait. Le travail en équipe devient simple.');
    await scroll(500, 4000);
    await flush();
  },

  async studio() {
    await go('/studio');
    await say('Filiale 2 — Selio Studio : la création et l’optimisation des annonces grâce à l’intelligence artificielle.');
    await step('studio', async () => {
      await click(page.getByRole('button', { name: 'Essayer avec des photos d\'exemple' }));
      await say('Étape 1 : les photos de l’article. Ici, un jean Levi’s : face, dos, étiquette et mètre ruban.');
      await hold(3000);
      await click(page.getByRole('button', { name: 'Préparer l\'annonce' }));
      await sleep(2500);
      await say('Studio trie seul les photos par article et par rôle.');
      await hold(2500);
      await click(page.getByRole('button', { name: 'Continuer vers l\'étiquette' }));
      await sleep(2000);
      await say('Il lit l’étiquette : marque, modèle, taille, matière. Chaque information indique d’où elle vient.');
      await scroll(400, 3500);
      await click(page.getByRole('button', { name: 'Continuer vers les mesures' }));
      await sleep(2000);
      await say('Puis les mesures, relevées sur le mètre ruban : rien n’est inventé.');
      await scroll(400, 3000);
      await click(page.getByRole('button', { name: 'Générer l\'annonce' }));
      await sleep(3500);
      const title = page.getByLabel(/^Titre/).first();
      await point(title);
      await say('Étape 2 : le titre, optimisé pour la recherche Vinted : modèle, coupe, coloris, taille et matière.', 6500);
      await hold(2500);
      const desc = page.getByLabel(/^Description/).first();
      await point(desc);
      await say('Étape 3 : la description complète : modèle et coupe, matière et entretien, état, mesures, conseils de taille, envoi.', 7500);
      await scroll(350, 7000);
      await say('Chaque mesure cite sa source. Les mots-clés et les attributs sont remplis automatiquement.', 6000);
      await scroll(450, 5000);
      await say('Étape 4 : le résultat final, avec trois prix proposés : vente rapide, standard ou marge maximale.', 6000);
      await scroll(500, 5000);
      await say('Rien n’est publié sans votre clic. Des minutes gagnées sur chaque article.', 5000);
    });
    await flush();
  },

  async track() {
    await go('/track');
    await say('Filiale 3 — Selio Track : l’analyse du marché et la recherche d’opportunités.');
    await hold(1500);
    await say('Dans cette démo, les chiffres du marché sont simulés : la lecture réelle s’ouvrira après validation juridique.');
    await scroll(400, 4000);
    await step('filtre', async () => {
      await go('/track/filtres');
      await click(any(/^Levi's 501 · Homme/));
      await say('Suivi du marché : chaque recherche est relue toutes les deux heures — prix médian, nouvelles annonces, annonces disparues.');
      await scroll(600, 5500);
      await say('Des alertes préviennent quand le prix bouge ou quand les ventes accélèrent.');
      await scroll(900, 5500);
    });
    await flush();
    await go('/track/niches');
    await say('L’analyse des niches : une note sur 100 selon la demande, la vitesse de vente, la concurrence et la marge.');
    await scroll(500, 5000);
    await flush();
    await go('/track/photo');
    await say('Produits similaires et estimation du prix de revente à partir d’une photo : une aide à la décision avant d’acheter ou de vendre.');
    await hold(2500);
    await say('Track analyse et identifie les opportunités. Il n’achète pas : c’est le rôle de Selio Bot.', 5500);
    await flush();
  },

  async bot() {
    await go('/bot');
    await say('Filiale 4 — Selio Bot : le bot de recherche et d’achat d’articles, distinct de Selio Manager.');
    await hold(1500);
    await say('Manager gère et automatise votre compte. Bot, lui, recherche, détecte et achète les articles.');
    await scroll(500, 5000);
    await say('Recherches automatisées selon vos critères, surveillance des annonces et alertes.');
    await scroll(500, 4500);
    await say('Des limites de dépenses par jour et par achat, et l’historique de tous les achats.');
    await scroll(700, 5500);
    await flush();
    await go('/app/radar');
    await say('Les bonnes affaires, chacune avec un score d’intérêt sur 100.');
    await step('affaire', async () => {
      await click(page.getByRole('link', { name: 'Ouvrir l\'affaire' }).first().or(page.getByRole('button', { name: 'Ouvrir l\'affaire' }).first()));
      await say('Pour chaque affaire : le prix de revente estimé et le potentiel de marge, frais compris.');
      await scroll(600, 5500);
    });
    await flush();
    await go('/app/purchase');
    await say('Achat rapide : vous validez chaque achat en un clic.');
    await step('valider', async () => {
      await click(page.getByRole('button', { name: /Valider l.achat/ }).first());
      await say('Un clic, et l’achat est validé, avec tous les contrôles : prix maximal, budget, plafond du jour, marge positive. (Simulé dans la démo.)', 7500);
      await hold(3000);
      await scroll(700, 5000);
      await say('L’historique des achats garde chaque achat, et son prix est reporté dans Selio Manager pour calculer la marge.');
    });
    await flush();
    await go('/bot/achat-auto');
    await say('L’achat automatique, avec plafonds et garde-fous. Il reste fermé tant que la validation juridique n’est pas obtenue.');
    await scroll(700, 6000);
    await flush();
  },

  async compte() {
    await go('/comptes');
    await say('Filiale 5 — Selio Compte : les services liés aux comptes Vinted et l’accompagnement personnalisé.');
    await hold(1500);
    await scroll(300, 3000);
    await say('Création de comptes Vinted selon les offres, comptes préparés ou non, et commandes en volume sur devis.');
    await hold(2500);
    await say('Configuration personnalisée de Selio Manager, et optimisation des messages aux favoris et de la négociation par IA.');
    await hold(2500);
    await say('Un accompagnement de 30 jours, et un accompagnement en cas de restriction : diagnostic sur devis, sans promesse de déblocage.');
    await scroll(500, 5000);
    await say('Et pour démarrer : une checklist pour ouvrir sa boutique, et des textes prêts à copier.');
    await scroll(900, 6000);
    await flush();
  },

  async admin() {
    await go('/app/settings/billing');
    await say('Côté client : l’abonnement, les factures et le code promo. En attendant le paiement en ligne, l’essai démarre sans débit.');
    await scroll(600, 5000);
    await flush();
    await go('/admin');
    await say('Enfin, Selio Admin : l’espace de l’équipe Selio, séparé de l’espace client, avec le tableau de bord de croissance.');
    await scroll(500, 4000);
    await flush();
    await go('/admin/comptes');
    await say('Les comptes clients : on peut les qualifier, offrir un forfait, prolonger un essai et noter un suivi interne.');
    await step('fiche', async () => {
      await click(any(/Vintage Sœurs/));
      await scroll(600, 5000);
    });
    await flush();
    await go('/admin/offres');
    await say('Les offres commerciales : une réduction, un code promo, et l’affichage dans le bandeau du site.');
    await step('offre', async () => {
      await click(page.getByRole('button', { name: 'Nouvelle offre' }));
      await typeIn(page.getByLabel(/Nom affiché/), 'Lancement bêta');
      await typeIn(page.getByLabel(/Code promo/), 'BETA30');
      await typeIn(page.getByLabel(/Remise/), '30');
      await say('Par exemple « Lancement bêta » : 30 % de remise avec le code BETA30.');
      await scroll(500, 4000);
      await click(page.getByRole('button', { name: 'Créer l\'offre' }));
      await hold(2500);
    });
    await flush();
  },

  async outro() {
    await page.setContent(card('Merci de votre attention', 'Selio Manager · Studio · Track · Bot · Compte', 'Selio Cloud et Selio Agent : intégrés à Selio Manager.<br>Bêta prévue fin novembre · essai gratuit de 14 jours · seliovprod.netlify.app<br>Réalisé par Ibrahim'));
    await moveTo(1590, 890);
    await say('Merci d’avoir regardé. Cinq filiales, un seul écosystème. Questions et retours bienvenus : Elias et Ibrahim.', 7500);
    await flush();
    await sleep(1500);
  },
};

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.2, colorScheme: 'light' });
  await ctx.addInitScript(() => {
    const mk = () => {
      if (document.getElementById('__cur') || !document.documentElement) return;
      const c = document.createElement('div'); c.id = '__cur';
      c.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;left:-50px;top:-50px;width:26px;height:26px;transform:translate(-4px,-3px)';
      c.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2.5l6.5 18 2.6-7.4 7.4-2.6z" fill="#fff" stroke="#15121c" stroke-width="1.6" stroke-linejoin="round"/></svg>';
      document.documentElement.appendChild(c);
      try { const s = sessionStorage.getItem('__cur'); if (s) { const [x, y] = s.split(','); c.style.left = x + 'px'; c.style.top = y + 'px'; } } catch {}
    };
    document.addEventListener('mousemove', (e) => { mk(); const c = document.getElementById('__cur'); if (c) { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; } try { sessionStorage.setItem('__cur', e.clientX + ',' + e.clientY); } catch {} }, true);
    document.addEventListener('mousedown', (e) => { const r = document.createElement('div'); r.style.cssText = `position:fixed;z-index:2147483646;pointer-events:none;left:${e.clientX - 18}px;top:${e.clientY - 18}px;width:36px;height:36px;border-radius:50%;background:rgba(100,66,214,.38);transition:transform .5s ease-out,opacity .5s ease-out`; document.documentElement.appendChild(r); requestAnimationFrame(() => { r.style.transform = 'scale(1.9)'; r.style.opacity = '0'; }); setTimeout(() => r.remove(), 700); }, true);
    if (document.readyState !== 'loading') mk(); else document.addEventListener('DOMContentLoaded', mk);
  });
  page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  // Prépare la démo (session et données d'exemple) avant de filmer.
  await page.goto(B + '/demo?vers=/app'); await page.waitForURL((u) => u.pathname === '/app', { timeout: 20000 });
  await page.setContent('<html><body style="margin:0;background:#121017"></body></html>');

  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'mjpeg', '-framerate', String(FPS), '-i', '-', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', OUT], { stdio: ['pipe', 'inherit', 'inherit'] });
  let last = null, slot = 0, written = 0;
  const writeUntil = (t) => { const target = Math.floor(t * FPS); while (last && slot < target) { ff.stdin.write(last); slot++; written++; } };
  const cdp = await ctx.newCDPSession(page);
  cdp.on('Page.screencastFrame', async (f) => {
    const t = now();
    if (t0 === null) t0 = t;
    writeUntil(t - t0);
    last = Buffer.from(f.data, 'base64');
    try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch {}
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  await sleep(300);
  // Petit mouvement pour forcer une première image.
  await page.mouse.move(cur.x, cur.y);
  while (t0 === null) await sleep(50);

  for (const [name, fn] of Object.entries(SCENES)) {
    if (ONLY && !ONLY.includes(name)) continue;
    log('=== SCÈNE', name);
    await step(name, fn);
  }
  await flush();
  const tEnd = now() - t0;
  if (caps.length && caps[caps.length - 1].end == null) caps[caps.length - 1].end = tEnd;
  // Images fixes en fin : on complète jusqu'à la fin.
  writeUntil(tEnd);
  await cdp.send('Page.stopScreencast').catch(() => {});
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  fs.writeFileSync(OUT.replace(/\.mp4$/, '.caps.json'), JSON.stringify(caps, null, 1));
  log('FIN', tEnd.toFixed(1), 's,', written, 'images');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
