import type { ReactNode } from "react";
import { Check, ScanText } from "lucide-react";
import { LABEL_FIELD_LABELS, type LabelFieldName } from "@selio/contracts";
import { Alert, Button, Card, Input, Tag } from "@selio/ui";
import { LABEL_FIELD_ORDER, fieldQuestion, type UiArticle, type UiPrep } from "../../../lib/studio/flow";
import { needsExplicitConfirmation, pendingConfirmations, type PrepEdits } from "../../../lib/studio/prep";
import { AccuracyNote, ProvenanceBadge, QuestionNote } from "./shared";

const HINTS: Record<LabelFieldName, string> = {
  brand: "Telle qu'écrite sur l'étiquette ; « sans marque » s'il n'y en a pas.",
  size: "La taille écrite sur l'étiquette (M, 42, W32 L32…).",
  material: "La composition (« 100 % coton »).",
  reference: "Facultatif : le numéro de modèle (« 501 ») sert à retrouver des mesures connues.",
};

/** Valeur affichée d'un champ et sa provenance : saisie en cours (« vous »), lue, ou vide. */
export function fieldDisplay(article: UiArticle["article"], edits: PrepEdits, key: LabelFieldName) {
  const current = article.fields[key];
  const typed = edits.fields[key];
  const edited = typed !== undefined && typed.trim() !== (current.value ?? "");
  const value = typed ?? current.value ?? "";
  return { value, edited, cleared: edited && typed!.trim() === "", current };
}

/**
 * Étiquette : marque, taille, matière et référence lues sur l'étiquette avec leur confiance, ou vides avec
 * la question au vendeur. Jamais déduites du style. Tout est modifiable : une valeur changée devient « vous ».
 * Une lecture peu sûre (0,5 à 0,7) ou en désaccord avec une autre source se CONFIRME explicitement (bouton
 * « Confirmer ») ou se corrige : le silence ne vaut jamais confirmation, et le serveur refuserait la validation.
 */
export function LabelStep({ ui, prep, photos, edits, onEdits, onBack, onNext, nav, canWrite }: {
  ui: UiArticle;
  prep: UiPrep;
  photos: Map<string, { url: string; alt: string }>;
  edits: PrepEdits;
  onEdits: (e: PrepEdits) => void;
  onBack: () => void;
  onNext: () => void;
  nav?: ReactNode;
  canWrite: boolean;
}) {
  const article = ui.article;
  const labelPhotos = ui.photoIds.filter((id) => ui.roles[id]?.role === "label");
  const pending = pendingConfirmations(article, edits).filter((p) => p.step === "label");
  const confirm = (key: LabelFieldName) => onEdits({ ...edits, confirmed: { ...edits.confirmed, [key]: true } });
  return (
    <Card>
      {nav}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-md font-semibold">Étiquette</h2>
          <p className="text-sm text-text-muted">Ce qui est lu sur l'étiquette, avec la confiance de la lecture. Un champ illisible reste vide : indiquez-le, ou laissez-le vide si vous ne savez pas.</p>
        </div>
        {prep.ocr.configured ? <Tag>{prep.ocr.used ? "OCR d'essai utilisé en second recours" : "OCR d'essai disponible"}</Tag> : null}
      </div>
      {labelPhotos.length === 0 ? (
        <Alert tone="info" className="mb-4">Aucune photo d'étiquette pour cet article : rien n'est lu, aucune valeur n'est devinée d'après le style. Indiquez ce que vous savez, ou ajoutez une photo de l'étiquette.</Alert>
      ) : (
        <ul className="mb-4 flex flex-wrap gap-2" aria-label="Photos de l'étiquette">
          {labelPhotos.map((id) => {
            const p = photos.get(id);
            return p ? <li key={id}><img src={p.url} alt={`Étiquette : ${p.alt}`} className="size-24 rounded-lg object-cover" /></li> : null;
          })}
        </ul>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {LABEL_FIELD_ORDER.map((key) => {
          const d = fieldDisplay(article, edits, key);
          const question = fieldQuestion(article, key, { cleared: d.cleared });
          const id = `label-${ui.prepId}-${key}`;
          const qid = `${id}-q`;
          // Lecture peu sûre ou en désaccord : confirmée telle quelle (elle deviendra « vous »), ou encore à confirmer.
          const confirmed = Boolean(edits.confirmed?.[key]) && !d.edited;
          const toConfirm = needsExplicitConfirmation(d.current) && !d.edited && !confirmed;
          return (
            <div key={key} className="flex min-w-0 flex-col gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor={id} className="text-sm font-medium text-text">{LABEL_FIELD_LABELS[key]}</label>
                <ProvenanceBadge source={d.cleared ? null : d.current.source} confidence={d.current.confidence} pending={d.edited && !d.cleared} confirmed={confirmed} />
              </div>
              <Input id={id} value={d.value} maxLength={key === "size" ? 40 : 80} disabled={!canWrite} aria-describedby={question && !d.edited ? qid : `${id}-h`} onChange={(e) => onEdits({ ...edits, fields: { ...edits.fields, [key]: e.target.value } })} />
              {question && !(d.edited && !d.cleared) && !confirmed ? <QuestionNote id={qid}>{question}</QuestionNote> : <p id={`${id}-h`} className="text-xs text-text-muted">{confirmed ? "Valeur lue, confirmée par vous." : HINTS[key]}</p>}
              {toConfirm && canWrite ? (
                <div>
                  <Button size="sm" variant="secondary" icon={<Check />} aria-describedby={qid} onClick={() => confirm(key)}>Confirmer « {d.current.value} »</Button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {article.careSymbols.length > 0 ? <p className="mt-4 text-xs text-text-muted">Entretien lu sur l'étiquette : {article.careSymbols.join(" · ")}</p> : null}
      {pending.length > 0 ? (
        <Alert tone="warning" className="mt-4" title="À confirmer avant de générer">
          {pending.map((p) => p.label.toLowerCase()).join(", ")} : lecture peu sûre ou en désaccord avec une autre source. Confirmez la valeur lue ou corrigez-la ; sans réponse, l'annonce ne sera pas générée.
        </Alert>
      ) : null}
      <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <AccuracyNote />
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" onClick={onBack}>Retour au tri</Button>
          <Button onClick={onNext} icon={<ScanText />}>Continuer vers les mesures</Button>
        </div>
      </div>
    </Card>
  );
}
