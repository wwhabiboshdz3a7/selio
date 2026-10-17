import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Copy, Ellipsis, KeyRound, Pencil, Plus, RefreshCw, ShieldCheck, ShoppingBag, Store, Trash2, Unplug, UserRound } from "lucide-react";
import { CAPABILITY_LABELS, CONNECTION_USAGE_DESCRIPTIONS, CONNECTION_USAGE_LABELS, CONNECTION_USAGES, type Capability, type ConnectionUsage, type ExtensionToken, type MarketplaceConnection } from "@selio/contracts";
import { can, countByUsage, resolvePurchaseAccount, type AccountStats } from "@selio/domain";
import { Alert, Avatar, Button, ConfirmDialog, Dialog, EmptyState, Field, IconButton, Input, Menu, PageHeader, Segmented, StatusBadge, Table, TableWrap, Tabs, Tag, Td, Th, Tr, cn, formatCents, formatDateTime, formatRelative, useToast } from "@selio/ui";
import { useClient, useData, useRequiredSession } from "../../lib/data/provider";
import { ConnectorStatusBadge, QueryBoundary } from "../components/common";
import { useAppMutation } from "../components/hooks";

type Filter = ConnectionUsage | "all";

/** Catégorie dans l'adresse (?categorie=vente) : un onglet se partage et survit au rechargement. */
const SLUGS: Record<ConnectionUsage, string> = { sale: "vente", purchase: "achat", personal: "perso" };
const fromSlug = (s: string | null): Filter => (Object.entries(SLUGS).find(([, v]) => v === s)?.[0] as ConnectionUsage | undefined) ?? "all";

const USAGE_ICON: Record<ConnectionUsage, ReactNode> = { sale: <Store />, purchase: <ShoppingBag />, personal: <UserRound /> };
const EMPTY_HINT: Record<ConnectionUsage, string> = {
  sale: "Ajoutez le compte Vinted sur lequel vous publiez : le générateur, le dressing et la messagerie s'en serviront.",
  purchase: "Ajoutez le compte avec lequel vous achetez : l'achat auto et « À valider » sauront quel compte utiliser.",
  personal: "Un compte perso reste visible ici sans jamais être utilisé par les automatisations.",
};

const INV = ["connections", "connection-stats", "overview", "usage"];

const handleOf = (c: MarketplaceConnection): string | null => (typeof c.config.displayHandle === "string" && c.config.displayHandle ? c.config.displayHandle : null);

