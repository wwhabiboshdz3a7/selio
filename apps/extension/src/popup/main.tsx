import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ExternalLink, RefreshCw, Settings } from "lucide-react";
import { Button, StatusBadge, Wordmark, formatRelative } from "@selio/ui";
import { isSupportedUrl, type ExtensionStatus } from "../shared/messages";
import { activeTab, getStatus, sendToContent } from "../shared/runtime";
import "../styles.css";

function Popup() {
  const [status, setStatus] = useState<ExtensionStatus | null>(null);
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  const [diag, setDiag] = useState<{ pageKind: string; ok: boolean; missing: string[]; warnings: string[]; adapterVersion: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void getStatus().then(setStatus); void activeTab().then(setTab); }, []);
  const supported = isSupportedUrl(tab?.url);
  const runDiag = async () => {
    if (!tab?.id) return;
    setBusy(true);
    const res = await sendToContent(tab.id, { type: "runDiagnostic" });
    setDiag(res?.ok ? (res.data as typeof diag) : { pageKind: "unknown", ok: false, missing: ["content script injoignable : rechargez la page"], warnings: [], adapterVersion: "?" });
    setBusy(false);
  };
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <Wordmark size={22} />
        <Button size="sm" variant="ghost" icon={<Settings />} onClick={() => chrome.runtime.openOptionsPage()}>Options</Button>
      </div>
      <div className="card p-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-text-muted">Compte</span>
          {status === null ? <StatusBadge tone="muted">…</StatusBadge> : status.paired ? <StatusBadge tone={status.lastError ? "danger" : "success"}>{status.lastError ? "Jeton refusé" : "Associé"}</StatusBadge> : <StatusBadge tone="muted">Non associé</StatusBadge>}
        </div>
        {status?.orgName ? <p className="mt-1 font-medium">{status.orgName}</p> : null}
        {status?.lastPingAt ? <p className="text-xs text-text-muted">Dernier contact {formatRelative(status.lastPingAt)}</p> : null}
        {status?.lastError ? <p className="mt-1 text-xs text-danger">{status.lastError}</p> : null}
      </div>
      <div className="card p-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-text-muted">Page courante</span>
          <StatusBadge tone={supported ? "success" : "muted"}>{supported ? "Prise en charge" : "Non prise en charge"}</StatusBadge>
        </div>
        <p className="mt-1 truncate text-xs text-text-muted">{tab?.url ?? "—"}</p>
        {supported ? (
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="secondary" icon={<RefreshCw />} onClick={() => void runDiag()} loading={busy}>Diagnostic</Button>
            <Button size="sm" variant="secondary" onClick={() => tab?.id && void sendToContent(tab.id, { type: "togglePanel" })}>Panneau</Button>
          </div>
        ) : <p className="mt-2 text-xs text-text-muted">Ouvrez une page article ou une conversation sur vinted.fr.</p>}
        {diag ? (
          <div className="mt-2 rounded-md bg-surface-muted p-2 text-xs">
            <p>Page : {diag.pageKind} · adaptateur {diag.adapterVersion} · {diag.ok ? "structure reconnue" : "structure NON reconnue"}</p>
            {diag.missing.length ? <p className="text-danger">Manquant : {diag.missing.join(", ")}</p> : null}
            {diag.warnings.length ? <p className="text-text-muted">{diag.warnings.join(" · ")}</p> : null}
          </div>
        ) : null}
      </div>
      <p className="text-[11px] text-text-muted">Aucune action n'est déclenchée sans votre confirmation. L'extension ne stocke ni mot de passe ni cookie Vinted. Outil indépendant, non affilié à Vinted.</p>
      {status?.apiBaseUrl ? <a className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text" href={status.apiBaseUrl.replace(/\/api.*$/, "")} target="_blank" rel="noreferrer"><ExternalLink className="size-3" /> Ouvrir Selio</a> : null}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Popup /></StrictMode>);
