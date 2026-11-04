import tokensCss from "@selio/ui/styles/tokens.css?raw";

/**
 * Feuille de style du panneau (shadow DOM fermé, monde isolé). Les couleurs viennent des RÔLES de la charte
 * (`packages/ui/src/styles/tokens.css`, embarqué tel quel et rattaché à `:host`) : aucun hex dans les
 * règles ci-dessous. Clair et sombre suivent le système, comme l'application.
 */

/** Variables de tokens.css rattachées à l'hôte du panneau (`:root` n'existe pas dans un shadow DOM). */
export function scopeTokens(css: string): string {
  const variables = css.split("/* ---- Base")[0] ?? css;
  return variables
    .replace(/:root:not\(\[data-theme="light"\]\)/g, ":host")
    .replace(/:root\[data-theme="dark"\]/g, ':host([data-theme="dark"])')
    .replace(/:root/g, ":host");
}

/** Règles du panneau : rôles seulement (`var(--…)`). */
export const PANEL_RULES = `
:host { all: initial; }
* { box-sizing: border-box; font-family: var(--font-sans); }
.wrap { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; width: 340px; max-width: calc(100vw - 32px); color: var(--text); }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-md); overflow: hidden; }
.head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
.title { font-size: var(--text-sm); font-weight: var(--weight-semibold); }
.badge { font-size: 11px; font-weight: var(--weight-medium); color: var(--text-muted); background: var(--surface-muted); border-radius: var(--radius-sm); padding: 2px 6px; white-space: nowrap; }
.badge.accent { color: var(--accent); background: var(--accent-soft); }
.body { padding: 12px; font-size: var(--text-sm); line-height: 18px; max-height: 60vh; overflow: auto; }
.row { display: flex; justify-content: space-between; gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--border); }
.row span:first-child { color: var(--text-muted); }
.num { font-variant-numeric: tabular-nums; font-weight: var(--weight-medium); }
.btn { appearance: none; border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: var(--radius-md); height: 32px; padding: 0 12px; font-size: var(--text-sm); font-weight: var(--weight-medium); cursor: pointer; }
.btn:hover { background: var(--surface-muted); }
.btn.primary { background: var(--primary); color: var(--on-primary); border-color: var(--primary); }
.btn.primary:hover { background: var(--primary-hover); }
.btn.accent { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
.btn.accent:hover { background: var(--accent-hover); }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.btn:focus-visible, .toggle:focus-visible, input:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.msg { margin: 8px 0 0; font-size: var(--text-xs); color: var(--text-muted); }
.msg.err { color: var(--danger); }
.msg.ok { color: var(--success); }
.msg.warn { color: var(--warning); }
.draft { margin-top: 8px; border: 1px dashed var(--border-strong); border-radius: var(--radius-md); padding: 8px; white-space: pre-wrap; }
.toggle { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; height: 36px; padding: 0 12px; border-radius: var(--radius-full); background: var(--primary); color: var(--on-primary); border: 0; font-size: var(--text-sm); font-weight: var(--weight-semibold); cursor: pointer; box-shadow: var(--shadow-md); }
input { height: 32px; border: 1px solid var(--border-strong); border-radius: var(--radius-md); padding: 0 8px; font-size: var(--text-sm); width: 110px; background: var(--surface); color: var(--text); }
label { display: flex; align-items: center; gap: 6px; margin-top: 8px; color: var(--text-muted); font-size: var(--text-xs); }
ul { margin: 6px 0 0; padding-left: 16px; color: var(--text-muted); font-size: var(--text-xs); }
p { margin: 0 0 6px; }
.cmp { margin-top: 12px; border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden; }
.cmp-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--border); background: var(--surface-muted); }
.cmp-title { font-size: var(--text-sm); font-weight: var(--weight-semibold); }
.cmp-body { padding: 8px 10px; }
.strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border: 1px solid var(--border); border-radius: var(--radius-md); margin-bottom: 8px; }
.strip > div { padding: 6px 8px; display: flex; flex-direction: column; gap: 2px; }
.strip > div + div { border-left: 1px solid var(--border); }
.strip .k { font-size: 11px; color: var(--text-muted); }
.strip .v { font-variant-numeric: tabular-nums; font-weight: var(--weight-semibold); }
.strip .mid .v { color: var(--accent); }
.meta { margin-top: 6px; font-size: var(--text-xs); color: var(--text-muted); }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;

export const PANEL_CSS = `${scopeTokens(tokensCss)}\n${PANEL_RULES}`;
