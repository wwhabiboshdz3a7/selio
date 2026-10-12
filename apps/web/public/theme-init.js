// Applique le thème enregistré avant le premier rendu pour éviter un flash.
// Fichier externe (et non script inline) pour respecter la CSP « script-src 'self' ».
try {
  var t = localStorage.getItem("selio.theme");
  if (t === "dark" || t === "light") document.documentElement.setAttribute("data-theme", t);
} catch (e) {}
