import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "../../hooks/useCurrentUser";

export const Route = createFileRoute("/messages/")({ component: MessagesList });

type Conversation = {
  id: string;
  listingId: string;
  listingTitle: string;
  coverImageUrl: string | null;
  counterpart: { username: string; displayName: string };
  lastMessage: string | null;
  lastMessageAt: string;
};

async function fetchConversations(): Promise<Conversation[]> {
  const res = await fetch("/api/conversations", { credentials: "include" });
  if (!res.ok) throw new Error("Erreur");
  const data = (await res.json()) as { items: Conversation[] };
  return data.items;
}

function MessagesList() {
  const { data: user, isLoading: userLoading } = useCurrentUser();
  const { data, isLoading } = useQuery({ queryKey: ["conversations"], queryFn: fetchConversations, enabled: !!user, refetchInterval: 10_000 });

  if (!userLoading && !user) {
    return (
      <div className="selio-container py-16 text-center">
        <h1 className="text-2xl font-semibold text-[var(--color-selio-primary-dark)]">Messages</h1>
        <Link to="/login" className="selio-btn selio-btn-primary mt-4 inline-flex">Se connecter</Link>
      </div>
    );
  }

  return (
    <div className="selio-container max-w-2xl py-8">
      <h1 className="mb-6 text-2xl font-semibold text-[var(--color-selio-primary-dark)]">Messages</h1>
      {isLoading && <p className="text-[var(--color-selio-text-muted)]">Chargement...</p>}
      {data && data.length === 0 && <p className="text-[var(--color-selio-text-muted)]">Aucune conversation pour le moment.</p>}
      <div className="space-y-2">
        {data?.map((c) => (
          <Link key={c.id} to="/messages/$id" params={{ id: c.id }} className="selio-card flex items-center gap-3 p-3 hover:shadow-sm">
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-[var(--color-selio-surface)]">
              {c.coverImageUrl && <img src={c.coverImageUrl} alt="" className="h-full w-full object-cover" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{c.counterpart.displayName} · {c.listingTitle}</p>
              <p className="truncate text-sm text-[var(--color-selio-text-muted)]">{c.lastMessage ?? "Nouvelle conversation"}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
