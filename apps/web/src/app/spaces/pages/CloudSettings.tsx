import { Link } from "react-router";
import { Clock, Gauge, ShieldCheck } from "lucide-react";
import { CLOUD_ACTIVE_HOURS_DEFAULT, CLOUD_JITTER_MAX_MINUTES, CLOUD_JOB_MAX_AGE_HOURS, CLOUD_JOURNAL_RETENTION_DAYS, CLOUD_LOGIN_TTL_MINUTES, CLOUD_MAX_ACCOUNTS_PER_ORG_DEFAULT, CLOUD_MAX_ACTIONS_PER_HOUR, CLOUD_MIN_MINUTES_BETWEEN_ACTIONS, PLAN_LABELS, isPlan } from "@selio/contracts";
import { Alert, Card, DescriptionList, ErrorState, PageHeader, SkeletonRows, StatStrip, Tag, formatNumber } from "@selio/ui";
import { useRequiredSession } from "../../../lib/data/provider";
import { errorMessage } from "../../../lib/errors";
import { CloudFootnote, CloudOfferNotice, useCloudAvailability } from "../cloud/shared";

const DAY_NAMES = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

/** Jours actifs en clair : « tous les jours » ou la liste. */
function daysText(days: number[]): string {
  if (days.length === 7) return "Tous les jours";
  return days.map((d) => DAY_NAMES[d]).join(", ");
}

/** Réglages du Cloud, en lecture : heures actives, rythme, plafonds de l'offre, capacité (hypothèse à mesurer). */
export default function CloudSettings() {
  const session = useRequiredSession();
  const availability = useCloudAvailability();
  const timezone = session.org.settings.timezone || CLOUD_ACTIVE_HOURS_DEFAULT.timezone;
  const av = availability.data;
  // Heures appliquées par le serveur (CLOUD_ACTIVE_HOURS) si elles sont connues, sinon celles des contrats.
  const hours = { ...CLOUD_ACTIVE_HOURS_DEFAULT, ...(av?.activeHours ?? {}) };

  return (
    <>
      <PageHeader eyebrow="Selio Cloud" title="Réglages" description="Ce qui borne le Cloud : heures, rythme et plafonds. Ces réglages sont fixés par Selio au lancement ; ils se lisent ici." />
      {av ? <CloudOfferNotice availability={av} className="mb-4" /> : null}

      {availability.isPending ? <SkeletonRows rows={2} className="mb-6" /> : availability.isError ? <ErrorState className="mb-6" description={errorMessage(availability.error)} onRetry={() => void availability.refetch()} /> : (
        <StatStrip
          className="mb-6 grid-cols-2 lg:grid-cols-4"
          items={[
            { label: "Offre", value: isPlan(av!.plan) ? PLAN_LABELS[av!.plan] : av!.plan, sub: av!.included ? "Cloud compris" : av!.optional ? "Cloud en option, prix à décider" : "Cloud à partir de Pro" },
            { label: "Actions par jour", value: formatNumber(av!.actionsPerDay), sub: "plafond de l'offre, tous comptes" },
            { label: "Comptes Cloud", value: formatNumber(av!.available ? av!.maxAccounts : CLOUD_MAX_ACCOUNTS_PER_ORG_DEFAULT), sub: "10 au plus par organisation" },
            { label: "Navigateurs simultanés", value: formatNumber(av!.maxBrowsers), sub: "limite prudente, sur toute la machine" },
          ]}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="flex items-center gap-2 text-md font-semibold text-text"><Clock className="size-4 text-text-muted" aria-hidden />Heures actives</h2>
          <p className="mt-1 text-sm text-text-muted">Le Cloud n'agit jamais la nuit. Une tâche qui attend depuis plus de {CLOUD_JOB_MAX_AGE_HOURS} h est ignorée plutôt qu'exécutée en retard.</p>
          <DescriptionList
            className="mt-4"
            items={[
              { label: "Jours", value: daysText(hours.days) },
              { label: "Heures", value: <span className="num">{hours.startHour} h – {hours.endHour} h</span> },
              { label: "Fuseau", value: timezone },
            ]}
          />
          <p className="mt-3 text-xs text-text-muted"><Tag className="mr-1.5">Lecture seule</Tag>Réglage fixé par Selio au lancement.</p>
        </Card>
        <Card>
          <h2 className="flex items-center gap-2 text-md font-semibold text-text"><Gauge className="size-4 text-text-muted" aria-hidden />Rythme humain</h2>
          <p className="mt-1 text-sm text-text-muted">Un navigateur neuf est ouvert pour chaque action, puis refermé : aucun processus permanent par compte.</p>
          <DescriptionList
            className="mt-4"
            items={[
              { label: "Par compte", value: <span className="num">{CLOUD_MAX_ACTIONS_PER_HOUR} actions par heure au plus</span> },
              { label: "Entre deux actions", value: <span className="num">au moins {CLOUD_MIN_MINUTES_BETWEEN_ACTIONS} min, plus jusqu'à {CLOUD_JITTER_MAX_MINUTES} min au hasard</span> },
              { label: "Fenêtre de connexion", value: <span className="num">{CLOUD_LOGIN_TTL_MINUTES} min, puis fermée</span> },
              { label: "Journal", value: <span className="num">gardé {CLOUD_JOURNAL_RETENTION_DAYS} jours</span> },
            ]}
          />
        </Card>
        <Card>
          <h2 className="flex items-center gap-2 text-md font-semibold text-text"><ShieldCheck className="size-4 text-text-muted" aria-hidden />Actions autorisées</h2>
          <DescriptionList
            className="mt-4"
            items={[
              { label: "Actions légères", value: "Ouvertes : répondre à un message, relancer après 24 h" },
              { label: "Actions lourdes", value: av?.heavyActionsEnabled ? "Ouvertes par le réglage serveur" : <span className="inline-flex flex-wrap items-center gap-1.5">Fermées <Tag>À décider : adresse partagée</Tag></span> },
              { label: "Signal de Vinted", value: "Pause du compte, vous êtes prévenu, rien n'est retenté" },
            ]}
          />
          <p className="mt-3 text-xs text-text-muted">Niveaux par compte dans <Link to="/cloud/comptes" className="font-medium text-accent hover:underline">Comptes Cloud</Link>.</p>
        </Card>
        <Card>
          <h2 className="text-md font-semibold text-text">Capacité de la machine</h2>
          <Alert tone="info" className="mt-3" title="Hypothèse à mesurer">
            <span data-testid="cloud-capacity-note">{av?.capacityNote ?? "Capacité visée : 50 navigateurs ouverts en même temps. C'est une hypothèse à mesurer, aucun chiffre n'est mesuré à ce jour."}</span>
          </Alert>
          <p className="mt-3 text-xs text-text-muted">Les chiffres définitifs seront publiés après une mesure sur la machine de production.</p>
        </Card>
      </div>
      <CloudFootnote />
    </>
  );
}
