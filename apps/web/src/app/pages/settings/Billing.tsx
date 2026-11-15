import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CreditCard, Receipt } from "lucide-react";
import { CHARGE_RETRY_DELAYS_DAYS, DATA_RETENTION_DAYS_AFTER_END, PLAN_LABELS, SUBSCRIPTION_STATUS_LABELS, TRIAL_DAYS, type BillingCycle, type PaidPlan, type Subscription } from "@selio/contracts";
import { can } from "@selio/domain";
import { Alert, Button, Card, ConfirmDialog, DescriptionList, Segmented, StatusBadge, Tag, buttonClass, formatCents, formatDate } from "@selio/ui";
import { PLAN_OFFERS, TRIAL_OFFER, planOffer } from "@selio/demo-data";
import { useClient, useData, useRequiredSession } from "../../../lib/data/provider";
import type { CheckoutOutcome, UsageSummary } from "../../../lib/data/types";
import { showIndicativePricing } from "../../../lib/env";
import { CYCLE_LABELS, FREE_MONTHS, daysLeft, inTrial, isRunning, planPriceCents } from "../../../lib/billing";
import { WIDGET_LOAD_ERROR, payWithRevolutPopup } from "../../../lib/payments/revolut";
import { QueryBoundary } from "../../components/common";
import { useAppMutation } from "../../components/hooks";
import { UsageMeter } from "../../components/usage";
import { DiscountedPrice, OfferHint, useOfferBanner } from "../../components/offers";
import { discountedFor, offerConditionLabel } from "../../../lib/offers";
import { offerDiscountLabel, offerPlansLabel, redemptionDiscountFor, type OfferRedemption } from "@selio/contracts";
import { isGrantWithoutEnd } from "@selio/contracts";
import { Dialog, Field, Input } from "@selio/ui";
import { SIMULATED_PAYMENT_NOTICE } from "@selio/contracts";
import { usePaymentSimulated } from "../../../lib/capabilities";

const STATUS_TONE: Record<Subscription["status"], "success" | "accent" | "danger" | "muted"> = { none: "muted", trialing: "accent", active: "success", past_due: "danger", canceled: "muted", incomplete: "danger" };
const PROVIDER_LABELS: Record<Subscription["provider"], string> = { none: "Aucun paiement enregistré", revolut: "Revolut (carte, Apple Pay, Google Pay, Revolut Pay)" };
/** Rafraîchissement pendant l'attente du webhook : toutes les 5 s pendant 1 minute. */
export const CONFIRMATION_POLL_MS = 5_000;
export const CONFIRMATION_TIMEOUT_MS = 60_000;
/** Tentatives sur une échéance : le débit à l'échéance puis les relances. */
const MAX_ATTEMPTS = CHARGE_RETRY_DELAYS_DAYS.length + 1;

type Notice = { tone: "info" | "success" | "warning" | "danger"; text: string };
/** Ce que le formulaire Revolut vient de faire : carte pendant l'essai, paiement, ou changement de carte. */
type ConfirmPurpose = "trial" | "payment" | "card";
const CONFIRMED_TEXT: Record<ConfirmPurpose, string> = {
  trial: "Carte enregistrée : rien n'est débité avant la fin de l'essai.",
  payment: "Paiement confirmé : votre période est ouverte, la facture est disponible.",
  card: "Nouvelle carte enregistrée : elle servira aux prochains débits (l'autorisation de vérification est annulée, rien n'est débité).",
};
const CONFIRMING_TEXT: Record<ConfirmPurpose, string> = {
  trial: "Revolut nous confirme l'enregistrement de votre carte dans quelques secondes (rien n'est débité pendant l'essai). Cette page se met à jour toute seule.",
  payment: "Revolut nous confirme le paiement dans quelques secondes. Cette page se met à jour toute seule ; la facture apparaîtra dans Factures.",
  card: "Revolut nous confirme votre nouvelle carte dans quelques secondes (l'autorisation de vérification est annulée aussitôt, rien n'est débité). Cette page se met à jour toute seule.",
};

/** Ce qui change quand Revolut confirme (carte enregistrée, période ouverte, offre retenue). */
function fingerprint(s: Subscription): string {
  return [s.status, s.plan, s.cardOnFile, s.paymentMethodId, s.currentPeriodEnd, s.pendingPlan, s.updatedAt].join("|");
}

