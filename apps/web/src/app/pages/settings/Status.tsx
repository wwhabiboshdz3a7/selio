import { useQuery } from "@tanstack/react-query";
import { Button, Card, StatusBadge, formatDateTime } from "@selio/ui";
import { useClient } from "../../../lib/data/provider";
import { QueryBoundary } from "../../components/common";
import { appVersion } from "../../../lib/env";

export default function Status() {
  const client = useClient();
  const q = useQuery({ queryKey: ["service-status"], queryFn: () => client.getServiceStatus(), refetchInterval: 30_000 });
  return (
    <Card>
      <div className="flex items-center justify-between"><h2 className="text-md font-semibold">Statut des services</h2><Button size="sm" variant="secondary" onClick={() => void q.refetch()} loading={q.isFetching}>Actualiser</Button></div>
      <p className="text-xs text-text-muted">Application web v{appVersion}</p>
      <QueryBoundary query={q}>
        {(list) => (
          <ul className="mt-4 divide-y divide-border">
            {list.map((s) => (
              <li key={s.name} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <span className="min-w-0"><span className="block font-medium">{s.name}</span><span className="block text-xs text-text-muted">{s.message}</span></span>
                <span className="flex items-center gap-2 text-xs text-text-muted">{s.latencyMs !== null ? <span className="num">{s.latencyMs} ms</span> : null}<span>{formatDateTime(s.checkedAt)}</span><StatusBadge tone={s.ok ? (s.status === "simulated" ? "accent" : "success") : s.status === "experimental" ? "warning" : "danger"}>{s.status}</StatusBadge></span>
              </li>
            ))}
          </ul>
        )}
      </QueryBoundary>
    </Card>
  );
}
