import { cn } from "../lib/cn";

/**
 * Wordmark Selio. Les PNG officiels (brand/) sont fournis à 4× ; ce composant
 * propose un wordmark textuel sobre pour les contextes où un PNG serait flou
 * ou trop lourd (favicon, extension), conformément à la DA (logo noir sur
 * fond clair, blanc sur fond noir, jamais recoloré).
 */
export function Wordmark({ className, size = 24 }: { className?: string; size?: number }) {
  return (
    <span
      className={cn("inline-flex items-center gap-2 font-semibold tracking-tight text-text select-none", className)}
      style={{ fontSize: Math.round(size * 0.8), lineHeight: `${size}px` }}
      aria-label="Selio"
    >
      <SelioMark size={size} />
      Selio
    </span>
  );
}

/** Symbole « S » stylisé en SVG monochrome (currentColor). */
export function SelioMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <path d="M17 6.5 11 3 5 6.5v4l6 3.5 6 3.5v3.5L11 21l-6-3.5" />
      <path d="M11 3v4" />
      <path d="M17 10.5 11 14" />
      <circle cx="19.5" cy="7.5" r="1" />
      <circle cx="4.5" cy="16.5" r="1" />
    </svg>
  );
}
