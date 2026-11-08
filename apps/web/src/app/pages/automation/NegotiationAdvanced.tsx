import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { FlaskConical, Plus, Trash2 } from "lucide-react";
import { keywordSituation, quotasForPlan, type AutomationRule, type FollowUp24hMode, type KeywordSituation, type MarginRules, type NegotiationAutomation, type VintedLimits } from "@selio/contracts";
import {
  SUGGESTED_KEYWORD_SITUATIONS, VINTED_LIMITS_MEASUREMENT_PROTOCOL, bundleMessage, bundlePolicyFor, evaluateBundleOffer, matchSituation, roundOffer, situationPromptContext, situationTemplateReply, vintedLimitsStatus,
} from "@selio/domain";
import { Button, Checkbox, IconButton, Input, Segmented, StatusBadge, Textarea, Toggle, cn, formatCents, formatDate } from "@selio/ui";
import { useClient, useRequiredSession } from "../../../lib/data/provider";
import type { VintedLimitsView } from "../../../lib/data/types";
import { FOLLOW_UP_MODE_LABELS, followUpHasDigits, followUpText } from "../../../lib/selling/negotiation";
import { useAppMutation } from "../../components/hooks";
import { BUYER, ChatMock, Journey, JourneyStep, NumberInput, PercentInput, SAMPLE, Sentence, TemplateField, pct, type ChatLine } from "./shared";

const eur = (c: number) => formatCents(c);
const BUNDLE_VARS = ["{prenom}", "{prix}", "{prix_initial}", "{nb_articles}", "{articles}"] as const;

/** Règle D20 sur les gabarits : « meilleur prix » jamais ; « dernier prix » seulement dans l'offre finale. */
export function wordingProblems(messages: Pick<NegotiationAutomation["messages"], "bundleCounter" | "bundleFinal" | "bundleAccepted" | "followUp">): string[] {
  const out: string[] = [];
  const all = [messages.bundleCounter, messages.bundleFinal, messages.bundleAccepted, messages.followUp];
  if (all.some((t) => /meilleur prix/i.test(t))) out.push("« meilleur prix » n'est jamais écrit");
  if ([messages.bundleCounter, messages.bundleAccepted, messages.followUp].some((t) => /dernier prix/i.test(t))) out.push("« dernier prix » seulement dans l'offre finale du lot");
  if (followUpHasDigits(messages.followUp)) out.push("la relance ne contient ni prix ni chiffre");
  return out;
}

/** Erreurs de saisie des situations (schéma partagé avec le serveur). */
export function situationProblems(situations: readonly KeywordSituation[]): string[] {
  return situations.flatMap((s, i) => {
    const r = keywordSituation.safeParse(s);
    if (r.success) return [];
    return [`situation ${i + 1}${s.name ? ` « ${s.name} »` : ""} : ${r.error.issues.map((x) => (x.path[0] === "keywords" ? "mots-clés de 2 à 60 caractères" : x.path[0] === "name" ? "nom obligatoire" : x.message)).join(", ")}`];
  });
}

/**
 * Négociation avancée (§5.12) : offres sur un lot, relance après 24 h, situations par mots-clés et
 * limites de Vinted. Comme pour l'article seul, la politique déterministe décide et mon IA perso rédige ;
 * une situation ne peut que vous transmettre la conversation, jamais accepter ni changer un prix.
 */