/**
 * Libellé du bouton d'une offre selon l'état : enregistrer la carte pendant l'essai, choisir l'offre
 * retenue quand la carte est déjà là, payer hors essai, ou changer d'offre au prochain renouvellement.
 */
export function offerAction(s: Subscription, plan: PaidPlan, now = new Date(), simulated = false): { kind: "current" | "pending" | "button"; label: string } {
  const trial = inTrial(s, now);
  // Paiement simulé : on choisit son offre, sans carte (aucun « Payer » ni « Enregistrer ma carte »).
  if (simulated) {
    if (s.pendingPlan === plan && isRunning(s)) return { kind: "pending", label: "Offre retenue" };
    if ((s.status === "active" || s.status === "past_due") && s.plan === plan && !s.pendingPlan) return { kind: "current", label: "Offre actuelle" };
    return { kind: "button", label: "Choisir cette offre" };
  }
  const cardReady = s.cardOnFile && !!s.paymentMethodId && s.provider === "revolut";
  if (s.pendingPlan === plan && isRunning(s)) return { kind: "pending", label: trial ? "Offre retenue" : "Au prochain renouvellement" };
  if ((s.status === "active" || s.status === "past_due") && s.plan === plan && !s.pendingPlan) return { kind: "current", label: "Offre actuelle" };
  if (trial) return { kind: "button", label: cardReady ? "Choisir cette offre" : "Enregistrer ma carte" };
  if (cardReady && (s.status === "active" || s.status === "past_due")) return { kind: "button", label: "Changer d'offre" };
  return { kind: "button", label: "Payer" };
}

