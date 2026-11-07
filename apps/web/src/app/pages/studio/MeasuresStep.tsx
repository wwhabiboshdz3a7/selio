import { useState, type ReactNode } from "react";
import { ArrowLeft, Check, Sparkles } from "lucide-react";
import { GARMENT_KINDS, GARMENT_KIND_LABELS, MEASUREMENT_HOWTO, MEASUREMENT_LABELS, MEASUREMENT_NAMES, type GarmentKind, type MeasurementName, type NamedMeasurementField } from "@selio/contracts";
import { Alert, Button, Card, Checkbox, Field, Input, Select } from "@selio/ui";
import { measurementQuestion, type UiArticle } from "../../../lib/studio/flow";
import { cmInputValue, expectedFor, measurementRows, needsExplicitConfirmation, parseCm, pendingConfirmations, type PrepEdits } from "../../../lib/studio/prep";
import { AccuracyNote, ProvenanceBadge, QuestionNote } from "./shared";

/** Valeur affichée d'une mesure et sa provenance : saisie en cours (« vous »), lue ou retrouvée, ou vide. */
export function measurementDisplay(m: NamedMeasurementField, edits: PrepEdits) {
  const typed = edits.measurements[m.name];
  const parsed = typed === undefined ? m.valueCm : parseCm(typed);
  const edited = typed !== undefined && parsed !== m.valueCm;
  const cleared = edited && parsed === null;
  return { value: typed ?? cmInputValue(m.valueCm), edited, cleared, invalid: parsed === "invalid" };
}

/**
 * Mesures : chacune avec sa provenance (mètre ruban photographié, base des références par la référence,
 * vous) ou vide avec la question au vendeur. Aucune valeur par défaut, aucune estimation « à l'œil ».
 * Une lecture du ruban peu sûre (0,5 à 0,7) ou en désaccord avec une autre source se confirme explicitement
 * (« Confirmer ») ou se corrige ; « Générer l'annonce » reste fermé tant qu'une confirmation manque, ici ou
 * à l'étape Étiquette (le serveur refuserait de toute façon la validation : le silence ne vaut pas confirmation).
 */
