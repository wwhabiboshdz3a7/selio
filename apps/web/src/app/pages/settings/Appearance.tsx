import { Monitor, Moon, Sun } from "lucide-react";
import { Card, GlassSurface, Segmented, Tag, Toggle, useGlassCapabilities, glassModeFor } from "@selio/ui";
import { useRequiredSession } from "../../../lib/data/provider";
import { useTheme, type ThemePreference } from "../../../lib/theme";
import { useGlassExperiment } from "../../../lib/glass";

/** Raison du repli opaque, en mots (le verre n'est jamais imposé à un navigateur ou à un réglage qui ne le veut pas). */
const FALLBACK_LABEL = {
  "no-backdrop": "votre navigateur ne gère pas le flou d'arrière-plan : surface opaque",
  "reduced-transparency": "vous avez demandé moins de transparence : surface opaque",
  "more-contrast": "vous avez demandé plus de contraste : surface opaque",
} as const;

/**
 * Paramètres › Apparence : le thème (clair, sombre, système) et l'essai « verre liquide » (§6), désactivé
 * par défaut et mémorisé pour l'utilisateur sur cet appareil.
 */
export default function Appearance() {
  const session = useRequiredSession();
  const { preference, setPreference } = useTheme();
  const glass = useGlassExperiment(session.user.id);
  const caps = useGlassCapabilities();
  const decided = glassModeFor(caps);
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h2 className="text-md font-semibold">Thème</h2>
        <p className="mt-1 text-sm text-text-muted">Clair, sombre, ou celui de votre appareil. Mémorisé sur cet appareil.</p>
        <div className="mt-3">
          <Segmented<ThemePreference>
            ariaLabel="Thème"
            value={preference}
            onChange={setPreference}
            items={[
              { value: "light", label: <span className="inline-flex items-center gap-1.5"><Sun className="size-4" aria-hidden />Clair</span> },
              { value: "dark", label: <span className="inline-flex items-center gap-1.5"><Moon className="size-4" aria-hidden />Sombre</span> },
              { value: "system", label: <span className="inline-flex items-center gap-1.5"><Monitor className="size-4" aria-hidden />Système</span> },
            ]}
          />
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-md font-semibold">Essais</h2>
          <Tag>Expérimental</Tag>
        </div>
        <Toggle
          className="mt-3"
          label="Essai : verre liquide"
          description="Sur téléphone, un dock flottant en verre translucide en bas de l'écran (navigation principale et « Générer ») ; la carte d'une bonne affaire du Radar passe aussi en verre. Le reste de l'application ne change pas."
          checked={glass.enabled}
          onChange={glass.setEnabled}
        />
        <ul className="mt-3 flex list-disc flex-col gap-1 pl-5 text-xs text-text-muted">
          <li>Désactivé par défaut, mémorisé pour vous sur cet appareil{glass.envDefault && glass.preference === null ? " (activé par défaut dans cette démonstration)" : ""}.</li>
          <li>Repli automatique en surface opaque sans flou d'arrière-plan, avec « moins de transparence » ou « plus de contraste » ; reflet immobile avec « réduire les animations ».</li>
          <li>Texte d'au moins 4,5:1 sur n'importe quel fond, grâce à la sous-couche du verre : texte courant, et aussi les couleurs d'accent, de succès, d'erreur et d'avertissement, remplacées dans le verre par des variantes plus contrastées.</li>
          <li>Sur cet appareil : {decided.mode === "glass" ? `verre disponible${caps.refraction ? ", avec la réfraction des bords" : ""}${caps.reducedMotion ? ", reflet immobile" : ""}` : FALLBACK_LABEL[decided.reason ?? "no-backdrop"]}.</li>
        </ul>
        {glass.enabled ? (
          <div className="relative mt-4 overflow-hidden rounded-xl border border-border bg-surface-muted p-4" data-testid="glass-preview">
            {/* Fond chargé (rayures encre et gris) pour juger le flou et la lisibilité. */}
            <div aria-hidden className="pointer-events-none absolute inset-0 flex flex-wrap gap-2 p-3">
              {Array.from({ length: 18 }, (_, i) => <span key={i} className={i % 3 === 0 ? "h-6 w-16 rounded-full bg-text" : "h-6 w-16 rounded-full bg-border-strong"} />)}
            </div>
            <GlassSurface className="relative mx-auto max-w-sm rounded-[22px]" contentClassName="px-4 py-3">
              <p className="text-sm font-semibold text-text">Aperçu du verre liquide</p>
              <p className="text-xs text-text">Le texte reste lisible sur un fond chargé.</p>
            </GlassSurface>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
