// Algorithme de tri "Pertinence" de Selio — simple et transparent.
// score = (pertinence texte * 5) + (fraicheur * 2) + (popularite * 1)
export type RankableListing = {
  title: string;
  description: string;
  createdAt: string;
  favoritesCount: number;
  viewsCount: number;
};

export function relevanceScore(listing: RankableListing, query: string): number {
  const terms = query.toLowerCase().split(/\s+/).map((t) => t.trim()).filter(Boolean);
  if (terms.length === 0) return 0;
  const title = listing.title.toLowerCase();
  const description = listing.description.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (title.includes(term)) score += 3;
    if (description.includes(term)) score += 1;
  }
  return score / terms.length;
}

export function freshnessScore(createdAt: string): number {
  const ageDays = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0, 30 - ageDays);
}

export function popularityScore(listing: RankableListing): number {
  return listing.favoritesCount * 4 + Math.min(listing.viewsCount, 500) * 0.05;
}

export function rankScore(listing: RankableListing, query: string): number {
  return relevanceScore(listing, query) * 5 + freshnessScore(listing.createdAt) * 2 + popularityScore(listing) * 1;
}
