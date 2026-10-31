import { roundOffer } from "@selio/domain";
import { PageHeader, Toggle, formatCents } from "@selio/ui";
import { BUYER, ChatMock, HonestNote, Journey, JourneyStep, NumberInput, PercentInput, SAMPLE, SaveBar, Sentence, TemplateField, pct, sample, type ChatLine } from "./shared";
import { useAutomationSection } from "./shared";

const PRICE = 2000;

/** Messages aux favoris : écrire à l'acheteur qui met un article en favori, avec une petite remise. */
export default function Favorites() {
  const { draft: f, patch, dirty, editable, save, reset } = useAutomationSection("favorites");
  const offer = roundOffer(PRICE * (1 - f.offerRate));
  const delay = f.delayMinutes >= 60 ? `${Math.round(f.delayMinutes / 60)} h` : `${f.delayMinutes} min`;
  return (
    <>
      <PageHeader eyebrow="Automatisation" title="Messages aux favoris" description="Un favori, c'est un acheteur qui hésite. Selio lui écrit au bon moment, avec une petite remise si vous le voulez : c'est souvent ce qui déclenche la vente." />
      <div className="card mb-8 p-5">
        <Toggle label="Écrire aux acheteurs qui ajoutent un article en favori" description={f.enabled ? "Activé sur vos comptes Vente." : "Désactivé : aucun message n'est envoyé."} checked={f.enabled} onChange={(v) => patch({ enabled: v })} disabled={!editable} />
      </div>
      <Journey label="Réglages des messages aux favoris">
        <JourneyStep n={1} level="Essentiel" title="Quand écrire" done intro={<>Trop tôt, ça fait insistant ; trop tard, l'acheteur est passé à autre chose. <strong className="text-text">30 minutes</strong> est un bon début.</>}
          illustration={<ChatMock priceCents={PRICE} caption={`Message envoyé ${delay} après le favori.`} lines={[
            { from: "event", text: `${BUYER} a ajouté l'article à ses favoris`, tone: "accent", time: "12:10" },
            { from: "event", text: `Selio attend ${delay}`, tone: "muted" },
            { from: "seller", text: sample(f.message, offer, PRICE), time: "12:40", auto: true },
          ]} />}>
          <Sentence>J'écris <NumberInput label="Délai après le favori (minutes)" value={f.delayMinutes} min={0} max={1440} width="w-20" suffix="min" disabled={!editable} onChange={(v) => patch({ delayMinutes: v })} /> après l'ajout en favori.</Sentence>
          <Toggle label="Une seule fois par acheteur" description="Un acheteur qui met dix articles en favori ne reçoit qu'un message." checked={f.onlyOncePerBuyer} onChange={(v) => patch({ onlyOncePerBuyer: v })} disabled={!editable} />
        </JourneyStep>
        <JourneyStep n={2} level="Intermédiaire" title="La remise proposée" done intro={<>Une offre Vinted envoyée avec le message (0 % = message seul). Elle respecte toujours la <strong className="text-text">marge de négociation</strong> de l'article.</>}
          illustration={<ChatMock priceCents={PRICE} caption={f.offerRate > 0 ? `Remise de ${pct(f.offerRate)} : ${formatCents(offer)} au lieu de ${formatCents(PRICE)}.` : "Message seul, sans offre."} lines={[
            { from: "seller", text: sample(f.message, offer, PRICE), time: "12:40", auto: true },
            ...(f.offerRate > 0 ? [{ from: "offer", by: "seller", cents: offer, originalCents: PRICE, status: "proposée", auto: true } as ChatLine, { from: "event", text: `${BUYER} a accepté votre offre`, tone: "success", time: "12:52" } as ChatLine] : []),
          ]} />}>
          <Sentence>Je propose <PercentInput label="Remise proposée (%)" value={f.offerRate} min={0} max={50} disabled={!editable} onChange={(v) => patch({ offerRate: v })} /> de remise avec le message.</Sentence>
        </JourneyStep>
        <JourneyStep n={3} level="Avancé" title="Le message" last done intro={<>Court, chaleureux, avec le prénom et l'article. L'IA adapte la tournure ; <strong className="text-text">le prix vient de vos réglages</strong>.</>}
          illustration={<ChatMock priceCents={PRICE} caption={`Exemple avec « ${SAMPLE.title} ».`} lines={[{ from: "seller", text: sample(f.message, offer, PRICE), time: "12:40", auto: true }]} />}>
          <TemplateField label="Message aux favoris" value={f.message} onChange={(v) => patch({ message: v })} disabled={!editable} />
        </JourneyStep>
      </Journey>
      <SaveBar dirty={dirty} editable={editable} pending={save.isPending} onSave={() => save.mutate(undefined)} onReset={reset} />
      <HonestNote />
    </>
  );
}
