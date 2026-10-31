import { Wordmark } from "@selio/ui";

/**
 * Logo officiel (PNG fournis par la DA, exportés à 4×) : noir sur fond clair,
 * blanc sur fond sombre. `inverse` force la version blanche (en-tête posé sur
 * le ciel nocturne de la vitrine, quel que soit le thème). Le wordmark textuel
 * sert de repli accessible.
 */
export function Logo({ height = 24, className, inverse = false }: { height?: number; className?: string; inverse?: boolean }) {
  return (
    <span className={className} style={{ display: "inline-flex", height }}>
      <img src="/logo-noir.png" alt="Selio" height={height} style={{ height, width: "auto" }} className={inverse ? "hidden" : "block dark:hidden"} />
      <img src="/logo-blanc.png" alt={inverse ? "Selio" : ""} aria-hidden={inverse ? undefined : true} height={height} style={{ height, width: "auto" }} className={inverse ? "block" : "hidden dark:block"} />
      <noscript><Wordmark size={height} /></noscript>
    </span>
  );
}
