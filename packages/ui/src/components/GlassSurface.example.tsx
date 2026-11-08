/* Page d'exemple du verre liquide (essai §6). NON livrée dans l'application : elle n'est
   pas exportée par index.ts. Elle sert aux captures avant / après (clair, sombre) et à
   vérifier les replis : posez-la dans un bac à sable qui importe @selio/ui/styles/base.css.
   Aucune couleur en dur : les fonds de test utilisent les tokens de la charte. */
import type { CSSProperties, ReactNode } from "react";
import { GlassSurface, type GlassIntensity, type GlassTone } from "./GlassSurface";
import { useGlassCapabilities } from "../hooks/useGlassCapabilities";
import { glassModeFor } from "../lib/glass";

/* Fonds volontairement difficiles : blanc pur, noir pur, dégradé de marque, rayures. */
const BACKDROPS: { label: string; style: CSSProperties }[] = [
  { label: "Blanc", style: { background: "var(--gray-0)" } },
  { label: "Noir", style: { background: "var(--gray-950)" } },
  { label: "Dégradé de marque", style: { background: "var(--brand-gradient)" } },
  {
    label: "Rayures encre / porcelaine",
    style: {
      backgroundImage:
        "repeating-linear-gradient(135deg, var(--gray-950) 0 14px, var(--porcelain) 14px 28px, var(--gold-400) 28px 34px)",
    },
  },
];

const VARIANTS: { tone: GlassTone; intensity: GlassIntensity }[] = [
  { tone: "auto", intensity: "regular" },
  { tone: "light", intensity: "regular" },
  { tone: "dark", intensity: "regular" },
  { tone: "auto", intensity: "soft" },
];

function Backdrop({ style, children }: { style: CSSProperties; children: ReactNode }) {
  return (
    <div
      style={{ ...style, borderRadius: "var(--radius-xl)", padding: "var(--space-6)" }}
      className="grid gap-4 sm:grid-cols-2"
    >
      {children}
    </div>
  );
}

export function GlassSurfaceExample() {
  const caps = useGlassCapabilities();
  const { mode, reason } = glassModeFor(caps);

  return (
    <div className="mx-auto grid max-w-content gap-8 p-6">
      <header className="grid gap-2">
        <h1 className="text-xl font-semibold text-text">Essai : verre liquide</h1>
        <p className="text-sm text-text-muted">
          Rendu actuel : <strong>{mode === "glass" ? "verre" : "opaque"}</strong>
          {reason ? ` (repli : ${reason})` : null} · backdrop-filter {caps.backdrop ? "oui" : "non"}{" "}
          · réfraction {caps.refraction ? "oui" : "non"} · mouvement réduit{" "}
          {caps.reducedMotion ? "oui" : "non"} · contraste renforcé{" "}
          {caps.moreContrast ? "oui" : "non"} · transparence réduite{" "}
          {caps.reducedTransparency ? "oui" : "non"}
        </p>
      </header>

      {BACKDROPS.map((backdrop) => (
        <section key={backdrop.label} className="grid gap-2">
          <h2 className="text-md font-semibold text-text">{backdrop.label}</h2>
          <Backdrop style={backdrop.style}>
            {VARIANTS.map((v) => (
              <GlassSurface
                key={`${v.tone}-${v.intensity}`}
                tone={v.tone}
                intensity={v.intensity}
                className="p-3"
              >
                <div className="grid gap-1 p-3">
                  <strong className="text-md">
                    Ton {v.tone} · {v.intensity === "soft" ? "doux" : "normal"}
                  </strong>
                  <span className="text-sm text-text-muted">
                    Une affaire vient d'arriver : 42 € au lieu de 60 €.
                  </span>
                </div>
              </GlassSurface>
            ))}
            <GlassSurface opaque className="p-3">
              <div className="grid gap-1 p-3">
                <strong className="text-md">Avant (surface opaque)</strong>
                <span className="text-sm text-text-muted">La charte actuelle, pour comparer.</span>
              </div>
            </GlassSurface>
          </Backdrop>
        </section>
      ))}

      <section className="grid gap-2">
        <h2 className="text-md font-semibold text-text">Dock mobile (maquette)</h2>
        <div
          style={{
            ...BACKDROPS[3]!.style,
            borderRadius: "var(--radius-xl)",
            height: 220,
            position: "relative",
          }}
        >
          <GlassSurface
            as="nav"
            aria-label="Navigation principale (exemple)"
            className="absolute inset-x-4 bottom-4 rounded-full p-1.5"
            contentClassName="flex items-center justify-around gap-2 px-2 py-2"
          >
            <span className="text-sm font-medium">Accueil</span>
            <span className="text-sm font-medium">Annonces</span>
            <span className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-on">
              Générer
            </span>
            <span className="text-sm font-medium">Radar</span>
            <span className="text-sm font-medium">Plus</span>
          </GlassSurface>
        </div>
      </section>
    </div>
  );
}

export default GlassSurfaceExample;
