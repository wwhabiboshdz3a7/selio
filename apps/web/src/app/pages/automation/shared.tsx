import { useRef, useState, type ReactNode } from "react";
import { Check, Clock, Sparkles } from "lucide-react";
import type { AutomationSettings } from "@selio/contracts";
import { can, fillTemplate } from "@selio/domain";
import { REAL_CATALOG } from "@selio/demo-data";
import { Button, Input, Textarea, cn, formatCents } from "@selio/ui";
import { useClient, useRequiredSession } from "../../../lib/data/provider";
import { MoneyInput } from "../../components/common";
import { useAppMutation } from "../../components/hooks";

// ---------------------------------------------------------------------------
// Réglages : brouillon local, enregistré d'un bloc
// ---------------------------------------------------------------------------

/**
 * Brouillon d'une section des réglages d'automatisation. L'enregistrement
 * envoie toute la section `automation` (le serveur fusionne section par
 * section : une section partielle repartirait des valeurs par défaut).
 */
export function useAutomationSection<K extends keyof AutomationSettings>(key: K) {
  const client = useClient();
  const session = useRequiredSession();
  const all = session.org.settings.automation;
  const saved = all[key];
  const [draft, setDraft] = useState<AutomationSettings[K]>(saved);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const editable = can(session.role, "org.update");
  const save = useAppMutation(() => client.updateOrg({ settings: { automation: { ...all, [key]: draft } } }), { invalidate: ["session", "nav-counts"], success: "Réglages enregistrés" });
  const patch = (p: Partial<AutomationSettings[K]>) => setDraft((d) => ({ ...d, ...p }));
  return { draft, setDraft, patch, saved, dirty, editable, save, reset: () => setDraft(saved) };
}

/** Barre d'enregistrement : collée en bas de l'écran tant qu'il reste des modifications. */
export function SaveBar({ dirty, editable, pending, onSave, onReset, savedText = "Réglages enregistrés : ils s'appliquent dès maintenant." }: { dirty: boolean; editable: boolean; pending: boolean; onSave: () => void; onReset: () => void; savedText?: string }) {
  if (!editable) return <p className="mt-6 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-text-muted">Consultation : seuls le propriétaire et les administrateurs modifient ces réglages. Les exemples à droite restent utilisables.</p>;
  return (
    <div className={cn("mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-surface px-4 py-3", dirty ? "sticky bottom-4 z-10 border-accent/50 shadow-md" : "border-border")}>
      <p className="text-sm text-text-muted">{dirty ? <><span className="font-semibold text-text">Modifications non enregistrées.</span> Les exemples les montrent déjà.</> : savedText}</p>
      <div className="flex gap-2">
        {dirty ? <Button variant="ghost" onClick={onReset}>Annuler</Button> : null}
        <Button onClick={onSave} loading={pending} disabled={!dirty}>Enregistrer</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Parcours vertical : une étape à gauche, son illustration à droite
// ---------------------------------------------------------------------------

export type StepLevel = "Essentiel" | "Intermédiaire" | "Avancé";

export function Journey({ children, label }: { children: ReactNode; label: string }) {
  return <ol aria-label={label} className="flex flex-col">{children}</ol>;
}

/**
 * Une étape du parcours : numéro et fil à gauche, réglages au centre,
 * illustration à droite (en dessous sur mobile). Les étapes se lisent de haut
 * en bas, de la plus simple à la plus avancée.
 */
export function JourneyStep({ n, title, level, intro, children, illustration, last = false, done }: { n: number; title: string; level?: StepLevel; intro: ReactNode; children: ReactNode; illustration?: ReactNode; last?: boolean; done?: boolean }) {
  return (
    <li className="relative pb-8 pl-11 md:pl-14">
      {!last ? <span className="absolute top-10 bottom-0 left-[15px] w-px bg-border md:left-[19px]" aria-hidden /> : null}
      <span className={cn("num absolute top-0 left-0 inline-flex size-8 items-center justify-center rounded-full text-sm font-bold md:size-10", done ? "bg-accent text-accent-on" : "border border-border-strong bg-surface text-text")} aria-hidden>{n}</span>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] xl:gap-6">
        <section aria-labelledby={`etape-${n}`} className="card min-w-0 p-5 md:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={`etape-${n}`} className="text-md font-bold text-text"><span className="sr-only">Étape {n} : </span>{title}</h2>
            {level ? <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", level === "Essentiel" ? "bg-success/10 text-success" : level === "Intermédiaire" ? "bg-accent-soft text-accent" : "bg-gold-soft text-gold-text")}>{level}</span> : null}
          </div>
          <div className="mt-1.5 max-w-2xl text-sm text-text-muted">{intro}</div>
          <div className="mt-4 flex flex-col gap-4">{children}</div>
        </section>
        {illustration ? <div className="min-w-0 lg:sticky lg:top-6">{illustration}</div> : null}
      </div>
    </li>
  );
}

/** Ligne de réglage écrite comme une phrase (« J'accepte jusqu'à [10 %] de remise »). */
export function Sentence({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div>
      <p className="text-base leading-10 text-text">{children}</p>
      {hint ? <p className="text-xs text-text-muted">{hint}</p> : null}
    </div>
  );
}

/** Champ numérique saisi librement, appliqué dès qu'il est valide (borné), remis au propre en sortie. */
export function NumberInput({ label, value, min, max, step = 1, suffix, onChange, disabled, width = "w-[5.5rem]" }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (v: number) => void; disabled?: boolean; width?: string }) {
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
          const v = Number(e.target.value.replace(",", ".").trim());
          if (e.target.value.trim() !== "" && Number.isFinite(v) && v >= min && v <= max) onChange(Math.round(v / step) * step);
        }}
        suffix={suffix ? <span className="text-sm">{suffix}</span> : undefined}
        className="num"
      />
    </span>
  );
}

