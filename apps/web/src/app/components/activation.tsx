import type { ReactNode } from "react";
import { Hourglass } from "lucide-react";
import { Card, LoadingState, StatusBadge } from "@selio/ui";
import { useFeature, type LiveFeature } from "../../lib/capabilities";

/**
 * État « En cours d'activation » d'une fonction pas encore branchée en réel sur ce serveur : ce qu'elle fera et ce
 * qu'on peut déjà préparer. Aucun chiffre : on ne montre jamais des données simulées comme si elles étaient réelles.
 */
export function ActivationState({ title, does, prepare, action, label = "En cours d'activation", testId }: {
  title: ReactNode;
  /** Ce que la fonction fera une fois ouverte. */
  does: ReactNode[];
  /** Ce qu'on peut déjà faire en attendant (facultatif). */
  prepare?: ReactNode;
  action?: ReactNode;
  label?: "En cours d'activation" | "Disponible prochainement";
  testId?: string;
}) {
  return (
    <Card data-testid={testId ?? "activation-state"}>
      <div className="flex flex-wrap items-center gap-2">
        <Hourglass className="size-4 text-accent" aria-hidden />
        <h2 className="text-md font-semibold text-text">{title}</h2>
        <StatusBadge tone="accent">{label}</StatusBadge>
      </div>
      <p className="mt-2 text-sm text-text-muted">Cette fonction est en cours d'ouverture sur votre espace. Dès qu'elle sera active, vos chiffres apparaîtront ici, calculés sur des données réelles.</p>
      <ul className="mt-3 flex list-disc flex-col gap-1 pl-5 text-sm text-text">
        {does.map((d, i) => <li key={i}>{d}</li>)}
      </ul>
      {prepare ? <p className="mt-3 rounded-md bg-surface-muted px-3 py-2 text-sm text-text-muted"><span className="font-medium text-text">Dès maintenant : </span>{prepare}</p> : null}
      {action ? <div className="mt-4 flex flex-wrap gap-2">{action}</div> : null}
    </Card>
  );
}

/**
 * Montre `children` seulement si la fonction est branchée en réel ; sinon l'état « En cours d'activation »
 * (`fallback`). Pendant la lecture des capacités : un chargement, jamais les chiffres.
 */
export function LiveOnly({ feature, fallback, children }: { feature: LiveFeature; fallback: ReactNode; children: ReactNode }) {
  const f = useFeature(feature);
  if (f.pending) return <LoadingState />;
  return <>{f.live ? children : fallback}</>;
}
