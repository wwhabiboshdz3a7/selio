import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Alert, Button, Field, Input, Segmented } from "@selio/ui";
import { usePageMeta } from "../../lib/seo";
import { Container } from "../components";
import { useData } from "../../lib/data/provider";
import { connectedModeAvailable } from "../../lib/env";
import { errorMessage } from "../../lib/errors";
import type { Mode } from "../../lib/data/types";

export default function Login() {
  usePageMeta("Connexion", "Connexion à l'application Selio.", { noindex: true });
  const { client, mode, setMode } = useData();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string; error?: string } };
  const [email, setEmail] = useState(mode === "demo" ? "marie@demo.selio.local" : "");
  const [password, setPassword] = useState(mode === "demo" ? "demo" : "");
  const [error, setError] = useState<string | null>(location.state?.error ?? null);
  const [loading, setLoading] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await client.login({ email, password });
      navigate(location.state?.from && location.state.from.startsWith("/app") ? location.state.from : "/app", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };
  return (
    <section className="py-12">
      <Container className="max-w-md">
        <h1 className="text-xl font-semibold text-text">Connexion</h1>
        <p className="mt-1 text-sm text-text-muted">Choisissez le mode, puis identifiez-vous.</p>
        <div className="mt-4">
          <Segmented ariaLabel="Mode" value={mode} onChange={(m: Mode) => { setMode(m); setEmail(m === "demo" ? "marie@demo.selio.local" : ""); setPassword(m === "demo" ? "demo" : ""); setError(null); }} items={[{ value: "demo", label: "Démonstration" }, { value: "connected", label: "Compte connecté" }]} />
        </div>
        {mode === "connected" && !connectedModeAvailable ? (
          <Alert tone="warning" title="Aucune API configurée" className="mt-4">Cette installation n'a pas d'URL d'API (VITE_API_BASE_URL). Le mode connecté est indisponible ici ; la démonstration reste accessible.</Alert>
        ) : null}
        {mode === "demo" ? <Alert tone="info" className="mt-4">En démonstration, les identifiants pré-remplis suffisent : aucune donnée réelle n'est utilisée.</Alert> : null}
        <form onSubmit={submit} className="card mt-4 flex flex-col gap-4 p-5" noValidate>
          <Field label="Email" required>{(p) => <Input id={p.id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />}</Field>
          <Field label="Mot de passe" required>{(p) => <Input id={p.id} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />}</Field>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Button type="submit" loading={loading} disabled={mode === "connected" && !connectedModeAvailable} fullWidth>{mode === "demo" ? "Entrer dans la démonstration" : "Se connecter"}</Button>
          <p className="text-center text-sm text-text-muted">Pas de compte ? <Link to="/inscription" className="font-medium text-text underline underline-offset-2">Créer un compte</Link></p>
        </form>
      </Container>
    </section>
  );
}
