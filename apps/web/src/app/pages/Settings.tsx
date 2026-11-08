import { NavLink, Navigate, Outlet } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ROLE_LABELS, type Role } from "@selio/contracts";
import { can } from "@selio/domain";
import { PageHeader, cn } from "@selio/ui";
import { useClient, useRequiredSession } from "../../lib/data/provider";
import { hasReducedView, seesFinances } from "../../lib/roles";

interface SettingsItem {
  to: string;
  label: string;
  /** Visible pour ce rôle ? (absent : tous les rôles qui consultent l'organisation). */
  visible?: (role: Role) => boolean;
}

/** Sections des paramètres, filtrées par rôle (les finances ne s'affichent qu'aux rôles qui les voient). */
export const SETTINGS_ITEMS: readonly SettingsItem[] = [
  { to: "organisation", label: "Organisation" },
  { to: "access", label: "Comptes et accès" },
  { to: "apparence", label: "Apparence", visible: () => true },
  { to: "ai", label: "Assistant IA" },
  { to: "billing", label: "Abonnement", visible: seesFinances },
  { to: "invoices", label: "Factures", visible: seesFinances },
  { to: "usage", label: "Utilisation" },
  { to: "parrainage", label: "Parrainage", visible: (r) => can(r, "org.update") },
  { to: "notifications", label: "Notifications" },
  { to: "security", label: "Sécurité", visible: () => true },
  { to: "migration", label: "Migration" },
  { to: "data", label: "Export et suppression" },
  { to: "status", label: "Statut des services" },
];

/** Sections visibles pour un rôle ; « Parrainage » seulement quand le programme est ouvert (ou en proposition). */
export function settingsItemsFor(role: Role, opts: { referral: boolean }): SettingsItem[] {
  const reduced = hasReducedView(role);
  return SETTINGS_ITEMS.filter((it) => {
    if (it.to === "parrainage" && !opts.referral) return false;
    if (it.visible) return it.visible(role);
    return !reduced && can(role, "org.read");
  });
}

export default function Settings() {
  const session = useRequiredSession();
  const client = useClient();
  // Parrainage : la section n'apparaît que si le programme est ouvert (REFERRAL_ENABLED) ou en démonstration.
  const referral = useQuery({ queryKey: ["referral"], queryFn: () => client.getReferral(), enabled: can(session.role, "org.update"), staleTime: 60_000, retry: false });
  const items = settingsItemsFor(session.role, { referral: referral.data?.enabled === true });
  return (
    <>
      <PageHeader title="Paramètres" description={`${session.org.name} · votre rôle : ${ROLE_LABELS[session.role].toLowerCase()}`} />
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Sections des paramètres" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
          <ul className="flex gap-1 lg:flex-col">
            {items.map((it) => <li key={it.to}><NavLink to={it.to} className={({ isActive }) => cn("block rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors", isActive ? "bg-accent-soft text-accent" : "text-text-muted hover:bg-surface-muted hover:text-text")}>{it.label}</NavLink></li>)}
          </ul>
        </nav>
        <div className="min-w-0"><Outlet /></div>
      </div>
    </>
  );
}

/** Première section des paramètres : l'organisation, ou l'apparence pour la vue réduite. */
export function SettingsHome() {
  const session = useRequiredSession();
  return <Navigate to={hasReducedView(session.role) ? "apparence" : "organisation"} replace />;
}
