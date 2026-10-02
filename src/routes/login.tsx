import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useInvalidateCurrentUser } from "../hooks/useCurrentUser";

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
  const navigate = useNavigate();
  const invalidateUser = useInvalidateCurrentUser();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) throw new Error("Email ou mot de passe incorrect");
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
      <h1 className="text-2xl font-semibold text-[var(--color-selio-primary-dark)]">Connexion</h1>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div><label className="selio-label">Email</label><input type="email" className="selio-input" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <div><label className="selio-label">Mot de passe</label><input type="password" className="selio-input" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        {error && <p className="text-sm text-[var(--color-selio-danger)]">{error}</p>}
        <button type="submit" className="selio-btn selio-btn-primary w-full" disabled={submitting}>{submitting ? "Connexion..." : "Se connecter"}</button>
      </form>
      <p className="mt-4 text-sm text-[var(--color-selio-text-muted)]">
        Pas encore de compte ? <Link to="/register" className="font-medium text-[var(--color-selio-primary)] hover:underline">Inscrivez-vous</Link>
      </p>
    </div>
  );
}
