import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Bot, CircleDollarSign, History } from "lucide-react";
import { ACTIVITY_CATEGORIES, ACTIVITY_CATEGORY_LABELS, type ActivityCategory, type ActivityEntry, type ActivityQuery } from "@selio/contracts";
import { Button, EmptyState, FilterChip, PageHeader, Select, SkeletonRows } from "@selio/ui";
import { useClient } from "../../lib/data/provider";
import { errorMessage } from "../../lib/errors";
import { ActivityLine, dayLabel } from "../components/activity";

/**
 * Journal d'activité de Selio Manager : ce que Selio, Studio, Selio Bot et l'équipe ont fait, en phrases
 * simples, du plus récent au plus ancien. Filtres dans l'adresse (type, qui, automatique ou manuel, période),
 * pagination « Voir plus ». Les prix d'achat ne sont jamais montrés à un rôle qui ne voit pas les finances
 * (le serveur et la démonstration les retirent).
 */

const PERIODS = [
  { value: "", label: "Toute la période" },
  { value: "1", label: "Aujourd'hui" },
  { value: "7", label: "7 derniers jours" },
  { value: "30", label: "30 derniers jours" },
] as const;

const PAGE_SIZE = 30;

/** Début de la période (minuit local il y a N−1 jours). */
function periodStart(days: string, now = new Date()): string | undefined {
  const n = Number(days);
  if (!n) return undefined;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (n - 1));
  return d.toISOString();
}

export default function Journal() {
  const client = useClient();
  const [params, setParams] = useSearchParams();
  const category = (params.get("type") as ActivityCategory | null) || undefined;
  const actor = params.get("qui") || undefined;
  const mode = (params.get("mode") as "auto" | "manual" | null) || undefined;
  const period = params.get("periode") ?? "";
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    setParams(p, { replace: true });
  };
  const filters: ActivityQuery = { category, actor, mode, from: periodStart(period), limit: PAGE_SIZE };
  const members = useQuery({ queryKey: ["members"], queryFn: () => client.listMembers(), staleTime: 60_000 });
  const feed = useInfiniteQuery({
    queryKey: ["activity", "journal", { category, actor, mode, period }],
    queryFn: ({ pageParam }) => client.listActivity({ ...filters, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const entries = useMemo(() => feed.data?.pages.flatMap((p) => p.entries) ?? [], [feed.data]);
  const groups = useMemo(() => {
    const out: { label: string; entries: ActivityEntry[] }[] = [];
    for (const e of entries) {
      const label = dayLabel(e.at);
      const last = out[out.length - 1];
      if (last?.label === label) last.entries.push(e);
      else out.push({ label, entries: [e] });
    }
    return out;
  }, [entries]);
  const filtered = Boolean(category || actor || mode || period);

  return (
    <>
      <PageHeader
        title="Journal d'activité"
        description="Tout ce que Selio, Studio, Selio Bot et votre équipe ont fait dans Selio Manager, en phrases simples : articles ajoutés, annonces rédigées, photos, prix, réponses, offres négociées, commandes et achats."
      />
      <div className="mb-4 flex flex-col gap-3">
        <div role="radiogroup" aria-label="Automatique ou manuel" className="flex gap-1 overflow-x-auto pb-1 scrollbar-thin">
          <FilterChip active={!mode} onClick={() => set("mode", "")}>Tout</FilterChip>
          <FilterChip active={mode === "auto"} onClick={() => set("mode", "auto")} icon={<Bot />}>Automatique</FilterChip>
          <FilterChip active={mode === "manual"} onClick={() => set("mode", "manual")}>Par l'équipe</FilterChip>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Select aria-label="Type" value={category ?? ""} onChange={(e) => set("type", e.target.value)}>
            <option value="">Tous les types</option>
            {ACTIVITY_CATEGORIES.map((c) => <option key={c} value={c}>{ACTIVITY_CATEGORY_LABELS[c]}</option>)}
          </Select>
          <Select aria-label="Qui" value={actor ?? ""} onChange={(e) => set("qui", e.target.value)}>
            <option value="">Tout le monde</option>
            <option value="selio">Selio</option>
            <option value="studio">Studio</option>
            <option value="bot">Selio Bot</option>
            <option value="members">Toute l'équipe</option>
            {(members.data ?? []).map((m) => <option key={m.userId} value={m.userId}>{m.user.displayName}</option>)}
          </Select>
          <Select aria-label="Période" className="col-span-2 sm:col-span-1" value={period} onChange={(e) => set("periode", e.target.value)}>
            {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </Select>
        </div>
      </div>

      {feed.isPending ? <div className="card p-4"><SkeletonRows rows={6} /></div> : feed.isError ? (
        <EmptyState title="Le journal n'a pas pu être chargé" description={errorMessage(feed.error)} action={<Button variant="secondary" onClick={() => void feed.refetch()}>Réessayer</Button>} />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<History />}
          title={filtered ? "Rien ne correspond à ces filtres" : "Rien pour l'instant"}
          description={filtered ? "Élargissez la période ou retirez un filtre." : "Ajoutez un article, générez une annonce avec Studio ou répondez à un acheteur : chaque action apparaîtra ici."}
          action={filtered ? <Button variant="secondary" onClick={() => setParams(new URLSearchParams(), { replace: true })}>Retirer les filtres</Button> : <Link to="/app/items/new" className="text-sm font-medium text-accent">Ajouter un article</Link>}
        />
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g) => (
            <section key={g.label} aria-label={g.label}>
              <h2 className="mb-2 text-xs font-semibold tracking-wide text-text-subtle uppercase">{g.label}</h2>
              <ol className="card divide-y divide-border overflow-hidden p-0">
                {g.entries.map((e) => <li key={e.id}><ActivityLine entry={e} /></li>)}
              </ol>
            </section>
          ))}
          {feed.hasNextPage ? <Button variant="secondary" className="self-center" loading={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>Voir plus</Button> : <p className="text-center text-xs text-text-muted"><CircleDollarSign className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />Les prix d'achat n'apparaissent qu'aux rôles qui voient les finances.</p>}
        </div>
      )}
    </>
  );
}
