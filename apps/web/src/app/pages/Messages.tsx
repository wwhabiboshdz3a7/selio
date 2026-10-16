import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Archive, Bot, Check, ChevronLeft, MessagesSquare, Package, Search, Send, ShieldCheck, Sparkles, Trash2, X, Zap } from "lucide-react";
import type { Message } from "@selio/contracts";
import type { NegotiationResult } from "@selio/domain";
import { Alert, Avatar, Button, Dialog, IconButton, Input, Money, PageHeader, Segmented, Tag, Textarea, cn, formatDate, formatPercent, formatRelative, formatTime } from "@selio/ui";
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
      <PageHeader title="Messagerie" description="Toutes vos conversations Vinted au même endroit, reliées à l'acheteur et à l'article. L'IA propose une réponse, vous validez : rien ne part sans votre clic." actions={mode === "demo" ? <Button variant="secondary" icon={<Zap />} onClick={() => simulate.mutate()} loading={simulate.isPending}>Simuler un message entrant</Button> : undefined} className={cn(id && "hidden md:flex")} />
      <div className="card grid overflow-hidden p-0 md:h-[calc(100dvh-210px)] md:min-h-[580px] md:grid-cols-[320px_minmax(0,1fr)] lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className={cn("flex min-h-[60dvh] flex-col border-border md:min-h-0 md:border-r", id && "hidden md:flex")} aria-label="Liste des conversations">
          <div className="flex flex-col gap-2 border-b border-border p-3">
            <Input placeholder="Rechercher un acheteur, un article…" prefix={<Search />} value={q} onChange={(e) => set("q", e.target.value)} aria-label="Rechercher une conversation" />
            <Segmented ariaLabel="Filtre" size="sm" value={filter} onChange={(v) => set("f", v === "all" ? "" : v)} items={[{ value: "all", label: "Ouvertes" }, { value: "unread", label: "Non lues" }, { value: "archived", label: "Archivées" }]} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
            <QueryBoundary query={list} empty={(d) => d.items.length === 0 ? <p className="p-4 text-sm text-text-muted">Aucune conversation.</p> : null}>
              {(d) => (
                <ul>
                  {d.items.map((c) => (
                    <li key={c.id}>
                      <Link to={`/app/messages/${c.id}`} className={cn("relative flex gap-3 border-b border-border px-3 py-3 transition-colors", c.id === id ? "bg-accent-soft" : "hover:bg-surface-muted")} aria-current={c.id === id ? "page" : undefined}>
                        <span className="relative shrink-0">
                          <Avatar name={c.customer.displayName} size={40} />
                          {c.item?.photos[0] ? <img src={c.item.photos[0].url} alt="" className="absolute -right-1.5 -bottom-1.5 size-6 rounded-md border-2 border-surface object-cover" /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className={cn("truncate text-sm", c.unreadCount > 0 ? "font-semibold text-text" : "font-medium text-text")}>{c.customer.displayName}</span>
                            <span className={cn("shrink-0 text-xs", c.unreadCount > 0 ? "font-medium text-accent" : "text-text-muted")}>{c.lastMessageAt ? formatRelative(c.lastMessageAt) : ""}</span>
                          </span>
                          <span className="block truncate text-xs text-text-muted">{c.item?.title ?? "Sans article"}{c.item?.listedPriceCents ? ` · ${(c.item.listedPriceCents / 100).toFixed(2).replace(".", ",")} €` : ""}</span>
                          <span className={cn("mt-0.5 flex items-center gap-1.5 text-sm", c.unreadCount > 0 ? "text-text" : "text-text-muted")}><span className="truncate">{c.lastMessagePreview}</span>{c.unreadCount > 0 ? <span className="num ml-auto inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-on">{c.unreadCount}</span> : null}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </QueryBoundary>
          </div>
        </aside>
        <section className={cn("min-h-0 min-w-0", !id && "hidden md:block")} aria-label="Conversation">
          {id ? <ConversationView id={id} /> : <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"><MessagesSquare className="size-10 text-text-subtle" aria-hidden /><h2 className="text-md font-semibold">Sélectionnez une conversation</h2><p className="max-w-sm text-sm text-text-muted">Les conversations non lues ont une pastille. Les offres des acheteurs sont évaluées avec vos règles de marge.</p></div>}
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
        const visible = messages.filter((m) => m.status !== "draft" && !(m.status === "failed" && m.id === activeDraftId));
        const firstName = customer.displayName.split(" ")[0] ?? "";
        const insert = (text: string) => setDraftText((t) => (t.trim() ? `${t.trim()}\n${text}` : text));
        const fmt = (c: number) => (c / 100).toFixed(2).replace(".", ",") + " €";
        const quick = [
          { label: "Toujours disponible", text: `Bonjour ${firstName}, oui l'article est toujours disponible !` },
          { label: "Envoi sous 48 h", text: "Je l'expédie sous 48 h après l'achat, colis soigneusement protégé." },
          { label: "Mesures", text: "Je vous envoie les mesures à plat dans un instant." },
          { label: "Lot possible", text: "Je fais une remise si vous prenez plusieurs articles de mon dressing." },
          { label: "Merci !", text: `Merci beaucoup ${firstName}, bonne journée !` },
        ];
        return (
          <div className="flex h-full min-h-[75dvh] md:min-h-0">
            <div className="flex min-w-0 flex-1 flex-col">
              <header className="flex items-center gap-3 border-b border-border px-4 py-3">
                <IconButton label="Retour à la liste" className="md:hidden" onClick={() => navigate("/app/messages")}><ChevronLeft /></IconButton>
                <Avatar name={customer.displayName} size={36} />
                <div className="min-w-0 flex-1">
                  <Link to={`/app/customers/${customer.id}`} className="block truncate text-sm font-semibold hover:text-accent">{customer.displayName}{customer.handle ? <span className="font-normal text-text-muted"> · @{customer.handle}</span> : null}</Link>
                  <span className="block truncate text-xs text-text-muted">{customer.city ? `${customer.city} · ` : ""}{connection ? connection.label : "Sans connexion"}</span>
                </div>
                {connection ? <span className="hidden sm:inline-flex"><ConnectorStatusBadge status={connection.status} /></span> : null}
                <IconButton label={conversation.status === "archived" ? "Rouvrir" : "Archiver"} onClick={() => archive.mutate(conversation.status === "archived" ? "open" : "archived")}><Archive /></IconButton>
              </header>
              {item ? (
                <Link to={`/app/items/${item.id}`} className="flex items-center gap-3 border-b border-border bg-surface-muted/50 px-4 py-2.5 hover:bg-surface-muted xl:hidden">
                  <ItemThumb photos={item.photos} title={item.title} size={44} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-text">{item.title}</span><span className="num block text-xs text-text-muted">{item.listedPriceCents !== null ? <Money cents={item.listedPriceCents} /> : "—"} · plancher <Money cents={item.floorPriceCents ?? 0} /></span></span>
                  <Package className="size-4 text-text-muted" aria-hidden />
                </Link>
              ) : null}
              <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto bg-bg/50 px-4 py-4 scrollbar-thin">
                {visible.map((m, i) => {
                  const day = new Date(m.createdAt).toDateString();
                  const prevDay = i > 0 ? new Date(visible[i - 1]!.createdAt).toDateString() : null;
                  const label = day === new Date().toDateString() ? "Aujourd'hui" : day === new Date(Date.now() - 86_400_000).toDateString() ? "Hier" : formatDate(m.createdAt, "long");
                  return (
                    <div key={m.id} className="flex flex-col">
                      {day !== prevDay ? <p className="my-2 self-center rounded-full bg-surface-muted px-3 py-0.5 text-[11px] font-medium text-text-muted">{label}</p> : null}
                      <Bubble m={m} name={customer.displayName} />
                    </div>
                  );
                })}
                {lastOffer && item ? <OfferPanel buyer={firstName} listedCents={item.listedPriceCents} offerCents={lastOffer.offerCents} evaluation={lastOffer.evaluation} onCreateOrder={canSend ? (price) => setOrderDialog({ priceCents: price }) : undefined} onCounter={canSend && lastOffer.evaluation.counterCents !== null ? () => setDraftText(`Bonjour ${firstName}, merci pour votre offre. Je peux vous proposer ${fmt(lastOffer.evaluation.counterCents!)}, c'est mon meilleur prix. Si cela vous convient, faites l'offre à ce montant et je l'accepte.`) : undefined} onDecline={canSend ? () => setDraftText(`Bonjour ${firstName}, merci pour votre intérêt. Je ne peux malheureusement pas descendre à ${fmt(lastOffer.offerCents)} : l'article reste disponible au prix affiché.`) : undefined} /> : null}
                <div ref={endRef} />
              </div>
              {canSend ? (
                <footer className="border-t border-border bg-surface p-3">
                  {suggestion ? (
                    <div className="ai-suggestion mb-2 p-3 text-xs">
                      <p className="flex flex-wrap items-center gap-2 font-medium text-accent"><Bot className="size-3.5" aria-hidden /> {suggestion.source === "ai" ? `Suggestion IA (${suggestion.model})` : "Gabarit déterministe (IA indisponible ou sortie rejetée)"} {mode === "demo" ? <Tag>Simulé</Tag> : null}</p>
                      {suggestion.rejectionReason ? <p className="mt-1 text-text-muted">{suggestion.rejectionReason}</p> : <p className="mt-1 text-text-muted">Validée par le schéma et par vos règles de marge. Relisez avant d'envoyer.</p>}
                    </div>
                  ) : null}
                  {failed ? <Alert tone="danger" title="Échec de l'envoi" className="mb-2">{failed.error}</Alert> : null}
                  {sendBlocked ? <Alert tone="warning" className="mb-2" title="Envoi impossible depuis Selio">{!connection ? "Aucune connexion associée à cette conversation." : sendCap?.state === "unavailable" ? `Le connecteur « ${connection.label} » ne permet pas l'envoi automatique : préparez le brouillon ici, puis validez-le dans Vinted via l'extension.` : `La connexion « ${connection.label} » est ${connection.status === "expired" ? "expirée" : "déconnectée"}.`}</Alert> : null}
                  <div className="mb-2 flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-thin" aria-label="Réponses rapides">
                    <button type="button" onClick={() => suggest.mutate(undefined)} disabled={!session.org.settings.ai.enabled || suggest.isPending} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-accent-soft px-3 text-xs font-semibold text-accent disabled:opacity-50"><Sparkles className="size-3.5" aria-hidden />{suggest.isPending ? "Rédaction…" : "Réponse IA"}</button>
                    {quick.map((qr) => <button key={qr.label} type="button" onClick={() => insert(qr.text)} className="h-7 shrink-0 rounded-full border border-border bg-surface px-3 text-xs font-medium text-text-muted hover:text-text">{qr.label}</button>)}
                  </div>
                  <label className="sr-only" htmlFor="draft">Brouillon de réponse</label>
                  <div className="flex items-end gap-2">
                    <Textarea id="draft" rows={2} placeholder={`Écrire à ${firstName}…`} value={draftText} onChange={(e) => setDraftText(e.target.value)} maxLength={4000} className="min-h-[52px] rounded-2xl" onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && draftText.trim() && !sendBlocked) send.mutate(undefined); }} />
                    <Button variant="accent" icon={<Send />} onClick={() => send.mutate(undefined)} disabled={!draftText.trim() || sendBlocked} loading={send.isPending} className="h-[52px] rounded-2xl px-4">{mode === "demo" ? "Envoyer (simulé)" : "Envoyer"}</Button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button variant="ghost" size="sm" icon={<Bot />} onClick={() => suggest.mutate(undefined)} loading={suggest.isPending} disabled={!session.org.settings.ai.enabled}>Suggérer une réponse</Button>
                    <Button variant="ghost" size="sm" onClick={() => saveDraft.mutate(undefined)} disabled={!draftText.trim()} loading={saveDraft.isPending}>Enregistrer le brouillon</Button>
                    {activeDraftId ? <IconButton label="Supprimer le brouillon" size="sm" onClick={() => delDraft.mutate(undefined)}><Trash2 /></IconButton> : null}
                    <span className="flex-1" />
                    {activeDraftId ? <MessageStatusBadge status={failed ? "failed" : "draft"} /> : <span className="hidden text-[11px] text-text-muted sm:inline">Ctrl + Entrée pour envoyer</span>}
                  </div>
                  {mode === "demo" ? (
                    <details className="mt-2 text-xs text-text-muted">
                      <summary className="cursor-pointer">Simuler un message de l'acheteur (démonstration)</summary>
                      <div className="mt-2 flex gap-2">
                        <Input value={simText} onChange={(e) => setSimText(e.target.value)} placeholder="Ex. : Je vous propose 28 €" aria-label="Message simulé" />
                        <Button size="sm" variant="secondary" onClick={() => simulate.mutate(undefined)} loading={simulate.isPending}>Recevoir</Button>
                      </div>
                    </details>
                  ) : null}
                </footer>
              ) : <p className="border-t border-border p-3 text-xs text-text-muted">Lecture seule : votre rôle ne permet pas d'écrire.</p>}
            </div>
            <aside className="hidden w-[290px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-border p-4 scrollbar-thin xl:flex" aria-label="Article et acheteur">
              {item ? (
                <div>
                  {item.photos[0] ? <img src={item.photos[0].url} alt={item.title} className="aspect-[4/5] w-full rounded-lg object-cover" /> : null}
                  <Link to={`/app/items/${item.id}`} className="mt-2 block text-sm font-semibold text-text hover:text-accent">{item.title}</Link>
                  <p className="num text-lg font-semibold">{item.listedPriceCents !== null ? <Money cents={item.listedPriceCents} /> : "—"}</p>
                  <dl className="mt-2 grid gap-1.5 text-xs">
                    <div className="flex justify-between"><dt className="text-text-muted">Prix plancher</dt><dd className="num font-medium"><Money cents={item.floorPriceCents ?? 0} /></dd></div>
                    <div className="flex justify-between"><dt className="text-text-muted">Coût d'acquisition</dt><dd className="num font-medium"><Money cents={item.purchasePriceCents + item.purchaseFeesCents} /></dd></div>
                    <div className="flex justify-between"><dt className="text-text-muted">Marge min. / remise max.</dt><dd className="num font-medium">{formatPercent(rules.minMarginRate)} · {formatPercent(rules.maxDiscountRate)}</dd></div>
                  </dl>
                </div>
              ) : <p className="text-sm text-text-muted">Aucun article lié.</p>}
              <div className="rounded-lg bg-surface-muted p-3 text-xs text-text-muted">
                <p className="mb-1 flex items-center gap-1.5 font-semibold text-text"><ShieldCheck className="size-3.5" aria-hidden />Vos règles protègent la marge</p>
                L'IA rédige, mais la décision (accepter, contre-proposer, refuser) vient de vos règles : jamais sous le plancher, jamais de prix inventé.
              </div>
              <Link to={`/app/customers/${customer.id}`} className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-surface-muted">
                <Avatar name={customer.displayName} size={34} />
                <span className="min-w-0"><span className="block truncate text-sm font-medium">{customer.displayName}</span><span className="block truncate text-xs text-text-muted">{customer.tags.length ? customer.tags.join(" · ") : "Fiche client"}</span></span>
              </Link>
            </aside>
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

function Bubble({ m, name }: { m: Message; name: string }) {
  const inbound = m.direction === "inbound";
  return (
    <div className={cn("flex max-w-[82%] gap-2", inbound ? "self-start" : "flex-row-reverse self-end")}>
      {inbound ? <Avatar name={name} size={26} className="mt-auto mb-5" /> : null}
      <div className={cn("flex flex-col gap-1", inbound ? "items-start" : "items-end")}>
        <div className={cn("rounded-2xl px-3.5 py-2 text-sm whitespace-pre-line", inbound ? "rounded-bl-md bg-surface text-text ring-1 ring-border" : "bg-brand rounded-br-md text-white")}>{m.body}</div>
        <div className="flex flex-wrap items-center gap-2 px-1 text-[11px] text-text-muted">
          <span>{formatTime(m.createdAt)}</span>
          {m.offerCents !== null && inbound ? <span className="num rounded-full bg-accent-soft px-2 py-0.5 font-semibold text-accent">Offre détectée : <Money cents={m.offerCents} /></span> : null}
          {!inbound ? <MessageStatusBadge status={m.status} /> : null}
          {m.simulated && !inbound ? <Tag>Simulé</Tag> : null}
          {m.source === "automation" ? <Tag>Automatisation</Tag> : m.source === "ai" ? <Tag>IA</Tag> : null}
          {m.status === "failed" && m.error ? <span className="text-danger">{m.error}</span> : null}
        </div>
      </div>
    </div>
  );
}

function OfferPanel({ buyer, listedCents, offerCents, evaluation, onCreateOrder, onCounter, onDecline }: { buyer: string; listedCents: number | null; offerCents: number; evaluation: NegotiationResult; onCreateOrder?: (price: number) => void; onCounter?: () => void; onDecline?: () => void }) {
  const label: Record<NegotiationResult["decision"], { title: string; tone: string; ring: string }> = {
    accept: { title: "Offre acceptable", tone: "text-success", ring: "ring-border" },
    counter: { title: "Contre-proposition recommandée", tone: "text-accent", ring: "ring-accent/40" },
    decline: { title: "Offre à refuser", tone: "text-danger", ring: "ring-border" },
    escalate: { title: "À traiter manuellement", tone: "text-warning", ring: "ring-border" },
    hold: { title: "Réponse différée (hors horaires)", tone: "text-text-muted", ring: "ring-border" },
  };
  const l = label[evaluation.decision];
  const discount = listedCents ? Math.round((1 - offerCents / listedCents) * 100) : null;
  return (
    <div className={cn("my-1 self-center rounded-2xl bg-surface p-4 text-sm ring-1 sm:w-[min(100%,520px)]", l.ring)}>
      <p className="text-xs font-medium tracking-wide text-text-muted uppercase">Offre de {buyer}</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-2">
        <span className="num text-2xl font-semibold text-text"><Money cents={offerCents} /></span>
        {listedCents ? <span className="num text-sm text-text-muted line-through"><Money cents={listedCents} /></span> : null}
        {discount !== null ? <span className="num text-xs font-semibold text-danger">−{discount} %</span> : null}
      </div>
      <p className={cn("mt-2 font-semibold", l.tone)}>{l.title}</p>
      <p className="num text-xs text-text-muted">Marge à ce prix : <Money cents={evaluation.marginAtOfferCents} signed /> ({formatPercent(evaluation.marginRateAtOffer)})</p>
      <ul className="mt-2 flex flex-col gap-1 text-xs text-text-muted">
        {evaluation.reasons.map((r, i) => <li key={i} className="flex gap-1.5"><Check className="mt-0.5 size-3 shrink-0" aria-hidden />{r}</li>)}
      </ul>
      {evaluation.decision === "counter" && evaluation.counterCents !== null ? <p className="mt-2 text-xs">Contre-proposition calculée : <Money cents={evaluation.counterCents} className="font-semibold" /></p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {onCreateOrder && evaluation.decision === "accept" ? <Button size="sm" onClick={() => onCreateOrder(offerCents)}>Créer la commande à <Money cents={offerCents} /></Button> : null}
        {onCounter && evaluation.counterCents !== null ? <Button size="sm" variant="secondary" onClick={onCounter}>Préparer la contre-offre</Button> : null}
        {onCreateOrder && evaluation.counterCents !== null && (evaluation.decision === "accept" || evaluation.decision === "counter") ? <Button size="sm" variant="secondary" onClick={() => onCreateOrder(evaluation.counterCents!)}>Créer la commande à <Money cents={evaluation.counterCents} /></Button> : null}
        {onDecline && evaluation.decision !== "accept" ? <Button size="sm" variant="ghost" icon={<X />} onClick={onDecline}>Refuser poliment</Button> : null}
      </div>
    </div>
  );
}
