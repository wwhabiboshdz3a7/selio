export function SelioMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M6 16 L24 8 L42 16" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 26 L24 18 L42 26" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.72" />
      <path d="M6 36 L24 28 L42 36" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.48" />
    </svg>
  );
}