export function MeasuresStep({ ui, edits, onEdits, onBack, onGenerate, generating, nav, canWrite, errors, demo }: {
  ui: UiArticle;
  edits: PrepEdits;
  onEdits: (e: PrepEdits) => void;
  onBack: () => void;
  onGenerate: () => void;
  generating: boolean;
  nav?: ReactNode;
  canWrite: boolean;
  errors: Partial<Record<MeasurementName, string>>;
  demo: boolean;
}) {
  const article = ui.article;
  const kind: GarmentKind = edits.garmentKind ?? article.garmentKind;
  const [extra, setExtra] = useState<MeasurementName[]>([]);
  const rows = measurementRows(article.measurements, kind, extra);
  const addable = MEASUREMENT_NAMES.filter((n) => !rows.some((r) => r.name === n));
  const tapePhotos = ui.photoIds.filter((id) => ui.roles[id]?.role === "tape").length;
  // Lectures encore à confirmer (étiquette et mesures) : tant qu'il en reste, l'annonce ne se génère pas.
  const pending = pendingConfirmations(article, edits);
  const confirm = (name: MeasurementName) => onEdits({ ...edits, confirmed: { ...edits.confirmed, [name]: true } });

  return (
    <Card>
      {nav}
      <div className="mb-4">
        <h2 className="text-md font-semibold">Mesures</h2>
        <p className="text-sm text-text-muted">Chaque mesure dit d'où elle vient : lue sur le mètre ruban photographié, retrouvée dans la base des références, ou indiquée par vous. Sinon, le champ reste vide et la question vous est posée.</p>
      </div>
      <Alert tone="info" className="mb-4" title="Jamais de mesure inventée">
        Selio n'estime aucune mesure « à l'œil » : sans mètre ruban visible ni référence connue, le champ reste vide. {tapePhotos === 0 ? "Aucune photo avec un mètre ruban pour cet article." : `${tapePhotos} photo${tapePhotos > 1 ? "s" : ""} avec un mètre ruban.`}
        {article.sizeReference ? ` Base des références : ${article.sizeReference.brand} ${article.sizeReference.reference}${article.sizeReference.size ? ` en ${article.sizeReference.size}` : ""}${demo ? " (exemple de démonstration)" : ""}.` : ""}
      </Alert>
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Field label="Famille de la pièce" hint="Elle fixe les mesures à prendre (haut : poitrine, longueur, épaules ; bas : taille, entrejambe…).">
          {(p) => (
            <Select id={p.id} aria-describedby={p.describedBy} value={kind} disabled={!canWrite} onChange={(e) => onEdits({ ...edits, garmentKind: e.target.value as GarmentKind })}>
              {GARMENT_KINDS.map((k) => <option key={k} value={k}>{GARMENT_KIND_LABELS[k]}</option>)}
            </Select>
          )}
        </Field>
      </div>
      {rows.length === 0 ? <p className="mb-4 text-sm text-text-muted">Aucune mesure attendue pour cette famille. Ajoutez-en une si elle aide l'acheteur.</p> : null}
      <ul className="flex flex-col divide-y divide-border" aria-label="Mesures">
        {rows.map((m) => {
          const d = measurementDisplay(m, edits);
          const question = measurementQuestion(article, m);
          const expected = expectedFor(kind).includes(m.name);
          const id = `measure-${ui.prepId}-${m.name}`;
          const err = errors[m.name] ?? (d.invalid ? "Indiquez une longueur en cm (par exemple 52 ou 41,5)." : null);
          const confirmed = Boolean(edits.confirmed?.[m.name]) && !d.edited;
          const toConfirm = needsExplicitConfirmation(m) && !d.edited && !confirmed;
          const showQuestion = question && !(d.edited && !d.cleared) && !confirmed && (m.valueCm === null || d.cleared || Boolean(m.question) || toConfirm);
          return (
            <li key={m.name} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_160px] sm:items-start sm:gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor={id} className="text-sm font-medium text-text">{MEASUREMENT_LABELS[m.name]}{expected ? <span className="sr-only"> (attendue)</span> : null}</label>
                  <ProvenanceBadge source={d.cleared ? null : m.source} confidence={m.confidence} pending={d.edited && !d.cleared} confirmed={confirmed} />
                </div>
                <p className="mt-0.5 text-xs text-text-muted">À plat, {MEASUREMENT_HOWTO[m.name]}.</p>
                {showQuestion ? <QuestionNote id={`${id}-q`} className="mt-1">{question}</QuestionNote> : null}
                {toConfirm && canWrite ? (
                  <div className="mt-1.5">
                    <Button size="sm" variant="secondary" icon={<Check />} aria-describedby={showQuestion ? `${id}-q` : undefined} onClick={() => confirm(m.name)}>Confirmer « {cmInputValue(m.valueCm)} cm »</Button>
                  </div>
                ) : null}
                {err ? <p role="alert" className="mt-1 text-xs text-danger">{err}</p> : null}
              </div>
              <Input id={id} inputMode="decimal" autoComplete="off" value={d.value} suffix="cm" invalid={Boolean(err)} disabled={!canWrite} aria-describedby={showQuestion ? `${id}-q` : undefined} onChange={(e) => onEdits({ ...edits, measurements: { ...edits.measurements, [m.name]: e.target.value } })} />
            </li>
          );
        })}
      </ul>
      {addable.length > 0 && canWrite ? (
        <div className="mt-3 max-w-xs">
          <label htmlFor={`add-measure-${ui.prepId}`} className="sr-only">Ajouter une mesure</label>
          <Select id={`add-measure-${ui.prepId}`} value="" onChange={(e) => { const n = e.target.value as MeasurementName; if (n) setExtra((x) => [...x, n]); }}>
            <option value="">Ajouter une mesure…</option>
            {addable.map((n) => <option key={n} value={n}>{MEASUREMENT_LABELS[n]}</option>)}
          </Select>
        </div>
      ) : null}
      <Checkbox
        className="mt-5 text-sm"
        checked={edits.shareMeasurements ?? false}
        disabled={!canWrite}
        onChange={(e) => onEdits({ ...edits, shareMeasurements: e.target.checked })}
        label="Partager anonymement ces mesures avec la base des références (marque, référence, taille et mesures seulement ; jamais votre nom ni vos photos)"
      />
      {pending.length > 0 ? (
        <Alert tone="warning" className="mt-4" title="À confirmer avant de générer">
          {pending.map((p) => `${p.label.toLowerCase()}${p.step === "label" ? " (étape Étiquette)" : ""}`).join(", ")} : lecture peu sûre ou en désaccord avec une autre source. Confirmez la valeur lue (« Confirmer ») ou corrigez-la ; le silence ne vaut jamais confirmation.
        </Alert>
      ) : null}
      <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <AccuracyNote />
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="secondary" onClick={onBack} icon={<ArrowLeft />}>Retour à l'étiquette</Button>
          <Button variant="brand" icon={<Sparkles />} onClick={onGenerate} loading={generating} disabled={!canWrite || pending.length > 0}>Générer l'annonce</Button>
        </div>
      </div>
    </Card>
  );
}
