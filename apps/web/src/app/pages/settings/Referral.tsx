import { useState } from "react";
import { Navigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Gift } from "lucide-react";
import { REFERRAL_STATUSES, REFERRAL_STATUS_LABELS, REFERRAL_TERMS } from "@selio/contracts";
import { Alert, Button, Card, Field, Input, StatStrip, Tag, formatNumber, useToast } from "@selio/ui";
import { useClient } from "../../../lib/data/provider";
import type { ReferralView } from "../../../lib/data/types";
import { QueryBoundary } from "../../components/common";

/**
 * Paramètres › Parrainage (§5.15) : « un mois offert aux deux ». Code de l'organisation, lien à copier, état
 * des filleules (des chiffres seulement : aucun nom, aucune adresse) et mois offerts. Masquée tant que le
 * programme n'est pas ouvert (REFERRAL_ENABLED=false côté serveur) ; en démonstration, l'offre est affichée
 * comme une PROPOSITION, non encore ouverte.
 */
export default function Referral() {
  const client = useClient();
  const q = useQuery({ queryKey: ["referral"], queryFn: () => client.getReferral(), retry: false });
  return (
    <QueryBoundary query={q} skeleton="spinner">
      {(r) => (r.enabled && r.code ? <ReferralContent view={r} /> : <Navigate to="/app/settings" replace />)}
    </QueryBoundary>
  );
}

function ReferralContent({ view }: { view: ReferralView }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const copy = async (what: "code" | "link", text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      toast({ tone: "success", title: what === "code" ? "Code copié" : "Lien copié" });
    } catch {
      toast({ tone: "danger", title: "Copie impossible", description: "Sélectionnez le texte et copiez-le à la main." });
    }
  };
  const total = REFERRAL_STATUSES.reduce((n, s) => n + view.referred[s], 0);
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="flex items-center gap-2 text-md font-semibold"><Gift className="size-4 text-text-muted" aria-hidden />Un mois offert aux deux</h2>
          {view.proposal ? <Tag data-testid="referral-proposal">Proposition</Tag> : null}
        </div>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">{REFERRAL_TERMS}</p>
        {view.proposal ? (
          <Alert tone="info" className="mt-3" title="Proposition, pas encore ouverte">
            Le programme de parrainage n'est pas encore ouvert : cette page montre comment il fonctionnera. Aucun mois n'est offert tant que l'activation n'a pas été décidée.
          </Alert>
        ) : null}
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
          <Field label="Votre code">
            {(p) => (
              <div className="flex gap-2">
                <Input id={p.id} readOnly value={view.code ?? ""} className="num font-semibold tracking-[0.2em]" onFocus={(e) => e.currentTarget.select()} />
                <Button variant="secondary" icon={copied === "code" ? <Check /> : <Copy />} onClick={() => copy("code", view.code ?? "")} aria-label="Copier le code">Copier</Button>
              </div>
            )}
          </Field>
          <Field label="Lien d'inscription à partager">
            {(p) => (
              <div className="flex gap-2">
                <Input id={p.id} readOnly value={view.shareUrl ?? ""} onFocus={(e) => e.currentTarget.select()} />
                <Button icon={copied === "link" ? <Check /> : <Copy />} onClick={() => copy("link", view.shareUrl ?? "")} aria-label="Copier le lien">Copier</Button>
              </div>
            )}
          </Field>
        </div>
      </Card>

      <StatStrip
        className="grid-cols-2 lg:grid-cols-4"
        items={[
          { label: "Organisations parrainées", value: formatNumber(total) },
          { label: "Mois offerts disponibles", value: formatNumber(view.creditsAvailable), sub: "Appliqués à votre prochain renouvellement" },
          { label: "Mois offerts utilisés", value: formatNumber(view.creditsConsumed) },
          { label: "Vous-même", value: view.referredBy ? "Parrainée" : "—", sub: view.referredBy ? REFERRAL_STATUS_LABELS[view.referredBy.status] : "Inscrite sans code" },
        ]}
      />

      <Card padding="none">
        <h2 className="px-4 pt-4 text-md font-semibold md:px-5">Statut des filleules</h2>
        <p className="px-4 pt-1 text-xs text-text-muted md:px-5">Des chiffres seulement : Selio ne vous montre ni le nom ni l'adresse des organisations parrainées.</p>
        <ul className="mt-3 divide-y divide-border border-t border-border" aria-label="Filleules par statut">
          {REFERRAL_STATUSES.map((s) => (
            <li key={s} className="flex items-center justify-between gap-3 px-4 py-3 text-sm md:px-5">
              <span className="text-text">{REFERRAL_STATUS_LABELS[s]}</span>
              <span className="num font-semibold text-text">{formatNumber(view.referred[s])}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
