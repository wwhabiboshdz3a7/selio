import { useState } from "react";
import { Link } from "react-router";
import { Plus, Trash2 } from "lucide-react";
import type { MarginRules, NegotiationAutomation } from "@selio/contracts";
import { bandFor, bandLabels, can, droppedPrice, lotDiscountRate, lowestPrice, roundOffer, stepPrices } from "@selio/domain";
import { Button, IconButton, PageHeader, Segmented, Toggle, buttonClass, formatCents } from "@selio/ui";
import { useClient, useRequiredSession } from "../../../lib/data/provider";
import { useAppMutation } from "../../components/hooks";
import { BUYER, ChatMock, HonestNote, InlineMoney, Journey, JourneyStep, NumberInput, PercentInput, PhoneCard, SAMPLE, SaveBar, Sentence, TemplateField, pct, sample, type ChatLine } from "./shared";

const EXAMPLES = [800, 1500, 3000, 6000] as const;
const eur = (c: number) => formatCents(c);

/**
 * Négociation automatique, en parcours vertical : dix étapes de haut en bas,
 * de la plus simple (marge par tranche de prix) à la plus avancée (délais
 * d'envoi). Chaque étape montre, à droite, une conversation d'exemple jouée
 * avec les réglages en cours. Pas de profil tout fait : vous réglez, l'IA
 * rédige les messages, et la marge minimale reste un garde-fou.
 */
