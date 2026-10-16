import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Bot, Boxes, Camera, ChevronDown, ClipboardList, Gauge, LogOut, Menu as MenuIcon, MessageSquare, Moon, Package, Radar, Settings, ShieldCheck, Shirt, ShoppingCart, Sparkles, Sun, TrendingUp, Users, Workflow, X, Zap } from "lucide-react";
import { Avatar, Banner, Button, IconButton, IconTile, LoadingState, Menu, Tag, cn, type Tone } from "@selio/ui";
import { REVIEW_THRESHOLD } from "@selio/domain";
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

interface NavItem { to: string; label: string; icon: ReactNode; end?: boolean; badgeKey?: "unread" | "awaiting" | "toReview" | "dressingDue"; tag?: string; tone?: Tone; hint?: string }
interface NavGroup { title?: string; items: NavItem[] }

const GROUPS: NavGroup[] = [
  { items: [
    { to: "/app", label: "Vue d'ensemble", icon: <Gauge />, end: true },
  ] },
  { title: "Vendre", items: [
    { to: "/app/studio", label: "Générateur d'annonces", icon: <Sparkles />, tone: "braise", hint: "Photos → annonce rédigée par l'IA" },
    { to: "/app/dressing", label: "Dressing intelligent", icon: <Shirt />, tone: "teal", badgeKey: "dressingDue", hint: "Notes, rendement, republications" },
    { to: "/app/items", label: "Articles et stock", icon: <Boxes /> },
    { to: "/app/messages", label: "Messagerie", icon: <MessageSquare />, badgeKey: "unread" },
    { to: "/app/orders", label: "Commandes", icon: <Package /> },
    { to: "/app/customers", label: "Clients", icon: <Users /> },
  ] },
  { title: "Acheter", items: [
    { to: "/app/radar", label: "Bonnes affaires", icon: <Radar />, tone: "indigo", hint: "Radar : chaque affaire notée /100" },
    { to: "/app/purchase", label: "À valider", icon: <ShoppingCart />, badgeKey: "toReview" },
    { to: "/app/auto-buy", label: "Achat auto", icon: <Bot /> },
  ] },
  { title: "Piloter", items: [
    { to: "/app/market", label: "Analyse revendeurs", icon: <TrendingUp />, tone: "rose", hint: "Top vendeurs et niches" },
    { to: "/app/analytics", label: "Analyses", icon: <ClipboardList /> },
    { to: "/app/automations", label: "Automatisations", icon: <Workflow />, badgeKey: "awaiting" },
  ] },
  { items: [{ to: "/app/settings", label: "Paramètres", icon: <Settings /> }] },
];

const linkClass = ({ isActive }: { isActive: boolean }) => cn("sidebar-link group flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-base font-medium [&_svg]:size-[18px]", isActive ? "text-text" : "text-text-muted hover:bg-surface-muted hover:text-text");

/** Compteurs de la navigation (non lus, à valider, à republier…), partagés avec la vue d'ensemble. */
export function useNavCounts() {
  const client = useClient();
  return useQuery({ queryKey: ["nav-counts"], queryFn: async () => {
    const [convs, jobs, opps, dressing] = await Promise.all([
      client.listConversations({ unread: true, pageSize: 1 }),
      client.listJobs({ status: "awaiting_approval", pageSize: 1 }),
      client.listOpportunities({ status: "new" }),
      client.getDressing({ filter: "due" }),
    ]);
    return { unread: convs.total, awaiting: jobs.total, toReview: opps.filter((o) => o.score >= REVIEW_THRESHOLD).length, dressingDue: dressing.listings.length };
  }, refetchInterval: 30_000 });
}