export default function Accounts() {
  const client = useClient();
  const session = useRequiredSession();
  const [params, setParams] = useSearchParams();
  const filter = fromSlug(params.get("categorie"));
  const connections = useQuery({ queryKey: ["connections"], queryFn: () => client.listConnections() });
  const stats = useQuery({ queryKey: ["connection-stats"], queryFn: () => client.getConnectionStats() });
  const usage = useQuery({ queryKey: ["usage"], queryFn: () => client.getUsage() });
  const [adding, setAdding] = useState<ConnectionUsage | null>(null);
  const manage = can(session.role, "connections.manage");

  // Lien direct « ajouter un compte » (par exemple depuis l'achat auto) : ?ajouter=1.
  useEffect(() => {
    if (params.get("ajouter") !== "1") return;
    if (manage) setAdding(filter === "all" ? "sale" : filter);
    const next = new URLSearchParams(params);
    next.delete("ajouter");
    setParams(next, { replace: true });
  }, [params, setParams, filter, manage]);

  const setFilter = (f: Filter) => {
    const next = new URLSearchParams(params);
    if (f === "all") next.delete("categorie");
    else next.set("categorie", SLUGS[f]);
    setParams(next, { replace: true });
  };

  const list = connections.data ?? [];
  const counts = countByUsage(list);
  const statOf = (id: string) => stats.data?.find((s) => s.connectionId === id) ?? null;
  const autoBuyAccount = resolvePurchaseAccount(list, session.org.settings.autoBuy.connectionId);
  const quota = usage.data ? { used: usage.data.connectionsCount, max: usage.data.quotas.connections } : null;

  return (
    <>
      <PageHeader
        title="Comptes Vinted"
        description="Connectez plusieurs comptes et dites à Selio à quoi sert chacun : vendre, acheter ou usage perso. Chaque compte n'est utilisé que pour sa catégorie."
        actions={manage ? <Button icon={<Plus />} onClick={() => setAdding(filter === "all" ? "sale" : filter)}>Ajouter un compte</Button> : null}
      />
      <p className="-mt-2 mb-5 flex items-start gap-2 text-sm text-text-muted">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>Vinted ne propose pas de connexion officielle pour les outils tiers : Selio passe par son extension, dans le navigateur où vous êtes déjà connecté à Vinted, sans jamais demander ni stocker votre mot de passe.</span>
      </p>

      <Tabs
        ariaLabel="Catégories de comptes"
        value={filter}
        onChange={setFilter}
        className="mb-5"
        items={[
          { value: "all", label: "Tous", count: counts.all },
          ...CONNECTION_USAGES.map((u) => ({ value: u, label: CONNECTION_USAGE_LABELS[u], count: counts[u] })),
        ]}
      />

      <QueryBoundary query={connections}>
        {(all) => filter === "all" ? (
          <div className="flex flex-col gap-8">
            {CONNECTION_USAGES.map((u) => {
              const group = all.filter((c) => c.usage === u);
              return (
                <section key={u} aria-labelledby={`groupe-${u}`}>
                  <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h2 id={`groupe-${u}`} className="text-md font-semibold">{CONNECTION_USAGE_LABELS[u]} <span className="num font-normal text-text-muted">{group.length}</span></h2>
                    <p className="text-sm text-text-muted">{CONNECTION_USAGE_DESCRIPTIONS[u]}</p>
                  </div>
                  {group.length === 0 ? (
                    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border-strong p-4 text-sm text-text-muted sm:flex-row sm:items-center sm:justify-between">
                      <span>{EMPTY_HINT[u]}</span>
                      {manage ? <Button size="sm" variant="secondary" icon={<Plus />} onClick={() => setAdding(u)}>Ajouter un compte {CONNECTION_USAGE_LABELS[u]}</Button> : null}
                    </div>
                  ) : (
                    <AccountGrid accounts={group} statOf={statOf} manage={manage} autoBuyAccountId={autoBuyAccount?.id ?? null} />
                  )}
                </section>
              );
            })}
          </div>
        ) : (
          <>
            <p className="mb-4 flex items-center gap-2 text-sm text-text-muted [&>svg]:size-4">{USAGE_ICON[filter]}{CONNECTION_USAGE_DESCRIPTIONS[filter]}</p>
            {all.filter((c) => c.usage === filter).length === 0 ? (
              <EmptyState icon={USAGE_ICON[filter]} title={`Aucun compte ${CONNECTION_USAGE_LABELS[filter]}`} description={EMPTY_HINT[filter]} action={manage ? <Button icon={<Plus />} onClick={() => setAdding(filter)}>Ajouter un compte {CONNECTION_USAGE_LABELS[filter]}</Button> : undefined} />
            ) : (
              <AccountGrid accounts={all.filter((c) => c.usage === filter)} statOf={statOf} manage={manage} autoBuyAccountId={autoBuyAccount?.id ?? null} />
            )}
          </>
        )}
      </QueryBoundary>

      {quota ? <p className="num mt-6 text-xs text-text-muted">{quota.used} compte{quota.used > 1 ? "s" : ""} Vinted sur {quota.max} inclus dans votre abonnement · <Link to="/app/settings/billing" className="underline-offset-2 hover:text-text hover:underline">voir l'abonnement</Link>. Le simulateur de démonstration n'est pas compté.</p> : null}
      {manage && connections.data && !connections.data.some((c) => c.provider === "demo") ? <SimulatorShortcut /> : null}

      <ExtensionLink />

      {adding ? <AddAccountDialog initialUsage={adding} quota={quota} onClose={() => setAdding(null)} /> : null}
    </>
  );
}

function AccountGrid({ accounts, statOf, manage, autoBuyAccountId }: { accounts: MarketplaceConnection[]; statOf: (id: string) => AccountStats | null; manage: boolean; autoBuyAccountId: string | null }) {
  // Les vrais comptes d'abord, le simulateur ensuite ; ordre d'ajout conservé à l'intérieur.
  const sorted = [...accounts].sort((a, b) => Number(a.provider === "demo") - Number(b.provider === "demo"));
  return (
    <ul className="grid gap-4 lg:grid-cols-2">
      {sorted.map((c) => <li key={c.id} className="min-w-0"><AccountCard account={c} stats={statOf(c.id)} manage={manage} usedByAutoBuy={c.id === autoBuyAccountId} /></li>)}
    </ul>
  );
}

