/**
 * Les 14 étoiles de la constellation Selio : exactement les modules de la page
 * « Fonctionnalités » (source unique : ../catalog), avec le même état honnête
 * et un lien vers leur détail.
 */
import { AVAILABILITY_LABEL, MODULES, type Availability, type ModuleTone } from "../catalog";

export type StarTone = ModuleTone;
export type StarStatus = Availability;

export interface ConstellationFeature {
  id: string;
  title: string;
  text: string;
  href: string;
  tone: StarTone;
  status: StarStatus;
}

export const STATUS_LABEL = AVAILABILITY_LABEL;

export const CONSTELLATION: readonly ConstellationFeature[] = MODULES.map((m) => ({
  id: m.id,
  title: m.title,
  text: m.summary,
  href: m.href,
  tone: m.tone,
  status: m.status,
}));
