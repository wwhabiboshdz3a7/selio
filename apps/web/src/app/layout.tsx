import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BellRing, Bot, Boxes, Camera, ChevronDown, Eye, Lock, CircleUser, ClipboardList, CreditCard, Gauge, Heart, ListChecks, LogOut, Menu as MenuIcon, MessageSquare, MessagesSquare, Moon, Package, Pause, Printer, RefreshCw, Settings, ShieldCheck, Shirt, Sparkles, Sun, TrendingUp, Users, Workflow, X, Zap } from "lucide-react";
import { Avatar, Banner, Button, IconButton, LoadingState, Menu, Tag, cn, formatDate } from "@selio/ui";
import type { ServerCapabilities, Subscription } from "@selio/contracts";
import { ArrowLeftRight } from "lucide-react";
import { useCapabilities } from "../lib/capabilities";
import { daysLeft } from "../lib/billing";
import { REVIEW_THRESHOLD } from "@selio/domain";
import { queryClient, useClient, useData, useRequiredSession, useSession } from "../lib/data/provider";
import { useTheme } from "../lib/theme";
import { unsubscribeOnLogout } from "../lib/push";
import { Logo } from "../components/Logo";
import { ROLE_LABELS } from "@selio/contracts";
import { HandCoins, History } from "lucide-react";
import { LifeBuoy } from "lucide-react";
import { HUB_PATH, SPACE_GROUPS, featureById, featureForPath, readLastSpace, spaceForPath, writeLastSpace, type FeatureId, type SpaceArea } from "./spaces/spaces";
import { SpacePill, SpaceSwitcher } from "./spaces/SpaceSwitcher";
import { PHOTOS_HOME, hasReducedView, reducedViewTarget, seesFinances } from "../lib/roles";
import { useGlassExperiment } from "../lib/glass";
import { DOCK_CONTENT_PADDING, MobileDock } from "./components/MobileDock";
import { DataError, type Session } from "../lib/data/types";
import { OfferBanner } from "./components/offers";

export function RequireSession({ children }: { children: ReactNode }) {
  const session = useSession();
  const location = useLocation();
  if (session.isPending) return <LoadingState label="Ouverture de la session…" className="min-h-dvh" />;
  // Serveur momentanément injoignable (redémarrage, tunnel) : on attend et on se reconnecte seul, sans déconnecter.
  if (session.isError && session.error instanceof DataError && session.error.code === "unavailable") return <ServerUnavailable onRetry={() => void session.refetch()} />;
  // Compte bloqué par l'équipe Selio : le message du serveur est affiché tel quel sur la page de connexion.
  if (session.isError) return <Navigate to="/connexion" replace state={{ from: location.pathname, error: session.error instanceof DataError && session.error.code === "account_blocked" ? session.error.message : "La session n'a pas pu être vérifiée." }} />;
  if (!session.data) return <Navigate to="/connexion" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

/** Écran d'attente quand l'API ne répond pas : nouvelle tentative automatique toutes les 5 secondes. */
export function ServerUnavailable({ onRetry }: { onRetry: () => void }) {
  useEffect(() => {
    const id = window.setInterval(onRetry, 5000);
    return () => window.clearInterval(id);
  }, [onRetry]);
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4">
      <div className="flex max-w-md flex-col items-center gap-4 text-center" role="status">
        <Logo height={28} />
        <h1 className="text-xl font-semibold text-text">Selio revient dans un instant</h1>
        <p className="text-sm text-text-muted">Le serveur est momentanément injoignable (redémarrage ou maintenance). La page se reconnecte toute seule dès qu'il répond ; vos données ne sont pas touchées.</p>
        <Button variant="secondary" onClick={onRetry}><RefreshCw aria-hidden /> Réessayer maintenant</Button>
      </div>
    </main>
  );
}

export function RequireOperator({ children }: { children: ReactNode }) {
  const session = useSession();
  if (!session.data?.user.isOperator) return <Navigate to="/app" replace />;
  return <>{children}</>;
}

export interface NavItem { to: string; label: string; icon: ReactNode; end?: boolean; badgeKey?: "unread" | "awaiting" | "toReview" | "dressingDue"; hint?: string; /** Sous-menu affiché quand on est dans ces pages (Selio Cloud, Selio Agent). */ children?: NavItem[] }
export interface NavGroup { title?: string; items: NavItem[] }

