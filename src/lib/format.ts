export function formatPrice(cents: number): string {
  return (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

export const CATEGORY_LABELS: Record<string, string> = {
  femmes: "Femmes",
  hommes: "Hommes",
  enfants: "Enfants",
  chaussures: "Chaussures",
  sacs: "Sacs",
  accessoires: "Accessoires",
  maison: "Maison",
  autre: "Autre",
};

export const CONDITION_LABELS: Record<string, string> = {
  neuf_avec_etiquette: "Neuf avec etiquette",
  neuf_sans_etiquette: "Neuf sans etiquette",
  tres_bon_etat: "Tres bon etat",
  bon_etat: "Bon etat",
  satisfaisant: "Satisfaisant",
};

export const SORT_LABELS: Record<string, string> = {
  pertinence: "Pertinence",
  recent: "Plus recent",
  prix_asc: "Prix croissant",
  prix_desc: "Prix decroissant",
};