export default function Billing() {
  const client = useClient();
  const session = useRequiredSession();
  const { mode } = useData();
  const qc = useQueryClient();
  const sub = useQuery({ queryKey: ["subscription"], queryFn: () => client.getSubscription() });
  const usage = useQuery({ queryKey: ["usage"], queryFn: () => client.getUsage() });
  // Offre commerciale : celle appliquée à l'organisation (code promo), sinon l'offre publique du bandeau.
  const orgOffer = useQuery({ queryKey: ["org-offer"], queryFn: () => client.getOrgOffer() });
  const publicOffers = useOfferBanner("app").data;
  const manage = can(session.role, "billing.manage");
  // Revolut pas encore configuré : parcours sans carte (récapitulatif puis confirmation), aucun débit.
  const simulated = usePaymentSimulated();
  const [recap, setRecap] = useState<PaidPlan | null>(null);
  const [cycleChoice, setCycleChoice] = useState<BillingCycle | null>(null);
  const cycle: BillingCycle = cycleChoice ?? sub.data?.cycle ?? "monthly";
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirming, setConfirming] = useState<{ snapshot: string; purpose: ConfirmPurpose; since: number; timedOut: boolean } | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const widget = useRef<{ destroy: () => void } | null>(null);

  // Attente du webhook : rafraîchir l'abonnement toutes les 5 s pendant 1 minute, puis le dire.
  useEffect(() => {
    if (!confirming || confirming.timedOut) return;
    const tick = setInterval(() => void qc.invalidateQueries({ queryKey: ["subscription"] }), CONFIRMATION_POLL_MS);
    const stop = setTimeout(() => setConfirming((c) => (c ? { ...c, timedOut: true } : c)), CONFIRMATION_TIMEOUT_MS);
    return () => {
      clearInterval(tick);
      clearTimeout(stop);
    };
  }, [confirming, qc]);
  useEffect(() => {
    if (!confirming || !sub.data || fingerprint(sub.data) === confirming.snapshot) return;
    setConfirming(null);
    setNotice({ tone: "success", text: CONFIRMED_TEXT[confirming.purpose] });
    void qc.invalidateQueries({ queryKey: ["usage"] });
    void qc.invalidateQueries({ queryKey: ["invoices"] });
  }, [sub.data, confirming, qc]);
  useEffect(() => () => widget.current?.destroy(), []);

  const openWidget = async (r: CheckoutOutcome & { orderToken: string }, purpose: ConfirmPurpose) => {
    const snapshot = sub.data ? fingerprint(sub.data) : "";
    try {
      widget.current = await payWithRevolutPopup({ token: r.orderToken, mode: r.mode, email: session.user.email, name: session.user.displayName }, {
        onSuccess: () => {
          setNotice(null);
          setConfirming({ snapshot, purpose, since: Date.now(), timedOut: false });
          void qc.invalidateQueries({ queryKey: ["subscription"] });
        },
        onError: (message) => {
          setNotice({ tone: "danger", text: message });
          void qc.invalidateQueries({ queryKey: ["subscription"] });
        },
        onCancel: () => setNotice({ tone: "info", text: "Paiement annulé : rien n'a été débité." }),
      });
    } catch {
      setNotice({ tone: "danger", text: WIDGET_LOAD_ERROR });
    }
  };

  const checkout = useAppMutation((plan: PaidPlan) => client.startCheckout(plan, { cycle }), {
    invalidate: ["subscription"],
    onSuccess: (r) => {
      setRecap(null);
      if (r.simulated && mode === "connected") {
        setNotice({ tone: "success", text: r.message });
      } else if (r.orderToken) {
        setNotice({ tone: "info", text: r.message });
        void openWidget({ ...r, orderToken: r.orderToken }, sub.data && inTrial(sub.data) ? "trial" : "payment");
      } else {
        setNotice({ tone: r.simulated ? "warning" : r.mode === null ? "warning" : "info", text: r.message });
      }
    },
  });
  // Changement de carte sans paiement : même formulaire Revolut, autorisation de vérification annulée dès la carte enregistrée.
  const cardUpdate = useAppMutation(() => client.startCardUpdate(), {
    invalidate: ["subscription"],
    onSuccess: (r) => {
      if (r.orderToken) {
        setNotice({ tone: "info", text: r.message });
        void openWidget({ ...r, orderToken: r.orderToken }, "card");
      } else {
        setNotice({ tone: r.simulated ? "warning" : r.mode === null ? "warning" : "info", text: r.message });
      }
    },
  });
  const cancel = useAppMutation(() => client.cancelSubscription(), { invalidate: ["subscription"], success: "Résiliation enregistrée", onSuccess: () => setCancelOpen(false) });
  const reactivate = useAppMutation(() => client.reactivateSubscription(), { invalidate: ["subscription"], success: "Abonnement repris" });

  const s = sub.data;
  const cardReady = !!s && s.cardOnFile && !!s.paymentMethodId && s.provider === "revolut" && isRunning(s);
  const periodEnd = s?.currentPeriodEnd ?? null;

  return (
    <div className="flex flex-col gap-4">
      <QueryBoundary query={sub} skeleton="spinner">
        {(sx) => <OfferCard s={sx} simulated={simulated} manage={manage} onCancel={() => setCancelOpen(true)} onReactivate={() => reactivate.mutate(undefined)} reactivating={reactivate.isPending} onCardUpdate={() => cardUpdate.mutate(undefined)} cardUpdating={cardUpdate.isPending} />}
      </QueryBoundary>

      {confirming ? (
        <Alert tone={confirming.timedOut ? "warning" : "info"} title={confirming.purpose === "payment" ? "Paiement en cours de confirmation" : "Carte en cours de confirmation"} action={confirming.timedOut ? <Button size="sm" variant="secondary" onClick={() => void sub.refetch()}>Vérifier maintenant</Button> : null}>
          {confirming.timedOut
            ? "La confirmation prend plus de temps que prévu. Elle arrive par Revolut (webhook) : vérifiez de nouveau dans un instant, rien ne sera débité deux fois."
            : CONFIRMING_TEXT[confirming.purpose]}
        </Alert>
      ) : null}
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}

      <QueryBoundary query={usage} skeleton="spinner">
        {(u) => <CapacityCard u={u} />}
      </QueryBoundary>

      <PromoCard redemption={orgOffer.data ?? null} loading={orgOffer.isLoading} manage={manage} />

      <Card padding="none">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4 md:px-5">
          <h2 className="text-md font-semibold">{s && isRunning(s) && s.status !== "trialing" ? "Changer d'offre" : "Choisir une offre"}</h2>
          <Link to="/tarifs" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">Comparer les offres <ArrowRight className="size-3.5" aria-hidden /></Link>
        </div>
        <p className="px-4 text-sm text-text-muted md:px-5">
          Starter, Pro ou Agence, au mois sans engagement ou à l'année avec {FREE_MONTHS} mois offerts.{" "}
          {simulated
            ? "Paiement pas encore activé : vous choisissez votre offre sans carte, rien n'est débité."
            : s && inTrial(s) ? `Pendant l'essai, la carte est enregistrée et rien n'est débité avant le ${periodEnd ? formatDate(periodEnd) : "terme"}.` : "Un changement d'offre s'applique au prochain renouvellement."}
          {showIndicativePricing ? " Montants indicatifs." : ""}
        </p>
        <div className="flex flex-wrap items-center gap-3 px-4 pt-3 md:px-5">
          {cardReady ? (
            <p className="text-sm text-text-muted">Périodicité : <span className="font-medium text-text">{cycle === "yearly" ? "annuelle" : "mensuelle"}</span> (fixée avec la carte enregistrée).</p>
          ) : (
            <Segmented ariaLabel="Périodicité" value={cycle} onChange={setCycleChoice} items={[{ value: "monthly", label: "Mensuel" }, { value: "yearly", label: `Annuel · ${FREE_MONTHS} mois offerts` }]} />
          )}
          {mode === "demo" ? <p className="text-xs text-text-muted">Démonstration : le paiement est simulé, aucun formulaire ne s'ouvre.</p> : null}
        </div>
        <ul className="mt-3 divide-y divide-border border-t border-border">
          {PLAN_OFFERS.map((p) => {
            const action = s ? offerAction(s, p.key, new Date(), simulated) : null;
            const price = planPriceCents(p.key, cycle);
            // Prix remisé : l'offre de l'organisation d'abord (code appliqué), sinon l'offre publique en cours.
            const own = orgOffer.data ? redemptionDiscountFor(orgOffer.data, p.key, cycle, price) : null;
            const pub = own || orgOffer.data ? null : discountedFor(publicOffers, p.key, price);
            const discounted = own ? price - own.discountCents : pub?.cents ?? null;
            const hint = own ? `Votre offre « ${orgOffer.data!.name} »` : pub ? offerConditionLabel(pub.offer, cycle) : null;
            return (
              <li key={p.key} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center md:px-5">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-base font-semibold text-text">{p.name}<span className="text-sm font-normal text-accent">{p.profile}</span></p>
                  <p className="mt-0.5 text-sm text-text-muted">{p.highlights.join(" · ")}</p>
                </div>
                <p className="num shrink-0 text-sm text-text sm:text-right">
                  {showIndicativePricing ? (
                    <>
                      {discounted !== null ? <DiscountedPrice normalCents={price} discountedCents={discounted} className="sm:justify-end" /> : formatCents(price)}<span className="text-text-muted"> / {cycle === "yearly" ? "an" : "mois"}</span>
                      {discounted !== null && hint ? <OfferHint text={hint} title={pub?.offer.name} /> : null}
                      {cycle === "yearly" ? <span className="block text-xs text-text-muted">soit {formatCents(Math.round(price / 12))} par mois</span> : null}
                    </>
                  ) : "À définir"}
                </p>
                <div className="shrink-0 sm:w-40 sm:text-right">
                  {!manage || !action ? null : action.kind === "button" ? (
                    <Button size="sm" variant={action.label === "Enregistrer ma carte" || action.label === "Payer" ? "accent" : "secondary"} onClick={() => (simulated ? setRecap(p.key) : checkout.mutate(p.key))} loading={checkout.isPending && checkout.variables === p.key} disabled={checkout.isPending}>{action.label}</Button>
                  ) : (
                    <Tag accent>{action.label}</Tag>
                  )}
                </div>
              </li>
            );
          })}
          <li className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center md:px-5">
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-text">Plus de 10 comptes Vinted</p>
              <p className="mt-0.5 text-sm text-text-muted">Sur devis : aucun compte supplémentaire à la carte, au-delà de l'offre Agence nous construisons l'offre avec vous.</p>
            </div>
            <p className="num shrink-0 text-sm text-text-muted">Sur devis</p>
            <div className="shrink-0 sm:w-40 sm:text-right"><Link to="/contact" className={buttonClass({ variant: "secondary", size: "sm" })}>Nous écrire</Link></div>
          </li>
        </ul>
        {!manage ? <p className="border-t border-border px-4 py-3 text-xs text-text-muted md:px-5">Seul le propriétaire peut choisir une offre, enregistrer une carte ou résilier.</p> : null}
      </Card>

      {simulated
        ? <Alert tone="info" title="Paiement pas encore activé">{SIMULATED_PAYMENT_NOTICE} Le paiement en ligne (Revolut) sera ouvert prochainement : vous serez alors invité à enregistrer votre carte avant la fin de votre essai.</Alert>
        : <Alert tone="info">Paiement sécurisé par Revolut : le numéro de carte est saisi dans le formulaire Revolut et ne transite jamais par Selio. Les confirmations (webhooks) sont vérifiées et idempotentes ; les frais du prestataire ne vous sont pas refacturés.</Alert>}

      {recap ? <SimulatedCheckoutDialog plan={recap} cycle={cycle} onClose={() => setRecap(null)} onConfirm={() => checkout.mutate(recap)} confirming={checkout.isPending} /> : null}

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={() => cancel.mutate(undefined)}
        loading={cancel.isPending}
        danger
        title="Résilier l'abonnement ?"
        confirmLabel="Confirmer la résiliation"
        cancelLabel="Garder mon abonnement"
        description={
          periodEnd
            ? `Votre accès continue jusqu'au ${formatDate(periodEnd, "long")} (${daysLeft(periodEnd)} jour${daysLeft(periodEnd) > 1 ? "s" : ""}), sans nouveau débit. Ensuite, accès de base ; vos données sont conservées ${DATA_RETENTION_DAYS_AFTER_END} jours et vous pouvez reprendre à tout moment.`
            : `Aucun nouveau débit. Ensuite, accès de base ; vos données sont conservées ${DATA_RETENTION_DAYS_AFTER_END} jours.`
        }
      />
    </div>
  );
}

