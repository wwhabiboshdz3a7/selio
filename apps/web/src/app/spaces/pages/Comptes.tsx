import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { ArrowRight, Check, Copy, ShieldCheck } from "lucide-react";
import { Alert, Button, Card, Field, Input, PageHeader, ProgressBar, Select, Textarea, Toggle, cn, useToast } from "@selio/ui";
import { useRequiredSession } from "../../../lib/data/provider";
import {
  COMPTES_CHECKLIST, COMPTES_NOTICE, SHOP_STYLE_LABELS, checklistProgress, generateComptesTexts, loadComptes, saveComptes,
  type ComptesInput, type ShopStyle,
} from "../../../lib/comptes";

/**
 * Selio Comptes (§5.15) : une checklist cochable à suivre soi-même dans Vinted et des textes générés à
 * copier (présentation, règles d'envoi, réponses types). Rien n'est envoyé à Vinted ni au serveur : les
 * cases cochées et les réponses restent sur cet appareil.
 */
export default function Comptes() {
  const session = useRequiredSession();
  const orgId = session.org.id;
  const [saved, setSaved] = useState(() => loadComptes(orgId));
  const done = useMemo(() => new Set(saved.done), [saved.done]);
  useEffect(() => {
    saveComptes(orgId, saved);
  }, [orgId, saved]);
  const progress = checklistProgress(done);
  const texts = useMemo(() => generateComptesTexts(saved.input), [saved.input]);
  const toggle = (id: string, on: boolean) => setSaved((s) => ({ ...s, done: on ? [...new Set([...s.done, id])] : s.done.filter((x) => x !== id) }));
  const setInput = (patch: Partial<ComptesInput>) => setSaved((s) => ({ ...s, input: { ...s.input, ...patch } }));

  return (
    <>
      <PageHeader eyebrow="Selio Comptes" title="Ouvrir sa boutique Vinted, étape par étape" description="Une checklist à suivre dans Vinted et des textes prêts à copier. Vous gardez la main sur tout : le compte est à votre nom." />
      <Alert tone="info" className="mb-6" title="Vous restez aux commandes">
        <span data-testid="comptes-notice">{COMPTES_NOTICE}</span> Selio ne se connecte pas à Vinted, ne publie rien et ne garde aucun mot de passe.
      </Alert>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-md font-semibold text-text">Checklist</h2>
            <span className="num text-sm text-text-muted" data-testid="comptes-progress">{progress.done} / {progress.total} étapes</span>
          </div>
          <ProgressBar value={progress.percent} label={`Checklist : ${progress.percent} %`} className="mt-3" />
          <div className="mt-5 flex flex-col gap-6">
            {COMPTES_CHECKLIST.map((g, gi) => (
              <section key={g.id} aria-labelledby={`comptes-${g.id}`}>
                <h3 id={`comptes-${g.id}`} className="text-sm font-semibold text-text"><span className="num mr-1.5 text-text-muted">{gi + 1}.</span>{g.title}</h3>
                <ul className="mt-2 flex flex-col gap-1">
                  {g.steps.map((st) => {
                    const id = `${g.id}.${st.id}`;
                    const checked = done.has(id);
                    return (
                      <li key={id}>
                        <label className={cn("flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-surface-muted", checked && "text-text-muted")}>
                          <input type="checkbox" className="mt-0.5 size-4 shrink-0 cursor-pointer rounded-sm border border-border-strong accent-[var(--accent-vivid)]" checked={checked} onChange={(e) => toggle(id, e.target.checked)} />
                          <span className="min-w-0">
                            <span className={cn("block text-sm font-medium", checked ? "text-text-muted line-through" : "text-text")}>{st.title}</span>
                            <span className="block text-xs text-text-muted">{st.detail}</span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
          {progress.done === progress.total ? <p className="mt-5 flex items-center gap-2 text-sm font-medium text-success"><Check className="size-4" aria-hidden />Checklist terminée : votre boutique est prête.</p> : null}
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <h2 className="text-md font-semibold text-text">Vos réponses</h2>
            <p className="mt-1 text-sm text-text-muted">Les textes se mettent à jour à partir de ces réponses. Gardées sur cet appareil.</p>
            <div className="mt-3 flex flex-col gap-3">
              <Field label="Style de la boutique">{(p) => <Select id={p.id} value={saved.input.style} onChange={(e) => setInput({ style: e.target.value as ShopStyle })}>{(Object.keys(SHOP_STYLE_LABELS) as ShopStyle[]).map((k) => <option key={k} value={k}>{SHOP_STYLE_LABELS[k]}</option>)}</Select>}</Field>
              <Field label="Signature" hint="Votre prénom ou le nom de la boutique (facultatif).">{(p) => <Input id={p.id} aria-describedby={p.describedBy} maxLength={40} value={saved.input.signature} onChange={(e) => setInput({ signature: e.target.value })} />}</Field>
              <Field label="Délai d'expédition (jours ouvrés)">{(p) => <Input id={p.id} type="number" min={1} max={7} value={saved.input.shippingDays} onChange={(e) => setInput({ shippingDays: Number(e.target.value) || 1 })} />}</Field>
              <Toggle label="Lots acceptés" description="Une remise quand l'acheteur prend plusieurs articles." checked={saved.input.bundles} onChange={(v) => setInput({ bundles: v })} />
              {saved.input.bundles ? <Field label="Remise sur les lots (%)">{(p) => <Input id={p.id} type="number" min={0} max={50} value={saved.input.bundleDiscount} onChange={(e) => setInput({ bundleDiscount: Number(e.target.value) || 0 })} />}</Field> : null}
              <Toggle label="Emballage réutilisé" description="Le mentionner dans la présentation et les règles d'envoi." checked={saved.input.ecoPackaging} onChange={(v) => setInput({ ecoPackaging: v })} />
            </div>
          </Card>
          <Card>
            <h2 className="flex items-center gap-2 text-md font-semibold text-text"><ShieldCheck className="size-4 text-text-muted" aria-hidden />Ensuite, dans Selio</h2>
            <ul className="mt-3 flex flex-col divide-y divide-border">
              <li className="py-2.5 first:pt-0"><Link to="/studio" className="group flex items-center gap-2 text-sm font-semibold text-text hover:text-accent">Préparer les premières annonces<ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden /></Link><p className="text-xs text-text-muted">Selio Studio rédige à partir de vos photos ; vous publiez vous-même.</p></li>
              <li className="py-2.5 last:pb-0"><Link to="/app/accounts" className="group flex items-center gap-2 text-sm font-semibold text-text hover:text-accent">Relier le compte à Selio<ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden /></Link><p className="text-xs text-text-muted">Avec l'extension : c'est vous qui vous connectez à Vinted.</p></li>
            </ul>
          </Card>
        </div>
      </div>

      <h2 className="mt-8 mb-3 text-lg font-semibold text-text">Textes à copier</h2>
      <p className="mb-4 max-w-2xl text-sm text-text-muted">Rédigés à partir de vos réponses, à relire avant de les coller dans Vinted. Rien n'est envoyé.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <CopyBlock title="Présentation" text={texts.presentation} />
        <CopyBlock title="Règles d'envoi" text={texts.shippingRules} />
      </div>
      <Card className="mt-4">
        <h3 className="text-md font-semibold text-text">Réponses types</h3>
        <ul className="mt-3 grid gap-4 md:grid-cols-2" aria-label="Réponses types">
          {texts.replies.map((r) => <li key={r.id}><CopyBlock title={r.label} text={r.text} bare /></li>)}
        </ul>
      </Card>
    </>
  );
}

/** Texte en lecture seule avec son bouton « Copier ». */
function CopyBlock({ title, text, bare = false }: { title: string; text: string; bare?: boolean }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setCopied(false);
  }, [text]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({ tone: "success", title: `« ${title} » copié` });
    } catch {
      toast({ tone: "danger", title: "Copie impossible", description: "Sélectionnez le texte et copiez-le à la main." });
    }
  };
  const id = `copie-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className={cn("font-semibold text-text", bare ? "text-sm" : "text-md")}>{title}</label>
        <Button size="sm" variant="secondary" icon={copied ? <Check /> : <Copy />} onClick={copy} aria-label={`Copier « ${title} »`}>{copied ? "Copié" : "Copier"}</Button>
      </div>
      <Textarea id={id} readOnly value={text} rows={Math.min(8, text.split("\n").length + 1)} className="mt-2 text-sm" onFocus={(e) => e.currentTarget.select()} />
    </>
  );
  return bare ? <div>{body}</div> : <Card>{body}</Card>;
}
