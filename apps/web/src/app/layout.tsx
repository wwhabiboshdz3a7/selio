import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Bot, Boxes, ChevronDown, ClipboardList, Gauge, LogOut, Menu as MenuIcon, MessageSquare, Moon, Package, Radar, Settings, ShieldCheck, ShoppingCart, Sun, Users, Workflow, X, Zap } from "lucide-react";
import { Avatar, Banner, Button, IconButton, LoadingState, Menu, Tag, cn } from "@selio/ui";
import { useClient, useData, useSession } from "../lib/data/provider";
import { useTheme } from "../lib/theme";
import { Logo } from "../components/Logo";
import { ROLE_LABELS } from "@selio/contracts";

export function RequireSession({ children }: { children: ReactNode }) {
  const session = useSession();
  const location = useLocation();
  if (session.isPending) return <LoadingState label="Ouverture de la session…" className="min-h-dvh" />;
  if (session.isError) return <Navigate to="/connexion" replace state={{ from: location.pathname, error: "La session n'a pas pu être vérifiée." }} />;
  if (!session.data) return <Navigate to="/connexion" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

export function RequireOperator({ children }: { children: ReactNode }) {
  const session = useSession();
  if (!session.data?.user.isOperator) return <Navigate to="/app" replace />;
  return <>{children}</>;
}

interface NavItem { to: string; label: string; icon: ReactNode; end?: boolean; badgeKey?: "unread" | "awaiting"; tag?: string }
interface NavGroup { title?: string; items: NavItem[] }

const GROUPS: NavGroup[] = [
  { items: [
    { to: "/app", label: "Vue d'ensemble", icon: <Gauge />, end: true },
    { to: "/app/items", label: "Articles et stock", icon: <Boxes /> },
    { to: "/app/messages", label: "Messagerie", icon: <MessageSquare />, badgeKey: "unread" },
    { to: "/app/customers", label: "Clients", icon: <Users /> },
    { to: "/app/orders", label: "Commandes", icon: <Package /> },
    { to: "/app/analytics", label: "Analyses", icon: <ClipboardList /> },
  ] },
  { title: "IA Selio", items: [
    { to: "/app/automations", label: "Automatisations", icon: <Workflow />, badgeKey: "awaiting" },
  ] },
  { title: "Achat", items: [
    { to: "/app/radar", label: "Radar", icon: <Radar /> },
    { to: "/app/purchase", label: "Achat assisté", icon: <ShoppingCart />, tag: "Simulé" },
  ] },
  { items: [{ to: "/app/settings", label: "Paramètres", icon: <Settings /> }] },
];

export function AppLayout({ admin = false }: { admin?: boolean }) {
  const session = useSession();
  const client = useClient();
  const { mode } = useData();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const { resolved, setPreference } = useTheme();
  const counts = useQuery({ queryKey: ["nav-counts"], queryFn: async () => {
    const [convs, jobs] = await Promise.all([client.listConversations({ unread: true, pageSize: 1 }), client.listJobs({ status: "awaiting_approval", pageSize: 1 })]);
    return { unread: convs.total, awaiting: jobs.total };
  }, refetchInterval: 30_000 });
  useEffect(() => setOpen(false), [location.pathname]);
  const s = session.data!;
  const onboardingDone = s.org.settings.onboarding.dismissed || s.org.settings.onboarding.completedSteps.length >= 6;

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center justify-between px-4">
        <Link to="/app" aria-label="Selio, vue d'ensemble"><Logo height={22} /></Link>
        <IconButton label="Fermer le menu" className="md:hidden" onClick={() => setOpen(false)} size="sm"><X /></IconButton>
      </div>
      <nav aria-label="Navigation de l'application" className="flex-1 overflow-y-auto px-3 pb-4">
        {!onboardingDone ? (
          <NavLink to="/app/onboarding" className={({ isActive }) => cn("sidebar-link mb-2 flex items-center gap-2.5 rounded-md px-3 py-2 text-base font-medium", isActive ? "text-text" : "text-text-muted hover:text-text")}>
            <Zap className="size-5" aria-hidden /> Démarrage
          </NavLink>
        ) : null}
        {GROUPS.map((g, gi) => (
          <div key={gi} className={cn(gi > 0 && "mt-4")}>
            {g.title ? <p className="px-3 pb-1 text-xs font-medium text-text-subtle">{g.title}</p> : null}
            <ul className="flex flex-col gap-0.5">
              {g.items.map((it) => {
                const badge = it.badgeKey ? counts.data?.[it.badgeKey] : 0;
                return (
                  <li key={it.to}>
                    <NavLink to={it.to} end={it.end} className={({ isActive }) => cn("sidebar-link flex items-center gap-2.5 rounded-md px-3 py-2 text-base font-medium [&>svg]:size-5", isActive ? "text-text" : "text-text-muted hover:text-text")}>
                      {it.icon}
                      <span className="flex-1 truncate">{it.label}</span>
                      {badge ? <span className="num rounded-sm bg-accent-soft px-1.5 text-[11px] font-medium text-accent">{badge}</span> : null}
                      {it.tag ? <Tag>{it.tag}</Tag> : null}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {s.user.isOperator ? (
          <div className="mt-4">
            <p className="px-3 pb-1 text-xs font-medium text-text-subtle">Opérateur</p>
            <NavLink to="/admin" className={({ isActive }) => cn("sidebar-link flex items-center gap-2.5 rounded-md px-3 py-2 text-base font-medium [&>svg]:size-5", isActive ? "text-text" : "text-text-muted hover:text-text")}>
              <ShieldCheck /> Administration
            </NavLink>
          </div>
        ) : null}
      </nav>
      <div className="border-t border-border p-3">
        <AiStatusRow />
        <Menu
          align="start"
          className="block w-full"
          trigger={({ toggle, open: o, id }) => (
            <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={o} aria-controls={id} className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-surface-muted">
              <Avatar name={s.user.displayName} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-text">{s.user.displayName}</span>
                <span className="block truncate text-xs text-text-muted">{s.org.name} · {ROLE_LABELS[s.role]}</span>
              </span>
              <ChevronDown className="size-4 text-text-muted" aria-hidden />
            </button>
          )}
          items={[
            { label: resolved === "dark" ? "Mode clair" : "Mode sombre", icon: resolved === "dark" ? <Sun /> : <Moon />, onSelect: () => setPreference(resolved === "dark" ? "light" : "dark") },
            { label: "Paramètres", icon: <Settings />, onSelect: () => navigate("/app/settings") },
            { label: "Se déconnecter", icon: <LogOut />, onSelect: async () => { await client.logout(); navigate("/connexion"); } },
          ]}
        />
      </div>
    </div>
  );

  return (
    <div className="app-shell flex flex-col bg-bg">
      <a href="#contenu-app" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">Aller au contenu</a>
      {mode === "demo" ? (
        <Banner>
          <span>Démonstration — données fictives. Aucun envoi, achat ni paiement réel.</span>
          <Link to="/app/settings/data" className="underline underline-offset-2">Réinitialiser</Link>
        </Banner>
      ) : null}
      <div className="flex flex-1">
        <aside className="sticky top-0 hidden h-dvh w-sidebar shrink-0 border-r border-border bg-surface md:block">{sidebar}</aside>
        {open ? (
          <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
            <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
            <aside className="absolute inset-y-0 left-0 w-[280px] max-w-[85vw] bg-surface shadow-lg">{sidebar}</aside>
          </div>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-surface px-4 md:hidden">
            <IconButton label="Ouvrir le menu" onClick={() => setOpen(true)}><MenuIcon /></IconButton>
            <Link to="/app" className="flex-1" aria-label="Selio"><Logo height={20} /></Link>
            {admin ? <Tag>Admin</Tag> : null}
            <IconButton label={resolved === "dark" ? "Mode clair" : "Mode sombre"} size="sm" onClick={() => setPreference(resolved === "dark" ? "light" : "dark")}>{resolved === "dark" ? <Sun /> : <Moon />}</IconButton>
          </header>
          <main id="contenu-app" className="mx-auto w-full max-w-content flex-1 px-4 py-6 md:px-8 md:py-8">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}

/** Statut IA discret au-dessus du menu utilisateur de la sidebar. */
function AiStatusRow() {
  const client = useClient();
  const q = useQuery({ queryKey: ["ai-status"], queryFn: () => client.getAiStatus(), refetchInterval: 60_000 });
  if (!q.data) return null;
  const tone = q.data.status === "healthy" ? "bg-success" : q.data.status === "mock" ? "bg-accent-vivid" : q.data.status === "degraded" ? "bg-warning" : "bg-danger";
  return (
    <Link to="/app/settings/ai" className="mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-text-muted hover:bg-surface-muted hover:text-text" title={q.data.message}>
      <Bot className="size-3.5" aria-hidden />
      <span className={cn("size-1.5 rounded-full", tone)} aria-hidden />
      IA : {q.data.status === "mock" ? "simulée" : q.data.status === "healthy" ? "opérationnelle" : q.data.status === "degraded" ? "dégradée" : q.data.status === "circuit_open" ? "coupée" : q.data.status === "unconfigured" ? "non configurée" : "indisponible"}
    </Link>
  );
}

export function PageActionsHint({ children }: { children: ReactNode }) {
  return <p className="text-xs text-text-muted">{children}</p>;
}

export function PrimaryLinkButton({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to}><Button>{children}</Button></Link>;
}
