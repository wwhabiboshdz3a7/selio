import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useInvalidateCurrentUser } from "../hooks/useCurrentUser";

export const Route = createFileRoute("/register")({ component: RegisterPage });

function RegisterPage() {
  const navigate = useNavigate();
  const invalidateUser = useInvalidateCurrentUser();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, username, displayName, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(data.error === "email_or_username_taken" ? "Cet email ou ce pseudo est deja utilise" : "Inscription impossible, verifiez vos informations (mot de passe 8 caracteres min.)");
      }
      invalidateUser();
      navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inattendue");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="selio-container max-w-sm py-16">
      <h1 className="text-2xl font-semibold text-[var(--color-selio-primary-dark)]">Creer un compte</h1>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div><label className="selio-label">Nom affiche</label><input className="selio-input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required /></div>
        <div><label className="selio-label">Pseudo</label><input className="selio-input" value={username} onChange={(e) => setUsername(e.target.value)} pattern="[a-z0-9_]+" title="Lettres minuscules, chiffres et underscore" required /></div>
        <div><label className="selio-label">Email</label><input type="email" className="selio-input" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <div><label className="selio-label">Mot de passe</label><input type="password" className="selio-input" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required /></div>
        {error && <p className="text-sm text-[var(--color-selio-danger)]">{error}</p>}
        <button type="submit" className="selio-btn selio-btn-primary w-full" disabled={submitting}>{submitting ? "Creation..." : "Creer mon compte"}</button>
      </form>
      <p className="mt-4 text-sm text-[var(--color-selio-text-muted)]">
        Deja inscrit ? <Link to="/login" className="font-medium text-[var(--color-selio-primary)] hover:underline">Connectez-vous</Link>
      </p>
    </div>
  );
}
