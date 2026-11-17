import type { ReactNode } from "react";
import { Link } from "react-router";
import { ArrowRight, Bot, Check, Clock, Cloud, Gauge, Sparkles, TrendingUp, UserPlus, Users } from "lucide-react";
import { MANAGER_FEATURES, PRODUCTS, type ProductDef, type ProductSlug } from "./products";

/**
 * La gamme Selio sur la vitrine (accueil, plateforme) : les cinq filiales de ./products, dans
 * l'ordre officiel (Manager, Studio, Track, Bot, Compte). Selio Cloud et Selio Agent sont
 * présentés sous Selio Manager, comme ses fonctionnalités intégrées, jamais comme des filiales.
 * L'état affiché est celui de la page produit, sans jamais renvoyer vers la démonstration.
 */
export const RANGE = PRODUCTS;

const ICONS: Record<ProductSlug, ReactNode> = {
  manager: <Gauge />,
  studio: <Sparkles />,
  track: <TrendingUp />,
  bot: <Bot />,
  compte: <UserPlus />,
  cloud: <Cloud />,
  agent: <Users />,
};

/** Icône d'un produit ou d'une fonctionnalité de Selio Manager. */
export function productIcon(product: ProductDef): ReactNode {
  return ICONS[product.slug];
}

export function ProductStateBadge({ product }: { product: ProductDef }) {
  return <span className="mk-badge" data-value={product.state.value}>{product.state.label}</span>;
}

/** Carte d'une filiale : positionnement, état, et le lien vers sa page ; Manager montre ses deux fonctionnalités intégrées. */
export function RangeCard({ product, compact = false }: { product: ProductDef; compact?: boolean }) {
  const ready = product.state.value === "available";
  return (
    <article className="card mk-card flex flex-col p-5 md:p-6" data-reveal="" aria-labelledby={`vitrine-gamme-${product.slug}`}>
      <div className="flex items-start justify-between gap-3">
        <span className="mk-icon" data-tone={product.slug === "studio" ? "gold" : undefined} aria-hidden>{productIcon(product)}</span>
        <ProductStateBadge product={product} />
      </div>
      <h3 id={`vitrine-gamme-${product.slug}`} className="mt-4 text-md font-bold text-text">{product.name}</h3>
      <p className="mt-1 text-sm text-text-muted">{product.tagline}</p>
      {compact ? null : (
        <ul className="mt-4 flex flex-col gap-2">
          {product.does.slice(0, 3).map((d) => (
            <li key={d.title} className={ready ? "flex items-start gap-2 text-sm text-text" : "flex items-start gap-2 text-sm text-text-muted"}>
              {ready ? <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden /> : <Clock className="mt-0.5 size-4 shrink-0 text-text-subtle" aria-hidden />}
              {d.title}
            </li>
          ))}
        </ul>
      )}
      {product.slug === "manager" ? <ManagerFeatureLinks /> : null}
      <p className="mt-auto pt-5">
        <Link to={product.path} className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
          Découvrir<span className="sr-only"> {product.name}</span> <ArrowRight className="size-4" aria-hidden />
        </Link>
      </p>
    </article>
  );
}

/** Selio Cloud et Selio Agent, sous Selio Manager : des fonctionnalités, pas des filiales. */
function ManagerFeatureLinks() {
  return (
    <div className="mt-4 rounded-lg border border-border bg-surface-muted/50 px-3 py-2.5" data-testid="manager-features">
      <p className="text-xs font-medium tracking-[0.04em] text-text-muted uppercase">Fonctionnalités intégrées</p>
      <ul className="mt-1.5 flex flex-col gap-1">
        {MANAGER_FEATURES.map((f) => (
          <li key={f.slug} className="flex items-center gap-2 text-sm">
            <span className="size-4 shrink-0 text-text-subtle [&>svg]:size-4" aria-hidden>{productIcon(f)}</span>
            <Link to={f.path} className="font-medium text-text hover:text-accent">{f.name}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Constellation de la gamme (décor, écran large) : Selio Manager au centre avec ses deux
 * fonctionnalités (Selio Cloud, Selio Agent) en satellites, les quatre autres filiales reliées ;
 * trait plein pour ce qui est disponible, pointillé pour le reste.
 */
export function RangeConstellation() {
  const pos: Record<ProductSlug, [number, number]> = { manager: [320, 112], studio: [110, 46], track: [90, 196], bot: [550, 196], compte: [530, 46], cloud: [252, 200], agent: [388, 200] };
  const center = pos.manager;
  const others = RANGE.filter((p) => p.slug !== "manager");
  const label = `Selio Manager au centre, avec ses fonctionnalités intégrées ${MANAGER_FEATURES.map((f) => f.name).join(" et ")}, relié à ${others.map((p) => p.name).join(", ")}`;
  return (
    <svg viewBox="0 0 640 270" className="mk-spaces-map" role="img" aria-label={label}>
      {others.map((p) => (
        <line key={p.slug} x1={center[0]} y1={center[1]} x2={pos[p.slug][0]} y2={pos[p.slug][1]} className="mk-spaces-link" data-planned={p.state.value === "available" ? undefined : ""} />
      ))}
      {MANAGER_FEATURES.map((f) => (
        <line key={f.slug} x1={center[0]} y1={center[1]} x2={pos[f.slug][0]} y2={pos[f.slug][1]} className="mk-spaces-link" data-planned="" />
      ))}
      {RANGE.map((p) => {
        const [x, y] = pos[p.slug];
        const main = p.slug === "manager";
        return (
          <g key={p.slug}>
            <circle cx={x} cy={y} r={main ? 26 : 16} className="mk-spaces-halo" data-tone={p.slug === "studio" ? "gold" : undefined} />
            <circle cx={x} cy={y} r={main ? 5.5 : 3.6} className="mk-sky-star" data-tone={p.slug === "studio" ? "gold" : undefined} />
            <text x={x} y={main ? y - 38 : y + 32} textAnchor="middle" className="mk-spaces-label">{p.name}</text>
            <text x={x} y={main ? y - 22 : y + 47} textAnchor="middle" className="mk-spaces-sub">{p.state.label}</text>
          </g>
        );
      })}
      {MANAGER_FEATURES.map((f) => {
        const [x, y] = pos[f.slug];
        return (
          <g key={f.slug}>
            <circle cx={x} cy={y} r={2.6} className="mk-sky-star" />
            <text x={x} y={y + 22} textAnchor="middle" className="mk-spaces-label">{f.name}</text>
            <text x={x} y={y + 37} textAnchor="middle" className="mk-spaces-sub">dans Selio Manager</text>
          </g>
        );
      })}
    </svg>
  );
}
