import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";

export interface MenuItem {
  label: ReactNode;
  onSelect: () => void;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
}

/** Menu déroulant léger (popover flottant, --shadow-md). */
export function Menu({ trigger, items, align = "end", className }: { trigger: (props: { open: boolean; toggle: () => void; id: string }) => ReactNode; items: MenuItem[]; align?: "start" | "end"; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={cn("relative inline-block", className)}>
      {trigger({ open, toggle: () => setOpen((o) => !o), id })}
      {open ? (
        <div
          id={id}
          role="menu"
          className={cn(
            "absolute z-40 mt-1 min-w-44 rounded-lg border border-border bg-surface p-1 shadow-md",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {items.map((it, i) => (
            <button
              key={i}
              role="menuitem"
              type="button"
              disabled={it.disabled}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-surface-muted disabled:opacity-50 [&>svg]:size-4",
                it.danger ? "text-danger" : "text-text",
              )}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
