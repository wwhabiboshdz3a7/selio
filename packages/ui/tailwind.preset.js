// Selio — preset Tailwind **v3** branché sur tokens.css.
// Fichier fourni par la DA, converti en ESM (le monorepo est en "type": "module",
// `module.exports` y provoquait une erreur) et complété :
//   - `inherit` ajouté aux couleurs (sinon `text-inherit` disparaît) ;
//   - gris bruts 300/400/900 exposés pour les graphiques et les toggles ;
//   - `darkMode` conservé au format `['class', '[data-theme="dark"]']` (v3.4+ : `['selector', ...]`).
// L'application web utilise Tailwind **v4** : l'équivalent CSS-first est
// `src/styles/theme.css`. Ce preset reste disponible pour un projet en v3.

/** @type {import('tailwindcss').Config} */
const preset = {
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    colors: {
      transparent: "transparent",
      current: "currentColor",
      inherit: "inherit",
      white: "var(--gray-0)",
      black: "var(--gray-950)",
      bg: "var(--bg)",
      surface: { DEFAULT: "var(--surface)", muted: "var(--surface-muted)" },
      border: { DEFAULT: "var(--border)", strong: "var(--border-strong)" },
      text: {
        DEFAULT: "var(--text)",
        muted: "var(--text-muted)",
        subtle: "var(--text-subtle)",
        inverse: "var(--text-inverse)",
      },
      primary: { DEFAULT: "var(--primary)", hover: "var(--primary-hover)", on: "var(--on-primary)" },
      accent: {
        DEFAULT: "var(--accent)",
        hover: "var(--accent-hover)",
        soft: "var(--accent-soft)",
        vivid: "var(--accent-vivid)",
        on: "var(--on-accent)",
      },
      gray: { 300: "var(--gray-300)", 400: "var(--gray-400)", 900: "var(--gray-900)" },
      success: "var(--success)",
      warning: "var(--warning)",
      danger: "var(--danger)",
    },
    fontFamily: {
      sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      mono: ["ui-monospace", "SF Mono", "Menlo", "Consolas", "monospace"],
    },
    fontSize: {
      xs: ["12px", "16px"],
      sm: ["13px", "18px"],
      base: ["14px", "20px"],
      md: ["16px", "24px"],
      lg: ["20px", { lineHeight: "26px", letterSpacing: "-0.02em" }],
      xl: ["24px", { lineHeight: "30px", letterSpacing: "-0.02em" }],
      "2xl": ["32px", { lineHeight: "38px", letterSpacing: "-0.02em" }],
      "3xl": ["48px", { lineHeight: "52px", letterSpacing: "-0.03em" }],
    },
    fontWeight: { normal: "400", medium: "500", semibold: "600" },
    borderRadius: { none: "0", sm: "6px", DEFAULT: "8px", md: "8px", lg: "12px", xl: "16px", full: "999px" },
    boxShadow: {
      none: "none",
      sm: "0 1px 2px rgba(11,11,12,0.04)",
      md: "0 4px 16px rgba(11,11,12,0.06)",
      lg: "0 12px 40px rgba(11,11,12,0.10)",
    },
    extend: {
      spacing: { sidebar: "232px" },
      maxWidth: { content: "1280px" },
      transitionTimingFunction: { selio: "cubic-bezier(0.2, 0, 0, 1)" },
    },
  },
};

export default preset;
