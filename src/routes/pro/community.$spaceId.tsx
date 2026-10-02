import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/pro/community/$spaceId")({ component: SpaceDetail });

type Post = { id: string; kind: string; title: string; body: string; createdAt: string; author: { username: string; displayName: string } };

const KIND_LABELS: Record<string, string> = { doc: "Doc", gift: "Cadeau", announcement: "Annonce" };

async function fetchPosts(spaceId: string): Promise<Post[]> {
  const res = await fetch(`/api/pro/community/posts?spaceId=${spaceId}`, { credentials: "include" });
  const data = await res.json();
  return data.items ?? [];
}

function SpaceDetail() {
  const { spaceId } = Route.useParams();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["pro-community-posts", spaceId], queryFn: () => fetchPosts(spaceId) });
  const [form, setForm] = useState({ kind: "announcement", title: "", body: "" });
  const [error, setError] = useState<string | null>(null);

  async function submitPost(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.title.trim() || !form.body.trim()) return;
    const res = await fetch("/api/pro/community/posts", {
      method: "POST", credentials: "include", headers: { "content-type": "application/json" },
      body: JSON.stringify({ spaceId, kind: form.kind, title: form.title, body: form.body }),
    });
    if (res.status === 403) {
      setError("Seul un admin de cet espace peut publier un doc ou un cadeau.");
      return;
    }
    setForm({ kind: "announcement", title: "", body: "" });
    qc.invalidateQueries({ queryKey: ["pro-community-posts", spaceId] });
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-[var(--color-selio-primary-dark)]">Espace</h1>

      <form onSubmit={submitPost} className="selio-card-premium space-y-3 p-4">
        <div className="flex gap-3">
          <select className="selio-input w-40" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            <option value="announcement">Annonce</option>
            <option value="doc">Doc (admin)</option>
            <option value="gift">Cadeau (admin)</option>
          </select>
          <input className="selio-input flex-1" placeholder="Titre" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </div>
        <textarea className="selio-input" rows={3} placeholder="Contenu" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        {error && <p className="text-sm text-[var(--color-selio-danger)]">{error}</p>}
        <button type="submit" className="selio-btn selio-btn-primary">Publier</button>
      </form>

      <div className="space-y-3">
        {data?.map((post) => (
          <div key={post.id} className="selio-card-premium p-4">
            <div className="flex items-center justify-between">
              <span className="selio-chip">{KIND_LABELS[post.kind] ?? post.kind}</span>
              <span className="text-xs text-[var(--color-selio-text-muted)]">{new Date(post.createdAt).toLocaleString("fr-FR")}</span>
            </div>
            <p className="mt-2 font-medium">{post.title}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--color-selio-text-muted)]">{post.body}</p>
            <p className="mt-2 text-xs text-[var(--color-selio-text-muted)]">par {post.author.displayName || post.author.username}</p>
          </div>
        ))}
        {data && data.length === 0 && <p className="text-sm text-[var(--color-selio-text-muted)]">Aucune publication pour l&rsquo;instant.</p>}
      </div>
    </div>
  );
}
