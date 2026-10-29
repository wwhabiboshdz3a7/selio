import type { ReactNode } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Mail } from "lucide-react";
import { CLOUD_ACCOUNT_STATUS_LABELS, CLOUD_ACTION_STATUS_LABELS, CLOUD_PAUSE_REASON_LABELS, CLOUD_RUN_CODE_LABELS, CLOUD_SKIP_REASON_LABELS, isVintedPauseReason, type CloudAccount, type CloudAction, type CloudActionStatus, type CloudAvailability, type CloudSkipReason, type MarketplaceConnection } from "@selio/contracts";
import { can } from "@selio/domain";
import { Alert, Button, StatusBadge, buttonClass, formatDateTime, type StatusTone } from "@selio/ui";
import { useClient, useData, useRequiredSession } from "../../../lib/data/provider";
import { cloudOfferKind } from "../../../lib/cloud/availability";
import type { CloudAccountView } from "../../../lib/data/types";
import { useAppMutation } from "../../components/hooks";

/** Clés de cache de l'espace Cloud (invalidées après chaque action). */
export const CLOUD_KEYS = ["cloud-availability", "cloud-consent", "cloud-accounts", "cloud-journal", "usage"];

export function useCloudAvailability() {
  const client = useClient();
  return useQuery({ queryKey: ["cloud-availability"], queryFn: () => client.cloudAvailability() });
}
export function useCloudConsent() {
  const client = useClient();
  return useQuery({ queryKey: ["cloud-consent"], queryFn: () => client.cloudConsent() });
}
export function useCloudAccounts() {
  const client = useClient();
  return useQuery({ queryKey: ["cloud-accounts"], queryFn: () => client.cloudAccounts() });
}

/** Droit de gérer le Cloud (accepter l'accord, relier, mettre en pause…) : administrateur ou propriétaire. */
export function useCanManageCloud(): boolean {
  const session = useRequiredSession();
  return can(session.role, "cloud.manage");
}

/** État d'une connexion Vinted vis-à-vis du Cloud, du point de vue du client. */
export type CloudLinkState = "unlinked" | "needs_login" | "active" | "paused" | "stopped";

export const CLOUD_LINK_LABELS: Record<CloudLinkState, string> = {
  unlinked: "Non relié",
  needs_login: "À connecter",
  active: CLOUD_ACCOUNT_STATUS_LABELS.active,
  paused: CLOUD_ACCOUNT_STATUS_LABELS.paused,
  stopped: CLOUD_ACCOUNT_STATUS_LABELS.stopped,
};

const LINK_TONE: Record<CloudLinkState, StatusTone> = { unlinked: "muted", needs_login: "warning", active: "success", paused: "warning", stopped: "muted" };

export function linkStateOf(account: Pick<CloudAccount, "status"> | null | undefined): CloudLinkState {
  return account ? account.status : "unlinked";
}

export function CloudStatusBadge({ account }: { account: Pick<CloudAccount, "status" | "pausedReason"> | null | undefined }) {
  const state = linkStateOf(account);
  const tone: StatusTone = state === "paused" && isVintedPauseReason(account?.pausedReason) ? "danger" : LINK_TONE[state];
  return <StatusBadge tone={tone}>{CLOUD_LINK_LABELS[state]}</StatusBadge>;
}

/** Raison lisible d'une pause, avec sa date. */
export function pauseReasonText(account: Pick<CloudAccount, "pausedReason" | "pausedAt">): string | null {
  if (!account.pausedReason) return null;
  const label = CLOUD_PAUSE_REASON_LABELS[account.pausedReason];
  return account.pausedAt ? `${label} — le ${formatDateTime(account.pausedAt)}` : label;
}

export const handleOf = (c: Pick<MarketplaceConnection, "config">): string | null => (typeof c.config.displayHandle === "string" && c.config.displayHandle ? c.config.displayHandle : null);

/** Nom affiché d'un compte Cloud : libellé interne et pseudo Vinted. */
export function accountName(a: Pick<CloudAccountView, "connectionLabel" | "displayHandle">): string {
  return a.displayHandle ? `${a.connectionLabel} (@${a.displayHandle})` : a.connectionLabel;
}

/**
 * Disponibilité selon l'offre : Agence → compris (rien à afficher ici) ; Pro → « en option, prix à
 * décider » avec un bouton de contact, rien d'activable ; accès de base et Starter → « disponible à
 * partir de Pro ». En démonstration, un opérateur peut passer l'organisation en Agence pour essayer.
 */
