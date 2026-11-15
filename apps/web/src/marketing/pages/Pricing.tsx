import { useState } from "react";
import { Link } from "react-router";
import { ArrowRight, Check, Minus } from "lucide-react";
import { TRIAL_DAYS } from "@selio/contracts";
import { helpEntries } from "@selio/domain/help";
import { Alert, Segmented, buttonClass, cn, formatCents, formatNumber } from "@selio/ui";
import { PLAN_COMPARISON, PLAN_OFFERS, PRICING, TRIAL_OFFER, annualPriceCents, foundersMonthlyCents, monthlyPriceCents, type ComparisonValue, type OfferKey, type PlanOffer } from "@selio/demo-data";
import { useMarketingMeta } from "../seo";
import { showIndicativePricing } from "../../lib/env";
import { STUDIO_SLIDER, annualMonthlyEquivalentCents, studioQuote } from "../pricing";
import { CheckList, Container, Eyebrow, MarketingSection } from "../components";
import { DiscountedPrice, OfferHint, useOfferBanner } from "../../app/components/offers";
import { discountedFor, offerConditionLabel } from "../../lib/offers";
import type { PublicOffer } from "@selio/contracts";

const OFFER_KEYS: OfferKey[] = ["trial", "starter", "pro", "agence"];
const OFFER_NAMES = { trial: TRIAL_OFFER.name, ...Object.fromEntries(PLAN_OFFERS.map((p) => [p.key, p.name])) } as Record<OfferKey, string>;
const FREE_MONTHS = 12 - PRICING.annualMonthsCharged;
type Period = "monthly" | "annual";

/** Montant indicatif, ou « À définir » quand l'affichage des prix est masqué (VITE_SHOW_INDICATIVE_PRICING). */
function price(cents: number): string {
  return showIndicativePricing ? formatCents(cents) : "À définir";
}

const perPhotoFormat = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 3 });
/** Prix à la photo (centimes décimaux) : « 0,02 € », « 0,062 € ». */
function perPhoto(cents: number): string {
  return showIndicativePricing ? perPhotoFormat.format(cents / 100) : "À définir";
}


