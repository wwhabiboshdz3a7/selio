import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../lib/cn";
import { IconButton } from "./Button";

export function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  onPageChange,
  className,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  className?: string;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className={cn("flex items-center justify-between gap-3 text-sm text-text-muted", className)}>
      <span className="num">
        {from}–{to} sur {total}
      </span>
      <div className="flex items-center gap-1">
        <IconButton label="Page précédente" size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft />
        </IconButton>
        <span className="num px-2 text-text">
          {page} / {Math.max(1, pageCount)}
        </span>
        <IconButton label="Page suivante" size="sm" variant="secondary" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
          <ChevronRight />
        </IconButton>
      </div>
    </nav>
  );
}
