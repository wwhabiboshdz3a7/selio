import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/pro/automation")({ component: Automation });

type Rule = { id: string; type: string; enabled: boolean; config: Record<string, unknown> };
type LogEntry = { id: string; action: string; detail: string; created_at: string };

const RULE_LABELS: Record<string, string> = {
  message_on_favorite: "Message automatique a la mise en favori",
  relance: "Relance si pas de reponse",
  negotiation: "Negociation automatique",
  post_sale_message: "Message apres la vente",
  auto_relist: "Republication automatique",
};

const RULE_DESCRIPTIONS: Record<string, string> = {
  message_on_favorite: "Envoie un message au visiteur des qu'il met une de tes annonces en favori.",
  relance: "Relance l'acheteur si ton dernier message reste sans reponse apres N jours.",
  negotiation: "Accepte ou refuse automatiquement une offre de prix selon la marge que tu autorises.",
  post_sale_message: "Envoie un message de remerciement juste apres une vente, avec le jour d'envoi.",
  auto_relist: "Republie automatiquement une annonce vendue ou archivee comme nouvelle annonce.",
};

async function fetchData(): Promise<{ rules: Rule[]; log: LogEntry[] }> {
  const res = await fetch("/api/pro/automation/rules", { credentials: "include" });
  const data = await res.json();
  return { rules: data.rules ?? [], log: data.log ?? [] };
}

function ConfigFields({ type, config, onChange }: { type: string; config: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  if (type === "message_on_favorite" || type === "relance" || type === "post_sale_message") {
    return (
      <div>
        <label className="selio-label">Modele de message ({"{{listingTitle}}"}{type === "post_sale_message" ? ", {{nextShippingDay}}" : ""})</label>
        <textarea className="selio-input" rows={2} value={(config.template as string) ?? ""} onChange={(e) => onChange({ ...config, template: e.target.value })} />
        {type === "relance" && (
          <div className="mt-2">
            <label className="selio-label">Relancer apres combien de jours ?</label>
            <input type="number" className="selio-input" value={(config.afterDays as number) ?? 2} onChange={(e) => onChange({ ...config, afterDays: Number(e.target.value) })} />
          </div>
        )}
        {type === "post_sale_message" && (
          <div className="mt-2">
            <label className="selio-label">Jours d&rsquo;envoi (0=dimanche .. 6=samedi, separes par virgule)</label>
            <input className="selio-input" defaultValue={((config.shippingDays as number[]) ?? [1, 3, 5]).join(",")} onBlur={(e) => onChange({ ...config, shippingDays: e.target.value.split(",").map((v) => Number(v.trim())).filter((n) => !Number.isNaN(n)) })} />
          </div>
        )}
      </div>
    );
  }
  if (type === "negotiation") {
    return (
      <div>
        <label className="selio-label">Marge maximale acceptee (%)</label>
        <input type="number" className="selio-input" value={(config.maxDiscountPercent as number) ?? 10} onChange={(e) => onChange({ ...config, maxDiscountPercent: Number(e.target.value) })} />
      </div>
    );
  }
  return <p className="text-sm text-[var(--color-selio-text-muted)]">Aucune configuration necessaire.</p>;
}

function Automation() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["pro-rules-full"], queryFn: fetchData });
  const [newType, setNewType] = useState<string>("message_on_favorite");

  async function addRule() {
    await fetch("/api/pro/automation/rules", {
      method: "POST", credentials: "include", headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: newType, enabled: true, config: {} }),
    });
    qc.invalidateQueries({ queryKey: ["pro-rules-full"] });
  }

  async function toggleRule(id: string, enabled: boolean) {
    await fetch(`/api/pro/automation/rules?id=${id}`, {
      method: "PATCH", credentials: "include", headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    qc.invalidateQueries({ queryKey: ["pro-rules-full"] });
  }

  async function saveConfig(id: string, config: Record<string, unknown>) {
    await fetch(`/api/pro/automation/rules?id=${id}`, {
      method: "PATCH", credentials: "include", headers: { "content-type": "application/json" },
      body: JSON.stringify({ config }),
    });
    qc.invalidateQueries({ queryKey: ["pro-rules-full"] });
  }

  async function removeRule(id: string) {
    await fetch(`/api/pro/automation/rules?id=${id}`, { method: "DELETE", credentials: "include" });
    qc.invalidateQueries({ queryKey: ["pro-rules-full"] });
  }

  const existingTypes = new Set((data?.rules ?? []).map((r) => r.type));
  const availableTypes = Object.keys(RULE_LABELS).filter((t) => !existingTypes.has(t));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--color-selio-primary-dark)]">Automatisations</h1>
        <p className="mt-1 text-sm text-[var(--color-selio-text-muted)]">
          Ces regles s&rsquo;executent automatiquement toutes les 15 minutes sur ton activite Selio (favoris, messages,
          ventes). Elles n&rsquo;agissent pas sur un vrai compte Vinted : aucune API publique vendeur n&rsquo;existe pour ca.
        </p>
      </div>

      {availableTypes.length > 0 && (
        <div className="selio-card-premium flex flex-wrap items-end gap-3 p-4">
          <div className="flex-1">
            <label className="selio-label">Nouvelle regle</label>
            <select className="selio-input" value={newType} onChange={(e) => setNewType(e.target.value)}>
              {availableTypes.map((t) => <option key={t} value={t}>{RULE_LABELS[t]}</option>)}
            </select>
          </div>
          <button className="selio-btn selio-btn-primary" onClick={addRule} type="button">Activer</button>
        </div>
      )}

      <div className="space-y-4">
        {data?.rules.map((rule) => (
          <div key={rule.id} className="selio-card-premium p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{RULE_LABELS[rule.type] ?? rule.type}</p>
                <p className="text-xs text-[var(--color-selio-text-muted)]">{RULE_DESCRIPTIONS[rule.type]}</p>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-sm">
                  <input type="checkbox" checked={rule.enabled} onChange={(e) => toggleRule(rule.id, e.target.checked)} />
                  Actif
                </label>
                <button className="selio-btn selio-btn-outline !py-1 text-sm" onClick={() => removeRule(rule.id)} type="button">Supprimer</button>
              </div>
            </div>
            <div className="mt-3">
              <ConfigFields type={rule.type} config={rule.config ?? {}} onChange={(c) => saveConfig(rule.id, c)} />
            </div>
          </div>
        ))}
        {data && data.rules.length === 0 && <p className="text-sm text-[var(--color-selio-text-muted)]">Aucune automatisation active.</p>}
      </div>

      <div className="selio-card-premium p-4">
        <h2 className="font-semibold text-[var(--color-selio-primary-dark)]">Journal d&rsquo;activite</h2>
        <div className="mt-2 max-h-80 space-y-2 overflow-y-auto">
          {data?.log.map((entry) => (
            <div key={entry.id} className="border-b border-[var(--color-selio-border)] pb-2 text-sm last:border-0">
              <span className="selio-chip">{RULE_LABELS[entry.action] ?? entry.action}</span>
              <span className="ml-2 text-[var(--color-selio-text-muted)]">{new Date(entry.created_at).toLocaleString("fr-FR")}</span>
              <p className="mt-1 text-xs text-[var(--color-selio-text-muted)]">{entry.detail}</p>
            </div>
          ))}
          {data && data.log.length === 0 && <p className="text-sm text-[var(--color-selio-text-muted)]">Aucune action enregistree pour l&rsquo;instant.</p>}
        </div>
      </div>
    </div>
  );
}
