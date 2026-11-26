import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { Alert, Button, Field, Input, LoadingState } from "@selio/ui";
import { Logo } from "../components/Logo";
import { usePageMeta } from "../lib/seo";
import { queryClient, sessionKey, useData, useSession } from "../lib/data/provider";
import { errorMessage } from "../lib/errors";
import { connectedModeAvailable, publicSiteUrl } from "../lib/env";
import { adminLandingPath, operatorRoleOfSession } from "../lib/admin";

const DEMO_EMAIL = "marie@demo.selio.local";

/**
 * Connexion au site Selio Admin : sobre, sans vitrine. Seuls les opérateurs (OPERATOR_EMAILS,
 * OPERATOR_BUSINESS_EMAILS côté API) entrent ; un autre compte est déconnecté aussitôt avec un message clair.
 * Démonstration (build sans API, pour les tests) : identifiants fictifs pré-remplis.
 */
export default function AdminLogin() {
  usePageMeta("Selio Admin — Connexion", "Connexion à Selio Admin.", { noindex: true });
  const { client, mode } = useData();
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string; error?: string } };
  const [email, setEmail] = useState(mode === "demo" ? DEMO_EMAIL : "");
  const [password, setPassword] = useState(mode === "demo" ? "demo" : "");
  const [error, setError] = useState<string | null>(location.state?.error ?? null);
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);
  useEffect(() => {
    document.title = "Selio Admin — Connexion";
  }, []);

  if (session.isPending) return <LoadingState variant="spinner" label="Vérification de la session…" className="min-h-dvh" />;
  // Déjà connecté en opérateur : directement à l'administration.
  if (session.data && operatorRoleOfSession(session.data)) return <Navigate to={adminLandingPath(location.state?.from)} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Double clic ou Entrée répétée : une seule connexion envoyée.
    if (submitting.current) return;
    if (!email.trim() || !password) {
      setError("Indiquez votre email et votre mot de passe.");
      return;
    }
    submitting.current = true;
    setError(null);
    setLoading(true);
    try {
      const s = await client.login({ email: email.trim(), password });
      if (!operatorRoleOfSession(s)) {
        // Compte client : aucune session gardée sur ce site.
        await client.logout().catch(() => undefined);
        queryClient.setQueryData([...sessionKey, mode], null);
        setError("Ce compte n'a pas accès à Selio Admin. Seule l'équipe Selio peut s'y connecter.");
        return;
      }
      queryClient.setQueryData([...sessionKey, mode], s);
      navigate(adminLandingPath(location.state?.from), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Logo height={26} />
          <h1 className="text-xl font-semibold text-text">Selio Admin</h1>
          <p className="text-sm text-text-muted">Espace réservé à l'équipe Selio.</p>
        </div>
        {!connectedModeAvailable && mode === "connected" ? <Alert tone="warning" className="mb-4" title="Aucune API configurée">Ce site n'a pas d'adresse d'API (VITE_API_BASE_URL).</Alert> : null}
        {mode === "demo" ? <Alert tone="info" className="mb-4">Installation de test sans API : identifiants fictifs pré-remplis.</Alert> : null}
        <form onSubmit={submit} className="card flex flex-col gap-4 p-5" noValidate aria-label="Connexion à Selio Admin">
          <Field label="Email" required>{(p) => <Input id={p.id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />}</Field>
          <Field label="Mot de passe" required>{(p) => <Input id={p.id} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />}</Field>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Button type="submit" variant="accent" loading={loading} fullWidth>Se connecter</Button>
        </form>
        <p className="mt-4 text-center text-xs text-text-muted">
          Mot de passe oublié : réinitialisez-le depuis {publicSiteUrl ? <a href={`${publicSiteUrl}/mot-de-passe-oublie`} className="underline underline-offset-2 hover:text-text" rel="noopener">le site Selio</a> : "le site Selio"}, puis revenez ici.
        </p>
      </div>
    </main>
  );
}
