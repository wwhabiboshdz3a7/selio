import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import {
  OPERATOR_ROLE_LABELS, ORG_QUALIFICATIONS, ORG_QUALIFICATION_LABELS, PAID_PLANS, PLAN_LABELS, QUALIFICATION_NOTE_MAX, ROLE_LABELS, TRIAL_EXTENSION_MAX_DAYS,
  isGrantWithoutEnd, type AdminAccountDetail, type AdminAccountEvent, type OrgQualification, type PaidPlan, type UsageCounter,
} from "@selio/contracts";
import { Alert, Button, Card, Checkbox, ConfirmDialog, DescriptionList, Field, Input, PageHeader, Select, StatusBadge, Textarea, formatDate, formatDateTime, formatNumber } from "@selio/ui";
import { useClient, useData } from "../../../lib/data/provider";
import { QUALIFICATION_TONES, adminActionLabel, grantEndLabel } from "../../../lib/admin";
import { QueryBoundary } from "../../components/common";
import { useAppMutation } from "../../components/hooks";
import { AccountStatus } from "./Accounts";

const DAY = 86_400_000;
const INVALIDATE = ["admin-account", "admin-accounts", "admin-growth", "subscription", "admin-usage"];

/** Date (AAAA-MM-JJ, fuseau du navigateur) → fin de journée en ISO. */
function endOfDayIso(day: string): string {
  return new Date(`${day}T23:59:59`).toISOString();
}
function dayInput(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** Résumé « avant → après » d'une entrée d'historique (qualification, note, plan, fin). */
function eventSummary(e: AdminAccountEvent): string | null {
  const m = e.meta as { before?: Record<string, unknown> | null; after?: Record<string, unknown> | null; days?: number };
  if (e.action === "admin.trial_extended" && typeof m.days === "number") return `+${m.days} jour${m.days > 1 ? "s" : ""}${m.after?.currentPeriodEnd ? ` → fin le ${formatDate(String(m.after.currentPeriodEnd))}` : ""}`;
  if (e.action === "admin.account_qualified") {
    const label = (v: unknown) => ORG_QUALIFICATION_LABELS[v as OrgQualification] ?? String(v ?? "—");
    return `${label(m.before?.qualification)} → ${label(m.after?.qualification)}`;
  }
  if (e.action === "admin.account_note_updated") return m.after?.note ? `« ${String(m.after.note).slice(0, 120)} »` : "Note effacée";
  if (e.action === "admin.access_granted" && m.after) return `${PLAN_LABELS[m.after.plan as PaidPlan] ?? m.after.plan} ${grantEndLabel(String(m.after.grantedUntil ?? ""), (d) => `jusqu'au ${formatDate(d)}`)}`;
  return null;
}

function UsageLine({ label, c }: { label: string; c: UsageCounter }) {
  if (c.quota === 0 && c.used === 0) return null;
  return (
    <li className="flex items-center justify-between gap-2 py-1.5 text-sm">
      <span>{label}</span>
      <span className={c.exceeded ? "num text-danger" : c.warning ? "num text-warning" : "num text-text-muted"}>{formatNumber(c.used)} / {c.quota > 0 ? formatNumber(c.quota) : "—"}</span>
    </li>
  );
}

function QualificationCard({ a }: { a: AdminAccountDetail }) {
  const client = useClient();
  const [qualification, setQualification] = useState<OrgQualification>(a.qualification);
  const [note, setNote] = useState(a.qualificationNote ?? "");
  const [confirmBlock, setConfirmBlock] = useState(false);
  useEffect(() => {
    setQualification(a.qualification);
    setNote(a.qualificationNote ?? "");
  }, [a.qualification, a.qualificationNote]);
  const save = useAppMutation(() => client.adminQualifyAccount(a.id, { qualification, note }), { invalidate: INVALIDATE, success: "Qualification enregistrée (action journalisée)", onSuccess: () => setConfirmBlock(false) });
  const dirty = qualification !== a.qualification || note !== (a.qualificationNote ?? "");
  const submit = () => (qualification === "bloque" && a.qualification !== "bloque" ? setConfirmBlock(true) : save.mutate(undefined));
  return (
    <Card>
      <h2 className="text-md font-semibold">Qualification et note interne</h2>
      <p className="mt-1 text-sm text-text-muted">Jamais montrées au client. « Bloqué » refuse la session de ses membres (sauf opérateurs Selio).</p>
      <form className="mt-3 flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="Qualification">{(p) => (
          <Select id={p.id} value={qualification} onChange={(e) => setQualification(e.target.value as OrgQualification)}>
            {ORG_QUALIFICATIONS.map((x) => <option key={x} value={x}>{ORG_QUALIFICATION_LABELS[x]}</option>)}
          </Select>
        )}</Field>
        <Field label="Note interne" hint={`${note.length} / ${QUALIFICATION_NOTE_MAX} caractères`}>{(p) => (
          <Textarea id={p.id} aria-describedby={p.describedBy} value={note} maxLength={QUALIFICATION_NOTE_MAX} rows={3} onChange={(e) => setNote(e.target.value)} />
        )}</Field>
        {a.qualifiedAt ? <p className="text-xs text-text-muted">Dernière modification le {formatDateTime(a.qualifiedAt)}{a.qualifiedByEmail ? ` par ${a.qualifiedByEmail}` : ""}.</p> : null}
        <div><Button type="submit" disabled={!dirty} loading={save.isPending}>Enregistrer</Button></div>
      </form>
      <ConfirmDialog
        open={confirmBlock}
        onClose={() => setConfirmBlock(false)}
        onConfirm={() => save.mutate(undefined)}
        loading={save.isPending}
        danger
        title={`Bloquer « ${a.name} » ?`}
        description="Ses membres ne pourront plus ouvrir de session : un message leur dit que le compte est suspendu par l'équipe Selio. Vous pourrez le débloquer à tout moment."
        confirmLabel="Bloquer le compte"
      />
    </Card>
  );
}

