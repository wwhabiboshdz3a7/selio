import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Clock, UserPlus } from "lucide-react";
import { AGENCY_CLIENT_KIND_LABELS, AGENCY_CLIENT_STATUS_LABELS, AGENCY_EXAMPLE_CLIENTS, type AgencyClientStatus } from "@selio/demo-data";
import { Button, Card, PageHeader, StatusBadge, Table, TableWrap, Tag, Td, Th, Tr, cn, formatCents, formatNumber } from "@selio/ui";
import { useClient, useRequiredSession } from "../../../lib/data/provider";
import { ScoreRing } from "../../../components/charts";
import { ExampleTag, PreviewNotice } from "../components";

type Tone = "success" | "accent" | "neutral";
const STATUS_TONE: Record<AgencyClientStatus, Tone> = { active: "success", onboarding: "accent", invited: "neutral" };

interface ClientRow {
  id: string;
  /** Votre boutique (données réelles) ; sinon un exemple fictif. */
  own: boolean;
  name: string;
  sub: string;
  figures: [label: string, value: string][];
  score: number | null;
  status: { label: string; tone: Tone };
}

const PLANNED = [
  { t: "Inviter une boutique cliente", d: "Le client garde la main sur ses comptes Vinted ; l'agence travaille pour lui." },
  { t: "Ouvrir la boutique d'un client en un clic", d: "Son stock, ses messages et ses ventes, avec vos règles de négociation." },
  { t: "Rapport mensuel par client", d: "Ventes, marge et note du dressing, à vos couleurs." },
];

export default function AgencyClients() {
  const client = useClient();
  const session = useRequiredSession();
  const overview = useQuery({ queryKey: ["overview", "month"], queryFn: () => client.getOverview("month") });
  const connections = useQuery({ queryKey: ["connections"], queryFn: () => client.listConnections() });
  const ownAccounts = connections.data?.filter((c) => c.provider === "vinted" && c.usage !== "personal").length;
  const o = overview.data;
  const dash = "—";
  // Votre boutique (vos données du mois), puis les boutiques d'exemple fictives.
  const rows: ClientRow[] = [
    {
      id: "own", own: true, name: session.org.name, sub: "Votre boutique",
      figures: [
        ["Comptes", ownAccounts !== undefined ? formatNumber(ownAccounts) : dash],
        ["En ligne", o ? formatNumber(o.stock.listedCount) : dash],
        ["Ventes", o ? formatNumber(o.sales.orderCount) : dash],
        ["CA du mois", o ? formatCents(o.sales.revenueCents) : dash],
        ["Marge brute", o ? formatCents(o.sales.marginCents) : dash],
      ],
      score: o && o.dressing.listed > 0 ? o.dressing.averageScore : null,
      status: { label: "Suivie", tone: "success" },
    },
    ...AGENCY_EXAMPLE_CLIENTS.map((c): ClientRow => ({
      id: c.id, own: false, name: c.name, sub: `${AGENCY_CLIENT_KIND_LABELS[c.kind]} · ${c.city}`,
      figures: [
        ["Comptes", formatNumber(c.accounts)],
        ["En ligne", formatNumber(c.listed)],
        ["Ventes", formatNumber(c.salesThisMonth)],
        ["CA du mois", formatCents(c.revenueCents)],
        ["Marge brute", formatCents(c.marginCents)],
      ],
      score: c.averageScore > 0 ? c.averageScore : null,
      status: { label: AGENCY_CLIENT_STATUS_LABELS[c.status], tone: STATUS_TONE[c.status] },
    })),
  ];

  return (
    <>
      <PageHeader
        eyebrow="Selio Agents · Aperçu"
        title="Clients"
        description="Les boutiques que votre agence suit : comptes Vinted gérés, annonces en ligne, ventes du mois et note du dressing. Votre boutique est réelle ; les autres lignes sont des exemples fictifs pour montrer l'écran."
        actions={<Button variant="secondary" icon={<UserPlus />} disabled title="Aperçu : l'invitation de boutiques clientes n'est pas encore ouverte">Inviter une boutique</Button>}
      />
      <PreviewNotice space="agents">Aucune boutique cliente n'est reliée et rien n'est facturé. Les chiffres marqués « Exemple fictif » sont inventés pour l'illustration.</PreviewNotice>

      {/* Mobile : une carte par boutique (pas de tableau à faire défiler de côté). */}
      <ul className="flex flex-col gap-3 md:hidden" aria-label="Boutiques suivies">
        {rows.map((r) => (
          <li key={r.id} className={cn("card p-4", r.own && "bg-accent-soft/40")}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-text">{r.name}</p>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">{r.own ? <Tag accent>Vos données</Tag> : <ExampleTag />}{r.sub}</p>
                <p className="mt-2"><StatusBadge tone={r.status.tone}>{r.status.label}</StatusBadge></p>
              </div>
              {r.score !== null ? <ScoreRing score={r.score} size={38} stroke={3} scale="listing" label="Note moyenne du dressing" /> : null}
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2.5 border-t border-border pt-3">
              {r.figures.map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-[11px] text-text-muted">{label}</dt>
                  <dd className="num truncate text-sm font-medium text-text">{value}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>

      <TableWrap className="hidden md:block">
        <Table className="min-w-[820px]">
          <thead>
            <tr>
              <Th>Boutique</Th>
              {rows[0]!.figures.map(([label]) => <Th key={label} numeric className="whitespace-nowrap">{label}</Th>)}
              <Th className="text-center">Dressing</Th>
              <Th>Statut</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.id} className={cn(r.own && "bg-accent-soft/40")}>
                <Td>
                  <span className="block font-medium text-text">{r.name}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs whitespace-nowrap text-text-muted">{r.own ? <Tag accent>Vos données</Tag> : <ExampleTag />}{r.sub}</span>
                </Td>
                {r.figures.map(([label, value]) => <Td key={label} numeric>{value}</Td>)}
                <Td className="text-center">{r.score !== null ? <ScoreRing score={r.score} size={34} stroke={3} scale="listing" label="Note moyenne du dressing" className="mx-auto" /> : "—"}</Td>
                <Td><StatusBadge tone={r.status.tone}>{r.status.label}</StatusBadge></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
      <p className="mt-2 text-xs text-text-muted">Votre ligne est calculée depuis vos données de ce mois-ci. Les autres boutiques n'existent pas.</p>

      <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <h2 className="text-md font-semibold text-text">Ce que l'agence pourra faire</h2>
          <ul className="mt-4 flex flex-col gap-3">
            {PLANNED.map((p) => (
              <li key={p.t} className="flex items-start gap-3">
                <Clock className="mt-0.5 size-4 shrink-0 text-text-subtle" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text">{p.t} <Tag className="ml-1">En préparation</Tag></p>
                  <p className="text-sm text-text-muted">{p.d}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="flex flex-col gap-3">
          <h2 className="text-md font-semibold text-text">Déjà prêt dans cet aperçu</h2>
          <p className="text-sm text-text-muted">La marque blanche : le nom, le logo texte et la couleur de l'outil de votre agence, avec l'aperçu en direct.</p>
          <Link to="/agents/marque-blanche" className="text-sm font-medium text-accent hover:underline">Personnaliser la marque blanche →</Link>
          <Link to="/agents" className="text-sm font-medium text-accent hover:underline">Équipe et accès →</Link>
        </Card>
      </div>
    </>
  );
}
