import {
  CONFIDENCE_LABELS, COMPARABLES_MESSAGES, PRICE_METHOD_LABELS, PRICE_NOT_ENOUGH_REFERENCES, PRICE_STRATEGY_LABELS, formatEuros,
  type ComparablesResponse, type ComparablesView,
} from "../shared/comparables";

/**
 * Section « Comparables Selio » du panneau (Selio Track) : fourchette P25 / P50 / P75, trois stratégies,
 * délai, nombre de comparables et méthode ; états chargement, hors ligne, non relié, Track non compris,
 * erreur. Texte seulement (`textContent`), jamais d'innerHTML : même un message du serveur reste du texte.
 * Estimation indicative : le prix reste le choix du vendeur (rien n'est modifié sur la page).
 */

type Children = (Node | string)[];

function h<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, props: { className?: string; text?: string } = {}, children: Children = []): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  for (const c of children) node.append(typeof c === "string" ? doc.createTextNode(c) : c);
  return node;
}

/** Ce qui part vers Selio, affiché en clair sous la section. */
export const COMPARABLES_SENT_NOTICE = "Seuls le titre, la marque, la taille, l'état et le prix de l'article sont envoyés à Selio, rien d'autre de la page.";

const POSITION_LABELS = {
  below: "sous la fourchette",
  within: "dans la fourchette",
  above: "au-dessus de la fourchette",
} as const;

function row(doc: Document, label: string, value: string): HTMLElement {
  return h(doc, "div", { className: "row" }, [h(doc, "span", { text: label }), h(doc, "span", { className: "num", text: value })]);
}

function days(d: number): string {
  const n = Math.max(1, Math.round(d));
  return `≈ ${n} jour${n > 1 ? "s" : ""}`;
}

function readyBody(doc: Document, data: ComparablesResponse): HTMLElement[] {
  const out: HTMLElement[] = [];
  const count = `${data.comparableCount} comparable${data.comparableCount > 1 ? "s" : ""}`;
  if (data.method === "none" || data.p25 === null || data.p50 === null || data.p75 === null) {
    out.push(h(doc, "p", { text: data.message ?? PRICE_NOT_ENOUGH_REFERENCES }));
    out.push(h(doc, "p", { className: "meta", text: `${count} · ${PRICE_METHOD_LABELS.none}` }));
    return out;
  }
  // Fourchette : une seule bande découpée par des filets (P50 en accent).
  out.push(
    h(doc, "div", { className: "strip" }, [
      h(doc, "div", {}, [h(doc, "span", { className: "k", text: "P25" }), h(doc, "span", { className: "v", text: formatEuros(data.p25) })]),
      h(doc, "div", { className: "mid" }, [h(doc, "span", { className: "k", text: "P50 (médian)" }), h(doc, "span", { className: "v", text: formatEuros(data.p50) })]),
      h(doc, "div", {}, [h(doc, "span", { className: "k", text: "P75" }), h(doc, "span", { className: "v", text: formatEuros(data.p75) })]),
    ]),
  );
  if (data.priceCheck?.priceCents !== null && data.priceCheck?.priceCents !== undefined && data.priceCheck.position) {
    out.push(row(doc, "Prix affiché", `${formatEuros(data.priceCheck.priceCents)} · ${POSITION_LABELS[data.priceCheck.position]}`));
  }
  if (data.strategies) {
    out.push(row(doc, PRICE_STRATEGY_LABELS.fast, formatEuros(data.strategies.fast)));
    out.push(row(doc, PRICE_STRATEGY_LABELS.standard, formatEuros(data.strategies.standard)));
    out.push(row(doc, PRICE_STRATEGY_LABELS.max, formatEuros(data.strategies.max)));
  }
  if (data.delayDays !== null) out.push(row(doc, "Délai de vente estimé", days(data.delayDays)));
  out.push(h(doc, "p", { className: "meta", text: `${count} · ${PRICE_METHOD_LABELS[data.method]} · confiance ${CONFIDENCE_LABELS[data.confidenceLevel]}` }));
  if (data.demo || data.message) out.push(h(doc, "p", { className: "msg warn", text: data.message ?? "Données de démonstration." }));
  out.push(h(doc, "p", { className: "meta", text: "Estimation indicative : le prix reste votre choix." }));
  return out;
}

/** Construit la section pour un état donné. `onRetry` ajoute un bouton « Réessayer » (hors ligne, erreur). */
export function renderComparables(doc: Document, view: ComparablesView, opts: { onRetry?: () => void } = {}): HTMLElement {
  const badge = view.state === "ready" && view.data.demo ? h(doc, "span", { className: "badge", text: "démonstration" }) : h(doc, "span", { className: "badge accent", text: "Track" });
  const section = h(doc, "section", { className: "cmp" });
  section.setAttribute("aria-label", "Comparables Selio");
  section.setAttribute("aria-live", "polite");
  section.setAttribute("aria-busy", view.state === "loading" ? "true" : "false");
  section.dataset.state = view.state;
  const body = h(doc, "div", { className: "cmp-body" });
  section.append(h(doc, "div", { className: "cmp-head" }, [h(doc, "span", { className: "cmp-title", text: "Comparables Selio" }), badge]), body);

  switch (view.state) {
    case "loading":
      body.append(h(doc, "p", { className: "msg", text: "Recherche des ventes comparables…" }));
      break;
    case "ready":
      body.append(...readyBody(doc, view.data));
      break;
    case "offline":
      body.append(h(doc, "p", { className: "msg err", text: view.message }));
      break;
    case "unpaired":
      body.append(h(doc, "p", { text: view.message }));
      break;
    case "track_unavailable":
      body.append(h(doc, "p", { text: view.message }), h(doc, "p", { className: "msg", text: COMPARABLES_MESSAGES.trackDetail }));
      break;
    case "error":
      body.append(h(doc, "p", { className: "msg err", text: view.message }));
      break;
  }
  if (opts.onRetry && (view.state === "offline" || view.state === "error")) {
    const retry = h(doc, "button", { className: "btn", text: "Réessayer" });
    retry.type = "button";
    retry.addEventListener("click", () => opts.onRetry?.());
    body.append(h(doc, "div", { className: "actions" }, [retry]));
  }
  if (view.state !== "unpaired" && view.state !== "track_unavailable") body.append(h(doc, "p", { className: "meta", text: COMPARABLES_SENT_NOTICE }));
  return section;
}