function AccountCard({ account: c, stats, manage, usedByAutoBuy }: { account: MarketplaceConnection; stats: AccountStats | null; manage: boolean; usedByAutoBuy: boolean }) {
  const client = useClient();
  const { toast } = useToast();
  const [testResult, setTestResult] = useState<{ message: string; ok: boolean; simulated: boolean } | null>(null);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const handle = handleOf(c);
  const extension = c.transport === "extension";
  const setUsage = useAppMutation((usage: ConnectionUsage) => client.updateConnection(c.id, { usage }), {
    invalidate: INV,
    success: (r) => r.usage === "personal" ? `« ${r.label} » classé en Perso : aucune automatisation ne l'utilisera` : `« ${r.label} » classé en ${CONNECTION_USAGE_LABELS[r.usage]}`,
  });
  const test = useAppMutation(() => client.testConnection(c.id), { invalidate: INV, onSuccess: (r) => setTestResult({ message: r.message, ok: r.ok, simulated: r.simulated }) });
  const sync = useAppMutation(() => client.syncConnection(c.id), { invalidate: [...INV, "conversations", "nav-counts"], success: (r) => `${r.conversations} conversation(s) synchronisée(s)${r.simulated ? " (simulation)" : ""}` });
  const disconnect = useAppMutation(() => client.disconnectConnection(c.id), { invalidate: INV, success: "Accès révoqué", onSuccess: () => setRevoking(false) });
  const remove = useAppMutation(() => client.deleteConnection(c.id), { invalidate: [...INV, "items"], success: "Compte supprimé", onSuccess: () => setRemoving(false) });
  const usable = c.status === "connected" || c.status === "degraded";
  const onSync = () => {
    // Un compte relié par l'extension se synchronise depuis le navigateur, pas depuis le serveur.
    if (extension) toast({ tone: "info", title: "Synchronisation par l'extension", description: "Ouvrez Vinted dans votre navigateur avec l'extension Selio active : les annonces et conversations visibles sont relevées automatiquement." });
    else sync.mutate(undefined);
  };

  return (
    <article className={cn("card flex h-full flex-col gap-4 p-4 md:p-5", c.status === "disconnected" && "opacity-75")} aria-label={`Compte ${handle ? `@${handle}` : c.label}`}>
      <div className="flex items-start gap-3">
        <Avatar name={handle ?? c.label} size={40} className="max-sm:hidden" />
        <div className="min-w-0 flex-1">
          <h3 className="text-md leading-snug font-semibold [overflow-wrap:anywhere] text-text">{handle ? `@${handle}` : c.label}</h3>
          <p className="text-xs text-text-muted">{[handle ? c.label : null, c.provider === "demo" ? "Simulateur, aucune action réelle" : "Vinted, via l'extension"].filter(Boolean).join(" · ")}</p>
        </div>
        <ConnectorStatusBadge status={c.status} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {manage ? (
          <Segmented ariaLabel={`Catégorie du compte ${c.label}`} size="sm" value={c.usage} onChange={(u) => { if (u !== c.usage) setUsage.mutate(u); }} items={CONNECTION_USAGES.map((u) => ({ value: u, label: CONNECTION_USAGE_LABELS[u] }))} />
        ) : <Tag accent>{CONNECTION_USAGE_LABELS[c.usage]}</Tag>}
        {usedByAutoBuy ? <Tag accent>Utilisé par l'achat auto</Tag> : null}
      </div>

      <AccountNumbers account={c} stats={stats} usedByAutoBuy={usedByAutoBuy} />
      <CapabilitySummary account={c} />

      <div className="flex flex-col gap-1 text-xs text-text-muted">
        <p className="num">Dernière synchro : {c.lastSyncAt ? formatRelative(c.lastSyncAt) : "jamais"} · dernier test : {c.lastTestAt ? formatRelative(c.lastTestAt) : "jamais"}</p>
        {c.status === "ready" ? <p>En attente de l'extension : ouvrez Vinted dans le navigateur où l'extension Selio est reliée (voir « Avancé » plus bas).</p> : null}
        {c.status === "disconnected" ? <p>Accès révoqué : supprimez ce compte ou ajoutez-le à nouveau pour le reconnecter.</p> : null}
        {c.lastError ? <p className="text-danger">{c.lastError}</p> : null}
      </div>
      {testResult ? <Alert tone={testResult.ok ? "success" : "warning"}>{testResult.message}{testResult.simulated ? " (simulation)" : ""}</Alert> : null}

      {manage ? (
        <div className="mt-auto flex items-center gap-2 border-t border-border pt-3">
          <Button size="sm" variant="secondary" onClick={() => test.mutate(undefined)} loading={test.isPending}>Tester</Button>
          <Button size="sm" variant="secondary" icon={<RefreshCw />} onClick={onSync} loading={sync.isPending} disabled={!usable}>Synchroniser</Button>
          <div className="ml-auto">
            <Menu
              trigger={({ toggle, open, id }) => <IconButton label={`Plus d'actions pour ${c.label}`} size="sm" onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-controls={id}><Ellipsis /></IconButton>}
              items={[
                { label: "Modifier le nom ou le pseudo", icon: <Pencil />, onSelect: () => setEditing(true) },
                { label: "Révoquer l'accès", icon: <Unplug />, onSelect: () => setRevoking(true), disabled: c.status === "disconnected" },
                { label: "Supprimer", icon: <Trash2 />, onSelect: () => setRemoving(true), danger: true },
              ]}
            />
          </div>
        </div>
      ) : null}

      {editing ? <EditAccountDialog account={c} onClose={() => setEditing(false)} /> : null}
      <ConfirmDialog open={revoking} onClose={() => setRevoking(false)} onConfirm={() => disconnect.mutate(undefined)} loading={disconnect.isPending} title={`Révoquer l'accès de « ${c.label} » ?`} description="Selio cesse d'utiliser ce compte et efface les secrets éventuels. Les articles et conversations liés sont conservés." confirmLabel="Révoquer" />
      <ConfirmDialog open={removing} onClose={() => setRemoving(false)} onConfirm={() => remove.mutate(undefined)} loading={remove.isPending} danger title={`Supprimer « ${c.label} » ?`} description="Les articles et conversations liés restent, sans compte associé. Les secrets éventuels sont détruits." confirmLabel="Supprimer" />
    </article>
  );
}

/** Chiffres utiles selon la catégorie du compte. */
function AccountNumbers({ account: c, stats, usedByAutoBuy }: { account: MarketplaceConnection; stats: AccountStats | null; usedByAutoBuy: boolean }) {
  const v = (n: number | undefined) => (stats ? n ?? 0 : "…");
  const sales = stats ? `${stats.salesThisMonth}${stats.revenueThisMonthCents ? ` · ${formatCents(stats.revenueThisMonthCents)}` : ""}` : "…";
  const items: { label: string; value: ReactNode }[] =
    c.usage === "purchase"
      ? [
          { label: "Achats (simulés)", value: v(stats?.purchases) },
          { label: "Montant", value: stats ? formatCents(stats.purchasesSpentCents) : "…" },
          { label: "Achat auto", value: usedByAutoBuy ? "Ce compte" : "Non" },
        ]
      : [
          { label: "En ligne", value: v(stats?.listedItems) },
          { label: "Ventes du mois", value: sales },
          c.usage === "personal" ? { label: "Automatisations", value: "Jamais" } : { label: "Conversations", value: v(stats?.openConversations) },
        ];
  return (
    <dl className="grid grid-cols-3 gap-3 rounded-md bg-surface-muted px-3 py-2.5">
      {items.map((it) => (
        <div key={it.label} className="flex min-w-0 flex-col gap-0.5">
          <dt className="truncate text-xs text-text-muted">{it.label}</dt>
          <dd className="num truncate text-base font-medium text-text">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Ce que Selio fait avec le compte, en phrases (le détail technique de chaque capacité est au survol). */
const CAP_PHRASE: Record<Capability, string> = {
  read_items: "lire les annonces",
  read_conversations: "lire les conversations",
  prepare_message: "préparer les réponses",
  send_message: "envoyer les messages à votre place",
  sync_orders: "synchroniser les commandes",
  shipping_document: "créer le bordereau",
};

function Phrases({ caps, last }: { caps: MarketplaceConnection["capabilities"]; last: "et" | "ni" }) {
  return (
    <>
      {caps.map((x, i) => (
        <span key={x.capability}>
          {i === 0 ? "" : i === caps.length - 1 ? ` ${last} ` : ", "}
          <span title={x.note ? `${CAPABILITY_LABELS[x.capability]} : ${x.note}` : CAPABILITY_LABELS[x.capability]}>{CAP_PHRASE[x.capability]}</span>
        </span>
      ))}
    </>
  );
}

/** Capacités en clair : ce qui marche, ce qui est en test, ce que Selio ne fait pas. */
function CapabilitySummary({ account: c }: { account: MarketplaceConnection }) {
  const available = c.capabilities.filter((x) => x.state === "available");
  const experimental = c.capabilities.filter((x) => x.state === "experimental");
  const unavailable = c.capabilities.filter((x) => x.state === "unavailable");
  if (c.capabilities.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 text-xs leading-relaxed text-text-muted">
      {available.length ? <p><span className="font-medium text-text">Peut</span> <Phrases caps={available} last="et" />{c.provider === "demo" ? ", le tout en simulation" : ""}.</p> : null}
      {experimental.length ? <p><span className="font-medium text-text">En test</span> (non vérifié en réel) : <Phrases caps={experimental} last="et" />.</p> : null}
      {unavailable.length ? <p><span className="font-medium text-text">Ne peut pas</span> <Phrases caps={unavailable} last="ni" /> : vous gardez la main dans Vinted.</p> : null}
    </div>
  );
}

function UsageChoice({ value, onChange }: { value: ConnectionUsage; onChange: (u: ConnectionUsage) => void }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm font-medium text-text">Catégorie</legend>
      {CONNECTION_USAGES.map((u) => (
        <label key={u} className={cn("flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors", value === u ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-muted")}>
          <input type="radio" name="usage" value={u} checked={value === u} onChange={() => onChange(u)} className="mt-1 accent-[var(--accent)]" />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-text">{CONNECTION_USAGE_LABELS[u]}</span>
            <span className="block text-xs text-text-muted">{CONNECTION_USAGE_DESCRIPTIONS[u]}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

const normalizeHandle = (v: string) => v.trim().replace(/^@+/, "");
const HANDLE_RE = /^[^\s<>"'`]{1,60}$/;

function AddAccountDialog({ initialUsage, quota, onClose }: { initialUsage: ConnectionUsage; quota: { used: number; max: number } | null; onClose: () => void }) {
  const client = useClient();
  const [handle, setHandle] = useState("");
  const [label, setLabel] = useState("");
  const [usage, setUsage] = useState<ConnectionUsage>(initialUsage);
  const [touched, setTouched] = useState(false);
  const h = normalizeHandle(handle);
  const handleError = touched && !HANDLE_RE.test(h) ? (h ? "Pseudo sans espace ni caractère spécial." : "Indiquez le pseudo du compte Vinted.") : null;
  const full = quota !== null && quota.used >= quota.max;
  const create = useAppMutation(() => client.createConnection({ provider: "vinted", label: label.trim() || `@${h}`, usage, config: { displayHandle: h } }), {
    invalidate: INV,
    success: "Compte ajouté : ouvrez Vinted avec l'extension Selio pour l'activer",
    onSuccess: onClose,
  });
  const submit = () => {
    setTouched(true);
    if (HANDLE_RE.test(h) && !full && !create.isPending) create.mutate(undefined);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Ajouter un compte Vinted"
      description="Le compte est relié par l'extension Selio, dans le navigateur où vous êtes connecté à Vinted : aucun mot de passe n'est demandé."
      size="md"
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button onClick={submit} loading={create.isPending} disabled={full}>Ajouter le compte</Button></>}
    >
      {/* Entrée dans un champ valide la fenêtre (le bouton est dans le pied de la fenêtre, hors du formulaire). */}
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }} onKeyDown={(e) => { if (e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.type !== "radio") { e.preventDefault(); submit(); } }}>
        <Field label="Pseudo Vinted" required hint="Tel qu'il apparaît sur votre profil Vinted. Sert uniquement à reconnaître le compte." error={handleError}>
          {(p) => <Input id={p.id} aria-describedby={p.describedBy} invalid={p.invalid} value={handle} onChange={(e) => setHandle(e.target.value)} onBlur={() => setTouched(true)} placeholder="ex. atelier.secondemain" prefix={<span className="text-sm">@</span>} autoComplete="off" autoFocus maxLength={61} />}
        </Field>
        <Field label="Nom interne" hint="Visible seulement dans Selio, pour vous et votre équipe.">
          {(p) => <Input id={p.id} aria-describedby={p.describedBy} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex. Boutique principale" maxLength={80} />}
        </Field>
        <UsageChoice value={usage} onChange={setUsage} />
        {full ? <Alert tone="warning" title="Quota de comptes atteint">Votre abonnement inclut {quota?.max} compte(s) Vinted. <Link to="/app/settings/billing" className="font-medium underline">Changer d'abonnement</Link> ou supprimez un compte inutilisé.</Alert> : null}
      </form>
    </Dialog>
  );
}

function EditAccountDialog({ account: c, onClose }: { account: MarketplaceConnection; onClose: () => void }) {
  const client = useClient();
  const [label, setLabel] = useState(c.label);
  const [handle, setHandle] = useState(handleOf(c) ?? "");
  const h = normalizeHandle(handle);
  const vinted = c.provider === "vinted";
  const handleError = vinted && h && !HANDLE_RE.test(h) ? "Pseudo sans espace ni caractère spécial." : null;
  const save = useAppMutation(() => client.updateConnection(c.id, { label: label.trim(), ...(vinted ? { displayHandle: h } : {}) }), { invalidate: INV, success: "Compte modifié", onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} title="Modifier le compte" size="sm" footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!label.trim() || Boolean(handleError)}>Enregistrer</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Nom interne">{(p) => <Input id={p.id} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} />}</Field>
        {vinted ? <Field label="Pseudo Vinted" error={handleError}>{(p) => <Input id={p.id} aria-describedby={p.describedBy} invalid={p.invalid} value={handle} onChange={(e) => setHandle(e.target.value)} prefix={<span className="text-sm">@</span>} autoComplete="off" maxLength={61} />}</Field> : null}
      </div>
    </Dialog>
  );
}

/** Mode connecté sans simulateur : on peut l'ajouter pour essayer le parcours sans compte réel. */
function SimulatorShortcut() {
  const client = useClient();
  const add = useAppMutation(() => client.createConnection({ provider: "demo", label: "Simulateur de démonstration", usage: "sale" }), { invalidate: INV, success: "Simulateur ajouté" });
  return (
    <p className="mt-2 text-xs text-text-muted">
      Pour essayer sans compte réel :{" "}
      <button type="button" className="font-medium text-accent underline-offset-2 hover:underline disabled:opacity-60" onClick={() => add.mutate(undefined)} disabled={add.isPending}>ajouter le simulateur de démonstration</button>
      {" "}(toutes ses actions sont simulées).
    </p>
  );
}

/**
 * Jetons d'extension : nécessaires pour relier l'extension, mais techniques.
 * Repliés par défaut dans une section « Avancé ».
 */
function ExtensionLink() {
  const client = useClient();
  const session = useRequiredSession();
  const { mode } = useData();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const tokens = useQuery({ queryKey: ["tokens"], queryFn: () => client.listExtensionTokens(), enabled: open });
  const [tokenLabel, setTokenLabel] = useState("");
  const [issued, setIssued] = useState<{ token: ExtensionToken; secret: string } | null>(null);
  const [revoking, setRevoking] = useState<ExtensionToken | null>(null);
  const createToken = useAppMutation(() => client.createExtensionToken({ label: tokenLabel.trim() || "Extension" }), { invalidate: ["tokens"], onSuccess: (r) => { setIssued(r); setTokenLabel(""); } });
  const revoke = useAppMutation((id: string) => client.revokeExtensionToken(id), { invalidate: ["tokens"], success: "Jeton révoqué", onSuccess: () => setRevoking(null) });
  const canTokens = can(session.role, "tokens.manage");
  const active = (tokens.data ?? []).filter((t) => !t.revokedAt && new Date(t.expiresAt) > new Date()).length;

  return (
    <>
    <details className="card group mt-8" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 md:p-5 [&::-webkit-details-marker]:hidden">
        <KeyRound className="size-4 shrink-0 text-text-muted" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold text-text">Avancé — relier l'extension Selio</span>
          <span className="block text-xs text-text-muted">À faire une fois par navigateur : un jeton relie l'extension à votre organisation.</span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-text-muted transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="flex flex-col gap-4 border-t border-border p-4 md:p-5">
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-text-muted">
          <li>Créez un jeton ci-dessous (nommez l'appareil, par exemple « Chrome — PC bureau »).</li>
          <li>Collez-le dans les options de l'extension Selio. Il n'est affiché qu'une fois.</li>
          <li>Ouvrez Vinted dans ce navigateur : vos comptes passent à « Connecté ».</li>
        </ol>
        <p className="text-xs text-text-muted">Droits limités (capture d'articles, lecture des règles, brouillons), expiration après 90 jours, révocation immédiate.{mode === "demo" ? " En démonstration, le jeton est fictif." : ""}</p>
        {canTokens ? (
          <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); createToken.mutate(undefined); }}>
            <Field label="Nom du jeton" className="flex-1">{(p) => <Input id={p.id} value={tokenLabel} onChange={(e) => setTokenLabel(e.target.value)} placeholder="ex. Chrome — PC bureau" maxLength={80} />}</Field>
            <Button type="submit" icon={<KeyRound />} loading={createToken.isPending}>Créer un jeton</Button>
          </form>
        ) : null}
        {open ? (
          <QueryBoundary query={tokens}>
            {(list) => list.length === 0 ? <p className="text-sm text-text-muted">Aucun jeton pour l'instant.</p> : (
              <TableWrap>
                <Table dense>
                  <caption className="sr-only">Jetons d'extension ({active} actif{active > 1 ? "s" : ""})</caption>
                  <thead><tr><Th>Nom</Th><Th>Préfixe</Th><Th>Statut</Th><Th className="hide-mobile">Dernier usage</Th><Th className="hide-mobile">Expire</Th><Th className="text-right">Actions</Th></tr></thead>
                  <tbody>{list.map((t) => <Tr key={t.id}><Td className="font-medium">{t.label}</Td><Td className="font-mono text-xs">{t.prefix}…</Td><Td>{t.revokedAt ? <StatusBadge tone="muted">Révoqué</StatusBadge> : new Date(t.expiresAt) < new Date() ? <StatusBadge tone="danger">Expiré</StatusBadge> : <StatusBadge tone="success">Actif</StatusBadge>}</Td><Td className="hide-mobile text-text-muted">{t.lastUsedAt ? formatRelative(t.lastUsedAt) : "jamais"}</Td><Td className="hide-mobile text-text-muted">{formatDateTime(t.expiresAt)}</Td><Td className="text-right">{canTokens && !t.revokedAt ? <Button size="sm" variant="danger" onClick={() => setRevoking(t)}>Révoquer</Button> : null}</Td></Tr>)}</tbody>
                </Table>
              </TableWrap>
            )}
          </QueryBoundary>
        ) : null}
      </div>
    </details>
      <Dialog open={issued !== null} onClose={() => setIssued(null)} title="Jeton créé" description="Copiez ce secret maintenant : il ne sera plus affiché." size="sm" footer={<Button onClick={() => setIssued(null)}>J'ai copié le jeton</Button>}>
        {issued ? (
          <div className="flex flex-col gap-2">
            <code className="block rounded-md bg-surface-muted p-3 font-mono text-xs break-all select-all">{issued.secret}</code>
            <Button variant="secondary" size="sm" icon={<Copy />} onClick={() => { void navigator.clipboard?.writeText(issued.secret); toast({ tone: "success", title: "Jeton copié" }); }}>Copier</Button>
            <p className="text-xs text-text-muted">Collez-le dans la page Options de l'extension Selio. Portées : {issued.token.scopes.join(", ")}.</p>
            <Tag>Expire le {formatDateTime(issued.token.expiresAt)}</Tag>
          </div>
        ) : null}
      </Dialog>
      <ConfirmDialog open={revoking !== null} onClose={() => setRevoking(null)} onConfirm={() => revoking && revoke.mutate(revoking.id)} loading={revoke.isPending} danger title={`Révoquer « ${revoking?.label} » ?`} description="L'extension associée perd immédiatement l'accès. Créez un nouveau jeton pour la relier à nouveau." confirmLabel="Révoquer" />
    </>
  );
}
