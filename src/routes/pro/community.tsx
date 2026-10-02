import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatPrice } from "../../lib/format";

export const Route = createFileRoute("/pro/community")({ component: Community });

type Space = { id: string; name: string; description: string | null; myRole: string | null };
type LeaderboardEntry = { username: string; displayName: string; salesCount: number; totalRevenueCents: number };

async function fetchSpaces(): Promise<Space[]> {
  const res = await fetch("/api/pro/community/spaces", { credentials: "include" });
  const data = await res.json();
  return data.items ?? [];
}

async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  const res = await fetch("/api/pro/community/leaderboard", { credentials: "include" });
  const data = await res.json();
  return data.items ?? [];
}

function Community() {
  const qc = useQueryClient();
  const { data: spaces } = useQuery({ queryKey: ["pro-community-spaces"], queryFn: fetchSpaces });
  const { data: leaderboard } = useQuery({ queryKey: ["pro-community-leaderboard"], queryFn: fetchLeaderboard });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });

  async function createSpace(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    await fetch("/api/pro/community/spaces", {
      method: "POST", credentials: "include", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: form.name, description: form.description || undefined }),
    });
    setForm({ name: "", description: "" });
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["pro-community-spaces"] });
  }

  async function joinSpace(id: string) {
    await fetch(`/api/pro/community/spaces?id=${id}`, { method: "PUT", credentials: "include" });
    qc.invalidateQueries({ queryKey: ["pro-community-spaces"] });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-selio-primary-dark)]">Communaute</h1>
          <p className="mt-1 text-sm text-[var(--color-selio-text-muted)]">Espaces d&rsquo;echange entre vendeurs : docs, comparatifs, cadeaux.</p>
        </div>
        <button className="selio-btn selio-btn-primary" onClick={() => setOpen((v) => !v)} type="button">
          {open ? "Fermer" : "+ Creer un espace"}
        </button>
      </div>

      {open && (
        <form onSubmit={createSpace} className="selio-card-premium grid gap-3 p-4 sm:grid-cols-2">
          <div>
            <label className="selio-label">Nom de l&rsquo;espace</label>
            <input className="selio-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label className="selio-label">Description</label>
            <input className="selio-input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className="selio-btn selio-btn-primary">Creer (tu deviens admin)</button>
          </div>
        </form>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {spaces?.map((s) => (
          <div key={s.id} className="selio-card-premium p-4">
            <p className="font-medium">{s.name}</p>
            {s.description && <p className="mt-1 text-sm text-[var(--color-selio-text-muted)]">{s.description}</p>}
            <div className="mt-3 flex items-center gap-2">
              {s.myRole ? (
                <>
                  <span className="selio-chip">{s.myRole === "admin" ? "Admin" : "Membre"}</span>
                  <Link to="/pro/community/$spaceId" params={{ spaceId: s.id }} className="selio-btn selio-btn-outline !py-1 text-sm">Ouvrir</Link>
                </>
              ) : (
                <button className="selio-btn selio-btn-outline !py-1 text-sm" onClick={() => joinSpace(s.id)} type="button">Rejoindre</button>
              )}
            </div>
          </div>
        ))}
        {spaces && spaces.length === 0 && <p className="text-sm text-[var(--color-selio-text-muted)]">Aucun espace pour l&rsquo;instant.</p>}
      </div>

      <div className="selio-card-premium p-4">
        <h2 className="font-semibold text-[var(--color-selio-primary-dark)]">Classement des vendeurs</h2>
        <div className="mt-3 space-y-2">
          {leaderboard?.map((entry, i) => (
            <div key={entry.username} className="flex items-center justify-between border-b border-[var(--color-selio-border)] pb-2 text-sm last:border-0">
              <span>#{i + 1} {entry.displayName || entry.username}</span>
              <span className="text-[var(--color-selio-text-muted)]">{entry.salesCount} ventes · {formatPrice(entry.totalRevenueCents)}</span>
            </div>
          ))}
          {leaderboard && leaderboard.length === 0 && <p className="text-sm text-[var(--color-selio-text-muted)]">Pas encore de ventes enregistrees.</p>}
        </div>
      </div>
    </div>
  );
}
