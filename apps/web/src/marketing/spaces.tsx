import type { ReactNode } from "react";
import { Link } from "react-router";
import { ArrowRight, Check, Clock, Radar } from "lucide-react";
import { spaceById } from "../app/spaces/spaces";
import { PRODUCTS, type ProductDef, type ProductSlug } from "./products";

/**
 * La gamme Selio sur la vitrine (accueil, plateforme) : les pages produit de
 * ./products, dans l'ordre du parcours (Manager, Studio, Track, Radar, Bot,
 * Cloud, Agents, Selio Comptes). Les noms et les icônes suivent l'application
 * (app/spaces/spaces.tsx) ; l'état affiché est celui de la page produit, sans
 * jamais renvoyer vers la démonstration.
 */
export const RANGE = PRODUCTS;

/** Icône d'un produit : celle de son espace, ou le radar pour Selio Radar (qui vit dans Selio Manager). */
export function productIcon(product: ProductDef): ReactNode {
  return product.spaceId ? spaceById(product.spaceId).icon : <Radar />;
}

export function ProductStateBadge({ product }: { product: ProductDef }) {
  return <span className="mk-badge" data-value={product.state.value}>{product.state.label}</span>;
}

/** Carte d'un produit de la gamme : promesse, état, et le lien vers sa page. */
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
      <p className="mt-auto pt-5">
        <Link to={product.path} className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
          Découvrir<span className="sr-only"> {product.name}</span> <ArrowRight className="size-4" aria-hidden />
        </Link>
      </p>
    </article>
  );
}

/**
 * Constellation de la gamme (décor, écran large) : Selio Manager au centre,
 * les autres produits reliés ; trait plein pour ce qui est disponible,
 * pointillé pour le reste.
 */
export function RangeConstellation() {
  const pos: Record<ProductSlug, [number, number]> = { manager: [320, 128], studio: [110, 46], track: [80, 150], radar: [190, 222], bot: [450, 222], cloud: [560, 150], agents: [530, 46], comptes: [320, 18] };
  const center = pos.manager;
  return (
    <svg viewBox="0 0 640 270" className="mk-spaces-map" role="img" aria-label={`Selio Manager au centre, relié à ${RANGE.filter((p) => p.slug !== "manager").map((p) => p.name).join(", ")}`}>
      {RANGE.filter((p) => p.slug !== "manager").map((p) => (
        <line key={p.slug} x1={center[0]} y1={center[1]} x2={pos[p.slug][0]} y2={pos[p.slug][1]} className="mk-spaces-link" data-planned={p.state.value === "available" ? undefined : ""} />
      ))}
      {RANGE.map((p) => {
        const [x, y] = pos[p.slug];
        const main = p.slug === "manager";
        return (
          <g key={p.slug}>
            <circle cx={x} cy={y} r={main ? 26 : 16} className="mk-spaces-halo" data-tone={p.slug === "studio" ? "gold" : undefined} />
            <circle cx={x} cy={y} r={main ? 5.5 : 3.6} className="mk-sky-star" data-tone={p.slug === "studio" ? "gold" : undefined} />
            <text x={x} y={y + (main ? 46 : 32)} textAnchor="middle" className="mk-spaces-label">{p.name}</text>
            <text x={x} y={y + (main ? 64 : 47)} textAnchor="middle" className="mk-spaces-sub">{p.state.label}</text>
          </g>
        );
      })}
    </svg>
  );
}
