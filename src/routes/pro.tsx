import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useCurrentUser } from "../hooks/useCurrentUser";

export const Route = createFileRoute("/pro")({ component: ProLayout });

const NAV = [
  { to: "/pro", label: "Vue d'ensemble" },
  { to: "/pro/accounts", label: "Comptes de vente" },
  { to: "/pro/wardrobe", label: "Dressing & stock" },
  { to: "/pro/sales", label: "Ventes & compta" },
  { to: "/pro/automation", label: "Automatisations" },
  { to: "/pro/community", label: "Communaute" },
];

function ProLayout() {
  const { data: user, isLoading } = useCurrentUser();
  const pathname = useRouterState().location.pathname;

  if (!isLoading && !user) {
    return (
      <div className="selio-container py-16 text-center">
        <h1 className="text-2xl font-semibold text-[var(--color-selio-primary-dark)]">Espace vendeur Pro</h1>
        <p className="mt-2 text-[var(--color-selio-text-muted)]">Connectez-vous pour acceder a votre tableau de bord.</p>
        <Link to="/login" className="selio-btn selio-btn-primary mt-4 inline-flex">Se connecter</Link>
      </div>
    );
  }

  return (
    <div className="selio-container grid gap-6 py-8 lg:grid-cols-[220px_1fr]">
      <aside className="selio-card-premium h-fit p-3 lg:sticky lg:top-20">
        <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-selio-text-muted)]">Selio Pro</p>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                pathname === item.to ? "bg-[var(--color-selio-primary)] text-white" : "text-[var(--color-selio-text)] hover:bg-[var(--color-selio-surface)]"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
