import { NavLink, Outlet } from "react-router";
import { PageHeader, cn } from "@selio/ui";
import { useRequiredSession } from "../../lib/data/provider";

const ITEMS = [
  { to: "organisation", label: "Organisation" },
  { to: "members", label: "Utilisateurs et rôles" },
  { to: "connections", label: "Connexions" },
  { to: "ai", label: "Assistant IA" },
  { to: "billing", label: "Abonnement et consommation" },
  { to: "notifications", label: "Notifications" },
  { to: "security", label: "Sécurité" },
  { to: "data", label: "Export et suppression" },
  { to: "status", label: "Statut des services" },
];

export default function Settings() {
  const session = useRequiredSession();
  return (
    <>
      <PageHeader title="Paramètres" description={`${session.org.name} · votre rôle : ${session.role}`} />
      <div className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Sections des paramètres" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <ul className="flex gap-1 md:flex-col">
            {ITEMS.map((it) => <li key={it.to}><NavLink to={it.to} className={({ isActive }) => cn("sidebar-link block rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap", isActive ? "text-text" : "text-text-muted hover:text-text")}>{it.label}</NavLink></li>)}
          </ul>
        </nav>
        <div className="min-w-0"><Outlet /></div>
      </div>
    </>
  );
}
