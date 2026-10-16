import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";
import { Link } from "react-router";
import { ArrowRight, Check, Clock } from "lucide-react";
import { Button, cn } from "@selio/ui";
import { seeded } from "./constellation/geometry";
import "./marketing.css";

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-content px-4 md:px-8", className)}>{children}</div>;
}

/** Étoile à quatre branches, motif de la constellation Selio. */
export function Sparkle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true" focusable="false">
      <path d="M8 0c.5 4.2 3.3 7 8 8-4.7 1-7.5 3.8-8 8-.5-4.2-3.3-7-8-8 4.7-1 7.5-3.8 8-8Z" fill="currentColor" />
    </svg>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("mk-eyebrow", className)}>
      <Sparkle className="mk-eyebrow-star" />
      {children}
    </p>
  );
}

export function Lead({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-md text-text-muted", className)}>{children}</p>;
}

type FxKind = "sky" | "reveal" | "flow";

/**
 * Effet décoratif (anime.js) chargé à la demande : jamais en mouvement réduit,
 * nettoyé à la sortie de la page. Sans lui, le contenu reste complet et lisible.
 */
export function useFx(ref: RefObject<Element | null>, kind: FxKind) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    import("./fx")
      .then((fx) => {
        if (cancelled) return;
        try {
          cleanup = fx[kind](el);
        } catch (error) {
          console.warn("Effet de vitrine ignoré", error);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [ref, kind]);
}

export function MarketingSection({ eyebrow, title, lead, children, className, id, level = 2, reveal = false }: { eyebrow?: string; title?: ReactNode; lead?: ReactNode; children?: ReactNode; className?: string; id?: string; level?: 1 | 2; reveal?: boolean }) {
  // L'apparition au défilement ne s'attache qu'aux sections qui la demandent.
  const ref = useRef<HTMLElement>(null);
  useFx(ref, "reveal");
  const Heading = level === 1 ? "h1" : "h2";
  const hero = level === 1;
  return (
    <section ref={reveal ? ref : undefined} id={id} className={cn(hero ? "mk-hero pt-14 pb-12 md:pt-20 md:pb-16" : "py-12 md:py-16", className)}>
      <Container>
        {eyebrow || title ? (
          <div className={hero ? "max-w-3xl" : "max-w-2xl"}>
            {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
            {title ? <Heading className={hero ? "mk-display mt-4" : "mt-3 text-xl font-semibold tracking-[-0.015em] text-text md:text-[28px] md:leading-[34px]"}>{title}</Heading> : null}
            {lead ? <Lead className={hero ? "mt-4 max-w-2xl" : "mt-3"}>{lead}</Lead> : null}
          </div>
        ) : null}
        {children ? <div className={cn(eyebrow || title ? (hero ? "mt-10" : "mt-8") : "")}>{children}</div> : null}
      </Container>
    </section>
  );
}

export type Availability = "available" | "demo" | "experimental" | "planned";
export const AVAILABILITY_LABEL: Record<Availability, string> = {
  available: "Disponible",
  demo: "Démontré en simulation",
  experimental: "Expérimental, à valider",
  planned: "En préparation",
};

export function AvailabilityBadge({ value }: { value: Availability }) {
  return <span className="mk-badge" data-value={value}>{AVAILABILITY_LABEL[value]}</span>;
}

export function FeatureCard({ title, children, availability, icon, tone }: { title: string; children: ReactNode; availability?: Availability; icon?: ReactNode; tone?: "gold" }) {
  return (
    <div className="card mk-card flex flex-col p-5" data-reveal="">
      {icon ? <span className="mk-icon mb-4" data-tone={tone} aria-hidden>{icon}</span> : null}
      <h3 className="text-md font-semibold text-text">{title}</h3>
      <p className="mt-1.5 flex-1 text-sm text-text-muted">{children}</p>
      {availability ? <div className="mt-4"><AvailabilityBadge value={availability} /></div> : null}
    </div>
  );
}

interface SkyStar { x: number; y: number; r: number; o: number; gold: boolean }

/** Ciel en 1200 × 300 : les constellations restent hors des zones de texte du bandeau. */
function buildSky(seed: number, withLines: boolean): { stars: SkyStar[]; halos: SkyStar[]; lines: { points: string; gold: boolean }[] } {
  const rnd = seeded(seed);
  const round = (n: number) => Math.round(n * 10) / 10;
  const stars: SkyStar[] = Array.from({ length: withLines ? 46 : 34 }, () => ({
    x: round(rnd() * 1200),
    y: round(rnd() * 300),
    r: round(0.5 + rnd() ** 3 * 1.3),
    o: round(0.3 + rnd() * 0.55),
    gold: rnd() < 0.12,
  }));
  const halos: SkyStar[] = [];
  const constellation = (cx: number, cy: number, n: number, gold: boolean) => {
    const pts = Array.from({ length: n }, (_, i) => ({ x: round(cx + (i - (n - 1) / 2) * (58 + rnd() * 22)), y: round(cy + (rnd() - 0.5) * 56) }));
    pts.forEach((p, i) => {
      const star = { x: p.x, y: p.y, r: round(1.5 + rnd() * 0.8), o: 0.95, gold: gold && i === n - 1 };
      stars.push(star);
      halos.push({ ...star, r: star.r * 4.5, o: 0.14 });
    });
    return pts.map((p) => `${p.x},${p.y}`).join(" ");
  };
  const lines = withLines
    ? [
        { points: constellation(740, 70, 5, true), gold: false },
        { points: constellation(1040, 232, 4, false), gold: true },
      ]
    : [];
  return { stars, halos, lines };
}

/** Ciel nocturne décoratif (SVG), animé par anime.js si le mouvement est permis. */
export function NightSky({ seed = 7, lines = true }: { seed?: number; lines?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const sky = useMemo(() => buildSky(seed, lines), [seed, lines]);
  useFx(ref, "sky");
  return (
    <svg ref={ref} className="mk-sky" viewBox="0 0 1200 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      {sky.halos.map((s, i) => <circle key={`h${i}`} className="mk-sky-halo" data-tone={s.gold ? "gold" : undefined} cx={s.x} cy={s.y} r={s.r} opacity={s.o} />)}
      {sky.lines.map((l, i) => <polyline key={`l${i}`} className="mk-sky-line" data-tone={l.gold ? "gold" : undefined} points={l.points} />)}
      {sky.stars.map((s, i) => <circle key={`s${i}`} className="mk-sky-star" data-tone={s.gold ? "gold" : undefined} cx={s.x} cy={s.y} r={s.r} opacity={s.o} />)}
    </svg>
  );
}

export function CtaBand({ title, lead, seed = 7 }: { title: string; lead: string; seed?: number }) {
  return (
    <section className="py-12 md:py-20">
      <Container>
        <div className="mk-night px-6 py-10 sm:px-10 md:px-14 md:py-14">
          <NightSky seed={seed} />
          <div className="flex flex-col items-start gap-7 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-xl">
              <Eyebrow>Sans compte ni carte bancaire</Eyebrow>
              <h2 className="mk-night-title mt-3 text-xl font-semibold tracking-[-0.02em] md:text-[28px] md:leading-[34px]">{title}</h2>
              <p className="mk-night-text mt-3 text-base">{lead}</p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Link to="/inscription" className="mk-cta-link">
                <Button variant="accent" size="lg" iconRight={<ArrowRight />} tabIndex={-1}>Créer un compte</Button>
              </Link>
              <Link to="/demo" className="mk-ghost">Explorer la démo</Link>
            </div>
          </div>
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
          <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
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
          <Clock className="mt-0.5 size-4 shrink-0 text-text-subtle" aria-hidden />
          {i}
        </li>
      ))}
    </ul>
  );
}
