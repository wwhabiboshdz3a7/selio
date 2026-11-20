import { useLayoutEffect, useRef, type HTMLAttributes, type ReactNode, type TdHTMLAttributes, type ThHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export function TableWrap({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card animate-fade overflow-x-auto scrollbar-thin", className)} {...rest} />;
}

/**
 * Tableau. `stack` : sur téléphone (< md), chaque ligne devient une fiche (première cellule en titre, puis
 * « libellé : valeur » ; libellés tirés des en-têtes), au lieu d'un défilement horizontal où les colonnes
 * utiles (statut, montant) restent hors de l'écran. Inchangé à partir de md.
 */
export function Table({ className, dense, stack, ...rest }: HTMLAttributes<HTMLTableElement> & { dense?: boolean; stack?: boolean }) {
  const ref = useRef<HTMLTableElement>(null);
  // Sans tableau de dépendances : les lignes changent avec les données (filtres, pages).
  useLayoutEffect(() => {
    const table = ref.current;
    if (!stack || !table) return;
    const labels = [...table.querySelectorAll("thead th")].map((th) => th.textContent?.trim() ?? "");
    for (const row of table.querySelectorAll("tbody tr")) {
      [...row.children].forEach((cell, i) => {
        const label = labels[i];
        if (label && !cell.hasAttribute("colspan")) cell.setAttribute("data-label", label);
        else cell.removeAttribute("data-label");
      });
    }
  });
  return (
    <table
      ref={ref}
      data-stack={stack || undefined}
      className={cn("w-full min-w-[560px] text-sm text-text", dense ? "[&_td]:h-10" : "[&_td]:h-12", className)}
      {...rest}
    />
  );
}

export function Th({ className, numeric, ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn("th-label h-10 bg-surface px-3 text-left align-middle first:pl-4 last:pr-4", numeric && "text-right", className)}
      {...rest}
    />
  );
}

export function Td({ className, numeric, ...rest }: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cn("px-3 align-middle first:pl-4 last:pr-4", numeric && "num text-right", className)}
      {...rest}
    />
  );
}

export function Tr({ className, selected, interactive, ...rest }: HTMLAttributes<HTMLTableRowElement> & { selected?: boolean; interactive?: boolean }) {
  return (
    <tr
      className={cn(
        "border-t border-border",
        interactive && "cursor-pointer hover:bg-surface-muted",
        selected && "bg-accent-soft",
        className,
      )}
      {...rest}
    />
  );
}

export function TableEmpty({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr className="border-t border-border">
      <td colSpan={colSpan} className="h-24 px-4 text-center text-text-muted">
        {children}
      </td>
    </tr>
  );
}
