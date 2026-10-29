import { useState } from "react";
import { Link } from "react-router";
import { Alert, Button, Field, Input } from "@selio/ui";
import { usePageMeta } from "../../lib/seo";
import { Container, Eyebrow } from "../components";
import { useData } from "../../lib/data/provider";
import { connectedModeAvailable } from "../../lib/env";
import { errorMessage } from "../../lib/errors";

/**
 * Mot de passe oublié : l'adresse saisie reçoit un lien à usage unique, valable une heure, si un
 * compte existe. La réponse est la même dans tous les cas (le serveur ne révèle pas si le compte
 * existe) ; la page le dit telle quelle.
 */
export default function ForgotPassword() {
  usePageMeta("Mot de passe oublié", "Recevoir un lien pour choisir un nouveau mot de passe Selio.", { noindex: true });
  const { client, mode } = useData();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const unavailable = mode === "connected" && !connectedModeAvailable;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Saisissez une adresse email valide.");
      return;
    }
    setLoading(true);
    try {
      await client.requestPasswordReset(email.trim().toLowerCase());
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };
  return (
    <section className="mk-hero py-12 md:py-16">
      <Container className="max-w-md">
        <Eyebrow>Espace Selio</Eyebrow>
        <h1 className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-text">Mot de passe oublié</h1>
        <p className="mt-1 text-sm text-text-muted">Indiquez l'adresse de votre compte : vous recevrez un lien pour choisir un nouveau mot de passe.</p>
        {unavailable ? (
          <Alert tone="warning" title="Aucune API configurée" className="mt-4">Cette installation n'a pas d'URL d'API (VITE_API_BASE_URL) : aucun email ne peut partir d'ici.</Alert>
        ) : null}
        {mode === "demo" ? <Alert tone="info" className="mt-4">En démonstration, aucun email n'est envoyé : ce formulaire ne sert qu'avec un compte connecté.</Alert> : null}
        {sent ? (
          <div className="card mt-4 flex flex-col gap-4 p-5">
            <Alert tone="success" title="Demande enregistrée">
              Si un compte existe avec cette adresse, un email vient de partir. Le lien est valable une heure et ne sert qu'une fois. Pensez à vérifier les indésirables.
            </Alert>
            <p className="text-center text-sm text-text-muted"><Link to="/connexion" className="font-medium text-text underline underline-offset-2">Retour à la connexion</Link></p>
          </div>
        ) : (
          <form onSubmit={submit} className="card mt-4 flex flex-col gap-4 p-5" noValidate>
            <Field label="Email" required>{(p) => <Input id={p.id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />}</Field>
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <Button type="submit" variant="accent" loading={loading} disabled={unavailable} fullWidth>Envoyer le lien</Button>
            <p className="text-center text-sm text-text-muted"><Link to="/connexion" className="font-medium text-text underline underline-offset-2">Retour à la connexion</Link></p>
          </form>
        )}
      </Container>
    </section>
  );
}
