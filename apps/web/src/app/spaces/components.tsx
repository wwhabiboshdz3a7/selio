import type { ReactNode } from "react";
import { Alert } from "@selio/ui";
import { useData } from "../../lib/data/provider";

/**
 * Bandeau des espaces en aperçu (Agents) ou en développement (Track, Cloud,
 * générateur de compte) : ce qui existe, ce qui n'existe pas encore, et ce que
 * le mode connecté enregistre.
 */
export function PreviewNotice({ space, children }: { space: "agents" | "development"; children?: ReactNode }) {
  const { mode } = useData();
  const title = space === "agents" ? "Selio Agents est en aperçu" : "En développement";
  return (
    <Alert tone="info" className="mb-6" title={title}>
      {children}
      {mode === "connected" ? <> Sur votre compte, cet espace se consulte en lecture : rien n'y est encore enregistré ni relié.</> : null}
    </Alert>
  );
}

/** Initiales proposées pour un logo texte (« Atelier Seconde Main » → « AS »). */
export function initialsOf(name: string): string {
  return name.split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "S";
}

/**
 * Logo texte d'une marque blanche : les initiales sur la couleur d'accent.
 * La couleur vient du `data-accent` d'un parent (ou de `accent`, posé ici).
 */
export function BrandMark({ initials, size = 28, accent }: { initials: string; size?: number; accent?: string }) {
  return (
    <span aria-hidden data-accent={accent} className="inline-flex shrink-0 items-center justify-center rounded-md bg-accent font-semibold text-accent-on" style={{ width: size, height: size, fontSize: Math.round(size * (initials.length > 2 ? 0.34 : 0.42)) }}>
      {initials || "?"}
    </span>
  );
}

/** Étiquette « Exemple fictif » des données de démonstration de l'agence. */
export function ExampleTag() {
  return <span className="inline-flex h-5 shrink-0 items-center rounded-sm border border-dashed border-border-strong px-1.5 text-[11px] leading-none font-medium whitespace-nowrap text-text-muted">Exemple fictif</span>;
}