const cloudFeature = featureById("cloud");
const agentFeature = featureById("agents");

/**
 * Menu de Selio Manager (gestion et automatisation de l'activité Vinted), dans l'ordre du parcours du
 * revendeur : vente, automatisations du compte, puis le pilotage. Selio Cloud et Selio Agent y sont intégrés
 * (« Équipe et Cloud »), avec leurs pages en sous-menu. La recherche et l'achat d'articles vivent dans
 * Selio Bot, l'analyse du marché dans Selio Track : le Manager garde un lien vers chacun.
 */
const GROUPS: NavGroup[] = [
  { items: [
    { to: "/app", label: "Vue d'ensemble", icon: <Gauge />, end: true },
  ] },
  { title: "Vente", items: [
    { to: "/studio", label: "Générateur d'annonces", icon: <Sparkles />, hint: "Ouvre Selio Studio : photos → annonce rédigée par l'IA" },
    { to: "/app/dressing", label: "Dressing intelligent", icon: <Shirt />, badgeKey: "dressingDue", hint: "Notes, rendement, republications" },
    { to: "/app/items", label: "Articles et stock", icon: <Boxes /> },
    { to: "/app/messages", label: "Messagerie", icon: <MessageSquare />, badgeKey: "unread" },
    { to: "/app/orders", label: "Commandes", icon: <Package /> },
    { to: "/app/customers", label: "Clients", icon: <Users /> },
  ] },
  { title: "Automatisation", items: [
    { to: "/app/automatisation", label: "Tout le parcours", icon: <Workflow />, end: true, hint: "État des automatisations, « Arrêter toutes les automatisations »" },
    { to: "/app/automatisation/negociation", label: "Négociation par IA", icon: <HandCoins />, hint: "Accepter, refuser ou contre-offrir selon vos marges" },
    { to: "/app/automatisation/favoris", label: "Messages aux favoris", icon: <Heart /> },
    { to: "/app/automatisation/reponse", label: "Réponse automatique", icon: <MessagesSquare /> },
    { to: "/app/automatisation/relances", label: "Relances", icon: <BellRing />, hint: "Une relance par acheteur sans réponse après 24 h" },
    { to: "/app/automatisation/apres-vente", label: "Après-vente", icon: <Printer />, hint: "Bordereaux et messages après la vente" },
    { to: "/app/automatisation/stock", label: "Stock", icon: <RefreshCw />, hint: "Remise en ligne automatique après une vente" },
  ] },
  { title: "Piloter", items: [
    { to: "/app/accounts", label: "Comptes Vinted", icon: <CircleUser />, hint: "Comptes vente, achat et perso" },
    { to: "/app/analytics", label: "Analyses", icon: <ClipboardList /> },
    { to: "/app/automations", label: "Journal des tâches", icon: <ListChecks />, badgeKey: "awaiting", hint: "Tâches, validations et règles" },
    { to: "/app/journal", label: "Journal d'activité", icon: <History />, hint: "Ce que Selio, Studio, Selio Bot et l'équipe ont fait" },
  ] },
  { title: "Équipe et Cloud", items: [
    { to: cloudFeature.home, label: cloudFeature.name, icon: cloudFeature.icon, hint: cloudFeature.tagline, children: cloudFeature.nav },
    { to: agentFeature.home, label: agentFeature.name, icon: agentFeature.icon, hint: agentFeature.tagline, children: agentFeature.nav },
  ] },
  { title: "Les autres filiales", items: [
    { to: "/bot", label: "Ouvrir Selio Bot", icon: <Bot />, hint: "Recherche et achat d'articles : bonnes affaires, achats à valider" },
    { to: "/track", label: "Ouvrir Selio Track", icon: <TrendingUp />, hint: "Analyse du marché et des opportunités (Pro et Agence)" },
  ] },
  { items: [
    { to: "/app/help", label: "Aide", icon: <LifeBuoy />, hint: "FAQ et assistant" },
    { to: "/app/settings", label: "Paramètres", icon: <Settings /> },
  ] },
];

/** Dans les pages de Selio Cloud ou de Selio Agent : le groupe « Équipe et Cloud » remonte sous la vue d'ensemble, sous-menu visible. */
function featureFirst(groups: NavGroup[]): NavGroup[] {
  const i = groups.findIndex((g) => g.items.some((it) => it.children));
  if (i <= 1) return groups;
  return [groups[0]!, groups[i]!, ...groups.slice(1, i), ...groups.slice(i + 1)];
}

