import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { ArrowUpRight, Building2, ServerCrash, ChevronDown, Gauge, HeartPulse, LayoutDashboard, Lock, LogOut, Menu as MenuIcon, Moon, ShieldCheck, Sun, Tags, TrendingUp, Users, X } from "lucide-react";
import { OPERATOR_ROLE_LABELS, type OperatorRole } from "@selio/contracts";
import { operatorCan, type OperatorCapability } from "@selio/domain";
import { Avatar, Banner, Button, IconButton, Menu, cn } from "@selio/ui";
import { useClient, useData, useRequiredSession, useSession } from "../../../lib/data/provider";
import { useTheme } from "../../../lib/theme";
import { unsubscribeOnLogout } from "../../../lib/push";
import { SERVER_OUTDATED_TEXT, SERVER_OUTDATED_TITLE, adminSectionsFor, operatorRoleOfSession, type AdminSection } from "../../../lib/admin";
import { useCapabilities } from "../../../lib/capabilities";
import { Logo } from "../../../components/Logo";

const SECTION_ICONS: Record<string, ReactNode> = {
  "/admin": <LayoutDashboard />,
  "/admin/comptes": <Building2 />,
  "/admin/offres": <Tags />,
  "/admin/track": <TrendingUp />,
  "/admin/sante": <Gauge />,
  "/admin/supervision": <HeartPulse />,
  "/admin/acces": <Users />,
};

const linkClass = ({ isActive }: { isActive: boolean }) => cn(
  "group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-base font-medium transition-colors [&>svg]:size-[18px] [&>svg]:shrink-0",
  isActive ? "bg-accent-soft text-text [&>svg]:text-accent" : "text-text-muted hover:bg-surface-muted hover:text-text [&>svg]:text-text-muted",
);

/** Accès à Selio Admin : opérateurs seulement (les autres retournent à l'espace client). */
export function RequireOperator({ children }: { children: ReactNode }) {
  const session = useSession();
  if (!operatorRoleOfSession(session.data)) return <Navigate to="/app" replace />;
  return <>{children}</>;
}

/**
 * Page réservée à un droit de la matrice (même règle que l'API) : un opérateur « business » qui ouvre une
 * page technique voit un refus clair, jamais la page (le serveur refuserait ses données de toute façon).
 */
export function RequireAdminCapability({ capability, children }: { capability: OperatorCapability; children: ReactNode }) {
  const s = useRequiredSession();
  const role = operatorRoleOfSession(s);
  if (operatorCan(role, capability)) return <>{children}</>;
  return (
    <div data-testid="admin-forbidden" className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <Lock className="size-6 text-text-muted" aria-hidden />
      <h1 className="text-xl font-semibold text-text">Page réservée à l'opérateur technique</h1>
      <p className="text-sm text-text-muted">Votre rôle ({role ? OPERATOR_ROLE_LABELS[role] : "aucun"}) donne accès au tableau de bord, aux comptes, aux offres commerciales et à l'usage de Track.</p>
      <Link to="/admin"><Button>Tableau de bord</Button></Link>
    </div>
  );
}

function RoleBadge({ role }: { role: OperatorRole }) {
  return (
    <span data-testid="operator-role-badge" className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", role === "tech" ? "bg-accent-soft text-accent" : "bg-surface-muted text-text")}>
      <ShieldCheck className="size-3" aria-hidden />
      {OPERATOR_ROLE_LABELS[role]}
    </span>
  );
}

