// Démo complète de Selio pour Felix Beauregard : enregistrement d'écran (CDP screencast) + sous-titres horodatés.
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
    await page.setContent(card('Démonstration complète', 'Pour Felix Beauregard · 16 novembre 2026', 'Vidéo sans son : tout est expliqué en sous-titres.<br>Toutes les données affichées à l’écran sont des exemples.'));
    await moveTo(1590, 890);
    await say('Bonjour Felix. Voici une visite complète de Selio, de la vitrine publique jusqu’à l’administration.', 6500);
    await say('La vidéo est sans son : tout est expliqué ici, en sous-titres. Les données affichées sont des exemples.', 6000);
    await flush();
  },

  async vitrine() {
    await go('/');
    await say('Voici la vitrine publique de Selio, en ligne sur seliovprod.netlify.app.');
    await hold(1500);
    await say('Selio, c’est la boîte à outils du revendeur Vinted : gérer, publier, négocier, acheter et analyser, au même endroit.');
    await scroll(700, 4500);
    await say('La gamme : Selio Manager, Studio, Track, Radar, Bot, Cloud, Agents et Comptes. Chaque produit a son rôle.');
    await scroll(800, 6000);
    await say('Le parcours complet, de l’achat jusqu’à l’étiquette d’envoi, en huit étapes.');
    await scroll(700, 5000);
    await say('Sourcing sur le marché avec Track, et bientôt auprès de fournisseurs partenaires (aucun accord signé pour l’instant).');
    await scroll(700, 5000);
    await say('Achat avec Radar, photos et annonce avec Studio, vente et négociation avec Bot.');
    await scroll(800, 5000);
    await say('Puis la commande, l’étiquette d’envoi et l’après-vente : tout le cycle de l’article.');
    await scroll(1200, 7000);
    await say('Tout en bas : appel à l’essai gratuit de 14 jours, et les liens vers chaque produit.');
    await scroll(3000, 6000);
    await flush();
    await go('/tarifs');
    await say('Les tarifs : trois forfaits, Starter, Pro et Agence, avec 14 jours d’essai gratuit.');
    await hold(2500);
    await scroll(650, 5000);
    await say('Au mois ou à l’année (deux mois offerts). Le tableau compare tout, fonction par fonction.');
    await scroll(1100, 7000);
    await say('Selio Comptes se vend à part, comme une prestation payée une fois.');
    await scroll(1200, 6000);
    await flush();
    await go('/produits/bot');
    await say('Chaque produit a sa propre page. Ici, Selio Bot : les automatisations qui travaillent pour vous.');
    await scroll(900, 6000);
    await flush();
    await go('/inscription');
    await say('L’inscription prend une minute. Pour l’instant, l’essai démarre sans carte bancaire : rien n’est débité.');
    await flush();
  },

  async hub() {
    await go('/demo?vers=/app/espaces');
    await page.waitForURL((u) => u.pathname === '/app/espaces', { timeout: 20000 }).catch(() => {});
    await sleep(800);
    await say('Pour la démo, on entre avec un compte d’exemple : Marie, revendeuse, boutique « Atelier Seconde Main ».');
    await hold(2000);
    await say('Voici l’accueil des espaces : toute la gamme Selio, avec l’état de chaque produit.');
    await scroll(700, 6000);
    await say('On passe d’un espace à l’autre avec le sélecteur en haut à gauche.');
    await scroll(900, 5000);
    await flush();
  },

  async manager() {
    await go('/app');
    await say('Selio Manager, l’outil de gestion au quotidien. La vue d’ensemble montre l’essentiel du mois.');
    await step('raccourcis', async () => { await point(page.getByText('Vos raccourcis').first()); });
    await say('En haut, vos raccourcis : chacun choisit les siens, retrouvés sur téléphone et sur ordinateur.');
    await step('modifier raccourcis', async () => {
      await click(page.getByRole('button', { name: 'Modifier les raccourcis' }));
      await say('On peut en ajouter, en retirer ou les remettre dans l’ordre qu’on veut.');
      await hold(3500);
      const close = page.getByRole('button', { name: /^(Terminer|Fermer|Annuler|OK)$/ }).first();
      if (await close.count()) await click(close); else await page.keyboard.press('Escape');
    });
    await step('kpi', async () => { await point(page.getByText('Chiffre d\'affaires').first()); });
    await say('Chiffre d’affaires, bénéfice, ventes, stock actif et choses à traiter, calculés depuis les vraies données du compte.');
    await step('alertes', async () => { await point(page.getByText(/tâche\(s\) d'automatisation en échec/).first()); });
    await say('Les alertes : une tâche automatique en échec, des actions à valider. Rien ne part sans règle claire.');
    await scroll(800, 5000);
    await say('Plus bas : ventes et marge, objectif du mois, catégories, meilleurs jours de vente, rendement du dressing.');
    await scroll(1100, 7000);
    await say('Et les dernières actions de Selio, tirées du journal d’activité.');
    await scroll(1500, 6000);
    await flush();
  },

  async journal() {
    await go('/app/journal');
    await say('Le journal d’activité raconte tout ce que Selio et l’équipe ont fait, en phrases simples.');
    await hold(1500);
    await say('Négociation, réponses, achats, ventes, bordereaux : chaque ligne dit qui, quoi et quand, avec un lien vers l’objet.');
    await scroll(500, 5000);
    await step('filtre auto', async () => {
      await scrollTop(); await sleep(400);
      await click(any(/^Automatique$/));
      await say('Filtre « Automatique » : seulement ce que Selio a fait tout seul. On peut aussi filtrer par membre, type et période.');
      await scroll(500, 4000);
      await scrollTop(); await sleep(400);
      await click(any(/^Tout$/));
    });
    await flush();
  },

  async items() {
    await go('/app/items');
    await say('Articles et stock : tout le stock, sur tous les comptes Vinted, avec les compteurs en tête.');
    await hold(1500);
    await say('Des filtres rapides : statut, à republier, sans photo, niveau de marge, catégorie, marque, compte.');
    await step('republier', async () => {
      await click(any(/^À republier/));
      await say('Exemple : les articles à republier, en un clic.');
      await hold(2500);
      await click(any(/^Tous actifs/));
    });
    await step('grille', async () => {
      await click(any(/^Grille$/));
      await say('Vue en grille, avec les photos…');
      await scroll(500, 3500); await scrollTop(); await sleep(300);
      await click(any(/^Liste$/));
      await say('… ou en liste, plus dense.');
    });
    await step('prix', async () => {
      await click(page.getByRole('button', { name: /^Modifier le prix de/ }).first());
      await say('Le prix se modifie directement dans la liste, sans ouvrir l’article. Entrée pour valider, Échap pour annuler.');
      await hold(3000);
      await page.keyboard.press('Escape');
    });
    await step('selection', async () => {
      const boxes = page.getByRole('checkbox', { name: /^Sélectionner / });
      await click(boxes.nth(0)); await click(boxes.nth(1)); await click(boxes.nth(2));
      await say('On peut sélectionner plusieurs articles pour des actions groupées : statut, prix, republication, archivage.');
      await hold(4000);
      await page.keyboard.press('Escape');
    });
    await step('fiche', async () => {
      await click(any('Pull col roulé Tommy Hilfiger rouge'));
      await say('La fiche d’un article : photos, prix, prix plancher, marge, historique et état de l’annonce.');
      await scroll(700, 5000);
      await scroll(900, 5000);
    });
    await flush();
  },

  async studio() {
    await go('/studio');
    await say('Selio Studio transforme des photos en annonce complète.');
    await step('photos', async () => {
      await click(page.getByRole('button', { name: 'Essayer avec des photos d\'exemple' }));
      await say('On ajoute les photos d’un ou plusieurs articles. Ici, des photos d’exemple : un jean et un pull.');
      await hold(2500);
      await click(page.getByRole('button', { name: 'Préparer l\'annonce' }));
      await sleep(2500);
      await say('Studio trie seul les photos par article et par rôle : face, dos, étiquette, mètre ruban.');
      await hold(3500);
      await click(page.getByRole('button', { name: 'Continuer vers l\'étiquette' }));
      await sleep(2000);
      await say('Il lit l’étiquette : marque, taille, matière. Rien n’est inventé : chaque information dit d’où elle vient.');
      await scroll(400, 3000);
      await click(page.getByRole('button', { name: 'Continuer vers les mesures' }));
      await sleep(2000);
      await say('Puis les mesures, lues sur le mètre ruban ou demandées au vendeur si elles manquent.');
      await scroll(400, 3000);
      await click(page.getByRole('button', { name: 'Générer l\'annonce' }));
      await sleep(3000);
      await say('Et voici l’annonce : titre, description, attributs, et trois prix proposés.');
      await scroll(500, 4500);
      await say('Vente rapide, standard ou marge maximale : vous choisissez. Rien n’est publié sans votre clic.');
      await scroll(600, 5000);
    });
    await flush();
  },

  async messages() {
    await go('/app/messages');
    await say('La messagerie réunit les conversations de tous vos comptes Vinted.');
    await step('conv', async () => {
      await click(any(/Léa M\./));
      await say('Dans une conversation, Selio propose une réponse et suit la négociation selon vos prix planchers.');
      await hold(3000);
      await scroll(500, 4000);
      await say('Une offre trop basse ? Contre-offre automatique, jamais sous le plancher. Vous gardez la main.');
    });
    await flush();
    await go('/app/orders');
    await say('Les commandes : à expédier, expédiées, livrées, avec le bordereau d’envoi.');
    await scroll(400, 4000);
    await flush();
  },

  async dressing() {
    await go('/app/dressing');
    await say('Le dressing intelligent note chaque annonce sur 100, dit quand la republier et avec quelle variante.');
    await scroll(700, 6000);
    await flush();
    await go('/app/analytics');
    await say('Les analyses : chiffre d’affaires, marge de l’achat à la revente, par catégorie, canal et marque.');
    await scroll(800, 6000);
    await say('Et une alerte avant les seuils de déclaration à l’administration fiscale.');
    await scroll(1000, 6000);
    await flush();
    await go('/app/automatisation');
    await say('Tout le parcours peut être automatisé, en quatre blocs : favoris, réponses, négociation, après-vente.');
    await scroll(800, 6000);
    await flush();
  },

  async bot() {
    await go('/bot');
    await say('Selio Bot regroupe les automatisations qui travaillent pour vous, selon vos règles et vos plafonds.');
    await hold(1500);
    await say('Sept bots : négociation, relance 24 h, republication, réponses, favoris, achat auto et après-vente.');
    await scroll(600, 5000);
    await say('Chacun montre son état, où il tourne, les limites du forfait et ses dernières actions.');
    await scroll(600, 4000);
    await step('tout arreter', async () => {
      await scrollTop(); await sleep(500);
      await click(any('Tout arrêter'));
      await say('Le bouton « Tout arrêter » coupe tous les bots d’un coup, immédiatement, côté serveur.');
      await hold(3500);
      await click(page.getByRole('button', { name: 'Annuler' }).first());
    });
    await step('nego', async () => {
      await click(any('Régler et surveiller'));
      await say('Exemple : le bot de négociation, ses règles et ses dernières actions.');
      await scroll(700, 5000);
    });
    await flush();
    await go('/bot/achat-auto');
    await say('L’achat auto : l’achat assisté vous propose chaque affaire à valider en un clic.');
    await scroll(600, 5000);
    await say('L’achat automatique attend la validation juridique : deux verrous côté serveur l’empêchent de partir.');
    await scroll(700, 5000);
    await flush();
  },

  async radar() {
    await go('/app/radar');
    await say('Selio Radar repère les bonnes affaires et note chacune sur 100, avec la revente estimée.');
    await scroll(700, 6000);
    await flush();
    await go('/app/purchase');
    await say('Les affaires à valider : vous gardez la main sur chaque achat.');
    await scroll(500, 4000);
    await flush();
  },

  async track() {
    await go('/track');
    await say('Selio Track analyse le marché : filtres suivis, tendances, niches et recherche par photo.');
    await hold(1500);
    await say('Dans cette démo, les chiffres du marché sont simulés : la lecture réelle s’ouvrira après validation juridique.');
    await scroll(400, 4000);
    await step('filtre', async () => {
      await go('/track/filtres');
      await click(any(/^Levi's 501 · Homme/));
      await say('Chaque filtre suivi est relu toutes les deux heures : prix médian, nouvelles annonces, annonces disparues.');
      await scroll(600, 5000);
      await say('Les alertes de tendance préviennent sur le téléphone : prix qui bouge, afflux d’annonces, ventes plus rapides.');
      await scroll(900, 6000);
    });
    await flush();
    await go('/track/niches');
    await say('Le scan de niche donne une note sur 100 : demande, vitesse de vente, concurrence et marge.');
    await scroll(500, 5000);
    await flush();
    await go('/track/photo');
    await say('Et la recherche par photo : une photo suffit pour estimer un prix. La photo n’est jamais gardée.');
    await flush();
  },

  async cloud() {
    await go('/cloud');
    await say('Selio Cloud fait tourner le Manager et le Bot 24 h/24, sans ordinateur allumé.');
    await scroll(500, 5000);
    await say('Tout est prêt techniquement ; l’ouverture attend l’avis de l’avocat.');
    await scroll(500, 4000);
    await flush();
    await go('/agents');
    await say('Selio Agents : les équipes, les rôles et les accès. Chaque personne a son identifiant et son rôle.');
    await scroll(500, 5000);
    await flush();
    await go('/comptes');
    await say('Selio Comptes aide à ouvrir et préparer une boutique Vinted : checklist et textes prêts à copier.');
    await scroll(900, 6000);
    await say('Une prestation est aussi proposée : audit, mise en place complète ou accompagnement de 30 jours.');
    await scroll(900, 5000);
    await flush();
  },

  async settings() {
    await go('/app/settings/billing');
    await say('Dans les paramètres : abonnement, factures, utilisation, équipe, parrainage et sécurité.');
    await scroll(500, 4500);
    await say('Un code promo s’ajoute ici. En attendant le paiement Revolut, l’essai démarre sans carte et rien n’est débité.');
    await scroll(700, 5000);
    await flush();
  },

  async admin() {
    await go('/admin');
    await say('Enfin, Selio Admin : l’espace de l’équipe Selio, séparé de l’espace client.');
    await hold(1500);
    await say('Le tableau de bord de croissance : inscrits, essais, payants, accès offerts, revenu mensuel estimé.');
    await scroll(500, 4000);
    await flush();
    await go('/admin/comptes');
    await say('La liste des comptes clients, avec recherche et filtres par qualification, forfait et statut.');
    await step('fiche', async () => {
      await click(any(/Vintage Sœurs/));
      await say('Sur chaque fiche : qualifier le compte (client, bêta-testeur, partenaire, équipe…), offrir un forfait, prolonger l’essai.');
      await scroll(500, 5000);
      await say('Et une note interne que le client ne voit jamais. Chaque action est gardée dans l’historique du compte.');
      await scroll(700, 5000);
    });
    await flush();
    await go('/admin/offres');
    await say('Les offres commerciales : nom, réduction, code promo, forfaits concernés, durée.');
    await step('offre', async () => {
      await click(page.getByRole('button', { name: 'Nouvelle offre' }));
      await typeIn(page.getByLabel(/Nom affiché/), 'Lancement bêta');
      await typeIn(page.getByLabel(/Code promo/), 'BETA30');
      await typeIn(page.getByLabel(/Remise/), '30');
      await say('Par exemple « Lancement bêta » : 30 % de remise avec le code BETA30.');
      const banner = page.getByLabel(/Afficher dans le bandeau/);
      if (await banner.count()) { await click(banner); }
      await say('On peut l’afficher dans le bandeau en haut du site, avec un aperçu du texte.');
      await scroll(500, 4000);
      await click(page.getByRole('button', { name: 'Créer l\'offre' }));
      await say('L’offre est créée : le code marche à l’inscription et sur la page Abonnement, et la remise apparaît sur la facture.');
      await hold(3000);
    });
    await flush();
    await go('/admin/track');
    await say('Et le pilotage de Track : état du lecteur, usage par client, bouton de pause.');
    await scroll(700, 5000);
    await flush();
  },

  async outro() {
    await page.setContent(card('Merci, Felix', 'Selio · Elias et Ibrahim', 'Bêta prévue fin novembre · essai gratuit de 14 jours · seliovprod.netlify.app<br>Réalisé par Ibrahim'));
    await moveTo(1590, 890);
    await say('Merci d’avoir regardé. Questions et retours bienvenus : Elias et Ibrahim.', 7000);
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