export function CloudOfferNotice({ availability, className = "mb-6" }: { availability: CloudAvailability; className?: string }) {
  const kind = cloudOfferKind(availability);
  if (kind === "included") return null;
  const contact = (
    <Link to="/contact?sujet=selio-cloud" className={buttonClass({ variant: "secondary", size: "sm" })}>
      <Mail aria-hidden /> Nous contacter
    </Link>
  );
  if (kind === "option_open") {
    return (
      <Alert tone="info" className={className} title="Selio Cloud en option avec Pro — prix à décider">
        {availability.reason} Le prix sera annoncé avant toute facturation.
      </Alert>
    );
  }
  if (kind === "option_pending") {
    return (
      <Alert tone="info" className={className} title="En option avec Pro, prix à décider" action={contact}>
        {availability.reason} Rien n'est activable ni facturé pour l'instant : écrivez-nous si l'option vous intéresse.
        <DemoAgencyTrial />
      </Alert>
    );
  }
  return (
    <Alert tone="info" className={className} title="Disponible à partir de Pro" action={<Link to="/app/settings/billing" className={buttonClass({ variant: "secondary", size: "sm" })}>Voir les offres</Link>}>
      {availability.reason}
      <DemoAgencyTrial />
    </Alert>
  );
}

/** Démonstration seulement : l'opérateur bascule l'organisation fictive en Agence (paiement non concerné). */
function DemoAgencyTrial() {
  const { mode, client } = useData();
  const session = useRequiredSession();
  const toAgence = useAppMutation(() => client.adminSetPlan(session.org.id, "agence"), { invalidate: [...CLOUD_KEYS, "subscription", "admin-overview"], success: "Démonstration : organisation passée en offre Agence" });
  if (mode !== "demo" || !session.user.isOperator) return null;
  return (
    <span className="mt-2 flex flex-wrap items-center gap-2">
      <Button size="sm" variant="ghost" onClick={() => toAgence.mutate(undefined)} loading={toAgence.isPending}>Essayer avec l'offre Agence (démonstration)</Button>
    </span>
  );
}

/** Rappel de l'accord : sans accord enregistré pour la version courante, aucune action Cloud. */
export function ConsentRequired({ hadPrevious, className = "mb-6" }: { hadPrevious: boolean; className?: string }) {
  return (
    <Alert
      tone="warning"
      className={className}
      title={hadPrevious ? "Le texte de l'accord a changé" : "Accord à donner avant toute action"}
      action={<Link to="/cloud/accord" className={buttonClass({ variant: "secondary", size: "sm" })}>Lire l'accord <ArrowRight aria-hidden /></Link>}
    >
      {hadPrevious
        ? "Relisez la nouvelle version et acceptez-la : en attendant, Selio Cloud ne fait aucune action."
        : "Lisez les risques et acceptez les conditions : tant que l'accord n'est pas enregistré, Selio Cloud ne fait aucune action."}
    </Alert>
  );
}

/** Mode connecté : le Cloud n'est pas activé sur ce serveur (CLOUD_ENABLED) — rien ne s'exécute. */
export function ServerOffNotice({ className = "mb-4" }: { className?: string }) {
  return (
    <Alert tone="info" className={className} title="Selio Cloud n'est pas encore activé sur ce serveur">
      La fenêtre de connexion est indisponible et aucune action n'est lancée. Vos réglages, l'accord et le journal restent consultables.
    </Alert>
  );
}

/** Note de bas de page commune : indépendance vis-à-vis de Vinted, sans promesse de « zéro risque ». */
export function CloudFootnote({ children }: { children?: ReactNode }) {
  return (
    <p className="mt-8 border-t border-border pt-4 text-xs text-text-muted">
      {children}
      {children ? " " : null}
      Selio est un outil indépendant de Vinted : ni affilié, ni approuvé, ni sponsorisé par Vinted. Aucun mot de passe Vinted n'est enregistré ; aucun CAPTCHA n'est contourné.
    </p>
  );
}

const ACTION_TONE: Record<CloudActionStatus, StatusTone> = { queued: "neutral", running: "accent", done: "success", failed: "danger", skipped: "muted", paused: "warning" };

export function CloudActionStatusBadge({ status }: { status: CloudActionStatus }) {
  return <StatusBadge tone={ACTION_TONE[status]}>{CLOUD_ACTION_STATUS_LABELS[status]}</StatusBadge>;
}

/** Résultat lisible d'une action du journal : code de l'exécution, ou raison d'une tâche écartée. */
export function actionResult(a: Pick<CloudAction, "detail">): string {
  const d = a.detail;
  if (d.code && d.code !== "ok") return d.message ? `${CLOUD_RUN_CODE_LABELS[d.code]} — ${d.message}` : CLOUD_RUN_CODE_LABELS[d.code];
  if (d.code === "ok") return CLOUD_RUN_CODE_LABELS.ok;
  if (d.reason) return CLOUD_SKIP_REASON_LABELS[d.reason as CloudSkipReason] ?? d.reason;
  return d.message ?? "—";
}

/** Durée d'une action en secondes, à la française (« 42,3 s »). */
export function actionDuration(a: Pick<CloudAction, "detail">): string {
  return typeof a.detail.durationMs === "number" ? `${(a.detail.durationMs / 1000).toFixed(1).replace(".", ",")} s` : "—";
}
