import { useState } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Moon, Send, Smartphone } from "lucide-react";
import { RADAR_ALERT_MIN_SCORE_DEFAULT, type RadarAlertPayload, type RadarSettings } from "@selio/contracts";
import { can } from "@selio/domain";
import { Alert, Button, Card, Field, Input, Select, StatusBadge, Toggle, formatDateTime, useToast } from "@selio/ui";
import { useClient, useRequiredSession } from "../../../lib/data/provider";
import { errorMessage } from "../../../lib/errors";
import { browserPushEnv, currentSubscription, deviceLabel, disablePush, enablePush, permissionOf, pushSupport, showLocalNotification, type PushEnv } from "../../../lib/push";
import { useAppMutation } from "../../components/hooks";
import { BandBadge } from "../../components/deals";

export default function Notifications() {
  const client = useClient();
  const session = useRequiredSession();
  const [n, setN] = useState(session.org.settings.notifications);
  const save = useAppMutation(() => client.updateOrg({ settings: { notifications: n } }), { invalidate: ["session"], success: "Notifications enregistrées" });
  const editable = can(session.role, "org.update");
  return (
    <div className="flex flex-col gap-4">
      <RadarPushSettings />
      <Card>
        <h2 className="text-md font-semibold">Notifications de l'application</h2>
        <Alert tone="info" className="mt-3">Ces notifications s'affichent dans l'application (alertes de la vue d'ensemble). L'envoi d'email n'est pas encore configuré : aucun service tiers n'est branché.</Alert>
        <div className="mt-4 flex max-w-xl flex-col gap-4">
          <Toggle label="Nouveau message acheteur" checked={n.newMessage} onChange={(v) => setN({ ...n, newMessage: v })} disabled={!editable} />
          <Toggle label="Échec d'une automatisation" checked={n.automationFailure} onChange={(v) => setN({ ...n, automationFailure: v })} disabled={!editable} />
          <Toggle label="Connexion expirée ou dégradée" checked={n.connectionExpired} onChange={(v) => setN({ ...n, connectionExpired: v })} disabled={!editable} />
          <Toggle label="Résumé par email" description="Disponible lorsque le service d'email sera configuré." checked={n.emailDigest} onChange={(v) => setN({ ...n, emailDigest: v })} disabled />
          {editable ? <div><Button onClick={() => save.mutate()} loading={save.isPending}>Enregistrer</Button></div> : null}
        </div>
      </Card>
    </div>
  );
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

const DEFAULT_QUIET = { from: 22, to: 8 };

/**
 * « Alertes Radar sur ce téléphone » : permission demandée au clic seulement, abonnement Web Push avec la
 * clé publique du serveur, notification de test, note minimale et heures calmes. Désactivé si le serveur
 * n'a pas de clés ou si le navigateur ne sait pas recevoir de notification. En démonstration, rien n'est
 * envoyé : le test s'affiche sur cet appareil (notification locale si permise, sinon un bandeau).
 */
export function RadarPushSettings({ env: envProp }: { env?: PushEnv } = {}) {
  const client = useClient();
  const session = useRequiredSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  const env = envProp ?? browserPushEnv();
  const support = pushSupport(env);
  const [permission, setPermission] = useState(() => permissionOf(env));
  const [banner, setBanner] = useState<RadarAlertPayload | null>(null);
  const config = useQuery({ queryKey: ["push-config"], queryFn: () => client.pushConfig() });
  const devices = useQuery({ queryKey: ["push-subscriptions"], queryFn: () => client.listPushSubscriptions() });
  const device = useQuery({ queryKey: ["push-device"], queryFn: async () => (await currentSubscription(env))?.endpoint ?? null, enabled: support.supported });
  const demo = config.data?.simulated === true;
  const serverReady = config.data?.enabled === true && Boolean(config.data.publicKey);
  const subscribed = Boolean(device.data) && (devices.data ?? []).some((d) => d.endpoint === device.data && !d.disabledAt);
  const canEdit = can(session.role, "radar.write");
  const [radar, setRadar] = useState<RadarSettings>(session.org.settings.radar ?? { alertsEnabled: true, alertMinScore: RADAR_ALERT_MIN_SCORE_DEFAULT, quietHours: null, maxPagesPerMinute: 10 });
  const radarDirty = JSON.stringify(radar) !== JSON.stringify(session.org.settings.radar);

  const refresh = async () => {
    setPermission(permissionOf(env));
    await Promise.all(["push-subscriptions", "push-device"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  };
  const enable = useAppMutation(() => enablePush(client, config.data?.publicKey ?? null, env), {
    onSuccess: async (r) => {
      await refresh();
      if (r.ok) toast({ tone: "success", title: "Alertes Radar activées sur ce téléphone" });
      else toast({ tone: "danger", title: "Alertes non activées", description: r.message });
    },
  });
  const disable = useAppMutation(() => disablePush(client, env), { onSuccess: async () => { await refresh(); toast({ tone: "success", title: "Alertes Radar désactivées sur ce téléphone" }); } });
  // Retirer un appareil de la liste (téléphone perdu, ancien navigateur) : il ne reçoit plus rien.
  const removeDevice = useAppMutation((id: string) => client.removePushSubscription(id), { onSuccess: async () => { await refresh(); toast({ tone: "success", title: "Appareil retiré : il ne recevra plus les alertes" }); } });
  const test = useAppMutation(() => client.testPush(), {
    onSuccess: async (r) => {
      if (r.simulated && r.payload) {
        // Démonstration : rien ne part d'un serveur ; notification locale si permise, sinon bandeau.
        const shown = await showLocalNotification(r.payload, env).catch(() => false);
        if (!shown) setBanner(r.payload);
        toast({ tone: "info", title: "Notification de test (démonstration)", description: shown ? "Affichée sur cet appareil, sans serveur." : "Notifications non autorisées ici : aperçu ci-dessous." });
        return;
      }
      toast({ tone: r.sent > 0 ? "success" : "danger", title: r.sent > 0 ? `Notification de test envoyée à ${r.sent} appareil(s)` : "Aucune notification envoyée", description: r.failed || r.disabled ? `${r.failed ?? 0} échec(s), ${r.disabled ?? 0} appareil(s) désactivé(s).` : undefined });
      await refresh();
    },
  });
  const askLocal = async () => {
    if (!env.Notification) return;
    try {
      setPermission(await env.Notification.requestPermission());
    } catch (e) {
      toast({ tone: "danger", title: "Permission impossible à demander", description: errorMessage(e) });
    }
  };
  const saveRadar = useAppMutation(() => client.updateRadarSettings({ radar }), { invalidate: ["session"], success: "Réglages des alertes enregistrés" });

  return (
    <Card aria-labelledby="radar-push-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="radar-push-title" className="flex items-center gap-2 text-md font-semibold"><Smartphone className="size-4 text-text-muted" aria-hidden />Alertes Radar sur ce téléphone</h2>
        {demo ? <StatusBadge tone="muted">Démonstration</StatusBadge> : subscribed ? <StatusBadge tone="success">Activées sur cet appareil</StatusBadge> : <StatusBadge tone="muted">Désactivées sur cet appareil</StatusBadge>}
      </div>
      <p className="mt-1 text-sm text-text-muted">Une notification à chaque bonne affaire repérée en direct, à chaque paiement à valider (3-D Secure) et si Vinted met la lecture en pause. Toucher la notification ouvre l'affaire, prête pour le « 1 clic ». Aucun pseudo, note ni photo de vendeur dans la notification.</p>

      <div className="mt-4 flex flex-col gap-3">
        {!support.supported ? <Alert tone="warning" title="Ce navigateur ne reçoit pas les notifications">{support.reason}</Alert> : null}
        {demo ? (
          <Alert tone="info" title="Démonstration : rien n'est envoyé">
            Sur votre compte, ce téléphone s'abonne avec la clé publique de Selio et reçoit les alertes même application fermée. Ici, la notification de test s'affiche seulement sur cet appareil{support.supported ? "" : " (sous forme de bandeau)"}.
          </Alert>
        ) : config.data && !serverReady ? (
          <Alert tone="warning" title="Notifications indisponibles sur ce serveur">{config.data.reason ?? "Les clés de notification (VAPID) ne sont pas configurées."}</Alert>
        ) : null}
        {permission === "denied" ? <Alert tone="warning" title="Notifications bloquées pour Selio">Autorisez-les dans les réglages du site (icône à gauche de l'adresse), puis revenez ici.</Alert> : null}

        <div className="flex flex-wrap gap-2">
          {demo ? (
            permission !== "granted" && support.supported ? <Button icon={<BellRing />} onClick={() => void askLocal()}>Autoriser les notifications ici</Button> : null
          ) : subscribed ? (
            <Button variant="secondary" onClick={() => disable.mutate(undefined)} loading={disable.isPending}>Désactiver sur ce téléphone</Button>
          ) : (
            <Button icon={<BellRing />} onClick={() => enable.mutate(undefined)} loading={enable.isPending} disabled={!support.supported || !serverReady || permission === "denied"}>Activer les alertes sur ce téléphone</Button>
          )}
          <Button variant="secondary" icon={<Send />} onClick={() => test.mutate(undefined)} loading={test.isPending} disabled={!demo && !subscribed}>Envoyer une notification de test</Button>
        </div>
        {!demo && devices.data ? (
          <div>
            <p className="num text-xs text-text-muted">{devices.data.filter((d) => !d.disabledAt).length} appareil(s) abonné(s) à votre compte.</p>
            {devices.data.length > 0 ? (
              <ul className="mt-2 flex flex-col divide-y divide-border rounded-lg border border-border" aria-label="Appareils abonnés">
                {devices.data.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate text-text">{deviceLabel(d.userAgent)}{d.endpoint === device.data ? <span className="ml-2 text-xs text-text-muted">(cet appareil)</span> : null}</span>
                      <span className="block text-xs text-text-muted">Ajouté le {formatDateTime(d.createdAt)}{d.disabledAt ? " · désactivé (le service de notification ne le connaît plus)" : ""}</span>
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => removeDevice.mutate(d.id)} loading={removeDevice.isPending && removeDevice.variables === d.id} aria-label={`Retirer l'appareil ${deviceLabel(d.userAgent)}`}>Retirer</Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {banner ? (
          <div role="status" aria-label="Aperçu de la notification" className="flex items-start gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-md">
            <img src="/icon-192.png" alt="" className="size-9 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium text-text">{banner.title}</p>
              <p className="text-text-muted">{banner.body}</p>
              <Link to={banner.url} className="text-xs font-medium text-accent underline-offset-2 hover:underline">Ouvrir</Link>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setBanner(null)}>Fermer</Button>
          </div>
        ) : null}
      </div>

      <div className="mt-6 border-t border-border pt-5">
        <h3 className="mb-3 text-sm font-semibold text-text">Quelles alertes</h3>
        <div className="flex max-w-xl flex-col gap-4">
          <Toggle label="Alertes des bonnes affaires" description="Paiement à valider et pause de la lecture sont toujours signalés." checked={radar.alertsEnabled} onChange={(v) => setRadar({ ...radar, alertsEnabled: v })} disabled={!canEdit} />
          <div>
            <div className="flex items-end justify-between gap-3">
              <label htmlFor="alert-min-score" className="text-sm font-medium text-text">Note minimale d'une alerte</label>
              <span className="flex items-center gap-2"><span className="num text-sm font-semibold">{radar.alertMinScore}/100</span><BandBadge score={radar.alertMinScore} /></span>
            </div>
            <input id="alert-min-score" type="range" min={50} max={100} step={1} value={radar.alertMinScore} onChange={(e) => setRadar({ ...radar, alertMinScore: Number(e.target.value) })} disabled={!canEdit || !radar.alertsEnabled} className="mt-3 w-full accent-[var(--accent)] disabled:opacity-60" />
            <p className="mt-1 text-xs text-text-muted">{RADAR_ALERT_MIN_SCORE_DEFAULT} par défaut (seuil « À valider »). Plus haut : moins d'alertes, seulement les meilleures.</p>
          </div>
          <Toggle label="Heures calmes" description="Aucune notification pendant cette plage ; les alertes partent à la fin. La lecture continue." checked={radar.quietHours !== null} onChange={(v) => setRadar({ ...radar, quietHours: v ? radar.quietHours ?? DEFAULT_QUIET : null })} disabled={!canEdit} />
          {radar.quietHours ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="De">{(p) => <Select id={p.id} value={String(radar.quietHours!.from)} onChange={(e) => setRadar({ ...radar, quietHours: { ...radar.quietHours!, from: Number(e.target.value) } })} disabled={!canEdit}>{HOURS.map((h) => <option key={h} value={h}>{`${h} h`}</option>)}</Select>}</Field>
              <Field label="À">{(p) => <Select id={p.id} value={String(radar.quietHours!.to)} onChange={(e) => setRadar({ ...radar, quietHours: { ...radar.quietHours!, to: Number(e.target.value) } })} disabled={!canEdit}>{HOURS.map((h) => <option key={h} value={h}>{`${h} h`}</option>)}</Select>}</Field>
              <p className="col-span-2 flex items-center gap-1.5 text-xs text-text-muted"><Moon className="size-3.5" aria-hidden />Fuseau de l'organisation ({session.org.settings.timezone}).</p>
            </div>
          ) : null}
          <Field label="Pages lues en direct par minute, au plus" hint="Pour toute l'organisation. Le rythme ralentit aussi tout seul après un blocage.">
            {(p) => <Input id={p.id} aria-describedby={p.describedBy} type="number" min={1} max={60} value={radar.maxPagesPerMinute} onChange={(e) => setRadar({ ...radar, maxPagesPerMinute: Math.max(1, Math.min(60, Math.round(Number(e.target.value) || 1))) })} disabled={!canEdit} />}
          </Field>
          {canEdit ? <div><Button onClick={() => saveRadar.mutate(undefined)} loading={saveRadar.isPending} disabled={!radarDirty}>Enregistrer</Button></div> : null}
        </div>
      </div>
    </Card>
  );
}
