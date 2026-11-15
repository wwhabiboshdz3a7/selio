import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Megaphone, Pencil, Plus, Trash2 } from "lucide-react";
import {
  OFFER_BANNER_MAX, PAID_PLANS, PLAN_LABELS, offerBannerText, offerDiscountLabel, offerInput, offerPlansLabel,
  type CommercialOffer, type OfferInput, type PaidPlan,
} from "@selio/contracts";
import { Alert, Button, Card, Checkbox, ConfirmDialog, EmptyState, Field, Input, PageHeader, Segmented, StatusBadge, Table, TableWrap, Td, Th, Toggle, Tr, formatDate } from "@selio/ui";
import { useClient, useData } from "../../../lib/data/provider";
import { QueryBoundary } from "../../components/common";
import { useAppMutation } from "../../components/hooks";

/**
 * Selio Admin › Offres : promotions sur les forfaits payants (Starter, Pro, Agence), décidées par l'équipe Selio
 * (opérateurs « tech » et « business »). Nom affiché, code promo, remise en pourcentage ou montant fixe par
 * échéance, forfaits, durée, période, maximum d'utilisations, bandeau en haut de la vitrine et de l'application
 * (aperçu tel qu'il s'affichera). Une offre jamais utilisée est supprimée ; une offre déjà utilisée est archivée.
 */

type DiscountKind = "percent" | "amount";
type DurationKind = "always" | "months";

interface OfferForm {
  name: string;
  code: string;
  discountKind: DiscountKind;
  /** Pourcentage (entier) ou montant en euros (« 5 », « 2,50 »). */
  discountValue: string;
  plans: PaidPlan[];
  durationKind: DurationKind;
  durationMonths: string;
  startsOn: string;
  endsOn: string;
  maxRedemptions: string;
  bannerEnabled: boolean;
  bannerText: string;
  active: boolean;
}

const EMPTY_FORM: OfferForm = { name: "", code: "", discountKind: "percent", discountValue: "", plans: [], durationKind: "always", durationMonths: "", startsOn: "", endsOn: "", maxRedemptions: "", bannerEnabled: false, bannerText: "", active: true };

const dateInput = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString("sv-SE") : "");

function formOf(o: CommercialOffer): OfferForm {
  return {
    name: o.name,
    code: o.code ?? "",
    discountKind: o.discountPercent !== null ? "percent" : "amount",
    discountValue: o.discountPercent !== null ? String(o.discountPercent) : o.discountCents !== null ? (o.discountCents / 100).toFixed(2).replace(".", ",").replace(/,00$/, "") : "",
    plans: [...o.plans],
    durationKind: o.durationMonths === null ? "always" : "months",
    durationMonths: o.durationMonths === null ? "" : String(o.durationMonths),
    startsOn: dateInput(o.startsAt),
    endsOn: dateInput(o.endsAt),
    maxRedemptions: o.maxRedemptions === null ? "" : String(o.maxRedemptions),
    bannerEnabled: o.bannerEnabled,
    bannerText: o.bannerText ?? "",
    active: o.active,
  };
}

const intOrNaN = (v: string): number => (/^\s*\d+\s*$/.test(v) ? Number(v.trim()) : Number.NaN);

