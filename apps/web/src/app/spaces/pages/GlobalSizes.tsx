import { useState } from "react";
import { ArrowRightLeft } from "lucide-react";
import { Card, Field, PageHeader, Segmented, Select, Table, TableWrap, Td, Th, cn } from "@selio/ui";
import { SIZE_CHARTS, convertSize, type SizeChartId } from "../global-data";

export default function GlobalSizes() {
  const [chartId, setChartId] = useState<SizeChartId>("women");
  const chart = SIZE_CHARTS.find((c) => c.id === chartId)!;
  const [system, setSystem] = useState(chart.systems[0]!.key);
  const [value, setValue] = useState(chart.rows[2]?.[chart.systems[0]!.key] ?? "");
  const pickChart = (id: SizeChartId) => {
    const next = SIZE_CHARTS.find((c) => c.id === id)!;
    setChartId(id);
    setSystem(next.systems[0]!.key);
    setValue(next.rows[2]?.[next.systems[0]!.key] ?? "");
  };
  const pickSystem = (s: string) => {
    // On garde la même ligne : la taille choisie est simplement relue dans l'autre système.
    const row = convertSize(chart, system, value);
    setSystem(s);
    setValue(row?.[s] ?? chart.rows[0]![s]!);
  };
  const row = convertSize(chart, system, value);
  const systemLabel = (k: string) => chart.systems.find((s) => s.key === k)?.label ?? k;

  return (
    <>
      <PageHeader
        eyebrow="Selio Global · Utilisable dès maintenant"
        title="Convertisseur de tailles"
        description="Pour décrire une pièce achetée à l'étranger ou répondre à un acheteur : retrouvez l'équivalent d'une taille en FR, UK, US, IT ou DE."
      />

      <Card className="mb-6">
        <Segmented ariaLabel="Type de pièce" value={chartId} onChange={pickChart} items={SIZE_CHARTS.map((c) => ({ value: c.id, label: c.label }))} className="mb-5 flex-wrap" />
        <div className="grid gap-4 sm:grid-cols-2 lg:max-w-xl">
          <Field label="Système de la taille">
            {(p) => <Select id={p.id} value={system} onChange={(e) => pickSystem(e.target.value)}>{chart.systems.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</Select>}
          </Field>
          <Field label="Taille">
            {(p) => <Select id={p.id} value={value} onChange={(e) => setValue(e.target.value)}>{chart.rows.map((r) => <option key={r[system]} value={r[system]}>{r[system]}</option>)}</Select>}
          </Field>
        </div>
        {row ? (
          <div className="mt-5" aria-live="polite">
            <p className="mb-2 flex items-center gap-1.5 text-sm text-text-muted"><ArrowRightLeft className="size-4" aria-hidden /> {systemLabel(system)} {value} correspond à :</p>
            <ul className="flex flex-wrap gap-px overflow-hidden rounded-lg border border-border bg-border">
              {chart.systems.filter((s) => s.key !== system).map((s) => (
                <li key={s.key} className="min-w-28 flex-1 bg-surface p-3">
                  <p className="text-xs text-text-muted">{s.label}</p>
                  <p className="num mt-0.5 text-xl font-semibold text-text">{row[s.key]}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      <TableWrap>
        <Table dense className="min-w-[420px]">
          <caption className="sr-only">Table de correspondance — {chart.label}</caption>
          <thead>
            <tr>{chart.systems.map((s) => <Th key={s.key} className={cn(s.key === system && "text-text")}>{s.label}</Th>)}</tr>
          </thead>
          <tbody>
            {chart.rows.map((r) => {
              const on = r[system] === value;
              return (
                <tr key={r[chart.systems[0]!.key]} className={cn("border-t border-border", on && "bg-accent-soft")} aria-current={on ? "true" : undefined}>
                  {chart.systems.map((s) => <Td key={s.key} className={cn("num", on && "font-semibold")}>{r[s.key]}</Td>)}
                </tr>
              );
            })}
          </tbody>
        </Table>
      </TableWrap>
      <p className="mt-3 text-xs text-text-muted">{chart.note} Correspondances usuelles : elles varient selon les marques — en cas de doute, vérifiez le guide des tailles de la marque.</p>
    </>
  );
}
