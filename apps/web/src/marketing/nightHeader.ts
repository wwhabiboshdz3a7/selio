/**
 * En-tête « nuit » : tant que le ciel nocturne de l'accueil passe sous l'en-tête,
 * celui-ci devient translucide et nocturne (logo blanc). Petit magasin partagé
 * entre le héros (qui observe) et la mise en page (qui affiche).
 */
let overNight = false;
const listeners = new Set<() => void>();

export function setOverNight(value: boolean): void {
  if (value === overNight) return;
  overNight = value;
  for (const l of listeners) l();
}

export function subscribeOverNight(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export const getOverNight = () => overNight;
export const getOverNightServer = () => false;
