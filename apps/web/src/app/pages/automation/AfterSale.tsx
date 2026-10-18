import { Check, Printer, Tag as TagIcon } from "lucide-react";
import { Checkbox, Field, Input, PageHeader, Toggle } from "@selio/ui";
import { BUYER, ChatMock, HonestNote, Journey, JourneyStep, NumberInput, PhoneCard, SAMPLE, SaveBar, Sentence, TemplateField, sample, useAutomationSection } from "./shared";

const PRICE = 1800;

/**
 * Après-vente sans action manuelle : bordereau commandé dès la vente (et
 * imprimé si l'option est cochée), message après la vente, message quand la
 * commande est finalisée, relance du colis au point relais.
 */
export default function AfterSale() {
  const { draft: a, patch, dirty, editable, save, reset } = useAutomationSection("afterSale");
  return (
    <>
      <PageHeader eyebrow="Automatisation" title="Après-vente et bordereaux" description="Dès qu'un article se vend, tout s'enchaîne sans vous : le bordereau est commandé (prêt à l'avance), imprimé si vous le voulez, et l'acheteur reçoit les bons messages au bon moment, jusqu'à la récupération du colis." />
      <Journey label="Étapes de l'après-vente">
        <JourneyStep n={1} level="Essentiel" title="Bordereaux commandés et imprimés" done={a.autoLabels} intro={<>Le bordereau d'envoi est <strong className="text-text">commandé dès la vente</strong> : il est prêt quand vous faites vos colis. Cochez l'impression automatique pour qu'il sorte tout seul de l'imprimante.</>}
          illustration={<PhoneCard title="Vente du jour" caption={a.autoLabels ? (a.autoPrint ? `Commandé et imprimé${a.printer ? ` sur « ${a.printer} »` : ""}, sans un clic.` : "Commandé automatiquement : il ne reste qu'à l'imprimer.") : "Désactivé : le bordereau se commande à la main dans Commandes."}>
            <ul className="flex flex-col gap-2 text-sm">
              <li className="flex items-center gap-2.5 rounded-lg bg-surface px-3 py-2">{SAMPLE.photo ? <img src={SAMPLE.photo} alt="" className="size-9 rounded-md object-cover" /> : null}<span className="min-w-0 flex-1"><span className="block truncate font-semibold text-text">Vendu : {SAMPLE.title}</span><span className="text-xs text-text-muted">à {BUYER} · 14:05</span></span></li>
              <Status ok={a.autoLabels} icon={<TagIcon className="size-4" aria-hidden />} text={a.autoLabels ? "Bordereau commandé · 14:05" : "Bordereau à commander"} />
              <Status ok={a.autoLabels && a.autoPrint} icon={<Printer className="size-4" aria-hidden />} text={a.autoLabels && a.autoPrint ? "Impression lancée · 14:06" : "Impression manuelle"} />
            </ul>
          </PhoneCard>}>
          <Toggle label="Commander le bordereau dès qu'un article se vend" checked={a.autoLabels} onChange={(v) => patch({ autoLabels: v })} disabled={!editable} />
          <Checkbox label="Impression automatique des bordereaux" checked={a.autoPrint} disabled={!editable || !a.autoLabels} onChange={(e) => patch({ autoPrint: e.target.checked })} />
          {a.autoPrint && a.autoLabels ? <Field label="Imprimante" hint="Le nom de l'imprimante du poste où l'extension est ouverte.">{(ids) => <Input id={ids.id} aria-describedby={ids.describedBy} value={a.printer} maxLength={80} placeholder="Imprimante du bureau" disabled={!editable} onChange={(e) => patch({ printer: e.target.value })} />}</Field> : null}
        </JourneyStep>
        <JourneyStep n={2} level="Essentiel" title="Message après la vente" done={a.soldMessage.enabled} intro={<>Envoyé <strong className="text-text">dès l'achat</strong> : l'acheteur sait que le colis se prépare.</>}
          illustration={<ChatMock priceCents={PRICE} caption="Envoyé quelques minutes après l'achat." lines={[
            { from: "event", text: `${BUYER} a acheté l'article`, tone: "success", time: "14:05" },
            ...(a.soldMessage.enabled ? [{ from: "seller" as const, text: sample(a.soldMessage.text, PRICE), time: "14:08", auto: true }] : []),
          ]} />}>
          <Toggle label="Envoyer un message après la vente" checked={a.soldMessage.enabled} onChange={(v) => patch({ soldMessage: { ...a.soldMessage, enabled: v } })} disabled={!editable} />
          <TemplateField label="Message après la vente" value={a.soldMessage.text} onChange={(v) => patch({ soldMessage: { ...a.soldMessage, text: v } })} disabled={!editable || !a.soldMessage.enabled} vars={["{prenom}", "{article}", "{prix}"]} />
        </JourneyStep>
        <JourneyStep n={3} level="Intermédiaire" title="Message après la finalisation" done={a.completedMessage.enabled} intro={<>Quand l'acheteur <strong className="text-text">valide la commande</strong> (l'argent vous est versé) : un merci, et une invitation à revenir.</>}
          illustration={<ChatMock priceCents={PRICE} caption="Envoyé quand la commande est finalisée." lines={[
            { from: "event", text: "Commande finalisée : argent reçu", tone: "success", time: "J+3 · 11:20" },
            ...(a.completedMessage.enabled ? [{ from: "seller" as const, text: sample(a.completedMessage.text, PRICE), time: "11:24", auto: true }] : []),
            { from: "buyer", text: "Merci, il est parfait !", time: "11:40" },
          ]} />}>
          <Toggle label="Envoyer un message quand la commande est finalisée" checked={a.completedMessage.enabled} onChange={(v) => patch({ completedMessage: { ...a.completedMessage, enabled: v } })} disabled={!editable} />
          <TemplateField label="Message après la finalisation" value={a.completedMessage.text} onChange={(v) => patch({ completedMessage: { ...a.completedMessage, text: v } })} disabled={!editable || !a.completedMessage.enabled} vars={["{prenom}", "{article}"]} />
        </JourneyStep>
        <JourneyStep n={4} level="Intermédiaire" title="Relance du colis" last done={a.pickupReminder.enabled} intro={<>Un colis qui dort au point relais, c'est de l'argent bloqué. Selio relance l'acheteur <strong className="text-text">{a.pickupReminder.afterHours} h après le dépôt</strong> pour qu'il pense à le récupérer.</>}
          illustration={<ChatMock priceCents={PRICE} caption={`Relance ${a.pickupReminder.afterHours} h après l'arrivée au point relais, une seule fois.`} lines={[
            { from: "event", text: "Colis disponible au point relais", tone: "accent", time: "J+1 · 09:00" },
            { from: "event", text: `${a.pickupReminder.afterHours} h plus tard, pas encore récupéré`, tone: "muted" },
            ...(a.pickupReminder.enabled ? [{ from: "seller" as const, text: sample(a.pickupReminder.text, PRICE), time: "J+2 · 09:00", auto: true }] : []),
            { from: "event", text: "Colis récupéré", tone: "success", time: "J+2 · 17:32" },
          ]} />}>
          <Toggle label="Relancer l'acheteur qui n'a pas récupéré son colis" checked={a.pickupReminder.enabled} onChange={(v) => patch({ pickupReminder: { ...a.pickupReminder, enabled: v } })} disabled={!editable} />
          <Sentence>Relance <NumberInput label="Délai de relance (heures)" value={a.pickupReminder.afterHours} min={1} max={168} width="w-16" suffix="h" disabled={!editable || !a.pickupReminder.enabled} onChange={(v) => patch({ pickupReminder: { ...a.pickupReminder, afterHours: v } })} /> après la mise à disposition du colis.</Sentence>
          <TemplateField label="Message de relance" value={a.pickupReminder.text} onChange={(v) => patch({ pickupReminder: { ...a.pickupReminder, text: v } })} disabled={!editable || !a.pickupReminder.enabled} vars={["{prenom}", "{article}"]} />
        </JourneyStep>
      </Journey>
      <SaveBar dirty={dirty} editable={editable} pending={save.isPending} onSave={() => save.mutate(undefined)} onReset={reset} />
      <HonestNote />
    </>
  );
}

function Status({ ok, icon, text }: { ok: boolean; icon: React.ReactNode; text: string }) {
  return (
    <li className="flex items-center gap-2.5 rounded-lg bg-surface px-3 py-2">
      <span className={ok ? "text-success" : "text-text-muted"}>{ok ? <Check className="size-4" aria-hidden /> : icon}</span>
      <span className={ok ? "font-medium text-text" : "text-text-muted"}>{text}</span>
    </li>
  );
}
