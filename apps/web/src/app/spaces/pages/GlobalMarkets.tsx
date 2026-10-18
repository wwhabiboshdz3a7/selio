import { useMemo } from "react";
import { Link } from "react-router";
import { Clock, Ruler } from "lucide-react";
import { Card, PageHeader, StatusBadge, Tag, buttonClass } from "@selio/ui";
import { MARKETS, MARKET_STATE_LABEL, type Market } from "../global-data";
import { PreviewNotice } from "../components";
import { useAllSales } from "../studio-data";

const GROUPS: { state: Market["state"]; title: string; lead: string }[] = [
  { state: "available", title: "Disponible", lead: "Le marché où Selio fonctionne aujourd'hui." },
  { state: "preparing", title: "Europe — en préparation", lead: "Les marchés voisins, chacun avec sa langue, ses tailles et ses marques." },
  { state: "later", title: "Ensuite", lead: "Après l'Europe : les États-Unis et l'Australie." },
];

const PER_COUNTRY = [
  { t: "Annonces dans la langue du pays", d: "Rédigées par Studio, avec les mots que les acheteurs locaux recherchent." },
  { t: "Tailles converties", d: "La taille de chaque article affichée dans le système du pays." },
  { t: "Prix dans la devise locale", d: "Calculés sur les ventes comparables du marché, jamais inventés." },
  { t: "Marques et niches locales", d: "Le radar et l'analyse des revendeurs, réglés sur le marché." },
];

function MarketCard({ market, topBrands }: { market: Market; topBrands?: string[] }) {
  const rows: [string, string][] = [
    ["Langue", market.language],
    ["Devise", market.currency],
    ["Vinted", market.vintedDomain ?? "Présence à confirmer"],
    ["Tailles vêtements", market.clothingSizes],
    ["Tailles chaussures", market.shoeSizes],
  ];
  return (
    <article className="card flex min-w-0 flex-col p-4 md:p-5" aria-labelledby={`marche-${market.code}`}>
      <div className="flex items-start gap-3">
        <span className="space-tile num size-9 text-xs font-semibold" aria-hidden>{market.code}</span>
        <div className="min-w-0 flex-1">
          <h3 id={`marche-${market.code}`} className="text-base font-semibold text-text">{market.name}</h3>
          <p className="text-xs text-text-muted">{market.region}</p>
        </div>
        <StatusBadge tone={market.state === "available" ? "success" : market.state === "preparing" ? "accent" : "neutral"} className="shrink-0">{MARKET_STATE_LABEL[market.state]}</StatusBadge>
      </div>
      <dl className="mt-4 flex flex-col gap-1.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 text-text-muted">{k}</dt>
            <dd className="min-w-0 text-right text-text">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 border-t border-border pt-3">
        {topBrands && topBrands.length > 0 ? (
          <>
            <p className="text-xs font-medium text-text">Vos marques les plus vendues</p>
            <p className="mt-1.5 flex flex-wrap gap-1.5">{topBrands.map((b) => <Tag key={b} accent>{b}</Tag>)}</p>
            <p className="mt-2 text-[11px] text-text-muted">D'après vos ventes enregistrées.</p>
          </>
        ) : (
          <>
            <p className="text-xs font-medium text-text">Marques souvent recherchées</p>
            <p className="mt-1.5 flex flex-wrap gap-1.5">{market.brands.map((b) => <Tag key={b}>{b}</Tag>)}</p>
            <p className="mt-2 text-[11px] text-text-muted">Repère indicatif, pas une mesure Selio.</p>
          </>
        )}
      </div>
    </article>
  );
}

export default function GlobalMarkets() {
  const sales = useAllSales();
  const topBrands = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sales.data ?? []) if (s.brand) counts.set(s.brand, (counts.get(s.brand) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([b]) => b);
  }, [sales.data]);

  return (
    <>
      <PageHeader
        eyebrow="Selio Global · En préparation"
        title="Marchés"
        description="Chaque pays a ses codes : sa langue, sa devise, ses tailles et ses marques. Selio Global préparera une application par pays, en commençant par l'Europe."
        actions={<Link to="/global/tailles" className={buttonClass({ variant: "secondary" })}><Ruler aria-hidden /> Convertisseur de tailles</Link>}
      />
      <PreviewNotice space="global">Seul le marché français est ouvert. Les autres fiches sont des repères pour préparer la suite : aucune annonce n'est publiée hors de France, aucune date n'est annoncée.</PreviewNotice>

      <div className="flex flex-col gap-8">
        {GROUPS.map((g) => (
          <section key={g.state} aria-labelledby={`groupe-${g.state}`}>
            <h2 id={`groupe-${g.state}`} className="text-md font-semibold text-text">{g.title}</h2>
            <p className="mb-3 text-sm text-text-muted">{g.lead}</p>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {MARKETS.filter((m) => m.state === g.state).map((m) => <MarketCard key={m.code} market={m} topBrands={m.code === "FR" ? topBrands : undefined} />)}
              {g.state === "available" ? (
                <Card className="xl:col-span-2">
                  <h3 className="text-base font-semibold text-text">Ce que Selio Global préparera, pays par pays</h3>
                  <p className="mt-1 text-sm text-text-muted">Une application locale par marché, branchée sur le même stock et la même IA.</p>
                  <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                    {PER_COUNTRY.map((x) => (
                      <li key={x.t} className="flex items-start gap-2.5">
                        <Clock className="mt-0.5 size-4 shrink-0 text-text-subtle" aria-hidden />
                        <span className="min-w-0"><span className="block text-sm font-medium text-text">{x.t}</span><span className="block text-sm text-text-muted">{x.d}</span></span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-4 text-xs text-text-muted">Déjà utilisable : le <Link to="/global/tailles" className="font-medium text-accent hover:underline">convertisseur de tailles</Link>.</p>
                </Card>
              ) : null}
            </div>
          </section>
        ))}
      </div>

      <Card className="mt-8 text-sm text-text-muted">
        Tailles, domaines et marques sont des informations générales, données à titre indicatif. Selio est un outil indépendant : il n'est ni affilié à Vinted ni approuvé par Vinted.
      </Card>
    </>
  );
}