/**
 * Paiement simulé : récapitulatif clair (forfait, prix, remise, première échéance, fin de l'essai) puis confirmation.
 * Ce n'est PAS un formulaire de carte : aucun numéro, aucune date, aucun code n'est demandé.
 */
export function SimulatedCheckoutDialog({ plan, cycle, onClose, onConfirm, confirming }: { plan: PaidPlan; cycle: BillingCycle; onClose: () => void; onConfirm: () => void; confirming: boolean }) {
  const client = useClient();
  const preview = useQuery({ queryKey: ["checkout-preview", plan, cycle], queryFn: () => client.previewCheckout(plan, { cycle }), staleTime: 0 });
  const p = preview.data;
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Confirmer l'offre ${PLAN_LABELS[plan]}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={confirming}>Annuler</Button>
          <Button variant="accent" onClick={onConfirm} loading={confirming} disabled={!p || p.blockedReason !== null} data-testid="simulated-confirm">Confirmer sans carte</Button>
        </>
      }
    >
      <div data-testid="simulated-checkout" className="flex flex-col gap-4">
        <Alert tone="warning" title="Paiement pas encore activé">Aucune carte demandée, rien ne sera débité.</Alert>
        <QueryBoundary query={preview} skeleton="spinner">
          {(x) => (
            <>
              <DescriptionList columns={2} items={[
                { label: "Forfait", value: x.planLabel },
                { label: "Périodicité", value: x.cycle === "yearly" ? "Annuelle" : "Mensuelle" },
                { label: "Prix", value: <span className="num">{formatCents(x.priceCents)} / {x.cycle === "yearly" ? "an" : "mois"}</span> },
                { label: "Remise", value: x.discount ? <span className="num">{x.discount.label} (−{formatCents(x.discount.amountCents)})</span> : "Aucune" },
                { label: "Première échéance", value: <span className="num">{formatCents(x.dueCents)}</span> },
                { label: "Fin de l'essai", value: x.trialEndsAt ? formatDate(x.trialEndsAt, "long") : "—" },
              ]} />
              <p className="text-sm text-text-muted">
                {x.startsTrial ? `Votre essai de ${TRIAL_DAYS} jours démarre maintenant, sans carte.` : "Votre essai continue, sans carte."} À la fin de l'essai, rien n'est débité : si le paiement en ligne n'est toujours pas ouvert, votre espace passe en accès de base en attendant, et l'équipe Selio vous recontacte.
              </p>
              {x.blockedReason ? <Alert tone="danger">{x.blockedReason}</Alert> : null}
            </>
          )}
        </QueryBoundary>
      </div>
    </Dialog>
  );
}

