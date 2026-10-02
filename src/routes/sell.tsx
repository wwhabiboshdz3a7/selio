import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { PhotoUploader, type UploadedPhoto } from "../components/listing/PhotoUploader";
import { CATEGORIES, CONDITIONS } from "../lib/validation";
import { CATEGORY_LABELS, CONDITION_LABELS } from "../lib/format";

export const Route = createFileRoute("/sell")({ component: Sell });

function Sell() {
  const { data: user, isLoading: userLoading } = useCurrentUser();
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [size, setSize] = useState("");
  const [condition, setCondition] = useState<string>(CONDITIONS[2]);
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!userLoading && !user) {
    return (
      <div className="selio-container py-16 text-center">
        <h1 className="text-2xl font-semibold text-[var(--color-selio-primary-dark)]">Connectez-vous pour vendre sur Selio</h1>
        <p className="mt-2 text-[var(--color-selio-text-muted)]">Un compte gratuit suffit pour publier votre premiere annonce.</p>
        <Link to="/login" className="selio-btn selio-btn-primary mt-4 inline-flex">Se connecter</Link>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const priceCents = Math.round(parseFloat(price.replace(",", ".")) * 100);
    if (!title.trim() || !description.trim() || Number.isNaN(priceCents) || photos.length === 0) {
      setError("Merci de remplir le titre, la description, le prix et d'ajouter au moins une photo.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/listings", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, description, priceCents, category, size: size || null, condition, imageKeys: photos.map((p) => p.key) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(data.error ?? "Echec de la publication");
      }
      const data = (await res.json()) as { id: string };
      navigate({ to: "/listing/$id", params: { id: data.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inattendue");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="selio-container max-w-2xl py-8">
      <h1 className="text-2xl font-semibold text-[var(--color-selio-primary-dark)]">Deposer une annonce</h1>
      <p className="mt-1 text-sm text-[var(--color-selio-text-muted)]">Ajoutez des photos nettes et une description honnete pour vendre plus vite.</p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-5">
        <div><label className="selio-label">Photos</label><PhotoUploader photos={photos} onChange={setPhotos} /></div>
        <div><label className="selio-label">Titre</label><input className="selio-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required /></div>
        <div><label className="selio-label">Description</label><textarea className="selio-input" rows={5} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} required /></div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="selio-label">Prix (€)</label><input className="selio-input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="25.00" required /></div>
          <div><label className="selio-label">Taille</label><input className="selio-input" value={size} onChange={(e) => setSize(e.target.value)} placeholder="M, 38, unique..." /></div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="selio-label">Categorie</label>
            <select className="selio-input" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </select>
          </div>
          <div>
            <label className="selio-label">Etat</label>
            <select className="selio-input" value={condition} onChange={(e) => setCondition(e.target.value)}>
              {CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABELS[c]}</option>)}
            </select>
          </div>
        </div>
        {error && <p className="text-sm text-[var(--color-selio-danger)]">{error}</p>}
        <button type="submit" className="selio-btn selio-btn-primary w-full" disabled={submitting}>
          {submitting ? "Publication..." : "Publier l'annonce"}
        </button>
      </form>
    </div>
  );
}
