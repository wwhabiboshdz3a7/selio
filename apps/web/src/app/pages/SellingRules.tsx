import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, MessageSquare } from "lucide-react";
import type { InventoryItem, MarginRules } from "@selio/contracts";
import { MARGIN_PRESETS, applyMarginPreset, applyRate, can, evaluateOffer, lowestAcceptedOffer, matchMarginPreset, negotiationPath, projectedMargin, suggestFloorPrice, type ItemPricing, type MarginPresetId, type NegotiationResult } from "@selio/domain";
import { Alert, Button, Card, Field, Input, PageHeader, Segmented, Select, buttonClass, cn, formatCents, formatPercent } from "@selio/ui";
import { useClient, useRequiredSession } from "../../lib/data/provider";
import { MoneyInput } from "../components/common";
import { useAppMutation } from "../components/hooks";

const RULE_KEYS: (keyof MarginRules)[] = ["minMarginRate", "minMarginCents", "maxDiscountRate", "counterStepRate", "maxRoundsPerCustomer", "defaultPlatformFeeRate", "defaultShippingCostCents"];
const sameRules = (a: MarginRules, b: MarginRules) => RULE_KEYS.every((k) => Math.abs(Number(a[k]) - Number(b[k])) < 1e-9);
const pct = (rate: number) => `${Math.round(rate * 1000) / 10} %`.replace(".", ",");

/**
 * Négociation et marges : les règles qui décident de la réponse à chaque offre
 * d'acheteur (Messagerie, automatisations). Préréglages, réglages écrits en
 * phrases et simulateur branché sur le moteur du domaine (evaluateOffer).
 */
