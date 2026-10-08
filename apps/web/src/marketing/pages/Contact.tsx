import { useState } from "react";
import { Alert, Button, Field, Input, Textarea } from "@selio/ui";
import { usePageMeta } from "../../lib/seo";
import { MarketingSection } from "../components";

export default function Contact() {
  usePageMeta("Contact", "Contacter l'équipe Selio : question produit, demande de démonstration guidée, signalement.");
  const [sent, setSent] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", subject: "question", message: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Votre nom est requis.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) errs.email = "Adresse email invalide.";
    if (form.message.trim().length < 10) errs.message = "Dix caractères minimum.";
    setErrors(errs);
    if (Object.keys(errs).length === 0) setSent(true);
  };
  return (
    <MarketingSection eyebrow="Contact" title="Parlons de votre activité" lead="Ce formulaire ne transmet rien pour l'instant : l'envoi d'email n'est pas encore configuré (aucun service tiers n'est branché). Utilisez l'adresse indiquée dans les mentions légales une fois renseignée.">
      <div className="grid gap-8 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {sent ? (
          <Alert tone="success" title="Message préparé">Votre message a été validé localement. L'envoi réel sera activé lorsque le service d'email sera configuré.</Alert>
        ) : (
          <form onSubmit={submit} noValidate className="card flex flex-col gap-4 p-5">
            <Field label="Nom" required error={errors.name}>{(p) => <Input id={p.id} aria-describedby={p.describedBy} invalid={p.invalid} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" />}</Field>
            <Field label="Email" required error={errors.email}>{(p) => <Input id={p.id} type="email" aria-describedby={p.describedBy} invalid={p.invalid} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" />}</Field>
            <Field label="Sujet">{(p) => (
              <select id={p.id} className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-base" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })}>
                <option value="question">Question produit</option>
                <option value="demo">Démonstration guidée</option>
                <option value="bug">Signalement</option>
                <option value="autre">Autre</option>
              </select>
            )}</Field>
            <Field label="Message" required error={errors.message}>{(p) => <Textarea id={p.id} aria-describedby={p.describedBy} invalid={p.invalid} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} rows={6} />}</Field>
            <div><Button type="submit">Valider le message</Button></div>
          </form>
        )}
        <aside className="card p-5 text-sm text-text-muted">
          <h2 className="text-md font-semibold text-text">Avant d'écrire</h2>
          <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5">
            <li>La FAQ répond aux questions sur Vinted, l'extension et l'IA.</li>
            <li>La démonstration montre le parcours complet sans compte.</li>
            <li>Les données que vous saisissez ici ne sont pas conservées.</li>
          </ul>
        </aside>
      </div>
    </MarketingSection>
  );
}
