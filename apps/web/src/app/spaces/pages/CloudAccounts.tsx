import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CircleStop, KeyRound, Link2, LogIn, Pause, Play, Trash2 } from "lucide-react";
import { CLOUD_MAX_ACCOUNTS_PER_ORG_DEFAULT, CLOUD_PAUSE_REASON_LABELS, CONNECTION_USAGE_LABELS, isVintedPauseReason, type CloudActionLevel, type MarketplaceConnection } from "@selio/contracts";
import { isAutomatable } from "@selio/domain";
import { Alert, Button, Card, Checkbox, ConfirmDialog, Dialog, EmptyState, ErrorState, PageHeader, SkeletonRows, Tag, buttonClass, cn, formatDateTime, formatNumber } from "@selio/ui";
import { useClient } from "../../../lib/data/provider";
import { errorMessage } from "../../../lib/errors";
import type { CloudAccountView } from "../../../lib/data/types";
import { useAppMutation } from "../../components/hooks";
import { SecureLoginWindow } from "../cloud/SecureLoginWindow";
import { CLOUD_KEYS, CloudFootnote, CloudOfferNotice, CloudStatusBadge, ConsentRequired, ServerOffNotice, accountName, handleOf, pauseReasonText, useCanManageCloud, useCloudAccounts, useCloudAvailability, useCloudConsent } from "../cloud/shared";

type Confirm = { kind: "stop" | "session"; account: CloudAccountView } | null;

/** Comptes Vinted face au Cloud : relier, se connecter, pause, reprise, arrêt, session, niveaux d'action. */
export default function CloudAccounts() {
  const client = useClient();
  const connections = useQuery({ queryKey: ["connections"], queryFn: () => client.listConnections() });
  const accounts = useCloudAccounts();
  const availability = useCloudAvailability();
  const consent = useCloudConsent();
  const canManage = useCanManageCloud();
  const [login, setLogin] = useState<CloudAccountView | null>(null);
  const [ack, setAck] = useState<CloudAccountView | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const inv = [...CLOUD_KEYS, "connections"];

  const enable = useAppMutation((connectionId: string) => client.enableCloudAccount(connectionId), { invalidate: inv, success: "Compte relié : connectez-vous pour l'activer" });
  const pause = useAppMutation((id: string) => client.pauseCloudAccount(id), { invalidate: inv, success: "Compte mis en pause" });
  const resume = useAppMutation(({ id, acknowledge }: { id: string; acknowledge: boolean }) => client.resumeCloudAccount(id, { acknowledge }), { invalidate: inv, success: "Compte repris", onSuccess: () => setAck(null) });
  const stop = useAppMutation((id: string) => client.stopCloudAccount(id), { invalidate: inv, success: "Cloud arrêté pour ce compte : session effacée", onSuccess: () => setConfirm(null) });
  const dropSession = useAppMutation((id: string) => client.deleteCloudSession(id), { invalidate: inv, success: "Session supprimée", onSuccess: () => setConfirm(null) });
  const levels = useAppMutation(({ id, levels: next }: { id: string; levels: CloudActionLevel[] }) => client.updateCloudSettings(id, { levels: next }), { invalidate: inv, success: "Niveaux d'action enregistrés" });

  const av = availability.data;
  const consentOk = consent.data?.current === true;
  const list = (connections.data ?? []).filter((c) => c.provider === "vinted");
  const byConnection = new Map((accounts.data ?? []).map((a) => [a.connectionId, a]));
  const used = (accounts.data ?? []).filter((a) => a.status !== "stopped").length;
  const max = av?.available ? av.maxAccounts : CLOUD_MAX_ACCOUNTS_PER_ORG_DEFAULT;
  const full = used >= max;
  const canAct = canManage && !!av?.available && consentOk;
  const loading = connections.isPending || accounts.isPending;
  const error = connections.error ?? accounts.error;

  return (
    <>
      <PageHeader
        eyebrow="Selio Cloud"
        title="Comptes Cloud"
        description="Reliez un compte Vinted, puis connectez-vous vous-même dans la fenêtre sécurisée. Pause, reprise, arrêt et suppression de la session en un clic."
        actions={<span className="num rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text-muted" data-testid="cloud-accounts-limit"><span className="font-semibold text-text">{formatNumber(used)}</span> / {formatNumber(max)} comptes Cloud</span>}
      />
      {av ? <CloudOfferNotice availability={av} className="mb-4" /> : null}
      {av?.serverEnabled === false ? <ServerOffNotice /> : null}
      {consent.data && !consentOk ? <ConsentRequired hadPrevious={consent.data.accepted !== null} className="mb-4" /> : null}
      {av?.available && full ? (
        <Alert tone="info" className="mb-4" title={`Limite de ${max} comptes Cloud atteinte`}>Arrêtez un compte avant d'en relier un autre. Au lancement, 10 comptes au plus par organisation.</Alert>
      ) : null}
      <p className="mb-5 text-sm text-text-muted">10 comptes Cloud maximum par organisation. Les comptes Perso ne sont jamais utilisés par les automatisations.</p>

      {loading ? <SkeletonRows rows={3} /> : error ? <ErrorState description={errorMessage(error)} onRetry={() => { void connections.refetch(); void accounts.refetch(); }} /> : list.length === 0 ? (
        <EmptyState
          icon={<Link2 />}
          title="Aucun compte Vinted"
          description="Ajoutez d'abord vos comptes Vinted dans Selio (vente, achat ou perso), puis revenez les relier au Cloud."
          action={<Link to="/app/accounts" className={buttonClass({ variant: "primary", size: "sm" })}>Ajouter un compte Vinted</Link>}
        />
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Comptes Vinted et Selio Cloud">
          {list.map((c) => (
            <AccountRow
              key={c.id}
              connection={c}
              account={byConnection.get(c.id) ?? null}
              canAct={canAct}
              canLogin={canAct && av?.serverEnabled !== false}
              canManage={canManage}
              full={full}
              heavyEnabled={av?.heavyActionsEnabled === true}
              busy={enable.isPending || pause.isPending || resume.isPending}
              onEnable={() => enable.mutate(c.id)}
              onLogin={(a) => setLogin(a)}
              onPause={(a) => pause.mutate(a.id)}
              onResume={(a) => (isVintedPauseReason(a.pausedReason) ? setAck(a) : resume.mutate({ id: a.id, acknowledge: false }))}
              onStop={(a) => setConfirm({ kind: "stop", account: a })}
              onDeleteSession={(a) => setConfirm({ kind: "session", account: a })}
              onLevels={(a, next) => levels.mutate({ id: a.id, levels: next })}
            />
          ))}
        </ul>
      )}

      <SecureLoginWindow account={login} open={login !== null} onClose={() => setLogin(null)} />
      <AcknowledgeDialog account={ack} loading={resume.isPending} onClose={() => setAck(null)} onConfirm={(a) => resume.mutate({ id: a.id, acknowledge: true })} />
      <ConfirmDialog
        open={confirm?.kind === "stop"}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && stop.mutate(confirm.account.id)}
        loading={stop.isPending}
        title="Arrêter le Cloud pour ce compte ?"
        description="La session enregistrée est effacée et les actions prévues sont annulées. Vous pourrez relier le compte plus tard : il faudra vous reconnecter."
        confirmLabel="Arrêter"
        danger
      />
      <ConfirmDialog
        open={confirm?.kind === "session"}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && dropSession.mutate(confirm.account.id)}
        loading={dropSession.isPending}
        title="Supprimer la session de ce compte ?"
        description="Les cookies Vinted gardés pour ce compte sont effacés de notre machine. Le Cloud n'agit plus sur ce compte tant que vous ne vous reconnectez pas."
        confirmLabel="Supprimer la session"
        danger
      />
      <CloudFootnote />
    </>
  );
}