function GrantCard({ a }: { a: AdminAccountDetail }) {
  const client = useClient();
  const [plan, setPlan] = useState<PaidPlan>(a.qualification === "equipe" ? "agence" : "pro");
  const [day, setDay] = useState(dayInput(new Date(Date.now() + 30 * DAY)));
  const [withoutEnd, setWithoutEnd] = useState(a.qualification === "equipe");
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const team = a.qualification === "equipe";
  const grant = useAppMutation(() => client.adminGrantAccess(a.id, { plan, until: team && withoutEnd ? null : endOfDayIso(day) }), { invalidate: INVALIDATE, success: "Accès offert (aucun débit, action journalisée)" });
  const revoke = useAppMutation(() => client.adminRevokeAccess(a.id), { invalidate: INVALIDATE, success: "Accès offert retiré", onSuccess: () => setConfirmRevoke(false) });
  const paidByCard = !a.grantedUntil && a.provider === "revolut" && (a.status === "active" || a.status === "past_due");
  return (
    <Card>
      <h2 className="text-md font-semibold">Accès offert</h2>
      <p className="mt-1 text-sm text-text-muted">Un plan payant actif sans aucun débit, jusqu'à la date choisie (sans fin pour l'équipe Selio). À l'échéance, le compte repasse à l'accès de base.</p>
      {a.grantedUntil ? (
        <div className="mt-3 flex flex-col gap-2">
          <Alert tone="success">{PLAN_LABELS[a.plan]} offert {isGrantWithoutEnd(a.grantedUntil) ? "sans date de fin" : `jusqu'au ${formatDate(a.grantedUntil)}`}{a.grantedByEmail ? ` par ${a.grantedByEmail}` : ""}.</Alert>
          <div><Button variant="secondary" onClick={() => setConfirmRevoke(true)}>Retirer l'accès offert</Button></div>
        </div>
      ) : null}
      {paidByCard ? <Alert tone="info" className="mt-3">Ce compte paie son abonnement par carte : un accès offert ne peut pas le remplacer.</Alert> : (
        <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); grant.mutate(undefined); }}>
          <Field label="Plan offert">{(p) => (
            <Select id={p.id} value={plan} onChange={(e) => setPlan(e.target.value as PaidPlan)}>
              {PAID_PLANS.map((x) => <option key={x} value={x}>{PLAN_LABELS[x]}</option>)}
            </Select>
          )}</Field>
          <Field label="Jusqu'au" hint={team ? undefined : "Sans fin : réservé aux comptes « Équipe Selio »."}>{(p) => (
            <Input id={p.id} aria-describedby={p.describedBy} type="date" value={day} min={dayInput(new Date(Date.now() + DAY))} disabled={team && withoutEnd} onChange={(e) => setDay(e.target.value)} required />
          )}</Field>
          {team ? <Checkbox className="sm:col-span-2" label="Sans date de fin (équipe Selio)" checked={withoutEnd} onChange={(e) => setWithoutEnd(e.target.checked)} /> : null}
          <div className="sm:col-span-2"><Button type="submit" loading={grant.isPending}>{a.grantedUntil ? "Modifier l'accès offert" : "Offrir l'accès"}</Button></div>
        </form>
      )}
      <ConfirmDialog open={confirmRevoke} onClose={() => setConfirmRevoke(false)} onConfirm={() => revoke.mutate(undefined)} loading={revoke.isPending} danger title="Retirer l'accès offert ?" description="Le compte repasse tout de suite à l'accès de base (ses données sont conservées)." confirmLabel="Retirer" />
    </Card>
  );
}

