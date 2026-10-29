import { useState } from "react";
import { Link } from "react-router";
import { Alert, Button, Field, Input } from "@selio/ui";
import { usePageMeta } from "../../lib/seo";
import { Container, Eyebrow } from "../components";
import { useData } from "../../lib/data/provider";
import { errorCode, errorMessage } from "../../lib/errors";
import { PASSWORD_MIN_LENGTH, passwordFormErrors, takeTokenFromUrl, useConnectedForEmailLink } from "../email-links";

/**
 * Nouveau mot de passe depuis le lien reçu par email (`/mot-de-passe?token=…`). Le jeton est lu
 * puis retiré de l'adresse avant le premier rendu ; il sert une fois et expire au bout d'une
 * heure. Toutes les sessions ouvertes du compte sont fermées par le serveur.
 */
export default function ResetPassword() {
  usePageMeta("Nouveau mot de passe", "Choisir un nouveau mot de passe Selio depuis le lien reçu par email.", { noindex: true });
  const { client } = useData();
  const { connected } = useConnectedForEmailLink();
  const [token] = useState(() => takeTokenFromUrl());
  const [form, setForm] = useState({ password: "", confirm: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<{ message: string; code: string | null } | null>(null);
  const [done, setDone] = useState(false);
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
      await client.resetPassword({ token, password: form.password });
      setDone(true);
    } catch (err) {
      setError({ message: errorMessage(err), code: errorCode(err) });
    } finally {
      setLoading(false);
    }
  };
  const newLink = <p className="text-center text-sm text-text-muted"><Link to="/mot-de-passe-oublie" className="font-medium text-text underline underline-offset-2">Demander un nouveau lien</Link></p>;
  return (
    <section className="mk-hero py-12 md:py-16">
      <Container className="max-w-md">
        <Eyebrow>Espace Selio</Eyebrow>
        <h1 className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-text">Nouveau mot de passe</h1>
        <p className="mt-1 text-sm text-text-muted">Choisissez un nouveau mot de passe pour votre compte. Le lien reçu par email sert une fois et reste valable une heure.</p>
        {!connected ? (
          <Alert tone="warning" title="Aucune API configurée" className="mt-4">Cette installation n'a pas d'URL d'API (VITE_API_BASE_URL) : le lien ne peut pas être vérifié ici.</Alert>
        ) : null}
        {!token ? (
          <div className="card mt-4 flex flex-col gap-4 p-5">
            <Alert tone="danger" title="Lien incomplet">Ce lien ne contient pas de jeton. Ouvrez le lien complet reçu par email, ou demandez-en un nouveau.</Alert>
            {newLink}
          </div>
        ) : done ? (
          <div className="card mt-4 flex flex-col gap-4 p-5">
            <Alert tone="success" title="Mot de passe modifié">Votre nouveau mot de passe est enregistré et vos autres sessions ont été fermées. Vous pouvez vous connecter.</Alert>
            <p className="text-center text-sm text-text-muted"><Link to="/connexion" className="font-medium text-text underline underline-offset-2">Se connecter</Link></p>
          </div>
        ) : (
          <form onSubmit={submit} className="card mt-4 flex flex-col gap-4 p-5" noValidate>
            <Field label="Nouveau mot de passe" required error={errors.password} hint={`${PASSWORD_MIN_LENGTH} caractères minimum.`}>{(p) => <Input id={p.id} type="password" invalid={p.invalid} aria-describedby={p.describedBy} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />}</Field>
            <Field label="Confirmer le mot de passe" required error={errors.confirm}>{(p) => <Input id={p.id} type="password" invalid={p.invalid} aria-describedby={p.describedBy} value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} autoComplete="new-password" />}</Field>
            {error ? <Alert tone="danger" title={error.code === "token_invalid" ? "Lien expiré ou déjà utilisé" : undefined}>{error.message}</Alert> : null}
            <Button type="submit" variant="accent" loading={loading} disabled={!connected} fullWidth>Enregistrer le mot de passe</Button>
            {error?.code === "token_invalid" ? newLink : null}
          </form>
        )}
      </Container>
    </section>
  );
}
