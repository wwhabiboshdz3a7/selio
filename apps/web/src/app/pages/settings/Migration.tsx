import { useState } from "react";
import { Link } from "react-router";
import { FileUp, ImagePlus, ShieldCheck, Trash2, Wand2 } from "lucide-react";
import { MIGRATION_MAX_SCREENSHOTS, MIGRATION_MAX_TEXT_CHARS, MIGRATION_SOURCES, MIGRATION_SOURCE_LABELS, type MigrationField, type MigrationSource, type MigrationTarget } from "@selio/contracts";
import { MIGRATION_FORBIDDEN_NOTE, can, catalogEntry, coerceTargetValue, isMigrationTarget } from "@selio/domain";
import { Alert, Button, Card, Checkbox, IconButton, Segmented, Select, StatusBadge, Table, TableWrap, Td, Textarea, Th, Tr, formatCents } from "@selio/ui";
import { useClient, useRequiredSession } from "../../../lib/data/provider";
import type { MigrationApplyView, MigrationConversion } from "../../../lib/data/types";
import { reducePhoto } from "../../../lib/track";
import { useAppMutation } from "../../components/hooks";

type InputKind = "text" | "screenshot" | "rgpd_file";

/** Confiance affichée : en pourcentage et en toutes lettres (la couleur n'est jamais le seul signal). */
export function confidenceLabel(c: number): { label: string; tone: "success" | "warning" | "danger" } {
  if (c >= 0.8) return { label: "élevée", tone: "success" };
  if (c >= 0.6) return { label: "moyenne", tone: "warning" };
  return { label: "faible", tone: "danger" };
}

const TONE_LABELS: Record<string, string> = { neutral: "Neutre", friendly: "Chaleureux", concise: "Concis" };
const pct = (r: number) => `${Math.round(r * 1000) / 10} %`.replace(".", ",");

/** Valeur Selio lisible (taux en %, montants en €, oui / non, plage horaire…). */
export function targetValueLabel(target: MigrationTarget | null, f: Pick<MigrationField, "targetValue" | "sourceValue">): string {
  if (!target || !isMigrationTarget(target)) return "—";
  const kind = catalogEntry(target).kind;
  const c = coerceTargetValue(target, f.targetValue ?? f.sourceValue);
  if (!c.ok) return `Illisible (${c.reason})`;
  const v = c.value;
  if (kind === "rate" && typeof v === "number") return pct(v);
  if (kind === "cents" && typeof v === "number") return formatCents(v);
  if (kind === "bool") return v ? "Oui" : "Non";
  if (kind === "hours" && typeof v === "number") return `${v} h`;
  if (kind === "hour" && typeof v === "number") return `${v} h`;
  if (kind === "minutes" && typeof v === "number") return `${v} min`;
  if (kind === "days" && typeof v === "number") return `${v} j`;
  if (kind === "tone" && typeof v === "string") return TONE_LABELS[v] ?? v;
  return String(v);
}

/**
 * Paramètres › Migration (§5.13) : vous venez de Bleam, de Clemz ou d'un autre outil ? Collez vos réglages,
 * ajoutez des captures d'écran, ou importez le fichier obtenu au titre de la portabilité RGPD : mon IA perso
 * propose une correspondance « ancien → nouveau », vous cochez ce qui doit être repris. Selio ne demande
 * aucun identifiant et ne se connecte jamais à un autre outil à votre place.
 */
