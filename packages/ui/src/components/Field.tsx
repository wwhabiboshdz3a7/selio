import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../lib/cn";

export interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
}

/** Enveloppe label / aide / erreur avec liaison ARIA. */
export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy = [hint ? hintId : null, error ? errId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label ? (
        <label htmlFor={id} className="text-sm font-medium text-text">
          {label}
          {required ? <span className="text-danger"> *</span> : null}
        </label>
      ) : null}
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint && !error ? (
        <p id={hintId} className="text-xs text-text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const control =
  "w-full rounded-md border border-border-strong bg-surface px-3 text-base text-text placeholder:text-text-subtle disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "prefix"> {
  invalid?: boolean;
  prefix?: ReactNode;
  suffix?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, prefix, suffix, ...rest },
  ref,
) {
  if (prefix || suffix) {
    return (
      <div className={cn("relative flex items-center", className)}>
        {prefix ? <span className="pointer-events-none absolute left-3 text-text-muted [&>svg]:size-4">{prefix}</span> : null}
        <input
          ref={ref}
          aria-invalid={invalid || undefined}
          className={cn(control, "h-9 md:h-9", prefix && "pl-9", suffix && "pr-9")}
          {...rest}
        />
        {suffix ? <span className="pointer-events-none absolute right-3 text-text-muted [&>svg]:size-4">{suffix}</span> : null}
      </div>
    );
  }
  return <input ref={ref} aria-invalid={invalid || undefined} className={cn(control, "h-9", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ className, invalid, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(control, "min-h-24 resize-y py-2 leading-normal", className)}
        {...rest}
      />
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  function Select({ className, invalid, children, ...rest }, ref) {
    return (
      <div className={cn("relative", className)}>
        <select
          ref={ref}
          aria-invalid={invalid || undefined}
          className={cn(control, "h-9 appearance-none pr-9")}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-text-muted" aria-hidden />
      </div>
    );
  },
);

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: ReactNode;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ label, className, ...rest }, ref) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-base text-text", className)}>
      <input ref={ref} type="checkbox" className="size-4 shrink-0 cursor-pointer rounded-sm border border-border-strong accent-[var(--primary)]" {...rest} />
      {label}
    </label>
  );
});

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/** Toggle : off gris 300, on noir (jamais orange). */
export function Toggle({ checked, onChange, label, description, disabled, className }: ToggleProps) {
  return (
    <label className={cn("flex cursor-pointer items-start justify-between gap-4", disabled && "cursor-not-allowed opacity-60", className)}>
      <span className="min-w-0">
        <span className="block text-base font-medium text-text">{label}</span>
        {description ? <span className="mt-0.5 block text-sm text-text-muted">{description}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors",
          checked ? "bg-primary" : "bg-gray-300",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "absolute top-0.5 left-0.5 size-4 rounded-full bg-surface transition-transform",
            checked && "translate-x-4",
          )}
        />
      </button>
    </label>
  );
}