/**
 * Menu de la vue réduite (contributeur photos : voir les articles, leur ajouter des photos, lancer le
 * générateur). Les autres pages affichent « réservé à d'autres rôles ».
 */
const PHOTOS_GROUPS: NavGroup[] = [
  { title: "Photos", items: [
    { to: PHOTOS_HOME, label: "Articles à photographier", icon: <Camera />, hint: "Ajouter des photos aux articles" },
  ] },
  { title: "Selio Studio", items: [
    { to: "/studio", label: "Générateur d'annonces", icon: <Sparkles />, end: true, hint: "Vos photos → annonce rédigée par l'IA" },
    { to: "/studio/annonces", label: "Annonces générées", icon: <ClipboardList /> },
  ] },
  { items: [
    { to: "/app/help", label: "Aide", icon: <LifeBuoy /> },
    { to: "/app/settings", label: "Paramètres", icon: <Settings /> },
  ] },
];

/** Lien du menu : icônes neutres, élément actif en améthyste douce (fond teinté, icône violette). */
const linkClass = ({ isActive }: { isActive: boolean }) => cn(
  "group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-base font-medium transition-colors [&>svg]:size-[18px] [&>svg]:shrink-0",
  isActive ? "bg-accent-soft text-text [&>svg]:text-accent" : "text-text-muted hover:bg-surface-muted hover:text-text [&>svg]:text-text-muted",
);

/** Compteurs de la navigation (non lus, à valider, à republier…), partagés avec la vue d'ensemble. */
export function useNavCounts(enabled = true) {
  const client = useClient();
  return useQuery({ queryKey: ["nav-counts"], enabled, queryFn: async () => {
    const [convs, jobs, opps, dressing] = await Promise.all([
      client.listConversations({ unread: true, pageSize: 1 }),
      client.listJobs({ status: "awaiting_approval", pageSize: 1 }),
      client.listOpportunities({ status: "new" }),
      client.getDressing({ filter: "due" }),
    ]);
    return { unread: convs.total, awaiting: jobs.total, toReview: opps.filter((o) => o.score >= REVIEW_THRESHOLD).length, dressingDue: dressing.listings.length };
  }, refetchInterval: 30_000 });
}

/**
 * Note sous le sélecteur. Démonstration : l'état de chaque filiale (aperçu, développement). Mode connecté : aucune
 * étiquette « aperçu » ou « en développement » ; seulement « En cours d'activation » pour Track ou Cloud tant que le
 * serveur ne les a pas ouverts, et la note d'accompagnement du générateur de comptes.
 */
export function spaceNoteFor(area: SpaceArea | FeatureId, mode: "demo" | "connected", caps: ServerCapabilities | undefined): { label: string; text: string } | null {
  if (mode === "demo") return SPACE_NOTES[area] ?? null;
  if (area === "generateur") return SPACE_NOTES.generateur ?? null;
  if (area === "track" && !caps?.trackLive) return { label: "En cours d'activation", text: "vous pouvez déjà créer vos filtres : ils seront lus dès l'ouverture." };
  if (area === "cloud" && !caps?.cloud) return { label: "En cours d'activation", text: "vous pourrez confier vos réponses et relances au Cloud, compte par compte, avec votre accord." };
  return null;
}

/** Bandeau sous le sélecteur (démonstration), pour les filiales et fonctionnalités qui ne sont pas encore ouvertes. */
const SPACE_NOTES: Partial<Record<SpaceArea | FeatureId, { label: string; text: string }>> = {
  agents: { label: "Aperçu", text: "Selio Agent, intégré à Selio Manager : l'équipe et les accès sont réels ; les boutiques clientes sont des exemples fictifs." },
  track: { label: "En développement", text: "statistiques seulement ; simulateur par défaut, lecture en direct à valider juridiquement." },
  cloud: { label: "Aperçu", text: "Selio Cloud, intégré à Selio Manager : actions légères seulement (répondre, relancer), avec votre accord ; en démonstration, rien ne touche Vinted." },
  generateur: { label: "Accompagnement", text: "services sur devis ; en autonomie, la checklist et les textes à copier." },
};

