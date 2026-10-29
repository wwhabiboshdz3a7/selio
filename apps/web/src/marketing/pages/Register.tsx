import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { PLAN_LABELS, TRIAL_DAYS, registerInput } from "@selio/contracts";
import { Alert, Button, Field, Input, Segmented } from "@selio/ui";
import { TRIAL_OFFER } from "@selio/demo-data";
import { usePageMeta } from "../../lib/seo";
import { Container, Eyebrow } from "../components";
import { useData } from "../../lib/data/provider";
import { connectedModeAvailable } from "../../lib/env";
import { errorMessage } from "../../lib/errors";
import type { Mode } from "../../lib/data/types";

export default function Register() {
  usePageMeta("Inscription", "Créer un compte Selio et une organisation.", { noindex: true });
  const { client, mode, setMode } = useData();
  const navigate = useNavigate();
  const [form, setForm] = useState({ displayName: "", orgName: "", email: "", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Une seule durée d'essai : 14 jours (l'ancien choix 7 / 30 jours n'existe plus).
    const parsed = registerInput.safeParse({ ...form, trialDays: TRIAL_DAYS });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[String(i.path[0])] = i.path[0] === "password" ? "Dix caractères minimum." : i.path[0] === "email" ? "Adresse email invalide." : "Champ requis.";
      setErrors(errs);
      return;
    }
    setErrors({});
    setError(null);
    setLoading(true);
    try {
      await client.register(parsed.data);
      navigate("/app/onboarding", { replace: true });
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
        <h1 className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-text">Créer un compte</h1>
        <p className="mt-1 text-sm text-text-muted">Un compte, une organisation. Vous pourrez inviter des collègues ensuite.</p>
        <div className="mt-4">
          <Segmented ariaLabel="Mode" value={mode} onChange={(m: Mode) => setMode(m)} items={[{ value: "demo", label: "Démonstration" }, { value: "connected", label: "Compte connecté" }]} />
        </div>
        {mode === "connected" && !connectedModeAvailable ? <Alert tone="warning" title="Aucune API configurée" className="mt-4">Le mode connecté nécessite une API déployée (VITE_API_BASE_URL). Vous pouvez créer un compte de démonstration.</Alert> : null}
        {mode === "demo" ? <Alert tone="info" className="mt-4">En démonstration, le compte est créé localement dans votre navigateur avec des données fictives.</Alert> : null}
        <form onSubmit={submit} className="card mt-4 flex flex-col gap-4 p-5" noValidate>
          <Field label="Votre nom" required error={errors.displayName}>{(p) => <Input id={p.id} invalid={p.invalid} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} autoComplete="name" />}</Field>
          <Field label="Nom de l'organisation" required error={errors.orgName} hint="Votre boutique, votre atelier, votre nom de vendeur.">{(p) => <Input id={p.id} invalid={p.invalid} aria-describedby={p.describedBy} value={form.orgName} onChange={(e) => setForm({ ...form, orgName: e.target.value })} autoComplete="organization" />}</Field>
          <Field label="Email" required error={errors.email}>{(p) => <Input id={p.id} type="email" invalid={p.invalid} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" />}</Field>
          <Field label="Mot de passe" required error={errors.password} hint="Dix caractères minimum.">{(p) => <Input id={p.id} type="password" invalid={p.invalid} aria-describedby={p.describedBy} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />}</Field>
          <div className="rounded-md bg-surface-muted px-3 py-2.5" data-testid="trial-terms">
            <p className="text-sm font-medium text-text">{TRIAL_DAYS} jours d'essai, carte enregistrée, rien n'est débité avant la fin.</p>
            <p className="mt-0.5 text-xs text-text-muted">Toutes les fonctions du plan {PLAN_LABELS[TRIAL_OFFER.plan]} pendant l'essai ; ensuite Starter, Pro ou Agence au choix, ou vous arrêtez sans frais. <Link to="/tarifs" className="underline underline-offset-2">Voir les tarifs</Link></p>
            <p className="mt-1.5 text-xs text-text-muted">Aucune carte à saisir maintenant : elle vous sera demandée à la première ouverture de l'application, dans le formulaire sécurisé Revolut (le numéro ne transite jamais par Selio).</p>
          </div>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Button type="submit" variant="accent" loading={loading} disabled={mode === "connected" && !connectedModeAvailable} fullWidth>Créer le compte</Button>
          <p className="text-center text-sm text-text-muted">Déjà inscrit ? <Link to="/connexion" className="font-medium text-text underline underline-offset-2">Se connecter</Link></p>
        </form>
      </Container>
    </section>
  );
}
