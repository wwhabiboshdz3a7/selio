import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, CircleCheck, Clock, Lock, ShieldCheck, Sparkles } from "lucide-react";
import { PAID_PLANS, PLAN_LABELS, SIMULATED_PAYMENT_NOTICE, betaDateLabel, type BillingCycle, type PaidPlan } from "@selio/contracts";
import { can } from "@selio/domain";
import { Alert, Button, Segmented, Skeleton, cn, formatCents } from "@selio/ui";
import { PLAN_OFFERS } from "@selio/demo-data";
import { Logo } from "../../components/Logo";
import { useClient, useRequiredSession } from "../../lib/data/provider";
import { usePaymentSimulated } from "../../lib/capabilities";
import { FREE_MONTHS, planPriceCents } from "../../lib/billing";
import { useAppMutation } from "../components/hooks";

/** Titre du bandeau de la page : le paiement en ligne n'est pas encore ouvert (Stripe à venir). */
export const PAYMENT_OPENING_TITLE = "Paiement en cours d'ouverture — aucune carte n'est demandée pour l'instant";

const isPaidPlan = (v: unknown): v is PaidPlan => typeof v === "string" && (PAID_PLANS as readonly string[]).includes(v);

/**
 * Page de paiement (« Ajouter un moyen de paiement ») en attendant Stripe : on choisit son forfait et sa
 * périodicité, on lit le récapitulatif, on confirme. Rien n'est débité, AUCUN champ de carte (ni numéro, ni date,
 * ni code) et aucune imitation d'un prestataire : le bandeau le dit en tête de page. La confirmation passe par le
 * même appel que le paiement réel (`startCheckout`) ; quand Stripe sera branché, ce bouton ouvrira son formulaire
 * sécurisé à la place (docs/TUTORIELS.md, « Brancher Stripe »).
 */
