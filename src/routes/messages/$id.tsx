import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "../../hooks/useCurrentUser";

export const Route = createFileRoute("/messages/$id")({ component: ConversationThread });

type Message = { id: string; senderId: string; body: string; createdAt: string; mine: boolean };
type ThreadData = { listing: { id: string; title: string } | null; messages: Message[] };

async function fetchThread(id: string): Promise<ThreadData> {
  const res = await fetch(`/api/conversations/${id}`, { credentials: "include" });
  if (!res.ok) throw new Error("Erreur");
  return res.json();
}

function ConversationThread() {
  const { id } = Route.useParams();
  const { data: user } = useCurrentUser();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery({ queryKey: ["conversation", id], queryFn: () => fetchThread(id), enabled: !!user, refetchInterval: 5_000 });

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [data?.messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setSending(true);
    try {
      await fetch(`/api/conversations/${id}`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ body }) });
      setBody("");
      queryClient.invalidateQueries({ queryKey: ["conversation", id] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="selio-container flex max-w-2xl flex-col py-8">
      <h1 className="mb-4 text-lg font-semibold text-[var(--color-selio-primary-dark)]">{data?.listing?.title ?? "Conversation"}</h1>
      <div className="selio-card flex h-[55vh] flex-col gap-2 overflow-y-auto p-4">
        {data?.messages.map((m) => (
          <div key={m.id} className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${m.mine ? "self-end bg-[var(--color-selio-primary)] text-white" : "self-start bg-[var(--color-selio-surface)] text-[var(--color-selio-text)]"}`}>
            {m.body}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={send} className="mt-3 flex gap-2">
        <input className="selio-input" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Votre message..." />
        <button type="submit" className="selio-btn selio-btn-primary shrink-0" disabled={sending}>Envoyer</button>
      </form>
    </div>
  );
}
