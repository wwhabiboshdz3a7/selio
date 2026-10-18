import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Boxes, Gauge, MessageSquare, RotateCcw, Save } from "lucide-react";
import { WHITE_LABEL_ACCENTS, WHITE_LABEL_ACCENT_LABELS, whiteLabelInput, type WhiteLabel, type WhiteLabelAccent } from "@selio/contracts";
import { can } from "@selio/domain";
import { Alert, Button, Card, Field, Input, PageHeader, Toggle, cn, formatDateTime } from "@selio/ui";
import { useClient, useData, useRequiredSession } from "../../../lib/data/provider";
import { QueryBoundary } from "../../components/common";
import { useAppMutation } from "../../components/hooks";
import { BrandMark, PreviewNotice, initialsOf } from "../components";

interface Form {
  name: string;
  initials: string;
  accent: WhiteLabelAccent;
  tagline: string;
  poweredBy: boolean;
}

function defaults(orgName: string): Form {
  return { name: orgName, initials: initialsOf(orgName), accent: "amethyste", tagline: "", poweredBy: true };
}

function fromSaved(w: WhiteLabel): Form {
  return { name: w.name, initials: w.initials, accent: w.accent, tagline: w.tagline, poweredBy: w.poweredBy };
}

function FakeField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-text">{label}</p>
      <p className="mt-1 h-8 rounded-md border border-border bg-surface px-2.5 text-xs leading-8 text-text-subtle">{value}</p>
    </div>
  );
}

function PreviewFrame({ title, children, accent }: { title: string; children: ReactNode; accent: WhiteLabelAccent }) {
  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 text-xs font-medium tracking-wide text-text-muted uppercase">{title}</figcaption>
      <div data-accent={accent} className="overflow-hidden rounded-lg border border-border bg-bg">{children}</div>
    </figure>
  );
}

function Preview({ form }: { form: Form }) {
  const name = form.name.trim() || "Votre agence";
  return (
    <div className="flex flex-col gap-5" aria-label="Aperçu en direct de la marque blanche">
      <PreviewFrame title="En-tête et menu de l'outil" accent={form.accent}>
        <div className="flex min-h-48">
          {/* Écran étroit : menu replié en icônes, le nom passe en tête du contenu. */}
          <div className="w-12 shrink-0 border-r border-border bg-surface-sidebar p-2 sm:w-44 sm:p-2.5">
            <div className="flex items-center gap-2 pb-3 sm:px-1">
              <BrandMark initials={form.initials} />
              <span className="hidden min-w-0 truncate text-sm font-semibold text-text sm:block">{name}</span>
            </div>
            {[{ i: <Gauge />, l: "Vue d'ensemble", on: true }, { i: <Boxes />, l: "Articles et stock" }, { i: <MessageSquare />, l: "Messagerie" }].map((n) => (
              <p key={n.l} title={n.l} className={cn("mb-0.5 flex items-center justify-center gap-2 rounded-md py-1.5 text-xs font-medium sm:justify-start sm:px-2 [&>svg]:size-3.5 [&>svg]:shrink-0", n.on ? "bg-accent-soft text-text [&>svg]:text-accent" : "text-text-muted")}>{n.i}<span className="hidden truncate sm:inline">{n.l}</span></p>
            ))}
          </div>
          <div className="min-w-0 flex-1 p-3.5">
            <p className="mb-2.5 truncate border-b border-border pb-2 text-sm font-semibold text-text sm:hidden">{name}</p>
            <p className="text-sm font-semibold text-text">Bonjour Sophie</p>
            <p className="text-xs text-text-muted">Dépôt-vente des Arcades · ce mois-ci</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-md border border-border bg-surface p-2"><p className="text-[11px] text-text-muted">Ventes</p><p className="num text-sm font-semibold text-text">61</p></div>
              <div className="rounded-md border border-border bg-surface p-2"><p className="text-[11px] text-text-muted">En ligne</p><p className="num text-sm font-semibold text-text">184</p></div>
            </div>
            <span className="mt-3 inline-flex h-7 items-center rounded-md bg-accent px-2.5 text-xs font-medium text-accent-on">Nouvelle annonce</span>
            <span className="mt-3 ml-2 inline-flex text-xs font-medium text-accent">Voir les messages</span>
          </div>
        </div>
      </PreviewFrame>
      <PreviewFrame title="Écran de connexion" accent={form.accent}>
        <div className="flex justify-center px-4 py-6">
          <div className="w-full max-w-72 rounded-lg border border-border bg-surface p-4">
            <div className="flex items-center gap-2.5">
              <BrandMark initials={form.initials} size={32} />
              <span className="min-w-0 truncate text-base font-semibold text-text">{name}</span>
            </div>
            <p className="mt-3 text-sm font-semibold text-text">Connexion</p>
            <p className="text-xs text-text-muted">{form.tagline.trim() || "Votre espace de gestion"}</p>
            <div className="mt-3 flex flex-col gap-2.5">
              <FakeField label="Email" value="vous@exemple.fr" />
              <FakeField label="Mot de passe" value="••••••••••" />
            </div>
            <span className="mt-3.5 flex h-8 items-center justify-center rounded-md bg-accent text-xs font-medium text-accent-on">Se connecter</span>
            {form.poweredBy ? <p className="mt-3 text-center text-[11px] text-text-subtle">Propulsé par Selio</p> : null}
          </div>
        </div>
      </PreviewFrame>
    </div>
  );
}