function TrialCard({ a }: { a: AdminAccountDetail }) {
  const client = useClient();
  const [days, setDays] = useState(14);
  const extend = useAppMutation(() => client.adminExtendTrial(a.id, days), { invalidate: INVALIDATE, success: (d) => `Essai prolongé jusqu'au ${d.currentPeriodEnd ? formatDate(d.currentPeriodEnd) : "—"}` });
  const blocked = Boolean(a.grantedUntil) || (a.provider === "revolut" && (a.status === "active" || a.status === "past_due"));
  return (
    <Card>
      <h2 className="text-md font-semibold">Prolonger l'essai</h2>
      <p className="mt-1 text-sm text-text-muted">{a.status === "trialing" ? `Essai en cours jusqu'au ${a.currentPeriodEnd ? formatDate(a.currentPeriodEnd) : "—"} : la prolongation part de cette date.` : "Essai terminé : un nouvel essai Pro part d'aujourd'hui."}</p>
      {blocked ? <p className="mt-3 text-sm text-text-muted">Rien à prolonger : ce compte a un accès offert ou paie son abonnement.</p> : (
        <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); extend.mutate(undefined); }}>
          <Field label="Nombre de jours" hint={`De 1 à ${TRIAL_EXTENSION_MAX_DAYS} jours`}>{(p) => (
            <Input id={p.id} aria-describedby={p.describedBy} type="number" inputMode="numeric" min={1} max={TRIAL_EXTENSION_MAX_DAYS} value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-28" required />
          )}</Field>
          <Button type="submit" loading={extend.isPending} disabled={!Number.isInteger(days) || days < 1 || days > TRIAL_EXTENSION_MAX_DAYS}>Prolonger</Button>
        </form>
      )}
    </Card>
  );
}

/** Compte d'un opérateur Selio : qualification « Équipe Selio » et Agence offert sans fin, en un clic. */
function TeamShortcut({ a }: { a: AdminAccountDetail }) {
  const client = useClient();
  const operator = a.team.find((m) => m.operatorRole);
  const apply = useAppMutation(async () => {
    if (a.qualification !== "equipe") await client.adminQualifyAccount(a.id, { qualification: "equipe" });
    return client.adminGrantAccess(a.id, { plan: "agence", until: null });
  }, { invalidate: INVALIDATE, success: "Compte qualifié « Équipe Selio » : Agence offert sans fin" });
  if (!operator || (a.qualification === "equipe" && a.grantedUntil && isGrantWithoutEnd(a.grantedUntil))) return null;
  return (
    <Alert tone="info" title="Compte d'un opérateur Selio">
      <span className="block">{operator.email} est opérateur ({OPERATOR_ROLE_LABELS[operator.operatorRole!]}). Qualifiez ce compte « Équipe Selio » avec Agence offert sans fin : plus d'essai ni de bandeau de facturation.</span>
      <Button size="sm" className="mt-2" loading={apply.isPending} onClick={() => apply.mutate(undefined)}>Qualifier « Équipe Selio »</Button>
    </Alert>
  );
}

/**
 * Selio Admin › Comptes › fiche : membres, abonnement, utilisation du mois, qualification et note interne,
 * accès offert, prolongation d'essai et historique d'audit du compte.
 */
