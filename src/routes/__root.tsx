import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { Outlet, Link, createRootRouteWithContext, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { Header } from "../components/layout/Header";
import { Footer } from "../components/layout/Footer";

function NotFoundComponent() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-3xl font-semibold text-[var(--color-selio-primary-dark)]">Page introuvable</h1>
      <p className="text-[var(--color-selio-text-muted)]">Cette page n&rsquo;existe pas ou a ete deplacee.</p>
      <Link to="/" className="selio-btn selio-btn-primary mt-2">Retour a l&rsquo;accueil</Link>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-2xl font-semibold text-[var(--color-selio-primary-dark)]">Un probleme est survenu</h1>
      <p className="text-[var(--color-selio-text-muted)]">Vous pouvez reessayer ou revenir a l&rsquo;accueil.</p>
      <div className="mt-2 flex gap-2">
        <button onClick={() => { router.invalidate(); reset(); }} className="selio-btn selio-btn-primary" type="button">
          Reessayer
        </button>
        <a href="/" className="selio-btn selio-btn-outline">Accueil</a>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <ServiceWorkerRegistration />
      <div className="flex min-h-dvh flex-col">
        <Header />
        <main className="flex-1">
          <Outlet />
        </main>
        <Footer />
      </div>
    </QueryClientProvider>
  );
}