export function AppLayout({ admin = false }: { admin?: boolean }) {
  // Pas de `useSession().data!` : à la fin de la session, la mise en page peut être rendue une
  // dernière fois avec une session nulle (« Cannot read properties of null (reading 'org') »).
  const s = useRequiredSession();
  const client = useClient();
  const { mode } = useData();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const { resolved, setPreference } = useTheme();
  // Contributeur photos : vue réduite (menu restreint, aucune requête hors de ses droits).
  const reduced = hasReducedView(s.role);
  const glass = useGlassExperiment(s.user.id).enabled;
  // Dock en verre (mobile) : la hauteur qu'il occupe est exposée en --dock-offset (styles.css), pour que les
  // éléments collés ou fixés en bas d'écran (barre « Enregistrer », notifications) se posent au-dessus de lui.
  useEffect(() => {
    const root = document.documentElement;
    if (glass) root.dataset.dock = "on";
    else delete root.dataset.dock;
    return () => { delete root.dataset.dock; };
  }, [glass]);
  const counts = useNavCounts(!reduced);
  // Carte à enregistrer pendant l'essai, ou paiement échoué : rappel discret au-dessus des pages (finances).
  const subscription = useQuery({ queryKey: ["subscription"], queryFn: () => client.getSubscription(), staleTime: 30_000, enabled: seesFinances(s.role) });
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
  const onboardingDone = s.org.settings.onboarding.dismissed || s.org.settings.onboarding.completedSteps.length >= 6;
  // Radar Auto « Activé » seulement si tous ses verrous sont levés (verrou serveur fermé par défaut).
  const autoBuyStatus = useQuery({ queryKey: ["radar-auto"], queryFn: () => client.autoBuyStatus(), enabled: s.org.settings.autoBuy.enabled && !reduced, staleTime: 60_000 });
  const autoBuyOn = s.org.settings.autoBuy.enabled && autoBuyStatus.data?.active === true;
  // Espace affiché : celui de l'adresse ; les pages communes (paramètres, administration) gardent le dernier.
  const ownedArea = spaceForPath(location.pathname);
  const area: SpaceArea = ownedArea ?? readLastSpace();
  // Selio Cloud et Selio Agent : intégrés à Selio Manager (menu du Manager, sous-menu de la fonctionnalité).
  const feature = featureForPath(location.pathname);
  useEffect(() => {
    if (ownedArea) writeLastSpace(ownedArea);
  }, [ownedArea]);
  const groups = reduced ? PHOTOS_GROUPS : area === "selio" ? (feature ? featureFirst(GROUPS) : GROUPS) : SPACE_GROUPS[area];
  // Selio Cloud : l'arrêt global des automatisations met aussi le Cloud en pause (bandeau et menu).
  const automation = useQuery({ queryKey: ["automation-state"], queryFn: () => client.getAutomationState(), enabled: feature === "cloud" && !reduced, staleTime: 15_000 });
  const cloudPaused = feature === "cloud" && automation.data?.globalPaused === true;
  // Mode connecté : ce qui est réellement branché (paiement simulé, Track, Cloud…) ; démonstration : tout.
  const caps = useCapabilities();
  const paymentSimulated = mode === "connected" && caps.data?.payment === "simulated";
  const spaceNote = spaceNoteFor(feature ?? area, mode, caps.data);
  // Autres organisations dont la personne est membre (ajoutée par l'équipe Selio ou invitée) : sélecteur dans le menu.
  const otherOrgs = s.memberships.filter((m) => m.orgId !== s.org.id);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="space-rule shrink-0" aria-hidden />
      <div className="flex h-16 shrink-0 items-center justify-between gap-1 px-2">
        {reduced ? <Link to={PHOTOS_HOME} className="flex min-w-0 flex-1 items-center gap-2 px-2" aria-label="Selio, articles à photographier"><Logo height={20} /></Link> : <SpaceSwitcher area={area} />}
        <IconButton label="Fermer le menu" className="md:hidden" onClick={() => setOpen(false)} size="sm"><X /></IconButton>
      </div>
      {!reduced && spaceNote ? (
        <p className="mx-3 mb-3 shrink-0 rounded-md bg-surface-muted px-3 py-2 text-xs text-text-muted">
          <span className="font-semibold text-text">{spaceNote.label}</span> — {spaceNote.text}
        </p>
      ) : null}
      {area === "selio" && !reduced ? <div className="shrink-0 px-3 pb-3">
        <Link to="/studio" className="group bg-brand flex items-center gap-3 rounded-lg px-3 py-2.5 text-white shadow-sm ring-1 ring-white/10 ring-inset transition-[filter] hover:brightness-110">
          <Sparkles className="size-[18px] shrink-0 text-gold-300" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-base leading-tight font-semibold">Générer une annonce</span>
            <span className="block text-xs leading-tight text-white/75">Vos photos, l'IA rédige</span>
          </span>
          <ArrowRight className="size-4 shrink-0 text-white/70 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </Link>
      </div> : null}
      <nav aria-label="Navigation de l'application" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 scrollbar-thin">
        {!onboardingDone && area === "selio" && !reduced ? (
          <NavLink to="/app/onboarding" className={linkClass}>
            <Zap aria-hidden /> Démarrage
          </NavLink>
        ) : null}
        {groups.map((g, gi) => (
          <div key={gi} className={cn(gi > 0 && "mt-4")}>
            {g.title ? <p className="px-2.5 pb-1.5 text-xs font-bold tracking-wider text-text uppercase">{g.title}</p> : null}
            <ul className="flex flex-col gap-0.5">
              {g.items.map((it) => {
                const badge = it.badgeKey ? counts.data?.[it.badgeKey] : 0;
                const autoBuy = it.to === "/bot/achat-auto";
                const cloudHome = it.to === "/cloud" && cloudPaused;
                // Sous-menu (Selio Cloud, Selio Agent) : déplié seulement dans les pages de la fonctionnalité.
                const inside = it.children && (location.pathname === it.to || location.pathname.startsWith(`${it.to}/`));
                return (
                  <li key={it.to}>
                    <NavLink to={it.to} end={it.end ?? Boolean(it.children)} className={linkClass} title={it.hint}>
                      {it.icon}
                      <span className="flex-1 truncate">{it.label}</span>
                      {badge ? <span className="num min-w-5 rounded-full bg-surface-muted px-1.5 text-center text-[11px] leading-[18px] font-medium text-text-muted group-aria-[current=page]:bg-surface group-aria-[current=page]:text-accent">{badge}</span> : null}
                      {autoBuy ? <span className="inline-flex items-center gap-1.5 text-[11px] font-normal text-text-muted"><span className={cn("size-1.5 rounded-full", autoBuyOn ? "bg-success" : "bg-border-strong")} aria-hidden />{autoBuyOn ? "Activé" : "Fermé"}</span> : null}
                      {cloudHome ? <span className="inline-flex items-center gap-1.5 text-[11px] font-normal text-text-muted"><span className="size-1.5 rounded-full bg-warning" aria-hidden />En pause</span> : null}
                    </NavLink>
                    {inside ? (
                      <ul className="mt-0.5 mb-1 ml-[18px] flex flex-col gap-0.5 border-l border-border pl-2" aria-label={`Pages de ${it.label}`}>
                        {it.children!.filter((c) => c.to !== it.to).map((c) => (
                          <li key={c.to}><NavLink to={c.to} end={c.end} className={linkClass} title={c.hint}>{c.icon}<span className="flex-1 truncate">{c.label}</span></NavLink></li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {s.user.isOperator ? (
          <div className="mt-3">
            <p className="px-2.5 pb-1.5 text-xs font-bold tracking-wider text-text uppercase">Équipe Selio</p>
            <ul className="flex flex-col gap-0.5">
              {/* Retour vers Selio Admin, l'espace séparé des opérateurs. */}
              <li><NavLink to="/admin" className={linkClass} title="Selio Admin : croissance, comptes, offres"><ShieldCheck /> Administration</NavLink></li>
            </ul>
          </div>
        ) : null}
      </nav>
      <div className="shrink-0 border-t border-border p-3">
        {reduced ? null : <AiStatusRow />}
        <Menu
          align="start"
          side="top"
          className="block w-full"
          trigger={({ toggle, open: o, id }) => (
            <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={o} aria-controls={id} className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-surface-muted">
              <Avatar name={s.user.displayName} size={30} colored />
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
            ...otherOrgs.map((m) => ({ label: `Passer à « ${m.orgName} »`, icon: <ArrowLeftRight />, onSelect: async () => { await client.switchOrg(m.orgId); await queryClient.invalidateQueries(); navigate(HUB_PATH); } })),
            // Les alertes Radar de cet appareil sont retirées avant la déconnexion (best effort, jamais bloquant).
            { label: "Se déconnecter", icon: <LogOut />, onSelect: async () => { await unsubscribeOnLogout(client); await client.logout(); navigate("/connexion"); } },
          ]}
        />
      </div>
    </div>
  );

  return (
    <div className="app-shell flex bg-bg" data-space={area}>
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
            <span><span className="font-medium text-text">Démonstration</span> — données fictives.<span className="hidden sm:inline"> Aucun envoi, achat ni paiement réel.</span></span>
            <Link to="/app/settings/data" className="font-medium text-accent underline-offset-2 hover:underline">Réinitialiser</Link>
          </Banner>
        ) : null}
        {mode === "demo" ? <RolePreviewBanner s={s} /> : null}
        <BillingBanner s={subscription.data ?? null} pathname={location.pathname} simulated={paymentSimulated} />
        {/* Offre commerciale en cours (gérée dans Selio Admin) : refermable, rien sans offre. */}
        {reduced ? null : <OfferBanner scope="app" />}
        {cloudPaused ? (
          <Banner tone="neutral">
            <span data-testid="cloud-paused-banner" className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
              <Pause className="size-3.5 shrink-0 text-warning" aria-hidden />
              <span><span className="font-medium text-text">Selio Cloud en pause</span> — arrêt global des automatisations : aucune action n'est lancée.</span>
              {location.pathname === "/cloud" ? null : <Link to="/cloud" className="font-medium text-accent underline-offset-2 hover:underline">Reprendre</Link>}
            </span>
          </Banner>
        ) : null}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-surface/90 px-4 backdrop-blur md:hidden">
          <IconButton label="Ouvrir le menu" onClick={() => setOpen(true)}><MenuIcon /></IconButton>
          {reduced
            ? <Link to={PHOTOS_HOME} className="flex min-w-0 flex-1 items-center gap-2" aria-label="Selio, articles à photographier"><Logo height={20} /></Link>
            : <Link to={HUB_PATH} className="flex min-w-0 flex-1 items-center gap-2" aria-label="Selio, vos espaces"><Logo height={20} /><SpacePill area={area} /></Link>}
          {admin ? <Tag>Admin</Tag> : null}
          <Link to="/studio" aria-label="Générer une annonce" className="bg-brand inline-flex size-9 items-center justify-center rounded-md text-white"><Sparkles className="size-4 text-gold-300" aria-hidden /></Link>
          <IconButton label={resolved === "dark" ? "Mode clair" : "Mode sombre"} size="sm" onClick={() => setPreference(resolved === "dark" ? "light" : "dark")}>{resolved === "dark" ? <Sun /> : <Moon />}</IconButton>
        </header>
        <main id="contenu-app" className={cn("mx-auto w-full max-w-content flex-1 px-4 py-6 md:px-8 md:py-10 xl:px-12", glass && DOCK_CONTENT_PADDING)}>
          {reduced ? <ReducedViewGate /> : <Outlet />}
        </main>
        {/* Essai « verre liquide » : dock flottant sur mobile ; rien n'est rendu quand l'essai est inactif. */}
        {glass ? <MobileDock reduced={reduced} /> : null}
      </div>
    </div>
  );
}

/**
 * Vue réduite (contributeur photos) : les accueils mènent aux articles à photographier ; les autres pages
 * ne s'ouvrent pas (le serveur refuserait leurs données de toute façon).
 */
function ReducedViewGate() {
  const { pathname } = useLocation();
  const target = reducedViewTarget(pathname);
  if (target === pathname) return <Outlet />;
  if (target) return <Navigate to={target} replace />;
  return (
    <div data-testid="reduced-view-blocked" className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <Lock className="size-6 text-text-muted" aria-hidden />
      <h1 className="text-xl font-semibold text-text">Page réservée à d'autres rôles</h1>
      <p className="text-sm text-text-muted">Votre rôle (contributeur photos) permet d'ajouter des photos aux articles et de lancer le générateur d'annonces.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Link to={PHOTOS_HOME}><Button>Articles à photographier</Button></Link>
        <Link to="/studio"><Button variant="secondary">Générateur d'annonces</Button></Link>
      </div>
    </div>
  );
}

/** Démonstration : rappel de l'essai de rôle en cours, avec le retour à son propre rôle. */
function RolePreviewBanner({ s }: { s: Session }) {
  const client = useClient();
  const own = s.memberships.find((m) => m.orgId === s.org.id)?.role ?? s.role;
  const [busy, setBusy] = useState(false);
  if (own === s.role || !client.previewRole) return null;
  return (
    <Banner tone="neutral">
      <span data-testid="role-preview-banner" className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
        <Eye className="size-3.5 shrink-0 text-text-muted" aria-hidden />
        <span>Vous voyez Selio comme <span className="font-medium text-text">« {ROLE_LABELS[s.role]} »</span> (essai de rôle de la démonstration).</span>
        <button type="button" disabled={busy} className="font-medium text-accent underline-offset-2 hover:underline disabled:opacity-60" onClick={async () => { setBusy(true); try { await client.previewRole!(null); } finally { setBusy(false); } }}>Revenir à mon rôle</button>
      </span>
    </Banner>
  );
}

/**
 * Bandeau d'abonnement : pendant l'essai sans carte, « Enregistrez votre carte pour garder l'accès
 * après l'essai » avec les jours restants (la carte est demandée à la première ouverture de
 * l'application, pas à l'inscription) ; après un débit échoué, la prochaine tentative.
 */
export function BillingBanner({ s, pathname, simulated = false }: { s: Subscription | null; pathname: string; simulated?: boolean }) {
  if (!s) return null;
  const onBilling = pathname.startsWith("/app/settings/billing");
  // Essai terminé alors que le paiement n'était pas activé : accès de base, en attente du paiement.
  if (s.status === "canceled" && s.awaitingPaymentSince) {
    return (
      <Banner tone="neutral">
        <span data-testid="awaiting-payment-banner" className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
          <CreditCard className="size-3.5 shrink-0 text-text-muted" aria-hidden />
          <span><span className="font-medium text-text">Essai terminé, en attente du paiement</span> — accès de base en attendant, rien n'a été débité. L'équipe Selio vous recontacte.</span>
          {onBilling ? null : <Link to="/app/settings/billing" className="font-medium text-accent underline-offset-2 hover:underline">Mon abonnement</Link>}
        </span>
      </Banner>
    );
  }
  // Paiement pas encore activé (Revolut non configuré) : aucune carte demandée pendant l'essai.
  if (simulated && s.status === "trialing") {
    const left = s.currentPeriodEnd ? daysLeft(s.currentPeriodEnd) : null;
    if (s.pendingPlan || onBilling) return null;
    return (
      <Banner tone="neutral">
        <span data-testid="trial-simulated-banner" className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
          <CreditCard className="size-3.5 shrink-0 text-text-muted" aria-hidden />
          <span><span className="font-medium text-text">Choisissez votre offre</span>{left !== null ? <> — <span className="num">{left}</span> jour{left > 1 ? "s" : ""} d'essai restant{left > 1 ? "s" : ""}</> : null}. Paiement pas encore activé : aucune carte demandée, rien ne sera débité.</span>
          <Link to="/app/settings/billing" className="font-medium text-accent underline-offset-2 hover:underline">Choisir mon offre</Link>
        </span>
      </Banner>
    );
  }
  if (s.status === "trialing" && !s.cardOnFile) {
    const left = s.currentPeriodEnd ? daysLeft(s.currentPeriodEnd) : null;
    return (
      <Banner tone="neutral">
        <span data-testid="trial-card-banner" className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
          <CreditCard className="size-3.5 shrink-0 text-text-muted" aria-hidden />
          <span><span className="font-medium text-text">Enregistrez votre carte pour garder l'accès après l'essai</span>{left !== null ? <> — <span className="num">{left}</span> jour{left > 1 ? "s" : ""} restant{left > 1 ? "s" : ""}, rien n'est débité avant la fin.</> : "."}</span>
          {onBilling ? null : <Link to="/app/settings/billing" className="font-medium text-accent underline-offset-2 hover:underline">Enregistrer ma carte</Link>}
        </span>
      </Banner>
    );
  }
  if (s.status === "past_due") {
    return (
      <Banner tone="danger">
        <span data-testid="past-due-banner" className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
          <span>Le dernier paiement a échoué{s.nextChargeAt ? <> — prochaine tentative le <span className="num">{formatDate(s.nextChargeAt)}</span></> : null}.</span>
          {onBilling ? null : <Link to="/app/settings/billing" className="font-medium underline-offset-2 hover:underline">Vérifier ma carte</Link>}
        </span>
      </Banner>
    );
  }
  return null;
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