export function AppLayout({ admin = false }: { admin?: boolean }) {
  const session = useSession();
  const client = useClient();
  const { mode } = useData();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const { resolved, setPreference } = useTheme();
  const counts = useNavCounts();
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);
  // Chaque page s'ouvre en haut (le menu, lui, reste visible : il suit le défilement).
  // Corps en bloc obligatoire : depuis Chrome/Edge 149-150, scrollTo() renvoie une promesse ;
  // renvoyée par l'effet, React la prenait pour sa fonction de nettoyage et l'appelait à la
  // navigation suivante (« S is not a function » à chaque changement de page).
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);
  const s = session.data!;
  const onboardingDone = s.org.settings.onboarding.dismissed || s.org.settings.onboarding.completedSteps.length >= 6;
  const autoBuyOn = s.org.settings.autoBuy.enabled;

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center justify-between px-4">
        <Link to="/app" aria-label="Selio, vue d'ensemble"><Logo height={22} /></Link>
        <IconButton label="Fermer le menu" className="md:hidden" onClick={() => setOpen(false)} size="sm"><X /></IconButton>
      </div>
      <div className="shrink-0 px-3 pb-3">
        <Link to="/app/studio" className="flex items-center gap-2.5 rounded-lg bg-accent px-3 py-2.5 text-accent-on shadow-sm transition-colors hover:bg-accent-hover">
          <Sparkles className="size-5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-base leading-tight font-semibold">Générer une annonce</span>
            <span className="block text-xs leading-tight opacity-85">Vos photos, l'IA rédige</span>
          </span>
          <Camera className="size-4 shrink-0 opacity-85" aria-hidden />
        </Link>
      </div>
      <nav aria-label="Navigation de l'application" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 scrollbar-thin">
        {!onboardingDone ? (
          <NavLink to="/app/onboarding" className={linkClass}>
            <Zap aria-hidden /> Démarrage
          </NavLink>
        ) : null}
        {GROUPS.map((g, gi) => (
          <div key={gi} className={cn(gi > 0 && "mt-3")}>
            {g.title ? <p className="px-2.5 pb-1 text-[11px] font-semibold tracking-wide text-text-subtle uppercase">{g.title}</p> : null}
            <ul className="flex flex-col gap-0.5">
              {g.items.map((it) => {
                const badge = it.badgeKey ? counts.data?.[it.badgeKey] : 0;
                const tag = it.to === "/app/auto-buy" ? (autoBuyOn ? "Activé" : "Arrêté") : it.tag;
                return (
                  <li key={it.to}>
                    <NavLink to={it.to} end={it.end} className={linkClass} title={it.hint}>
                      {it.tone ? <IconTile icon={it.icon} tone={it.tone} size={26} className="-ml-0.5" /> : it.icon}
                      <span className="flex-1 truncate">{it.label}</span>
                      {badge ? <span className="num rounded-full bg-accent px-1.5 text-[11px] leading-[18px] font-semibold text-accent-on">{badge}</span> : null}
                      {tag ? <Tag accent={tag === "IA" || tag === "Nouveau" || tag === "Activé"}>{tag}</Tag> : null}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {s.user.isOperator ? (
          <div className="mt-3">
            <p className="px-2.5 pb-1 text-[11px] font-semibold tracking-wide text-text-subtle uppercase">Opérateur</p>
            <NavLink to="/admin" className={linkClass}>
              <ShieldCheck /> Administration
            </NavLink>
          </div>
        ) : null}
      </nav>
      <div className="shrink-0 border-t border-border p-3">
        <AiStatusRow />
        <Menu
          align="start"
          className="block w-full"
          trigger={({ toggle, open: o, id }) => (
            <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={o} aria-controls={id} className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-surface-muted">
              <Avatar name={s.user.displayName} size={32} colored />
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
    <div className="app-shell flex bg-bg">
      <a href="#contenu-app" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">Aller au contenu</a>
      {/* Barre latérale : collée en haut et haute d'un écran, elle suit le défilement ; le bloc compte reste toujours visible. */}
      <aside className="sticky top-0 hidden h-dvh w-sidebar shrink-0 self-start border-r border-border bg-surface-sidebar md:block">{sidebar}</aside>
      {open ? (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          {/* Tout lien touché ferme le tiroir, y compris celui de la page courante (l'adresse ne change pas). */}
          <aside className="absolute inset-y-0 left-0 w-[290px] max-w-[88vw] bg-surface-sidebar shadow-lg" onClick={(e) => { if ((e.target as Element).closest("a[href]")) setOpen(false); }}>{sidebar}</aside>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        {mode === "demo" ? (
          <Banner>
            <span>Démonstration — données fictives. Aucun envoi, achat ni paiement réel.</span>
            <Link to="/app/settings/data" className="underline underline-offset-2">Réinitialiser</Link>
          </Banner>
        ) : null}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-surface px-4 md:hidden">
          <IconButton label="Ouvrir le menu" onClick={() => setOpen(true)}><MenuIcon /></IconButton>
          <Link to="/app" className="flex-1" aria-label="Selio"><Logo height={20} /></Link>
          {admin ? <Tag>Admin</Tag> : null}
          <Link to="/app/studio" aria-label="Générer une annonce" className="inline-flex size-9 items-center justify-center rounded-md bg-accent text-accent-on"><Sparkles className="size-4" aria-hidden /></Link>
          <IconButton label={resolved === "dark" ? "Mode clair" : "Mode sombre"} size="sm" onClick={() => setPreference(resolved === "dark" ? "light" : "dark")}>{resolved === "dark" ? <Sun /> : <Moon />}</IconButton>
        </header>
        <main id="contenu-app" className="mx-auto w-full max-w-content flex-1 px-4 py-6 md:px-8 md:py-8 xl:px-10">
          <Outlet />
        </main>
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
