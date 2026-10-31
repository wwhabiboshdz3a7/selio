import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Pause, Play, Plug } from "lucide-react";
import { CLOUD_ACTION_KIND_LABELS, CLOUD_MAX_ACCOUNTS_PER_ORG_DEFAULT, isVintedPauseReason } from "@selio/contracts";
import { Alert, Button, Card, ConfirmDialog, EmptyState, ErrorState, PageHeader, SkeletonRows, StatStrip, buttonClass, formatDateTime, formatNumber, formatRelative } from "@selio/ui";
import { useClient } from "../../../lib/data/provider";
import { errorMessage } from "../../../lib/errors";
import { useAppMutation } from "../../components/hooks";
import { CloudActionStatusBadge, CloudFootnote, CloudOfferNotice, CloudStatusBadge, ConsentRequired, ServerOffNotice, accountName, actionResult, pauseReasonText, useCanManageCloud, useCloudAccounts, useCloudAvailability, useCloudConsent } from "../cloud/shared";

/** Selio Cloud — tableau de bord : état du Cloud, comptes, dernières actions et pause globale. */
export default function CloudDashboard() {
  const client = useClient();
  const availability = useCloudAvailability();
  const consent = useCloudConsent();
  const accounts = useCloudAccounts();
  const journal = useQuery({ queryKey: ["cloud-journal", "latest"], queryFn: () => client.cloudJournal({ page: 1, pageSize: 6 }) });
  const automation = useQuery({ queryKey: ["automation-state"], queryFn: () => client.getAutomationState() });
  const canManage = useCanManageCloud();
  const [confirmPause, setConfirmPause] = useState(false);
  const pause = useAppMutation((paused: boolean) => client.setGlobalPause(paused), { invalidate: ["automation-state", "overview", "rules"], success: (s) => (s.globalPaused ? "Selio Cloud en pause : aucune action n'est lancée" : "Selio Cloud repris") });

  const paused = automation.data?.globalPaused === true;
  const list = accounts.data ?? [];
  const live = list.filter((a) => a.status !== "stopped");
  const vintedPaused = list.filter((a) => a.status === "paused" && isVintedPauseReason(a.pausedReason));
  const actionsToday = list.reduce((s, a) => s + a.actionsToday, 0);
  const av = availability.data;

  return (
    <>
      <PageHeader
        eyebrow="Selio Cloud"
        title="Tableau de bord"
        description="Vos réponses et relances continuent quand votre ordinateur est éteint : un navigateur isolé par compte, ouvert seulement pour agir, au rythme humain."
        actions={automation.data ? (paused
          ? <Button variant="secondary" icon={<Play />} onClick={() => pause.mutate(false)} loading={pause.isPending} disabled={!canManage}>Reprendre le Cloud</Button>
          : <Button variant="danger" icon={<Pause />} onClick={() => setConfirmPause(true)} disabled={!canManage}>Tout mettre en pause</Button>) : null}
      />

      {paused ? (
        <Alert tone="warning" className="mb-4" title="Selio Cloud en pause">
          Arrêt global actif{automation.data?.pausedAt ? <> depuis le <span className="num">{formatDateTime(automation.data.pausedAt)}</span></> : null} : aucune action n'est lancée, sur aucun compte. Les autres automatisations de Selio sont aussi arrêtées.
        </Alert>
      ) : null}
      {av ? <CloudOfferNotice availability={av} className="mb-4" /> : null}
      {av?.serverEnabled === false ? <ServerOffNotice /> : null}
      {consent.data && !consent.data.current ? <ConsentRequired hadPrevious={consent.data.accepted !== null} className="mb-4" /> : null}
      {vintedPaused.length > 0 ? (
        <Alert tone="danger" className="mb-4" title={vintedPaused.length > 1 ? `${vintedPaused.length} comptes en pause après un signal de Vinted` : "Un compte en pause après un signal de Vinted"} action={<Link to="/cloud/comptes" className={buttonClass({ variant: "secondary", size: "sm" })}>Voir les comptes</Link>}>
          <ul className="flex flex-col gap-0.5">
            {vintedPaused.map((a) => <li key={a.id}><span className="font-medium text-text">{accountName(a)}</span> : {pauseReasonText(a)}.</li>)}
          </ul>
          <p className="mt-1">Rien n'est retenté automatiquement : vérifiez le compte dans Vinted, puis reprenez en confirmant en avoir pris connaissance.</p>
        </Alert>
      ) : null}

      <StatStrip
        className="mb-6 grid-cols-2 lg:grid-cols-4"
        items={[
          { label: "Comptes Cloud", value: <>{formatNumber(live.length)}<span className="text-base font-medium text-text-muted"> / {av?.available ? av.maxAccounts : CLOUD_MAX_ACCOUNTS_PER_ORG_DEFAULT}</span></>, sub: "10 comptes maximum par organisation" },
          { label: "Actions aujourd'hui", value: formatNumber(actionsToday), sub: av ? `plafond de l'offre : ${formatNumber(av.actionsPerDay)} par jour` : undefined },
          { label: "En pause", value: formatNumber(list.filter((a) => a.status === "paused").length), sub: "pause au premier avertissement de Vinted" },
          { label: "Sessions enregistrées", value: formatNumber(list.filter((a) => a.hasSession).length), sub: "chiffrées, supprimables en un clic" },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-md font-semibold text-text">Comptes</h2>
            <Link to="/cloud/comptes" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">Gérer <ArrowRight className="size-4" aria-hidden /></Link>
          </div>
          {accounts.isPending ? <SkeletonRows rows={2} className="border-0" /> : accounts.isError ? <ErrorState description={errorMessage(accounts.error)} onRetry={() => void accounts.refetch()} className="border-0" /> : live.length === 0 ? (
            <EmptyState
              className="border-0 py-8"
              icon={<Plug />}
              title="Aucun compte relié au Cloud"
              description="Reliez un compte Vinted, puis connectez-vous vous-même dans la fenêtre sécurisée : Selio ne vous demande jamais votre mot de passe."
              action={<Link to="/cloud/comptes" className={buttonClass({ variant: "primary", size: "sm" })}>Relier un compte</Link>}
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {live.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-medium text-text">{accountName(a)}</p>
                    <p className="text-xs text-text-muted">
                      {a.status === "paused" ? pauseReasonText(a) : a.lastActionAt ? <>Dernière action {formatRelative(a.lastActionAt)}</> : "Aucune action pour l'instant"}
                    </p>
                  </div>
                  <span className="shrink-0"><CloudStatusBadge account={a} /></span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-md font-semibold text-text">Dernières actions</h2>
            <Link to="/cloud/journal" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">Tout le journal <ArrowRight className="size-4" aria-hidden /></Link>
          </div>
          {journal.isPending ? <SkeletonRows rows={3} className="border-0" /> : journal.isError ? <ErrorState description={errorMessage(journal.error)} onRetry={() => void journal.refetch()} className="border-0" /> : journal.data.items.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-muted">Aucune action pour l'instant. Chaque action ouvrant le navigateur sera inscrite ici (gardée 90 jours).</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {journal.data.items.map((x) => {
                const acc = list.find((a) => a.id === x.accountId);
                return (
                  <li key={x.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-text"><span className="font-medium">{CLOUD_ACTION_KIND_LABELS[x.kind]}</span>{acc ? <span className="text-text-muted"> · {acc.connectionLabel}</span> : null}</p>
                      <p className="truncate text-xs text-text-muted"><span className="num">{formatDateTime(x.createdAt)}</span> — {actionResult(x)}</p>
                    </div>
                    <CloudActionStatusBadge status={x.status} />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <h2 className="text-md font-semibold text-text">Ce que fait Selio Cloud au lancement</h2>
        <ul className="mt-3 grid gap-3 text-sm text-text-muted md:grid-cols-3">
          <li><span className="block font-medium text-text">Actions légères seulement</span>Répondre à un message, relancer un acheteur après 24 h. Republier et modifier en masse restent fermés : à décider, l'adresse étant partagée.</li>
          <li><span className="block font-medium text-text">Au rythme humain</span>Un navigateur ouvert seulement pour agir puis refermé, quelques minutes entre deux actions, jamais la nuit, dans les plafonds de votre offre.</li>
          <li><span className="block font-medium text-text">Arrêt au premier signal</span>CAPTCHA, avertissement, blocage ou « trop de requêtes » : le compte passe en pause, vous êtes prévenu, rien n'est retenté.</li>
        </ul>
      </Card>

      <CloudFootnote />
      <ConfirmDialog
        open={confirmPause}
        onClose={() => setConfirmPause(false)}
        onConfirm={() => { pause.mutate(true); setConfirmPause(false); }}
        title="Mettre Selio Cloud en pause ?"
        description="Arrêt global : aucune action Cloud n'est lancée, sur aucun compte, et les autres automatisations de Selio s'arrêtent aussi, jusqu'à la reprise."
        confirmLabel="Tout mettre en pause"
        danger
      />
    </>
  );
}
