import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Archive, Bot, Check, ChevronLeft, Package, Search, Send, Trash2, Zap } from "lucide-react";
import type { Message } from "@selio/contracts";
import type { NegotiationResult } from "@selio/domain";
import { Alert, Avatar, Button, Dialog, EmptyState, IconButton, Input, Money, PageHeader, Segmented, Tag, Textarea, cn, formatPercent, formatRelative, formatTime } from "@selio/ui";
import { useClient, useData, useRequiredSession } from "../../lib/data/provider";
import { ConnectorStatusBadge, ItemThumb, MessageStatusBadge, QueryBoundary } from "../components/common";
import { useAppMutation } from "../components/hooks";

export default function Messages() {
  const { id } = useParams();
  const navigate = useNavigate();
  const client = useClient();
  const { mode } = useData();
  const [params, setParams] = useSearchParams();
  const filter = (params.get("f") as "all" | "unread" | "archived") ?? "all";
  const q = params.get("q") ?? "";
  const list = useQuery({ queryKey: ["conversations", { filter, q }], queryFn: () => client.listConversations({ q: q || undefined, unread: filter === "unread" || undefined, status: filter === "archived" ? "archived" : "open", pageSize: 100 }) });
  const simulate = useAppMutation(() => client.simulateIncomingMessage(null), { invalidate: ["conversations", "nav-counts", "overview"], success: "Message entrant simulé", onSuccess: (c) => navigate(`/app/messages/${c.id}`) });
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };

  return (
    <>
      <PageHeader title="Messagerie" description="Chaque conversation est reliée au client et à l'article. L'IA propose, vous validez : rien ne part sans confirmation." actions={mode === "demo" ? <Button variant="secondary" icon={<Zap />} onClick={() => simulate.mutate()} loading={simulate.isPending}>Simuler un message entrant</Button> : undefined} className={cn(id && "hidden md:flex")} />
      <div className="grid gap-4 md:grid-cols-[320px_minmax(0,1fr)] lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className={cn("card flex min-h-[60dvh] flex-col p-0 md:min-h-[70dvh]", id && "hidden md:flex")} aria-label="Liste des conversations">
          <div className="flex flex-col gap-2 border-b border-border p-3">
            <Input placeholder="Rechercher…" prefix={<Search />} value={q} onChange={(e) => set("q", e.target.value)} aria-label="Rechercher une conversation" />
            <Segmented ariaLabel="Filtre" size="sm" value={filter} onChange={(v) => set("f", v === "all" ? "" : v)} items={[{ value: "all", label: "Ouvertes" }, { value: "unread", label: "Non lues" }, { value: "archived", label: "Archivées" }]} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <QueryBoundary query={list} empty={(d) => d.items.length === 0 ? <p className="p-4 text-sm text-text-muted">Aucune conversation.</p> : null}>
              {(d) => (
                <ul>
                  {d.items.map((c) => (
                    <li key={c.id}>
                      <Link to={`/app/messages/${c.id}`} className={cn("flex gap-3 border-b border-border px-3 py-3 hover:bg-surface-muted", c.id === id && "bg-accent-soft")} aria-current={c.id === id ? "page" : undefined}>
                        <Avatar name={c.customer.displayName} size={36} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className={cn("truncate text-sm", c.unreadCount > 0 ? "font-semibold text-text" : "font-medium text-text")}>{c.customer.displayName}</span>
                            <span className="shrink-0 text-xs text-text-muted">{c.lastMessageAt ? formatRelative(c.lastMessageAt) : ""}</span>
                          </span>
                          <span className="block truncate text-xs text-text-muted">{c.item?.title ?? "Sans article"}</span>
                          <span className={cn("block truncate text-sm", c.unreadCount > 0 ? "text-text" : "text-text-muted")}>{c.lastMessagePreview}</span>
                        </span>
                        {c.unreadCount > 0 ? <span className="num self-center rounded-sm bg-accent-soft px-1.5 text-xs font-medium text-accent">{c.unreadCount}</span> : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </QueryBoundary>
          </div>
        </aside>
        <section className={cn("min-w-0", !id && "hidden md:block")} aria-label="Conversation">
          {id ? <ConversationView id={id} /> : <EmptyState className="min-h-[70dvh]" title="Sélectionnez une conversation" description="Les conversations non lues sont marquées en orange." />}
        </section>
      </div>
    </>
  );
}

function ConversationView({ id }: { id: string }) {
  const client = useClient();
  const session = useRequiredSession();
  const { mode } = useData();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["conversation", id], queryFn: () => client.getConversation(id) });
  const [draftText, setDraftText] = useState("");
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<{ source: string; model: string; validated: boolean; rejectionReason: string | null; evaluation: NegotiationResult | null } | null>(null);
  const [orderDialog, setOrderDialog] = useState<{ priceCents: number } | null>(null);
  const [simText, setSimText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const invalidate = ["conversation", "conversations", "nav-counts", "overview"];

  useEffect(() => {
    if (q.data?.conversation.unreadCount) void client.markConversationRead(id);
  }, [q.data?.conversation.unreadCount, id, client]);
  useEffect(() => {
    const draft = q.data?.messages.filter((m) => m.status === "draft" || m.status === "failed").pop();
    if (draft && draft.id !== activeDraftId) { setActiveDraftId(draft.id); setDraftText(draft.body); }
    if (!draft) { setActiveDraftId(null); }
  }, [q.data?.messages, activeDraftId]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [q.data?.messages.length]);

  const suggest = useAppMutation(() => client.suggestReply(id), { invalidate, onSuccess: (r) => { setActiveDraftId(r.draft.id); setDraftText(r.draft.body); setSuggestion({ source: r.source, model: r.model, validated: r.validated, rejectionReason: r.rejectionReason, evaluation: r.evaluation }); } });
  const saveDraft = useAppMutation(async () => (activeDraftId ? client.updateDraft(activeDraftId, draftText) : client.createDraft({ conversationId: id, body: draftText })), { invalidate, success: "Brouillon enregistré", onSuccess: (m) => setActiveDraftId(m.id) });
  const send = useAppMutation(async () => {
    const m = activeDraftId ? await client.updateDraft(activeDraftId, draftText) : await client.createDraft({ conversationId: id, body: draftText });
    return client.sendMessage(m.id);
  }, { invalidate, success: (m) => (m.status === "sent" ? (m.simulated ? "Envoi simulé confirmé par le connecteur de démonstration" : "Message envoyé") : null), onSuccess: (m) => { if (m.status === "sent") { setDraftText(""); setActiveDraftId(null); setSuggestion(null); } } });
  const delDraft = useAppMutation(() => (activeDraftId ? client.deleteDraft(activeDraftId) : Promise.resolve()), { invalidate, onSuccess: () => { setDraftText(""); setActiveDraftId(null); setSuggestion(null); } });
  const archive = useAppMutation((status: "open" | "archived") => client.setConversationStatus(id, status), { invalidate, success: "Conversation mise à jour" });
  const createOrder = useAppMutation((priceCents: number) => client.createOrder({ itemId: q.data!.item!.id, customerId: q.data!.customer.id, conversationId: id, salePriceCents: priceCents, status: "pending" }), { invalidate: [...invalidate, "orders", "items"], success: (r) => (r.created ? "Commande créée" : "Commande déjà existante : aucun doublon créé"), onSuccess: (r) => { setOrderDialog(null); navigate(`/app/orders/${r.order.id}`); } });
  const simulate = useAppMutation(() => client.simulateIncomingMessage(id, simText || undefined), { invalidate, success: "Message entrant simulé", onSuccess: () => setSimText("") });

  const canSend = session.role !== "viewer";
  return (
    <QueryBoundary query={q} skeleton="spinner">
      {(d) => {
        const { conversation, messages, customer, item, connection, lastOffer } = d;
        const sendCap = connection?.capabilities.find((c) => c.capability === "send_message");
        const sendBlocked = !connection || sendCap?.state === "unavailable" || connection.status === "disconnected" || connection.status === "expired";
        const failed = messages.find((m) => m.id === activeDraftId && m.status === "failed");
        const rules = session.org.settings.margin;
        return (
          <div className="card flex min-h-[70dvh] flex-col p-0">
            <header className="flex items-center gap-3 border-b border-border px-4 py-3">
              <IconButton label="Retour à la liste" className="md:hidden" onClick={() => navigate("/app/messages")}><ChevronLeft /></IconButton>
              <Avatar name={customer.displayName} size={36} />
              <div className="min-w-0 flex-1">
                <Link to={`/app/customers/${customer.id}`} className="block truncate text-sm font-semibold hover:text-accent">{customer.displayName}{customer.handle ? <span className="font-normal text-text-muted"> · @{customer.handle}</span> : null}</Link>
                {item ? <Link to={`/app/items/${item.id}`} className="flex items-center gap-1.5 truncate text-xs text-text-muted hover:text-accent"><Package className="size-3.5" aria-hidden />{item.title}{item.listedPriceCents !== null ? <> · <Money cents={item.listedPriceCents} /></> : null}</Link> : <span className="text-xs text-text-muted">Sans article lié</span>}
              </div>
              {connection ? <span className="hidden sm:inline-flex"><ConnectorStatusBadge status={connection.status} /></span> : null}
              <IconButton label={conversation.status === "archived" ? "Rouvrir" : "Archiver"} onClick={() => archive.mutate(conversation.status === "archived" ? "open" : "archived")}><Archive /></IconButton>
            </header>
            {item ? (
              <div className="grid gap-2 border-b border-border bg-surface-muted/60 px-4 py-2 text-xs sm:grid-cols-3">
                <span className="text-text-muted">Plancher : <Money cents={item.floorPriceCents ?? 0} className="text-text" /></span>
                <span className="text-text-muted">Coût d'acquisition : <Money cents={item.purchasePriceCents + item.purchaseFeesCents} className="text-text" /></span>
                <span className="text-text-muted">Marge min. : {formatPercent(rules.minMarginRate)} · remise max. {formatPercent(rules.maxDiscountRate)}</span>
              </div>
            ) : null}
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
              {messages.filter((m) => m.status !== "draft" && !(m.status === "failed" && m.id === activeDraftId)).map((m) => <Bubble key={m.id} m={m} />)}
              {lastOffer && item ? <OfferPanel offerCents={lastOffer.offerCents} evaluation={lastOffer.evaluation} onCreateOrder={canSend ? (price) => setOrderDialog({ priceCents: price }) : undefined} /> : null}
              <div ref={endRef} />
            </div>
            {canSend ? (
              <footer className="border-t border-border p-3">
                {suggestion ? (
                  <div className="ai-suggestion mb-2 p-3 text-xs">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-accent"><Bot className="size-3.5" aria-hidden /> {suggestion.source === "ai" ? `Suggestion IA (${suggestion.model})` : "Gabarit déterministe (IA indisponible ou sortie rejetée)"} {mode === "demo" ? <Tag>Simulé</Tag> : null}</p>
                    {suggestion.rejectionReason ? <p className="mt-1 text-text-muted">{suggestion.rejectionReason}</p> : <p className="mt-1 text-text-muted">Validée par le schéma et par vos règles de marge. Relisez avant d'envoyer.</p>}
                  </div>
                ) : null}
                {failed ? <Alert tone="danger" title="Échec de l'envoi" className="mb-2">{failed.error}</Alert> : null}
                {sendBlocked ? <Alert tone="warning" className="mb-2" title="Envoi impossible depuis Selio">{!connection ? "Aucune connexion associée à cette conversation." : sendCap?.state === "unavailable" ? `Le connecteur « ${connection.label} » ne permet pas l'envoi automatique : préparez le brouillon ici, puis validez-le dans Vinted via l'extension.` : `La connexion « ${connection.label} » est ${connection.status === "expired" ? "expirée" : "déconnectée"}.`}</Alert> : null}
                <label className="sr-only" htmlFor="draft">Brouillon de réponse</label>
                <Textarea id="draft" rows={3} placeholder="Écrire une réponse ou demander une suggestion…" value={draftText} onChange={(e) => setDraftText(e.target.value)} maxLength={4000} />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button variant="secondary" size="sm" icon={<Bot />} onClick={() => suggest.mutate()} loading={suggest.isPending} disabled={!session.org.settings.ai.enabled}>Suggérer une réponse</Button>
                  <Button variant="ghost" size="sm" onClick={() => saveDraft.mutate()} disabled={!draftText.trim()} loading={saveDraft.isPending}>Enregistrer le brouillon</Button>
                  {activeDraftId ? <IconButton label="Supprimer le brouillon" size="sm" onClick={() => delDraft.mutate()}><Trash2 /></IconButton> : null}
                  <span className="flex-1" />
                  {activeDraftId ? <MessageStatusBadge status={failed ? "failed" : "draft"} /> : null}
                  <Button size="sm" icon={<Send />} onClick={() => send.mutate()} disabled={!draftText.trim() || sendBlocked} loading={send.isPending}>{mode === "demo" ? "Envoyer (simulé)" : "Envoyer"}</Button>
                </div>
                {mode === "demo" ? (
                  <details className="mt-3 text-xs text-text-muted">
                    <summary className="cursor-pointer">Simuler un message de l'acheteur (démonstration)</summary>
                    <div className="mt-2 flex gap-2">
                      <Input value={simText} onChange={(e) => setSimText(e.target.value)} placeholder="Ex. : Je vous propose 28 €" aria-label="Message simulé" />
                      <Button size="sm" variant="secondary" onClick={() => simulate.mutate()} loading={simulate.isPending}>Recevoir</Button>
                    </div>
                  </details>
                ) : null}
              </footer>
            ) : <p className="border-t border-border p-3 text-xs text-text-muted">Lecture seule : votre rôle ne permet pas d'écrire.</p>}
            <Dialog open={orderDialog !== null} onClose={() => setOrderDialog(null)} title="Créer la commande" description="Une commande n'est jamais créée automatiquement à l'envoi d'un message : confirmez la vente ici." size="sm" footer={<><Button variant="ghost" onClick={() => setOrderDialog(null)}>Annuler</Button><Button onClick={() => orderDialog && createOrder.mutate(orderDialog.priceCents)} loading={createOrder.isPending}>Créer la commande</Button></>}>
              {orderDialog && item ? (
                <div className="text-sm">
                  <p className="flex items-center gap-3"><ItemThumb photos={item.photos} title={item.title} /><span>{item.title}</span></p>
                  <p className="mt-3 flex justify-between"><span className="text-text-muted">Prix de vente</span><Money cents={orderDialog.priceCents} /></p>
                  <p className="mt-1 flex justify-between"><span className="text-text-muted">Client</span><span>{customer.displayName}</span></p>
                  <p className="mt-3 text-xs text-text-muted">Si une commande existe déjà pour cet article et ce client aujourd'hui, elle sera réutilisée (aucun doublon).</p>
                </div>
              ) : null}
            </Dialog>
          </div>
        );
      }}
    </QueryBoundary>
  );
}

function Bubble({ m }: { m: Message }) {
  const inbound = m.direction === "inbound";
  return (
    <div className={cn("flex max-w-[85%] flex-col gap-1", inbound ? "self-start" : "self-end items-end")}>
      <div className={cn("rounded-lg px-3 py-2 text-sm whitespace-pre-line", inbound ? "bg-surface-muted text-text" : m.source === "automation" || m.source === "ai" ? "bg-primary text-primary-on" : "bg-primary text-primary-on")}>{m.body}</div>
      <div className="flex items-center gap-2 text-[11px] text-text-muted">
        <span>{formatTime(m.createdAt)}</span>
        {m.offerCents !== null && inbound ? <span className="num">Offre détectée : <Money cents={m.offerCents} /></span> : null}
        {!inbound ? <MessageStatusBadge status={m.status} /> : null}
        {m.simulated && !inbound ? <Tag>Simulé</Tag> : null}
        {m.source === "automation" ? <Tag>Automatisation</Tag> : m.source === "ai" ? <Tag>IA</Tag> : null}
        {m.status === "failed" && m.error ? <span className="text-danger">{m.error}</span> : null}
      </div>
    </div>
  );
}

function OfferPanel({ offerCents, evaluation, onCreateOrder }: { offerCents: number; evaluation: NegotiationResult; onCreateOrder?: (price: number) => void }) {
  const label: Record<NegotiationResult["decision"], { title: string; tone: string }> = {
    accept: { title: "Offre acceptable", tone: "text-success" },
    counter: { title: "Contre-proposition recommandée", tone: "text-accent" },
    decline: { title: "Offre à refuser", tone: "text-danger" },
    escalate: { title: "À traiter manuellement", tone: "text-warning" },
    hold: { title: "Réponse différée (hors horaires)", tone: "text-text-muted" },
  };
  const l = label[evaluation.decision];
  return (
    <div className="card self-stretch p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={cn("font-medium", l.tone)}>{l.title} · offre <Money cents={offerCents} /></p>
        <span className="num text-xs text-text-muted">Marge à ce prix : <Money cents={evaluation.marginAtOfferCents} signed /> ({formatPercent(evaluation.marginRateAtOffer)})</span>
      </div>
      <ul className="mt-2 flex flex-col gap-1 text-xs text-text-muted">
        {evaluation.reasons.map((r, i) => <li key={i} className="flex gap-1.5"><Check className="mt-0.5 size-3 shrink-0" aria-hidden />{r}</li>)}
      </ul>
      {evaluation.decision === "counter" && evaluation.counterCents !== null ? <p className="mt-2 text-xs">Contre-proposition calculée : <Money cents={evaluation.counterCents} className="font-medium" /></p> : null}
      {onCreateOrder && (evaluation.decision === "accept" || evaluation.decision === "counter") ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {evaluation.decision === "accept" ? <Button size="sm" variant="secondary" onClick={() => onCreateOrder(offerCents)}>Créer la commande à <Money cents={offerCents} /></Button> : null}
          {evaluation.counterCents !== null ? <Button size="sm" variant="secondary" onClick={() => onCreateOrder(evaluation.counterCents!)}>Créer la commande à <Money cents={evaluation.counterCents} /></Button> : null}
        </div>
      ) : null}
    </div>
  );
}