interface RowProps {
  connection: MarketplaceConnection;
  account: CloudAccountView | null;
  canAct: boolean;
  /** Fenêtre de connexion disponible (accord, offre, Cloud activé sur le serveur). */
  canLogin: boolean;
  canManage: boolean;
  full: boolean;
  heavyEnabled: boolean;
  busy: boolean;
  onEnable: () => void;
  onLogin: (a: CloudAccountView) => void;
  onPause: (a: CloudAccountView) => void;
  onResume: (a: CloudAccountView) => void;
  onStop: (a: CloudAccountView) => void;
  onDeleteSession: (a: CloudAccountView) => void;
  onLevels: (a: CloudAccountView, levels: CloudActionLevel[]) => void;
}

function AccountRow({ connection: c, account: a, canAct, canLogin, canManage, full, heavyEnabled, busy, onEnable, onLogin, onPause, onResume, onStop, onDeleteSession, onLevels }: RowProps) {
  const handle = handleOf(c);
  const personal = !isAutomatable(c);
  const disconnected = c.status === "disconnected";
  const linked = a !== null && a.status !== "stopped";
  const name = handle ? `${c.label} (@${handle})` : c.label;
  const fromVinted = a?.status === "paused" && isVintedPauseReason(a.pausedReason);
  const heavy = a?.settings.levels.includes("heavy") === true;

  let detail: string;
  if (personal) detail = "Compte Perso : jamais utilisé par les automatisations, donc pas par le Cloud.";
  else if (disconnected) detail = "Compte déconnecté dans Selio : reconnectez-le avant de le relier au Cloud.";
  else if (!a) detail = "Pas encore relié au Cloud.";
  else if (a.status === "stopped") detail = "Cloud arrêté pour ce compte : aucune session gardée.";
  else if (a.status === "needs_login") detail = "Relié : connectez-vous vous-même pour enregistrer la session.";
  else if (a.status === "paused") detail = pauseReasonText(a) ?? CLOUD_PAUSE_REASON_LABELS.client;
  else detail = a.sessionSavedAt ? `Session enregistrée le ${formatDateTime(a.sessionSavedAt)}.` : "Actif.";

  return (
    <li aria-label={name}>
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-base font-semibold text-text">
              <span className="truncate">{c.label}</span>
              <Tag>{CONNECTION_USAGE_LABELS[c.usage]}</Tag>
            </p>
            {handle ? <p className="text-sm text-text-muted">@{handle}</p> : null}
            <p className={cn("mt-1 text-sm", fromVinted ? "text-danger" : "text-text-muted")} data-testid="cloud-account-detail">{detail}</p>
            {a && linked ? (
              <p className="num mt-0.5 text-xs text-text-muted">{formatNumber(a.actionsToday)} action{a.actionsToday > 1 ? "s" : ""} aujourd'hui{a.warningsCount > 0 ? ` · ${a.warningsCount} signal${a.warningsCount > 1 ? "s" : ""} de Vinted depuis l'activation` : ""}</p>
            ) : null}
          </div>
          <CloudStatusBadge account={a} />
        </div>

        {!personal && !disconnected && canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            {!linked ? (
              <Button size="sm" icon={<Link2 />} onClick={onEnable} disabled={!canAct || full || busy} title={full ? "Limite de comptes Cloud atteinte" : undefined}>{a?.status === "stopped" ? "Relier à nouveau" : "Relier"}</Button>
            ) : null}
            {a && linked && a.status !== "paused" ? (
              <Button size="sm" variant={a.status === "needs_login" ? "primary" : "secondary"} icon={<LogIn />} onClick={() => onLogin(a)} disabled={!canLogin}>{a.hasSession ? "Se reconnecter" : "Se connecter"}</Button>
            ) : null}
            {a && linked && a.status !== "paused" ? <Button size="sm" variant="secondary" icon={<Pause />} onClick={() => onPause(a)} disabled={busy}>Pause</Button> : null}
            {a && a.status === "paused" ? <Button size="sm" variant="secondary" icon={<Play />} onClick={() => onResume(a)} disabled={!canAct || busy}>Reprendre</Button> : null}
            {a && linked ? <Button size="sm" variant="ghost" icon={<CircleStop />} onClick={() => onStop(a)}>Arrêter</Button> : null}
            {a?.hasSession ? <Button size="sm" variant="danger" icon={<Trash2 />} onClick={() => onDeleteSession(a)}>Supprimer la session</Button> : null}
          </div>
        ) : null}

        {a && linked ? (
          <fieldset className="flex flex-col gap-2 border-t border-border pt-3">
            <legend className="sr-only">Niveaux d'action pour {name}</legend>
            <p className="text-xs font-medium tracking-wide text-text-muted uppercase">Niveaux d'action</p>
            <Checkbox checked readOnly disabled label={<span className="text-sm">Actions légères : répondre à un message, relancer après 24 h</span>} />
            <div className="flex flex-wrap items-center gap-2">
              <Checkbox
                checked={heavy}
                disabled={!heavyEnabled || !canManage}
                onChange={(e) => onLevels(a, e.target.checked ? ["light", "heavy"] : ["light"])}
                label={<span className={cn("text-sm", !heavyEnabled && "text-text-muted")}>Actions lourdes : republier, modifier en masse</span>}
              />
              {heavyEnabled ? null : <Tag>À décider : adresse partagée</Tag>}
            </div>
          </fieldset>
        ) : null}
      </Card>
    </li>
  );
}

/** Reprise après un signal de Vinted : le client confirme avoir vérifié son compte dans Vinted. */
function AcknowledgeDialog({ account, loading, onClose, onConfirm }: { account: CloudAccountView | null; loading: boolean; onClose: () => void; onConfirm: (a: CloudAccountView) => void }) {
  const [checked, setChecked] = useState(false);
  const close = () => {
    setChecked(false);
    onClose();
  };
  return (
    <Dialog
      open={account !== null}
      onClose={close}
      title="Reprendre après un signal de Vinted"
      description={account ? `${accountName(account)} — ${account.pausedReason ? CLOUD_PAUSE_REASON_LABELS[account.pausedReason] : ""}` : undefined}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={loading}>Annuler</Button>
          <Button variant="primary" disabled={!checked} loading={loading} onClick={() => account && onConfirm(account)}>Reprendre</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-text-muted">
        <p className="flex items-start gap-2"><KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden />Selio ne contourne jamais un CAPTCHA ni une protection de Vinted. Avant de reprendre, ouvrez Vinted vous-même et vérifiez le compte : avertissement, message de Vinted, limitation.</p>
        <p>Si Vinted a signalé un problème, mieux vaut laisser le compte en pause ou arrêter le Cloud pour ce compte.</p>
        <Checkbox checked={checked} onChange={(e) => setChecked(e.target.checked)} label={<span className="text-sm text-text">J'ai vérifié mon compte dans Vinted et je veux reprendre.</span>} />
      </div>
    </Dialog>
  );
}
