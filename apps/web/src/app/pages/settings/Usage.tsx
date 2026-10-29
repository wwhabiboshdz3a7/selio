import type { ReactNode } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { PLAN_LABELS, buildUsageCounter } from "@selio/contracts";
import { Alert, Card, DescriptionList, Tag, formatDate, formatNumber } from "@selio/ui";
import { useClient } from "../../../lib/data/provider";
import type { UsageSummary } from "../../../lib/data/types";
import { QueryBoundary } from "../../components/common";
import { UsageMeter } from "../../components/usage";

/** Prochaine remise à zéro : le 1er du mois suivant la période (UTC), comme `getUsage` côté serveur. */
export function nextResetDate(periodFrom: string): Date {
  const d = new Date(periodFrom);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

/**
 * Paramètres › Utilisation : une jauge par compteur (mon IA perso, actions automatiques, Studio,
 * Track, Cloud) avec « utilisé / quota », pourcentage, alerte à 80 % et date de remise à zéro.
 */
export default function Usage() {
  const client = useClient();
  const usage = useQuery({ queryKey: ["usage"], queryFn: () => client.getUsage() });
  const automation = useQuery({ queryKey: ["automation-state"], queryFn: () => client.getAutomationState() });
  const sub = useQuery({ queryKey: ["subscription"], queryFn: () => client.getSubscription() });
  return (
    <QueryBoundary query={usage} skeleton="spinner">
      {(u) => <UsageReport u={u} actionsToday={automation.data?.actionsToday ?? null} planLabel={sub.data ? PLAN_LABELS[sub.data.plan] : null} />}
    </QueryBoundary>
  );
}

function Section({ title, tag, description, children }: { title: string; tag?: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-md font-semibold">{title}</h2>
        {tag}
      </div>
      {description ? <p className="mt-0.5 text-sm text-text-muted">{description}</p> : null}
      <div className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2">{children}</div>
    </Card>
  );
}

function UsageReport({ u, actionsToday, planLabel }: { u: UsageSummary; actionsToday: number | null; planLabel: string | null }) {
  const reset = nextResetDate(u.period.from);
  const automationToday = buildUsageCounter(actionsToday ?? 0, u.quotas.automationActionsPerDay);
  const warning = u.warning || automationToday.warning;
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-md font-semibold">Mon utilisation</h2>
            <p className="mt-0.5 text-sm text-text-muted">
              Depuis le {formatDate(u.period.from, "long")} · remise à zéro le <span className="font-medium text-text">{formatDate(reset, "long")}</span>
              {planLabel ? <> · offre {planLabel}</> : null}
            </p>
          </div>
          <Link to="/app/settings/billing" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">Changer d'offre <ArrowRight className="size-3.5" aria-hidden /></Link>
        </div>
        {warning ? (
          <Alert tone="warning" title="Un compteur a atteint 80 % de votre offre" className="mt-4">À 100 %, l'action concernée est refusée proprement, sans facturation en plus. Changez d'offre pour continuer, ou attendez la remise à zéro du {formatDate(reset)}.</Alert>
        ) : (
          <Alert tone="info" className="mt-4">Tous les compteurs sont sous 80 %. À 100 %, l'action concernée est refusée proprement, sans facturation en plus ; une alerte apparaît ici dès 80 %.</Alert>
        )}
      </Card>

      <Section title="Mon IA perso et automatisations" description="Réponses rédigées par mon IA perso ce mois-ci ; les questions d'aide ne comptent pas. Les actions automatiques ont un plafond par jour.">
        <UsageMeter label="Réponses de mon IA perso" counter={u.counters.aiRequests} hint="Par mois." />
        <UsageMeter label="Actions automatiques aujourd'hui" counter={automationToday} hint={actionsToday === null ? "Plafond par jour." : `Plafond par jour · ${formatNumber(u.automationActions)} ce mois-ci.`} />
      </Section>

      <Section title="Selio Studio" description="Annonces rédigées à partir de vos photos. Inclus dans Pro et Agence ; Studio seul se paie à la photo.">
        <UsageMeter label="Annonces Studio" counter={u.studio.listings} hint="Par mois." />
        <UsageMeter label="Photos portées" counter={u.studio.wornPhotos} hint="Par mois." planned />
      </Section>

      <Section title="Selio Track" tag={<Tag>En développement</Tag>} description="Statistiques de marché seulement : Track ne republie jamais d'annonce. Inclus dans Pro (essentiel) et Agence (complet).">
        <UsageMeter label="Scans de niche" counter={u.track.scans} hint="Par mois." />
        <UsageMeter label="Recherches par photo" counter={u.track.photoSearches} hint="Par mois." />
        <UsageMeter label="Filtres suivis" counter={u.track.filtersFollowed} hint="Relus toutes les 2 h." planned />
      </Section>

      <Section title="Selio Cloud" tag={<Tag>En développement</Tag>} description={u.cloud.included ? "Inclus dans votre offre : vos automatisations tournent quand votre ordinateur est éteint." : "En option pour Starter et Pro, inclus dans Agence."}>
        <UsageMeter label="Actions Cloud aujourd'hui" counter={u.cloud.actions} hint="Plafond par jour, au rythme humain." excludedHint="Plafond par jour de votre offre" />
      </Section>

      <Card>
        <h2 className="text-md font-semibold">Activité du mois</h2>
        <p className="text-sm text-text-muted">Sans quota : pour information.</p>
        <DescriptionList className="mt-4" columns={2} items={[
          { label: "Actions automatiques", value: formatNumber(u.automationActions), numeric: true },
          { label: "Synchronisations", value: formatNumber(u.connectorSyncs), numeric: true },
          { label: "Exports CSV", value: formatNumber(u.exports), numeric: true },
          { label: "Captures de l'extension", value: formatNumber(u.extensionCaptures), numeric: true },
        ]} />
      </Card>
    </div>
  );
}
