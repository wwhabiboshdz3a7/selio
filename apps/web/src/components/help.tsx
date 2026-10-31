import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { ArrowRight, BookOpen, Check, ChevronDown, Link2, Search, Sparkles, X } from "lucide-react";
import { helpAskInput, type HelpAnswer } from "@selio/contracts";
import { HELP_CATEGORIES, helpEntries, answerFromHelp, helpCategoryById, searchHelp, toHelpSource, type HelpCategoryId, type HelpEntry } from "@selio/domain/help";
import { Alert, Button, IconButton, Input, Tag, cn } from "@selio/ui";
import { errorMessage } from "../lib/errors";

/**
 * Typographie française à l'affichage : espaces insécables entre un nombre et ce qui le suit
 * (« 1 semaine », « 5 000 »), avant « ? : ; ! » et à l'intérieur des guillemets.
 */
export function frenchSpacing(text: string): string {
  return text
    .replace(/(\d) (?=\S)/g, "$1 ")
    .replace(/ ([?:;!»])/g, " $1")
    .replace(/« /g, "« ");
}

/** Paragraphes d'une réponse (séparés par une ligne vide). */
function Paragraphs({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {text.split(/\n{2,}/).map((p, i) => <p key={i}>{frenchSpacing(p)}</p>)}
    </div>
  );
}

/**
 * Réponse tirée de la FAQ par recherche locale (vitrine statique) : aucun appel réseau,
 * aucune IA. Même contenu et même recherche que le serveur.
 */
export async function askFaqLocally(question: string): Promise<HelpAnswer> {
  const parsed = helpAskInput.safeParse({ question });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Question invalide");
  const faq = answerFromHelp(parsed.data.question);
  return { question: parsed.data.question, answer: faq.answer, found: faq.found, source: "faq", sources: faq.sources.map(toHelpSource), simulated: false, provider: null, model: null, fallbackReason: null };
}

const SUGGESTIONS = [
  "L'essai est-il vraiment gratuit ?",
  "Puis-je connecter plusieurs comptes Vinted ?",
  "Comment est calculée la marge ?",
  "Selio achète-t-il réellement sur Vinted ?",
];

export interface HelpAskPanelProps {
  /** Pose la question (recherche locale ou assistant IA). */
  ask: (question: string) => Promise<HelpAnswer>;
  /** « local » : vitrine et démonstration ; « ai » : mode connecté. */
  engine: "local" | "ai";
  /** Lien vers une question de la FAQ (ancre partageable). */
  sourceHref: (id: string) => string;
  className?: string;
  /** Pied de panneau (lien vers le contact, l'aide de l'application…). */
  footer?: ReactNode;
}

/**
 * « Poser une question » : la réponse est rédigée à partir des passages les plus pertinents
 * de la FAQ, avec les questions sources cliquables. L'origine de la réponse est toujours dite.
 */
export function HelpAskPanel({ ask, engine, sourceHref, className, footer }: HelpAskPanelProps) {
  const inputId = useId();
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<HelpAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (q: string) => {
    const text = q.trim();
    if (text.length < 3) {
      setError("Posez une question d'au moins trois caractères.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      setResult(await ask(text));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit(question);
  };

  return (
    <section aria-labelledby={`${inputId}-titre`} className={cn("card p-4 md:p-6", className)}>
      <div className="flex items-start gap-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent" aria-hidden><Sparkles className="size-[18px]" /></span>
        <div className="min-w-0">
          <h2 id={`${inputId}-titre`} className="text-md font-semibold text-text">Poser une question</h2>
          <p className="mt-0.5 text-sm text-text-muted">
            {engine === "ai"
              ? "L'assistant IA rédige la réponse à partir des passages les plus pertinents de la FAQ, et cite ses sources."
              : "La réponse est tirée de la FAQ : les passages les plus pertinents, avec leurs questions sources."}
          </p>
        </div>
      </div>
      <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-2 sm:flex-row" role="search">
        <label htmlFor={inputId} className="sr-only">Votre question</label>
        <Input ref={inputRef} id={inputId} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Par exemple : comment fonctionne l'essai gratuit ?" maxLength={500} className="min-w-0 sm:flex-1" autoComplete="off" />
        <Button type="submit" variant="accent" loading={pending}>Demander</Button>
      </form>
      {!result && !pending ? (
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Exemples de questions">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" onClick={() => { setQuestion(s); void submit(s); }} className="rounded-full border border-border px-3 py-1 text-xs text-text-muted transition-colors hover:border-accent/40 hover:text-text">{s}</button>
          ))}
        </div>
      ) : null}
      {error ? <Alert tone="danger" className="mt-4">{error}</Alert> : null}
      <div aria-live="polite">
        {result ? <HelpAnswerView result={result} engine={engine} sourceHref={sourceHref} onClear={() => { setResult(null); setQuestion(""); inputRef.current?.focus(); }} /> : null}
      </div>
      {footer ? <div className="mt-4 border-t border-border pt-3 text-sm text-text-muted">{footer}</div> : null}
    </section>
  );
}

