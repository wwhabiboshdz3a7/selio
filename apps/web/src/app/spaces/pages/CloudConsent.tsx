import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ArrowRight, Gavel, Network, OctagonPause, UserCheck } from "lucide-react";
import { CLOUD_CONSENT_VERSION } from "@selio/contracts";
import { Alert, Button, Card, Checkbox, ErrorState, PageHeader, SkeletonRows, buttonClass, formatDateTime } from "@selio/ui";
import { useClient, useRequiredSession } from "../../../lib/data/provider";
import { errorMessage } from "../../../lib/errors";
import { useAppMutation } from "../../components/hooks";
import { CLOUD_KEYS, CloudFootnote, CloudOfferNotice, useCanManageCloud, useCloudAvailability, useCloudConsent } from "../cloud/shared";

/** Les risques, chacun dans son encadré, avant le texte complet. */
const RISKS: { icon: ReactNode; title: string; text: string }[] = [
  { icon: <Gavel />, title: "Les règles de Vinted", text: "Les conditions de Vinted interdisent l'accès par des moyens automatisés. Votre compte peut recevoir un avertissement, être limité ou suspendu : Selio ne peut pas l'exclure." },
  { icon: <Network />, title: "Une adresse partagée", text: "Au lancement, tous les comptes Cloud passent par l'adresse IP de notre machine. Un compte sanctionné peut faire bloquer cette adresse pour les autres." },
  { icon: <OctagonPause />, title: "Pause au premier avertissement", text: "CAPTCHA, avertissement, blocage ou « trop de requêtes » : le compte passe en pause et vous êtes prévenu. Aucun contournement, rien n'est retenté sans vous." },
  { icon: <UserCheck />, title: "Votre responsabilité", text: "Vous restez seul titulaire et responsable de votre compte Vinted et de ce qui y est envoyé. Pause, arrêt et suppression de la session à tout moment." },
];

/** Écran d'accord : risques, texte complet, case à cocher ; l'accord enregistré s'affiche ensuite. */
export default function CloudConsent() {
  const client = useClient();
  const session = useRequiredSession();
  const consent = useCloudConsent();
  const availability = useCloudAvailability();
  const canManage = useCanManageCloud();
  const [checked, setChecked] = useState(false);
  const accept = useAppMutation(() => client.acceptCloudConsent({ version: CLOUD_CONSENT_VERSION, accepted: true }), { invalidate: CLOUD_KEYS, success: "Accord enregistré : vous pouvez relier vos comptes", onSuccess: () => setChecked(false) });

  const view = consent.data;
  const av = availability.data;
  const recorded = view?.accepted ?? null;
  const current = view?.current === true;
  const blockedReason = !canManage
    ? "Seuls un administrateur ou le propriétaire peuvent accepter les conditions du Cloud."
    : av && !av.available
      ? "Selio Cloud n'est pas activable avec votre offre : l'accord pourra être donné quand il le sera."
      : null;

  return (
    <>
      <PageHeader eyebrow="Selio Cloud" title="Accord et risques" description="À lire avant toute activation : ce que fait le Cloud, ce qu'il ne fait jamais, et les risques pour votre compte Vinted." />
      {av ? <CloudOfferNotice availability={av} className="mb-4" /> : null}

      {recorded && current ? (
        <Alert tone="success" className="mb-6" title="Accord enregistré" action={<Link to="/cloud/comptes" className={buttonClass({ variant: "secondary", size: "sm" })}>Relier mes comptes <ArrowRight aria-hidden /></Link>}>
          <span data-testid="cloud-consent-recorded">
            Accepté le <span className="num">{formatDateTime(recorded.acceptedAt)}</span>{recorded.userId === session.user.id ? " par vous" : ""}, version <span className="num">{recorded.version}</span>. Empreinte du texte : <span className="num break-all">{recorded.textHash.slice(0, 16)}…</span>
          </span>
        </Alert>
      ) : recorded ? (
        <Alert tone="warning" className="mb-6" title="Le texte a changé depuis votre accord">
          Vous aviez accepté la version <span className="num">{recorded.version}</span> le <span className="num">{formatDateTime(recorded.acceptedAt)}</span>. Relisez la version <span className="num">{CLOUD_CONSENT_VERSION}</span> et acceptez-la : en attendant, aucune action Cloud n'a lieu.
        </Alert>
      ) : null}

      <section aria-labelledby="cloud-risques" className="mb-6">
        <h2 id="cloud-risques" className="mb-3 text-sm font-bold tracking-wider text-text uppercase">Les risques, en clair</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {RISKS.map((r) => (
            <div key={r.title} className="rounded-lg border border-border bg-surface p-4">
              <p className="flex items-center gap-2 text-base font-semibold text-text"><span className="text-text-muted [&>svg]:size-4" aria-hidden>{r.icon}</span>{r.title}</p>
              <p className="mt-1 text-sm text-text-muted">{r.text}</p>
            </div>
          ))}
        </div>
      </section>

      {consent.isPending ? <SkeletonRows rows={3} /> : consent.isError ? <ErrorState description={errorMessage(consent.error)} onRetry={() => void consent.refetch()} /> : (
        <Card>
          <h2 className="text-md font-semibold text-text">Texte de l'accord</h2>
          <p className="text-xs text-text-muted">Version <span className="num">{view!.version}</span> — l'empreinte de ce texte est enregistrée avec votre accord.</p>
          <div className="mt-4 flex max-w-3xl flex-col gap-3 text-sm text-text" data-testid="cloud-consent-text">
            {view!.text.split("\n").map((p) => <p key={p}>{p}</p>)}
          </div>
          {current ? null : (
            <div className="mt-6 flex flex-col gap-4 border-t border-border pt-5">
              <Checkbox
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                disabled={!!blockedReason}
                label={<span>J'ai lu ce texte et j'accepte ces conditions, y compris les risques pour mon compte Vinted.</span>}
              />
              {blockedReason ? <p className="text-sm text-text-muted">{blockedReason}</p> : null}
              <div>
                <Button variant="accent" disabled={!checked || !!blockedReason} loading={accept.isPending} onClick={() => accept.mutate(undefined)}>J'active Selio Cloud</Button>
              </div>
              <p className="text-xs text-text-muted">L'accord ne lance aucune action : vous reliez ensuite chaque compte et vous vous y connectez vous-même.</p>
            </div>
          )}
        </Card>
      )}
      <CloudFootnote />
    </>
  );
}
