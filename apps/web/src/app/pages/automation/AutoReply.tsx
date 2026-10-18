import { Link } from "react-router";
import type { AutomationSettings } from "@selio/contracts";
import { Checkbox, PageHeader, Segmented, Toggle } from "@selio/ui";
import { useRequiredSession } from "../../../lib/data/provider";
import { BUYER, ChatMock, HonestNote, Journey, JourneyStep, SAMPLE, SaveBar, TemplateField, sample, useAutomationSection } from "./shared";

type Topic = keyof AutomationSettings["autoReply"]["topics"];

/** Questions courantes et la réponse type que l'IA écrit à partir de la fiche de l'article. */
const TOPICS: { key: Topic; label: string; q: string; a: string }[] = [
  { key: "availability", label: "Disponibilité", q: "Il est toujours disponible ?", a: "Oui, toujours disponible ! Je peux l'envoyer dès demain." },
  { key: "size", label: "Taille et coupe", q: "Il taille comment ?", a: "Taille M, coupe droite : il taille normalement. Largeur aisselles 52 cm, longueur 66 cm." },
  { key: "condition", label: "État", q: "Il y a des défauts ?", a: "Très bon état, porté quelques fois, aucun trou ni tache. Les photos montrent l'article tel quel." },
  { key: "shipping", label: "Envoi", q: "Vous envoyez quand ?", a: "J'envoie sous 24 h en point relais, avec un suivi." },
  { key: "bundle", label: "Lots", q: "Vous faites des lots ?", a: "Oui ! Ajoutez les articles à un lot : je vous fais une remise automatique." },
  { key: "photos", label: "Photos en plus", q: "Vous pouvez m'envoyer une photo de l'étiquette ?", a: "Bien sûr, je vous l'envoie dans la journée." },
];

/**
 * Réponse automatique : l'IA répond aux questions courantes à partir de la
 * fiche de l'article (taille, état, mesures, envoi), en brouillon à valider
 * ou envoyée seule. Les offres de prix passent par la négociation automatique.
 */
export default function AutoReply() {
  const { draft: r, patch, dirty, editable, save, reset } = useAutomationSection("autoReply");
  const timing = useRequiredSession().org.settings.automation.negotiation.timing;
  const on = TOPICS.filter((t) => r.topics[t.key]);
  return (
    <>
      <PageHeader eyebrow="Automatisation" title="Réponse automatique" description="« Il taille comment ? », « Toujours dispo ? » : l'IA répond aux questions courantes à partir de la fiche de l'article, dans votre style. Vous gardez la main sur ce qui part." />
      <div className="card mb-8 p-5">
        <Toggle label="Répondre automatiquement aux questions des acheteurs" description={r.enabled ? "Activé sur vos comptes Vente." : "Désactivé : les questions restent dans la messagerie."} checked={r.enabled} onChange={(v) => patch({ enabled: v })} disabled={!editable} />
      </div>
      <Journey label="Réglages de la réponse automatique">
        <JourneyStep n={1} level="Essentiel" title="Validation ou envoi direct" done intro={<>Au début, gardez la <strong className="text-text">validation</strong> : chaque réponse attend votre accord d'un clic. Quand vous avez confiance, passez à l'envoi direct.</>}
          illustration={<ChatMock priceCents={2000} caption={r.sendWithoutApproval ? "Envoi direct : la réponse part seule." : "Brouillon : la réponse attend votre accord dans la messagerie."} lines={[
            { from: "buyer", text: TOPICS[0]!.q, time: "10:21" },
            ...(r.sendWithoutApproval ? [{ from: "seller" as const, text: TOPICS[0]!.a, time: "10:24", auto: true }] : [{ from: "event" as const, text: "Brouillon prêt : à valider dans la messagerie", tone: "accent" as const }]),
          ]} />}>
          <Segmented ariaLabel="Mode d'envoi" value={r.sendWithoutApproval ? "direct" : "approval"} onChange={(v) => patch({ sendWithoutApproval: v === "direct" })} items={[{ value: "approval", label: "Brouillon à valider" }, { value: "direct", label: "Envoi direct" }]} />
          <p className="text-xs text-text-muted">Les offres de prix ne passent jamais par ici : elles suivent la <Link to="/app/automatisation/negociation" className="font-medium text-accent hover:underline">négociation automatique</Link>.</p>
        </JourneyStep>
        <JourneyStep n={2} level="Intermédiaire" title="Les questions auxquelles répondre" done intro={<>Cochez les sujets confiés à l'IA. Elle s'appuie <strong className="text-text">uniquement sur la fiche de l'article</strong> (taille, mesures, état, envoi) : si l'information manque, la question vous est confiée.</>}
          illustration={<ChatMock priceCents={2000} title={SAMPLE.title} caption={`${on.length} sujet(s) confié(s) à l'IA.`} lines={on.slice(0, 3).flatMap((t, i) => [{ from: "buyer" as const, text: t.q, time: `1${i}:02` }, { from: "seller" as const, text: t.a, time: `1${i}:05`, auto: true }])} />}>
          <ul className="grid gap-2 sm:grid-cols-2">
            {TOPICS.map((t) => (
              <li key={t.key} className="rounded-lg border border-border px-3 py-2">
                <Checkbox label={t.label} checked={r.topics[t.key]} disabled={!editable} onChange={(e) => patch({ topics: { ...r.topics, [t.key]: e.target.checked } })} />
                <p className="mt-0.5 pl-6 text-xs text-text-muted">« {t.q} »</p>
              </li>
            ))}
          </ul>
        </JourneyStep>
        <JourneyStep n={3} level="Avancé" title="Message d'absence" last done intro={<>En dehors de vos horaires (de {timing.activeFrom} h à {timing.activeTo} h, réglés dans la négociation), un message d'attente <strong className="text-text">rassure l'acheteur</strong> ; la vraie réponse part à la reprise.</>}
          illustration={<ChatMock priceCents={2000} caption="Envoyé une fois, hors horaires." lines={[
            { from: "buyer", text: "Bonsoir, vous pouvez l'envoyer demain ?", time: "23:48" },
            { from: "seller", text: sample(r.awayMessage, 2000), time: "23:50", auto: true },
            { from: "event", text: `Réponse complète à ${timing.activeFrom} h`, tone: "muted" },
          ]} />}>
          <TemplateField label="Message d'absence" value={r.awayMessage} onChange={(v) => patch({ awayMessage: v })} disabled={!editable} vars={["{prenom}", "{article}"]} hint={`Exemple pour ${BUYER}.`} />
        </JourneyStep>
      </Journey>
      <SaveBar dirty={dirty} editable={editable} pending={save.isPending} onSave={() => save.mutate(undefined)} onReset={reset} />
      <HonestNote />
    </>
  );
}
