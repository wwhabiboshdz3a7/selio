import { useState } from "react";
import { Link } from "react-router";
import { ArrowRight, Check } from "lucide-react";
import type { TrialDays } from "@selio/contracts";
import { helpEntries } from "@selio/domain/help";
import { Alert, Segmented, buttonClass, cn, formatCents } from "@selio/ui";
import { PLAN_COMPARISON, PLAN_OFFERS, TRIAL_DURATIONS, TRIAL_OFFER, type ComparisonValue, type OfferKey } from "@selio/demo-data";
import { usePageMeta } from "../../lib/seo";
import { showIndicativePricing } from "../../lib/env";
import { CheckList, Container, Eyebrow, MarketingSection } from "../components";

const OFFER_NAMES: Record<OfferKey, string> = { trial: TRIAL_OFFER.name, starter: PLAN_OFFERS[0]!.name, pro: PLAN_OFFERS[1]!.name };
const OFFER_KEYS: OfferKey[] = ["trial", "starter", "pro"];

function price(cents: number): string {
  return showIndicativePricing ? formatCents(cents, { compact: true }) : "À définir";
}

export default function Pricing() {
  usePageMeta("Tarifs", "Tarifs de Selio : essai Découverte gratuit d'une semaine ou d'un mois, puis plans Essentiel et Pro décrits par profil (comptes Vinted, équipe, modules, assistance). Montants indicatifs.");
  const [days, setDays] = useState<TrialDays>(TRIAL_OFFER.defaultDays);
  const duration = TRIAL_DURATIONS.find((d) => d.days === days) ?? TRIAL_DURATIONS[0]!;
  const faq = helpEntries().filter((e) => e.categoryId === "tarifs");
  return (
    <>
      <MarketingSection
        level={1}
        reveal
        eyebrow="Tarifs"
        title="Une semaine pour essayer, puis le plan qui vous ressemble"
        lead={"Découverte est un essai gratuit de toutes les fonctions, d'une semaine ou d'un mois. Ensuite, Essentiel ou Pro selon vos comptes Vinted et votre équipe : tous les modules sont inclus dans les deux."}
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <article className="card mk-card mk-featured flex flex-col p-6" data-reveal="" aria-labelledby="offre-trial">
            <div className="flex items-center justify-between gap-2">
              <h2 id="offre-trial" className="text-md font-semibold text-text">{TRIAL_OFFER.name}</h2>
              <span className="mk-badge" data-value="demo">Pour commencer</span>
            </div>
            <p className="mt-1 text-sm text-text-muted">{TRIAL_OFFER.profile}</p>
            <div className="mt-5">
              <Segmented ariaLabel="Durée de l'essai" value={String(days)} onChange={(v) => setDays(Number(v) as TrialDays)} items={TRIAL_DURATIONS.map((d) => ({ value: String(d.days), label: d.label }))} />
            </div>
            <p className="mt-4 text-2xl font-semibold text-text">Gratuit <span className="text-sm font-normal text-text-muted">pendant {duration.long}</span></p>
            <p className="mt-0.5 text-xs text-text-muted">{TRIAL_OFFER.tagline}</p>
            <div className="mt-5 flex-1"><CheckList items={TRIAL_OFFER.highlights} /></div>
            <div className="mt-6 flex flex-col gap-2">
              <Link to={`/inscription?essai=${days}`} className={buttonClass({ variant: "accent", fullWidth: true })}>Commencer l'essai {duration.phrase}</Link>
              <Link to="/demo" className="text-center text-sm text-text-muted hover:text-text">ou explorer la démo, sans compte</Link>
            </div>
          </article>
          {PLAN_OFFERS.map((p) => (
            <article key={p.key} className="card mk-card flex flex-col p-6" data-reveal="" aria-labelledby={`offre-${p.key}`}>
              <h2 id={`offre-${p.key}`} className="text-md font-semibold text-text">{p.name}</h2>
              <p className="mt-0.5 text-sm font-medium text-accent">{p.profile}</p>
              <p className="mt-1 text-sm text-text-muted">{p.forWhom}</p>
              <p className="num mt-5 text-2xl font-semibold text-text">
                {price(p.indicativeMonthlyCents)}
                {showIndicativePricing ? <span className="text-sm font-normal text-text-muted"> / mois, indicatif</span> : null}
              </p>
              <p className="mt-0.5 text-xs text-text-muted">Sans engagement · ouverture des abonnements en préparation</p>
              <div className="mt-5 flex-1"><CheckList items={p.highlights} /></div>
              <div className="mt-6">
                <Link to={`/inscription?essai=${days}`} className={buttonClass({ variant: "secondary", fullWidth: true })}>Commencer par l'essai</Link>
              </div>
            </article>
          ))}
        </div>
        <Alert tone="info" title="Montants indicatifs" className="mt-6">Les prix illustrent la structure prévue et peuvent évoluer avant l'ouverture des abonnements. Aucun paiement n'est encaissé à ce stade : le paiement en ligne fonctionne uniquement en mode test.</Alert>
      </MarketingSection>

      <Comparison />

      <section className="py-12 md:py-16">
        <Container>
          <Eyebrow>Tarifs</Eyebrow>
          <h2 className="mt-3 text-xl font-semibold tracking-[-0.015em] text-balance text-text">Questions fréquentes sur les tarifs</h2>
          <dl className="mt-6 grid gap-4 md:grid-cols-2">
            {faq.map((e) => (
              <div key={e.id} className="card p-5">
                <dt className="text-sm font-medium text-text">{e.question}</dt>
                <dd className="mt-1 text-sm text-text-muted">{e.answer}</dd>
              </div>
            ))}
          </dl>
          <Link to="/faq#categorie-tarifs" className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">Toute l'aide et la FAQ <ArrowRight className="size-3.5" aria-hidden /></Link>
        </Container>
      </section>
    </>
  );
}

