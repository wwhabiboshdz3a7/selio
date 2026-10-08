import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "../lib/cn";
import { Button } from "./Button";
import { IconButton } from "./Button";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** Sur mobile, la boîte devient une feuille en bas d'écran. */
  sheet?: boolean;
}

/** Modale accessible (focus piégé par <dialog>, Échap, clic sur le voile). */
export function Dialog({ open, onClose, title, description, children, footer, size = "md", sheet = true }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    el.addEventListener("cancel", onCancel);
    return () => el.removeEventListener("cancel", onCancel);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        "m-0 max-h-[100dvh] w-full max-w-none bg-transparent p-0 text-text backdrop:bg-black/40",
        "open:flex open:items-end open:justify-center md:open:items-center",
        !sheet && "open:items-center",
      )}
    >
      <div
        className={cn(
          "flex max-h-[92dvh] w-full flex-col overflow-hidden border border-border bg-surface shadow-lg",
          sheet ? "rounded-t-xl md:rounded-xl" : "rounded-xl",
          size === "sm" && "md:max-w-md",
          size === "md" && "md:max-w-lg",
          size === "lg" && "md:max-w-3xl",
        )}
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-1 text-sm text-text-muted">
                {description}
              </p>
            ) : null}
          </div>
          <IconButton label="Fermer" onClick={onClose} size="sm">
            <X />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div> : null}
      </div>
    </dialog>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  /** Mot à retaper pour confirmer (suppressions définitives). */
  typeToConfirm?: string;
  typed?: string;
  onTypedChange?: (v: string) => void;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  danger,
  loading,
  typeToConfirm,
  typed,
  onTypedChange,
}: ConfirmDialogProps) {
  const blocked = Boolean(typeToConfirm) && typed !== typeToConfirm;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={() => void onConfirm()} loading={loading} disabled={blocked}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {typeToConfirm ? (
        <label className="block text-sm">
          <span className="text-text-muted">
            Tapez <span className="font-medium text-text">{typeToConfirm}</span> pour confirmer.
          </span>
          <input
            className="mt-2 h-9 w-full rounded-md border border-border-strong bg-surface px-3"
            value={typed ?? ""}
            onChange={(e) => onTypedChange?.(e.target.value)}
            autoComplete="off"
          />
        </label>
      ) : null}
    </Dialog>
  );
}
