import { useState } from "react";
import { Button, Card, Field, Input, Select } from "@selio/ui";
import { useClient, useRequiredSession } from "../../../lib/data/provider";
import { MoneyInput } from "../../components/common";
import { useAppMutation } from "../../components/hooks";
import { can } from "@selio/domain";

export default function Organisation() {
  const client = useClient();
  const session = useRequiredSession();
  const [name, setName] = useState(session.org.name);
  const [timezone, setTimezone] = useState(session.org.settings.timezone);
  const [margin, setMargin] = useState(session.org.settings.margin);
  const [retention, setRetention] = useState(session.org.settings.retentionDays);
  const save = useAppMutation(() => client.updateOrg({ name, settings: { timezone, margin, retentionDays: retention } }), { invalidate: ["session", "overview", "items"], success: "Paramètres enregistrés" });
  const editable = can(session.role, "org.update");
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h2 className="text-md font-semibold">Organisation</h2>
        <div className="mt-4 grid max-w-xl gap-3 sm:grid-cols-2">
          <Field label="Nom">{(p) => <Input id={p.id} value={name} onChange={(e) => setName(e.target.value)} disabled={!editable} />}</Field>
          <Field label="Fuseau horaire">{(p) => <Select id={p.id} value={timezone} onChange={(e) => setTimezone(e.target.value)} disabled={!editable}>{["Europe/Paris", "Europe/Brussels", "Europe/Zurich", "Europe/Luxembourg", "America/Montreal"].map((tz) => <option key={tz} value={tz}>{tz}</option>)}</Select>}</Field>
          <Field label="Devise">{(p) => <Select id={p.id} value="EUR" disabled><option>EUR</option></Select>}</Field>
          <Field label="Identifiant">{(p) => <Input id={p.id} value={session.org.slug} disabled />}</Field>
        </div>
      </Card>
      <Card>
        <h2 className="text-md font-semibold">Règles de marge et de négociation</h2>
        <p className="mt-1 text-sm text-text-muted">Ces règles pilotent le prix plancher suggéré, l'évaluation des offres et les suggestions de réponse. Elles sont déterministes : l'IA ne les modifie jamais.</p>
        <div className="mt-4 grid max-w-xl gap-3 sm:grid-cols-2">
          <Field label="Marge minimale (%)">{(p) => <Input id={p.id} type="number" min={0} max={90} value={Math.round(margin.minMarginRate * 100)} onChange={(e) => setMargin({ ...margin, minMarginRate: Number(e.target.value) / 100 })} disabled={!editable} />}</Field>
          <Field label="Marge minimale absolue">{(p) => <MoneyInput id={p.id} value={margin.minMarginCents} onChange={(v) => setMargin({ ...margin, minMarginCents: v ?? 0 })} allowEmpty={false} disabled={!editable} />}</Field>
          <Field label="Remise maximale (%)">{(p) => <Input id={p.id} type="number" min={0} max={90} value={Math.round(margin.maxDiscountRate * 100)} onChange={(e) => setMargin({ ...margin, maxDiscountRate: Number(e.target.value) / 100 })} disabled={!editable} />}</Field>
          <Field label="Pas de contre-proposition (%)">{(p) => <Input id={p.id} type="number" min={1} max={50} value={Math.round(margin.counterStepRate * 100)} onChange={(e) => setMargin({ ...margin, counterStepRate: Number(e.target.value) / 100 })} disabled={!editable} />}</Field>
          <Field label="Contre-propositions max par acheteur">{(p) => <Input id={p.id} type="number" min={0} max={10} value={margin.maxRoundsPerCustomer} onChange={(e) => setMargin({ ...margin, maxRoundsPerCustomer: Number(e.target.value) })} disabled={!editable} />}</Field>
          <Field label="Frais plateforme vendeur par défaut (%)" hint="0 sur Vinted : la protection acheteur est payée par l'acheteur.">{(p) => <Input id={p.id} aria-describedby={p.describedBy} type="number" min={0} max={50} value={Math.round(margin.defaultPlatformFeeRate * 100)} onChange={(e) => setMargin({ ...margin, defaultPlatformFeeRate: Number(e.target.value) / 100 })} disabled={!editable} />}</Field>
          <Field label="Port à charge vendeur par défaut">{(p) => <MoneyInput id={p.id} value={margin.defaultShippingCostCents} onChange={(v) => setMargin({ ...margin, defaultShippingCostCents: v ?? 0 })} allowEmpty={false} disabled={!editable} />}</Field>
        </div>
      </Card>
      <Card>
        <h2 className="text-md font-semibold">Durées de conservation</h2>
        <p className="mt-1 text-sm text-text-muted">En jours. Appliquées par le worker de nettoyage en mode connecté.</p>
        <div className="mt-4 grid max-w-xl gap-3 sm:grid-cols-3">
          <Field label="Messages">{(p) => <Input id={p.id} type="number" min={30} max={3650} value={retention.messages} onChange={(e) => setRetention({ ...retention, messages: Number(e.target.value) })} disabled={!editable} />}</Field>
          <Field label="Journal d'audit">{(p) => <Input id={p.id} type="number" min={90} max={3650} value={retention.auditLogs} onChange={(e) => setRetention({ ...retention, auditLogs: Number(e.target.value) })} disabled={!editable} />}</Field>
          <Field label="Requêtes IA">{(p) => <Input id={p.id} type="number" min={7} max={730} value={retention.aiRequests} onChange={(e) => setRetention({ ...retention, aiRequests: Number(e.target.value) })} disabled={!editable} />}</Field>
        </div>
      </Card>
      {editable ? <div className="flex justify-end"><Button onClick={() => save.mutate()} loading={save.isPending}>Enregistrer</Button></div> : <p className="text-sm text-text-muted">Votre rôle ne permet pas de modifier ces paramètres.</p>}
    </div>
  );
}
