import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, RefreshCw } from "lucide-react";
import { Checkbox, PageHeader, Toggle, formatCents } from "@selio/ui";
import { useClient } from "../../../lib/data/provider";
import { HonestNote, Journey, JourneyStep, NumberInput, PhoneCard, SAMPLE, SaveBar, Sentence, useAutomationSection } from "./shared";

/**
 * Stock automatique : quand un article d'un dressing suivi se vend, Selio le
 * remet en ligne (nouvelle annonce identique) tant qu'il en reste en stock.
 */
export default function AutoStock() {
  const client = useClient();
  const { draft: st, patch, dirty, editable, save, reset } = useAutomationSection("stock");
  const connections = useQuery({ queryKey: ["connections"], queryFn: () => client.listConnections() });
  const sale = (connections.data ?? []).filter((c) => c.usage === "sale");
  const all = st.connectionIds.length === 0;
  const toggleAccount = (id: string, on: boolean) => {
    const current = all ? sale.map((c) => c.id) : st.connectionIds;
    const next = on ? [...new Set([...current, id])] : current.filter((x) => x !== id);
    patch({ connectionIds: next.length === sale.length ? [] : next });
  };
  const delay = st.delayMinutes >= 60 ? `${Math.round(st.delayMinutes / 60)} h` : `${st.delayMinutes} min`;
  return (
    <>
      <PageHeader eyebrow="Automatisation" title="Stock automatique" description="Vous vendez plusieurs fois le même article ? Dès qu'il part, Selio le remet en ligne tout seul, avec les mêmes photos et la même annonce, tant qu'il vous en reste." />
      <div className="card mb-8 p-5">
        <Toggle label="Remettre en ligne automatiquement les articles vendus" description={st.enabled ? "Activé : chaque vente d'un dressing suivi relance l'annonce." : "Désactivé : un article vendu reste vendu."} checked={st.enabled} onChange={(v) => patch({ enabled: v })} disabled={!editable} />
      </div>
      <Journey label="Réglages du stock automatique">
        <JourneyStep n={1} level="Essentiel" title="Les dressings suivis" done={st.enabled} intro={<>Choisissez les <strong className="text-text">comptes Vente</strong> dont les ventes déclenchent la remise en ligne. Les comptes Perso ne sont jamais concernés.</>}
          illustration={<Timeline enabled={st.enabled} delay={delay} onlyWithStock={st.onlyWithStock} />}>
          {sale.length === 0 ? <p className="text-sm text-text-muted">Aucun compte Vente pour l'instant. <Link to="/app/accounts" className="font-medium text-accent hover:underline">Ajouter un compte Vinted</Link></p> : (
            <ul className="flex flex-col gap-2">
              {sale.map((c) => <li key={c.id} className="rounded-lg border border-border px-3 py-2"><Checkbox label={c.label} checked={all || st.connectionIds.includes(c.id)} disabled={!editable} onChange={(e) => toggleAccount(c.id, e.target.checked)} /></li>)}
            </ul>
          )}
          <p className="text-xs text-text-muted">{all ? "Tous vos comptes Vente sont suivis." : `${st.connectionIds.length} compte(s) suivi(s) sur ${sale.length}.`}</p>
        </JourneyStep>
        <JourneyStep n={2} level="Intermédiaire" title="Quand remettre en ligne" last done={st.enabled} intro={<>Un petit délai évite de republier pendant que l'acheteur paie. Avec « seulement s'il reste du stock », Selio regarde la <strong className="text-text">quantité</strong> de l'article dans Articles et stock.</>}
          illustration={<PhoneCard title="Articles et stock" caption="La quantité baisse à chaque vente ; à 0, l'annonce n'est plus remise en ligne.">
            <ul className="flex flex-col gap-1.5 text-sm">
              {[3, 2, 1, 0].map((q) => <li key={q} className="flex items-center justify-between rounded-lg bg-surface px-3 py-2"><span className="text-text-muted">{q === 3 ? "Avant la vente" : `Après la vente ${3 - q}`}</span><span className="num font-semibold text-text">Stock : {q}{q === 0 && st.onlyWithStock ? <span className="ml-2 text-xs font-normal text-text-muted">plus remis en ligne</span> : null}</span></li>)}
            </ul>
          </PhoneCard>}>
          <Sentence>Je remets en ligne <NumberInput label="Délai avant remise en ligne (minutes)" value={st.delayMinutes} min={0} max={1440} width="w-20" suffix="min" disabled={!editable} onChange={(v) => patch({ delayMinutes: v })} /> après la vente.</Sentence>
          <Toggle label="Seulement s'il reste du stock" description="Désactivé, l'article est remis en ligne à chaque vente, quelle que soit la quantité." checked={st.onlyWithStock} onChange={(v) => patch({ onlyWithStock: v })} disabled={!editable} />
        </JourneyStep>
      </Journey>
      <SaveBar dirty={dirty} editable={editable} pending={save.isPending} onSave={() => save.mutate(undefined)} onReset={reset} />
      <HonestNote />
    </>
  );
}

function Timeline({ enabled, delay, onlyWithStock }: { enabled: boolean; delay: string; onlyWithStock: boolean }) {
  return (
    <PhoneCard title="Votre dressing" caption={enabled ? `Remis en ligne ${delay} après la vente${onlyWithStock ? ", tant qu'il reste du stock" : ""}.` : "Désactivé : l'annonce vendue n'est pas relancée."}>
      <ul className="flex flex-col gap-2 text-sm">
        <li className="flex items-center gap-2.5 rounded-lg bg-surface px-3 py-2">{SAMPLE.photo ? <img src={SAMPLE.photo} alt="" className="size-9 rounded-md object-cover" /> : null}<span className="min-w-0 flex-1"><span className="block truncate font-semibold text-text">{SAMPLE.title}</span><span className="num text-xs text-text-muted">{formatCents(1800)} · vendu à 14:05</span></span><span className="text-xs font-semibold text-success">Vendu</span></li>
        <li className="flex items-center gap-2.5 rounded-lg bg-surface px-3 py-2">
          <span className={enabled ? "text-success" : "text-text-muted"}>{enabled ? <Check className="size-4" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}</span>
          <span className={enabled ? "font-medium text-text" : "text-text-muted"}>{enabled ? `Remis en ligne automatiquement · ${delay} plus tard` : "Pas de remise en ligne"}</span>
        </li>
        {enabled ? <li className="flex items-center gap-2.5 rounded-lg bg-surface px-3 py-2">{SAMPLE.photo ? <img src={SAMPLE.photo} alt="" className="size-9 rounded-md object-cover" /> : null}<span className="min-w-0 flex-1"><span className="block truncate font-semibold text-text">{SAMPLE.title}</span><span className="num text-xs text-text-muted">{formatCents(1800)} · en ligne</span></span><span className="text-xs font-semibold text-accent">Nouveau</span></li> : null}
      </ul>
    </PhoneCard>
  );
}
