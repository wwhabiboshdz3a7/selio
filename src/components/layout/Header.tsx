import { useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Logo } from "../icons/Logo";
import { useCurrentUser, useInvalidateCurrentUser } from "../../hooks/useCurrentUser";

export function Header() {
  const navigate = useNavigate();
  const routerState = useRouterState();
  const { data: user, isLoading } = useCurrentUser();
  const invalidateUser = useInvalidateCurrentUser();
  const [q, setQ] = useState("");

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    navigate({ to: "/", search: (prev: Record<string, unknown>) => ({ ...prev, q: q || undefined }) });
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    invalidateUser();
    navigate({ to: "/" });
  }

  const current = routerState.location.pathname;
  const navLink = (to: string, label: string) => (
    <Link to={to} className={`text-sm font-medium transition-colors hover:text-[var(--color-selio-primary)] ${current === to ? "text-[var(--color-selio-primary)]" : "text-[var(--color-selio-text-muted)]"}`}>
      {label}
    </Link>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-selio-border)] bg-white/95 backdrop-blur">
      <div className="selio-container flex flex-wrap items-center gap-3 py-3">
        <Link to="/" className="shrink-0"><Logo size="md" /></Link>

        <form onSubmit={onSearch} className="order-last flex w-full min-w-0 flex-1 items-center gap-2 sm:order-none sm:w-auto">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un article, une marque..." className="selio-input" aria-label="Rechercher" />
          <button type="submit" className="selio-btn selio-btn-outline shrink-0">Rechercher</button>
        </form>

        <nav className="flex shrink-0 items-center gap-4">
          {navLink("/", "Explorer")}
          {navLink("/favorites", "Favoris")}
          {navLink("/messages", "Messages")}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <Link to="/sell" className="selio-btn selio-btn-primary">Vendre</Link>
          {isLoading ? (
            <div className="h-9 w-20 animate-pulse rounded-full bg-[var(--color-selio-surface)]" />
          ) : user ? (
            <div className="flex items-center gap-2">
              <Link to="/account" className="text-sm font-medium text-[var(--color-selio-primary-dark)] hover:underline">{user.displayName}</Link>
              <button onClick={logout} className="selio-btn selio-btn-outline" type="button">Deconnexion</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link to="/login" className="selio-btn selio-btn-outline">Connexion</Link>
              <Link to="/register" className="selio-btn selio-btn-primary">Inscription</Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