function SectionList({ sections }: { sections: AdminSection[] }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {sections.map((it) => (
        <li key={it.to}>
          <NavLink to={it.to} end={it.end} className={linkClass}>
            {SECTION_ICONS[it.to]}
            <span className="flex-1 truncate">{it.label}</span>
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

/** Page de Selio Admin dont la route n'existe pas encore sur l'API (serveur pas à jour) : message clair, pas de liste vide. */
export function ServerOutdatedState() {
  return (
    <div data-testid="server-outdated" className="mx-auto flex max-w-lg flex-col items-center gap-3 py-16 text-center">
      <ServerCrash className="size-6 text-warning" aria-hidden />
      <h1 className="text-xl font-semibold text-text">{SERVER_OUTDATED_TITLE} : relancez la mise à jour</h1>
      <p className="text-sm text-text-muted">{SERVER_OUTDATED_TEXT}</p>
      <Button variant="secondary" onClick={() => window.location.reload()}>Recharger la page</Button>
    </div>
  );
}

/** Démonstration : voir Selio Admin comme l'opérateur business (Elias) ou technique (Ibrahim). */
function OperatorRolePreview({ role }: { role: OperatorRole }) {
  const client = useClient();
  const [busy, setBusy] = useState(false);
  if (!client.previewOperatorRole) return null;
  const next: OperatorRole = role === "tech" ? "business" : "tech";
  return (
    <Banner tone="neutral">
      <span data-testid="operator-role-preview" className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
        <span><span className="font-medium text-text">Démonstration</span> — vous voyez Selio Admin avec le rôle « {OPERATOR_ROLE_LABELS[role]} ».</span>
        <button type="button" disabled={busy} className="font-medium text-accent underline-offset-2 hover:underline disabled:opacity-60" onClick={async () => { setBusy(true); try { await client.previewOperatorRole!(next === "tech" ? null : next); } finally { setBusy(false); } }}>
          Voir en « {OPERATOR_ROLE_LABELS[next]} »
        </button>
      </span>
    </Banner>
  );
}

/**
 * Selio Admin : l'espace des fondateurs, séparé de l'espace client (sa propre barre latérale, aucun bandeau
 * d'essai ni de facturation). Sections selon le rôle d'opérateur ; lien « Ouvrir l'espace client ».
 */
export default function AdminLayout() {
  const s = useRequiredSession();
  const client = useClient();
  const { mode } = useData();
  const navigate = useNavigate();
  const location = useLocation();
  const { resolved, setPreference } = useTheme();
  const [open, setOpen] = useState(false);
  const role = operatorRoleOfSession(s) ?? "business";
  const sections = adminSectionsFor(role);
  const pilotage = sections.filter((x) => x.group === "pilotage");
  const technique = sections.filter((x) => x.group === "technique");
  // API plus ancienne que ce frontal (GET /api/capabilities inconnue) : bandeau « relancez la mise à jour ».
  const caps = useCapabilities();
  const outdated = mode === "connected" && caps.data?.version === "inconnue";
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="space-rule shrink-0" aria-hidden />
      <div className="flex h-16 shrink-0 items-center justify-between gap-2 px-4">
        <Link to="/admin" className="flex min-w-0 items-center gap-2" aria-label="Selio Admin, tableau de bord">
          <Logo height={20} />
          <span className="truncate text-base font-semibold text-text">Admin</span>
        </Link>
        <IconButton label="Fermer le menu" className="md:hidden" onClick={() => setOpen(false)} size="sm"><X /></IconButton>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-3">
        <p className="text-xs text-text-muted">Selio Admin</p>
        <RoleBadge role={role} />
      </div>
      <nav aria-label="Sections de l'administration" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 scrollbar-thin">
        <p className="px-2.5 pb-1.5 text-xs font-bold tracking-wider text-text uppercase">Pilotage</p>
        <SectionList sections={pilotage} />
        {technique.length > 0 ? (
          <div className="mt-4">
            <p className="px-2.5 pb-1.5 text-xs font-bold tracking-wider text-text uppercase">Technique</p>
            <SectionList sections={technique} />
          </div>
        ) : null}
        <div className="mt-4 border-t border-border pt-3">
          <Link to="/app" className={linkClass({ isActive: false })}>
            <ArrowUpRight aria-hidden />
            <span className="flex-1 truncate">Ouvrir l'espace client</span>
          </Link>
        </div>
      </nav>
      <div className="shrink-0 border-t border-border p-3">
        <Menu
          align="start"
          side="top"
          className="block w-full"
          trigger={({ toggle, open: o, id }) => (
            <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={o} aria-controls={id} className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-surface-muted">
              <Avatar name={s.user.displayName} size={30} colored />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-text">{s.user.displayName}</span>
                <span className="block truncate text-xs text-text-muted">{s.user.email}</span>
              </span>
              <ChevronDown className="size-4 text-text-muted" aria-hidden />
            </button>
          )}
          items={[
            { label: resolved === "dark" ? "Mode clair" : "Mode sombre", icon: resolved === "dark" ? <Sun /> : <Moon />, onSelect: () => setPreference(resolved === "dark" ? "light" : "dark") },
            { label: "Ouvrir l'espace client", icon: <ArrowUpRight />, onSelect: () => navigate("/app") },
            { label: "Se déconnecter", icon: <LogOut />, onSelect: async () => { await unsubscribeOnLogout(client); await client.logout(); navigate("/connexion"); } },
          ]}
        />
      </div>
    </div>
  );

  return (
    <div className="app-shell flex bg-bg" data-space="admin">
      <a href="#contenu-admin" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">Aller au contenu</a>
      <aside className="sticky top-0 hidden h-dvh w-sidebar shrink-0 self-start border-r border-border bg-surface-sidebar md:block">{sidebar}</aside>
      {open ? (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu de Selio Admin">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[290px] max-w-[88vw] bg-surface-sidebar shadow-lg" onClick={(e) => { if ((e.target as Element).closest("a[href]")) setOpen(false); }}>{sidebar}</aside>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        {mode === "demo" ? <OperatorRolePreview role={role} /> : null}
        {outdated ? (
          <Banner tone="neutral">
            <span data-testid="server-outdated-banner" className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
              <ServerCrash className="size-3.5 shrink-0 text-warning" aria-hidden />
              <span><span className="font-medium text-text">{SERVER_OUTDATED_TITLE}</span> — relancez la mise à jour du PC de production : certaines pages de l'administration ne peuvent pas s'afficher.</span>
            </span>
          </Banner>
        ) : null}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-surface/90 px-4 backdrop-blur md:hidden">
          <IconButton label="Ouvrir le menu" onClick={() => setOpen(true)}><MenuIcon /></IconButton>
          <Link to="/admin" className="flex min-w-0 flex-1 items-center gap-2" aria-label="Selio Admin"><Logo height={20} /><span className="font-semibold text-text">Admin</span></Link>
          <RoleBadge role={role} />
          <IconButton label={resolved === "dark" ? "Mode clair" : "Mode sombre"} size="sm" onClick={() => setPreference(resolved === "dark" ? "light" : "dark")}>{resolved === "dark" ? <Sun /> : <Moon />}</IconButton>
        </header>
        <main id="contenu-admin" className="mx-auto w-full max-w-content flex-1 px-4 py-6 md:px-8 md:py-10 xl:px-12">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

