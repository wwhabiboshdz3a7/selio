import type { ReactNode } from "react";
import { Link } from "react-router";
import { ArrowRight, BellRing, Bot, HandCoins, Heart, MessagesSquare, Package, Printer, Radar, RefreshCw, Sparkles, TrendingUp } from "lucide-react";
import { PageHeader, StatusBadge, buttonClass, cn } from "@selio/ui";
import { useDataMode, useRequiredSession } from "../../../lib/data/provider";
import { useNavCounts } from "../../layout";
import { useAutoBuyStatus } from "../../components/radar";
import { QueryBoundary } from "../../components/common";
import { AutomationStatusBoard, useAutomationSummary } from "./status";

interface Stage {
  n: number;
  title: string;
  text: string;
  icon: ReactNode;
  states: { label: string; on: boolean | null }[];
  links: { to: string; label: string }[];
}

/**
 * Selio Manager › Automatisation : l'état des automatisations du compte (négociation par IA, relances,
 * republication, réponses, favoris, après-vente) avec « Arrêter toutes les automatisations », les blocs
 * qui travaillent pendant que vous dormez, et le parcours complet du revendeur. La recherche et l'achat
 * d'articles relèvent de Selio Bot : le parcours y renvoie.
 */
export default function AutomationHub() {
  const mode = useDataMode();
  const session = useRequiredSession();
  const s = session.org.settings;
  const a = s.automation;
  const counts = useNavCounts();
  const summary = useAutomationSummary();
  // Radar Auto « activé » seulement si TOUS ses verrous sont levés (serveur, adresse partagée, réglage, Cloud, accord).
  const autoActive = useAutoBuyStatus().data?.active === true;
  const stages: Stage[] = [
    { n: 1, title: "Sourcing", icon: <TrendingUp />, text: "Repérer quoi acheter : Selio Track analyse le marché et identifie les niches ; Selio Bot surveille vos recherches et note chaque bonne affaire sur 100.", states: [{ label: "Recherches Selio Bot", on: true }, { label: "Selio Track en développement", on: null }], links: [{ to: "/bot", label: "Ouvrir Selio Bot" }, { to: "/track", label: "Selio Track" }] },
    { n: 2, title: "Achat", icon: <Bot />, text: "Dans Selio Bot : achat rapide (vous validez chaque affaire en 1 clic) ou achat automatique au-dessus d'une note, dans un budget par jour.", states: [{ label: autoActive ? "Achat automatique ouvert" : s.autoBuy.enabled ? "Achat automatique verrouillé" : "Achat rapide en 1 clic", on: autoActive }], links: [{ to: "/app/purchase", label: "À valider" }, { to: "/bot/achat-auto", label: "Achat automatique" }] },
    { n: 3, title: "Vente", icon: <Sparkles />, text: "Studio rédige l'annonce, puis Selio écrit aux favoris, répond aux questions, négocie par IA (accepter, refuser ou contre-offrir) et relance après 24 h, selon vos règles.", states: [{ label: "Favoris", on: a.favorites.enabled }, { label: "Réponse auto", on: a.autoReply.enabled }, { label: "Négociation par IA", on: a.negotiation.enabled }], links: [{ to: "/studio", label: "Générer une annonce" }, { to: "/app/automatisation/negociation", label: "Négociation" }, { to: "/app/automatisation/relances", label: "Relances" }] },
    { n: 4, title: "Collecte des bordereaux", icon: <Printer />, text: "Le bordereau est commandé dès la vente et imprimé tout seul si vous le cochez : aucune action manuelle.", states: [{ label: "Commande auto", on: a.afterSale.autoLabels }, { label: "Impression auto", on: a.afterSale.autoPrint }], links: [{ to: "/app/automatisation/apres-vente", label: "Régler" }, { to: "/app/orders", label: "Commandes" }] },
    { n: 5, title: "Après-vente", icon: <Package />, text: "Un message après l'achat, un autre quand la commande est finalisée, et une relance si le colis attend au point relais.", states: [{ label: "Après la vente", on: a.afterSale.soldMessage.enabled }, { label: "Après finalisation", on: a.afterSale.completedMessage.enabled }, { label: `Relance ${a.afterSale.pickupReminder.afterHours} h`, on: a.afterSale.pickupReminder.enabled }], links: [{ to: "/app/automatisation/apres-vente", label: "Régler les messages" }] },
    { n: 6, title: "Remise en ligne", icon: <RefreshCw />, text: "Stock automatique : l'article vendu est remis en ligne tout seul tant qu'il en reste ; le dressing propose les republications.", states: [{ label: "Stock automatique", on: a.stock.enabled }], links: [{ to: "/app/automatisation/stock", label: "Stock automatique" }, { to: "/app/dressing", label: "Dressing" }] },
  ];
  const blocks = [
    { to: "/app/automatisation/favoris", title: "Messages aux favoris", icon: <Heart />, on: a.favorites.enabled, text: "Écrire à l'acheteur qui met un article en favori, avec une petite remise." },
    { to: "/app/automatisation/reponse", title: "Réponse automatique", icon: <MessagesSquare />, on: a.autoReply.enabled, text: "Répondre aux questions courantes à partir de la fiche de l'article." },
    { to: "/app/automatisation/negociation", title: "Négociation par IA", icon: <HandCoins />, on: a.negotiation.enabled, text: "Accepter, refuser ou contre-offrir : marges par tranche de prix, paliers, messages et délais." },
    { to: "/app/automatisation/apres-vente", title: "Message après-vente", icon: <Package />, on: a.afterSale.soldMessage.enabled || a.afterSale.completedMessage.enabled, text: "Bordereaux, remerciements, finalisation et relance du colis." },
  ];
  // Relances : allumées si une règle de relance l'est (état lu dans la synthèse des automatisations).
  const followUp = summary.data?.bots.find((b) => b.id === "follow_up");
  return (
    <>
      <PageHeader eyebrow="Selio Manager · Automatisation" title="Tout le parcours, automatisé" description="Les automatisations de votre compte Vinted, de la vente à la remise en ligne : chaque étape peut tourner sans vous. Activez ce que vous voulez, dans l'ordre que vous voulez : chaque page explique, réglage par réglage, avec une conversation d'exemple." actions={<Link to="/app/automations" className={buttonClass({ variant: "secondary" })}>Journal des tâches{counts.data?.awaiting ? ` (${counts.data.awaiting})` : ""}</Link>} />

      <QueryBoundary query={summary} skeleton="spinner">{(sum) => <AutomationStatusBoard summary={sum} />}</QueryBoundary>

      <h2 className="mb-3 text-sm font-bold tracking-wider text-text uppercase">Les automatisations du compte</h2>
      <ul className="mb-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {blocks.map((b) => (
          <li key={b.to}>
            <Link to={b.to} className="card group flex h-full flex-col gap-3 p-5 transition-colors hover:border-accent/50">
              <span className="flex items-center justify-between gap-2">
                <span className="inline-flex size-10 items-center justify-center rounded-lg bg-accent-soft text-accent [&>svg]:size-5" aria-hidden>{b.icon}</span>
                <StatusBadge tone={b.on ? "success" : "muted"}>{b.on ? "Activé" : "Arrêté"}</StatusBadge>
              </span>
              <span className="text-base font-bold text-text">{b.title}</span>
              <span className="text-sm text-text-muted">{b.text}</span>
              <span className="mt-auto inline-flex items-center gap-1 text-sm font-semibold text-accent">Régler <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden /></span>
            </Link>
          </li>
        ))}
        <li>
          <Link to="/app/automatisation/relances" className="card group flex h-full flex-col gap-3 p-5 transition-colors hover:border-accent/50">
            <span className="flex items-center justify-between gap-2">
              <span className="inline-flex size-10 items-center justify-center rounded-lg bg-accent-soft text-accent [&>svg]:size-5" aria-hidden><BellRing /></span>
              <StatusBadge tone={followUp?.state === "on" ? "success" : "muted"}>{followUp?.state === "on" ? "Activé" : "Arrêté"}</StatusBadge>
            </span>
            <span className="text-base font-bold text-text">Relances</span>
            <span className="text-sm text-text-muted">Une relance par acheteur resté sans réponse après 24 h, sans chiffre ni « dernier prix ».</span>
            <span className="mt-auto inline-flex items-center gap-1 text-sm font-semibold text-accent">Régler <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden /></span>
          </Link>
        </li>
      </ul>

      <h2 className="mb-1 text-sm font-bold tracking-wider text-text uppercase">Le parcours, étape par étape</h2>
      <p className="mb-4 max-w-3xl text-sm text-text-muted">Les six étapes de votre activité, de haut en bas. Les pastilles montrent ce qui est automatisé aujourd'hui.</p>
      <ol className="flex flex-col">
        {stages.map((st, i) => (
          <li key={st.n} className="relative pb-6 pl-14">
            {i < stages.length - 1 ? <span className="absolute top-11 bottom-0 left-[19px] w-px bg-border" aria-hidden /> : null}
            <span className="absolute top-0 left-0 inline-flex size-10 items-center justify-center rounded-full border border-border-strong bg-surface text-text [&>svg]:size-[18px]" aria-hidden>{st.icon}</span>
            <div className="card flex flex-col gap-3 p-5 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0 max-w-2xl">
                <h3 className="text-base font-bold text-text"><span className="num mr-1.5 text-text-muted">{st.n}.</span>{st.title}</h3>
                <p className="mt-1 text-sm text-text-muted">{st.text}</p>
                <ul className="mt-2.5 flex flex-wrap gap-1.5">
                  {st.states.map((x) => <li key={x.label} className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", x.on === null ? "border border-dashed border-border text-text-muted" : x.on ? "bg-success/10 text-success" : "bg-surface-muted text-text-muted")}><span className={cn("size-1.5 rounded-full", x.on === null ? "bg-border-strong" : x.on ? "bg-success" : "bg-border-strong")} aria-hidden />{x.label}{x.on === false ? " : arrêté" : ""}</li>)}
                </ul>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {st.links.map((l, j) => <Link key={l.to + l.label} to={l.to} className={buttonClass({ variant: j === 0 ? "secondary" : "ghost", size: "sm" })}>{l.label}</Link>)}
              </div>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-2 flex items-start gap-2 text-xs text-text-muted"><Radar className="mt-0.5 size-3.5 shrink-0" aria-hidden />{mode === "demo" ? "En démonstration, rien n'est envoyé ni acheté. " : ""}Avec un compte Vinted, les actions passent par l'extension, navigateur ouvert ; Selio Cloud, intégré à Selio Manager, les fera tourner ordinateur éteint. Les comptes Perso ne sont jamais automatisés.</p>
    </>
  );
}
