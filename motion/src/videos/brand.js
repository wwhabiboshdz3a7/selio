/* Films de marque — compositions centrees en vmin : rendues en 9:16, 16:9 et 1:1. */
const FLEX = ["9x16", "16x9", "1x1"];
const gf = (k, l, t, size, rot, d) => {
  const i = ITEMS[k];
  return `<div class="abs"${an(d, "pop", 0.9, `left:${l}%;top:${t}%;width:${size}vmin;height:${size}vmin;margin:-${size / 2}vmin 0 0 -${size / 2}vmin;--ez:var(--back)`)}><div class="loop" style="--an:floatA;--du:${4 + (l % 3)}s;--r:${rot}deg;--fy:-2.6vmin;--fx:1vmin;width:100%;height:100%;filter:drop-shadow(0 2vmin 2vmin rgba(12,27,39,.28))">${garment(i.g, i.c, i.k)}</div></div>`;
};
const big = (txt, d = 0.15, size = 11.5, extra = "") => `<div class="disp" style="font-size:${size}vmin;${extra}">${words(txt, d, 0.09, 1)}</div>`;
const orbs = `<div class="orb loop" style="--an:floatA;--du:7s;--fy:-5vmin;width:60vmin;height:60vmin;left:-20vmin;top:-12vmin"></div><div class="orb loop" style="--an:floatA;--du:9s;--fy:6vmin;--fx:-3vmin;width:80vmin;height:80vmin;right:-34vmin;bottom:-26vmin;opacity:.7"></div>`;

reg("01-logo-reveal", {
  formats: FLEX,
  build: () => seq([{ dur: 6, cls: "navy", html: orbs + endCard() }]),
});

reg("02-manifeste", {
  formats: FLEX,
  build: () => seq([
    { dur: 2.7, cls: "deep", html: `<div class="chev-bg"></div><div class="center">${big("Votre dressing\n*dort.*", 0.2, 13)}</div>` },
    { dur: 3.1, cls: "light t-circle", html: `${gf("veste", 14, 15, 30, -12, 0.35)}${gf("robe", 86, 14, 28, 10, 0.5)}${gf("sac", 13, 86, 26, 8, 0.65)}${gf("basket", 86, 86, 30, -8, 0.8)}
      <div class="center" style="color:var(--pd);padding:0 6vmin">${big("Des pièces\nqu'on ne porte\n*plus.*", 0.5, 11)}</div>` },
    { dur: 3.3, cls: "navy t-wipe", html: `${orbs}<div class="center" style="padding:0 6vmin">${big("Et si elles faisaient\nle bonheur de\n*quelqu'un d'autre ?*", 0.45, 9.2)}</div>` },
    { dur: 3.2, cls: "creamy t-up", html: `<div class="center" style="color:var(--pd);gap:1vmin">
        <div class="disp"${an(0.5, "zoomIn", 0.7, "font-size:15vmin;font-weight:700")}>Vendez.</div>
        <div class="disp"${an(1.0, "zoomIn", 0.7, "font-size:15vmin;font-weight:700;color:var(--p)")}>Achetez.</div>
        <div class="disp it"${an(1.5, "zoomIn", 0.7, "font-size:15vmin;color:var(--terra)")}>Recommencez.</div></div>` },
    { dur: 4.6, cls: "navy t-circle", html: endCard() },
  ]),
});

