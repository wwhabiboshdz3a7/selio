import { Wordmark } from "@selio/ui";

/**
 * Logo officiel (PNG fournis par la DA, exportés à 4×) : noir sur fond clair,
 * blanc sur fond sombre. Le wordmark textuel sert de repli accessible.
 */
export function Logo({ height = 24, className }: { height?: number; className?: string }) {
  return (
    <span className={className} style={{ display: "inline-flex", height }}>
      <img src="/logo-noir.png" alt="Selio" height={height} style={{ height, width: "auto" }} className="block dark:hidden" />
      <img src="/logo-blanc.png" alt="" aria-hidden height={height} style={{ height, width: "auto" }} className="hidden dark:block" />
      <noscript><Wordmark size={height} /></noscript>
    </span>
  );
}