function OfferCard({ s, simulated, manage, onCancel, onReactivate, reactivating, onCardUpdate, cardUpdating }: { s: Subscription; simulated: boolean; manage: boolean; onCancel: () => void; onReactivate: () => void; reactivating: boolean; onCardUpdate: () => void; cardUpdating: boolean }) {
  const trial = s.status === "trialing";
  const left = s.currentPeriodEnd ? daysLeft(s.currentPeriodEnd) : null;
  const running = isRunning(s);
  const plural = (n: number | null) => (n !== null && n > 1 ? "s" : "");
  const nextPlan = s.pendingPlan && s.pendingPlan !== "free" ? PLAN_LABELS[s.pendingPlan] : null;
  // Changer de carte : abonnement en cours chez Revolut (carte expirée, plafond, retard de paiement) ; sinon le paiement enregistre la carte.
  const canChangeCard = manage && running && s.provider === "revolut" && s.cardOnFile;
  const changeCardButton = canChangeCard ? <Button size="sm" variant="secondary" onClick={onCardUpdate} loading={cardUpdating} data-testid="change-card">Changer de carte</Button> : null;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-md font-semibold">Votre offre</h2>
        <span className="flex flex-wrap gap-2">
          <Tag accent>{trial ? TRIAL_OFFER.name : PLAN_LABELS[s.plan]}</Tag>
          {s.provider === "revolut" && s.testMode ? <Tag>Bac à sable Revolut</Tag> : null}
          <StatusBadge tone={STATUS_TONE[s.status]}>{SUBSCRIPTION_STATUS_LABELS[s.status]}</StatusBadge>
        </span>
      </div>

      {trial ? (
        <div className="mt-4">
          <p className="text-base text-text">
            {left === null ? "Essai en cours" : left > 0 ? <><span className="num font-semibold">{left} jour{plural(left)}</span> d'essai restant{plural(left)}</> : "Période d'essai terminée"}
            {s.currentPeriodEnd ? <span className="text-text-muted"> · {left && left > 0 ? "jusqu'au" : "le"} {formatDate(s.currentPeriodEnd)}</span> : null}
          </p>
          <p className="mt-1 text-sm text-text-muted">
            Toutes les fonctions et les limites du plan {PLAN_LABELS[s.plan]} pendant {TRIAL_DAYS} jours.{" "}
            {simulated
              ? `Paiement pas encore activé : aucune carte n'est demandée.${nextPlan ? ` Offre retenue : ${nextPlan} (${CYCLE_LABELS[s.cycle]}).` : " Choisissez votre offre ci-dessous."} Rien ne sera débité à la fin de l'essai.`
              : s.cardOnFile
              ? `Votre carte est enregistrée : rien n'est débité avant la fin de l'essai, puis l'offre ${nextPlan ?? PLAN_LABELS[s.plan]} (${CYCLE_LABELS[s.cycle]}) démarre automatiquement.`
              : `Enregistrez votre carte avant la fin de l'essai pour garder l'accès : rien n'est débité avant le ${s.currentPeriodEnd ? formatDate(s.currentPeriodEnd) : "terme"}. Sans carte, l'espace repasse à l'accès de base.`}
          </p>
        </div>
      ) : (
        <p className="mt-4 text-sm text-text-muted">
          {s.awaitingPaymentSince && s.status === "canceled"
            ? `Essai terminé, en attente du paiement : votre espace est en accès de base depuis le ${formatDate(s.awaitingPaymentSince)}, rien n'a été débité.${nextPlan ? ` Offre retenue : ${nextPlan}.` : ""} L'équipe Selio vous recontacte pour la suite.`
            : s.status === "canceled"
            ? `Abonnement résilié : accès de base (une personne, un compte Vinted).${s.dataRetentionUntil ? ` Vos données sont conservées jusqu'au ${formatDate(s.dataRetentionUntil)} : choisissez une offre pour reprendre sans rien perdre.` : " Choisissez une offre ci-dessous pour reprendre."}`
            : s.plan === "free" ? "Aucun abonnement actif : une personne et un compte Vinted." : planOffer(s.plan)?.forWhom}
        </p>
      )}

      {s.status === "past_due" ? (
        <Alert tone="danger" className="mt-4" title="Le dernier paiement a échoué" action={changeCardButton}>
          {s.lastChargeError ? `${s.lastChargeError}. ` : ""}
          {s.nextChargeAt ? `Prochaine tentative le ${formatDate(s.nextChargeAt, "long")} (tentative ${Math.min(s.chargeAttempts + 1, MAX_ATTEMPTS)} sur ${MAX_ATTEMPTS}). ` : ""}
          Après l'échéance puis trois relances (J+{CHARGE_RETRY_DELAYS_DAYS.join(", J+")}), l'espace repasse à l'accès de base et vos données sont conservées {DATA_RETENTION_DAYS_AFTER_END} jours. La prochaine tentative utilise la carte enregistrée : vérifiez son plafond ou son solde auprès de votre banque, ou enregistrez une autre carte : le paiement est alors retenté dans l'heure, sans rien débiter de plus.
        </Alert>
      ) : null}

      {s.cancelAtPeriodEnd && running ? (
        <Alert tone="warning" className="mt-4" title="Résiliation enregistrée" action={manage ? <Button size="sm" variant="secondary" onClick={onReactivate} loading={reactivating}>Reprendre l'abonnement</Button> : null}>
          L'accès continue jusqu'au {s.currentPeriodEnd ? formatDate(s.currentPeriodEnd, "long") : "terme de la période"} sans nouveau débit, puis accès de base. Vos données sont conservées {DATA_RETENTION_DAYS_AFTER_END} jours.
        </Alert>
      ) : null}

      {s.grantedUntil ? (
        <Alert tone="success" className="mt-4" title="Accès offert par l'équipe Selio">
          Votre offre {PLAN_LABELS[s.plan]} vous est offerte {isGrantWithoutEnd(s.grantedUntil) ? "sans date de fin" : `jusqu'au ${formatDate(s.grantedUntil, "long")}`} : rien n'est débité. {isGrantWithoutEnd(s.grantedUntil) ? "" : "Ensuite, l'espace repasse à l'accès de base, sauf si vous choisissez une offre."}
        </Alert>
      ) : null}

      <DescriptionList className="mt-4" columns={2} items={[
        { label: "Paiement", value: s.grantedUntil ? "Aucun (accès offert)" : PROVIDER_LABELS[s.provider] },
        { label: "Carte bancaire", value: s.cardOnFile ? <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1"><span className="inline-flex items-center gap-1.5"><CreditCard className="size-4 text-text-muted" aria-hidden />Carte enregistrée</span>{s.status === "past_due" ? null : changeCardButton}</span> : "Aucune carte enregistrée" },
        { label: s.grantedUntil ? "Fin de l'accès offert" : trial ? "Fin de l'essai" : s.cancelAtPeriodEnd ? "Fin d'accès" : running ? "Prochaine échéance" : "Fin de période", value: s.grantedUntil ? (isGrantWithoutEnd(s.grantedUntil) ? "Sans fin" : formatDate(s.grantedUntil)) : s.currentPeriodEnd ? formatDate(s.currentPeriodEnd) : "—" },
        { label: "Renouvellement", value: s.grantedUntil ? "Aucun débit" : simulated ? "Aucun débit (paiement pas encore activé)" : s.cancelAtPeriodEnd ? "Résiliation à la fin de la période" : nextPlan && running ? `Passage à ${nextPlan} au prochain renouvellement` : trial ? (s.cardOnFile ? `Automatique à la fin de l'essai (${CYCLE_LABELS[s.cycle]})` : "Carte à enregistrer") : running ? `Automatique (${CYCLE_LABELS[s.cycle]})` : "—" },
      ]} />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <Link to="/app/settings/invoices" className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"><Receipt className="size-4" aria-hidden />Voir mes factures</Link>
        {manage && running && !s.cancelAtPeriodEnd && !s.grantedUntil ? <Button size="sm" variant="danger" onClick={onCancel}>Résilier</Button> : null}
      </div>
    </Card>
  );
}

/**
 * Code promo (offre commerciale) : l'offre appliquée (remise, forfaits, mois restants) ou « Ajouter un code
 * promo » pour le titulaire. Une seule offre par organisation ; le serveur vérifie tout et répond par un message.
 */
function PromoCard({ redemption, loading, manage }: { redemption: OfferRedemption | null; loading: boolean; manage: boolean }) {
  const client = useClient();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const apply = useAppMutation((c: string) => client.applyPromoCode({ code: c }), {
    invalidate: ["org-offer"],
    success: "Code promo enregistré",
    onSuccess: () => {
      setOpen(false);
      setCode("");
      setError(null);
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Code promo refusé."),
  });
  if (loading) return null;
  if (redemption) {
    const remaining = redemption.monthsRemaining === null ? "tant que l'abonnement dure" : redemption.monthsRemaining === 0 ? "remise terminée" : `encore ${redemption.monthsRemaining} échéance${redemption.monthsRemaining > 1 ? "s" : ""} mensuelle${redemption.monthsRemaining > 1 ? "s" : ""} remisée${redemption.monthsRemaining > 1 ? "s" : ""}`;
    return (
      <Card data-testid="promo-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-md font-semibold">Votre offre en cours</h2>
          <Tag accent>{offerDiscountLabel(redemption)}</Tag>
        </div>
        <p className="mt-2 text-sm text-text">« {redemption.name} »{redemption.code ? <> · code <span className="num font-medium">{redemption.code}</span></> : null}</p>
        <p className="mt-1 text-sm text-text-muted">{offerDiscountLabel(redemption)} sur {offerPlansLabel(redemption.plans)}, {remaining}. La remise apparaît sur chaque facture concernée ; un mois offert du parrainage passe avant elle (jamais les deux sur la même échéance).</p>
      </Card>
    );
  }
  if (!manage) return null;
  return (
    <Card data-testid="promo-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-md font-semibold">Code promo</h2>
        {!open ? <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Ajouter un code promo</Button> : null}
      </div>
      {open ? (
        <form
          className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!code.trim()) {
              setError("Saisissez un code promo.");
              return;
            }
            setError(null);
            apply.mutate(code.trim());
          }}
        >
          <div className="min-w-0 flex-1">
            <Field label="Code promo" error={error ?? undefined} hint="Une seule offre par abonnement ; la remise s'applique à vos prochains paiements.">
              {(p) => <Input id={p.id} invalid={p.invalid} aria-describedby={p.describedBy} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoComplete="off" spellCheck={false} maxLength={40} placeholder="ex. PRINTEMPS" className="num tracking-[0.1em]" />}
            </Field>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="accent" loading={apply.isPending}>Appliquer</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setOpen(false); setError(null); }}>Annuler</Button>
          </div>
        </form>
      ) : <p className="mt-1 text-sm text-text-muted">Vous avez reçu un code ? Ajoutez-le ici : la remise s'appliquera à votre prochain paiement.</p>}
    </Card>
  );
}

/** Ce que l'offre donne (comptes, équipe, stock) ; les compteurs du mois ont leur page « Utilisation ». */
function CapacityCard({ u }: { u: UsageSummary }) {
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-md font-semibold">Votre offre en chiffres</h2>
        <Link to="/app/settings/usage" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">Mon utilisation du mois <ArrowRight className="size-3.5" aria-hidden /></Link>
      </div>
      <p className="text-sm text-text-muted">La part de votre offre déjà prise. À 100 %, l'action concernée est refusée proprement, sans facturation.</p>
      <div className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-3">
        <UsageMeter label="Comptes Vinted" counter={u.counters.connections} hint="Le simulateur de démonstration n'est pas compté." />
        <UsageMeter label="Équipe" counter={u.counters.members} hint="Personnes ayant accès à l'organisation." />
        <UsageMeter label="Stock actif" counter={u.counters.items} hint="Les articles archivés ne comptent pas." />
      </div>
      {u.warning ? <Alert tone="warning" className="mt-5" title="Un compteur a atteint 80 % de votre offre">Le détail par filiale (IA, Studio, Track, Cloud) est dans <Link to="/app/settings/usage" className="font-medium text-accent hover:underline">Mon utilisation</Link>.</Alert> : null}
    </Card>
  );
}
