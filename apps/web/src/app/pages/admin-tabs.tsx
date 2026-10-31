import { NavLink } from "react-router";
import { cn } from "@selio/ui";

/** Onglets d'Opérateur › Administration : la santé de la plateforme, puis les comptes et accès. */
export function AdminTabs() {
  const tab = ({ isActive }: { isActive: boolean }) => cn("block rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors", isActive ? "bg-accent-soft text-accent" : "text-text-muted hover:bg-surface-muted hover:text-text");
  return (
    <nav aria-label="Sections de l'administration" className="-mx-4 mb-6 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="flex gap-1">
        <li><NavLink to="/admin" end className={tab}>Santé et plans</NavLink></li>
        <li><NavLink to="/admin/acces" className={tab}>Comptes et accès</NavLink></li>
      </ul>
    </nav>
  );
}
