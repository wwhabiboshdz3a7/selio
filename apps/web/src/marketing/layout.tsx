import { useEffect, useState, useSyncExternalStore } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigationType } from "react-router";
import { Menu as MenuIcon, X, Moon, Sun } from "lucide-react";
import { IconButton, buttonClass, cn } from "@selio/ui";
import { useTheme } from "../lib/theme";
import { Logo } from "../components/Logo";
import { useSession } from "../lib/data/provider";
import { getOverNight, getOverNightServer, subscribeOverNight } from "./nightHeader";
import { HUB_PATH } from "../app/spaces/paths";

const NAV = [
  { to: "/fonctionnalites", label: "Fonctionnalités" },
  { to: "/plateforme", label: "Plateforme" },
  { to: "/extension", label: "Extension" },
  { to: "/assistant-ia", label: "Assistant IA" },
  { to: "/tarifs", label: "Tarifs" },
  { to: "/faq", label: "FAQ" },
];

export function MarketingLayout() {
  const [open, setOpen] = useState(false);
  const { resolved, setPreference } = useTheme();
  const location = useLocation();
  const session = useSession();
  const authPage = ["/connexion", "/inscription", "/demo", "/mot-de-passe-oublie", "/mot-de-passe", "/invitation"].includes(location.pathname);
  const { pathname, hash } = location;
  const navigationType = useNavigationType();
  const overNight = useSyncExternalStore(subscribeOverNight, getOverNight, getOverNightServer) && !open;
  // Navigation interne : haut de page, ou ancre (/fonctionnalites#generateur) si présente.
  // Retour arrière (POP) : le navigateur restaure lui-même la position.
  useEffect(() => {
    if (navigationType === "POP" && !hash) return;
    if (hash.length > 1) {
      const el = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (el) {
        el.scrollIntoView({ block: "start" });
        return;
      }
    }
    window.scrollTo({ top: 0 });
  }, [pathname, hash, navigationType]);
  return (
    <div className="mk-scope flex min-h-dvh flex-col bg-bg">
      <a href="#contenu" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">Aller au contenu</a>
      <header className="mk-header sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur-md" data-over-night={overNight || undefined}>
        <div className="mx-auto flex h-14 max-w-content items-center justify-between gap-4 px-4 md:px-8">
          <Link to="/" aria-label="Selio, accueil" className="shrink-0"><Logo height={24} inverse={overNight} /></Link>
          <nav aria-label="Navigation principale" className="hidden items-center gap-1 lg:flex">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => cn("relative rounded-md px-3 py-2 text-base font-medium transition-colors hover:text-text", isActive ? "text-text after:absolute after:bottom-0 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-gold" : "text-text-muted")}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <IconButton label={resolved === "dark" ? "Passer en mode clair" : "Passer en mode sombre"} onClick={() => setPreference(resolved === "dark" ? "light" : "dark")} size="sm">
              {resolved === "dark" ? <Sun /> : <Moon />}
            </IconButton>
            {session.data ? (
              <Link to={HUB_PATH} className={buttonClass({ variant: "accent", size: "sm", className: "max-md:hidden" })}>Ouvrir l'application</Link>
            ) : (
              <>
                <Link to="/connexion" className={buttonClass({ variant: "ghost", size: "sm", className: "mk-header-ghost max-md:hidden" })}>Connexion</Link>
                {!authPage ? <Link to="/demo" className={buttonClass({ variant: "accent", size: "sm", className: "max-md:hidden" })}>Voir la démo</Link> : null}
              </>
            )}
            <IconButton label={open ? "Fermer le menu" : "Ouvrir le menu"} className="lg:hidden" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="menu-mobile">
              {open ? <X /> : <MenuIcon />}
            </IconButton>
          </div>
        </div>
        {open ? (
          <nav id="menu-mobile" aria-label="Navigation mobile" className="border-t border-border bg-surface px-4 py-3 lg:hidden">
            <ul className="flex flex-col gap-1">
              {NAV.map((n) => (
                <li key={n.to}><NavLink to={n.to} onClick={() => setOpen(false)} className={({ isActive }) => cn("block rounded-md px-3 py-2.5 text-base font-medium", isActive ? "bg-surface-muted text-text" : "text-text-muted")}>{n.label}</NavLink></li>
              ))}
              <li className="mt-2 flex gap-2">
                {session.data ? <Link to={HUB_PATH} className={buttonClass({ variant: "accent", className: "flex-1" })} onClick={() => setOpen(false)}>Ouvrir l'application</Link> : (
                  <>
                    <Link to="/connexion" className={buttonClass({ variant: "secondary", className: "flex-1" })} onClick={() => setOpen(false)}>Connexion</Link>
                    <Link to="/demo" className={buttonClass({ variant: "accent", className: "flex-1" })} onClick={() => setOpen(false)}>Voir la démo</Link>
                  </>
                )}
              </li>
            </ul>
          </nav>
        ) : null}
      </header>
      <main id="contenu" className="flex-1">
        <Outlet />
      </main>
      <footer className="bg-surface">
        <div aria-hidden className="h-px bg-[linear-gradient(90deg,transparent,var(--violet-300)_30%,var(--gold-300)_70%,transparent)] opacity-70" />
        <div className="mx-auto grid max-w-content gap-8 px-4 py-12 md:grid-cols-4 md:px-8">
          <div className="md:col-span-1">
            <Logo height={22} />
            <p className="mt-3 max-w-xs text-sm text-text-muted">L'outil de gestion des revendeurs : stock, conversations, clients, commandes et marges au même endroit.</p>
          </div>
          <FooterCol title="Produit" links={[["/fonctionnalites", "Fonctionnalités"], ["/plateforme", "Les espaces Selio"], ["/extension", "Extension navigateur"], ["/assistant-ia", "Assistant IA"], ["/tarifs", "Tarifs"]]} />
          <FooterCol title="Aide" links={[["/faq", "FAQ"], ["/contact", "Contact"], ["/demo", "Démonstration"], ["/connexion", "Connexion"]]} />
          <FooterCol title="Légal" links={[["/mentions-legales", "Mentions légales"], ["/confidentialite", "Confidentialité"], ["/conditions", "Conditions d'utilisation"]]} />
        </div>
        <div className="border-t border-border">
          <p className="mx-auto max-w-content px-4 py-4 text-xs text-text-muted md:px-8">Selio est un outil indépendant. Il n'est ni affilié à Vinted ni approuvé par Vinted. Les textes juridiques de ce site sont des brouillons à compléter avant publication.</p>
        </div>
      </footer>
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h2 className="text-xs font-medium tracking-[0.08em] text-text-muted uppercase">{title}</h2>
      <ul className="mt-3 flex flex-col gap-2">
        {links.map(([to, label]) => (
          <li key={to}><Link to={to} className="text-sm text-text hover:text-accent">{label}</Link></li>
        ))}
      </ul>
    </div>
  );
}
