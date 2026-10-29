import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, ListChecks } from "lucide-react";
import { CLOUD_ACTION_KINDS, CLOUD_ACTION_KIND_LABELS, CLOUD_ACTION_STATUSES, CLOUD_ACTION_STATUS_LABELS, CLOUD_JOURNAL_RETENTION_DAYS, type CloudActionKind, type CloudActionStatus } from "@selio/contracts";
import { Button, EmptyState, ErrorState, Field, PageHeader, Pagination, Select, SkeletonRows, Table, TableWrap, Td, Th, Tr, formatDateTime, useToast } from "@selio/ui";
import { useClient } from "../../../lib/data/provider";
import { downloadFile } from "../../../lib/download";
import { errorMessage } from "../../../lib/errors";
import type { CloudJournalFilters } from "../../../lib/data/types";
import { CloudActionStatusBadge, CloudFootnote, actionDuration, actionResult, useCloudAccounts } from "../cloud/shared";

export const JOURNAL_PAGE_SIZE = 10;

/** Journal des actions Cloud : paginé, filtré par compte, type et statut, exportable en CSV, gardé 90 jours. */
export default function CloudJournal() {
  const client = useClient();
  const { toast } = useToast();
  const accounts = useCloudAccounts();
  const [filters, setFilters] = useState<Omit<CloudJournalFilters, "page" | "pageSize">>({});
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const query = { ...filters, page, pageSize: JOURNAL_PAGE_SIZE };
  const journal = useQuery({ queryKey: ["cloud-journal", query], queryFn: () => client.cloudJournal(query) });
  const labels = new Map((accounts.data ?? []).map((a) => [a.id, a.connectionLabel]));
  const filtered = Boolean(filters.accountId || filters.kind || filters.status);

  const setFilter = <K extends keyof typeof filters>(key: K, value: (typeof filters)[K] | "") => {
    setFilters((f) => ({ ...f, [key]: value || undefined }));
    setPage(1);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const csv = await client.exportCloudJournalCsv(filters);
      downloadFile(`selio-cloud-journal-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      toast({ tone: "success", title: "Journal exporté (CSV)" });
    } catch (e) {
      toast({ tone: "danger", title: "Export impossible", description: errorMessage(e) });
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Selio Cloud"
        title="Journal des actions"
        description="Chaque action qui ouvre un navigateur, ou qui est écartée, est inscrite ici : sans texte de message ni donnée de session."
        actions={<Button variant="secondary" icon={<Download />} onClick={() => void exportCsv()} loading={exporting}>Exporter CSV</Button>}
      />
      <p className="mb-4 text-sm text-text-muted" data-testid="cloud-journal-retention">Conservé {CLOUD_JOURNAL_RETENTION_DAYS} jours, puis effacé automatiquement.</p>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Field label="Compte">
          {({ id }) => (
            <Select id={id} value={filters.accountId ?? ""} onChange={(e) => setFilter("accountId", e.target.value)}>
              <option value="">Tous les comptes</option>
              {(accounts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.connectionLabel}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Type">
          {({ id }) => (
            <Select id={id} value={filters.kind ?? ""} onChange={(e) => setFilter("kind", e.target.value as CloudActionKind | "")}>
              <option value="">Tous les types</option>
              {CLOUD_ACTION_KINDS.map((k) => <option key={k} value={k}>{CLOUD_ACTION_KIND_LABELS[k]}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Statut">
          {({ id }) => (
            <Select id={id} value={filters.status ?? ""} onChange={(e) => setFilter("status", e.target.value as CloudActionStatus | "")}>
              <option value="">Tous les statuts</option>
              {CLOUD_ACTION_STATUSES.map((s) => <option key={s} value={s}>{CLOUD_ACTION_STATUS_LABELS[s]}</option>)}
            </Select>
          )}
        </Field>
      </div>

      {journal.isPending ? <SkeletonRows rows={5} /> : journal.isError ? <ErrorState description={errorMessage(journal.error)} onRetry={() => void journal.refetch()} /> : journal.data.total === 0 ? (
        <EmptyState
          icon={<ListChecks />}
          title={filtered ? "Aucune action ne correspond à ces filtres" : "Aucune action pour l'instant"}
          description={filtered ? "Élargissez la recherche : un autre compte, un autre type ou un autre statut." : "Dès qu'un compte est actif, chaque action du Cloud est inscrite ici."}
          action={filtered ? <Button variant="secondary" size="sm" onClick={() => { setFilters({}); setPage(1); }}>Effacer les filtres</Button> : undefined}
        />
      ) : (
        <>
          <TableWrap>
            <Table aria-label="Journal des actions Cloud">
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Compte</Th>
                  <Th>Action</Th>
                  <Th>Statut</Th>
                  <Th>Résultat</Th>
                  <Th numeric>Durée</Th>
                </tr>
              </thead>
              <tbody>
                {journal.data.items.map((a) => (
                  <Tr key={a.id}>
                    <Td className="num whitespace-nowrap text-text-muted">{formatDateTime(a.createdAt)}</Td>
                    <Td className="max-w-40 truncate">{labels.get(a.accountId) ?? "Compte supprimé"}</Td>
                    <Td className="whitespace-nowrap">{CLOUD_ACTION_KIND_LABELS[a.kind]}</Td>
                    <Td><CloudActionStatusBadge status={a.status} /></Td>
                    <Td className="min-w-56 py-2 text-text-muted">{actionResult(a)}{a.detail.sideEffects === "unknown" ? <span className="block text-xs">Rien n'est renvoyé automatiquement.</span> : null}</Td>
                    <Td numeric className="whitespace-nowrap text-text-muted">{actionDuration(a)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
          <Pagination className="mt-3" page={journal.data.page} pageCount={journal.data.pageCount} total={journal.data.total} pageSize={journal.data.pageSize} onPageChange={setPage} />
        </>
      )}
      <CloudFootnote />
    </>
  );
}
