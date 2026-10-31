import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { Check, ChevronsUpDown, LayoutGrid } from "lucide-react";
import { Tag, cn } from "@selio/ui";
import { Logo } from "../../components/Logo";
import { HUB_PATH, SPACES, SPACE_STATE_LABEL, type SpaceArea } from "./spaces";

/** Nom court affiché dans le sélecteur. */
export function areaLabel(area: SpaceArea): string {
  return area === "hub" ? "Espaces" : SPACES.find((s) => s.id === area)!.short;
}

/** Pastille de l'espace courant (teinte d'identité + nom court). */
export function SpacePill({ area, className }: { area: SpaceArea; className?: string }) {
  return (
    <span data-space={area} className={cn("space-pill", className)}>
      <span className="space-dot" aria-hidden />
      {areaLabel(area)}
    </span>
  );
}

/**
 * Sélecteur d'espace, en tête du menu latéral : le logo Selio et, en clair,
 * « Vous êtes dans : … » ; il ouvre la liste des filiales (disponibles, puis
 * en développement) et l'accueil central.
 */
export function SpaceSwitcher({ area }: { area: SpaceArea }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const { pathname } = useLocation();
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      // Le focus revient au sélecteur (il était dans la liste qui disparaît).
      if (ref.current?.contains(document.activeElement)) buttonRef.current?.focus();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const currentName = area === "hub" ? "accueil des espaces" : SPACES.find((s) => s.id === area)!.name;

  return (
    <div
      ref={ref}
      className="relative min-w-0 flex-1"
      // Au clavier, quitter la liste (Tab après le dernier lien) la referme.
      onBlur={(e) => {
        if (open && e.relatedTarget && !ref.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Espace actuel : ${currentName}. Changer d'espace`}
        className="flex h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors hover:bg-surface-muted"
      >
        <Logo height={18} />
        <span data-space={area} className="min-w-0 flex-1 border-l border-border pl-2.5">
          <span className="block text-[10px] leading-none font-medium tracking-wider text-text-muted uppercase">Vous êtes dans</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-sm leading-tight font-bold text-text"><span className="space-dot" aria-hidden /><span className="truncate">{area === "hub" ? "Vos espaces" : SPACES.find((s) => s.id === area)!.name}</span></span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-text-muted" aria-hidden />
      </button>
      {open ? (
        <nav id={panelId} aria-label="Changer d'espace" className="absolute top-full left-0 z-50 mt-1 max-h-[calc(100dvh-5rem)] w-[20rem] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-lg border border-border bg-surface p-1.5 shadow-md">
          <p className="px-2.5 pt-1.5 pb-2 text-xs text-text-muted"><span className="font-semibold text-text">Selio et ses filiales.</span> Un seul compte, les mêmes données : choisissez où travailler.</p>
          {([["Disponibles", SPACES.filter((s) => s.state !== "development")], ["En développement", SPACES.filter((s) => s.state === "development")]] as const).map(([title, list]) => (
            <div key={title} className="border-t border-border pt-1.5 pb-1">
              <p className="px-2.5 pb-1 text-[10px] font-bold tracking-wider text-text-muted uppercase">{title}</p>
              <ul className="flex flex-col gap-0.5">
                {list.map((s) => {
                  const current = s.id === area;
                  return (
                    <li key={s.id}>
                      <Link to={s.home} data-space={s.id} aria-current={current ? "true" : undefined} className={cn("flex items-start gap-3 rounded-md px-2.5 py-2 transition-colors hover:bg-surface-muted", current && "bg-surface-muted")}>
                        <span className="space-tile size-8" aria-hidden>{s.icon}</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm font-bold text-text">
                            {s.name}
                            {s.state !== "available" ? <Tag>{SPACE_STATE_LABEL[s.state]}</Tag> : null}
                            {current ? <Check className="ml-auto size-3.5 text-accent" aria-label="(espace actuel)" /> : null}
                          </span>
                          <span className="block text-xs text-text-muted">{s.tagline}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <div className="mt-1 border-t border-border pt-1">
            <Link to={HUB_PATH} aria-current={area === "hub" ? "true" : undefined} className="flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium text-text transition-colors hover:bg-surface-muted">
              <LayoutGrid className="size-4 text-text-muted" aria-hidden />
              Vos espaces — accueil central
            </Link>
          </div>
        </nav>
      ) : null}
    </div>
  );
}