function Cell({ value }: { value: ComparisonValue }) {
  if (value.kind === "check") return <><Check className="mx-auto size-4 text-accent" aria-hidden /><span className="sr-only">Inclus</span></>;
  if (value.kind === "planned") return <span className="text-xs whitespace-nowrap text-text-muted">En préparation</span>;
  return <span className="num text-sm text-text">{value.text}</span>;
}

/** Tableau comparatif : sur mobile, une offre à la fois (choix au-dessus du tableau). */
function Comparison() {
  const [focus, setFocus] = useState<OfferKey>("trial");
  return (
    <section className="py-12 md:py-16" aria-labelledby="comparer">
      <Container>
        <Eyebrow>Comparer</Eyebrow>
        <h2 id="comparer" className="mt-3 text-xl font-semibold tracking-[-0.015em] text-balance text-text md:text-[28px] md:leading-[34px]">Ce que chaque offre permet</h2>
        <p className="mt-3 max-w-2xl text-base text-text-muted">Les limites techniques (stock, IA, automatisations) sont affichées en pourcentage dans l'application. À l'approche d'une limite, l'action concernée est bloquée proprement : jamais de dépassement facturé.</p>
        <div className="mt-6 flex flex-col gap-1.5 sm:hidden">
          <span className="text-sm font-medium text-text" aria-hidden>Offre affichée</span>
          <Segmented ariaLabel="Offre affichée" value={focus} onChange={setFocus} items={OFFER_KEYS.map((k) => ({ value: k, label: OFFER_NAMES[k] }))} />
        </div>
        <div className="card mt-4 overflow-hidden sm:mt-8">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Comparaison des offres Découverte, Essentiel et Pro</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="px-4 py-3 text-sm font-medium text-text-muted md:px-5"><span className="sr-only">Fonction</span></th>
                {OFFER_KEYS.map((k) => {
                  const offer = PLAN_OFFERS.find((p) => p.key === k);
                  return (
                    <th key={k} scope="col" className={cn("w-[22%] px-3 py-3 text-center align-bottom", k !== focus && "max-sm:hidden")}>
                      <span className="block text-sm font-semibold text-text">{OFFER_NAMES[k]}</span>
                      <span className="num block text-xs font-normal text-text-muted">{offer ? (showIndicativePricing ? `${price(offer.indicativeMonthlyCents)} / mois` : "À définir") : "Gratuit"}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            {PLAN_COMPARISON.map((g) => (
              <tbody key={g.title}>
                <tr>
                  <th scope="colgroup" colSpan={4} className="bg-surface-muted/60 px-4 py-2 text-xs font-medium tracking-wider text-text-muted uppercase md:px-5">{g.title}</th>
                </tr>
                {g.rows.map((r) => (
                  <tr key={r.label} className="border-t border-border first:border-t-0">
                    <th scope="row" className="px-4 py-3 align-top font-normal md:px-5">
                      <span className="block text-sm text-text">{r.label}</span>
                      {r.hint ? <span className="mt-0.5 block text-xs text-text-muted">{r.hint}</span> : null}
                    </th>
                    {OFFER_KEYS.map((k) => (
                      <td key={k} className={cn("px-3 py-3 text-center align-top", k !== focus && "max-sm:hidden")}><Cell value={r.values[k]} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
        <p className="mt-3 text-xs text-text-muted">Pendant l'essai Découverte, les limites sont celles du plan Pro. Montants indicatifs, aucun paiement encaissé.</p>
      </Container>
    </section>
  );
}
