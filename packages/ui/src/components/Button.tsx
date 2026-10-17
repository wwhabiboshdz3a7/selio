import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "../lib/cn";

export type ButtonVariant = "primary" | "accent" | "brand" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  fullWidth?: boolean;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-on hover:bg-primary-hover border border-transparent",
  accent: "bg-accent text-accent-on hover:bg-accent-hover border border-transparent",
  /** Générateur IA (« premium ») : améthyste profond en dégradé, icône or, identique en clair et en sombre. */
  brand: "bg-brand text-white border border-transparent shadow-sm hover:brightness-110 [&>span>svg]:text-gold-300",
  secondary: "bg-surface text-text border border-border hover:bg-surface-muted",
  ghost: "bg-transparent text-text-muted hover:bg-surface-muted hover:text-text border border-transparent",
  danger: "bg-transparent text-danger hover:bg-surface-muted border border-transparent",
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-9 px-3.5 text-base gap-1.5",
  lg: "h-11 px-4 text-base gap-2",
};

const baseClass = "inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap select-none transition-colors";

/**
 * Classes d'un bouton, pour un lien qui en a l'apparence (<Link className={buttonClass(…)}>) :
 * un seul élément interactif, jamais un bouton dans un lien.
 */
export function buttonClass({ variant = "primary", size = "md", fullWidth, className }: { variant?: ButtonVariant; size?: ButtonSize; fullWidth?: boolean; className?: string } = {}): string {
  return cn(baseClass, variantClass[variant], sizeClass[size], "[&>svg]:size-4", fullWidth && "w-full", className);
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon, iconRight, fullWidth, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        baseClass,
        "disabled:cursor-not-allowed disabled:opacity-50",
        variantClass[variant],
        sizeClass[size],
        fullWidth && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon ? <span className="inline-flex [&>svg]:size-4" aria-hidden>{icon}</span> : null}
      {children}
      {iconRight ? <span className="inline-flex [&>svg]:size-4" aria-hidden>{iconRight}</span> : null}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: ButtonSize;
  variant?: "ghost" | "secondary";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = "md", variant = "ghost", className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-50 [&>svg]:size-4",
        variant === "ghost" ? "text-text-muted hover:bg-surface-muted hover:text-text" : "border border-border bg-surface text-text hover:bg-surface-muted",
        size === "sm" ? "size-8" : size === "lg" ? "size-11" : "size-9",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
