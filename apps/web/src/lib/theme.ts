import { useCallback, useEffect, useState } from "react";

export type ThemePreference = "light" | "dark" | "system";
const KEY = "selio.theme";

export function readThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(pref: ThemePreference): void {
  const root = document.documentElement;
  if (pref === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", pref);
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    // stockage indisponible
  }
}

export function useTheme(): { preference: ThemePreference; setPreference: (p: ThemePreference) => void; resolved: "light" | "dark" } {
  const [preference, setPref] = useState<ThemePreference>(() => readThemePreference());
  const [systemDark, setSystemDark] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const setPreference = useCallback((p: ThemePreference) => {
    applyTheme(p);
    setPref(p);
  }, []);
  return { preference, setPreference, resolved: preference === "system" ? (systemDark ? "dark" : "light") : preference };
}
