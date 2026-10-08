import { useState } from "react";
import { can } from "@selio/domain";
import { Alert, Button, Card, Toggle } from "@selio/ui";
import { useClient, useRequiredSession } from "../../../lib/data/provider";
import { useAppMutation } from "../../components/hooks";

export default function Notifications() {
  const client = useClient();
  const session = useRequiredSession();
  const [n, setN] = useState(session.org.settings.notifications);
  const save = useAppMutation(() => client.updateOrg({ settings: { notifications: n } }), { invalidate: ["session"], success: "Notifications enregistrées" });
  const editable = can(session.role, "org.update");
  return (
    <Card>
      <h2 className="text-md font-semibold">Notifications</h2>
      <Alert tone="info" className="mt-3">Les notifications s'affichent dans l'application (alertes de la vue d'ensemble). L'envoi d'email n'est pas encore configuré : aucun service tiers n'est branché.</Alert>
      <div className="mt-4 flex max-w-xl flex-col gap-4">
        <Toggle label="Nouveau message acheteur" checked={n.newMessage} onChange={(v) => setN({ ...n, newMessage: v })} disabled={!editable} />
        <Toggle label="Échec d'une automatisation" checked={n.automationFailure} onChange={(v) => setN({ ...n, automationFailure: v })} disabled={!editable} />
        <Toggle label="Connexion expirée ou dégradée" checked={n.connectionExpired} onChange={(v) => setN({ ...n, connectionExpired: v })} disabled={!editable} />
        <Toggle label="Résumé par email" description="Disponible lorsque le service d'email sera configuré." checked={n.emailDigest} onChange={(v) => setN({ ...n, emailDigest: v })} disabled />
        {editable ? <div><Button onClick={() => save.mutate()} loading={save.isPending}>Enregistrer</Button></div> : null}
      </div>
    </Card>
  );
}