export function AdvancedNegotiation({ n, set, msg, margin, situations, setSituations, editable, price }: {
  n: NegotiationAutomation;
  set: <K extends keyof NegotiationAutomation>(k: K, v: NegotiationAutomation[K]) => void;
  msg: (k: keyof NegotiationAutomation["messages"], v: string) => void;
  margin: MarginRules;
  situations: KeywordSituation[];
  setSituations: (s: KeywordSituation[]) => void;
  editable: boolean;
  price: number;
}) {
  return (
    <>
      <h2 className="mt-4 mb-1 text-sm font-bold tracking-wider text-text uppercase">Négociation avancée</h2>
      <p className="mb-6 max-w-2xl text-sm text-text-muted">Lots, relance, situations particulières et limites de Vinted. Les mêmes garde-fous s'appliquent : vos règles décident, mon IA perso rédige.</p>
      <Journey label="Étapes de la négociation avancée">
        <BundleStep n={n} set={set} msg={msg} margin={margin} editable={editable} price={price} />
        <FollowUpStep n={n} msg={msg} editable={editable} />
        <JourneyStep
          n={13}
          level="Avancé"
          title="Situations par mots-clés"
          done={situations.some((s) => s.enabled)}
          intro={<>Un défaut signalé, une demande de remboursement, une question d'envoi : quand le message contient vos <strong className="text-text">mots-clés</strong>, Selio répond avec votre gabarit ou votre consigne, ou vous transmet la conversation.</>}
        >
          <SituationsEditor situations={situations} onChange={setSituations} editable={editable} />
        </JourneyStep>
        <VintedLimitsStep editable={editable} />
      </Journey>
    </>
  );
}

// ---------------------------------------------------------------- lots

function BundleStep({ n, set, msg, margin, editable, price }: { n: NegotiationAutomation; set: <K extends keyof NegotiationAutomation>(k: K, v: NegotiationAutomation[K]) => void; msg: (k: keyof NegotiationAutomation["messages"], v: string) => void; margin: MarginRules; editable: boolean; price: number }) {
  const second = 1200;
  // Deux articles d'exemple : achetés à 40 % de leur prix affiché, plancher suggéré par vos règles de marge.
  const items = [price, second].map((listed) => ({ listedPriceCents: listed, purchasePriceCents: Math.round(listed * 0.4), purchaseFeesCents: 0, floorPriceCents: null }));
  const total = price + second;
  const policy = bundlePolicyFor(n, items.length);
  const offer = roundOffer(total * 0.62);
  const result = evaluateBundleOffer({ items, offerCents: offer, rules: margin, bundlePolicy: policy, roundsSoFar: 0 });
  const reply = n.bundle.enabled ? bundleMessage(result, n.messages, { prenom: BUYER, titles: [SAMPLE.title, SAMPLE.second?.title ?? "Pull rayé"] }) : null;
  const decided = !n.bundle.enabled ? "Offre sur un lot transmise à vous : jamais jugée comme une offre sur un seul article." : result.decision === "accept" ? "Offre acceptée" : result.decision === "counter" ? `Contre-offre de lot à ${eur(result.counterCents ?? 0)}` : result.decision === "decline" ? "Offre refusée" : "Transmise à vous";
  const lines: ChatLine[] = [
    { from: "buyer", text: `Je prends aussi « ${SAMPLE.second?.title ?? "le pull rayé"} ». ${eur(offer)} pour les deux ?`, time: "19:12" },
    { from: "offer", by: "buyer", cents: offer, originalCents: total, status: "lot" },
    { from: "event", text: n.bundle.enabled ? `Plancher du lot : ${eur(result.floorCents)} (jamais sous ${eur(result.floorSumCents)}, la somme des planchers)` : decided, tone: n.bundle.enabled ? "accent" : "muted" },
    ...(reply ? [{ from: "seller", text: reply, time: "19:18", auto: true } as ChatLine] : []),
    ...(n.bundle.enabled && result.decision === "counter" && result.counterCents !== null ? [{ from: "offer", by: "seller", cents: result.counterCents, originalCents: total, status: result.counterCents <= result.floorCents ? "finale" : "lot", auto: true } as ChatLine] : []),
  ];
  return (
    <JourneyStep
      n={11}
      level="Avancé"
      title="Offres sur un lot"
      done={n.bundle.enabled}
      intro={<>Un acheteur fait <strong className="text-text">une offre pour plusieurs articles</strong> : Selio évalue le lot comme un seul article, avec les mêmes étapes de réduction, et ne descend jamais sous la somme des planchers de ses articles.</>}
      illustration={<ChatMock priceCents={total} title={`Lot de 2 articles (${eur(total)})`} caption={n.bundle.enabled ? <>{decided}. Prix retenu réparti au prorata : {result.perItemAllocationCents.map((c) => eur(c)).join(" + ")}.</> : decided} lines={lines} />}
    >
      <Toggle label="Négocier les offres sur un lot" description={n.bundle.enabled ? "Les offres sur plusieurs articles suivent la politique ci-dessous." : "Arrêté : une offre sur un lot vous est confiée."} checked={n.bundle.enabled} onChange={(v) => set("bundle", { ...n.bundle, enabled: v })} disabled={!editable} />
      <Sentence hint={`Au moins la remise de lot que vous proposez vous-même (${pct(n.lot.twoItemsRate)} pour 2 articles) ; jamais sous la somme des planchers des articles.`}>
        Sur un lot, j'accepte jusqu'à <PercentInput label="Remise maximale sur un lot (%)" value={n.bundle.maxDiscountRate} min={0} max={60} disabled={!editable || !n.bundle.enabled} onChange={(v) => set("bundle", { ...n.bundle, maxDiscountRate: v })} /> de remise, à partir de <NumberInput label="Nombre minimal d'articles d'un lot" value={n.bundle.minItems} min={2} max={20} width="w-16" disabled={!editable || !n.bundle.enabled} onChange={(v) => set("bundle", { ...n.bundle, minItems: v })} /> articles.
      </Sentence>
      <TemplateField label="Contre-offre de lot" value={n.messages.bundleCounter} onChange={(v) => msg("bundleCounter", v)} disabled={!editable} vars={BUNDLE_VARS} hint="Formule neutre : jamais « meilleur prix », ni « dernier prix »." />
      <TemplateField label="Offre finale de lot (au plancher du lot)" value={n.messages.bundleFinal} onChange={(v) => msg("bundleFinal", v)} disabled={!editable} vars={BUNDLE_VARS} hint="Le seul message de lot qui peut dire « dernier prix » : il part au plancher du lot." />
      <TemplateField label="Lot accepté" value={n.messages.bundleAccepted} onChange={(v) => msg("bundleAccepted", v)} disabled={!editable} vars={BUNDLE_VARS} />
    </JourneyStep>
  );
}

// ---------------------------------------------------------------- relance après 24 h

function FollowUpStep({ n, msg, editable }: { n: NegotiationAutomation; msg: (k: keyof NegotiationAutomation["messages"], v: string) => void; editable: boolean }) {
  const client = useClient();
  const session = useRequiredSession();
  const sub = useQuery({ queryKey: ["subscription"], queryFn: () => client.getSubscription(), staleTime: 30_000 });
  const rules = useQuery({ queryKey: ["rules"], queryFn: () => client.listRules() });
  const mode: FollowUp24hMode | null = sub.data ? sub.data.quotas.followUp24h ?? quotasForPlan(sub.data.plan).followUp24h : null;
  const rule: AutomationRule | undefined = rules.data?.find((r) => r.kind === "follow_up_24h");
  const active = Boolean(rule?.enabled) && mode !== "none";
  const toggle = useAppMutation(async (on: boolean) => {
    const schedule = { startHour: n.timing.activeFrom, endHour: Math.max(n.timing.activeFrom + 1, n.timing.activeTo), timezone: session.org.settings.timezone };
    if (rule) return client.updateRule(rule.id, { enabled: on, requiresApproval: mode !== "auto", schedule });
    return client.createRule({ name: "Relance après 24 h sans réponse", kind: "follow_up_24h", enabled: on, requiresApproval: mode !== "auto", runsIn: "server", schedule, config: { delayHours: 24 } });
  }, { invalidate: ["rules"], success: (r) => (r.enabled ? "Relance après 24 h activée" : "Relance après 24 h arrêtée") });
  const label = mode ? FOLLOW_UP_MODE_LABELS[mode] : null;
  const preview = followUpText(n.messages.followUp, { prenom: BUYER, article: SAMPLE.title });
  const lines: ChatLine[] = [
    { from: "seller", text: `Bonjour ${BUYER}, oui l'article est toujours disponible !`, time: "Lun. 18:20" },
    { from: "event", text: "24 h sans réponse", tone: "muted" },
    ...(mode === "suggested" ? [{ from: "event", text: "Brouillon de relance prêt : à valider dans la messagerie", tone: "accent" } as ChatLine, { from: "seller", text: preview, time: "brouillon" } as ChatLine]
      : mode === "auto" ? [{ from: "seller", text: preview, time: "Mar. 18:31", auto: true } as ChatLine, { from: "event", text: "Envoyée via Selio Cloud", tone: "success" } as ChatLine]
        : [{ from: "event", text: "Relance non comprise dans votre offre", tone: "muted" } as ChatLine]),
  ];
  return (
    <JourneyStep
      n={12}
      level="Avancé"
      title="Relance après 24 h"
      done={active}
      intro={<>L'acheteur n'a pas répondu depuis 24 h ? Une <strong className="text-text">seule relance</strong>, courte et sans prix, relance la conversation. Jamais deux, jamais en dehors de vos heures actives (de {n.timing.activeFrom} h à {n.timing.activeTo} h), plus rien au-delà de 7 jours.</>}
      illustration={<ChatMock priceCents={2000} caption={label ? label.detail : "Chargement de votre offre…"} lines={lines} />}
    >
      <div className="flex flex-wrap items-center gap-2" aria-live="polite">
        {label ? <StatusBadge tone={mode === "none" ? "muted" : mode === "auto" ? "accent" : "success"}>{label.title}</StatusBadge> : <StatusBadge tone="muted">Offre en cours de chargement</StatusBadge>}
        {mode === "auto" ? <Link to="/cloud" className="text-sm font-medium text-accent hover:underline">via Selio Cloud</Link> : null}
        {mode === "none" ? <Link to="/app/settings/billing" className="text-sm font-medium text-accent hover:underline">Voir les offres</Link> : null}
      </div>
      <Toggle
        label="Relancer après 24 h sans réponse"
        description={mode === "none" ? "Proposée en Pro (brouillon à valider) et automatique en Agence (via Selio Cloud)." : mode === "auto" ? "La relance part seule depuis Selio Cloud, dans ses plafonds." : "Selio prépare un brouillon : rien ne part sans votre clic."}
        checked={active}
        onChange={(v) => toggle.mutate(v)}
        disabled={!editable || !mode || mode === "none" || toggle.isPending || rules.isLoading}
      />
      <TemplateField label="Message de relance" value={n.messages.followUp} onChange={(v) => msg("followUp", v)} disabled={!editable} vars={["{prenom}", "{article}"]} hint="Sans prix ni chiffre, sans pression : une relance n'est jamais une nouvelle offre." />
    </JourneyStep>
  );
}

// ---------------------------------------------------------------- situations par mots-clés

const newSituation = (): KeywordSituation => ({ id: `sit-${Math.random().toString(36).slice(2, 10)}`, name: "", keywords: [], matchMode: "any", response: { kind: "template", template: "" }, decisionOverride: null, enabled: true });

/** Liste, éditeur et test local des situations (aucune requête : le message d'essai ne quitte pas le navigateur). */
export function SituationsEditor({ situations, onChange, editable }: { situations: KeywordSituation[]; onChange: (s: KeywordSituation[]) => void; editable: boolean }) {
  const update = (i: number, patch: Partial<KeywordSituation>) => onChange(situations.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const suggestions = SUGGESTED_KEYWORD_SITUATIONS.filter((x) => !situations.some((s) => s.id === x.id));
  const problems = situationProblems(situations);
  return (
    <div className="flex flex-col gap-4">
      {situations.length === 0 ? <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-text-muted">Aucune situation pour l'instant. Partez d'un exemple ou créez la vôtre.</p> : null}
      <ul className="flex flex-col gap-3" aria-label="Situations par mots-clés">
        {situations.map((s, i) => (
          <li key={s.id} className="flex flex-col gap-3 rounded-lg border border-border p-3" aria-label={s.name || `Situation ${i + 1}`}>
            <div className="flex flex-wrap items-center gap-2">
              <Input aria-label={`Nom de la situation ${i + 1}`} value={s.name} maxLength={80} placeholder="Ex. : Défaut signalé" disabled={!editable} onChange={(e) => update(i, { name: e.target.value })} className="min-w-0 flex-1" />
              <Toggle label="Active" checked={s.enabled} onChange={(v) => update(i, { enabled: v })} disabled={!editable} />
              <IconButton label={`Supprimer la situation ${i + 1}`} size="sm" disabled={!editable} onClick={() => onChange(situations.filter((_, j) => j !== i))}><Trash2 /></IconButton>
            </div>
            <label className="text-sm font-semibold text-text">
              Mots-clés <span className="font-normal text-text-muted">(séparés par des virgules)</span>
              <KeywordsInput label={`Mots-clés de la situation ${i + 1}`} value={s.keywords} disabled={!editable} onChange={(keywords) => update(i, { keywords })} />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Segmented ariaLabel={`Correspondance de la situation ${i + 1}`} size="sm" value={s.matchMode} onChange={(v) => update(i, { matchMode: v })} items={[{ value: "any", label: "L'un des mots" }, { value: "all", label: "Tous les mots" }]} />
              <Segmented ariaLabel={`Réponse de la situation ${i + 1}`} size="sm" value={s.response.kind} onChange={(v) => update(i, { response: { ...s.response, kind: v } })} items={[{ value: "template", label: "Gabarit" }, { value: "ai", label: "Mon IA perso" }]} />
            </div>
            {s.response.kind === "template" ? (
              <TemplateField label="Réponse" value={s.response.template ?? ""} onChange={(v) => update(i, { response: { ...s.response, template: v } })} disabled={!editable} vars={["{prenom}", "{article}", "{prix}"]} />
            ) : (
              <label className="text-sm font-semibold text-text">
                Consigne pour mon IA perso <span className="font-normal text-text-muted">(ton, contenu ; 300 caractères)</span>
                <Textarea className="mt-1.5 font-normal" rows={2} maxLength={300} value={s.response.guidance ?? ""} disabled={!editable} onChange={(e) => update(i, { response: { ...s.response, guidance: e.target.value } })} placeholder="Remercie, dis que tu vérifies, ne promets rien." />
              </label>
            )}
            <Toggle label="Me transmettre la conversation" description="Aucune réponse de prix automatique : vous validez vous-même." checked={s.decisionOverride === "escalate"} onChange={(v) => update(i, { decisionOverride: v ? "escalate" : null })} disabled={!editable} />
          </li>
        ))}
      </ul>
      {editable ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" icon={<Plus />} onClick={() => onChange([...situations, newSituation()])} disabled={situations.length >= 50}>Nouvelle situation</Button>
          {suggestions.map((x) => <Button key={x.id} variant="ghost" size="sm" icon={<Plus />} onClick={() => onChange([...situations, { ...x, keywords: [...x.keywords], response: { ...x.response } }])}>Exemple : {x.name}</Button>)}
        </div>
      ) : null}
      {problems.length ? <p role="alert" className="text-xs text-danger">À corriger : {problems.join(" ; ")}.</p> : null}
      <SituationTester situations={situations} />
      <p className="text-xs text-text-muted">Le message de l'acheteur est seulement comparé à vos mots-clés (sans accents ni majuscules, mots entiers), jamais suivi comme une consigne. Une situation peut vous transmettre la conversation ; elle ne peut ni accepter, ni refuser, ni changer un prix.</p>
    </div>
  );
}

/** Mots-clés saisis librement, séparés par des virgules (le texte tapé est gardé tel quel pendant la saisie). */
function KeywordsInput({ label, value, onChange, disabled }: { label: string; value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const [text, setText] = useState(value.join(", "));
  return <Input className="mt-1.5 font-normal" aria-label={label} value={text} disabled={disabled} placeholder="défaut, tache, trou" onChange={(e) => { setText(e.target.value); onChange(e.target.value.split(",").map((k) => k.trim()).filter(Boolean).slice(0, 20)); }} />;
}

/** « Essayer avec un message » : la correspondance est calculée ici, dans le navigateur. */
function SituationTester({ situations }: { situations: readonly KeywordSituation[] }) {
  const [text, setText] = useState("");
  const match = text.trim() ? matchSituation(text, situations) : null;
  const ctx = match ? situationPromptContext(match) : null;
  const reply = match ? situationTemplateReply(match, { prenom: BUYER, article: SAMPLE.title }) : null;
  return (
    <section aria-label="Essayer avec un message" className="rounded-lg bg-surface-muted p-3">
      <label className="flex flex-col gap-1.5 text-sm font-semibold text-text">
        <span className="flex items-center gap-1.5"><FlaskConical className="size-4 text-text-muted" aria-hidden />Essayer avec un message</span>
        <Input className="font-normal" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Ex. : Bonjour, il y a une tache sur la manche ?" />
      </label>
      {text.trim() ? (
        <div className="mt-2 text-sm" aria-live="polite" data-testid="situation-result">
          {match ? (
            <>
              <p className="font-medium text-text">Situation « {match.situation.name || "sans nom"} » <span className="font-normal text-text-muted">(mots-clés : {match.matchedKeywords.join(", ")})</span></p>
              {match.situation.decisionOverride === "escalate" ? <p className="text-text-muted">Conversation transmise à vous : aucune réponse de prix automatique.</p> : null}
              {reply ? <p className="mt-1 rounded-lg border border-border bg-surface px-3 py-2 text-text">{reply}</p> : match.situation.response.kind === "ai" ? <p className="text-text-muted">Réponse rédigée par mon IA perso{ctx?.guidance ? <>, avec votre consigne : « {ctx.guidance} »</> : ""}, puis vérifiée avant de partir.</p> : <p className="text-text-muted">Aucun gabarit : écrivez la réponse de cette situation.</p>}
            </>
          ) : <p className="text-text-muted">Aucune situation ne correspond : la négociation et la réponse automatique habituelles s'appliquent.</p>}
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- limites de Vinted

const ORIGIN_LABELS: Record<VintedLimitsView["origin"], string> = {
  org_measured: "mesure de votre organisation",
  global_measured: "mesure de l'équipe Selio",
  settings: "valeurs prudentes par défaut",
};

function VintedLimitsStep({ editable }: { editable: boolean }) {
  const client = useClient();
  const session = useRequiredSession();
  // Limites RÉELLEMENT appliquées par le serveur (mesure de l'organisation, de l'équipe, ou valeurs prudentes), jamais les réglages de session.
  const view = useQuery({ queryKey: ["vinted-limits"], queryFn: () => client.getVintedLimits() });
  const limits: VintedLimits = view.data?.limits ?? session.org.settings.automation.vintedLimits;
  const status = view.data?.status ?? vintedLimitsStatus(limits);
  const [form, setForm] = useState({ maxCounterOffersPerConversation: limits.maxCounterOffersPerConversation, offerDurationHours: limits.offerDurationHours, minDelayBetweenMessagesSeconds: limits.minDelayBetweenMessagesSeconds });
  const [confirmed, setConfirmed] = useState(false);
  const record = useAppMutation(() => client.recordVintedLimits(form), { invalidate: ["vinted-limits", "session"], success: "Mesure enregistrée et datée", onSuccess: () => setConfirmed(false) });
  const canRecord = editable && (view.data?.canRecord.org ?? true);
  const suffix = status.measured ? "mesurée" : "valeur prudente, à mesurer";
  const rows = [
    { label: "Contre-offres par conversation", value: `${limits.maxCounterOffersPerConversation}` },
    { label: "Durée d'une offre", value: `${limits.offerDurationHours} h` },
    { label: "Délai entre deux messages", value: `${limits.minDelayBetweenMessagesSeconds} s` },
  ];
  return (
    <JourneyStep
      n={14}
      level="Avancé"
      title="Limites de Vinted"
      last
      done={status.measured}
      intro={<>Combien de contre-offres Vinted laisse-t-il par conversation, combien de temps dure une offre, quel délai entre deux messages ? <strong className="text-text">Personne ne le sait avec certitude</strong> tant que ce n'est pas mesuré sur un vrai compte : Selio applique des valeurs prudentes, sans jamais les présenter comme vérifiées.</>}
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={status.measured ? "success" : "warning"}>{status.measured ? "Mesurées" : "À mesurer"}</StatusBadge>
        <span className="text-sm text-text-muted" data-testid="vinted-limits-status">{status.measured && limits.measuredAt ? `Mesurées sur un vrai compte le ${formatDate(limits.measuredAt, "long")}` : status.label}{view.data ? ` (${ORIGIN_LABELS[view.data.origin]})` : ""}</span>
      </div>
      <dl className="grid gap-2 sm:grid-cols-3">
        {rows.map((r) => (
          <div key={r.label} className="rounded-lg border border-border px-3 py-2">
            <dt className="text-xs text-text-muted">{r.label}</dt>
            <dd className="num text-lg font-semibold text-text">{r.value}</dd>
            <dd className="text-[11px] text-text-muted">{suffix}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-text-muted">La politique ne les dépasse jamais : au-delà du nombre de contre-offres, la conversation vous est transmise ; un message trop proche du précédent attend son tour.</p>
      {view.data && view.data.history.length > 0 ? (
        <details className="rounded-lg border border-border px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium text-text">Mesures enregistrées ({view.data.history.length})</summary>
          <ul className="mt-2 flex flex-col gap-1 text-text-muted">
            {view.data.history.map((h) => (
              <li key={h.id}>{h.measuredAt ? formatDate(h.measuredAt, "long") : "sans date"} : {h.maxCounterOffersPerConversation} contre-offres, {h.offerDurationHours} h, {h.minDelayBetweenMessagesSeconds} s{h.orgId === null ? " (équipe Selio)" : ""}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <details className="rounded-lg border border-border px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium text-text">Protocole de mesure (à la main, sur un compte de l'équipe)</summary>
        <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 text-text-muted">
          {VINTED_LIMITS_MEASUREMENT_PROTOCOL.map((s) => <li key={s.step}><span className="font-medium text-text">{s.title}.</span> {s.detail}</li>)}
        </ol>
      </details>
      {canRecord ? (
        <form className={cn("flex flex-col gap-3 rounded-lg bg-surface-muted p-3")} aria-label="Enregistrer une mesure des limites de Vinted" onSubmit={(e) => { e.preventDefault(); if (confirmed) record.mutate(undefined); }}>
          <p className="text-sm font-semibold text-text">Enregistrer une mesure (administrateurs)</p>
          <Sentence>
            J'ai mesuré <NumberInput label="Contre-offres mesurées par conversation" value={form.maxCounterOffersPerConversation} min={1} max={20} width="w-16" onChange={(v) => setForm((f) => ({ ...f, maxCounterOffersPerConversation: v }))} /> contre-offres, une offre valable <NumberInput label="Durée mesurée d'une offre (heures)" value={form.offerDurationHours} min={1} max={168} width="w-20" suffix="h" onChange={(v) => setForm((f) => ({ ...f, offerDurationHours: v }))} /> et <NumberInput label="Délai mesuré entre deux messages (secondes)" value={form.minDelayBetweenMessagesSeconds} min={0} max={3600} width="w-20" suffix="s" onChange={(v) => setForm((f) => ({ ...f, minDelayBetweenMessagesSeconds: v }))} /> entre deux messages.
          </Sentence>
          <Checkbox label="J'ai fait cette mesure moi-même, à la main, sur un compte de l'équipe (jamais celui d'un client), en m'arrêtant au premier avertissement." checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="text-sm" />
          <div><Button type="submit" variant="secondary" disabled={!confirmed} loading={record.isPending}>Valider cette mesure</Button></div>
          <p className="text-xs text-text-muted">La date est ajoutée par Selio. Une mesure reste une observation datée : refaites-la chaque trimestre et après un changement de Vinted.</p>
        </form>
      ) : null}
    </JourneyStep>
  );
}
