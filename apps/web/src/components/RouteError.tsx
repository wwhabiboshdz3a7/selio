import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { Button } from "@selio/ui";

export function RouteError() {
  const err = useRouteError();
  const is404 = isRouteErrorResponse(err) && err.status === 404;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-4 text-center">
      <p className="text-xs font-medium text-text-muted">{is404 ? "404" : "Erreur"}</p>
      <h1 className="mt-2 text-xl font-semibold">{is404 ? "Page introuvable" : "Quelque chose s'est mal passé"}</h1>
      <p className="mt-2 text-sm text-text-muted">{is404 ? "L'adresse demandée n'existe pas." : err instanceof Error ? err.message : "Rechargez la page ou revenez à l'accueil."}</p>
      <div className="mt-6 flex gap-2">
        <Button variant="secondary" onClick={() => window.location.reload()}>Recharger</Button>
        <Link to="/"><Button>Accueil</Button></Link>
      </div>
    </main>
  );
}
