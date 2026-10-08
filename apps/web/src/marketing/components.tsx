import type { ReactNode } from "react";
import { Link } from "react-router";
import { ArrowRight, Check, Clock } from "lucide-react";
import { Button, KpiCard, StatusBadge, Tag, cn, formatCents } from "@selio/ui";

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-content px-4 md:px-8", className)}>{children}</div>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-xs font-medium tracking-[0.04em] text-accent uppercase">{children}</p>;
}

export function Display({ children, className }: { children: ReactNode; className?: string }) {
  return <h1 className={cn("text-xl font-semibold text-text md:text-3xl", className)}>{children}</h1>;
}

export function Lead({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-md text-text-muted", className)}>{children}</p>;
}

export function MarketingSection({ eyebrow, title, lead, children, className, id, level = 2 }: { eyebrow?: string; title?: ReactNode; lead?: ReactNode; children?: ReactNode; className?: string; id?: string; level?: 1 | 2 }) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <section id={id} className={cn("py-12 md:py-16", className)}>
      <Container>
        {eyebrow || title ? (
          <div className="max-w-2xl">
            {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
            {title ? <Heading className="mt-2 text-xl font-semibold text-text md:text-[28px] md:leading-[34px]">{title}</Heading> : null}
            {lead ? <Lead className="mt-3">{lead}</Lead> : null}
          </div>
        ) : null}
        {children ? <div className={cn(eyebrow || title ? "mt-8" : "")}>{children}</div> : null}
      </Container>
    </section>
  );
}

export type Availability = "available" | "demo" | "experimental" | "planned";
export const AVAILABILITY: Record<Availability, { label: string; tone: "success" | "accent" | "warning" | "muted" }> = {
  available: { label: "Disponible", tone: "success" },
  demo: { label: "Démontré en simulation", tone: "accent" },
  experimental: { label: "Expérimental, à valider", tone: "warning" },
  planned: { label: "En préparation", tone: "muted" },
};

export function AvailabilityBadge({ value }: { value: Availability }) {
  const a = AVAILABILITY[value];
  return <StatusBadge tone={a.tone}>{a.label}</StatusBadge>;
}

export function FeatureCard({ title, children, availability, icon }: { title: string; children: ReactNode; availability?: Availability; icon?: ReactNode }) {
  return (
    <div className="card flex flex-col p-5">
      {icon ? <div className="mb-3 text-text [&>svg]:size-5" aria-hidden>{icon}</div> : null}
      <h3 className="text-md font-semibold text-text">{title}</h3>
      <p className="mt-1.5 flex-1 text-sm text-text-muted">{children}</p>
      {availability ? <div className="mt-4"><AvailabilityBadge value={availability} /></div> : null}
    </div>
  );
}

export function CtaBand({ title, lead }: { title: string; lead: string }) {
  return (
    <section className="border-t border-border bg-surface py-12 md:py-16">
      <Container className="flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
        <div className="max-w-xl">
          <h2 className="text-xl font-semibold text-text">{title}</h2>
          <p className="mt-2 text-base text-text-muted">{lead}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/inscription"><Button variant="accent" size="lg" iconRight={<ArrowRight />}>Créer un compte</Button></Link>
          <Link to="/demo"><Button variant="secondary" size="lg">Explorer la démo</Button></Link>
        </div>
      </Container>
    </section>
  );
}

export function CheckList({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-text">
          <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          {i}
        </li>
      ))}
    </ul>
  );
}

export function PlannedList({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-text-muted">
          <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
          {i}
        </li>
      ))}
    </ul>
  );
}

/** Aperçu produit : de vrais composants de l'application avec des données d'exemple (fictives, annoncées comme telles). */
export function ProductPreview() {
  return (
    <div className="card overflow-hidden p-0" aria-label="Aperçu de l'application avec des données d'exemple">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="text-sm font-medium text-text">Vue d'ensemble</span>
        <Tag>Données d'exemple</Tag>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-3">
        <KpiCard label="Chiffre d'affaires · 30 j" value={formatCents(186450)} delta={{ value: "+12,4 % vs période précédente", tone: "success" }} />
        <KpiCard label="Marge brute · 30 j" value={formatCents(79210)} delta={{ value: "42,5 % du CA", tone: "neutral" }} />
        <KpiCard label="Articles en vente" value="47" hint="6 dormants depuis plus de 45 jours" />
      </div>
      <div className="grid gap-3 border-t border-border p-4 md:grid-cols-2">
        <div className="card p-4">
          <p className="text-xs font-medium text-text-muted">Conversation · Léa M. · Veste en jean Levi's</p>
          <div className="mt-3 flex flex-col gap-2 text-sm">
            <p className="max-w-[85%] rounded-lg bg-surface-muted px-3 py-2 text-text">Bonjour, je vous propose 25 € avec envoi rapide.</p>
            <div className="ai-suggestion max-w-[85%] self-end p-3">
              <p className="text-xs font-medium text-accent">Suggestion IA · à valider</p>
              <p className="mt-1 text-text">Bonjour Léa, merci pour votre proposition. Je peux descendre à 33,25 €, c'est mon meilleur prix.</p>
            </div>
          </div>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium text-text-muted">Pourquoi cette contre-proposition ?</p>
          <ul className="mt-3 flex flex-col gap-1.5 text-sm text-text">
            <li className="flex gap-2"><StatusBadge tone="danger" dot>Offre 25,00 €</StatusBadge><span className="text-text-muted">sous le plancher de 30,00 €</span></li>
            <li className="flex gap-2"><StatusBadge tone="accent" dot>Contre 33,25 €</StatusBadge><span className="text-text-muted">prix affiché −5 %, 1er tour</span></li>
            <li className="flex gap-2"><StatusBadge tone="success" dot>Marge 15,25 €</StatusBadge><span className="text-text-muted">46 % du prix de vente</span></li>
          </ul>
          <p className="mt-3 text-xs text-text-muted">La règle décide, l'IA rédige. Rien ne part sans votre validation.</p>
        </div>
      </div>
    </div>
  );
}