export default function SellingRules() {
  const client = useClient();
  const session = useRequiredSession();
  const saved = session.org.settings.margin;
  const [rules, setRules] = useState<MarginRules>(saved);
  const editable = can(session.role, "org.update");
  const dirty = !sameRules(rules, saved);
  const presetId = matchMarginPreset(rules);
  const set = <K extends keyof MarginRules>(k: K, v: MarginRules[K]) => setRules((r) => ({ ...r, [k]: v }));
  const save = useAppMutation(() => client.updateOrg({ settings: { margin: rules } }), { invalidate: ["session", "conversation", "conversations", "items", "dressing", "overview"], success: "Règles de négociation enregistrées" });

  return (
    <>
      <PageHeader
        title="Négociation et marges"
        description="Ce que vous acceptez, jusqu'où vous descendez et comment vous contre-proposez. Ces règles décident de la réponse à chaque offre dans la Messagerie ; l'IA rédige le message, elle ne change jamais la décision."
        actions={<Link to="/app/messages" className={buttonClass({ variant: "secondary" })}><MessageSquare />Ouvrir la messagerie</Link>}
      />
      {!editable ? <Alert tone="info" className="mb-5" title="Consultation">Seuls le propriétaire et les administrateurs peuvent modifier ces règles. Le simulateur reste utilisable : il ne change rien.</Alert> : null}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <h2 className="text-md font-semibold">Point de départ</h2>
            <p className="mt-1 text-sm text-text-muted">Un préréglage remplit les règles ci-dessous ; vous pouvez ensuite ajuster chaque valeur. Vos frais restent inchangés.</p>
            <div role="radiogroup" aria-label="Préréglage" className="mt-4 grid gap-2 sm:grid-cols-3">
              {MARGIN_PRESETS.map((p) => {
                const active = presetId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={!editable}
                    onClick={() => setRules((r) => applyMarginPreset(r, p.id as MarginPresetId))}
                    className={cn("flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed", active ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-muted")}
                  >
                    <span className="flex w-full items-center justify-between gap-2 text-base font-semibold text-text">{p.label}{active ? <Check className="size-4 text-accent" aria-hidden /> : null}</span>
                    <span className="text-xs text-text-muted">{p.summary}</span>
                    <span className="num mt-1.5 flex flex-col gap-0.5 text-xs text-text"><span>Marge {pct(p.rules.minMarginRate)} · {formatCents(p.rules.minMarginCents, { compact: true })}</span><span>Remise jusqu'à {pct(p.rules.maxDiscountRate)}</span><span>{p.rules.maxRoundsPerCustomer} contre-prop. · pas {pct(p.rules.counterStepRate)}</span></span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-text-muted" aria-live="polite">{presetId ? `Réglages actuels : « ${MARGIN_PRESETS.find((p) => p.id === presetId)!.label} ».` : "Réglages actuels : personnalisés."}</p>
          </Card>

          <Card>
            <h2 className="text-md font-semibold">Vos règles</h2>
            <div className="mt-4 flex flex-col gap-6">
              <Rule title="Marge à garder" hint="La marge se calcule après frais et coût d'achat. Ces minimums fixent le prix plancher suggéré de chaque article ; un plancher saisi à la main sur un article reste prioritaire.">
                Je garde au moins <PercentInput label="Marge minimale (%)" value={rules.minMarginRate} min={0} max={90} onChange={(v) => set("minMarginRate", v)} disabled={!editable} /> de marge et <InlineMoney label="Marge minimale (€)" value={rules.minMarginCents} onChange={(v) => set("minMarginCents", v)} disabled={!editable} /> par article.
              </Rule>
              <Rule title="Remise accordée" hint="Une offre au-dessus du plancher et dans cette limite est acceptée sans contre-proposition.">
                J'accepte jusqu'à <PercentInput label="Remise maximale (%)" value={rules.maxDiscountRate} min={0} max={90} onChange={(v) => set("maxDiscountRate", v)} disabled={!editable} /> de remise sur le prix affiché.
              </Rule>
              <Rule title="Contre-propositions" hint="Chaque contre-proposition descend d'un pas depuis le prix affiché, sans passer sous le plancher ni sous la remise maximale. Au-delà, l'offre vous est confiée.">
                Je fais au plus <CountInput label="Contre-propositions par acheteur" value={rules.maxRoundsPerCustomer} min={0} max={10} onChange={(v) => set("maxRoundsPerCustomer", v)} disabled={!editable} /> contre-proposition{rules.maxRoundsPerCustomer > 1 ? "s" : ""} par acheteur, en baissant de <PercentInput label="Pas de contre-proposition (%)" value={rules.counterStepRate} min={1} max={50} onChange={(v) => set("counterStepRate", v)} disabled={!editable} /> à chaque fois.
              </Rule>
              <Rule title="Frais à votre charge" hint="0 et 0 sur Vinted : la protection acheteurs et le port sont payés par l'acheteur. Ces frais entrent dans le calcul de la marge.">
                La plateforme me prend <PercentInput label="Frais plateforme vendeur (%)" value={rules.defaultPlatformFeeRate} min={0} max={50} step={0.5} onChange={(v) => set("defaultPlatformFeeRate", v)} disabled={!editable} /> du prix et le port me coûte <InlineMoney label="Port à charge vendeur (€)" value={rules.defaultShippingCostCents} onChange={(v) => set("defaultShippingCostCents", v)} disabled={!editable} /> par vente.
              </Rule>
            </div>
          </Card>

          {editable ? (
            <div className={cn("flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-surface px-4 py-3", dirty ? "sticky bottom-4 z-10 border-accent/50 shadow-md" : "border-border")}>
              <p className="text-sm text-text-muted">{dirty ? <><span className="font-medium text-text">Modifications non enregistrées.</span> Le simulateur les applique déjà.</> : "Règles enregistrées : elles s'appliquent à toutes les offres."}</p>
              <div className="flex gap-2">
                {dirty ? <Button variant="ghost" onClick={() => setRules(saved)}>Annuler</Button> : null}
                <Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!dirty}>Enregistrer</Button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-6">
          <Simulator rules={rules} />
          <HowItWorks rules={rules} />
        </div>
      </div>
    </>
  );
}

function Rule({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-medium tracking-wide text-text-muted uppercase">{title}</h3>
      <p className="mt-1.5 text-base leading-10 text-text">{children}</p>
      <p className="text-xs text-text-muted">{hint}</p>
    </section>
  );
}

/** Champ numérique saisi librement, appliqué dès qu'il est valide (borné), remis au propre en sortie. */
function NumberInput({ label, value, min, max, step = 1, suffix, onChange, disabled, width = "w-[5.5rem]" }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (v: number) => void; disabled?: boolean; width?: string }) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? String(value).replace(".", ",");
  return (
    <span className={cn("inline-block align-middle", width)}>
      <Input
        aria-label={label}
        inputMode="decimal"
        value={shown}
        disabled={disabled}
        onFocus={() => setText(String(value).replace(".", ","))}
        onBlur={() => setText(null)}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value.replace(",", ".").trim());
          if (e.target.value.trim() !== "" && Number.isFinite(n) && n >= min && n <= max) onChange(Math.round(n / step) * step);
        }}
        suffix={suffix ? <span className="text-sm">{suffix}</span> : undefined}
        className="num"
      />
    </span>
  );
}

function PercentInput({ value, onChange, ...rest }: { label: string; value: number; min: number; max: number; step?: number; onChange: (rate: number) => void; disabled?: boolean }) {
  return <NumberInput {...rest} suffix="%" value={Math.round(value * 1000) / 10} onChange={(v) => onChange(Math.round(v * 10) / 1000)} />;
}

function CountInput(props: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; disabled?: boolean }) {
  return <NumberInput {...props} width="w-16" />;
}

