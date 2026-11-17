/**
 * Les 14 étoiles de la constellation Selio : exactement les modules de la page
 * « Fonctionnalités » (source unique : ../catalog), avec le même état honnête,
 * la filiale qui les porte (dans l'ordre officiel) et un lien vers leur détail.
 */
import { AVAILABILITY_LABEL, MODULES, MODULE_PRODUCT_LABEL, type Availability, type ModuleTone } from "../catalog";

export type StarTone = ModuleTone;
export type StarStatus = Availability;

export interface ConstellationFeature {
  id: string;
  title: string;
  text: string;
  href: string;
  tone: StarTone;
  status: StarStatus;
  /** Filiale qui porte le module (« Selio Manager »…, ou « Toute la gamme »). */
  product: string;
}

export const STATUS_LABEL = AVAILABILITY_LABEL;

export const CONSTELLATION: readonly ConstellationFeature[] = MODULES.map((m) => ({
  id: m.id,
  title: m.title,
  text: m.summary,
  href: m.href,
  tone: m.tone,
  status: m.status,
  product: MODULE_PRODUCT_LABEL[m.product],
}));
