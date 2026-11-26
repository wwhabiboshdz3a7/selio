import { useState } from "react";
import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { Button, Card, Field, Input, Select } from "@selio/ui";
import { can } from "@selio/domain";
import { ORG_NAME_MAX, orgUpdate } from "@selio/contracts";

/** Bornes des durées de conservation (mêmes que le contrat `orgSettings.retentionDays`). */
const RETENTION_BOUNDS = { messages: [30, 3650], auditLogs: [90, 3650], aiRequests: [7, 730] } as const;
import { useClient, useRequiredSession } from "../../../lib/data/provider";
import { useAppMutation } from "../../components/hooks";

/** Réglages généraux de l'organisation. Les règles de vente et d'achat ont leur propre page. */
export default function Organisation() {
  const client = useClient();
  const session = useRequiredSession();
  const [name, setName] = useState(session.org.name);
  const [timezone, setTimezone] = useState(session.org.settings.timezone);
  const [retention, setRetention] = useState(session.org.settings.retentionDays);
  const save = useAppMutation(() => client.updateOrg({ name, settings: { timezone, retentionDays: retention } }), { invalidate: ["session", "overview"], success: "Paramètres enregistrés" });
  const editable = can(session.role, "org.update");
  // Même contrôle que le serveur, affiché sous le champ (nom vide ou trop long, durée hors bornes).
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = () => {
    const errs: Record<string, string> = {};
    const n = orgUpdate.shape.name.safeParse(name);
    if (!n.success) errs.name = n.error.issues[0]?.message ?? "Nom invalide.";
    for (const [key, [min, max]] of Object.entries(RETENTION_BOUNDS)) {
      const v = retention[key as keyof typeof retention];
      if (!Number.isInteger(v) || v < min || v > max) errs[key] = `Entre ${min} et ${max} jours.`;
    }
    setErrors(errs);
    if (Object.keys(errs).length === 0) save.mutate(undefined);
  };
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h2 className="text-md font-semibold">Organisation</h2>
        <p className="mt-1 text-sm text-text-muted">Le nom et le fuseau s'appliquent à toute l'équipe : dates des analyses, plages horaires des automatisations, plafonds par jour.</p>
        <div className="mt-4 grid max-w-xl gap-3 sm:grid-cols-2">
          <Field label="Nom" error={errors.name} hint={`${ORG_NAME_MAX} caractères au plus.`}>{(p) => <Input id={p.id} invalid={p.invalid} aria-describedby={p.describedBy} value={name} onChange={(e) => setName(e.target.value)} disabled={!editable} maxLength={ORG_NAME_MAX} />}</Field>
          <Field label="Fuseau horaire">{(p) => <Select id={p.id} value={timezone} onChange={(e) => setTimezone(e.target.value)} disabled={!editable}>{["Europe/Paris", "Europe/Brussels", "Europe/Zurich", "Europe/Luxembourg", "America/Montreal"].map((tz) => <option key={tz} value={tz}>{tz}</option>)}</Select>}</Field>
          <Field label="Devise">{(p) => <Select id={p.id} value="EUR" disabled><option>EUR</option></Select>}</Field>
          <Field label="Identifiant">{(p) => <Input id={p.id} value={session.org.slug} disabled />}</Field>
        </div>
      </Card>
      <Card>
        <h2 className="text-md font-semibold">Durées de conservation</h2>
        <p className="mt-1 text-sm text-text-muted">En jours. Appliquées par le worker de nettoyage en mode connecté.</p>
        <div className="mt-4 grid max-w-xl gap-3 sm:grid-cols-3">
          <Field label="Messages" error={errors.messages}>{(p) => <Input id={p.id} invalid={p.invalid} type="number" min={30} max={3650} value={retention.messages} onChange={(e) => setRetention({ ...retention, messages: Number(e.target.value) })} disabled={!editable} />}</Field>
          <Field label="Journal d'audit" error={errors.auditLogs}>{(p) => <Input id={p.id} invalid={p.invalid} type="number" min={90} max={3650} value={retention.auditLogs} onChange={(e) => setRetention({ ...retention, auditLogs: Number(e.target.value) })} disabled={!editable} />}</Field>
          <Field label="Requêtes IA" error={errors.aiRequests}>{(p) => <Input id={p.id} invalid={p.invalid} type="number" min={7} max={730} value={retention.aiRequests} onChange={(e) => setRetention({ ...retention, aiRequests: Number(e.target.value) })} disabled={!editable} />}</Field>
        </div>
      </Card>
      {editable ? <div className="flex justify-end"><Button onClick={submit} loading={save.isPending}>Enregistrer</Button></div> : <p className="text-sm text-text-muted">Votre rôle ne permet pas de modifier ces paramètres.</p>}
      <Card>
        <h2 className="text-md font-semibold">Règles de vente et d'achat</h2>
        <p className="mt-1 text-sm text-text-muted">Elles ont leur propre page, là où vous vendez et achetez.</p>
        <ul className="mt-3 flex flex-col">
          <RuleLink to="/app/automatisation/negociation" title="Négociation automatique" section="Automatisation">Marges par tranche de prix, paliers de réduction, lots, messages et délais : la réponse donnée à chaque offre d'acheteur, étape par étape.</RuleLink>
          <RuleLink to="/app/auto-buy" title="Achat automatique" section="Selio Bot">Seuil de note, plafond par jour, prix maximal par article et frais acheteur (protection acheteurs).</RuleLink>
        </ul>
      </Card>
    </div>
  );
}

function RuleLink({ to, title, section, children }: { to: string; title: string; section: string; children: string }) {
  return (
    <li>
      <Link to={to} className="group -mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-surface-muted">
        <span className="min-w-0 flex-1">
          <span className="block text-base font-medium text-text">{title} <span className="text-xs font-normal text-text-muted">· {section}</span></span>
          <span className="block text-sm text-text-muted">{children}</span>
        </span>
        <ArrowRight className="size-4 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </li>
  );
}