function HelpAnswerView({ result, engine, sourceHref, onClear }: { result: HelpAnswer; engine: "local" | "ai"; sourceHref: (id: string) => string; onClear: () => void }) {
  const origin = !result.found
    ? "Aucune réponse dans la FAQ"
    : result.source === "ai"
      ? result.simulated ? "Rédigée par l'assistant (simulateur) à partir de la FAQ" : "Rédigée par l'assistant IA à partir de la FAQ"
      : "Réponse tirée de la FAQ";
  return (
    <div className="mt-5 rounded-lg bg-surface-muted/60 p-4 md:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-xs font-medium text-text-muted">
            {result.source === "ai" ? <Sparkles className="size-3.5 text-accent" aria-hidden /> : <BookOpen className="size-3.5 text-accent" aria-hidden />}
            <span data-testid="help-origin">{origin}</span>
          </p>
          <p className="mt-1 text-sm font-medium text-text">{frenchSpacing(`« ${result.question.trim()} »`)}</p>
        </div>
        <IconButton label="Effacer la réponse" size="sm" onClick={onClear}><X /></IconButton>
      </div>
      <Paragraphs text={result.answer} className="mt-3 max-w-prose text-base text-text" />
      {engine === "ai" && result.found && result.source === "faq" && result.fallbackReason ? <p className="mt-2 text-xs text-text-muted">{result.fallbackReason}</p> : null}
      {result.sources.length ? (
        <div className="mt-4">
          <p className="text-xs font-medium tracking-wider text-text-muted uppercase">Questions sources</p>
          <ul className="mt-2 flex flex-col gap-1">
            {result.sources.map((s) => (
              <li key={s.id}>
                <Link to={sourceHref(s.id)} className="group inline-flex items-baseline gap-2 text-sm text-text hover:text-accent">
                  <ArrowRight className="size-3.5 shrink-0 translate-y-0.5 text-text-muted group-hover:text-accent" aria-hidden />
                  <span>{frenchSpacing(s.question)} <span className="text-text-muted">· {s.categoryTitle}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export interface FaqBrowserProps {
  /** Préfixe des liens partagés (chemin de la page qui affiche la FAQ). */
  basePath: string;
  /** Afficher les liens vers les pages de l'application (/app/…). */
  appLinks: boolean;
  className?: string;
  /** Titre de niveau 2 au-dessus des catégories (accessibilité). */
  heading?: string;
}

/**
 * FAQ complète : recherche instantanée, catégories, questions dépliables et ancres
 * partageables (#identifiant). Ouvre et montre la question visée par l'adresse.
 */
export function FaqBrowser({ basePath, appLinks, className, heading = "Toutes les questions" }: FaqBrowserProps) {
  const location = useLocation();
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [copied, setCopied] = useState<string | null>(null);
  const [scrollTo, setScrollTo] = useState<string | null>(null);
  // Le premier résultat d'une recherche s'ouvre seul, sauf si on le referme.
  const [autoClosedFor, setAutoClosedFor] = useState<string | null>(null);
  const trimmed = query.trim();
  const results = useMemo(() => (trimmed.length >= 2 ? searchHelp(trimmed, { limit: 12 }) : null), [trimmed]);
  const autoOpenId = results && autoClosedFor !== trimmed ? results[0]?.entry.id ?? null : null;

  // L'ancre de l'adresse (/faq#identifiant, lien partagé ou question source) ouvre la question.
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id || !helpEntries().some((e) => e.id === id)) return;
    setQuery("");
    setOpen((s) => new Set(s).add(id));
    setScrollTo(id);
  }, [location.hash, location.key]);
  // Défilement une fois la vue par catégories affichée.
  useEffect(() => {
    if (!scrollTo) return;
    document.getElementById(scrollTo)?.scrollIntoView({ block: "start" });
    setScrollTo(null);
  }, [scrollTo]);

  const toggle = (id: string, value: boolean) => {
    if (!value && id === autoOpenId) setAutoClosedFor(trimmed);
    setOpen((s) => {
      const next = new Set(s);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const copyLink = (id: string) => {
    const url = `${window.location.origin}${basePath}#${id}`;
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(id);
      window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 2000);
    }).catch(() => undefined);
  };
  const entryProps = { open, autoOpenId, onToggle: toggle, onCopy: copyLink, copied, basePath, appLinks };

  return (
    <div className={className}>
      <div className="flex flex-col gap-3">
        <label htmlFor={searchId} className="text-sm font-medium text-text">Rechercher dans l'aide</label>
        <Input id={searchId} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Essai, extension, marge, export…" prefix={<Search />} autoComplete="off" />
        {!results ? (
          <nav aria-label="Catégories de l'aide" className="flex flex-wrap gap-1.5">
            {HELP_CATEGORIES.map((c) => (
              <a key={c.id} href={`#categorie-${c.id}`} className="rounded-full border border-border px-3 py-1 text-xs text-text-muted transition-colors hover:border-accent/40 hover:text-text">{c.title}</a>
            ))}
          </nav>
        ) : null}
      </div>

      <h2 className="sr-only">{heading}</h2>
      {results ? (
        <div className="mt-6">
          <p className="text-sm text-text-muted" aria-live="polite">{results.length === 0 ? `Aucune réponse pour « ${trimmed} ». Essayez un autre mot, ou posez la question à l'assistant.` : `${results.length} réponse${results.length > 1 ? "s" : ""} pour « ${trimmed} »`}</p>
          {results.length ? (
            <div className="card mt-3 divide-y divide-border overflow-hidden">
              {results.map((r) => <FaqEntry key={r.entry.id} entry={r.entry} showCategory {...entryProps} />)}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-10">
          {HELP_CATEGORIES.map((c) => {
            const entries = helpEntries().filter((e) => e.categoryId === c.id);
            return (
              <section key={c.id} id={`categorie-${c.id}`} aria-labelledby={`titre-${c.id}`} className="scroll-mt-24">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h3 id={`titre-${c.id}`} className="text-lg font-semibold tracking-[-0.01em] text-text">{c.title}</h3>
                  <span className="num text-xs text-text-muted">{entries.length} questions</span>
                </div>
                <p className="mt-1 text-sm text-text-muted">{c.summary}</p>
                <div className="card mt-3 divide-y divide-border overflow-hidden">
                  {entries.map((e) => <FaqEntry key={e.id} entry={e} {...entryProps} />)}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FaqEntry({ entry, open, autoOpenId, onToggle, onCopy, copied, showCategory = false, basePath, appLinks }: { entry: HelpEntry; open: Set<string>; autoOpenId: string | null; onToggle: (id: string, value: boolean) => void; onCopy: (id: string) => void; copied: string | null; showCategory?: boolean; basePath: string; appLinks: boolean }) {
  const isOpen = open.has(entry.id) || autoOpenId === entry.id;
  const category = helpCategoryById(entry.categoryId as HelpCategoryId);
  // Pas de lien vers la page courante ; les pages de l'application seulement avec une session.
  const link = entry.link && entry.link.href !== basePath && (appLinks || !entry.link.href.startsWith("/app")) ? entry.link : null;
  return (
    <details id={entry.id} open={isOpen} onToggle={(e) => { if (e.currentTarget.open !== isOpen) onToggle(entry.id, e.currentTarget.open); }} className="group scroll-mt-24">
      <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3.5 hover:bg-surface-muted/50 md:px-5 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="block text-base font-medium text-text">{frenchSpacing(entry.question)}</span>
          {showCategory && category ? <span className="mt-0.5 block text-xs text-text-muted">{category.title}</span> : null}
        </span>
        {entry.status === "planned" ? <Tag className="shrink-0">En préparation</Tag> : null}
        <ChevronDown className="mt-0.5 size-4 shrink-0 text-text-muted transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="px-4 pb-4 md:px-5">
        <Paragraphs text={entry.answer} className="max-w-prose text-sm text-text-muted" />
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          {link ? (
            <Link to={link.href} className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">{link.label}<ArrowRight className="size-3.5" aria-hidden /></Link>
          ) : null}
          <button type="button" onClick={() => onCopy(entry.id)} className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text">
            {copied === entry.id ? <Check className="size-3.5 text-success" aria-hidden /> : <Link2 className="size-3.5" aria-hidden />}
            {copied === entry.id ? "Lien copié" : "Copier le lien"}
          </button>
        </div>
      </div>
    </details>
  );
}