reg("14-seconde-vie", {
  formats: FLEX,
  build: () => {
    const steps = ["Vendre", "Acheter", "Porter", "Revendre"];
    const ring = steps.map((s, i) => {
      const a = (i / 4) * Math.PI * 2 - Math.PI / 2;
      return `<div class="chip on"${an(0.7 + i * 0.28, "pop", 0.7, `position:absolute;left:${50 + Math.cos(a) * 44}%;top:${50 + Math.sin(a) * 44}%;margin:-3.4vmin 0 0 -13vmin;width:26vmin;justify-content:center;font-size:3.8vmin;padding:1.4vmin 0;--ez:var(--back)`)}>${s}</div>`;
    }).join("");
    return seq([
      { dur: 2.6, cls: "creamy", html: `${gf("tee", 50, 22, 34, -6, 0.2)}<div class="center" style="color:var(--pd);padding-top:26vmin">${big("Porté une fois ?", 0.5, 11)}</div>` },
      { dur: 2.9, cls: "navy t-circle", style: "--cy:25%", html: `${orbs}<div class="center" style="padding:0 6vmin">${big("Il mérite\nune *seconde vie.*", 0.45, 12)}</div>` },
      { dur: 4.2, cls: "light t-up", html: `<div class="center"><div style="position:relative;width:74vmin;height:74vmin">
          <svg viewBox="0 0 200 200" style="position:absolute;inset:0;transform:rotate(-90deg)"><circle cx="100" cy="100" r="88" fill="none" stroke="#c9d9e5" stroke-width="1.6" stroke-dasharray="1" pathLength="1"${an(0.4, "draw", 2.4, "--ez:var(--io)")}/></svg>
          <div class="spinl" style="position:absolute;inset:19vmin;--du:14s;color:var(--p)"><div${an(0.5, "spinIn", 1.1, "width:100%;height:100%")}>${ic.loop("#204868")}</div></div>
          ${ring}</div></div>` },
      { dur: 4.4, cls: "navy t-circle", html: endCard("La mode responsable\ncommence dans votre dressing", "Seconde main · Selio") },
    ]);
  },
});

/* 13 — installation sur l'ecran d'accueil (PWA), vertical uniquement */
reg("13-ecran-accueil", {
  formats: ["9x16"],
  build: () => {
    const cols = ["#7394ae", "#a3b9a5", "#d9a441", "#c9785c", "#e6b8b0", "#51677a", "#ead9c3", "#205068", "#9fb1bd", "#c9d9e5", "#b97f75"];
    let apps = "";
    for (let i = 0; i < 12; i++) {
      const x = 62 + (i % 4) * 160, y = 190 + Math.floor(i / 4) * 200;
      apps += i === 6
        ? `<div class="abs"${an(2.1, "moveFade", 1, `left:${x}px;top:${y}px;--y0:-520px;--s0:2.2;--r0:-18deg;--ez:var(--back)`)}><div style="width:116px;height:116px;border-radius:30px;background:var(--p);color:#fff;padding:22px;box-shadow:0 0 0 6px rgba(255,255,255,.9),0 24px 40px -10px rgba(12,27,39,.6)">${mark()}</div><div style="text-align:center;font-size:24px;font-weight:700;color:#fff;margin-top:10px">Selio</div></div>`
        : `<div class="abs"${an(0.5 + i * 0.05, "pop", 0.6, `left:${x}px;top:${y}px;width:116px;height:116px;border-radius:30px;background:${cols[i % cols.length]};opacity:.55`)}></div>`;
    }
    return seq([
      { dur: 6.2, cls: "navy", html: `<div class="chev-bg"></div>
        <div class="abs disp" style="left:80px;top:150px;font-size:98px;width:920px">${words("Selio, sur votre\n*écran d'accueil.*", 0.2, 0.08)}</div>
        <div${an(0.3, "upBig", 1.2, "position:absolute;left:160px;top:520px;width:760px;height:1560px")}>
          <div class="phone" style="left:0;top:0"><div class="notch"></div><div class="scr" style="background:linear-gradient(160deg,#2b5a80,#0c1b27)">${apps}
            <div${an(3.4, "up", 0.8, "position:absolute;left:40px;right:40px;top:860px;background:rgba(255,255,255,.95);border-radius:40px;padding:34px 38px;display:flex;gap:26px;align-items:center")}>
              <div style="width:84px;height:84px;border-radius:50%;background:var(--ok);padding:18px;flex:none">${ic.check()}</div>
              <div><div style="font-size:34px;font-weight:700;color:var(--pd)">Application installée</div><div style="font-size:28px;color:var(--mut)">Depuis votre navigateur, en un geste.</div></div></div>
          </div></div></div>` },
      { dur: 4.2, cls: "navy t-circle", html: endCard("Votre dressing,\ntoujours à portée de main", "Android · iPhone · Ordinateur") },
    ]);
  },
});