export default function Migration() {
  const client = useClient();
  const session = useRequiredSession();
  const editable = can(session.role, "org.update");
  const [kind, setKind] = useState<InputKind>("text");
  const [source, setSource] = useState<MigrationSource | "">("");
  const [text, setText] = useState("");
  const [shots, setShots] = useState<{ name: string; dataUrl: string }[]>([]);
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [result, setResult] = useState<MigrationConversion | null>(null);
  const [applied, setApplied] = useState<MigrationApplyView | null>(null);
  const declaredSource = source === "" ? null : source;

  const convert = useAppMutation(async () => {
    if (kind === "rgpd_file") {
      if (!file) throw new Error("Choisissez le fichier obtenu de l'autre outil.");
      return client.importMigrationFile({ fileName: file.name, content: file.content, declaredSource });
    }
    return client.convertMigration(kind === "text" ? { text, declaredSource } : { screenshots: shots.map((s) => s.dataUrl), declaredSource });
  }, { invalidate: ["usage", "ai-requests"], onSuccess: (r) => { setResult(r); setApplied(null); } });

  const addShots = async (files: FileList | null) => {
    setLocalError(null);
    if (!files) return;
    const list = [...files].slice(0, Math.max(0, MIGRATION_MAX_SCREENSHOTS - shots.length));
    if (files.length > list.length) setLocalError(`${MIGRATION_MAX_SCREENSHOTS} captures au plus par conversion.`);
    try {
      const reduced = await Promise.all(list.map(async (f) => ({ name: f.name, dataUrl: (await reducePhoto(f, 1600)).dataUrl })));
      setShots((s) => [...s, ...reduced].slice(0, MIGRATION_MAX_SCREENSHOTS));
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Capture illisible.");
    }
  };
  const readFile = async (files: FileList | null) => {
    setLocalError(null);
    const f = files?.[0];
    if (!f) return;
    if (f.size > 2_000_000) return setLocalError("Fichier trop lourd (2 Mo au plus).");
    setFile({ name: f.name, content: await f.text() });
  };
  const ready = kind === "text" ? text.trim().length > 0 : kind === "screenshot" ? shots.length > 0 : file !== null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-text">Migration depuis un autre outil</h2>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">Vous venez de Bleam, de Clemz ou d'un autre outil ? Reprenez vos réglages en quelques minutes : mon IA perso propose une correspondance, vous validez champ par champ.</p>
      </div>
      <section aria-label="Ce que la migration ne fait jamais" className="flex items-start gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-text-muted" aria-hidden />
        <div>
          <p className="font-medium text-text">Aucun identifiant demandé</p>
          <p className="mt-0.5 text-text-muted">{MIGRATION_FORBIDDEN_NOTE}</p>
          <p className="mt-1 text-text-muted">Si un mot de passe ou une adresse apparaît dans ce que vous collez, il est ignoré : n'en collez pas.</p>
        </div>
      </section>

      {!editable ? <Alert tone="info" title="Consultation">Seuls le propriétaire et les administrateurs importent des réglages.</Alert> : (
        <Card>
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)] sm:items-end">
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-semibold text-text">Ce que vous avez</span>
                <Segmented ariaLabel="Type d'import" value={kind} onChange={(v) => { setKind(v); setLocalError(null); }} items={[{ value: "text", label: "Texte collé" }, { value: "screenshot", label: "Captures d'écran" }, { value: "rgpd_file", label: "Fichier RGPD" }]} />
              </div>
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-text">
                Outil d'origine (facultatif)
                <Select value={source} onChange={(e) => setSource(e.target.value as MigrationSource | "")} aria-label="Outil d'origine">
                  <option value="">Je ne précise pas</option>
                  {MIGRATION_SOURCES.filter((s) => s !== "unknown").map((s) => <option key={s} value={s}>{MIGRATION_SOURCE_LABELS[s]}</option>)}
                </Select>
              </label>
            </div>

            {kind === "text" ? (
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-text">
                Vos réglages, copiés depuis l'autre outil
                <Textarea rows={8} maxLength={MIGRATION_MAX_TEXT_CHARS} value={text} onChange={(e) => setText(e.target.value)} className="font-normal" placeholder={"Remise max : 20 %\nMarge minimum : 5 €\nHoraires : 9h-21h\nMessage d'accueil : Bonjour {prenom} !"} />
                <span className="num text-xs font-normal text-text-muted">{text.length.toLocaleString("fr-FR")} / {MIGRATION_MAX_TEXT_CHARS.toLocaleString("fr-FR")} caractères · une ligne « libellé : valeur » par réglage, c'est le plus fiable.</span>
              </label>
            ) : null}

            {kind === "screenshot" ? (
              <div className="flex flex-col gap-2">
                <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-text hover:bg-surface-muted">
                  <ImagePlus className="size-4 text-text-muted" aria-hidden />Ajouter des captures ({shots.length}/{MIGRATION_MAX_SCREENSHOTS})
                  <input type="file" accept="image/png,image/jpeg,image/webp" multiple className="sr-only" aria-label="Captures d'écran des réglages" disabled={shots.length >= MIGRATION_MAX_SCREENSHOTS} onChange={(e) => { void addShots(e.target.files); e.target.value = ""; }} />
                </label>
                <p className="text-xs text-text-muted">Captures de vos écrans de réglages, réduites dans votre navigateur avant l'envoi. Mon IA perso (modèle de vision) lit seulement les libellés et les valeurs visibles ; vous vérifiez chaque valeur.</p>
                {shots.length ? (
                  <ul className="flex flex-wrap gap-2" aria-label="Captures ajoutées">
                    {shots.map((s, i) => (
                      <li key={`${s.name}-${i}`} className="relative">
                        <img src={s.dataUrl} alt={`Capture ${i + 1}`} className="size-20 rounded-md border border-border object-cover" />
                        <IconButton label={`Retirer la capture ${i + 1}`} size="sm" className="absolute -top-2 -right-2 bg-surface shadow-sm" onClick={() => setShots((x) => x.filter((_, j) => j !== i))}><Trash2 /></IconButton>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {kind === "rgpd_file" ? (
              <div className="flex flex-col gap-2">
                <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-text hover:bg-surface-muted">
                  <FileUp className="size-4 text-text-muted" aria-hidden />{file ? file.name : "Choisir le fichier"}
                  <input type="file" accept=".json,.csv,.txt,application/json,text/csv,text/plain" className="sr-only" aria-label="Fichier obtenu au titre de la portabilité RGPD" onChange={(e) => { void readFile(e.target.files); e.target.value = ""; }} />
                </label>
                <p className="text-xs text-text-muted">Le fichier que l'autre outil vous remet quand vous lui demandez vos données (droit à la portabilité, RGPD article 20). JSON, CSV ou texte ; il est lu dans votre navigateur puis converti, sans jamais contacter cet outil.</p>
              </div>
            ) : null}

            {localError ? <p role="alert" className="text-sm text-danger">{localError}</p> : null}
            <div><Button icon={<Wand2 />} onClick={() => convert.mutate(undefined)} loading={convert.isPending} disabled={!ready}>Convertir mes réglages</Button></div>
          </div>
        </Card>
      )}

      {result ? <MappingReview conversion={result} disabled={!editable} onApplied={setApplied} /> : null}
      {applied ? <AppliedSummary result={applied} /> : null}
    </div>
  );
}

/**
 * Écran « ancien → nouveau » : chaque champ proposé avec sa confiance, une case à cocher (cochée d'office
 * seulement quand la confiance est élevée), les réglages inconnus et ceux écartés par la vérification.
 * Rien n'est appliqué sans « Appliquer ».
 */
export function MappingReview({ conversion, disabled = false, onApplied }: { conversion: MigrationConversion; disabled?: boolean; onApplied: (r: MigrationApplyView) => void }) {
  const client = useClient();
  const { mapping } = conversion;
  const [accepted, setAccepted] = useState<Set<string>>(() => new Set(mapping.fields.filter((f) => f.confidence >= 0.8).map((f) => f.id)));
  // La correspondance appliquée est celle enregistrée par la conversion (`mappingId`) : le serveur la marque appliquée.
  const apply = useAppMutation(() => client.applyMigration({ mappingId: conversion.id, mapping, acceptedFieldIds: [...accepted] }), { invalidate: ["session", "rules"], success: (r) => `${r.applied.length} réglage(s) appliqué(s)`, onSuccess: onApplied });
  const toggle = (id: string, on: boolean) => setAccepted((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  return (
    <Card padding="none" role="region" aria-label="Correspondance ancien → nouveau">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 md:px-5">
        <div>
          <h3 className="text-md font-semibold text-text">Ancien → nouveau</h3>
          <p className="text-sm text-text-muted">{MIGRATION_SOURCE_LABELS[mapping.source]} · {mapping.fields.length} réglage(s) reconnu(s), {mapping.unknownFields.length} inconnu(s){conversion.via === "file" ? " · lu depuis votre fichier" : " · proposé par mon IA perso"}. Cochez ce qui doit être repris.</p>
        </div>
        {mapping.fields.length ? (
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAccepted(new Set(mapping.fields.map((f) => f.id)))} disabled={disabled}>Tout cocher</Button>
            <Button size="sm" variant="ghost" onClick={() => setAccepted(new Set())} disabled={disabled}>Tout décocher</Button>
          </div>
        ) : null}
      </div>
      {mapping.fields.length === 0 ? <p className="px-4 py-4 text-sm text-text-muted md:px-5">Aucun réglage reconnu. Essayez de coller vos réglages ligne par ligne (« libellé : valeur »).</p> : (
        <TableWrap className="mt-3 rounded-none border-0 border-t">
          <Table dense>
            <thead><tr><Th className="w-10"><span className="sr-only">Reprendre</span></Th><Th>Ancien réglage</Th><Th>Nouveau dans Selio</Th><Th>Confiance</Th></tr></thead>
            <tbody>
              {mapping.fields.map((f) => {
                const target = f.target && isMigrationTarget(f.target) ? f.target : null;
                const conf = confidenceLabel(f.confidence);
                return (
                  <Tr key={f.id}>
                    <Td><Checkbox aria-label={`Reprendre « ${f.sourceLabel} »`} checked={accepted.has(f.id)} disabled={disabled || !target} onChange={(e) => toggle(f.id, e.target.checked)} /></Td>
                    <Td><span className="block font-medium text-text">{f.sourceLabel}</span><span className="block max-w-xs truncate text-text-muted" title={f.sourceValue}>{f.sourceValue}</span></Td>
                    <Td><span className="block font-medium text-text">{target ? catalogEntry(target).label : "—"}</span><span className="block max-w-xs truncate text-text-muted">{targetValueLabel(target, f)}</span>{f.note ? <span className="block text-xs text-text-muted">{f.note}</span> : null}</Td>
                    <Td><StatusBadge tone={conf.tone}><span className="num">{Math.round(f.confidence * 100)} %</span> · {conf.label}</StatusBadge></Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      )}
      {mapping.unknownFields.length ? (
        <section className="border-t border-border px-4 py-3 md:px-5" aria-label="Réglages inconnus">
          <h4 className="text-sm font-semibold text-text">Inconnus : aucun équivalent dans Selio</h4>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm">
            {mapping.unknownFields.map((u, i) => <li key={`${u.sourceLabel}-${i}`} className="flex flex-wrap items-baseline gap-2"><StatusBadge tone="muted">Inconnu</StatusBadge><span className="font-medium text-text">{u.sourceLabel}</span>{u.note ? <span className="text-text-muted">{u.note}</span> : null}</li>)}
          </ul>
          <p className="mt-2 text-xs text-text-muted">Rien n'est appliqué pour ces réglages ; réglez-les à la main si besoin.</p>
        </section>
      ) : null}
      {conversion.rejected.length ? (
        <section className="border-t border-border px-4 py-3 md:px-5" aria-label="Écartés par la vérification">
          <h4 className="text-sm font-semibold text-text">Écartés par la vérification</h4>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-text-muted">{conversion.rejected.map((r, i) => <li key={i}><span className="font-medium text-text">{r.sourceLabel}</span> : {r.reason}</li>)}</ul>
        </section>
      ) : null}
      {mapping.warnings.length ? <ul className="flex flex-col gap-1 border-t border-border px-4 py-3 text-xs text-text-muted md:px-5">{mapping.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul> : null}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 md:px-5">
        <p className="text-sm text-text-muted"><span className="num font-semibold text-text">{accepted.size}</span> réglage(s) coché(s) sur {mapping.fields.length}.</p>
        <Button onClick={() => apply.mutate(undefined)} loading={apply.isPending} disabled={disabled || accepted.size === 0}>Appliquer {accepted.size} réglage(s)</Button>
      </div>
    </Card>
  );
}

function AppliedSummary({ result }: { result: MigrationApplyView }) {
  return (
    <Alert tone="success" title={`${result.applied.length} réglage(s) appliqué(s)`}>
      {result.skipped.length ? <ul className="mt-1 list-disc pl-5">{result.skipped.map((s) => <li key={s.id}>Non appliqué : {s.reason}</li>)}</ul> : null}
      {result.rulesUpdated.includes("follow_up_no_reply") ? <p className="mt-1">La relance importée est enregistrée dans une règle d'automatisation, arrêtée : activez-la dans les <Link to="/app/automations" className="font-medium text-accent hover:underline">automatisations</Link>.</p> : null}
      <p className="mt-1">Vérifiez le résultat dans la <Link to="/app/automatisation/negociation" className="font-medium text-accent hover:underline">négociation automatique</Link> et la <Link to="/app/automatisation/reponse" className="font-medium text-accent hover:underline">réponse automatique</Link>.</p>
    </Alert>
  );
}