function InlineMoney({ label, value, onChange, disabled }: { label: string; value: number; onChange: (cents: number) => void; disabled?: boolean }) {
  return (
    <span className="inline-block w-28 align-middle">
      <MoneyInput aria-label={label} value={value} onChange={(v) => onChange(Math.max(0, v ?? 0))} allowEmpty={false} disabled={disabled} />
    </span>
  );
}

const DECISION: Record<NegotiationResult["decision"], { title: string; tone: string; dot: string }> = {
  accept: { title: "Offre acceptée", tone: "text-success", dot: "bg-success" },
  counter: { title: "Contre-proposition", tone: "text-accent", dot: "bg-accent-vivid" },
  escalate: { title: "À vous de décider", tone: "text-warning", dot: "bg-warning" },
  decline: { title: "Offre refusée", tone: "text-danger", dot: "bg-danger" },
  hold: { title: "Réponse différée", tone: "text-text-muted", dot: "bg-border-strong" },
};

const EXAMPLE = { listed: 4000, cost: 1500, floor: null as number | null, offer: 3000 };

function Simulator({ rules }: { rules: MarginRules }) {
  const client = useClient();
  const items = useQuery({ queryKey: ["items", { status: "listed", view: "selling-rules" }], queryFn: () => client.listItems({ status: "listed", pageSize: 100 }) });
  const [source, setSource] = useState("example");
  const [listed, setListed] = useState<number | null>(EXAMPLE.listed);
  const [cost, setCost] = useState<number | null>(EXAMPLE.cost);
  const [floor, setFloor] = useState<number | null>(EXAMPLE.floor);
  const [offer, setOffer] = useState<number | null>(EXAMPLE.offer);
  const [rounds, setRounds] = useState(0);

  const pick = (id: string) => {
    setSource(id);
    const it: InventoryItem | undefined = items.data?.items.find((i) => i.id === id);
    const l = it ? it.listedPriceCents : EXAMPLE.listed;
    setListed(l);
    setCost(it ? it.purchasePriceCents + it.purchaseFeesCents : EXAMPLE.cost);
    setFloor(it ? it.floorPriceCents : EXAMPLE.floor);
    setOffer(l ? Math.round((l * 0.75) / 100) * 100 : null);
    setRounds(0);
  };

  const item: ItemPricing = { purchasePriceCents: cost ?? 0, purchaseFeesCents: 0, listedPriceCents: listed, floorPriceCents: floor };
  const valid = listed !== null && listed > 0 && offer !== null && offer > 0;
  const result = valid ? evaluateOffer({ item, offerCents: offer, rules, roundsSoFar: rounds }) : null;
  const suggested = suggestFloorPrice(item, rules);
  const acceptFrom = valid ? lowestAcceptedOffer(item, rules, rounds) : null;
  const path = valid ? negotiationPath(item, offer, rules, { fromRound: rounds }) : [];
  const counterMargin = result?.counterCents ? projectedMargin(item, rules, result.counterCents) : null;
  const roundOptions = Array.from({ length: Math.max(3, rules.maxRoundsPerCustomer) + 1 }, (_, i) => ({ value: String(i), label: String(i) }));

  return (
    <Card>
      <h2 className="text-md font-semibold">Simulateur</h2>
      <p className="mt-1 text-sm text-text-muted">Testez une offre : la réponse est exactement celle que Selio donnera dans la Messagerie, avec les règles ci-contre, même non enregistrées.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Article" className="sm:col-span-2">{(p) => (
          <Select id={p.id} value={source} onChange={(e) => pick(e.target.value)}>
            <option value="example">Exemple : veste à 40 €, achetée 15 €</option>
            {(items.data?.items ?? []).filter((i) => i.listedPriceCents).map((i) => <option key={i.id} value={i.id}>{i.title} · {formatCents(i.listedPriceCents!)}</option>)}
          </Select>
        )}</Field>
        <Field label="Prix affiché">{(p) => <MoneyInput id={p.id} value={listed} onChange={setListed} />}</Field>
        <Field label="Coût d'achat" hint="Frais d'achat compris.">{(p) => <MoneyInput id={p.id} aria-describedby={p.describedBy} value={cost} onChange={setCost} />}</Field>
        <Field label="Plancher de l'article" hint={floor === null ? `Vide : plancher suggéré, ${formatCents(suggested)}.` : "Saisi sur l'article : prioritaire."}>{(p) => <MoneyInput id={p.id} aria-describedby={p.describedBy} value={floor} onChange={setFloor} placeholder="Suggéré" />}</Field>
        <Field label="Offre de l'acheteur">{(p) => <MoneyInput id={p.id} value={offer} onChange={setOffer} />}</Field>
      </div>
      {listed ? (
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Offres types">
          {[0.1, 0.2, 0.3, 0.4].map((d) => {
            const v = Math.round((listed * (1 - d)) / 100) * 100;
            return <button key={d} type="button" onClick={() => setOffer(v)} className={cn("num h-7 rounded-full px-3 text-xs font-medium transition-colors", offer === v ? "bg-accent-soft text-accent" : "border border-border text-text-muted hover:text-text")}>−{Math.round(d * 100)} % · {formatCents(v)}</button>;
          })}
        </div>
      ) : null}
      <div className="mt-4">
        <p className="mb-1.5 text-sm font-medium text-text">Contre-propositions déjà faites à cet acheteur</p>
        <Segmented ariaLabel="Contre-propositions déjà faites" size="sm" value={String(rounds)} onChange={(v) => setRounds(Number(v))} items={roundOptions} />
      </div>

      {result && valid ? (
        <div className="mt-5 rounded-lg bg-surface-muted p-4" aria-live="polite" data-testid="simulation-result">
          <p className={cn("num flex items-center gap-2 text-md font-semibold", DECISION[result.decision].tone)}><span className={cn("size-2 shrink-0 rounded-full", DECISION[result.decision].dot)} aria-hidden />{result.decision === "counter" && result.counterCents !== null ? `${DECISION.counter.title} à ${formatCents(result.counterCents)}` : DECISION[result.decision].title}</p>
          <p className="mt-1 text-sm text-text">{explain(result, offer)}</p>
          <dl className="num mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div><dt className="text-xs text-text-muted">Marge à {formatCents(offer)}</dt><dd className={cn("font-medium", result.marginAtOfferCents < 0 ? "text-danger" : "text-text")}>{formatCents(result.marginAtOfferCents)} ({formatPercent(result.marginRateAtOffer)})</dd></div>
            {counterMargin && result.counterCents !== null ? <div><dt className="text-xs text-text-muted">Marge à {formatCents(result.counterCents)}</dt><dd className="font-medium text-text">{formatCents(counterMargin.marginCents)} ({formatPercent(counterMargin.marginRate)})</dd></div> : null}
            <div><dt className="text-xs text-text-muted">Plancher appliqué</dt><dd className="font-medium text-text">{formatCents(result.floorCents)}{floor === null ? " (suggéré)" : ""}</dd></div>
            {acceptFrom !== null ? <div><dt className="text-xs text-text-muted">Acceptée d'office dès</dt><dd className="font-medium text-text">{formatCents(acceptFrom)}</dd></div> : null}
          </dl>
          <PriceScale listed={listed} floor={result.floorCents} acceptFrom={acceptFrom} offer={offer} counter={result.counterCents} />
          <details className="mt-3 text-xs text-text-muted">
            <summary className="cursor-pointer font-medium text-text">Le raisonnement du moteur</summary>
            <ul className="mt-2 flex flex-col gap-1">{result.reasons.map((r, i) => <li key={i} className="flex gap-1.5"><Check className="mt-0.5 size-3 shrink-0" aria-hidden />{r}</li>)}</ul>
          </details>
        </div>
      ) : <p className="mt-5 rounded-lg bg-surface-muted p-4 text-sm text-text-muted">Indiquez un prix affiché et une offre pour voir la réponse.</p>}

      {valid && path.length > 1 ? (
        <div className="mt-4">
          <p className="text-sm font-medium text-text">Si l'acheteur maintient {formatCents(offer)}</p>
          <ol className="mt-2 flex flex-col gap-1.5 text-sm">
            {path.map((s, i) => (
              <li key={i} className="flex items-baseline gap-2">
                <span className="num w-20 shrink-0 text-xs text-text-muted">{ordinal(rounds + i + 1)} réponse</span>
                <span className={DECISION[s.decision].tone}>{s.decision === "counter" && s.counterCents !== null ? `Contre-proposition à ${formatCents(s.counterCents)}` : s.decision === "escalate" ? "L'offre vous est confiée" : DECISION[s.decision].title}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </Card>
  );
}

function ordinal(n: number): string {
  return n === 1 ? "1re" : `${n}e`;
}

function explain(r: NegotiationResult, offer: number): string {
  switch (r.decision) {
    case "accept":
      return `Selio accepte ${formatCents(offer)} : il vous reste ${formatCents(r.marginAtOfferCents)} de marge.`;
    case "counter":
      return `Selio ne prend pas ${formatCents(offer)} et propose ${formatCents(r.counterCents ?? offer)} à l'acheteur, sans descendre sous le plancher.`;
    case "escalate":
      return "Selio ne répond pas seul : l'offre vous est confiée dans la Messagerie, avec ce calcul sous les yeux.";
    case "decline":
      return "Offre nulle ou invalide : elle est refusée.";
    case "hold":
      return "Hors des horaires autorisés : la réponse attend la prochaine plage.";
  }
}

/** Échelle de prix : zone acceptée d'office, plancher, offre et contre-proposition. */
function PriceScale({ listed, floor, acceptFrom, offer, counter }: { listed: number; floor: number; acceptFrom: number | null; offer: number; counter: number | null }) {
  const lo = Math.min(offer, floor, acceptFrom ?? listed) * 0.9;
  const hi = Math.max(listed, offer);
  const pos = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / Math.max(1, hi - lo)) * 100))}%`;
  const marks = [
    { v: floor, label: "Plancher", cls: "bg-text-muted" },
    { v: offer, label: "Offre", cls: "bg-surface ring-2 ring-inset ring-accent-vivid" },
    ...(counter !== null ? [{ v: counter, label: "Contre-proposition", cls: "bg-accent-vivid" }] : []),
  ];
  return (
    <figure className="mt-4" aria-label={`Échelle de prix jusqu'à ${formatCents(listed)}`}>
      <div className="relative h-2 rounded-full bg-surface">
        {acceptFrom !== null ? <div className="absolute inset-y-0 rounded-full bg-success/30" style={{ left: pos(acceptFrom), right: `calc(100% - ${pos(listed)})` }} /> : null}
        {marks.map((m) => <span key={m.label} className={cn("absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-sm", m.cls)} style={{ left: pos(m.v) }} aria-hidden />)}
        <span className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-text" style={{ left: pos(listed) }} aria-hidden />
      </div>
      <figcaption className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-success/30" aria-hidden />Acceptée d'office</span>
        {marks.map((m) => <span key={m.label} className="num inline-flex items-center gap-1.5"><span className={cn("size-2.5 rounded-full", m.cls)} aria-hidden />{m.label} {formatCents(m.v)}</span>)}
        <span className="num inline-flex items-center gap-1.5"><span className="h-2.5 w-0.5 rounded-full bg-text" aria-hidden />Prix affiché {formatCents(listed)}</span>
      </figcaption>
    </figure>
  );
}

