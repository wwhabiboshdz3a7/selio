import { useState } from "react";
import { useNavigate } from "react-router";
import { Download, RotateCcw, Trash2 } from "lucide-react";
import { can } from "@selio/domain";
import { Alert, Button, Card, ConfirmDialog } from "@selio/ui";
import { useClient, useData, useRequiredSession } from "../../../lib/data/provider";
import { downloadFile } from "../../../lib/download";
import { useAppMutation } from "../../components/hooks";

export default function Data() {
  const client = useClient();
  const session = useRequiredSession();
  const { mode } = useData();
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [typed, setTyped] = useState("");
  const exportAll = useAppMutation(() => client.exportAllData(), { success: "Export généré", onSuccess: (blob) => downloadFile(`selio-export-${new Date().toISOString().slice(0, 10)}.json`, blob) });
  const reset = useAppMutation(() => client.resetDemo(), { invalidate: ["session"], success: "Démonstration réinitialisée", onSuccess: () => { setConfirmReset(false); navigate("/app"); } });
  const del = useAppMutation(() => client.deleteOrganization(typed), { onSuccess: () => { setConfirmDelete(false); navigate("/"); } });
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h2 className="text-md font-semibold">Exporter les données</h2>
        <p className="mt-1 text-sm text-text-muted">Export complet au format JSON : organisation, articles, clients, conversations, commandes, règles, journaux. Les secrets ne sont jamais exportés.</p>
        <Button className="mt-3" variant="secondary" icon={<Download />} onClick={() => exportAll.mutate()} loading={exportAll.isPending} disabled={!can(session.role, "data.export")}>Télécharger l'export JSON</Button>
      </Card>
      {mode === "demo" ? (
        <Card>
          <h2 className="text-md font-semibold">Réinitialiser la démonstration</h2>
          <p className="mt-1 text-sm text-text-muted">Remplace les données fictives par le jeu de départ. Vos modifications de démonstration seront perdues.</p>
          <Button className="mt-3" variant="secondary" icon={<RotateCcw />} onClick={() => setConfirmReset(true)}>Réinitialiser</Button>
        </Card>
      ) : null}
      <Card className="border-danger">
        <h2 className="text-md font-semibold text-danger">Supprimer l'organisation</h2>
        <p className="mt-1 text-sm text-text-muted">Suppression définitive de toutes les données de « {session.org.name} ». En mode connecté, les sauvegardes sont purgées selon la procédure documentée (docs/SECURITY.md).</p>
        {!can(session.role, "data.delete") ? <Alert tone="info" className="mt-3">Seul le propriétaire peut supprimer l'organisation.</Alert> : <Button className="mt-3" variant="danger" icon={<Trash2 />} onClick={() => setConfirmDelete(true)}>Supprimer définitivement</Button>}
      </Card>
      <ConfirmDialog open={confirmReset} onClose={() => setConfirmReset(false)} onConfirm={() => reset.mutate()} loading={reset.isPending} title="Réinitialiser la démonstration ?" description="Les données fictives reviennent à leur état initial." confirmLabel="Réinitialiser" />
      <ConfirmDialog open={confirmDelete} onClose={() => { setConfirmDelete(false); setTyped(""); }} onConfirm={() => del.mutate()} loading={del.isPending} danger title="Supprimer l'organisation ?" description="Cette action est irréversible." confirmLabel="Supprimer définitivement" typeToConfirm={session.org.name} typed={typed} onTypedChange={setTyped} />
    </div>
  );
}