/** Formulaire → offre (mêmes règles que le serveur : @selio/contracts `offerInput`) ; erreurs par champ. */
export function offerFromForm(f: OfferForm): { input: OfferInput; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const raw = f.discountValue.trim().replace(",", ".");
  let discountPercent: number | null = null;
  let discountCents: number | null = null;
  if (!raw) errors.discountValue = "Indiquez la remise.";
  else if (f.discountKind === "percent") {
    discountPercent = intOrNaN(raw);
    if (!Number.isInteger(discountPercent) || discountPercent < 1 || discountPercent > 100) errors.discountValue = "Pourcentage entier entre 1 et 100.";
  } else {
    const euros = Number(raw);
    discountCents = Math.round(euros * 100);
    if (!/^\d+(\.\d{1,2})?$/.test(raw) || discountCents < 1) errors.discountValue = "Montant en euros, par exemple 5 ou 2,50.";
  }
  let durationMonths: number | null = null;
  if (f.durationKind === "months") {
    durationMonths = intOrNaN(f.durationMonths);
    if (!Number.isInteger(durationMonths) || durationMonths < 1 || durationMonths > 36) errors.durationMonths = "Nombre de mois entre 1 et 36.";
  }
  let maxRedemptions: number | null = null;
  if (f.maxRedemptions.trim()) {
    maxRedemptions = intOrNaN(f.maxRedemptions);
    if (!Number.isInteger(maxRedemptions) || maxRedemptions < 1) errors.maxRedemptions = "Nombre entier, 1 au moins (vide : sans limite).";
  }
  // Début à 0 h, fin incluse jusqu'à 23 h 59 (heure du navigateur de l'opérateur).
  const startsAt = f.startsOn ? new Date(`${f.startsOn}T00:00:00`).toISOString() : null;
  const endsAt = f.endsOn ? new Date(`${f.endsOn}T23:59:59`).toISOString() : null;
  const input: OfferInput = {
    name: f.name.trim(),
    code: f.code.trim() ? f.code.trim().toUpperCase() : null,
    discountPercent: errors.discountValue ? null : discountPercent,
    discountCents: errors.discountValue ? null : discountCents,
    plans: PAID_PLANS.filter((p) => f.plans.includes(p)),
    durationMonths: errors.durationMonths ? null : durationMonths,
    startsAt,
    endsAt,
    maxRedemptions: errors.maxRedemptions ? null : maxRedemptions,
    bannerEnabled: f.bannerEnabled,
    bannerText: f.bannerText.trim() ? f.bannerText.trim() : null,
    active: f.active,
  };
  const parsed = offerInput.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      const field = key === "discountPercent" || key === "discountCents" ? "discountValue" : key === "startsAt" ? "startsOn" : key === "endsAt" ? "endsOn" : key;
      errors[field] ??= field === "code" ? "Code promo : 3 à 24 caractères, lettres, chiffres et tirets." : issue.message;
    }
  }
  return { input: parsed.success ? parsed.data : input, errors };
}

function periodLabel(o: CommercialOffer): string {
  if (!o.startsAt && !o.endsAt) return "Sans limite";
  if (o.startsAt && o.endsAt) return `Du ${formatDate(o.startsAt)} au ${formatDate(o.endsAt)}`;
  return o.startsAt ? `À partir du ${formatDate(o.startsAt)}` : `Jusqu'au ${formatDate(o.endsAt!)}`;
}

function statusOf(o: CommercialOffer, now = new Date()): { tone: "success" | "muted" | "warning"; label: string } {
  if (o.archivedAt) return { tone: "muted", label: "Archivée" };
  if (!o.active) return { tone: "muted", label: "Désactivée" };
  if (o.endsAt && new Date(o.endsAt) <= now) return { tone: "warning", label: "Expirée" };
  if (o.startsAt && new Date(o.startsAt) > now) return { tone: "warning", label: "À venir" };
  if (o.maxRedemptions !== null && o.redemptions >= o.maxRedemptions) return { tone: "warning", label: "Maximum atteint" };
  return { tone: "success", label: "Active" };
}

