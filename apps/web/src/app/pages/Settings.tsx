import { NavLink, Outlet } from "react-router";
import { ROLE_LABELS } from "@selio/contracts";
import { PageHeader, cn } from "@selio/ui";
import { useRequiredSession } from "../../lib/data/provider";

const ITEMS = [
  { to: "organisation", label: "Organisation" },
  { to: "access", label: "Comptes et accès" },
  { to: "ai", label: "Assistant IA" },
  { to: "billing", label: "Abonnement" },
  { to: "invoices", label: "Factures" },
  { to: "usage", label: "Utilisation" },
  { to: "notifications", label: "Notifications" },
  { to: "security", label: "Sécurité" },
  { to: "data", label: "Export et suppression" },
  { to: "status", label: "Statut des services" },
];

export default function Settings() {
  const session = useRequiredSession();
  return (
    <>
      <PageHeader title="Paramètres" description={`${session.org.name} · votre rôle : ${ROLE_LABELS[session.role].toLowerCase()}`} />
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Sections des paramètres" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
          <ul className="flex gap-1 lg:flex-col">
            {ITEMS.map((it) => <li key={it.to}><NavLink to={it.to} className={({ isActive }) => cn("block rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors", isActive ? "bg-accent-soft text-accent" : "text-text-muted hover:bg-surface-muted hover:text-text")}>{it.label}</NavLink></li>)}
          </ul>
        </nav>
        <div className="min-w-0"><Outlet /></div>
      </div>
    </>
  );
}
