import {
  useId,
  type CSSProperties,
  type ElementType,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "../lib/cn";
import { glassModeFor } from "../lib/glass";
import { useGlassCapabilities } from "../hooks/useGlassCapabilities";

/* Verre liquide (essai §6 « Liquid Glass ») : surface translucide floutée, liseré clair,
   reflet en haut, réfraction des bords (Chromium). Styles : styles/glass.css ; couleurs :
   uniquement les rôles et tokens --glass-* (aucune couleur en dur dans ce fichier).

   Replis : opaque sans backdrop-filter, avec prefers-reduced-transparency ou
   prefers-contrast: more (en CSS ET ici) ; pas d'animation avec prefers-reduced-motion.
   Le contenu est posé sur une sous-couche dont l'opacité garantit 4,5:1 sur blanc et noir. */

export type GlassTone = "light" | "dark" | "auto";
export type GlassIntensity = "soft" | "regular";

export interface GlassSurfaceProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  /** Élément rendu (div par défaut ; nav, aside, section…). */
  as?: ElementType;
  /** « auto » suit le thème de la page ; « light » / « dark » forcent le ton. */
  tone?: GlassTone;
  /** « soft » : moins de flou et un fond plus couvrant. */
  intensity?: GlassIntensity;
  /** Réfraction des bords par filtre SVG, appliquée seulement là où le navigateur la gère (Chromium). */
  refraction?: boolean;
  /** Force la surface opaque (comparaison avant / après, essai désactivé). */
  opaque?: boolean;
  children?: ReactNode;
  className?: string;
  /** Classes de la couche de contenu (celle qui porte la sous-couche de contraste). */
  contentClassName?: string;
}

export function GlassSurface({
  as: Component = "div",
  tone = "auto",
  intensity = "regular",
  refraction = true,
  opaque = false,
  children,
  className,
  contentClassName,
  style,
  ...rest
}: GlassSurfaceProps) {
  const caps = useGlassCapabilities();
  const decided = glassModeFor(caps);
  const mode = opaque ? "opaque" : decided.mode;
  const fallback = opaque ? "forced" : decided.reason;
  const refracts = mode === "glass" && refraction && caps.refraction;
  const motion = mode === "glass" && !caps.reducedMotion;

  // Identifiant du filtre SVG propre à l'instance (les caractères spéciaux de useId sont retirés).
  const filterId = `selio-glass-refraction-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const surfaceStyle: CSSProperties | undefined = refracts
    ? ({ ...style, "--_glass-refraction": `url(#${filterId})` } as CSSProperties)
    : style;

  return (
    <Component
      {...rest}
      className={cn("glass-surface", className)}
      style={surfaceStyle}
      data-glass={mode}
      data-glass-tone={tone}
      data-glass-intensity={intensity}
      data-glass-refraction={refracts ? "on" : "off"}
      data-glass-motion={motion ? "on" : "off"}
      data-glass-fallback={fallback ?? undefined}
    >
      {refracts ? (
        <>
          <svg
            className="glass-surface__filters"
            aria-hidden="true"
            focusable="false"
            width="0"
            height="0"
          >
            <filter
              id={filterId}
              x="0"
              y="0"
              width="100%"
              height="100%"
              colorInterpolationFilters="sRGB"
            >
              {/* Bruit à très basse fréquence, adouci : une ondulation large, pas un grain. */}
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.008 0.011"
                numOctaves={1}
                seed={7}
                result="bruit"
              />
              <feGaussianBlur in="bruit" stdDeviation="3" result="carte" />
              <feDisplacementMap
                in="SourceGraphic"
                in2="carte"
                scale={16}
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          </svg>
          <span className="glass-surface__rim" aria-hidden="true" />
        </>
      ) : null}
      <div
        className={cn("glass-surface__content", contentClassName)}
        data-glass-scrim={mode === "glass" ? "on" : "off"}
      >
        {children}
      </div>
    </Component>
  );
}
