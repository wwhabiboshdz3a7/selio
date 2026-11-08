import { can } from "@selio/domain";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, ImagePlus, MoonStar, Trash2, Upload } from "lucide-react";
import { Alert, Button, Card, Checkbox, Field, IconButton, PageHeader, Select, StatusBadge, Tag, cn, type StatusTone } from "@selio/ui";
import { DataError, type WornPhotoView, type WornPose } from "../../../lib/data/types";
import { useClient, useData, useRequiredSession } from "../../../lib/data/provider";
import { reducePhoto, toGeneratorPhoto, type ReducedPhoto } from "../../../lib/studio/reduce";
import { WORN_POSE_LABELS, WORN_STATUS_LABELS, euros, nightWindowLabel, scheduledLabel, wornRequestState } from "../../../lib/studio/prep";
import { QueryBoundary } from "../../components/common";
import { useAppMutation } from "../../components/hooks";
import { UsageMeter } from "../../components/usage";

const STATUS_TONE: Record<WornPhotoView["status"], StatusTone> = { queued: "accent", running: "warning", done: "success", failed: "danger", refused: "neutral" };
const timeFmt = (iso: string, tz: string) => new Intl.DateTimeFormat("fr-FR", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/**
 * Photos portées (Studio, §5.11) : une photo de l'article à plat devient une photo « portée ». AUCUN modèle ni
 * service n'est choisi (décision d'Ibrahim) : l'écran le dit, les demandes vont dans une file traitée la nuit
 * et sont refusées proprement tant qu'aucun fournisseur n'est configuré (quota rendu, rien facturé). Au-delà du
 * quota du plan (10 en Pro, 30 en Agence) : 0,25 € la photo, prix PROPOSÉ, seulement si le serveur l'ouvre,
 * avec l'accord explicite du client pour chaque photo, donné pour le prix AFFICHÉ (`acceptedUnitCents`) : un prix
 * changé entre-temps est refusé (409), jamais accepté en silence. La photo n'est envoyée au stockage qu'après une
 * relecture du quota, et elle en est effacée si la demande échoue ensuite.
 */
export default function StudioWornPhotos() {
  const client = useClient();
  const { mode } = useData();
  const session = useRequiredSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["worn-photos"], queryFn: () => client.wornPhotos() });
  const [photo, setPhoto] = useState<ReducedPhoto | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pose, setPose] = useState<WornPose>("front");
  const [consent, setConsent] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const canWrite = can(session.role, "ai.use");

  const pick = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setPhotoError(null);
    setBusy(true);
    try {
      // Réduite avant l'envoi (1 024 px, JPEG 0,8), comme les photos du générateur.
      setPhoto(await reducePhoto(f));
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : "Photo illisible");
    } finally {
      setBusy(false);
    }
  };

  /** Le prix du dépassement a changé depuis l'affichage : l'accord tombe, l'état est relu, le vendeur relit et recoche. */
  const priceChanged = () => {
    setConsent(false);
    void qc.invalidateQueries({ queryKey: ["worn-photos"] });
  };

  const request = useAppMutation(async () => {
    if (!photo) throw new Error("Choisissez une photo de l'article.");
    // Prix unitaire tel qu'affiché quand le vendeur a coché l'accord : l'accord ne vaut que pour lui.
    const shownUnitCents = q.data?.status.overage.unitCents ?? null;
    // Quota et prix relus AVANT d'envoyer la photo : rien n'est téléversé pour une demande qui serait refusée.
    const fresh = await client.wornPhotos();
    const state = wornRequestState(fresh.status, consent);
    if (!state.canRequest) throw new DataError("quota_exceeded", state.reason ?? "Quota du mois atteint.", 402);
    if (consent && shownUnitCents !== null && shownUnitCents !== fresh.status.overage.unitCents) {
      priceChanged();
      throw new DataError("overage_price_changed", `Le prix du dépassement est passé à ${euros(fresh.status.overage.unitCents)} la photo (accord donné sur ${euros(shownUnitCents)}) : relisez-le et confirmez à nouveau.`, 409);
    }
    const stored = await client.uploadStudioPhoto(toGeneratorPhoto(photo));
    try {
      const job = await client.requestWornPhoto({ photoKey: stored.key, pose, acceptOverage: consent, ...(consent && shownUnitCents !== null ? { acceptedUnitCents: shownUnitCents } : {}) });
      return { job, url: photo.url };
    } catch (e) {
      // La demande a échoué après l'envoi (quota, prix changé, droit…) : la photo ne reste pas dans le stockage.
      await client.deleteStudioPhoto(stored.key).catch(() => undefined);
      if (e instanceof DataError && e.code === "overage_price_changed") priceChanged();
      throw e;
    }
  }, {
    invalidate: ["worn-photos", "usage"],
    success: ({ job }) => `Demande mise en file : traitement ${scheduledLabel(job.scheduledFor, new Date(), q.data?.status.window.timezone)}`,
    onSuccess: ({ job, url }) => { setThumbs((t) => ({ ...t, [job.id]: url })); setPhoto(null); setConsent(false); },
  });
  const cancel = useAppMutation((id: string) => client.cancelWornPhoto(id), { invalidate: ["worn-photos", "usage"], success: "Demande annulée : place de quota rendue, rien n'est facturé" });

  return (
    <>
      <PageHeader
        eyebrow="Selio Studio · Photos portées"
        title="Photos portées"
        description="Une photo de l'article à plat devient une photo portée. Les demandes sont traitées la nuit, pour laisser la machine aux annonces pendant la journée."
      />
      <QueryBoundary query={q}>
        {({ jobs, status }) => {
          const state = wornRequestState(status, consent);
          const tz = status.window.timezone;
          const nextLabel = status.nextWindow.inWindow ? `en cours, jusqu'à ${timeFmt(status.nextWindow.end, tz).split(" à ").pop() ?? ""}` : scheduledLabel(status.nextWindow.start, new Date(), tz);
          return (
            <div className="flex flex-col gap-6">
              {status.provider.configured ? (
                <Alert tone="info" title={`Fournisseur : ${status.provider.name}`}>Les demandes en file sont traitées {nightWindowLabel(status.window)}.</Alert>
              ) : (
                <Alert tone="warning" title="Aucun fournisseur configuré : décision à prendre">
                  Le modèle ou le service qui produira les photos portées n'est pas encore choisi. Vos demandes sont bien mises en file, mais elles seront refusées proprement la nuit venue : la place de quota est rendue et rien n'est facturé. Aucune photo portée n'est simulée.
                </Alert>
              )}

              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <h2 className="text-md font-semibold">Quota du mois</h2>
                  <UsageMeter className="mt-3" label="Photos portées ce mois-ci" counter={status.counter} hint="Remis à zéro le 1er du mois." excludedHint="Non incluses dans votre offre : à partir de Pro." />
                  <p className="mt-3 text-sm text-text-muted">Pro : 10 par mois, Agence : 30. Une demande refusée, échouée ou annulée rend sa place.</p>
                  <div className="mt-4 rounded-lg bg-surface-muted p-3 text-sm">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-text">Au-delà du quota : {euros(status.overage.unitCents)} la photo <Tag>Proposition, prix à décider</Tag></p>
                    <p className="mt-1 text-text-muted">
                      {status.overage.enabled
                        ? "Ouvert sur ce serveur : chaque photo de plus demande votre accord, puis est facturée au prochain renouvellement, sur une ligne de dépassement de votre facture."
                        : "Désactivé sur ce serveur : au-delà du quota, la demande est refusée, sans rien facturer."}
                    </p>
                  </div>
                </Card>

                <Card>
                  <h2 className="text-md font-semibold">Nouvelle demande</h2>
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-text-muted"><MoonStar className="size-4" aria-hidden />File de nuit, {nightWindowLabel(status.window)}. Prochain créneau : <span className="font-medium text-text">{nextLabel}</span>.</p>
                  <div className="mt-4 flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                      {photo ? <img src={photo.url} alt={`Photo choisie : ${photo.alt}`} className="size-20 rounded-lg object-cover" /> : <span className="flex size-20 items-center justify-center rounded-lg bg-surface-muted text-text-muted" aria-hidden><ImagePlus className="size-5" /></span>}
                      <div className="flex min-w-0 flex-col gap-1">
                        <Button variant="secondary" icon={<Upload />} onClick={() => fileRef.current?.click()} loading={busy} disabled={!canWrite}>{photo ? "Changer de photo" : "Choisir la photo de l'article"}</Button>
                        <p className="text-xs text-text-muted">L'article à plat ou sur cintre, bien éclairé. Réduite avant l'envoi.</p>
                      </div>
                      <input ref={fileRef} type="file" accept="image/*" className="sr-only" aria-label="Photo de l'article pour la photo portée" onChange={(e) => { void pick(e.target.files); e.target.value = ""; }} />
                    </div>
                    {photoError ? <p role="alert" className="text-xs text-danger">{photoError}</p> : null}
                    <Field label="Pose">
                      {(p) => (
                        <Select id={p.id} value={pose} onChange={(e) => setPose(e.target.value as WornPose)} disabled={!canWrite}>
                          {(Object.keys(WORN_POSE_LABELS) as WornPose[]).map((k) => <option key={k} value={k}>{WORN_POSE_LABELS[k]}</option>)}
                        </Select>
                      )}
                    </Field>
                    <div>
                      <Checkbox
                        className="text-sm"
                        checked={consent}
                        disabled={!state.consentEnabled || !canWrite}
                        onChange={(e) => setConsent(e.target.checked)}
                        label={`J'accepte de payer ${euros(status.overage.unitCents)} pour cette photo au-delà de mon quota (prix proposé, à confirmer), facturés au prochain renouvellement.`}
                      />
                      {!state.atQuota ? <p className="mt-1 text-xs text-text-muted">Utile seulement quand le quota du mois est atteint.</p> : null}
                    </div>
                    {state.reason && state.atQuota ? <Alert tone={state.consentEnabled ? "info" : "warning"}>{state.reason}</Alert> : null}
                    <Button icon={<Clock />} onClick={() => request.mutate(undefined)} loading={request.isPending} disabled={!photo || !state.canRequest || !canWrite}>Mettre en file pour la nuit</Button>
                    {mode === "demo" ? <p className="text-xs text-text-muted">Démonstration : la photo reste dans cet onglet ; la demande est mise en file et sera refusée la nuit (aucun fournisseur), comme sur le serveur.</p> : null}
                  </div>
                </Card>
              </div>

              <Card padding="none">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-5 py-4">
                  <h2 className="text-md font-semibold">File de nuit</h2>
                  <Link to="/studio" className="text-sm font-medium text-accent hover:underline">Retour au générateur</Link>
                </div>
                {jobs.length === 0 ? (
                  <div className="px-5 py-10 text-center">
                    <h3 className="text-md font-semibold">Aucune demande</h3>
                    <p className="mt-1 text-sm text-text-muted">Vos demandes de photos portées apparaîtront ici avec l'heure prévue de leur traitement.</p>
                  </div>
                ) : (
                  <ul aria-label="Demandes de photos portées" className="divide-y divide-border">
                    {jobs.map((j) => (
                      <li key={j.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                        {thumbs[j.id] ? <img src={thumbs[j.id]} alt="" className="size-12 rounded-md object-cover" /> : <span className="size-12 rounded-md bg-surface-muted" aria-hidden />}
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-2 text-sm text-text">
                            <StatusBadge tone={STATUS_TONE[j.status]}>{WORN_STATUS_LABELS[j.status]}</StatusBadge>
                            <span>{WORN_POSE_LABELS[j.pose]}</span>
                            {j.overageCents > 0 ? <Tag>Dépassement {euros(j.overageCents)} · proposition{j.billed ? " · facturé" : ""}</Tag> : null}
                          </p>
                          <p className="num mt-0.5 text-xs text-text-muted">
                            {j.status === "queued" ? `Prévue ${scheduledLabel(j.scheduledFor, new Date(), tz)}` : j.finishedAt ? `Traitée le ${timeFmt(j.finishedAt, tz)}` : `Prévue le ${timeFmt(j.scheduledFor, tz)}`}
                            {` · demandée le ${timeFmt(j.createdAt, tz)}`}
                          </p>
                          {j.error ? <p className={cn("mt-0.5 text-xs", j.status === "failed" ? "text-danger" : "text-text-muted")}>{j.status === "refused" ? "Refusée : " : "Erreur : "}{j.error}</p> : null}
                        </div>
                        {j.status === "queued" && canWrite ? <IconButton label="Annuler la demande" variant="ghost" onClick={() => cancel.mutate(j.id)} disabled={cancel.isPending}><Trash2 /></IconButton> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          );
        }}
      </QueryBoundary>
    </>
  );
}
