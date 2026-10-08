import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { MessageSquare, Package, StickyNote, UserPlus } from "lucide-react";
import { Avatar, Button, Card, DescriptionList, Dialog, Field, Input, Money, PageHeader, Select, Tag, Textarea, formatDate, formatDateTime, formatPercent } from "@selio/ui";
import { useClient, useRequiredSession } from "../../lib/data/provider";
import { OrderStatusBadge, QueryBoundary } from "../components/common";
import { useAppMutation } from "../components/hooks";

export default function CustomerDetail() {
  const { id = "" } = useParams();
  const client = useClient();
  const session = useRequiredSession();
  const q = useQuery({ queryKey: ["customer", id], queryFn: () => client.getCustomerTimeline(id) });
  const others = useQuery({ queryKey: ["customers", { all: true }], queryFn: () => client.listCustomers({ pageSize: 200 }) });
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeId, setMergeId] = useState("");
  useEffect(() => { if (q.data) { setNotes(q.data.customer.notes); setTags(q.data.customer.tags.join(", ")); } }, [q.data]);
  const save = useAppMutation(() => client.updateCustomer(id, { notes, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) }), { invalidate: ["customer", "customers"], success: "Fiche enregistrée" });
  const merge = useAppMutation(() => client.mergeCustomers(id, mergeId), { invalidate: ["customer", "customers", "conversations", "orders"], success: "Clients fusionnés", onSuccess: () => setMergeOpen(false) });
  const canWrite = session.role !== "viewer";
  return (
    <QueryBoundary query={q} skeleton="spinner">
      {(d) => (
        <>
          <PageHeader eyebrow={<Link to="/app/customers" className="hover:text-text">Clients</Link>} title={<span className="flex items-center gap-3"><Avatar name={d.customer.displayName} size={36} />{d.customer.displayName}</span>} description={<span className="flex flex-wrap gap-1.5">{d.customer.handle ? <Tag>@{d.customer.handle}</Tag> : null}<Tag>{d.customer.provider}</Tag>{d.customer.tags.map((t) => <Tag key={t} accent>{t}</Tag>)}</span>} actions={canWrite ? <Button variant="secondary" icon={<UserPlus />} onClick={() => setMergeOpen(true)}>Fusionner un doublon</Button> : undefined} />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <Card padding="sm"><p className="text-sm text-text-muted">Commandes</p><p className="num mt-1 text-lg font-semibold">{d.totals.orders}</p></Card>
                <Card padding="sm"><p className="text-sm text-text-muted">Chiffre d'affaires</p><p className="num mt-1 text-lg font-semibold"><Money cents={d.totals.revenueCents} /></p></Card>
                <Card padding="sm"><p className="text-sm text-text-muted">Marge brute</p><p className="num mt-1 text-lg font-semibold"><Money cents={d.totals.marginCents} signed /> <span className="text-xs font-normal text-text-muted">{d.totals.revenueCents ? formatPercent(d.totals.marginCents / d.totals.revenueCents) : ""}</span></p></Card>
              </div>
              <Card>
                <h2 className="mb-3 text-md font-semibold">Historique</h2>
                {d.events.length === 0 ? <p className="text-sm text-text-muted">Aucun événement.</p> : (
                  <ol className="flex flex-col gap-3">
                    {d.events.slice(0, 50).map((e, i) => (
                      <li key={i} className="flex gap-3 text-sm">
                        <span className="mt-0.5 text-text-muted [&>svg]:size-4" aria-hidden>{e.kind === "message" ? <MessageSquare /> : e.kind === "order" ? <Package /> : <StickyNote />}</span>
                        <span className="min-w-0 flex-1">
                          {e.to ? <Link to={e.to} className="block truncate hover:text-accent">{e.label}</Link> : <span className="block truncate">{e.label}</span>}
                          <span className="block text-xs text-text-muted">{formatDateTime(e.at)}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
            </div>
            <div className="flex flex-col gap-4">
              <Card>
                <h2 className="mb-3 text-md font-semibold">Fiche</h2>
                <DescriptionList items={[{ label: "Ville", value: d.customer.city ?? "—" }, { label: "Premier contact", value: d.customer.firstContactAt ? formatDate(d.customer.firstContactAt) : "—" }, { label: "Dernier contact", value: d.customer.lastContactAt ? formatDate(d.customer.lastContactAt) : "—" }]} />
                <div className="mt-4 flex flex-col gap-3">
                  <Field label="Tags" hint="Séparés par des virgules.">{(p) => <Input id={p.id} aria-describedby={p.describedBy} value={tags} onChange={(e) => setTags(e.target.value)} disabled={!canWrite} />}</Field>
                  <Field label="Notes">{(p) => <Textarea id={p.id} rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canWrite} />}</Field>
                  {canWrite ? <div className="flex justify-end"><Button size="sm" onClick={() => save.mutate()} loading={save.isPending}>Enregistrer</Button></div> : null}
                </div>
              </Card>
              <Card>
                <h2 className="mb-3 text-md font-semibold">Conversations</h2>
                {d.conversations.length === 0 ? <p className="text-sm text-text-muted">Aucune conversation.</p> : <ul className="divide-y divide-border">{d.conversations.map((c) => <li key={c.id}><Link to={`/app/messages/${c.id}`} className="block py-2 text-sm hover:text-accent"><span className="block truncate">{c.lastMessagePreview || "(vide)"}</span><span className="text-xs text-text-muted">{c.lastMessageAt ? formatDateTime(c.lastMessageAt) : ""}</span></Link></li>)}</ul>}
              </Card>
              <Card>
                <h2 className="mb-3 text-md font-semibold">Commandes</h2>
                {d.orders.length === 0 ? <p className="text-sm text-text-muted">Aucune commande.</p> : <ul className="divide-y divide-border">{d.orders.map((o) => <li key={o.id}><Link to={`/app/orders/${o.id}`} className="flex items-center justify-between gap-2 py-2 text-sm hover:text-accent"><span className="truncate">{o.item?.title ?? "Article"}</span><span className="flex items-center gap-2"><OrderStatusBadge status={o.status} /><Money cents={o.salePriceCents} /></span></Link></li>)}</ul>}
              </Card>
            </div>
          </div>
          <Dialog open={mergeOpen} onClose={() => setMergeOpen(false)} title="Fusionner un doublon" description="Les conversations et commandes du doublon sont rattachées à cette fiche, puis le doublon est supprimé." size="sm" footer={<><Button variant="ghost" onClick={() => setMergeOpen(false)}>Annuler</Button><Button onClick={() => merge.mutate()} disabled={!mergeId} loading={merge.isPending}>Fusionner</Button></>}>
            <Field label="Fiche à fusionner dans celle-ci">{(p) => <Select id={p.id} value={mergeId} onChange={(e) => setMergeId(e.target.value)}><option value="">Choisir…</option>{(others.data?.items ?? []).filter((c) => c.id !== id).map((c) => <option key={c.id} value={c.id}>{c.displayName}{c.handle ? ` (@${c.handle})` : ""}</option>)}</Select>}</Field>
          </Dialog>
        </>
      )}
    </QueryBoundary>
  );
}
