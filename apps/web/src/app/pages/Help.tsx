import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { helpEntries } from "@selio/domain/help";
import { Alert, Card, PageHeader } from "@selio/ui";
import { useClient, useData } from "../../lib/data/provider";
import { FaqBrowser, HelpAskPanel } from "../../components/help";

const SHORTCUTS: { to: string; label: string; hint: string }[] = [
  { to: "/app/onboarding", label: "Démarrage", hint: "Les six étapes de configuration" },
  { to: "/app/accounts", label: "Comptes Vinted", hint: "Catégories et extension" },
  { to: "/app/settings/ai", label: "État de l'IA", hint: "Disponibilité et réglages" },
  { to: "/app/settings/billing", label: "Abonnement", hint: "Essai et consommation" },
  { to: "/app/settings/status", label: "Statut des services", hint: "Ce qui fonctionne en ce moment" },
];

/**
 * Aide de l'application : « Poser une question » (assistant IA en mode connecté, recherche
 * locale signalée en démonstration) et la FAQ complète, partagée avec la vitrine.
 */
export default function Help() {
  const client = useClient();
  const { mode } = useData();
  return (
    <>
      <PageHeader title="Aide" description={`Posez une question ou parcourez les ${helpEntries().length} réponses de la FAQ. Chaque réponse cite les questions dont elle est tirée.`} />
      {mode === "demo" ? (
        <Alert tone="info" className="mb-5" title="Démonstration : réponses tirées de la FAQ">La réponse vient d'une recherche locale dans la FAQ, sans IA. En mode connecté, l'assistant IA la rédige à partir des mêmes passages, et la FAQ prend le relais s'il est indisponible.</Alert>
      ) : null}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="flex min-w-0 flex-col gap-10">
          <HelpAskPanel engine={mode === "demo" ? "local" : "ai"} ask={(q) => client.askHelp(q)} sourceHref={(id) => `/app/help#${id}`} />
          <FaqBrowser basePath="/app/help" appLinks />
        </div>
        <aside aria-label="Raccourcis" className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
          <Card padding="none">
            <p className="px-4 pt-4 text-sm font-medium text-text">Raccourcis</p>
            <ul className="mt-2 divide-y divide-border border-t border-border">
              {SHORTCUTS.map((s) => (
                <li key={s.to}>
                  <Link to={s.to} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-surface-muted">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-text">{s.label}</span>
                      <span className="block truncate text-xs text-text-muted">{s.hint}</span>
                    </span>
                    <ArrowRight className="size-3.5 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <p className="text-sm font-medium text-text">Pas de réponse ?</p>
            <p className="mt-1 text-sm text-text-muted">Reformulez avec d'autres mots, ou parcourez les catégories. Le formulaire de contact n'envoie encore aucun message : aucun service d'email n'est branché.</p>
            <Link to="/contact" className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">Page Contact <ArrowRight className="size-3.5" aria-hidden /></Link>
          </Card>
        </aside>
      </div>
    </>
  );
}
