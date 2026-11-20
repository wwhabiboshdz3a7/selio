import { Monitor, Moon, Sun } from "lucide-react";
import { Card, Segmented } from "@selio/ui";
import { useTheme, type ThemePreference } from "../../../lib/theme";

/** Paramètres › Apparence : le thème (clair, sombre, ou celui de l'appareil), mémorisé sur cet appareil. */
export default function Appearance() {
  const { preference, setPreference } = useTheme();
  return (
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
  );
}