export default function Negotiation() {
  const client = useClient();
  const session = useRequiredSession();
  const all = session.org.settings.automation;
  const savedNego = all.negotiation;
  const savedMargin = session.org.settings.margin;
  const [n, setN] = useState<NegotiationAutomation>(savedNego);
  const [margin, setMargin] = useState<MarginRules>(savedMargin);
  const [example, setExample] = useState<number>(1500);
  const editable = can(session.role, "org.update");
  const dirty = JSON.stringify(n) !== JSON.stringify(savedNego) || margin.minMarginCents !== savedMargin.minMarginCents || margin.minMarginRate !== savedMargin.minMarginRate;
  const save = useAppMutation(() => client.updateOrg({ settings: { automation: { ...all, negotiation: n }, margin } }), { invalidate: ["session", "conversation", "conversations", "items", "dressing"], success: "Négociation enregistrée" });
  const set = <K extends keyof NegotiationAutomation>(k: K, v: NegotiationAutomation[K]) => setN((x) => ({ ...x, [k]: v }));
  const msg = (k: keyof NegotiationAutomation["messages"], v: string) => setN((x) => ({ ...x, messages: { ...x.messages, [k]: v } }));

  const price = example;
  const band = bandFor(price, n.bands);
  const steps = stepPrices(price, n);
  const floor = lowestPrice(price, n);
  const low = roundOffer(price * 0.6);
  const first = steps[0]!;
  const final = steps[steps.length - 1]!;
  const sorted = [...n.bands].sort((a, b) => (a.upToCents ?? Infinity) - (b.upToCents ?? Infinity));
  const labels = bandLabels(sorted, eur);
  const lotTotal = price + 1200;
  const lotRate = lotDiscountRate(2, n.lot);

  return (
    <>
      <PageHeader
        eyebrow="Automatisation"
        title="Négociation automatique"
        description="Répondez aux offres des acheteurs sans y passer vos soirées. Descendez le parcours : chaque étape se règle en une minute, de la plus simple à la plus avancée, et la conversation d'exemple à droite montre ce que l'acheteur recevra."
        actions={<Link to="/app/messages" className={buttonClass({ variant: "secondary" })}>Voir la messagerie</Link>}
      />
      <div className="card mb-8 flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
        <Toggle label="Négociation automatique activée" description={n.enabled ? "Selio répond aux offres selon les étapes ci-dessous." : "Arrêtée : les offres vous sont confiées dans la messagerie."} checked={n.enabled} onChange={(v) => set("enabled", v)} disabled={!editable} />
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-text-muted">Article d'exemple pour les illustrations</span>
          <Segmented ariaLabel="Prix de l'article d'exemple" size="sm" value={String(example)} onChange={(v) => setExample(Number(v))} items={EXAMPLES.map((c) => ({ value: String(c), label: eur(c) }))} />
        </div>
      </div>

      <Journey label="Étapes de la négociation automatique">
        <JourneyStep
          n={1}
          level="Essentiel"
          title="Règles de négociation"
          done
          intro={<>La <strong className="text-text">marge de négociation</strong>, c'est la remise maximale que vous acceptez, selon le prix de l'article. Un petit article se négocie peu, un gros un peu plus. Selio ne descend jamais plus bas.</>}
          illustration={<ChatMock priceCents={price} caption={<>Article à {eur(price)} : tranche « {labels[sorted.indexOf(band)]} », marge {pct(band.marginRate)} → jamais sous <strong className="text-text">{eur(floor)}</strong>.</>} lines={[
            { from: "buyer", text: `Bonjour, vous me le laissez à ${eur(low)} ?`, time: "14:02" },
            { from: "offer", by: "buyer", cents: low, originalCents: price, status: "proposée" },
            { from: "event", text: `Marge de ${pct(band.marginRate)} : prix le plus bas ${eur(floor)}`, tone: "accent" },
            { from: "seller", text: sample(n.messages.counter, first.priceCents, price), time: "14:07", auto: true },
          ]} />}
        >
          <ul className="flex flex-col gap-2">
            {sorted.map((b, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border px-3 py-2 text-sm text-text">
                {b.upToCents === null ? <span className="w-44 font-semibold">{labels[i]}</span> : (
                  <span className="flex w-44 items-center gap-1.5 font-semibold">Jusqu'à <InlineMoney label={`Plafond de la tranche ${i + 1}`} value={b.upToCents} disabled={!editable} onChange={(v) => set("bands", sorted.map((x, j) => (j === i ? { ...x, upToCents: v } : x)))} /></span>
                )}
                <span className="text-text-muted">→ marge de négociation</span>
                <PercentInput label={`Marge de la tranche ${i + 1} (%)`} value={b.marginRate} min={0} max={80} disabled={!editable} onChange={(v) => set("bands", sorted.map((x, j) => (j === i ? { ...x, marginRate: v } : x)))} />
                {b.upToCents !== null && sorted.length > 1 ? <IconButton label={`Supprimer la tranche ${i + 1}`} size="sm" className="ml-auto" disabled={!editable} onClick={() => set("bands", sorted.filter((_, j) => j !== i))}><Trash2 /></IconButton> : null}
              </li>
            ))}
          </ul>
          {editable && sorted.length < 8 ? (
            <Button variant="ghost" size="sm" icon={<Plus />} className="self-start" onClick={() => {
              const open = sorted.filter((b) => b.upToCents !== null);
              const last = open.at(-1)?.upToCents ?? 999;
              set("bands", [...open, { upToCents: last + 2000, marginRate: band.marginRate }, ...sorted.filter((b) => b.upToCents === null)]);
            }}>Ajouter une tranche</Button>
          ) : null}
          <Sentence hint="Garde-fou calculé sur le prix d'achat de chaque article (le prix plancher d'un article saisi à la main reste prioritaire).">
            Et quoi qu'il arrive, je garde au moins <PercentInput label="Marge minimale (%)" value={margin.minMarginRate} min={0} max={90} disabled={!editable} onChange={(v) => setMargin((m) => ({ ...m, minMarginRate: v }))} /> et <InlineMoney label="Marge minimale (€)" value={margin.minMarginCents} disabled={!editable} onChange={(v) => setMargin((m) => ({ ...m, minMarginCents: v }))} /> de marge par article.
          </Sentence>
        </JourneyStep>

        <JourneyStep
          n={2}
          level="Essentiel"
          title="Étapes de réduction de prix"
          done
          intro={<>Selio ne lâche pas toute la marge d'un coup : chaque contre-offre en accorde <strong className="text-text">une part de plus</strong>. Par exemple 60 % de la marge, puis 75 %, puis 100 % : la dernière étape est l'offre finale.</>}
          illustration={<ChatMock priceCents={price} caption={<>Trois offres trop basses de {BUYER} : Selio descend {steps.map((s) => eur(s.priceCents)).join(" → ")}, puis s'arrête.</>} lines={[
            { from: "offer", by: "buyer", cents: low, status: "refusée", time: "14:02" },
            ...steps.flatMap((s, i): ChatLine[] => [
              { from: "offer", by: "seller", cents: s.priceCents, originalCents: price, status: s.final ? "finale" : "proposée", auto: true, time: `14:${String(7 + i * 9).padStart(2, "0")}` },
              ...(s.final ? [] : [{ from: "offer", by: "buyer", cents: roundOffer(low + (i + 1) * 100), status: "refusée" } as ChatLine]),
            ]),
          ]} />}
        >
          <ol className="flex flex-col gap-2">
            {n.steps.map((share, i) => {
              const isLast = i === n.steps.length - 1;
              return (
                <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border px-3 py-2 text-sm text-text">
                  <span className="w-36 font-semibold">{isLast ? "Offre finale" : `Contre-offre ${i + 1}`}</span>
                  {isLast ? <span className="num w-[5.5rem] text-center font-semibold">100 %</span> : <PercentInput label={`Part de la marge, contre-offre ${i + 1} (%)`} value={share} min={5} max={99} disabled={!editable} onChange={(v) => set("steps", n.steps.map((x, j) => (j === i ? v : x)))} />}
                  <span className="text-text-muted">de la marge</span>
                  <span className="num ml-auto text-text-muted">soit {eur(steps[i]?.priceCents ?? price)} sur l'exemple</span>
                  {!isLast && n.steps.length > 2 ? <IconButton label={`Supprimer la contre-offre ${i + 1}`} size="sm" disabled={!editable} onClick={() => set("steps", n.steps.filter((_, j) => j !== i))}><Trash2 /></IconButton> : null}
                </li>
              );
            })}
          </ol>
          {editable && n.steps.length < 5 ? <Button variant="ghost" size="sm" icon={<Plus />} className="self-start" onClick={() => set("steps", [...n.steps.slice(0, -1), Math.min(0.95, (n.steps.at(-2) ?? 0.5) + 0.1), 1].sort((a, b) => a - b))}>Ajouter une contre-offre</Button> : null}
          <p className="text-xs text-text-muted">Une offre au-dessus de l'étape en cours est acceptée tout de suite. Les parts sont rangées de la plus petite à la plus grande.</p>
        </JourneyStep>

        <JourneyStep
          n={3}
          level="Intermédiaire"
          title="Négociation de lot"
          done={n.lot.enabled}
          intro={<>Quand un acheteur prend <strong className="text-text">plusieurs articles</strong>, Selio lui propose une remise de lot, en plus de la négociation article par article.</>}
          illustration={<ChatMock priceCents={price} caption={n.lot.enabled ? <>Lot de 2 articles ({eur(lotTotal)}) : remise de {pct(lotRate)} → {eur(roundOffer(lotTotal * (1 - lotRate)))}.</> : "Remise de lot désactivée : chaque article se négocie seul."} lines={[
            { from: "buyer", text: `Je prends aussi « ${SAMPLE.second?.title ?? "le pull rayé"} », vous faites un prix pour les deux ?`, time: "18:40" },
            ...(n.lot.enabled ? [
              { from: "seller", text: `Bien sûr ! Pour les deux, je vous fais ${pct(lotRate)} de remise : ${eur(roundOffer(lotTotal * (1 - lotRate)))} au lieu de ${eur(lotTotal)}.`, time: "18:46", auto: true },
              { from: "offer", by: "seller", cents: roundOffer(lotTotal * (1 - lotRate)), originalCents: lotTotal, status: "lot", auto: true },
            ] as ChatLine[] : [{ from: "event", text: "Remise de lot désactivée : la question vous est confiée", tone: "muted" } as ChatLine]),
          ]} />}
        >
          <Toggle label="Proposer une remise de lot" checked={n.lot.enabled} onChange={(v) => set("lot", { ...n.lot, enabled: v })} disabled={!editable} />
          <Sentence>Pour 2 articles : <PercentInput label="Remise pour 2 articles (%)" value={n.lot.twoItemsRate} min={0} max={60} disabled={!editable || !n.lot.enabled} onChange={(v) => set("lot", { ...n.lot, twoItemsRate: v })} /> de remise ; pour 3 articles et plus : <PercentInput label="Remise pour 3 articles et plus (%)" value={n.lot.threePlusRate} min={0} max={60} disabled={!editable || !n.lot.enabled} onChange={(v) => set("lot", { ...n.lot, threePlusRate: v })} />.</Sentence>
        </JourneyStep>

        <JourneyStep
          n={4}
          level="Intermédiaire"
          title="Réductions de prix"
          done={n.priceDrops.enabled}
          intro={<>Un article qui ne part pas peut <strong className="text-text">baisser tout seul</strong>, petit à petit, sans jamais passer sous un plancher. Les acheteurs qui l'ont en favori sont prévenus par Vinted.</>}
          illustration={<PhoneCard title="Votre annonce, jour après jour" caption={n.priceDrops.enabled ? `Baisse de ${pct(n.priceDrops.rate)} tous les ${n.priceDrops.afterDays} jours, jamais sous ${pct(n.priceDrops.floorRate)} du prix de départ.` : "Baisses automatiques désactivées : le prix ne bouge pas."}>
            <ul className="flex flex-col gap-1.5 text-sm">
              {[0, 1, 2, 3, 6].map((k) => {
                const days = k * n.priceDrops.afterDays;
                const p = droppedPrice(price, days, n.priceDrops);
                return (
                  <li key={k} className="flex items-center justify-between rounded-lg bg-surface px-3 py-2">
                    <span className="text-text-muted">{k === 0 ? "Mise en ligne" : `Jour ${days}`}</span>
                    <span className="num font-semibold text-text">{eur(p)}{p < price ? <span className="ml-2 text-xs font-normal text-success">−{pct(1 - p / price)}</span> : null}</span>
                  </li>
                );
              })}
            </ul>
          </PhoneCard>}
        >
          <Toggle label="Baisser le prix des articles qui ne partent pas" checked={n.priceDrops.enabled} onChange={(v) => set("priceDrops", { ...n.priceDrops, enabled: v })} disabled={!editable} />
          <Sentence hint="Le dressing intelligent continue de proposer les republications ; les deux se combinent.">
            Tous les <NumberInput label="Jours entre deux baisses" value={n.priceDrops.afterDays} min={1} max={90} width="w-16" disabled={!editable || !n.priceDrops.enabled} onChange={(v) => set("priceDrops", { ...n.priceDrops, afterDays: v })} /> jours sans vente, je baisse de <PercentInput label="Baisse (%)" value={n.priceDrops.rate} min={1} max={30} disabled={!editable || !n.priceDrops.enabled} onChange={(v) => set("priceDrops", { ...n.priceDrops, rate: v })} />, sans descendre sous <PercentInput label="Plancher (% du prix de départ)" value={n.priceDrops.floorRate} min={10} max={100} disabled={!editable || !n.priceDrops.enabled} onChange={(v) => set("priceDrops", { ...n.priceDrops, floorRate: v })} /> du prix de départ.
          </Sentence>
        </JourneyStep>

        <JourneyStep
          n={5}
          level="Intermédiaire"
          title="Messages personnalisés"
          done
          intro={<>Le premier message donne le ton. Écrivez-le <strong className="text-text">comme vous parlez</strong> : Selio remplace le prénom, l'article et le prix, et l'IA ajuste la tournure à chaque acheteur.</>}
          illustration={<ChatMock priceCents={price} caption="Le message d'accueil part avant la première contre-offre." lines={[
            { from: "buyer", text: "Bonjour ! Il est toujours disponible ?", time: "09:12" },
            { from: "seller", text: sample(n.messages.greeting, price), time: "09:15", auto: true },
          ]} />}
        >
          <TemplateField label="Message d'accueil" value={n.messages.greeting} onChange={(v) => msg("greeting", v)} disabled={!editable} hint="Variables : prénom de l'acheteur, titre de l'article, prix." />
        </JourneyStep>

        <JourneyStep
          n={6}
          level="Avancé"
          title="Messages de contre-offre"
          done
          intro={<>Quand l'acheteur propose trop bas, Selio <strong className="text-text">contre-propose</strong> au prix de l'étape en cours, avec ce message. Si l'acheteur re-propose, on passe à l'étape suivante.</>}
          illustration={<ChatMock priceCents={price} caption={`Contre-offre à ${eur(first.priceCents)} (${pct(first.share)} de la marge), envoyée comme une vraie offre Vinted.`} lines={[
            { from: "offer", by: "buyer", cents: low, status: "refusée", time: "20:31" },
            { from: "seller", text: sample(n.messages.counter, first.priceCents, price), time: "20:36", auto: true },
            ...(n.timing.sendOffers ? [{ from: "offer", by: "seller", cents: first.priceCents, originalCents: price, status: "proposée", auto: true } as ChatLine] : []),
          ]} />}
        >
          <TemplateField label="Message de contre-offre" value={n.messages.counter} onChange={(v) => msg("counter", v)} disabled={!editable} />
        </JourneyStep>

        <JourneyStep
          n={7}
          level="Avancé"
          title="Messages d'offre finale"
          done
          intro={<>À la dernière étape, Selio annonce son <strong className="text-text">dernier prix</strong>. Un second message, plus tard, relance l'acheteur s'il n'a pas répondu.</>}
          illustration={<ChatMock priceCents={price} caption={`Offre finale à ${eur(final.priceCents)}, puis relance si ${BUYER} ne répond pas.`} lines={[
            { from: "seller", text: sample(n.messages.final, final.priceCents, price), time: "21:02", auto: true },
            { from: "offer", by: "seller", cents: final.priceCents, originalCents: price, status: "finale", auto: true },
            { from: "event", text: "3 h sans réponse", tone: "muted" },
            { from: "seller", text: sample(n.messages.afterFinal, final.priceCents, price), time: "00:02", auto: true },
          ]} />}
        >
          <TemplateField label="Message d'offre finale" value={n.messages.final} onChange={(v) => msg("final", v)} disabled={!editable} />
          <TemplateField label="Message après l'offre finale (relance)" value={n.messages.afterFinal} onChange={(v) => msg("afterFinal", v)} disabled={!editable} />
        </JourneyStep>

        <JourneyStep
          n={8}
          level="Avancé"
          title="Messages après acceptation"
          done
          intro={<>L'acheteur accepte ou achète : un mot de remerciement <strong className="text-text">immédiat</strong> rassure et évite les annulations.</>}
          illustration={<ChatMock priceCents={price} caption="Envoyé dès que l'offre est acceptée." lines={[
            { from: "offer", by: "seller", cents: first.priceCents, originalCents: price, status: "acceptée", auto: true, time: "20:36" },
            { from: "event", text: `${BUYER} a accepté votre offre`, tone: "success", time: "20:51" },
            { from: "seller", text: sample(n.messages.accepted, first.priceCents, price), time: "20:53", auto: true },
          ]} />}
        >
          <TemplateField label="Message après acceptation" value={n.messages.accepted} onChange={(v) => msg("accepted", v)} disabled={!editable} />
        </JourneyStep>

        <JourneyStep
          n={9}
          level="Avancé"
          title="Messages de repli"
          done
          intro={<>Si la négociation échoue (offre toujours trop basse après l'offre finale), Selio <strong className="text-text">reste aimable</strong> et laisse la porte ouverte, sans descendre plus bas.</>}
          illustration={<ChatMock priceCents={price} caption={`Offre sous ${eur(final.priceCents)} après l'offre finale : message de repli, pas de nouvelle remise.`} lines={[
            { from: "offer", by: "seller", cents: final.priceCents, status: "finale", auto: true, time: "21:02" },
            { from: "offer", by: "buyer", cents: roundOffer(final.priceCents * 0.8), status: "refusée", time: "21:20" },
            { from: "seller", text: sample(n.messages.fallback, final.priceCents, price), time: "21:26", auto: true },
          ]} />}
        >
          <TemplateField label="Message de repli" value={n.messages.fallback} onChange={(v) => msg("fallback", v)} disabled={!editable} />
        </JourneyStep>

        <JourneyStep
          n={10}
          level="Avancé"
          title="Timings et envoi"
          last
          done
          intro={<>Une réponse en 3 secondes fait robot. Selio attend un <strong className="text-text">délai naturel</strong>, ne répond qu'aux heures choisies, et envoie de vraies offres Vinted (bouton « Acheter à ce prix »).</>}
          illustration={<ChatMock priceCents={price} caption={`Réponse entre ${n.timing.minDelayMinutes} et ${n.timing.maxDelayMinutes} min, de ${n.timing.activeFrom} h à ${n.timing.activeTo} h ; offre valable ${n.timing.offerValidityHours} h.`} lines={[
            { from: "offer", by: "buyer", cents: low, status: "refusée", time: "23:41" },
            { from: "event", text: `Hors horaires : réponse à partir de ${n.timing.activeFrom} h`, tone: "muted" },
            { from: "seller", text: sample(n.messages.counter, first.priceCents, price), time: `${String(n.timing.activeFrom).padStart(2, "0")}:0${Math.min(9, Math.max(1, n.timing.minDelayMinutes))}`, auto: true },
            ...(n.timing.sendOffers ? [{ from: "offer", by: "seller", cents: first.priceCents, originalCents: price, status: "proposée", auto: true } as ChatLine, { from: "event", text: `Offre valable ${n.timing.offerValidityHours} h`, tone: "accent" } as ChatLine] : []),
          ]} />}
        >
          <Sentence>Je réponds entre <NumberInput label="Délai minimal (minutes)" value={n.timing.minDelayMinutes} min={0} max={240} width="w-16" disabled={!editable} onChange={(v) => set("timing", { ...n.timing, minDelayMinutes: v, maxDelayMinutes: Math.max(v, n.timing.maxDelayMinutes) })} /> et <NumberInput label="Délai maximal (minutes)" value={n.timing.maxDelayMinutes} min={0} max={480} width="w-16" disabled={!editable} onChange={(v) => set("timing", { ...n.timing, maxDelayMinutes: Math.max(v, n.timing.minDelayMinutes) })} /> minutes après l'offre, de <NumberInput label="Début des réponses (heure)" value={n.timing.activeFrom} min={0} max={23} width="w-16" suffix="h" disabled={!editable} onChange={(v) => set("timing", { ...n.timing, activeFrom: v, activeTo: Math.max(v + 1, n.timing.activeTo) })} /> à <NumberInput label="Fin des réponses (heure)" value={n.timing.activeTo} min={1} max={24} width="w-16" suffix="h" disabled={!editable} onChange={(v) => set("timing", { ...n.timing, activeTo: Math.max(v, n.timing.activeFrom + 1) })} />.</Sentence>
          <Toggle label="Envoyer les contre-offres comme offres Vinted" description="L'acheteur n'a plus qu'à appuyer sur « Acheter » : c'est ce qui transforme le mieux." checked={n.timing.sendOffers} onChange={(v) => set("timing", { ...n.timing, sendOffers: v })} disabled={!editable} />
          <Sentence>Une offre envoyée reste valable <NumberInput label="Validité d'une offre (heures)" value={n.timing.offerValidityHours} min={1} max={72} width="w-16" suffix="h" disabled={!editable || !n.timing.sendOffers} onChange={(v) => set("timing", { ...n.timing, offerValidityHours: v })} />.</Sentence>
        </JourneyStep>
      </Journey>

      <SaveBar dirty={dirty} editable={editable} pending={save.isPending} onSave={() => save.mutate(undefined)} onReset={() => { setN(savedNego); setMargin(savedMargin); }} savedText="Négociation enregistrée : elle s'applique à toutes les offres de vos comptes Vente." />
      <HonestNote />
    </>
  );
}
