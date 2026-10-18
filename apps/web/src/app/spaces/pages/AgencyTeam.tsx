import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Clock } from "lucide-react";
import { ROLE_LABELS, type Role } from "@selio/contracts";
import { ROLES_BY_RANK } from "@selio/domain";
import { Avatar, Card, PageHeader, Tag, buttonClass, cn } from "@selio/ui";
import { useClient, useRequiredSession } from "../../../lib/data/provider";
import { QueryBoundary } from "../../components/common";
import { PreviewNotice } from "../components";

/** Les rôles Selio, lus du point de vue d'une agence (les droits sont exactement ceux de Paramètres › Comptes et accès). */
const AGENCY_ROLES: Record<Role, { who: string; does: string }> = {
  owner: { who: "Le propriétaire (vous, ou la direction de l'agence)", does: "Tout, y compris l'abonnement, la facturation des clients et la suppression." },
  admin: { who: "Un ou une responsable de compte", does: "Règle l'outil pour l'équipe : réglages, membres, comptes connectés, automatisations." },
  operator: { who: "Les opérateurs de l'équipe", does: "Traitent les boutiques au quotidien : stock, annonces, messages, commandes." },
  viewer: { who: "Un client qui suit sa boutique", does: "Consulte ventes, annonces et analyses, sans rien modifier ni envoyer." },
};

export default function AgencyTeam() {
  const client = useClient();
  const session = useRequiredSession();
  const members = useQuery({ queryKey: ["members"], queryFn: () => client.listMembers() });

  return (
    <>
      <PageHeader
        eyebrow="Selio Agents · Aperçu"
        title="Équipe et accès"
        description="L'administrateur, les équipes et leurs accès : qui peut faire quoi sur vos comptes Vinted. Les rôles et les membres sont ceux de votre organisation : ils s'appliquent à tous les espaces et se gèrent aussi dans Paramètres › Comptes et accès."
        actions={<Link to="/app/settings/access" className={buttonClass({ variant: "primary" })}>Gérer dans Paramètres <ArrowRight aria-hidden /></Link>}
      />
      <PreviewNotice space="agents">Les rôles s'appliquent déjà à toute l'organisation. Les accès limités à un seul compte ou à une boutique cliente sont en développement.</PreviewNotice>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <h2 className="text-md font-semibold text-text">Les rôles et ce qu'ils permettent</h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {ROLES_BY_RANK.map((r) => (
              <li key={r} className={cn("rounded-lg border p-3", r === session.role ? "border-accent/50 bg-accent-soft/40" : "border-border")}>
                <p className="flex flex-wrap items-center gap-2 text-base font-semibold text-text">{ROLE_LABELS[r]}{r === session.role ? <Tag accent>Votre rôle</Tag> : null}</p>
                <p className="mt-0.5 text-sm font-medium text-accent">{AGENCY_ROLES[r].who}</p>
                <p className="mt-1 text-sm text-text-muted">{AGENCY_ROLES[r].does}</p>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-text-muted">Le détail action par action est dans <Link to="/app/settings/access" className="font-medium text-accent hover:underline">Paramètres › Comptes et accès</Link>.</p>
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <h2 className="text-md font-semibold text-text">Votre équipe aujourd'hui</h2>
            <QueryBoundary query={members}>
              {(list) => (
                <ul className="mt-3 divide-y divide-border">
                  {list.map((m) => (
                    <li key={m.id} className="flex items-center gap-3 py-2.5">
                      <Avatar name={m.user.displayName} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-text">{m.user.displayName}{m.userId === session.user.id ? " (vous)" : ""}</span>
                        <span className="block truncate text-xs text-text-muted">{m.user.email}</span>
                      </span>
                      <span className="shrink-0 text-xs text-text-muted">{ROLE_LABELS[m.role]}</span>
                    </li>
                  ))}
                </ul>
              )}
            </QueryBoundary>
          </Card>
          <Card>
            <h2 className="flex items-center gap-2 text-md font-semibold text-text"><Clock className="size-4 text-text-subtle" aria-hidden />En préparation</h2>
            <ul className="mt-3 flex flex-col gap-2 text-sm text-text-muted">
              <li>Accès par boutique cliente : chaque client ne voit que sa boutique.</li>
              <li>Répartition des boutiques entre opérateurs.</li>
              <li>Journal d'audit par boutique cliente.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
