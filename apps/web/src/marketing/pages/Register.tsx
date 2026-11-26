import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { DISPLAY_NAME_MAX, ORG_NAME_MAX, PLAN_LABELS, TRIAL_DAYS, registerInput, type SignupCodeCheck } from "@selio/contracts";
import { Alert, Button, Field, Input, Segmented } from "@selio/ui";
import { TRIAL_OFFER } from "@selio/demo-data";
import { usePageMeta } from "../../lib/seo";
import { Container, Eyebrow, TrustRow } from "../components";
import { trackConversion } from "../tracking";
import { queryClient, sessionKey, useData } from "../../lib/data/provider";
import { connectedModeAvailable } from "../../lib/env";
import { errorMessage } from "../../lib/errors";
import type { Mode } from "../../lib/data/types";
import { ReferralCodeField } from "../../app/components/referral";
import { referralCodeForSignup, referralCodeFromSearch } from "../../lib/referral";
import { PromoCodeField } from "../../app/components/offers";
import { promoCodeForSignup, promoCodeFromSearch } from "../../lib/offers";
import { demoEntryAllowed } from "../demoAccess";
import { BETA_WELCOME_PATH } from "../../lib/beta";

export default function Register() {
  usePageMeta("Inscription", "Créer un compte Selio et une organisation.", { noindex: true });
  const { client, mode, setMode } = useData();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ displayName: "", orgName: "", email: "", password: "" });
  // Lien partagé « /inscription?parrain=CODE » : le code préremplit le champ (facultatif, jamais bloquant).
  const [referral, setReferral] = useState(() => referralCodeFromSearch(location.search));
  // Lien d'une offre « /inscription?code=PRINTEMPS » (bandeau, campagne) : le code promo préremplit son champ.
  const [promo, setPromo] = useState(() => promoCodeFromSearch(location.search));
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Code saisi vérifié AVANT la création du compte (sans session) : un code faux est signalé, jamais ignoré en silence.
  const [promoCheck, setPromoCheck] = useState<{ code: string; result: SignupCodeCheck } | null>(null);
  const checkPromo = async (raw: string): Promise<SignupCodeCheck | null> => {
    const code = raw.trim();
    if (!code || !client.checkSignupCode) return null;
    if (promoCheck?.code === code) return promoCheck.result;
    try {
      const result = await client.checkSignupCode(code);
      setPromoCheck({ code, result });
      return result;
    } catch {
      // Vérification impossible (réseau, limite) : le serveur jugera le code à l'inscription, sans bloquer.
      return null;
    }
  };
  const betaCode = promoCheck?.code === promo.trim() && promoCheck.result.valid ? promoCheck.result.beta ?? null : null;
  const promoError = promoCheck?.code === promo.trim() && !promoCheck.result.valid ? promoCheck.result.message : undefined;
  // Lien « /inscription?code=BETA2026SELIO » : le code est vérifié dès l'ouverture (titre et conditions de la bêta).
  useEffect(() => {
    if (promo.trim()) void checkPromo(promo);
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Production (API configurée) : aucun mode démonstration proposé, le compte est réel.
  const demoOffered = demoEntryAllowed();
  useEffect(() => {
    if (!demoOffered && mode === "demo") setMode("connected");
  }, [demoOffered, mode, setMode]);
  const submitting = useRef(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Double clic, double tap ou Entrée répétée : une seule inscription envoyée (le serveur refuse aussi le doublon).
    if (submitting.current) return;
    // Une seule durée d'essai : 14 jours (l'ancien choix 7 / 30 jours n'existe plus).
    const parsed = registerInput.safeParse({ ...form, trialDays: TRIAL_DAYS });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      // Nom et organisation : le motif exact du contrat (« 80 caractères au plus », espaces seuls, caractère de contrôle).
      for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.path[0] === "password" ? "Dix caractères minimum." : i.path[0] === "email" ? "Adresse email invalide." : i.message.startsWith("Required") || i.message.startsWith("Expected") ? "Champ requis." : i.message;
      setErrors(errs);
      return;
    }
    setErrors({});
    setError(null);
    setLoading(true);
    submitting.current = true;
    try {
      // Code faux : message clair sous le champ ; on le corrige, ou on vide le champ pour l'essai normal.
      const checked = promo.trim() ? await checkPromo(promo) : null;
      if (checked && !checked.valid) {
        setErrors({ promoCode: checked.message });
        return;
      }
      const session = await client.register({ ...parsed.data, referralCode: referralCodeForSignup(referral), promoCode: promoCodeForSignup(promo) });
      // Conversion publicitaire : seulement un vrai compte (jamais la démonstration), et seulement
      // si la mesure ou la publicité est configurée et acceptée (../tracking.ts).
      if (mode === "connected") trackConversion("inscription");
      // La session ouverte remplace celle en cache (« aucune session », lue par la vitrine), comme à la connexion :
      // sinon l'espace client relirait « aucune session » et renverrait vers la page de connexion.
      queryClient.setQueryData([...sessionKey, mode], session);
      // Réponses du serveur sur les codes (enregistré, ignoré, refusé) : affichées à l'arrivée dans l'application.
      const referralMessage = [session.referral?.message, session.promo?.message].filter((m): m is string => typeof m === "string").join(" ");
      // Code de la bêta : « Bienvenue dans la bêta » d'abord, puis le démarrage.
      navigate(session.promo?.applied && session.promo.beta ? BETA_WELCOME_PATH : "/app/onboarding", { replace: true, state: referralMessage ? { referralMessage } : undefined });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };
  return (
    <section className="mk-hero py-12 md:py-16">
      <Container className="max-w-md">
        <Eyebrow>Espace Selio</Eyebrow>
        <h1 className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-text">{betaCode ? "Rejoindre la bêta Selio" : `Commencer l'essai gratuit de ${TRIAL_DAYS} jours`}</h1>
        <p className="mt-1 text-sm text-text-muted">Un compte, une organisation, les cinq filiales Selio. Vous pourrez inviter des collègues ensuite.</p>
        <TrustRow className="mt-4" only={["carte", "essai", "resiliable"]} />
        {demoOffered ? (
          <div className="mt-4">
            <Segmented ariaLabel="Mode" value={mode} onChange={(m: Mode) => setMode(m)} items={[{ value: "demo", label: "Démonstration" }, { value: "connected", label: "Compte connecté" }]} />
          </div>
        ) : null}
        {mode === "connected" && !connectedModeAvailable ? <Alert tone="warning" title="Aucune API configurée" className="mt-4">Le mode connecté nécessite une API déployée (VITE_API_BASE_URL). Vous pouvez créer un compte de démonstration.</Alert> : null}
        {mode === "demo" && demoOffered ? <Alert tone="info" className="mt-4">En démonstration, le compte est créé localement dans votre navigateur avec des données fictives.</Alert> : null}
        <form onSubmit={submit} className="card mt-4 flex flex-col gap-4 p-5" noValidate>
          <Field label="Votre nom" required error={errors.displayName}>{(p) => <Input id={p.id} invalid={p.invalid} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} autoComplete="name" maxLength={DISPLAY_NAME_MAX} />}</Field>
          <Field label="Nom de l'organisation" required error={errors.orgName} hint="Votre boutique, votre atelier, votre nom de vendeur.">{(p) => <Input id={p.id} invalid={p.invalid} aria-describedby={p.describedBy} value={form.orgName} onChange={(e) => setForm({ ...form, orgName: e.target.value })} autoComplete="organization" maxLength={ORG_NAME_MAX} />}</Field>
          <Field label="Email" required error={errors.email}>{(p) => <Input id={p.id} type="email" invalid={p.invalid} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" />}</Field>
          <Field label="Mot de passe" required error={errors.password} hint="Dix caractères minimum.">{(p) => <Input id={p.id} type="password" invalid={p.invalid} aria-describedby={p.describedBy} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />}</Field>
          <ReferralCodeField value={referral} onChange={setReferral} />
          <PromoCodeField
            value={promo}
            onChange={(v) => { setPromo(v); setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== "promoCode"))); }}
            onBlur={() => void checkPromo(promo)}
            error={errors.promoCode ?? promoError}
            hint={betaCode ? `Code bêta valable : ${betaCode.days} jours de Selio ${PLAN_LABELS[betaCode.plan]} offerts, sans carte bancaire.` : undefined}
          />
          {betaCode ? (
            <div className="rounded-md border border-gold-300/60 bg-gold-soft px-3 py-2.5" data-testid="beta-terms">
              <p className="text-sm font-medium text-gold-text">Bêta Selio : {betaCode.days} jours offerts, sans carte bancaire.</p>
              <p className="mt-0.5 text-xs text-text-muted">Toutes les fonctions du plan {PLAN_LABELS[betaCode.plan]} pendant la bêta, rien à payer (facture à 0,00 €). À la fin du mois, ajoutez un moyen de paiement pour continuer ; vos données sont toujours conservées.</p>
            </div>
          ) : (
            <div className="rounded-md bg-surface-muted px-3 py-2.5" data-testid="trial-terms">
              <p className="text-sm font-medium text-text">{TRIAL_DAYS} jours d'essai, rien n'est débité avant la fin.</p>
              <p className="mt-0.5 text-xs text-text-muted">Toutes les fonctions du plan {PLAN_LABELS[TRIAL_OFFER.plan]} pendant l'essai ; ensuite Starter, Pro ou Agence au choix, ou vous arrêtez sans frais. <Link to="/tarifs" className="underline underline-offset-2">Voir les tarifs</Link></p>
              <p className="mt-1.5 text-xs text-text-muted">Aucune carte à saisir maintenant : elle vous sera demandée plus tard dans l'application, dans un formulaire de paiement sécurisé (le numéro ne transite jamais par Selio).</p>
            </div>
          )}
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Button type="submit" variant="accent" loading={loading} disabled={mode === "connected" && !connectedModeAvailable} fullWidth>{betaCode ? "Créer le compte et rejoindre la bêta" : "Créer le compte et commencer l'essai"}</Button>
          <p className="text-center text-sm text-text-muted">Déjà inscrit ? <Link to="/connexion" className="font-medium text-text underline underline-offset-2">Se connecter</Link></p>
        </form>
      </Container>
    </section>
  );
}