export function PercentInput({ value, onChange, ...rest }: { label: string; value: number; min: number; max: number; step?: number; onChange: (rate: number) => void; disabled?: boolean; width?: string }) {
  return <NumberInput {...rest} suffix="%" value={Math.round(value * 1000) / 10} onChange={(v) => onChange(Math.round(v * 10) / 1000)} />;
}

export function InlineMoney({ label, value, onChange, disabled }: { label: string; value: number; onChange: (cents: number) => void; disabled?: boolean }) {
  return (
    <span className="inline-block w-28 align-middle">
      <MoneyInput aria-label={label} value={value} onChange={(v) => onChange(Math.max(0, v ?? 0))} allowEmpty={false} disabled={disabled} />
    </span>
  );
}

export const pct = (rate: number) => `${Math.round(rate * 1000) / 10} %`.replace(".", ",");

// ---------------------------------------------------------------------------
// Modèles de message
// ---------------------------------------------------------------------------

export const TEMPLATE_VARS = [
  { key: "{prenom}", label: "Prénom" },
  { key: "{article}", label: "Article" },
  { key: "{prix}", label: "Prix proposé" },
  { key: "{prix_initial}", label: "Prix affiché" },
] as const;

/** Modèle de message : zone de texte, variables à insérer d'un clic. */
export function TemplateField({ label, hint, value, onChange, disabled, vars = TEMPLATE_VARS.map((v) => v.key) }: { label: string; hint?: string; value: string; onChange: (v: string) => void; disabled?: boolean; vars?: readonly string[] }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (token: string) => {
    const el = ref.current;
    const at = el ? el.selectionStart : value.length;
    const end = el ? el.selectionEnd : value.length;
    onChange(`${value.slice(0, at)}${token}${value.slice(end)}`.slice(0, 600));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  };
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-semibold text-text">
        {label}
        <Textarea ref={ref} rows={3} value={value} maxLength={600} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="mt-1.5 font-normal" />
      </label>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
        <span>Insérer :</span>
        {TEMPLATE_VARS.filter((v) => vars.includes(v.key)).map((v) => (
          <button key={v.key} type="button" disabled={disabled} onClick={() => insert(v.key)} className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[11px] text-text hover:bg-surface-muted disabled:opacity-50">{v.label}</button>
        ))}
      </div>
      {hint ? <p className="text-xs text-text-muted">{hint}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Illustration : une conversation de compte Vinted, jouée avec vos réglages
// ---------------------------------------------------------------------------

/** Article d'exemple des illustrations : une vraie annonce de la démonstration. */
export const SAMPLE = (() => {
  const e = REAL_CATALOG.find((x) => x.fullSize) ?? REAL_CATALOG[0];
  return { title: e?.title ?? "Pull Tommy Hilfiger marine", photo: e?.photos[0] ?? null, second: REAL_CATALOG.find((x) => !x.fullSize) ?? null };
})();

export const BUYER = "Léa";

export type ChatLine =
  | { from: "buyer" | "seller"; text: string; time?: string; auto?: boolean }
  | { from: "offer"; by: "buyer" | "seller"; cents: number; originalCents?: number; status: "proposée" | "acceptée" | "refusée" | "finale" | "lot"; time?: string; auto?: boolean }
  | { from: "event"; text: string; tone?: "success" | "accent" | "muted"; time?: string };

const fmt = (c: number) => formatCents(c);

/** Remplit un modèle avec l'exemple (Léa, l'article d'exemple, le prix donné). */
export function sample(template: string, priceCents: number, initialCents?: number): string {
  return fillTemplate(template, { prenom: BUYER, article: SAMPLE.title, prix: fmt(priceCents), prix_initial: initialCents != null ? fmt(initialCents) : fmt(priceCents) });
}

/**
 * Faux écran de conversation, façon messagerie Vinted : l'article en tête,
 * les bulles de l'acheteur à gauche, les vôtres à droite (marquées « Selio »
 * quand elles partent seules), les offres en cartes. Purement illustratif.
 */
export function ChatMock({ lines, priceCents, caption, title = SAMPLE.title, header }: { lines: ChatLine[]; priceCents: number; caption: ReactNode; title?: string; header?: ReactNode }) {
  return (
    <figure className="overflow-hidden rounded-[1.4rem] border border-border bg-surface shadow-sm">
      <div className="flex items-center gap-2.5 border-b border-border bg-surface-muted/60 px-3.5 py-2.5">
        {SAMPLE.photo ? <img src={SAMPLE.photo} alt="" className="size-10 shrink-0 rounded-md object-cover" loading="lazy" /> : <span className="size-10 shrink-0 rounded-md bg-surface-muted" aria-hidden />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-text">{title}</p>
          <p className="num text-xs text-text-muted">{fmt(priceCents)} · conversation avec {BUYER}</p>
        </div>
        {header}
      </div>
      <div className="flex flex-col gap-2 bg-bg px-3 py-3.5" role="list" aria-label="Exemple de conversation">
        {lines.map((l, i) => <Line key={i} line={l} />)}
      </div>
      <figcaption className="border-t border-border px-3.5 py-2.5 text-xs text-text-muted">{caption}</figcaption>
    </figure>
  );
}

function Line({ line }: { line: ChatLine }) {
  if (line.from === "event") {
    return (
      <div role="listitem" className="flex justify-center">
        <span className={cn("inline-flex max-w-[92%] items-center gap-1.5 rounded-full px-2.5 py-1 text-center text-[11px] font-medium", line.tone === "success" ? "bg-success/10 text-success" : line.tone === "accent" ? "bg-accent-soft text-accent" : "bg-surface-muted text-text-muted")}>
          {line.tone === "success" ? <Check className="size-3 shrink-0" aria-hidden /> : <Clock className="size-3 shrink-0" aria-hidden />}{line.text}{line.time ? <span className="num opacity-70">· {line.time}</span> : null}
        </span>
      </div>
    );
  }
  if (line.from === "offer") {
    const mine = line.by === "seller";
    const label = line.status === "finale" ? "Offre finale" : line.status === "lot" ? "Offre pour le lot" : mine ? "Votre offre" : `Offre de ${BUYER}`;
    return (
      <div role="listitem" className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
        <div className={cn("w-[78%] rounded-xl border bg-surface px-3 py-2.5", mine ? "border-accent/40" : "border-border")}>
          <p className="flex items-center justify-between gap-2 text-[11px] font-semibold text-text-muted">{label}{line.auto ? <AutoTag /> : null}</p>
          <p className="num mt-0.5 text-lg font-bold text-text">{fmt(line.cents)}{line.originalCents ? <span className="ml-2 text-xs font-normal text-text-muted line-through">{fmt(line.originalCents)}</span> : null}</p>
          <p className={cn("mt-1 text-[11px] font-medium", line.status === "acceptée" ? "text-success" : line.status === "refusée" ? "text-danger" : "text-text-muted")}>
            {line.status === "acceptée" ? "Acceptée" : line.status === "refusée" ? "Refusée" : mine ? "En attente de réponse" : "À traiter"}
          </p>
        </div>
        {line.time ? <span className="num mt-0.5 px-1 text-[10px] text-text-subtle">{line.time}</span> : null}
      </div>
    );
  }
  const mine = line.from === "seller";
  return (
    <div role="listitem" className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
      <p className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-snug", mine ? "rounded-br-sm bg-accent text-accent-on" : "rounded-bl-sm bg-surface-muted text-text")}>{line.text}</p>
      <span className="num mt-0.5 flex items-center gap-1 px-1 text-[10px] text-text-subtle">{line.auto ? <AutoTag light /> : null}{line.time}</span>
    </div>
  );
}

function AutoTag({ light = false }: { light?: boolean }) {
  return <span className={cn("inline-flex items-center gap-0.5 rounded-sm px-1 text-[10px] font-semibold", light ? "text-accent" : "bg-accent-soft text-accent")}><Sparkles className="size-2.5" aria-hidden />Selio</span>;
}

/** Petit écran « téléphone » générique (notifications, annonce) pour les étapes sans conversation. */
export function PhoneCard({ title, children, caption }: { title: string; children: ReactNode; caption: ReactNode }) {
  return (
    <figure className="overflow-hidden rounded-[1.4rem] border border-border bg-surface shadow-sm">
      <p className="border-b border-border bg-surface-muted/60 px-3.5 py-2.5 text-sm font-semibold text-text">{title}</p>
      <div className="bg-bg px-3 py-3.5">{children}</div>
      <figcaption className="border-t border-border px-3.5 py-2.5 text-xs text-text-muted">{caption}</figcaption>
    </figure>
  );
}

/** En-tête de page d'automatisation : interrupteur général et rappel honnête sur l'exécution. */
export function HonestNote() {
  return <p className="mt-2 text-xs text-text-muted">En démonstration, rien n'est envoyé : les conversations à droite sont des exemples. Avec un compte Vinted, les actions passent par l'extension, navigateur ouvert (Selio Cloud, en développement, les fera tourner sans ordinateur allumé).</p>;
}
