import { Link } from "react-router";
import { ArrowRight, Check, Clock } from "lucide-react";
import { SPACES, type SpaceDef } from "../app/spaces/spaces";

/**
 * Selio et ses filiales sur la vitrine (même source que l'application :
 * app/spaces/spaces.tsx). État honnête, formulé pour la vitrine : Studio
 * reste « en démonstration » (IA simulée hors modèle branché).
 */
const SHOWCASE_STATE: Record<SpaceDef["id"], { label: string; value: "available" | "demo" | "experimental" | "planned" }> = {
  selio: { label: "Disponible", value: "available" },
  studio: { label: "En démonstration", value: "demo" },
  agents: { label: "Aperçu dans la démo", value: "experimental" },
  track: { label: "En développement", value: "planned" },
  cloud: { label: "En développement", value: "planned" },
  generateur: { label: "En développement", value: "planned" },
};

export function SpaceStateBadge({ id }: { id: SpaceDef["id"] }) {
  const s = SHOWCASE_STATE[id];
  return <span className="mk-badge" data-value={s.value}>{s.label}</span>;
}

/** Carte d'un espace : ce qu'il fait, son état, et le lien pour l'ouvrir dans la démo. */
export function SpaceShowcaseCard({ space, compact = false }: { space: SpaceDef; compact?: boolean }) {
  const ready = space.state === "available";
  return (
    <article className="card mk-card flex flex-col p-5 md:p-6" data-reveal="" aria-labelledby={`vitrine-espace-${space.id}`}>
      <div className="flex items-start justify-between gap-3">
        <span className="mk-icon" data-tone={space.id === "studio" ? "gold" : undefined} aria-hidden>{space.icon}</span>
        <SpaceStateBadge id={space.id} />
      </div>
      <h3 id={`vitrine-espace-${space.id}`} className="mt-4 text-md font-bold text-text">{space.name}</h3>
      <p className="mt-0.5 text-sm font-medium text-text-muted">{space.tagline}</p>
      <p className="mt-2 text-sm text-text-muted">{space.description}</p>
      {compact ? null : (
        <ul className="mt-4 flex flex-col gap-2">
          {space.does.map((d) => (
            <li key={d} className={ready ? "flex items-start gap-2 text-sm text-text" : "flex items-start gap-2 text-sm text-text-muted"}>
              {ready ? <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden /> : <Clock className="mt-0.5 size-4 shrink-0 text-text-subtle" aria-hidden />}
              {d}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-auto pt-5">
        <Link to={`/demo?vers=${space.home}`} className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
          {space.state === "development" ? "Voir ce qui arrive, dans la démo" : `Ouvrir ${space.name} dans la démo`} <ArrowRight className="size-4" aria-hidden />
        </Link>
      </p>
    </article>
  );
}

/**
 * Constellation des filiales (décor, écran large) : Selio au centre, les
 * filiales reliées ; trait plein pour ce qui fonctionne, pointillé pour ce
 * qui est en aperçu ou en développement.
 */
export function SpacesConstellation() {
  const pos: Record<SpaceDef["id"], [number, number]> = { selio: [320, 130], generateur: [320, 30], studio: [110, 70], agents: [530, 70], track: [130, 196], cloud: [510, 196] };
  return (
    <svg viewBox="0 0 640 260" className="mk-spaces-map" role="img" aria-label="Selio au centre, relié à Selio Studio, Selio Agents, Selio Track, Selio Cloud et au générateur de compte Vinted">
      {SPACES.filter((s) => s.id !== "selio").map((s) => (
        <line key={s.id} x1={pos.selio[0]} y1={pos.selio[1]} x2={pos[s.id][0]} y2={pos[s.id][1]} className="mk-spaces-link" data-planned={s.state === "available" ? undefined : ""} />
      ))}
      {SPACES.map((s) => {
        const [x, y] = pos[s.id];
        const main = s.id === "selio";
        return (
          <g key={s.id}>
            <circle cx={x} cy={y} r={main ? 26 : 16} className="mk-spaces-halo" data-tone={s.id === "studio" ? "gold" : undefined} />
            <circle cx={x} cy={y} r={main ? 5.5 : 3.6} className="mk-sky-star" data-tone={s.id === "studio" ? "gold" : undefined} />
            <text x={x} y={y + (main ? 46 : 34)} textAnchor="middle" className="mk-spaces-label">{s.name}</text>
            <text x={x} y={y + (main ? 64 : 51)} textAnchor="middle" className="mk-spaces-sub">{SHOWCASE_STATE[s.id].label}</text>
          </g>
        );
      })}
    </svg>
  );
}

export { SPACES };
