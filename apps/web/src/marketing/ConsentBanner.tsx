import { useEffect, useState, useSyncExternalStore } from "react";
import { Link } from "react-router";
import { Button, Dialog, Toggle } from "@selio/ui";
import { CATEGORY_LABELS, TRACKING, categoriesInUse, getConsent, onOpenConsentPreferences, saveConsent, subscribeConsent, type ConsentCategory, type TrackingConfig } from "./consent";

/**
 * Bandeau de consentement de la vitrine : « Tout refuser » et « Tout accepter » côte à côte, de
 * même taille et de même style (refuser est aussi simple qu'accepter), « Personnaliser » pour
 * choisir catégorie par catégorie. Affiché seulement si un outil de mesure ou de publicité est
 * configuré : sans identifiant, il n'y a rien à accepter. Jamais bloquant (pas de mur de cookies).
 * Le panneau des préférences se rouvre depuis le lien « Cookies » du pied de page.
 */
export function ConsentBanner({ config = TRACKING }: { config?: TrackingConfig }) {
  const consent = useSyncExternalStore(subscribeConsent, getConsent, () => null);
  const categories = categoriesInUse(config);
  const [prefsOpen, setPrefsOpen] = useState(false);
  useEffect(() => onOpenConsentPreferences(() => setPrefsOpen(true)), []);

  const all = (value: boolean) => saveConsent({ mesure: value && categories.includes("mesure"), publicite: value && categories.includes("publicite") });
  const showBanner = categories.length > 0 && consent === null && !prefsOpen;

  return (
    <>
      {showBanner ? (
        <section role="region" aria-labelledby="consentement-titre" data-testid="consent-banner" className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6 md:pb-6">
          <div className="mx-auto max-w-3xl rounded-xl border border-border bg-surface p-4 shadow-lg md:p-5">
            <h2 id="consentement-titre" className="text-base font-semibold text-text">Cookies : à vous de choisir</h2>
            <p className="mt-1 text-sm text-text-muted">
              Avec votre accord, nous mesurons la fréquentation et l'efficacité de nos publicités ({categories.map((c) => CATEGORY_LABELS[c].title.toLowerCase()).join(", ")}). Sans accord, rien n'est chargé et le site fonctionne de la même façon.{" "}
              <Link to="/confidentialite#cookies" className="font-medium text-accent underline-offset-2 hover:underline">En savoir plus</Link>
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end">
              <Button variant="ghost" size="sm" className="col-span-2 sm:order-first sm:mr-auto" onClick={() => setPrefsOpen(true)}>Personnaliser</Button>
              <Button variant="secondary" size="sm" onClick={() => all(false)}>Tout refuser</Button>
              <Button variant="secondary" size="sm" onClick={() => all(true)}>Tout accepter</Button>
            </div>
          </div>
        </section>
      ) : null}
      <ConsentPreferences open={prefsOpen} onClose={() => setPrefsOpen(false)} config={config} />
    </>
  );
}

/** Préférences, catégorie par catégorie ; sans outil configuré, le dit simplement. */
function ConsentPreferences({ open, onClose, config }: { open: boolean; onClose: () => void; config: TrackingConfig }) {
  const categories = categoriesInUse(config);
  const consent = useSyncExternalStore(subscribeConsent, getConsent, () => null);
  const [draft, setDraft] = useState<Record<ConsentCategory, boolean>>({ mesure: false, publicite: false });
  useEffect(() => {
    if (open) setDraft({ mesure: consent?.mesure ?? false, publicite: consent?.publicite ?? false });
  }, [open, consent]);
  const save = (value: Record<ConsentCategory, boolean>) => {
    saveConsent({ mesure: value.mesure && categories.includes("mesure"), publicite: value.publicite && categories.includes("publicite") });
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Préférences de cookies"
      description={categories.length ? "Chaque catégorie est désactivée tant que vous ne l'activez pas. Vous pouvez changer d'avis à tout moment." : undefined}
      footer={categories.length ? (
        <>
          <Button variant="secondary" size="sm" onClick={() => save({ mesure: false, publicite: false })}>Tout refuser</Button>
          <Button variant="secondary" size="sm" onClick={() => save({ mesure: true, publicite: true })}>Tout accepter</Button>
          <Button variant="accent" size="sm" onClick={() => save(draft)}>Enregistrer mes choix</Button>
        </>
      ) : <Button variant="secondary" size="sm" onClick={onClose}>Fermer</Button>}
    >
      <div className="flex flex-col gap-4" data-testid="consent-preferences">
        <div>
          <p className="text-base font-medium text-text">Nécessaires au fonctionnement</p>
          <p className="mt-0.5 text-sm text-text-muted">Session de connexion, thème clair ou sombre, ce choix lui-même. Toujours actifs, sans mesure ni publicité.</p>
        </div>
        {categories.length ? categories.map((c) => (
          <Toggle key={c} checked={draft[c]} onChange={(v) => setDraft((d) => ({ ...d, [c]: v }))} label={CATEGORY_LABELS[c].title} description={CATEGORY_LABELS[c].text(config)} />
        )) : (
          <p className="text-sm text-text-muted" data-testid="consent-none">Aucun outil de mesure d'audience ni de publicité n'est activé sur ce site : aucun cookie de ce type n'est déposé.</p>
        )}
        <p className="text-xs text-text-muted">Détails : <Link to="/confidentialite#cookies" onClick={onClose} className="font-medium text-accent hover:underline">politique de confidentialité</Link>. Votre choix est gardé six mois dans ce navigateur.</p>
      </div>
    </Dialog>
  );
}