function Editor({ saved }: { saved: WhiteLabel | null }) {
  const client = useClient();
  const { mode } = useData();
  const session = useRequiredSession();
  const [form, setForm] = useState<Form>(() => (saved ? fromSaved(saved) : defaults(session.org.name)));
  const parsed = whiteLabelInput.safeParse(form);
  const errors = parsed.success ? {} : Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
  const allowed = can(session.role, "org.update");
  const save = useAppMutation(() => client.saveWhiteLabel(form), { invalidate: ["white-label"], success: "Marque blanche enregistrée dans la démonstration" });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <Card className="flex flex-col gap-4 self-start">
        <h2 className="text-md font-semibold text-text">Votre marque</h2>
        <Field label="Nom de l'agence" error={errors.name} hint="Remplace « Selio » dans l'outil de vos clients.">
          {(p) => <Input id={p.id} aria-describedby={p.describedBy} value={form.name} maxLength={40} onChange={(e) => set("name", e.target.value)} />}
        </Field>
        <Field label="Logo texte" error={errors.initials} hint="1 à 3 lettres ou chiffres, sur votre couleur.">
          {(p) => <Input id={p.id} aria-describedby={p.describedBy} value={form.initials} maxLength={3} className="max-w-28 uppercase" onChange={(e) => set("initials", e.target.value.toUpperCase())} />}
        </Field>
        <fieldset>
          <legend className="text-sm font-medium text-text">Couleur d'accent</legend>
          <p className="mt-0.5 text-xs text-text-muted">Une palette tirée de la charte Selio, lisible en mode clair comme en sombre.</p>
          <div role="radiogroup" aria-label="Couleur d'accent" className="mt-2.5 flex flex-wrap gap-2">
            {WHITE_LABEL_ACCENTS.map((a) => {
              const on = form.accent === a;
              return (
                <button key={a} type="button" role="radio" aria-checked={on} onClick={() => set("accent", a)} data-accent={a}
                  className={cn("flex h-9 items-center gap-2 rounded-md border px-2.5 text-sm transition-colors", on ? "border-accent bg-accent-soft font-medium text-text" : "border-border bg-surface text-text-muted hover:bg-surface-muted")}>
                  <span className="size-4 rounded-full bg-accent" aria-hidden />
                  {WHITE_LABEL_ACCENT_LABELS[a]}
                </button>
              );
            })}
          </div>
        </fieldset>
        <Field label="Phrase d'accueil (facultatif)" error={errors.tagline} hint="Affichée sur l'écran de connexion.">
          {(p) => <Input id={p.id} aria-describedby={p.describedBy} value={form.tagline} maxLength={80} placeholder="ex. Votre dépôt-vente en ligne" onChange={(e) => set("tagline", e.target.value)} />}
        </Field>
        <Toggle checked={form.poweredBy} onChange={(v) => set("poweredBy", v)} label="Mention « Propulsé par Selio »" description="En pied de l'écran de connexion." />
        {mode === "connected" ? (
          <Alert tone="info">L'aperçu fonctionne en direct, mais rien n'est enregistré sur votre compte tant que Selio Agence n'est pas ouvert. Essayez l'enregistrement dans la démonstration.</Alert>
        ) : !allowed ? (
          <Alert tone="info">Seuls un administrateur ou le propriétaire peuvent enregistrer la marque blanche.</Alert>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <Button variant="accent" icon={<Save />} disabled={!parsed.success || mode === "connected" || !allowed} loading={save.isPending} onClick={() => save.mutate(undefined)}>Enregistrer</Button>
          <Button variant="ghost" icon={<RotateCcw />} onClick={() => setForm(saved ? fromSaved(saved) : defaults(session.org.name))}>Annuler les changements</Button>
          {saved ? <span className="ml-auto text-xs text-text-muted">Enregistrée le {formatDateTime(saved.updatedAt)}</span> : null}
        </div>
      </Card>
      <Preview form={form} />
    </div>
  );
}

export default function AgencyBranding() {
  const client = useClient();
  const q = useQuery({ queryKey: ["white-label"], queryFn: () => client.getWhiteLabel() });
  return (
    <>
      <PageHeader
        eyebrow="Selio Agence · Aperçu"
        title="Marque blanche"
        description="L'outil Selio aux couleurs de votre agence : votre nom, votre logo texte et votre couleur, pour vos clients. L'aperçu se met à jour pendant que vous tapez."
      />
      <PreviewNotice space="agence">La marque blanche s'enregistre dans la démonstration pour que vous puissiez l'essayer ; elle ne s'applique pas encore à l'outil de vos clients.</PreviewNotice>
      <QueryBoundary query={q}>{(saved) => <Editor key={saved?.updatedAt ?? "nouvelle"} saved={saved} />}</QueryBoundary>
    </>
  );
}
