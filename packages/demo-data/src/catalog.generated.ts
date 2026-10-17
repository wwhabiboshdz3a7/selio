// Fichier généré par packages/demo-data/scripts/import-revendo-photos.py — ne pas modifier à la main.
// Vraies annonces Vinted (photos et fiches issues du dépôt revendo), sans nom de compte.
import type { ItemCategory } from "@selio/contracts";

export interface CatalogEntry {
  key: string;
  title: string;
  brand: string | null;
  vintedCategory: string;
  category: ItemCategory;
  size: string | null;
  color: string | null;
  priceCents: number;
  photos: string[];
  /** Galerie complète en pleine définition (sinon : miniature agrandie). */
  fullSize: boolean;
}

export const REAL_CATALOG: CatalogEntry[] = [
  {
    "key": "g-yw5b",
    "title": "Pull à pois Tommy Hilfiger marine",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Pulls ras de cou",
    "category": "women",
    "size": "M",
    "color": "Bleu marine",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/g-yw5b-1.webp",
      "/demo/photos/g-yw5b-2.webp",
      "/demo/photos/g-yw5b-3.webp",
      "/demo/photos/g-yw5b-4.webp",
      "/demo/photos/g-yw5b-5.webp",
      "/demo/photos/g-yw5b-6.webp",
      "/demo/photos/g-yw5b-7.webp"
    ],
    "fullSize": true
  },
  {
    "key": "g-x4iv",
    "title": "Pull torsadé Tommy Hilfiger gris et écru",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Pulls d'hiver",
    "category": "men",
    "size": "XL",
    "color": "Gris",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/g-x4iv-1.webp",
      "/demo/photos/g-x4iv-2.webp",
      "/demo/photos/g-x4iv-3.webp",
      "/demo/photos/g-x4iv-4.webp",
      "/demo/photos/g-x4iv-5.webp",
      "/demo/photos/g-x4iv-6.webp",
      "/demo/photos/g-x4iv-7.webp"
    ],
    "fullSize": true
  },
  {
    "key": "r-yaso",
    "title": "T-shirt rayé Tommy Hilfiger rose et blanc",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "T-shirts",
    "category": "men",
    "size": "M",
    "color": "Rose",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-yaso.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-8v28",
    "title": "T-shirt Tommy Hilfiger gris",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "T-shirts",
    "category": "women",
    "size": null,
    "color": "Gris",
    "priceCents": 1600,
    "photos": [
      "/demo/photos/r-8v28.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-j0ql",
    "title": "Pull d'hiver Tommy Hilfiger rouge",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Pulls d'hiver",
    "category": "men",
    "size": null,
    "color": "Rouge",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-j0ql.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-1kiv",
    "title": "Pull d'hiver Tommy Hilfiger blanc",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Pulls d'hiver",
    "category": "women",
    "size": null,
    "color": "Blanc",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-1kiv.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-i9vk",
    "title": "T-shirt marine",
    "brand": null,
    "vintedCategory": "T-shirts",
    "category": "men",
    "size": null,
    "color": "Bleu marine",
    "priceCents": 1600,
    "photos": [
      "/demo/photos/r-i9vk.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-lpdt",
    "title": "Pull rayé Tommy Hilfiger bleu ciel",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Pulls d'hiver",
    "category": "women",
    "size": null,
    "color": "Bleu ciel",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-lpdt.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-291l",
    "title": "Pull ras de cou gris",
    "brand": null,
    "vintedCategory": "Pulls ras de cou",
    "category": "men",
    "size": null,
    "color": "Gris",
    "priceCents": 1400,
    "photos": [
      "/demo/photos/r-291l.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-ei7g",
    "title": "Pull col V gris",
    "brand": null,
    "vintedCategory": "Pulls col V",
    "category": "women",
    "size": null,
    "color": "Gris",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-ei7g.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-74wo",
    "title": "Pull col V rayé Tommy Hilfiger marine et rouge",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Pulls col V",
    "category": "men",
    "size": null,
    "color": "Bleu marine",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-74wo.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-xn51",
    "title": "Pull col V à losanges rouge et marine",
    "brand": null,
    "vintedCategory": "Pulls col V",
    "category": "women",
    "size": null,
    "color": "Rouge",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-xn51.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-nywk",
    "title": "Pull rayé Tommy Hilfiger beige",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Pulls col V",
    "category": "men",
    "size": null,
    "color": "Beige",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-nywk.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-qzbq",
    "title": "Pull col V à losanges abricot",
    "brand": null,
    "vintedCategory": "Pulls col V",
    "category": "women",
    "size": null,
    "color": "Abricot",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-qzbq.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-usyx",
    "title": "Pull ras de cou Tommy Hilfiger marine",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Pulls ras de cou",
    "category": "men",
    "size": null,
    "color": "Bleu marine",
    "priceCents": 2300,
    "photos": [
      "/demo/photos/r-usyx.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-lomx",
    "title": "Pull d'hiver Tommy Hilfiger gris",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Pulls d'hiver",
    "category": "women",
    "size": null,
    "color": "Gris",
    "priceCents": 1650,
    "photos": [
      "/demo/photos/r-lomx.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-w6e0",
    "title": "Pull ras de cou crème",
    "brand": null,
    "vintedCategory": "Pulls ras de cou",
    "category": "men",
    "size": null,
    "color": "Crème",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-w6e0.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-ouxr",
    "title": "Pull col V rouge",
    "brand": null,
    "vintedCategory": "Pulls col V",
    "category": "women",
    "size": "M",
    "color": "Rouge",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-ouxr.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-hy0n",
    "title": "Pull d'hiver gris",
    "brand": null,
    "vintedCategory": "Pulls d'hiver",
    "category": "men",
    "size": null,
    "color": "Gris",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-hy0n.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-i0f8",
    "title": "Pull col V rayé Tommy Hilfiger blanc et bordeaux",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Pulls col V",
    "category": "women",
    "size": null,
    "color": "Blanc",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-i0f8.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-xhzr",
    "title": "Blouse ¾ rayée Nautica noir et blanc",
    "brand": "Nautica",
    "vintedCategory": "Blouses ¾",
    "category": "women",
    "size": null,
    "color": "Noir",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-xhzr.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-4c28",
    "title": "Pull ras de cou Tommy Hilfiger gris",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Pulls ras de cou",
    "category": "women",
    "size": "M",
    "color": "Gris",
    "priceCents": 2350,
    "photos": [
      "/demo/photos/r-4c28.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-3ylv",
    "title": "Cardigan à fleurs Tommy Hilfiger marine",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Cardigans",
    "category": "women",
    "size": "M",
    "color": "Bleu marine",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-3ylv.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-s33t",
    "title": "Sweat à col V rayé Tommy Hilfiger gris",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Sweats à col V",
    "category": "men",
    "size": null,
    "color": "Gris",
    "priceCents": 2500,
    "photos": [
      "/demo/photos/r-s33t.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-z815",
    "title": "Polo rayé Tommy Hilfiger marine et rouge",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Polos",
    "category": "men",
    "size": null,
    "color": "Bleu marine",
    "priceCents": 2400,
    "photos": [
      "/demo/photos/r-z815.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-dfir",
    "title": "Pull d'hiver marine",
    "brand": null,
    "vintedCategory": "Pulls d'hiver",
    "category": "women",
    "size": null,
    "color": "Bleu marine",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-dfir.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-s5ht",
    "title": "Pull d'hiver gris",
    "brand": null,
    "vintedCategory": "Pulls d'hiver",
    "category": "men",
    "size": null,
    "color": "Gris",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-s5ht.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-n5g4",
    "title": "Pull rayé marine et blanc",
    "brand": null,
    "vintedCategory": "Pulls d'hiver",
    "category": "men",
    "size": null,
    "color": "Bleu marine",
    "priceCents": 2500,
    "photos": [
      "/demo/photos/r-n5g4.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-qeub",
    "title": "Pull col V à losanges Tommy Hilfiger marine",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Pulls col V",
    "category": "women",
    "size": null,
    "color": "Bleu marine",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-qeub.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-gocv",
    "title": "Pull col V rayé Tommy Hilfiger fuchsia",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Pulls col V",
    "category": "men",
    "size": null,
    "color": "Fuchsia",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-gocv.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-u40z",
    "title": "T-shirt gris",
    "brand": null,
    "vintedCategory": "T-shirts",
    "category": "women",
    "size": null,
    "color": "Gris",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-u40z.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-9ftg",
    "title": "Pull col V bleu canard",
    "brand": null,
    "vintedCategory": "Sweats à col V",
    "category": "men",
    "size": null,
    "color": "Bleu canard",
    "priceCents": 2500,
    "photos": [
      "/demo/photos/r-9ftg.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-xu43",
    "title": "Pull rayé orange, jaune et blanc",
    "brand": null,
    "vintedCategory": "Pulls d'hiver",
    "category": "women",
    "size": null,
    "color": "Orange",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-xu43.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-oyuf",
    "title": "Pull col V à losanges Tommy Hilfiger crème",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Pulls col V",
    "category": "men",
    "size": null,
    "color": "Crème",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-oyuf.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-l2uf",
    "title": "Blouse manches longues beige",
    "brand": null,
    "vintedCategory": "Blouses manches longues",
    "category": "women",
    "size": null,
    "color": "Beige",
    "priceCents": 2000,
    "photos": [
      "/demo/photos/r-l2uf.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-ksqg",
    "title": "Pull d'hiver gris",
    "brand": null,
    "vintedCategory": "Pulls d'hiver",
    "category": "men",
    "size": null,
    "color": "Gris",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-ksqg.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-qbnp",
    "title": "Haut rayé Tommy Hilfiger gris",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "T-shirts",
    "category": "women",
    "size": null,
    "color": "Gris",
    "priceCents": 2000,
    "photos": [
      "/demo/photos/r-qbnp.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-k33i",
    "title": "Pull d'hiver rouge",
    "brand": null,
    "vintedCategory": "Pulls d'hiver",
    "category": "men",
    "size": null,
    "color": "Rouge",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-k33i.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-oeej",
    "title": "Cardigan Tommy Hilfiger marine",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Cardigans",
    "category": "women",
    "size": "M",
    "color": "Bleu marine",
    "priceCents": 1700,
    "photos": [
      "/demo/photos/r-oeej.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-hu2a",
    "title": "Pull rayé Tommy Hilfiger marine et blanc",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Pulls d'hiver",
    "category": "men",
    "size": null,
    "color": "Bleu marine",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-hu2a.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-u4mi",
    "title": "Pull d'hiver fuchsia",
    "brand": null,
    "vintedCategory": "Pulls d'hiver",
    "category": "women",
    "size": null,
    "color": "Fuchsia",
    "priceCents": 1750,
    "photos": [
      "/demo/photos/r-u4mi.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-fvhw",
    "title": "Pull d'hiver Tommy Hilfiger gris",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Pulls d'hiver",
    "category": "men",
    "size": null,
    "color": "Gris",
    "priceCents": 1900,
    "photos": [
      "/demo/photos/r-fvhw.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-ntin",
    "title": "Cardigan rayé Tommy Hilfiger marine",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Cardigans",
    "category": "women",
    "size": null,
    "color": "Bleu marine",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-ntin.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-nt1r",
    "title": "Pull à ancres Tommy Hilfiger gris",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Pulls d'hiver",
    "category": "men",
    "size": null,
    "color": "Gris",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-nt1r.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-cmrz",
    "title": "T-shirt uni gris",
    "brand": null,
    "vintedCategory": "T-shirts unis",
    "category": "women",
    "size": null,
    "color": "Gris",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-cmrz.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-e68h",
    "title": "Pull ras de cou Tommy Hilfiger gris",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Pulls ras de cou",
    "category": "women",
    "size": null,
    "color": "Gris",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-e68h.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-dkl8",
    "title": "Pull col V Tommy Hilfiger rouge",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Pulls col V",
    "category": "men",
    "size": "M",
    "color": "Rouge",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-dkl8.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-8mcb",
    "title": "Sweat à col V Tommy Hilfiger corail",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Sweats à col V",
    "category": "men",
    "size": null,
    "color": "Corail",
    "priceCents": 2400,
    "photos": [
      "/demo/photos/r-8mcb.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-r6wo",
    "title": "Pull à col roulé bordeaux",
    "brand": null,
    "vintedCategory": "Pulls à col roulé",
    "category": "men",
    "size": null,
    "color": "Bordeaux",
    "priceCents": 2800,
    "photos": [
      "/demo/photos/r-r6wo.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-vzwz",
    "title": "Pull à col roulé bordeaux",
    "brand": null,
    "vintedCategory": "Pulls à col roulé",
    "category": "women",
    "size": null,
    "color": "Bordeaux",
    "priceCents": 2500,
    "photos": [
      "/demo/photos/r-vzwz.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-as1z",
    "title": "Pull col roulé Tommy Hilfiger rouge",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Pulls col roulé",
    "category": "men",
    "size": null,
    "color": "Rouge",
    "priceCents": 2500,
    "photos": [
      "/demo/photos/r-as1z.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-yhh9",
    "title": "Pull d'hiver Tommy Hilfiger gris",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Pulls d'hiver",
    "category": "women",
    "size": null,
    "color": "Gris",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-yhh9.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-i0v4",
    "title": "Pull d'hiver Tommy Hilfiger rouge",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Pulls d'hiver",
    "category": "men",
    "size": null,
    "color": "Rouge",
    "priceCents": 1950,
    "photos": [
      "/demo/photos/r-i0v4.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-00gd",
    "title": "Pull chiné Tommy Hilfiger rose",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Pulls d'hiver",
    "category": "women",
    "size": null,
    "color": "Rose",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-00gd.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-nxjw",
    "title": "Pull col V à losanges rose et chocolat",
    "brand": null,
    "vintedCategory": "Pulls col V",
    "category": "men",
    "size": null,
    "color": "Rose",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-nxjw.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-prkn",
    "title": "Pull col V marine",
    "brand": null,
    "vintedCategory": "Pulls col V",
    "category": "women",
    "size": null,
    "color": "Bleu marine",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-prkn.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-72r7",
    "title": "Sweat à col V gris",
    "brand": null,
    "vintedCategory": "Sweats à col V",
    "category": "men",
    "size": null,
    "color": "Gris",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-72r7.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-ptby",
    "title": "Cardigan Tommy Hilfiger marine",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Cardigans",
    "category": "kids",
    "size": "3 ans",
    "color": "Bleu marine",
    "priceCents": 2300,
    "photos": [
      "/demo/photos/r-ptby.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-l6n1",
    "title": "Pull ras de cou Tommy Hilfiger gris",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Pulls ras de cou",
    "category": "men",
    "size": null,
    "color": "Gris",
    "priceCents": 2400,
    "photos": [
      "/demo/photos/r-l6n1.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-2qi8",
    "title": "Robe d'hiver marine",
    "brand": null,
    "vintedCategory": "Robes d'hiver",
    "category": "women",
    "size": null,
    "color": "Bleu marine",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-2qi8.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-1vw3",
    "title": "Pull d'hiver Tommy Hilfiger fuchsia",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Pulls d'hiver",
    "category": "men",
    "size": null,
    "color": "Fuchsia",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-1vw3.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-ybm9",
    "title": "Pull col V à losanges marine et rouge",
    "brand": null,
    "vintedCategory": "Pulls col V",
    "category": "women",
    "size": null,
    "color": "Bleu marine",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-ybm9.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-58bh",
    "title": "Pull d'hiver corail",
    "brand": null,
    "vintedCategory": "Pulls d'hiver",
    "category": "men",
    "size": null,
    "color": "Corail",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-58bh.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-xbzg",
    "title": "Pull d'hiver Tommy Hilfiger rouge",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Pulls d'hiver",
    "category": "women",
    "size": null,
    "color": "Rouge",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-xbzg.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-7iic",
    "title": "Pull d'hiver Tommy Hilfiger rouge",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Pulls d'hiver",
    "category": "men",
    "size": null,
    "color": "Rouge",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-7iic.webp"
    ],
    "fullSize": false
  },
  {
    "key": "r-0r7c",
    "title": "Pull col roulé Tommy Hilfiger rose pâle",
    "brand": "Tommy Hilfiger",
    "vintedCategory": "Pulls d'hiver",
    "category": "men",
    "size": null,
    "color": "Rose",
    "priceCents": 1800,
    "photos": [
      "/demo/photos/r-0r7c.webp"
    ],
    "fullSize": false
  }
];