export default function Payment() {
  const s = useRequiredSession();
  const client = useClient();
  const qc = useQueryClient();
  const simulated = usePaymentSimulated();
  const [params] = useSearchParams();
  const sub = useQuery({ queryKey: ["subscription"], queryFn: () => client.getSubscription() });
  const requested = params.get("forfait");
  const [chosen, setChosen] = useState<PaidPlan | null>(isPaidPlan(requested) ? requested : null);
  const [cycle, setCycle] = useState<BillingCycle>(params.get("periodicite") === "annuelle" ? "yearly" : "monthly");
  const plan: PaidPlan = chosen ?? (isPaidPlan(sub.data?.pendingPlan) ? sub.data.pendingPlan : s.beta?.plan ?? "pro");
  const preview = useQuery({ queryKey: ["checkout-preview", plan, cycle], queryFn: () => client.previewCheckout(plan, { cycle }), staleTime: 0, enabled: simulated });
  const [done, setDone] = useState<string | null>(null);
  const confirm = useAppMutation(() => client.startCheckout(plan, { cycle }), {
    onSuccess: async (r) => {
      setDone(r.message);
      await Promise.all(["session", "subscription", "checkout-preview", "invoices"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
    },
  });
  const manage = can(s.role, "billing.manage");
  // Paiement réel (Revolut) : le formulaire sécurisé du prestataire est sur la page Abonnement.
  if (!simulated && !sub.isLoading) return <Navigate to="/app/settings/billing" replace />;
  const p = preview.data;
  return (
    <div data-testid="payment-page" className="min-h-dvh bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-4">
          <Link to={s.beta?.blocked ? "/app/settings/billing" : "/app"} className="inline-flex items-center gap-1.5 text-sm font-medium text-text-muted hover:text-text"><ArrowLeft className="size-4" aria-hidden />Retour</Link>
          <Logo height={22} />
          <span className="inline-flex items-center gap-1.5 text-xs text-text-muted"><Lock className="size-3.5" aria-hidden />Sans carte</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 md:py-12">
        <div data-testid="payment-opening-notice" role="status" className="flex items-start gap-3 rounded-xl border border-gold-300/60 bg-gold-soft px-4 py-3.5 text-sm text-text">
          <Clock className="mt-0.5 size-5 shrink-0 text-gold-text" aria-hidden />
          <div>
            <p className="font-semibold text-gold-text">{PAYMENT_OPENING_TITLE}</p>
            <p className="mt-0.5 text-text-muted">Choisissez votre forfait et confirmez : rien n'est débité. Dès l'ouverture du paiement sécurisé, vous recevrez un lien pour enregistrer votre carte.</p>
          </div>
        </div>

        <h1 className="mt-8 text-2xl font-semibold tracking-[-0.02em] text-text md:text-3xl">Ajouter un moyen de paiement</h1>
        <p className="mt-1 text-base text-text-muted">{s.beta?.blocked ? "Votre mois de bêta est terminé : choisissez votre forfait pour continuer." : s.beta?.state === "running" && s.beta.endsAt ? `Votre mois de bêta court jusqu'au ${betaDateLabel(s.beta.endsAt)} : choisissez dès maintenant la suite.` : "Choisissez votre forfait pour la suite."}</p>

        {!manage ? <Alert tone="info" className="mt-6">Seul le titulaire du compte peut choisir un forfait et ajouter un moyen de paiement.</Alert> : done ? (
          <section data-testid="payment-done" className="mt-8 flex flex-col items-center rounded-2xl border border-border bg-surface px-6 py-10 text-center shadow-sm">
            <span className="inline-flex size-12 items-center justify-center rounded-full bg-tone-emerald-soft text-success"><CircleCheck className="size-6" aria-hidden /></span>
            <h2 className="mt-4 text-xl font-semibold text-text">Forfait {PLAN_LABELS[plan]} retenu</h2>
            <p className="mt-2 max-w-lg text-sm text-text-muted">{done}</p>
            <Link to="/app" className="mt-6"><Button variant="accent">Retour à Selio</Button></Link>
          </section>
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
            <section aria-labelledby="payment-plans">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="payment-plans" className="text-md font-semibold text-text">Votre forfait</h2>
                <Segmented ariaLabel="Périodicité" value={cycle} onChange={setCycle} items={[{ value: "monthly", label: "Mensuel" }, { value: "yearly", label: `Annuel · ${FREE_MONTHS} mois offerts` }]} />
              </div>
              <div role="radiogroup" aria-label="Forfait" className="mt-3 flex flex-col gap-3">
                {PLAN_OFFERS.map((o) => {
                  const selected = o.key === plan;
                  const price = planPriceCents(o.key, cycle);
                  return (
                    <button
                      key={o.key}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      data-testid={`payment-plan-${o.key}`}
                      onClick={() => setChosen(o.key)}
                      className={cn("press flex w-full items-start gap-3 rounded-xl border bg-surface p-4 text-left transition-colors", selected ? "border-accent ring-2 ring-accent/25" : "border-border hover:border-border-strong")}
                    >
                      <span className={cn("mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border", selected ? "border-accent bg-accent text-white" : "border-border-strong")} aria-hidden>{selected ? <Check className="size-3.5" /> : null}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-x-2"><span className="text-base font-semibold text-text">{o.name}</span><span className="text-sm text-accent">{o.profile}</span>{o.key === s.beta?.plan ? <span className="inline-flex items-center gap-1 rounded-full bg-gold-soft px-1.5 py-0.5 text-[11px] font-semibold text-gold-text"><Sparkles className="size-3" aria-hidden />Votre forfait de bêta</span> : null}</span>
                        <span className="mt-1 block text-sm text-text-muted">{o.highlights.slice(0, 3).join(" · ")}</span>
                      </span>
                      <span className="num shrink-0 text-right text-sm text-text"><span className="font-semibold">{formatCents(price)}</span><span className="text-text-muted"> / {cycle === "yearly" ? "an" : "mois"}</span></span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-5 rounded-xl border border-dashed border-border-strong bg-surface-muted/60 px-4 py-3.5">
                <p className="flex items-center gap-2 text-sm font-medium text-text"><ShieldCheck className="size-4 text-text-muted" aria-hidden />Moyen de paiement</p>
                <p className="mt-1 text-sm text-text-muted">Le paiement par carte s'ouvre très prochainement, dans un formulaire sécurisé : vos coordonnées bancaires ne passeront jamais par Selio. Aujourd'hui, aucune carte n'est demandée.</p>
              </div>
            </section>

            <aside aria-labelledby="payment-summary" className="h-max rounded-2xl border border-border bg-surface p-5 shadow-sm lg:sticky lg:top-6">
              <h2 id="payment-summary" className="text-md font-semibold text-text">Récapitulatif</h2>
              {preview.isLoading || !p ? <Skeleton className="mt-4 h-40" /> : (
                <>
                  <dl className="mt-4 flex flex-col gap-2.5 text-sm">
                    <div className="flex justify-between gap-3"><dt className="text-text-muted">Forfait</dt><dd className="font-medium text-text">{p.planLabel} · {p.cycle === "yearly" ? "annuel" : "mensuel"}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-text-muted">Prix</dt><dd className="num text-text">{formatCents(p.priceCents)} / {p.cycle === "yearly" ? "an" : "mois"}</dd></div>
                    {p.discount ? <div className="flex justify-between gap-3"><dt className="text-text-muted">{p.discount.label}</dt><dd className="num text-success">−{formatCents(p.discount.amountCents)}</dd></div> : null}
                    <div className="flex justify-between gap-3"><dt className="text-text-muted">{p.afterBeta ? "Première échéance" : "Après l'essai"}</dt><dd className="num text-text">{formatCents(p.dueCents)}{p.trialEndsAt ? <span className="block text-right text-xs text-text-muted">à partir du {betaDateLabel(p.trialEndsAt)}</span> : null}</dd></div>
                  </dl>
                  <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-border pt-4">
                    <span className="text-sm font-semibold text-text">À payer aujourd'hui</span>
                    <span data-testid="payment-due-today" className="num text-2xl font-semibold text-text">{formatCents(0)}</span>
                  </div>
                  <p className="mt-2 text-xs text-text-muted">{SIMULATED_PAYMENT_NOTICE}</p>
                  {p.blockedReason ? <Alert tone="warning" className="mt-4">{p.blockedReason}</Alert> : null}
                  <Button variant="accent" fullWidth size="lg" className="mt-5" onClick={() => confirm.mutate(undefined)} loading={confirm.isPending} disabled={p.blockedReason !== null} data-testid="payment-confirm">Confirmer mon forfait</Button>
                  <p className="mt-3 text-center text-xs text-text-muted">{p.afterBeta ? "Votre espace est rouvert (accès de base) dès la confirmation, en attendant l'ouverture du paiement." : "Sans engagement : changez de forfait à tout moment."}</p>
                </>
              )}
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
