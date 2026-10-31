import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Alert, Button, Field, Input } from "@selio/ui";
import { usePageMeta } from "../../lib/seo";
import { Container, Eyebrow } from "../components";
import { queryClient, sessionKey, useData } from "../../lib/data/provider";
import { errorCode, errorMessage } from "../../lib/errors";
import { HUB_PATH } from "../../app/spaces/paths";
import { PASSWORD_MIN_LENGTH, passwordFormErrors, takeTokenFromUrl, useConnectedForEmailLink } from "../email-links";

/**
 * Acceptation d'une invitation (`/invitation?token=…`) : la personne choisit son nom et son mot
 * de passe, le serveur consomme le jeton (7 jours, usage unique) et ouvre la session dans
 * l'organisation. Le jeton est retiré de l'adresse avant le premier rendu.
 */
export default function AcceptInvite() {
  usePageMeta("Invitation", "Rejoindre une organisation Selio depuis le lien reçu par email.", { noindex: true });
  const { client, mode } = useData();
  const { connected } = useConnectedForEmailLink();
  const navigate = useNavigate();
  const [token] = useState(() => takeTokenFromUrl());
  const [form, setForm] = useState({ displayName: "", password: "", confirm: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<{ message: string; code: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    const errs = passwordFormErrors(form.password, form.confirm);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setError(null);
    setLoading(true);
    try {
      const displayName = form.displayName.trim();
      const session = await client.acceptInvite({ token, password: form.password, ...(displayName ? { displayName } : {}) });
      // La session ouverte par le serveur remplace celle en cache (« aucune session » sur la vitrine).
      queryClient.setQueryData([...sessionKey, mode], session);
      navigate(HUB_PATH, { replace: true });
    } catch (err) {
      setError({ message: errorMessage(err), code: errorCode(err) });
    } finally {
      setLoading(false);
    }
  };
  return (
    <section className="mk-hero py-12 md:py-16">
      <Container className="max-w-md">
        <Eyebrow>Espace Selio</Eyebrow>
        <h1 className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-text">Rejoindre l'organisation</h1>
        <p className="mt-1 text-sm text-text-muted">Choisissez votre nom et votre mot de passe : vous serez connecté directement. Le lien reçu par email sert une fois et reste valable sept jours.</p>
        {!connected ? (
          <Alert tone="warning" title="Aucune API configurée" className="mt-4">Cette installation n'a pas d'URL d'API (VITE_API_BASE_URL) : l'invitation ne peut pas être vérifiée ici.</Alert>
        ) : null}
        {!token ? (
          <div className="card mt-4 flex flex-col gap-4 p-5">
            <Alert tone="danger" title="Lien incomplet">Ce lien ne contient pas de jeton. Ouvrez le lien complet reçu par email, ou demandez une nouvelle invitation à la personne qui vous a invité.</Alert>
            <p className="text-center text-sm text-text-muted">Déjà un compte ? <Link to="/connexion" className="font-medium text-text underline underline-offset-2">Se connecter</Link></p>
          </div>
        ) : (
          <form onSubmit={submit} className="card mt-4 flex flex-col gap-4 p-5" noValidate>
            <Field label="Votre nom" hint="Affiché à votre équipe. Facultatif si vous avez déjà un compte Selio.">{(p) => <Input id={p.id} aria-describedby={p.describedBy} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} autoComplete="name" maxLength={80} />}</Field>
            <Field label="Mot de passe" required error={errors.password} hint={`${PASSWORD_MIN_LENGTH} caractères minimum.`}>{(p) => <Input id={p.id} type="password" invalid={p.invalid} aria-describedby={p.describedBy} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />}</Field>
            <Field label="Confirmer le mot de passe" required error={errors.confirm}>{(p) => <Input id={p.id} type="password" invalid={p.invalid} aria-describedby={p.describedBy} value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} autoComplete="new-password" />}</Field>
            {error ? <Alert tone="danger" title={error.code === "token_invalid" ? "Invitation expirée ou déjà utilisée" : undefined}>{error.message}{error.code === "token_invalid" ? " Demandez une nouvelle invitation à l'administrateur de l'organisation." : ""}</Alert> : null}
            <Button type="submit" variant="accent" loading={loading} disabled={!connected} fullWidth>Rejoindre et se connecter</Button>
            <p className="text-center text-sm text-text-muted">Déjà un compte ? <Link to="/connexion" className="font-medium text-text underline underline-offset-2">Se connecter</Link></p>
          </form>
        )}
      </Container>
    </section>
  );
}
