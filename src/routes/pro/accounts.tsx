import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/pro/accounts")({ component: Accounts });

type Account = { id: string; platform: string; label: string; status: string; created_at: string };

async function fetchAccounts(): Promise<Account[]> {
  const res = await fetch("/api/pro/accounts", { credentials: "include" });
  const data = await res.json();
  return data.items ?? [];
}

function Accounts() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["pro-accounts"], queryFn: fetchAccounts });
  const [label, setLabel] = useState("");
  const [platform, setPlatform] = useState<"vinted" | "selio">("vinted");

  async function addAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    await fetch("/api/pro/accounts", {
      method: "POST", credentials: "include", headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform, label }),
    });
    setLabel("");
    qc.invalidateQueries({ queryKey: ["pro-accounts"] });
  }

  async function removeAccount(id: string) {
    await fetch(`/api/pro/accounts?id=${id}`, { method: "DELETE", credentials: "include" });
    qc.invalidateQueries({ queryKey: ["pro-accounts"] });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--color-selio-primary-dark)]">Comptes de vente</h1>
        <p className="mt-1 text-sm text-[var(--color-selio-text-muted)]">
          Centralise le suivi de tes differents canaux de vente. Vinted n&rsquo;ayant pas d&rsquo;API publique, ces comptes
          restent au statut <strong>non connecte</strong> — ils servent a organiser ton suivi (dressing, ventes) par canal,
          pas a publier automatiquement sur Vinted.
        </p>
      </div>

      <form onSubmit={addAccount} className="selio-card-premium flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="selio-label">Plateforme</label>
          <select className="selio-input" value={platform} onChange={(e) => setPlatform(e.target.value as "vinted" | "selio")}>
            <option value="vinted">Vinted</option>
            <option value="selio">Selio</option>
          </select>
        </div>
        <div className="flex-1">
          <label className="selio-label">Nom du compte</label>
          <input className="selio-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex: Mon compte principal" />
        </div>
        <button type="submit" className="selio-btn selio-btn-primary">Ajouter</button>
      </form>

      <div className="space-y-3">
        {data?.map((acc) => (
          <div key={acc.id} className="selio-card-premium flex items-center justify-between p-4">
            <div>
              <p className="font-medium">{acc.label}</p>
              <p className="text-xs text-[var(--color-selio-text-muted)]">{acc.platform}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`selio-chip ${acc.status === "connected" ? "text-[var(--color-selio-success)]" : ""}`}>
                {acc.status === "connected" ? "Connecte" : "Non connecte"}
              </span>
              <button className="selio-btn selio-btn-outline" onClick={() => removeAccount(acc.id)} type="button">Retirer</button>
            </div>
          </div>
        ))}
        {data && data.length === 0 && <p className="text-sm text-[var(--color-selio-text-muted)]">Aucun compte ajoute pour l&rsquo;instant.</p>}
      </div>
    </div>
  );
}