export default function Pricing() {
  useMarketingMeta("/tarifs");
  const [period, setPeriod] = useState<Period>("monthly");
  // Offre commerciale publique (bandeau) : prix remisé affiché à côté du prix normal des forfaits concernés.
  const offers = useOfferBanner("vitrine").data;
  const faq = helpEntries().filter((e) => e.categoryId === "tarifs");
  return (
    <>
      <MarketingSection
        level={1}
        reveal
        eyebrow="Tarifs"
        title={`${TRIAL_DAYS} jours pour essayer, puis l'offre qui vous ressemble`}
        lead={`L'essai donne toutes les fonctions du plan Pro pendant ${TRIAL_DAYS} jours : la carte est enregistrée à l'inscription, rien n'est débité avant la fin. Ensuite, Starter, Pro ou Agence selon vos comptes Vinted et votre équipe.`}
      >
        <article className="card mk-card mk-featured flex flex-col gap-5 p-6 md:flex-row md:items-center" data-reveal="" aria-labelledby="offre-trial">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="offre-trial" className="text-md font-semibold text-text">{TRIAL_OFFER.name}</h2>
              <span className="mk-badge" data-value="available">Pour commencer</span>
            </div>
            <p className="mt-1 text-sm text-text-muted">{TRIAL_OFFER.profile}</p>
            <div className="mt-4"><CheckList items={TRIAL_OFFER.highlights} /></div>
          </div>
          <div className="flex shrink-0 flex-col gap-2 md:w-72">
            <p className="text-2xl font-semibold text-text">Gratuit <span className="text-sm font-normal text-text-muted">pendant {TRIAL_DAYS} jours</span></p>
            <p className="text-xs text-text-muted">{TRIAL_OFFER.tagline}.</p>
            <Link to="/inscription" className={buttonClass({ variant: "accent", fullWidth: true })}>Commencer l'essai de {TRIAL_DAYS} jours</Link>
            <Link to="/connexion" className="text-center text-sm text-text-muted hover:text-text">Déjà inscrit ? Se connecter</Link>
          </div>
        </article>

        <div className="mt-10 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-[-0.01em] text-text">Ensuite, trois offres</h2>
            <p className="mt-1 text-sm text-text-muted">Au mois sans engagement, ou à l'année avec {FREE_MONTHS} mois offerts.</p>
          </div>
          <Segmented ariaLabel="Facturation" value={period} onChange={setPeriod} items={[{ value: "monthly", label: "Au mois" }, { value: "annual", label: `À l'année · ${FREE_MONTHS} mois offerts` }]} />
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {PLAN_OFFERS.map((p) => <PlanCard key={p.key} offer={p} period={period} offers={offers} />)}
        </div>

        <dl className="card mt-4 grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0" data-reveal="">
          <div className="p-5">
            <dt className="text-sm font-semibold text-text">Annuel : {FREE_MONTHS} mois offerts</dt>
            <dd className="mt-1 text-sm text-text-muted">{PRICING.annualMonthsCharged} mois payés sur 12, même offre et mêmes limites toute l'année.</dd>
          </div>
          <div className="p-5">
            <dt className="text-sm font-semibold text-text">Offre fondateurs</dt>
            <dd className="mt-1 text-sm text-text-muted">Pour les {PRICING.founders.firstCustomers} premiers clients : −{Math.round(PRICING.founders.discountRate * 100)} % pendant {PRICING.founders.discountMonths} mois sur Pro et Agence, {PRICING.founders.freeMonthsStarter} mois offert sur Starter.</dd>
          </div>
          <div className="p-5">
            <dt className="text-sm font-semibold text-text">Plus de 10 comptes : sur devis</dt>
            <dd className="mt-1 text-sm text-text-muted">Aucun compte supplémentaire à la carte. Au-delà de l'offre Agence, <Link to="/contact" className="font-medium text-accent hover:underline">écrivez-nous</Link>.</dd>
          </div>
        </dl>
        <Alert tone="info" title="Montants non définitifs" className="mt-6">Les prix illustrent la structure prévue et peuvent évoluer avant l'ouverture des abonnements. Aucun paiement n'est encaissé à ce stade : le paiement en ligne fonctionne uniquement en mode test.</Alert>
      </MarketingSection>

      <Subsidiaries />
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

function PlanCard({ offer, period, offers }: { offer: PlanOffer; period: Period; offers?: PublicOffer[] }) {
  const monthly = monthlyPriceCents(offer.key);
  const annual = annualPriceCents(offer.key);
  // Remise de l'offre en cours sur l'échéance affichée (mensuelle, ou annuelle une fois).
  const promo = showIndicativePricing ? discountedFor(offers, offer.key, period === "monthly" ? monthly : annual) : null;
  const founders = PRICING.founders.discountPlans.includes(offer.key)
    ? `${price(foundersMonthlyCents(offer.key))} / mois pendant ${PRICING.founders.discountMonths} mois`
    : `${PRICING.founders.freeMonthsStarter} mois offert`;
  return (
    <article className="card mk-card flex flex-col p-6" data-reveal="" aria-labelledby={`offre-${offer.key}`}>
      <h3 id={`offre-${offer.key}`} className="text-md font-semibold text-text">{offer.name}</h3>
      <p className="mt-0.5 text-sm font-medium text-accent">{offer.profile}</p>
      <p className="mt-1 text-sm text-text-muted">{offer.forWhom}</p>
      <p className="num mt-5 text-2xl font-semibold text-text">
        {promo && period === "monthly" ? <DiscountedPrice normalCents={monthly} discountedCents={promo.cents} /> : price(period === "monthly" ? monthly : annualMonthlyEquivalentCents(offer.key))}
        {showIndicativePricing ? <span className="text-sm font-normal text-text-muted"> / mois{period === "annual" ? ", à l'année" : ""}</span> : null}
        {promo && period === "monthly" ? <OfferHint text={offerConditionLabel(promo.offer)} title={promo.offer.name} /> : null}
      </p>
      <p className="num mt-0.5 text-xs text-text-muted">
        {period === "annual" ? (promo ? <>{price(promo.cents)} par an au lieu de {price(annual)} ({offerConditionLabel(promo.offer, "yearly")})</> : `${price(annual)} par an, soit ${FREE_MONTHS} mois offerts`) : "Sans engagement, résiliable à tout moment"}
      </p>
      {showIndicativePricing ? <p className="num mt-1 text-xs text-text-muted">Fondateurs : {founders}</p> : null}
      <div className="mt-5 flex-1"><CheckList items={offer.highlights} /></div>
      <div className="mt-6">
        <Link to="/inscription" className={buttonClass({ variant: "secondary", fullWidth: true })}>Commencer par l'essai</Link>
      </div>
    </article>
  );
}

/** Les autres filiales : Studio seul au curseur, Radar, Radar Auto, Cloud en option ; Selio Bot inclus ; Selio Comptes à la prestation. */
function Subsidiaries() {
  const s = PRICING.subsidiaries;
  const rows: { name: string; text: string; price: string; unit: string }[] = [
    { name: "Selio Radar", text: "Alertes sur le téléphone et achat en un clic, vous achetez vous-même.", price: price(s.radar), unit: "par mois" },
    { name: "Selio Radar Auto", text: "Achat automatique avec seuil de note, prix maximum et plafond par jour ; derrière un réglage désactivé par défaut.", price: price(s.radarAuto), unit: "par mois" },
    { name: "Selio Cloud en option", text: "Le moteur qui fait tourner Selio Manager et Selio Bot ordinateur éteint. En option pour Starter et Pro, inclus dans Agence.", price: price(s.cloudOption), unit: "par mois" },
  ];
  return (
    <section className="py-12 md:py-16" aria-labelledby="filiales">
      <Container>
        <Eyebrow>Le reste de la gamme</Eyebrow>
        <h2 id="filiales" className="mt-3 text-xl font-semibold tracking-[-0.015em] text-balance text-text md:text-[28px] md:leading-[34px]">Studio seul, Radar, Cloud, Selio Bot et Selio Comptes</h2>
        <p className="mt-3 max-w-2xl text-base text-text-muted">Studio est inclus dans Pro et Agence ; seul, il se paie à la photo. Radar et Cloud ont leur prix au mois, Selio Bot est inclus selon votre forfait, Selio Comptes se paie une fois. Montants indicatifs, à confirmer.</p>
        <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-start">
          <StudioCard />
          <div className="flex flex-col gap-4">
            <ul className="card divide-y divide-border">
              {rows.map((r) => (
                <li key={r.name} className="flex items-start justify-between gap-4 p-5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text">{r.name}</p>
                    <p className="mt-0.5 text-xs text-text-muted">{r.text}</p>
                  </div>
                  <p className="num shrink-0 text-right text-sm font-semibold text-text">{r.price}<span className="block text-xs font-normal text-text-muted">{r.unit}</span></p>
                </li>
              ))}
            </ul>
            <BotCard />
          </div>
        </div>
        <ComptesOffer />
      </Container>
    </section>
  );
}

/** Selio Bot : pas de prix séparé, ce que chaque forfait en donne (quotas de PLAN_QUOTAS). */
function BotCard() {
  return (
    <article className="card p-5" aria-labelledby="selio-bot">
      <div className="flex items-start justify-between gap-4">
        <h3 id="selio-bot" className="text-sm font-semibold text-text">Selio Bot</h3>
        <p className="shrink-0 text-right text-sm font-semibold text-text">Inclus<span className="block text-xs font-normal text-text-muted">selon le forfait</span></p>
      </div>
      <ul className="mt-2 flex flex-col gap-1.5 text-xs text-text-muted">
        <li><span className="font-medium text-text">Starter</span> : négociation, réponses et après-vente automatiques tant que votre navigateur est ouvert ; Selio Cloud en option.</li>
        <li><span className="font-medium text-text">Pro</span> : en plus, la relance après 24 h proposée ; Selio Cloud en option.</li>
        <li><span className="font-medium text-text">Agence</span> : relance automatique et Selio Cloud inclus, 24 h/24.</li>
      </ul>
      <Link to="/produits/bot" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">Découvrir Selio Bot <ArrowRight className="size-3.5" aria-hidden /></Link>
    </article>
  );
}

/** Selio Comptes à la prestation : trois niveaux, payés une fois (PRICING.subsidiaries). */
function ComptesOffer() {
  const s = PRICING.subsidiaries;
  const tiers = [
    { key: "audit", name: "Audit de boutique", cents: s.comptesAudit, text: "Votre boutique relue de l'extérieur : présentation, photos, titres, prix, règles d'envoi. Un rapport et les corrections prioritaires." },
    { key: "mise-en-place", name: "Mise en place complète", cents: s.comptesMiseEnPlace, text: "Présentation, règles d'envoi, réponses types et premières annonces préparées avec vous, prêtes à copier dans Vinted." },
    { key: "accompagnement", name: "Accompagnement 30 jours", cents: s.comptesAccompagnement, text: "La mise en place, puis deux points d'étape sur vos premières ventes : prix, republications, réglages de Selio Manager." },
  ];
  return (
    <div className="mt-10" id="comptes">
      <h3 className="text-lg font-semibold tracking-[-0.01em] text-text">Selio Comptes à la prestation</h3>
      <p className="mt-1 max-w-2xl text-sm text-text-muted">Un service ponctuel, payé une fois, sans abonnement. Vous gardez la main : Selio ne crée aucun compte et ne se connecte jamais à Vinted à votre place.</p>
      <ul className="mt-4 grid gap-4 md:grid-cols-3" aria-label="Niveaux de la prestation Selio Comptes">
        {tiers.map((t) => (
          <li key={t.key} className="card mk-card flex flex-col p-5">
            <p className="text-sm font-semibold text-text">{t.name}</p>
            <p className="num mt-2 text-2xl font-semibold text-text">{price(t.cents)}<span className="text-sm font-normal text-text-muted"> une fois</span></p>
            <p className="mt-2 flex-1 text-sm text-text-muted">{t.text}</p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-text-muted">Prestation commandée depuis la page <Link to="/contact" className="font-medium text-accent hover:underline">Contact</Link> : le paiement en ligne n'est pas encore ouvert.</p>
    </div>
  );
}

function StudioCard() {
  const cfg = PRICING.subsidiaries.studio;
  const [photos, setPhotos] = useState<number>(cfg.packs[1]?.photos ?? STUDIO_SLIDER.min);
  const quote = studioQuote(photos, cfg);
  return (
    <article className="card mk-card p-6" aria-labelledby="studio-seul">
      <h3 id="studio-seul" className="text-md font-semibold text-text">Selio Studio seul</h3>
      <p className="mt-1 text-sm text-text-muted">
        Annonces rédigées à partir de vos photos, sans abonnement Selio : {cfg.freeListings} annonces offertes pour commencer, puis des photos à l'unité. Plancher {perPhoto(cfg.floorCentsPerPhoto)} la photo et {price(cfg.minPurchaseCents)} minimum par achat.
      </p>
      <div className="mt-5">
        <label htmlFor="studio-photos" className="flex items-baseline justify-between gap-3 text-sm">
          <span className="font-medium text-text">Nombre de photos</span>
          <span className="num text-text-muted">{formatNumber(photos)} photos</span>
        </label>
        <input
          id="studio-photos"
          type="range"
          min={STUDIO_SLIDER.min}
          max={STUDIO_SLIDER.max}
          step={STUDIO_SLIDER.step}
          value={photos}
          onChange={(e) => setPhotos(Number(e.target.value))}
          aria-label="Nombre de photos"
          aria-valuetext={`${formatNumber(photos)} photos`}
          className="mt-2 w-full accent-accent-vivid"
        />
        <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="num text-2xl font-semibold text-text">{price(quote.cents)}<span className="text-sm font-normal text-text-muted"> pour {formatNumber(photos)} photos</span></p>
          <p className="num text-sm text-text-muted">soit {perPhoto(quote.perPhotoCents)} la photo{quote.minimumApplied ? " · minimum par achat appliqué" : ""}</p>
        </div>
        <ul className="mt-4 flex flex-wrap gap-2" aria-label="Packs de photos">
          {cfg.packs.map((pack) => (
            <li key={pack.photos}>
              <button type="button" onClick={() => setPhotos(pack.photos)} aria-pressed={photos === pack.photos} className={cn("num rounded-full px-3 py-1 text-xs font-medium transition-colors", photos === pack.photos ? "bg-accent-soft text-accent" : "bg-surface-muted text-text-muted hover:text-text")}>
                {formatNumber(pack.photos)} photos · {price(pack.cents)}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

function Cell({ value }: { value: ComparisonValue }) {
  if (value.kind === "check") return <><Check className="mx-auto size-4 text-accent" aria-hidden /><span className="sr-only">Inclus</span></>;
  if (value.kind === "planned") return <span className="text-xs whitespace-nowrap text-text-muted">En préparation</span>;
  if (value.kind === "none") return <><Minus className="mx-auto size-4 text-text-subtle" aria-hidden /><span className="sr-only">Non inclus</span></>;
  return <span className="num text-sm text-text">{value.text}</span>;
}

/** Tableau comparatif : l'essai et les trois offres ; sur mobile, une colonne à la fois (choix au-dessus du tableau). */
function Comparison() {
  const [focus, setFocus] = useState<OfferKey>("pro");
  return (
    <section className="py-12 md:py-16" aria-labelledby="comparer">
      <Container>
        <Eyebrow>Comparer</Eyebrow>
        <h2 id="comparer" className="mt-3 text-xl font-semibold tracking-[-0.015em] text-balance text-text md:text-[28px] md:leading-[34px]">Ce que chaque offre permet</h2>
        <p className="mt-3 max-w-2xl text-base text-text-muted">Les limites (comptes, IA, Studio, Track, Cloud) s'affichent en pourcentage dans l'application, page « Mon utilisation », avec une alerte à 80 %. À 100 %, l'action concernée est refusée proprement : jamais de dépassement facturé.</p>
        <div className="mt-6 flex flex-col gap-1.5 sm:hidden">
          <span className="text-sm font-medium text-text" aria-hidden>Offre affichée</span>
          <Segmented ariaLabel="Offre affichée" value={focus} onChange={setFocus} items={OFFER_KEYS.map((k) => ({ value: k, label: OFFER_NAMES[k] }))} />
        </div>
        <div className="card mt-4 overflow-hidden sm:mt-8">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Comparaison de l'essai et des offres Starter, Pro et Agence</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="px-4 py-3 text-sm font-medium text-text-muted md:px-5"><span className="sr-only">Fonction</span></th>
                {OFFER_KEYS.map((k) => {
                  const offer = PLAN_OFFERS.find((p) => p.key === k);
                  return (
                    <th key={k} scope="col" className={cn("w-[18%] px-3 py-3 text-center align-bottom", k !== focus && "max-sm:hidden")}>
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
                  <th scope="colgroup" colSpan={OFFER_KEYS.length + 1} className="bg-surface-muted/60 px-4 py-2 text-xs font-medium tracking-wider text-text-muted uppercase md:px-5">{g.title}</th>
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
        <p className="mt-3 text-xs text-text-muted">Pendant l'essai de {TRIAL_DAYS} jours, les limites sont celles du plan Pro. Montants indicatifs, aucun paiement encaissé.</p>
      </Container>
    </section>
  );
}
