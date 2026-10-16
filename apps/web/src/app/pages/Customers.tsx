import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import type { CustomerQuery } from "@selio/contracts";
import { Avatar, Button, Dialog, EmptyState, Field, Input, Money, PageHeader, Pagination, Select, Table, TableEmpty, TableWrap, Td, Th, Tr, Tag, formatRelative } from "@selio/ui";
import { useClient, useRequiredSession } from "../../lib/data/provider";
import { QueryBoundary } from "../components/common";
import { useAppMutation } from "../components/hooks";

export default function Customers() {
  const client = useClient();
  const session = useRequiredSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query: Partial<CustomerQuery> = { q: params.get("q") ?? undefined, tag: params.get("tag") ?? undefined, sort: (params.get("sort") as CustomerQuery["sort"]) ?? "last_contact_desc", page: Number(params.get("page") ?? 1), pageSize: 25 };
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); if (k !== "page") p.delete("page"); setParams(p, { replace: true }); };
  const q = useQuery({ queryKey: ["customers", query], queryFn: () => client.listCustomers(query) });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ displayName: "", handle: "", city: "", notes: "" });
  const create = useAppMutation(() => client.createCustomer({ displayName: form.displayName, handle: form.handle || null, city: form.city || null, notes: form.notes, provider: "demo" }), { invalidate: ["customers"], success: "Client créé", onSuccess: (c) => { setOpen(false); navigate(`/app/customers/${c.id}`); } });
  return (
    <>
      <PageHeader title="Clients" description="Fiches minimales : pseudo, ville facultative, notes et tags. Aucune donnée superflue." actions={session.role !== "viewer" ? <Button icon={<Plus />} onClick={() => setOpen(true)}>Nouveau client</Button> : undefined} />
      <div className="mb-4 grid gap-2 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Input placeholder="Rechercher nom, pseudo, ville…" prefix={<Search />} value={query.q ?? ""} onChange={(e) => set("q", e.target.value)} aria-label="Recherche" />
        <Select value={query.sort} onChange={(e) => set("sort", e.target.value)} aria-label="Tri"><option value="last_contact_desc">Dernier contact</option><option value="name_asc">Nom A→Z</option><option value="orders_desc">Commandes</option></Select>
      </div>
      <QueryBoundary query={q} empty={(d) => d.total === 0 && !query.q ? <EmptyState title="Aucun client" description="Les clients sont créés automatiquement à la première conversation ou commande." /> : null}>
        {(d) => (
          <>
            <TableWrap>
              <Table>
                <thead><tr><Th>Client</Th><Th>Tags</Th><Th className="hide-mobile">Ville</Th><Th numeric>Commandes</Th><Th numeric>CA</Th><Th>Dernier contact</Th></tr></thead>
                <tbody>
                  {d.items.length === 0 ? <TableEmpty colSpan={6}>Aucun client ne correspond.</TableEmpty> : d.items.map((c) => (
                    <Tr key={c.id} interactive tabIndex={0} onClick={() => navigate(`/app/customers/${c.id}`)} onKeyDown={(e) => { if (e.key === "Enter") navigate(`/app/customers/${c.id}`); }}>
                      <Td><span className="flex items-center gap-3"><Avatar name={c.displayName} /><span><span className="block font-medium">{c.displayName}</span><span className="block text-xs text-text-muted">{c.handle ? `@${c.handle}` : "—"} · {c.provider}</span></span></span></Td>
                      <Td><span className="flex flex-wrap gap-1">{c.tags.map((t) => <Tag key={t}>{t}</Tag>)}</span></Td>
                      <Td className="hide-mobile text-text-muted">{c.city ?? "—"}</Td>
                      <Td numeric>{c.orderCount}</Td>
                      <Td numeric><Money cents={c.revenueCents} /></Td>
                      <Td className="text-text-muted">{c.lastContactAt ? formatRelative(c.lastContactAt) : "—"}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
            <Pagination className="mt-3" page={d.page} pageCount={d.pageCount} total={d.total} pageSize={d.pageSize} onPageChange={(p) => set("page", String(p))} />
          </>
        )}
      </QueryBoundary>
      <Dialog open={open} onClose={() => setOpen(false)} title="Nouveau client" size="sm" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Annuler</Button><Button onClick={() => create.mutate()} loading={create.isPending} disabled={!form.displayName.trim()}>Créer</Button></>}>
        <div className="flex flex-col gap-3">
          <Field label="Nom d'affichage" required>{(p) => <Input id={p.id} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />}</Field>
          <Field label="Pseudo marketplace" hint="Sert à la déduplication.">{(p) => <Input id={p.id} aria-describedby={p.describedBy} value={form.handle} onChange={(e) => setForm({ ...form, handle: e.target.value })} />}</Field>
          <Field label="Ville (facultatif)">{(p) => <Input id={p.id} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />}</Field>
          <Field label="Notes">{(p) => <Input id={p.id} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />}</Field>
        </div>
      </Dialog>
      <Link to="/app/messages" className="sr-only">Messagerie</Link>
    </>
  );
}
