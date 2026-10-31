import type { RunFailureCode, StorageState } from "../types";

/**
 * Types de Selio Radar côté navigateur : lecture d'une page (Radar) et
 * navigation pas à pas pour l'achat (Radar Auto).
 *
 * Deux interfaces, implémentées par `PlaywrightRunner` (production) et
 * `FakeRunner` (tests) :
 * - `PageFetcher.fetchPage` : un Chromium neuf, la session du compte Achat,
 *   une page lue (HTML), puis tout est refermé. Aucune action sur la page.
 * - `PageOpener.openBrowsing` : un Chromium tenu ouvert le temps d'un achat
 *   (et, au plus, de l'attente d'une validation 3-D Secure), qui ne sait que
 *   naviguer vers une annonce, lire la page et cliquer sur un bouton nommé.
 *   Il n'existe aucune méthode pour taper du texte : aucun code bancaire ne
 *   peut être saisi à la place du client.
 */

/** Sortes de pages que Radar a le droit d'ouvrir (lecture seule). */
export type RadarPageKind = "catalog" | "item";

export interface FetchPageInput {
  /** Session filtrée du compte Achat (déchiffrée par l'appelant). Sans session : refus, rien n'est lancé. */
  session: StorageState | null;
  /** Page catalogue ou annonce Vinted (https, liste fermée des domaines). */
  url: string;
  /** Dossier de travail neuf ; créé sous `profileBaseDir` de l'exécuteur s'il est absent. */
  profileDir?: string;
  /** Budget de la lecture, navigateur compris (borné par CLOUD_ACTION_TIMEOUT_MS). */
  timeoutMs?: number;
  /** Éléments à attendre (courtement) avant de lire le HTML, par exemple la grille du catalogue. */
  waitForSelectors?: readonly string[];
}

export type FetchPageOutcome =
  | {
      ok: true;
      html: string;
      /** Adresse finale du cadre principal (après redirections). */
      finalUrl: string;
      /** Statut HTTP de la réponse principale (null si inconnu). */
      status: number | null;
      /**
       * Vrai si la réponse principale porte un en-tête de vérification anti-robot connu (Cloudflare
       * `cf-mitigated: challenge`) : la page est une vérification, quel que soit son contenu ou son statut.
       */
      challenge?: boolean;
      durationMs: number;
      /** Session relue et filtrée avant la fermeture (Vinted a pu la renouveler). */
      session?: StorageState;
    }
  | {
      ok: false;
      code: RunFailureCode;
      message: string;
      /** Faux : aucun navigateur lancé (refus, aucun créneau libre) — la page ne compte pas. */
      launched: boolean;
      durationMs: number;
      session?: StorageState;
    };

export interface PageFetcher {
  fetchPage(input: FetchPageInput): Promise<FetchPageOutcome>;
}

/** Ce qu'un clic doit faire : sert au journal et à l'exécuteur factice. */
export type ClickIntent = "buy" | "select_wallet" | "confirm_payment";

export interface ClickTarget {
  intent: ClickIntent;
  /** Sélecteurs de l'adaptateur, dans l'ordre de priorité. */
  selectors: readonly string[];
  /** Repli : nom visible du bouton (texte ou aria-label). */
  name?: RegExp;
}

/** Page tenue ouverte pendant un achat : lire, aller à une annonce, cliquer. Jamais écrire. */
export interface BrowsingPage {
  /** Navigation vers une annonce ou un catalogue Vinted (liste fermée), sinon erreur. */
  goto(url: string): Promise<{ status: number | null }>;
  content(): Promise<string>;
  url(): string;
  /**
   * Clique sur le premier élément visible ; faux si rien n'est trouvé (aucun clic) ou si la page
   * affichée n'est plus une page Vinted (page de la banque, par exemple : jamais de clic hors Vinted).
   */
  click(target: ClickTarget): Promise<boolean>;
  /**
   * État coché du premier élément trouvé (bouton radio, case), lu dans la page vivante : un clic ne
   * modifie pas l'attribut `checked` du HTML sérialisé. `null` si rien n'est trouvé. Lecture seule.
   */
  isChecked(selectors: readonly string[]): Promise<boolean | null>;
  /** Attend la fin d'une navigation éventuelle (sans erreur si rien ne se passe). */
  settle(timeoutMs: number): Promise<void>;
  wait(ms: number): Promise<void>;
}

export interface BrowsingSession {
  readonly page: BrowsingPage;
  /** Vrai une fois fermé (fermeture demandée, ou délai de vie dépassé : fermeture automatique). */
  readonly closed: boolean;
  /** Repousse la fermeture automatique à maintenant + `ms` (attente 3-D Secure). */
  extend(ms: number): void;
  readSession(): Promise<StorageState | undefined>;
  close(): Promise<void>;
}

export interface OpenBrowsingInput {
  session: StorageState | null;
  profileDir?: string;
  /** Durée de vie avant fermeture automatique (prolongeable par `extend`). */
  timeoutMs?: number;
}

export type OpenBrowsingOutcome =
  | { ok: true; browsing: BrowsingSession }
  | { ok: false; code: RunFailureCode; message: string; launched: boolean; durationMs: number };

export interface PageOpener {
  /** Vrai si l'exécuteur accepte d'ouvrir cette adresse (vérifié avant tout lancement). */
  allowsTarget(url: string, kind: RadarPageKind): boolean;
  openBrowsing(input: OpenBrowsingInput): Promise<OpenBrowsingOutcome>;
}

/** Adresse refusée par la page tenue ouverte (hors Vinted, ou ni annonce ni catalogue). */
export class TargetRefusedError extends Error {
  constructor() {
    super("Adresse refusée : seules les annonces et pages catalogue Vinted sont acceptées.");
    this.name = "TargetRefusedError";
  }
}
