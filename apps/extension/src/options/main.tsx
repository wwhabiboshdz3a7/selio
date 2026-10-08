import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Alert, Button, Field, Input, StatusBadge, Wordmark, formatDateTime } from "@selio/ui";
import type { ExtensionStatus } from "../shared/messages";
import { getStatus, sendToBackground } from "../shared/runtime";
import "../styles.css";

const DEFAULT_API = (import.meta.env.VITE_DEFAULT_API_BASE_URL as string | undefined) ?? "http://127.0.0.1:8787";

function Options() {
  const [status, setStatus] = useState<ExtensionStatus | null>(null);
  const [apiBaseUrl, setApi] = useState(DEFAULT_API);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger" | "info"; text: string } | null>(null);
  const [diags, setDiags] = useState<{ url: string; pageKind: string; adapterVersion: string; ok: boolean; missing: string[]; warnings: string[]; at: string }[]>([]);
  const refresh = async () => {
    const s = await getStatus();
    setStatus(s);
    if (s.apiBaseUrl) setApi(s.apiBaseUrl);
    const d = await sendToBackground({ type: "getDiagnostics" });
    if (d.ok) setDiags(d.data as typeof diags);
  };
  useEffect(() => { void refresh(); }, []);
  const pair = async () => {
    setBusy(true);
    setMsg(null);
    const res = await sendToBackground({ type: "pair", apiBaseUrl: apiBaseUrl.trim(), token: token.trim() });
    setBusy(false);
    if (res.ok) { setMsg({ tone: "success", text: "Extension associée. Le jeton est conservé uniquement dans le stockage de l'extension." }); setToken(""); }
    else setMsg({ tone: "danger", text: res.message });
    await refresh();
  };
  const unpair = async () => {
    await sendToBackground({ type: "unpair" });
    setMsg({ tone: "info", text: "Extension dissociée. Pensez à révoquer le jeton dans Selio › Paramètres › Connexions." });
    await refresh();
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><Wordmark size={24} /><span className="text-xs text-text-muted">Options de l'extension</span></div>
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-md font-semibold">Association au compte Selio</h1>
          {status?.paired ? <StatusBadge tone={status.lastError ? "danger" : "success"}>{status.lastError ? "Jeton refusé" : "Associée"}</StatusBadge> : <StatusBadge tone="muted">Non associée</StatusBadge>}
        </div>
        {status?.paired ? (
          <div className="mt-3 text-sm">
            <p>Organisation : <span className="font-medium">{status.orgName ?? "—"}</span></p>
            <p className="text-text-muted">API : {status.apiBaseUrl}</p>
            <p className="text-text-muted">Portées : {status.scopes.join(", ") || "—"}</p>
            {status.lastError ? <Alert tone="danger" className="mt-2">{status.lastError}</Alert> : null}
            <div className="mt-3"><Button variant="danger" onClick={() => void unpair()}>Dissocier</Button></div>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            <Field label="URL de l'API Selio" hint="L'extension demandera l'autorisation d'accéder à cette origine.">{(p) => <Input id={p.id} aria-describedby={p.describedBy} value={apiBaseUrl} onChange={(e) => setApi(e.target.value)} />}</Field>
            <Field label="Jeton d'extension" hint="Créé dans Selio › Paramètres › Connexions › Jetons d'extension. Affiché une seule fois.">{(p) => <Input id={p.id} aria-describedby={p.describedBy} value={token} onChange={(e) => setToken(e.target.value)} type="password" autoComplete="off" />}</Field>
            <div><Button onClick={() => void pair()} loading={busy} disabled={!token.trim() || !apiBaseUrl.trim()}>Associer</Button></div>
          </div>
        )}
        {msg ? <Alert tone={msg.tone} className="mt-3">{msg.text}</Alert> : null}
      </div>
      <div className="card p-4 text-sm">
        <h2 className="text-md font-semibold">Ce que fait l'extension</h2>
        <ul className="mt-2 list-disc pl-5 text-text-muted">
          <li>Lit la page article ou conversation que vous avez ouverte sur vinted.fr (adaptateurs versionnés, échec propre si la page change).</li>
          <li>Propose de capturer un article vers votre stock et de préparer une réponse. Vous confirmez chaque action.</li>
          <li>N'envoie jamais de message à votre place : le texte est inséré dans le champ, vous cliquez sur Envoyer.</li>
          <li>Ne stocke ni mot de passe ni cookie Vinted ; le jeton Selio reste dans le stockage de l'extension et peut être révoqué depuis l'application.</li>
          <li>Permissions : stockage, onglet actif, vinted.fr/.be/.com, et l'origine de l'API que vous autorisez explicitement.</li>
        </ul>
        <p className="mt-2 text-xs text-text-muted">Les adaptateurs sont construits sur des fixtures et restent expérimentaux tant qu'ils n'ont pas été validés sur le site réel. Outil indépendant, non affilié à Vinted.</p>
      </div>
      <div className="card p-4 text-sm">
        <h2 className="text-md font-semibold">Diagnostics de compatibilité</h2>
        {diags.length === 0 ? <p className="mt-2 text-text-muted">Aucun diagnostic. Ouvrez une page prise en charge puis lancez « Diagnostic » depuis le popup.</p> : (
          <ul className="mt-2 divide-y divide-border">
            {diags.map((d, i) => (
              <li key={i} className="py-2">
                <p className="flex items-center gap-2"><StatusBadge tone={d.ok ? "success" : "danger"}>{d.ok ? "Reconnue" : "Non reconnue"}</StatusBadge><span>{d.pageKind} · {d.adapterVersion}</span><span className="text-xs text-text-muted">{formatDateTime(d.at)}</span></p>
                <p className="truncate text-xs text-text-muted">{d.url}</p>
                {d.missing.length ? <p className="text-xs text-danger">Manquant : {d.missing.join(", ")}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Options /></StrictMode>);
