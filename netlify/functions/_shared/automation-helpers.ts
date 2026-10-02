const DAY_NAMES_FR = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

// Calcule le prochain jour d'envoi a partir d'une liste de jours autorises
// (0=dimanche ... 6=samedi). Renvoie "demain" si c'est le jour suivant,
// sinon le nom du jour (ex: "lundi"). Comme demande : "si demain dire
// demain, si un autre jour dire cet autre jour".
export function nextShippingDayLabel(shippingDays: number[] | undefined): string {
  if (!shippingDays || shippingDays.length === 0) return "tres bientot";
  const now = new Date();
  for (let offset = 1; offset <= 7; offset++) {
    const d = new Date(now);
    d.setDate(now.getDate() + offset);
    if (shippingDays.includes(d.getDay())) {
      return offset === 1 ? "demain" : DAY_NAMES_FR[d.getDay()];
    }
  }
  return "tres bientot";
}

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => vars[key] ?? "");
}

// Heuristique simple de detection d'offre de prix dans un message acheteur
// (ex: "25€ ca vous va ?", "je propose 20"). Renvoie le montant en centimes
// ou null si aucune offre detectee.
export function extractOfferCents(message: string): number | null {
  const match = message.match(/(\d{1,5}(?:[.,]\d{1,2})?)\s*(?:€|eur|euros?)?/i);
  if (!match) return null;
  const hasPriceContext = /propose|offre|prendre|achete|ca vous va|€|euro/i.test(message);
  if (!hasPriceContext) return null;
  const value = parseFloat(match[1].replace(",", "."));
  if (Number.isNaN(value) || value <= 0) return null;
  return Math.round(value * 100);
}
