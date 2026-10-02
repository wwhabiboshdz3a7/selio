import { SelioMark } from "./SelioMark";

export function Logo({ variant = "dark", size = "md" }: { variant?: "dark" | "light"; size?: "sm" | "md" | "lg" }) {
  const textColor = variant === "light" ? "text-white" : "text-[var(--color-selio-primary)]";
  const dims = size === "sm" ? "h-5 w-5" : size === "lg" ? "h-9 w-9" : "h-7 w-7";
  const textSize = size === "sm" ? "text-lg" : size === "lg" ? "text-3xl" : "text-2xl";
  return (
    <span className={`inline-flex items-center gap-2 ${textColor}`}>
      <SelioMark className={dims} />
      <span className={`${textSize} font-semibold tracking-tight`} style={{ fontFamily: "var(--font-display)" }}>Selio</span>
    </span>
  );
}
