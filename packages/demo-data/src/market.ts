import type { ItemCategory, MarketObservation } from "@selio/contracts";
import { hashString, seededRandom } from "@selio/domain";

/**
 * Marché fictif pour l'analyse des revendeurs en démonstration : des
 * vendeurs aux profils de niche marqués (sneakers, vintage denim, outdoor,
 * luxe accessible…), avec annonces actives et ventes datées. Déterministe :
 * même date de génération → mêmes données.
 */

interface Profile {
  handle: string;
  niches: { brand: string; category: ItemCategory; pieces: string[]; price: [number, number]; weight: number }[];
  volume: number;
  sellThrough: number;
  trend: number;
}

const PROFILES: Profile[] = [
  { handle: "sneakers.paris", volume: 78, sellThrough: 0.72, trend: 1.3, niches: [
    { brand: "Nike", category: "shoes", pieces: ["Air Max 90", "Air Force 1", "Dunk Low"], price: [4500, 11000], weight: 0.62 },
    { brand: "Adidas", category: "shoes", pieces: ["Samba OG", "Gazelle", "Campus 00s"], price: [4000, 9000], weight: 0.3 },
    { brand: "New Balance", category: "shoes", pieces: ["550", "2002R"], price: [6000, 12000], weight: 0.08 } ] },
  { handle: "vintage_lou", volume: 64, sellThrough: 0.58, trend: 1.1, niches: [
    { brand: "Levi's", category: "men", pieces: ["Jean 501", "Veste en jean", "Jean 505"], price: [2500, 5500], weight: 0.7 },
    { brand: "Carhartt", category: "men", pieces: ["Veste Detroit", "Pantalon cargo"], price: [4000, 9000], weight: 0.3 } ] },
  { handle: "outdoor.secondevie", volume: 52, sellThrough: 0.66, trend: 1.45, niches: [
    { brand: "The North Face", category: "men", pieces: ["Doudoune Nuptse", "Polaire Denali", "Parka McMurdo"], price: [6000, 16000], weight: 0.55 },
    { brand: "Patagonia", category: "men", pieces: ["Polaire Synchilla", "Doudoune Down Sweater"], price: [5500, 13000], weight: 0.45 } ] },
  { handle: "dressing.de.clara", volume: 70, sellThrough: 0.48, trend: 0.95, niches: [
    { brand: "Sézane", category: "women", pieces: ["Blouse", "Cardigan", "Robe midi"], price: [4500, 9500], weight: 0.5 },
    { brand: "Maje", category: "women", pieces: ["Robe courte", "Jupe plissée"], price: [5000, 11000], weight: 0.3 },
    { brand: "Zara", category: "women", pieces: ["Robe", "Blazer"], price: [1200, 3000], weight: 0.2 } ] },
  { handle: "luxe_occaz", volume: 30, sellThrough: 0.52, trend: 1.2, niches: [
    { brand: "Longchamp", category: "bags", pieces: ["Le Pliage", "Roseau"], price: [5500, 14000], weight: 0.6 },
    { brand: "Ray-Ban", category: "accessories", pieces: ["Wayfarer", "Clubmaster"], price: [5000, 9500], weight: 0.4 } ] },
  { handle: "streetwear.lab", volume: 58, sellThrough: 0.61, trend: 1.25, niches: [
    { brand: "Stone Island", category: "men", pieces: ["Sweat", "Overshirt"], price: [9000, 22000], weight: 0.35 },
    { brand: "Carhartt", category: "men", pieces: ["Hoodie", "Veste Michigan"], price: [3500, 8500], weight: 0.4 },
    { brand: "Nike", category: "men", pieces: ["Tech Fleece", "Coupe-vent"], price: [4000, 9000], weight: 0.25 } ] },
  { handle: "kidsdressing", volume: 90, sellThrough: 0.55, trend: 1.0, niches: [
    { brand: "Petit Bateau", category: "kids", pieces: ["Body", "Pyjama", "Ciré"], price: [500, 2500], weight: 0.55 },
    { brand: "Uniqlo", category: "kids", pieces: ["Doudoune légère", "Jean"], price: [600, 2200], weight: 0.45 } ] },
  { handle: "denim.factory", volume: 44, sellThrough: 0.5, trend: 0.85, niches: [
    { brand: "Levi's", category: "women", pieces: ["Jean Ribcage", "Short"], price: [2500, 5000], weight: 0.7 },
    { brand: "Lee", category: "men", pieces: ["Jean Brooklyn"], price: [2000, 4000], weight: 0.3 } ] },
  { handle: "polo.club", volume: 40, sellThrough: 0.63, trend: 1.15, niches: [
    { brand: "Ralph Lauren", category: "men", pieces: ["Pull torsadé", "Polo", "Chemise Oxford"], price: [2500, 7000], weight: 0.6 },
    { brand: "Lacoste", category: "men", pieces: ["Polo", "Sweat"], price: [2500, 6500], weight: 0.4 } ] },
  { handle: "retro.wear", volume: 36, sellThrough: 0.44, trend: 0.9, niches: [
    { brand: "Adidas", category: "men", pieces: ["Veste de survêtement", "Maillot vintage"], price: [3000, 7500], weight: 0.6 },
    { brand: "Champion", category: "men", pieces: ["Sweat Reverse Weave"], price: [2500, 5500], weight: 0.4 } ] },
  { handle: "bonnesaffaires.lyon", volume: 85, sellThrough: 0.4, trend: 1.0, niches: [
    { brand: "Zara", category: "women", pieces: ["Robe", "Top", "Pantalon"], price: [800, 2500], weight: 0.5 },
    { brand: "H&M", category: "women", pieces: ["Pull", "Robe"], price: [500, 1800], weight: 0.5 } ] },
  { handle: "boots.atelier", volume: 26, sellThrough: 0.69, trend: 1.35, niches: [
    { brand: "Dr. Martens", category: "shoes", pieces: ["1460", "Chelsea 2976", "Jadon"], price: [6000, 12000], weight: 1 } ] },
];

export function buildMarketObservations(seededAt: string): MarketObservation[] {
  const now = new Date(seededAt);
  const rnd = seededRandom(hashString("marche:" + seededAt.slice(0, 10)));
  const out: MarketObservation[] = [];
  let n = 0;
  for (const p of PROFILES) {
    for (let i = 0; i < p.volume; i++) {
      let r = rnd();
      const niche = p.niches.find((x) => (r -= x.weight) <= 0) ?? p.niches[0]!;
      const piece = niche.pieces[Math.floor(rnd() * niche.pieces.length)]!;
      const price = Math.round((niche.price[0] + rnd() * (niche.price[1] - niche.price[0])) / 50) * 50;
      // Tendance : trend > 1 concentre les ventes sur les jours récents, < 1 sur les plus anciens.
      const daysAgo = Math.floor(60 * Math.pow(rnd(), p.trend));
      const sold = rnd() < p.sellThrough;
      const at = new Date(now.getTime() - daysAgo * 86_400_000 - Math.floor(rnd() * 20) * 3_600_000);
      out.push({
        id: `mk-${++n}`,
        sellerHandle: p.handle,
        title: `${piece} ${niche.brand}`,
        brand: niche.brand,
        category: niche.category,
        priceCents: price,
        status: sold ? "sold" : "listed",
        seenAt: at.toISOString(),
        soldAt: sold ? at.toISOString() : null,
        favorites: Math.floor(rnd() * (sold ? 25 : 14)),
        source: "demo_simulator",
      });
    }
  }
  return out;
}
