import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { LoadingState, ErrorState } from "@selio/ui";
import { usePageMeta } from "../../lib/seo";
import { Container } from "../components";
import { useData } from "../../lib/data/provider";
import { errorMessage } from "../../lib/errors";
import { APP_PATH_PATTERN, HUB_PATH } from "../../app/spaces/paths";

/**
 * Page d'arrivée demandée (?vers=/app/…, /studio, /agence, /global), limitée à l'application :
 * aucune redirection externe. Sans demande : l'accueil central des espaces.
 */
export function demoTarget(raw: string | null): string {
  return raw && APP_PATH_PATTERN.test(raw) ? raw : HUB_PATH;
}

/** Entrée directe dans la démonstration : force le mode démo, ouvre la session, redirige. */
export default function DemoEntry() {
  usePageMeta("Démonstration", "Ouvrir la démonstration Selio avec des données fictives.", { noindex: true });
  const { client, mode, setMode } = useData();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const target = demoTarget(params.get("vers"));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (mode !== "demo") {
      setMode("demo");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const existing = await client.getSession();
        if (!existing) await client.login({ email: "marie@demo.selio.local", password: "demo" });
        if (!cancelled) navigate(target, { replace: true });
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      }
    })();
    return () => { cancelled = true; };
  }, [client, mode, setMode, navigate, target]);
  return (
    <Container className="mk-hero py-16">
      {error ? <ErrorState title="Impossible d'ouvrir la démonstration" description={error} onRetry={() => window.location.reload()} /> : <LoadingState label="Préparation des données de démonstration…" />}
    </Container>
  );
}
