import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Check, ChevronRight } from "lucide-react";
import { Alert, Button, Card, Field, Input, PageHeader, ProgressBar, Select, Toggle, cn, formatNumber } from "@selio/ui";
import { useClient, useData, useRequiredSession } from "../../lib/data/provider";
import { MoneyInput } from "../components/common";
import { useAppMutation } from "../components/hooks";

const STEPS = [
  { key: "account", title: "Compte et organisation", description: "Nom de l'organisation et de l'utilisateur." },
  { key: "preferences", title: "Préférences", description: "Devise, fuseau horaire, langue." },
  { key: "mode", title: "Démonstration ou connexion", description: "Choisir le mode de travail." },
  { key: "extension", title: "Extension navigateur", description: "Créer un jeton et associer l'extension." },
  { key: "ai", title: "Règles IA et marge", description: "Plancher, marge minimale, validation." },
  { key: "checklist", title: "Checklist d'installation", description: "Vérifier que tout est prêt." },
] as const;

export default function Onboarding() {
  const client = useClient();
  const session = useRequiredSession();
  const { mode } = useData();
  const navigate = useNavigate();
  const completed = new Set(session.org.settings.onboarding.completedSteps);
  const firstIncomplete = STEPS.findIndex((s) => !completed.has(s.key));
  const [current, setCurrent] = useState(firstIncomplete === -1 ? STEPS.length - 1 : firstIncomplete);
  const step = STEPS[current]!;
  const complete = useAppMutation((key: string) => client.completeOnboardingStep(key), { invalidate: ["session"], onSuccess: () => { if (current < STEPS.length - 1) setCurrent(current + 1); } });
  const dismiss = useAppMutation(() => client.updateOrg({ settings: { onboarding: { completedSteps: [...completed], dismissed: true } } }), { invalidate: ["session"], success: "Démarrage terminé", onSuccess: () => navigate("/app") });
  const [org, setOrg] = useState({ name: session.org.name, timezone: session.org.settings.timezone });
  const saveOrg = useAppMutation(() => client.updateOrg({ name: org.name, settings: { timezone: org.timezone } }), { invalidate: ["session"], onSuccess: () => complete.mutate(step.key) });
  const [margin, setMargin] = useState(session.org.settings.margin);
  const [ai, setAi] = useState(session.org.settings.ai);
  const saveAi = useAppMutation(() => client.updateOrg({ settings: { margin, ai } }), { invalidate: ["session"], onSuccess: () => complete.mutate(step.key) });

  return (
    <>
      <PageHeader title="Démarrage" description="Six étapes courtes pour configurer Selio. Vous pouvez revenir ici à tout moment." actions={<Button variant="ghost" onClick={() => dismiss.mutate()} loading={dismiss.isPending}>Terminer plus tard</Button>} />
      <ProgressBar value={completed.size} max={STEPS.length} label="Progression" className="mb-6 max-w-md" />
      <div className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
        <ol className="flex flex-col gap-1">
          {STEPS.map((s, i) => (
            <li key={s.key}>
              <button type="button" onClick={() => setCurrent(i)} className={cn("flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm", i === current ? "bg-surface-muted text-text" : "text-text-muted hover:text-text")} aria-current={i === current ? "step" : undefined}>
                <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border text-xs", completed.has(s.key) ? "border-success bg-success text-white" : "border-border-strong")}>{completed.has(s.key) ? <Check className="size-3.5" aria-hidden /> : i + 1}</span>
                <span className="min-w-0"><span className="block truncate font-medium">{s.title}</span><span className="block truncate text-xs text-text-muted">{s.description}</span></span>
              </button>
            </li>
          ))}
        </ol>
        <Card>
          <h2 className="text-md font-semibold">{step.title}</h2>
          {step.key === "account" ? (
            <div className="mt-4 flex max-w-md flex-col gap-3">
              <Field label="Nom de l'organisation">{(p) => <Input id={p.id} value={org.name} onChange={(e) => setOrg({ ...org, name: e.target.value })} />}</Field>
              <Field label="Utilisateur">{(p) => <Input id={p.id} value={`${session.user.displayName} · ${session.user.email}`} disabled />}</Field>
              <div><Button onClick={() => saveOrg.mutate()} loading={saveOrg.isPending} iconRight={<ChevronRight />}>Continuer</Button></div>
            </div>
          ) : null}
          {step.key === "preferences" ? (
            <div className="mt-4 flex max-w-md flex-col gap-3">
              <Field label="Devise">{(p) => <Select id={p.id} value="EUR" disabled><option value="EUR">EUR — euro</option></Select>}</Field>
              <Field label="Fuseau horaire" hint="Utilisé pour les horaires des automatisations.">{(p) => <Select id={p.id} aria-describedby={p.describedBy} value={org.timezone} onChange={(e) => setOrg({ ...org, timezone: e.target.value })}>{["Europe/Paris", "Europe/Brussels", "Europe/Zurich", "Europe/Luxembourg", "America/Montreal"].map((tz) => <option key={tz} value={tz}>{tz}</option>)}</Select>}</Field>
              <Field label="Langue">{(p) => <Select id={p.id} value="fr-FR" disabled><option value="fr-FR">Français</option></Select>}</Field>
              <div><Button onClick={() => saveOrg.mutate()} loading={saveOrg.isPending} iconRight={<ChevronRight />}>Continuer</Button></div>
            </div>
          ) : null}
          {step.key === "mode" ? (
            <div className="mt-4 flex flex-col gap-3">
              <Alert tone={mode === "demo" ? "info" : "success"} title={mode === "demo" ? "Vous êtes en démonstration" : "Vous êtes en mode connecté"}>{mode === "demo" ? "Données fictives persistantes dans votre navigateur, actions externes simulées. Pour passer en mode connecté, déconnectez-vous et choisissez « Compte connecté » (nécessite une API déployée)." : "Vos données sont stockées sur le serveur Selio, isolées par organisation."}</Alert>
              <div><Button onClick={() => complete.mutate(step.key)} loading={complete.isPending} iconRight={<ChevronRight />}>Continuer</Button></div>
            </div>
          ) : null}
          {step.key === "extension" ? (
            <div className="mt-4 flex flex-col gap-3 text-sm">
              <ol className="list-decimal pl-5 text-text-muted">
                <li>Installez l'extension (installation non empaquetée, voir docs/EXTENSION-INSTALL.md).</li>
                <li>Créez un jeton d'extension dans <Link to="/app/settings/connections" className="text-text underline underline-offset-2">Paramètres › Connexions</Link>.</li>
                <li>Collez le jeton dans la page Options de l'extension, puis lancez le diagnostic.</li>
              </ol>
              <p className="text-xs text-text-muted">Le jeton est limité, révocable et renouvelable. Aucun mot de passe Vinted n'est demandé.</p>
              <div className="flex gap-2"><Link to="/app/settings/connections"><Button variant="secondary">Ouvrir les connexions</Button></Link><Button onClick={() => complete.mutate(step.key)} loading={complete.isPending} iconRight={<ChevronRight />}>Continuer</Button></div>
            </div>
          ) : null}
          {step.key === "ai" ? (
            <div className="mt-4 grid max-w-xl gap-3 sm:grid-cols-2">
              <Field label="Marge minimale (%)">{(p) => <Input id={p.id} type="number" min={0} max={90} value={Math.round(margin.minMarginRate * 100)} onChange={(e) => setMargin({ ...margin, minMarginRate: Number(e.target.value) / 100 })} />}</Field>
              <Field label="Marge minimale (€)">{(p) => <MoneyInput id={p.id} value={margin.minMarginCents} onChange={(v) => setMargin({ ...margin, minMarginCents: v ?? 0 })} allowEmpty={false} />}</Field>
              <Field label="Remise maximale (%)">{(p) => <Input id={p.id} type="number" min={0} max={90} value={Math.round(margin.maxDiscountRate * 100)} onChange={(e) => setMargin({ ...margin, maxDiscountRate: Number(e.target.value) / 100 })} />}</Field>
              <Field label="Contre-propositions max par acheteur">{(p) => <Input id={p.id} type="number" min={0} max={10} value={margin.maxRoundsPerCustomer} onChange={(e) => setMargin({ ...margin, maxRoundsPerCustomer: Number(e.target.value) })} />}</Field>
              <div className="sm:col-span-2"><Toggle label="Validation humaine avant envoi des brouillons IA" description="Recommandé." checked={ai.requireApproval} onChange={(v) => setAi({ ...ai, requireApproval: v })} /></div>
              <div className="sm:col-span-2"><Button onClick={() => saveAi.mutate()} loading={saveAi.isPending} iconRight={<ChevronRight />}>Enregistrer et continuer</Button></div>
            </div>
          ) : null}
          {step.key === "checklist" ? (
            <div className="mt-4 flex flex-col gap-3 text-sm">
              <ul className="flex flex-col gap-2">
                {STEPS.slice(0, 5).map((s) => <li key={s.key} className="flex items-center gap-2"><span className={cn("size-2 rounded-full", completed.has(s.key) ? "bg-success" : "bg-gray-300")} aria-hidden />{s.title} — {completed.has(s.key) ? "fait" : "à faire"}</li>)}
                <li className="flex items-center gap-2"><span className="size-2 rounded-full bg-success" aria-hidden />Règles de marge : {formatNumber(Math.round(session.org.settings.margin.minMarginRate * 100))} % minimum</li>
              </ul>
              <div className="flex gap-2"><Button onClick={() => { complete.mutate(step.key); dismiss.mutate(); }} loading={dismiss.isPending}>Terminer le démarrage</Button></div>
            </div>
          ) : null}
        </Card>
      </div>
    </>
  );
}
