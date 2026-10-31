// Habillage « mockup » : barre d'état iOS opaque (9:41) et retrait des éléments propres à la démonstration
// (bandeau, pastilles « Simulé », outils de simulation). Aucune donnée n'est ajoutée ni modifiée.
export const STATUS_H = 54;
export async function decorate(page, theme) {
  await page.evaluate(({ theme, h }) => {
    const hide = (el) => { if (el) el.style.setProperty("display", "none", "important"); };
    for (const el of document.querySelectorAll('[role="status"]')) if (el.textContent?.includes("Démonstration")) hide(el);
    for (const el of document.querySelectorAll("main span, main button, main summary, main details")) {
      const t = (el.textContent ?? "").trim();
      if (el.tagName === "SPAN" && t === "Simulé") hide(el);
      if ((el.tagName === "BUTTON" || el.tagName === "SUMMARY") && /^Simuler/.test(t)) hide(el.tagName === "SUMMARY" ? el.closest("details") : el);
    }
    const walk = document.createTreeWalker(document.querySelector("main") ?? document.body, NodeFilter.SHOW_TEXT);
    let n; const nodes = []; while ((n = walk.nextNode())) nodes.push(n);
    for (const t of nodes) {
      if (t.textContent.includes("Envoyer (simulé)")) t.textContent = t.textContent.replace("Envoyer (simulé)", "Envoyer");
      if (/Simulateur de démonstration/.test(t.textContent)) {
        t.textContent = t.textContent.replace(/\s*·?\s*Simulateur de démonstration\s*·?\s*/, "");
        const el = t.parentElement; if (el) el.textContent = el.textContent.replace(/\s*·\s*$/, "");
      }
    }
    // Fond opaque : couleur de l'en-tête sans sa transparence.
    const header = document.querySelector("header");
    let bg = header ? getComputedStyle(header).backgroundColor : "";
    const m = bg.match(/rgba?\(([^)]+)\)/);
    if (m) { const [r, g, b] = m[1].split(",").map((x) => x.trim()); bg = `rgb(${r}, ${g}, ${b})`; } else bg = theme === "dark" ? "#23202A" : "#FFFFFF";
    const ink = theme === "dark" ? "#FFFFFF" : "#000000";
    document.getElementById("ios-status")?.remove();
    const bar = document.createElement("div");
    bar.id = "ios-status";
    bar.style.cssText = `position:fixed;top:0;left:0;right:0;height:${h}px;z-index:2147483647;background:${bg};display:flex;align-items:center;justify-content:space-between;padding:6px 30px 0 42px;color:${ink};font:600 17px/1 -apple-system,"Inter",sans-serif;letter-spacing:-0.2px;-webkit-font-smoothing:antialiased`;
    const svg = (w, hh, inner) => `<svg width="${w}" height="${hh}" viewBox="0 0 ${w} ${hh}" fill="${ink}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
    const signal = svg(18, 12, '<rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/>');
    const wifi = svg(17, 12, '<path d="M8.5 2.2c2.6 0 5 1 6.8 2.7l1.2-1.3C14.4 1.6 11.6.4 8.5.4S2.6 1.6.5 3.6l1.2 1.3C3.5 3.2 5.9 2.2 8.5 2.2z"/><path d="M8.5 5.6c1.6 0 3.1.6 4.3 1.7l1.2-1.3C12.5 4.6 10.6 3.8 8.5 3.8S4.5 4.6 3 6l1.2 1.3c1.2-1.1 2.7-1.7 4.3-1.7z"/><path d="M8.5 9c.7 0 1.3.3 1.8.7l1.2-1.3c-.8-.7-1.9-1.2-3-1.2s-2.2.5-3 1.2l1.2 1.3c.5-.4 1.1-.7 1.8-.7z"/><circle cx="8.5" cy="11" r="1"/>');
    const battery = svg(27, 13, `<rect x="0.5" y="0.5" width="23" height="12" rx="3.5" fill="none" stroke="${ink}" stroke-opacity="0.4"/><rect x="2" y="2" width="20" height="9" rx="2"/><path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2z" fill-opacity="0.45"/>`);
    bar.innerHTML = `<span>9:41</span><span style="display:flex;align-items:center;gap:7px">${signal}${wifi}${battery}</span>`;
    document.body.appendChild(bar);
    document.body.style.paddingTop = `${h}px`;
    for (const el of document.querySelectorAll("header")) if (getComputedStyle(el).position === "sticky") el.style.top = `${h}px`;
  }, { theme, h: STATUS_H });
}