/** Le déroulé d'une offre en trois temps, écrit avec les valeurs en cours. */
function HowItWorks({ rules }: { rules: MarginRules }) {
  const example = 4000;
  const firstCounter = example - applyRate(example, rules.counterStepRate);
  return (
    <Card>
      <h2 className="text-md font-semibold">Comment Selio répond à une offre</h2>
      <ol className="mt-3 flex flex-col gap-3 text-sm">
        <Step n={1} title="Accepter">L'offre respecte le plancher, vos marges et ne dépasse pas {pct(rules.maxDiscountRate)} de remise : elle est acceptée.</Step>
        <Step n={2} title="Contre-proposer">Sinon, Selio propose un prix plus haut, en descendant de {pct(rules.counterStepRate)} à chaque tour (sur un article à 40 € : {formatCents(firstCounter)} d'abord), jamais sous le plancher.</Step>
        <Step n={3} title="Vous passer la main">{rules.maxRoundsPerCustomer === 0 ? "Aucune contre-proposition automatique : toute offre trop basse vous est confiée." : `Après ${rules.maxRoundsPerCustomer} contre-proposition${rules.maxRoundsPerCustomer > 1 ? "s" : ""} au même acheteur, l'offre vous est confiée.`}</Step>
      </ol>
      <p className="mt-4 text-xs text-text-muted">Dans la Messagerie, la réponse est préparée en brouillon, que vous relisez avant de l'envoyer. Les automatisations de négociation suivent leur propre réglage de validation.</p>
      <Link to="/app/automations" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">Négociation automatique dans les automatisations <ArrowRight className="size-3.5" aria-hidden /></Link>
    </Card>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="num inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent" aria-hidden>{n}</span>
      <span><span className="font-medium text-text">{title}.</span> <span className="text-text-muted">{children}</span></span>
    </li>
  );
}