export function AdminOffers() {
  const client = useClient();
  const { mode } = useData();
  const q = useQuery({ queryKey: ["admin-offers"], queryFn: () => client.adminListOffers() });
  const [editing, setEditing] = useState<{ id: string | null; form: OfferForm } | null>(null);
  const [toDelete, setToDelete] = useState<CommercialOffer | null>(null);
  const invalidate = ["admin-offers", "offer-banner"];
  const toggle = useAppMutation((o: CommercialOffer) => client.adminUpdateOffer(o.id, { active: !o.active }), { invalidate, success: (o) => (o.active ? "Offre activée" : "Offre désactivée") });
  const remove = useAppMutation((o: CommercialOffer) => client.adminDeleteOffer(o.id), {
    invalidate,
    success: (r) => (r.deleted ? "Offre supprimée" : "Offre archivée (déjà utilisée)"),
    onSuccess: () => setToDelete(null),
  });
  return (
    <>
      <PageHeader
        eyebrow="Selio Admin"
        title="Offres commerciales"
        description="Promotions sur Starter, Pro et Agence : vous choisissez le nom, la remise et le code promo, et l'offre s'affiche si besoin dans le bandeau en haut du site et de l'application. Les forfaits eux-mêmes ne changent pas."
        actions={editing ? null : <Button variant="accent" onClick={() => setEditing({ id: null, form: EMPTY_FORM })}><Plus aria-hidden />Nouvelle offre</Button>}
      />
      {mode === "demo" ? <Alert tone="info" className="mb-4">Démonstration : les offres sont enregistrées dans ce navigateur seulement ; le bandeau de la vitrine et de l'application de démonstration les affiche.</Alert> : null}
      {editing ? <OfferEditor key={editing.id ?? "new"} id={editing.id} initial={editing.form} onDone={() => setEditing(null)} /> : null}
      <QueryBoundary query={q} skeleton="spinner">
        {(offers) =>
          offers.length === 0 ? (
            <EmptyState icon={<Megaphone />} title="Aucune offre pour le moment" description="Créez une offre : un nom, une remise, un code promo si vous le souhaitez, et le bandeau si vous voulez l'annoncer." />
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Offre</Th><Th>Code</Th><Th>Remise</Th><Th>Forfaits</Th><Th>Durée</Th><Th>Période</Th><Th numeric>Utilisations</Th><Th>Bandeau</Th><Th>État</Th><Th><span className="sr-only">Actions</span></Th>
                  </tr>
                </thead>
                <tbody>
                  {offers.map((o) => {
                    const st = statusOf(o);
                    return (
                      <Tr key={o.id} data-testid={`offer-row-${o.code ?? o.id}`}>
                        <Td className="font-medium text-text">{o.name}</Td>
                        <Td className="num">{o.code ?? <span className="text-text-muted">Sans code</span>}</Td>
                        <Td className="num">{offerDiscountLabel(o)}</Td>
                        <Td>{offerPlansLabel(o.plans)}</Td>
                        <Td>{o.durationMonths === null ? "Tant que l'abonnement dure" : `${o.durationMonths} mois`}</Td>
                        <Td>{periodLabel(o)}</Td>
                        <Td numeric>{o.redemptions}{o.maxRedemptions !== null ? ` / ${o.maxRedemptions}` : ""}</Td>
                        <Td>{o.bannerEnabled ? "Oui" : "Non"}</Td>
                        <Td><StatusBadge tone={st.tone}>{st.label}</StatusBadge></Td>
                        <Td>
                          {o.archivedAt ? null : (
                            <span className="flex justify-end gap-1">
                              <Button size="sm" variant="secondary" onClick={() => toggle.mutate(o)} loading={toggle.isPending && toggle.variables?.id === o.id}>{o.active ? "Désactiver" : "Activer"}</Button>
                              <Button size="sm" variant="ghost" aria-label={`Modifier l'offre ${o.name}`} onClick={() => setEditing({ id: o.id, form: formOf(o) })}><Pencil aria-hidden /></Button>
                              <Button size="sm" variant="ghost" aria-label={`Supprimer l'offre ${o.name}`} onClick={() => setToDelete(o)}><Trash2 aria-hidden /></Button>
                            </span>
                          )}
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>
          )
        }
      </QueryBoundary>
      <ConfirmDialog
        open={toDelete !== null}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete)}
        loading={remove.isPending}
        danger
        title={toDelete ? `Supprimer l'offre « ${toDelete.name} » ?` : "Supprimer l'offre ?"}
        confirmLabel={toDelete && toDelete.redemptions > 0 ? "Archiver l'offre" : "Supprimer l'offre"}
        cancelLabel="Garder l'offre"
        description={
          toDelete && toDelete.redemptions > 0
            ? `Cette offre a déjà servi à ${toDelete.redemptions} organisation${toDelete.redemptions > 1 ? "s" : ""} : elle sera archivée (code et bandeau retirés). Les organisations qui l'ont appliquée gardent leur remise jusqu'à son terme.`
            : "Cette offre n'a jamais servi : elle sera supprimée définitivement, avec son code et son bandeau."
        }
      />
    </>
  );
}

export default AdminOffers;

function OfferEditor({ id, initial, onDone }: { id: string | null; initial: OfferForm; onDone: () => void }) {
  const client = useClient();
  const [f, setF] = useState<OfferForm>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const set = <K extends keyof OfferForm>(k: K, v: OfferForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = useAppMutation((input: OfferInput) => (id ? client.adminUpdateOffer(id, input) : client.adminCreateOffer(input)), {
    invalidate: ["admin-offers", "offer-banner"],
    success: id ? "Offre enregistrée" : "Offre créée",
    onSuccess: onDone,
    onError: (e: unknown) => setServerError(e instanceof Error ? e.message : "Enregistrement impossible."),
  });
  const preview = offerFromForm(f);
  // Aperçu du bandeau tel qu'il s'affichera (texte saisi, ou construit à partir de la remise).
  const hasDiscount = preview.input.discountPercent !== null || preview.input.discountCents !== null;
  const previewText = preview.input.bannerText || hasDiscount ? offerBannerText(preview.input) : "Indiquez la remise pour voir l'aperçu du bandeau.";
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const r = offerFromForm(f);
    setErrors(r.errors);
    setServerError(null);
    if (Object.keys(r.errors).length > 0) return;
    save.mutate(r.input);
  };
  return (
    <Card className="mb-6">
      <h2 className="text-md font-semibold">{id ? "Modifier l'offre" : "Nouvelle offre"}</h2>
      <form onSubmit={submit} noValidate className="mt-4 grid gap-4 md:grid-cols-2" aria-label={id ? "Modifier l'offre" : "Nouvelle offre"}>
        <Field label="Nom affiché" required error={errors.name} hint="2 à 80 caractères, par exemple « Printemps ».">
          {(p) => <Input id={p.id} invalid={p.invalid} aria-describedby={p.describedBy} value={f.name} maxLength={80} onChange={(e) => set("name", e.target.value)} />}
        </Field>
        <Field label="Code promo" error={errors.code} hint="Facultatif. 3 à 24 caractères : lettres, chiffres, tirets. Saisi sans tenir compte des majuscules.">
          {(p) => <Input id={p.id} invalid={p.invalid} aria-describedby={p.describedBy} value={f.code} maxLength={24} className="num tracking-[0.1em]" onChange={(e) => set("code", e.target.value.toUpperCase())} autoComplete="off" spellCheck={false} />}
        </Field>
        <div className="flex flex-col gap-2">
          <Segmented ariaLabel="Type de remise" value={f.discountKind} onChange={(v: DiscountKind) => set("discountKind", v)} items={[{ value: "percent", label: "Pourcentage" }, { value: "amount", label: "Montant fixe" }]} />
          <Field label={f.discountKind === "percent" ? "Remise (%)" : "Remise par échéance (€)"} required error={errors.discountValue} hint={f.discountKind === "percent" ? "Entre 1 et 100 ; à 100 %, facture à 0 € sans débit." : "Retirée de chaque échéance (une fois sur l'échéance annuelle)."}>
            {(p) => <Input id={p.id} invalid={p.invalid} aria-describedby={p.describedBy} value={f.discountValue} inputMode="decimal" onChange={(e) => set("discountValue", e.target.value)} />}
          </Field>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-text">Forfaits concernés</legend>
          <div className="flex flex-wrap gap-4">
            {PAID_PLANS.map((p) => (
              <Checkbox key={p} label={PLAN_LABELS[p]} checked={f.plans.includes(p)} onChange={(e) => set("plans", e.target.checked ? [...f.plans, p] : f.plans.filter((x) => x !== p))} />
            ))}
          </div>
          <p className="text-xs text-text-muted">Aucun coché : tous les forfaits.</p>
        </fieldset>
        <div className="flex flex-col gap-2">
          <Segmented ariaLabel="Durée de la remise" value={f.durationKind} onChange={(v: DurationKind) => set("durationKind", v)} items={[{ value: "always", label: "Tant que l'abonnement dure" }, { value: "months", label: "Nombre de mois" }]} />
          {f.durationKind === "months" ? (
            <Field label="Échéances mensuelles remisées" required error={errors.durationMonths} hint="Entre 1 et 36. Une échéance annuelle reçoit la remise une fois et compte pour 12 mois.">
              {(p) => <Input id={p.id} invalid={p.invalid} aria-describedby={p.describedBy} value={f.durationMonths} inputMode="numeric" onChange={(e) => set("durationMonths", e.target.value)} />}
            </Field>
          ) : null}
        </div>
        <Field label="Maximum d'utilisations" error={errors.maxRedemptions} hint="Facultatif : nombre d'organisations qui peuvent l'appliquer.">
          {(p) => <Input id={p.id} invalid={p.invalid} aria-describedby={p.describedBy} value={f.maxRedemptions} inputMode="numeric" onChange={(e) => set("maxRedemptions", e.target.value)} />}
        </Field>
        <Field label="Début" error={errors.startsOn} hint="Facultatif.">
          {(p) => <Input id={p.id} type="date" invalid={p.invalid} aria-describedby={p.describedBy} value={f.startsOn} onChange={(e) => set("startsOn", e.target.value)} />}
        </Field>
        <Field label="Fin (incluse)" error={errors.endsOn} hint="Facultatif.">
          {(p) => <Input id={p.id} type="date" invalid={p.invalid} aria-describedby={p.describedBy} value={f.endsOn} onChange={(e) => set("endsOn", e.target.value)} />}
        </Field>
        <div className="flex flex-col gap-3 md:col-span-2">
          <Toggle checked={f.bannerEnabled} onChange={(v) => set("bannerEnabled", v)} label="Afficher dans le bandeau" description="En haut de la vitrine et de l'application, refermable par chacun." />
          {f.bannerEnabled ? (
            <Field label="Texte du bandeau" error={errors.bannerText} hint={`Facultatif, ${OFFER_BANNER_MAX} caractères au plus (${f.bannerText.length}/${OFFER_BANNER_MAX}). Vide : texte construit à partir de la remise.`}>
              {(p) => <Input id={p.id} invalid={p.invalid} aria-describedby={p.describedBy} value={f.bannerText} maxLength={OFFER_BANNER_MAX} onChange={(e) => set("bannerText", e.target.value)} />}
            </Field>
          ) : null}
          <div>
            <p className="text-xs font-medium tracking-wider text-text-muted uppercase">Aperçu du bandeau</p>
            <p data-testid="offer-banner-preview" className="mt-1 rounded-md border border-border bg-surface-muted px-3 py-2 text-center text-xs font-medium text-text">{previewText}</p>
            {!f.bannerEnabled ? <p className="mt-1 text-xs text-text-muted">Bandeau désactivé : l'offre reste utilisable avec son code, sans être annoncée.</p> : null}
          </div>
          <Toggle checked={f.active} onChange={(v) => set("active", v)} label="Offre active" description="Désactivée : le code est refusé et le bandeau masqué ; les organisations qui l'ont déjà appliquée gardent leur remise." />
        </div>
        {serverError ? <Alert tone="danger" className="md:col-span-2">{serverError}</Alert> : null}
        {Object.keys(errors).length > 0 ? <Alert tone="warning" className="md:col-span-2">Corrigez les champs signalés avant d'enregistrer.</Alert> : null}
        <div className="flex flex-wrap gap-2 md:col-span-2">
          <Button type="submit" variant="accent" loading={save.isPending}>{id ? "Enregistrer" : "Créer l'offre"}</Button>
          <Button type="button" variant="ghost" onClick={onDone}>Annuler</Button>
        </div>
      </form>
    </Card>
  );
}
