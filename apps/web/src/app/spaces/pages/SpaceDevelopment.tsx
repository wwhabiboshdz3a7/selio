import { Link, useLocation } from "react-router";
import { ArrowRight, Check } from "lucide-react";
import { Card, PageHeader, StatusBadge, buttonClass } from "@selio/ui";
import { PreviewNotice } from "../components";
import { SPACES, SPACE_STATE_LABEL, spaceForPath, type SpaceId } from "../spaces";

interface DevContent {
  steps: { t: string; d: string }[];
  today: { to: string; label: string; d: string }[];
  note: string;
}

/** Ce que chaque filiale en développement apportera, et ce qui existe déjà aujourd'hui dans Selio. */
const CONTENT: Partial<Record<SpaceId, DevContent>> = {
  cloud: {
    steps: [
      { t: "Vous reliez vos comptes une fois", d: "Comme aujourd'hui avec l'extension, mais la session tourne ensuite sur nos serveurs." },
      { t: "Vos automatisations tournent seules", d: "Messages aux favoris, réponses, négociation, après-vente et stock automatique continuent, ordinateur éteint." },
      { t: "Vous suivez tout sur téléphone", d: "Ventes, offres acceptées, colis à déposer : une alerte quand il faut agir, rien d'autre." },
    ],
    today: [
      { to: "/app/automatisation", label: "Automatisation", d: "Les réglages que Selio Cloud fera tourner en continu." },
      { to: "/app/accounts", label: "Comptes Vinted", d: "Les comptes vente, achat et perso déjà reliés." },
    ],
    note: "Aujourd'hui, les actions sur Vinted passent par l'extension, navigateur ouvert. Selio Cloud n'est ni activé ni facturé.",
  },
  generateur: {
    steps: [
      { t: "Vous choisissez le style de la boutique", d: "Mode femme, homme, enfant, vintage, luxe… Selio propose un pseudo et une présentation." },
      { t: "L'IA prépare le profil", d: "Présentation, photo de profil, règles d'envoi et réponses types, prêtes à copier." },
      { t: "Les premières annonces sont prêtes", d: "Choisies dans votre stock et rédigées par Selio Studio, pour démarrer avec un dressing complet." },
    ],
    today: [
      { to: "/studio", label: "Selio Studio", d: "Les annonces rédigées à partir de vos photos." },
      { to: "/app/accounts", label: "Comptes Vinted", d: "Ajouter un compte existant et choisir son usage." },
    ],
    note: "Le compte est toujours créé par vous, à votre nom, dans le respect des règles de Vinted : Selio ne crée aucun compte à votre place.",
  },
};

/** Page d'une filiale en développement : ce qu'elle fera, comment, et ce qui est déjà utilisable. */
export default function SpaceDevelopment() {
  const { pathname } = useLocation();
  const id = spaceForPath(pathname);
  const space = SPACES.find((s) => s.id === id) ?? SPACES.find((s) => s.id === "cloud")!;
  const content = CONTENT[space.id] ?? CONTENT.cloud!;
  return (
    <>
      <PageHeader eyebrow={`${space.name} · ${SPACE_STATE_LABEL[space.state]}`} title={space.tagline} description={space.description} actions={<StatusBadge tone="neutral">{SPACE_STATE_LABEL[space.state]}</StatusBadge>} />
      <PreviewNotice space="development">{content.note}</PreviewNotice>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <h2 className="text-md font-semibold text-text">Comment ça marchera</h2>
          <ol className="mt-4 flex flex-col gap-4">
            {content.steps.map((s, i) => (
              <li key={s.t} className="flex gap-3">
                <span className="num inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--space-tint-soft)] text-xs font-semibold text-[var(--space-tint-ink)]" aria-hidden>{i + 1}</span>
                <div><p className="text-base font-semibold text-text">{s.t}</p><p className="text-sm text-text-muted">{s.d}</p></div>
              </li>
            ))}
          </ol>
          <h3 className="mt-6 text-sm font-semibold text-text">Au programme</h3>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm text-text">
            {space.does.map((d) => <li key={d} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-[var(--space-tint-ink)]" aria-hidden />{d}</li>)}
          </ul>
        </Card>
        <Card>
          <h2 className="text-md font-semibold text-text">En attendant, dans Selio</h2>
          <ul className="mt-3 flex flex-col divide-y divide-border">
            {content.today.map((t) => (
              <li key={t.to} className="py-3 first:pt-0 last:pb-0">
                <Link to={t.to} className="group flex items-center gap-2 text-base font-semibold text-text hover:text-accent">{t.label}<ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden /></Link>
                <p className="text-sm text-text-muted">{t.d}</p>
              </li>
            ))}
          </ul>
          <Link to="/app/espaces" className={buttonClass({ variant: "secondary", className: "mt-5" })}>Toutes les filiales</Link>
        </Card>
      </div>
    </>
  );
}