export default function AdminAccountDetail() {
  const { id = "" } = useParams();
  const client = useClient();
  const { mode } = useData();
  const q = useQuery({ queryKey: ["admin-account", id], queryFn: () => client.adminGetAccount(id) });
  const usage = useQuery({ queryKey: ["admin-usage"], queryFn: () => client.getAdminUsage(), staleTime: 60_000 });
  const u = usage.data?.orgs.find((o) => o.id === id) ?? null;
  return (
    <>
      <Link to="/admin/comptes" className="mb-3 inline-flex items-center gap-1 text-sm text-text-muted hover:text-text"><ArrowLeft className="size-4" aria-hidden /> Comptes</Link>
      <QueryBoundary query={q}>
        {(a) => (
          <>
            <PageHeader eyebrow="Selio Admin · Compte" title={a.name} description={<span className="inline-flex flex-wrap items-center gap-2"><StatusBadge tone={QUALIFICATION_TONES[a.qualification]}>{ORG_QUALIFICATION_LABELS[a.qualification]}</StatusBadge><AccountStatus a={a} /><span className="text-text-muted">Inscrit le {formatDate(a.createdAt)}</span></span>} />
            <div className="flex flex-col gap-4">
              <TeamShortcut a={a} />
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <h2 className="mb-3 text-md font-semibold">Abonnement</h2>
                  <DescriptionList items={[
                    { label: "Plan", value: PLAN_LABELS[a.plan] },
                    { label: "Statut", value: <AccountStatus a={a} /> },
                    { label: a.status === "trialing" ? "Fin de l'essai" : "Fin de la période", value: a.grantedUntil ? grantEndLabel(a.grantedUntil, formatDate) : a.currentPeriodEnd ? formatDate(a.currentPeriodEnd) : "—" },
                    { label: "Paiement", value: a.grantedUntil ? "Aucun (accès offert)" : a.provider === "revolut" ? `Carte enregistrée · ${a.cycle === "yearly" ? "annuel" : "mensuel"}` : a.cardOnFile ? "Carte enregistrée" : "Aucune carte" },
                    ...(a.cancelAtPeriodEnd ? [{ label: "Résiliation", value: "Demandée (fin de période)" }] : []),
                  ]} />
                </Card>
                <Card>
                  <h2 className="mb-3 text-md font-semibold">Membres</h2>
                  <ul className="divide-y divide-border" aria-label="Membres du compte">
                    {a.team.map((m) => (
                      <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                        <span className="min-w-0"><span className="block truncate font-medium">{m.email}</span><span className="block text-xs text-text-muted">{m.displayName}</span></span>
                        <span className="flex items-center gap-1.5">
                          {m.operatorRole ? <StatusBadge tone="ink"><ShieldCheck className="size-3" aria-hidden /> {OPERATOR_ROLE_LABELS[m.operatorRole]}</StatusBadge> : null}
                          <StatusBadge tone="neutral" dot={false}>{ROLE_LABELS[m.role]}</StatusBadge>
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <QualificationCard a={a} />
                <div className="flex flex-col gap-4">
                  <GrantCard a={a} />
                  <TrialCard a={a} />
                </div>
              </div>
              <Card>
                <h2 className="mb-2 text-md font-semibold">Utilisation du mois</h2>
                {u ? (
                  <ul className="divide-y divide-border">
                    <UsageLine label="Réponses IA" c={u.counters.aiRequests} />
                    <UsageLine label="Articles" c={u.counters.items} />
                    <UsageLine label="Annonces Studio" c={u.studio.listings} />
                    <UsageLine label="Photos portées" c={u.studio.wornPhotos} />
                    <UsageLine label="Scans Track" c={u.track.scans} />
                    <UsageLine label="Recherches photo Track" c={u.track.photoSearches} />
                    <UsageLine label="Actions Cloud (jour)" c={u.cloud.actions} />
                  </ul>
                ) : <p className="text-sm text-text-muted">{usage.isPending ? "Chargement…" : "Aucune utilisation relevée ce mois-ci."}</p>}
              </Card>
              <Card>
                <h2 className="mb-2 text-md font-semibold">Historique</h2>
                {a.history.length === 0 ? <p className="text-sm text-text-muted">Aucune action enregistrée.</p> : (
                  <ol className="divide-y divide-border" aria-label="Historique du compte">
                    {a.history.map((e) => {
                      const summary = eventSummary(e);
                      return (
                        <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2 text-sm">
                          <span className="min-w-0">
                            <span className="font-medium" title={e.action}>{adminActionLabel(e.action)}</span>
                            {summary ? <span className="text-text-muted"> — {summary}</span> : null}
                          </span>
                          <span className="text-xs text-text-muted">{formatDateTime(e.createdAt)} · {e.actorEmail ?? (e.actorUserId ? "membre" : "Selio (automatique)")}</span>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </Card>
              {mode === "demo" ? <p className="text-xs text-text-muted">Démonstration : les actions sont simulées dans ce navigateur ; aucun compte réel n'est modifié.</p> : null}
            </div>
          </>
        )}
      </QueryBoundary>
    </>
  );
}
