import { useEffect } from "react";
import { useData } from "../lib/data/provider";
import { connectedModeAvailable } from "../lib/env";

/**
 * Pages ouvertes depuis un lien reçu par email (`/mot-de-passe?token=…`, `/invitation?token=…`)
 * et formulaire « mot de passe oublié » : lecture du jeton, règles du mot de passe, mode.
 */

/**
 * Jeton d'un lien reçu par email. Lu une fois, puis retiré de l'adresse (`history.replaceState`)
 * AVANT le premier rendu : il ne reste ni dans l'historique du navigateur, ni dans un en-tête
 * Referer, ni dans les journaux de l'hébergeur statique. À appeler dans l'initialiseur d'un
 * `useState`, jamais dans un effet (qui tourne après le rendu).
 */
export function takeTokenFromUrl(param = "token"): string | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const token = url.searchParams.get(param)?.trim() || null;
  if (token !== null) {
    url.searchParams.delete(param);
    // L'état de l'historique (celui du routeur) est conservé : seule l'adresse change.
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }
  return token;
}

/** Même règle que le serveur (`passwordField`) et l'inscription : dix caractères minimum. */
export const PASSWORD_MIN_LENGTH = 10;

/** Erreurs de saisie d'un nouveau mot de passe (champ → message), vide si tout va bien. */
export function passwordFormErrors(password: string, confirm: string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (password.length < PASSWORD_MIN_LENGTH) errors.password = `${PASSWORD_MIN_LENGTH} caractères minimum.`;
  if (confirm !== password) errors.confirm = "Les deux mots de passe ne correspondent pas.";
  return errors;
}

/**
 * Un lien reçu par email vient toujours d'une installation connectée (la démonstration n'envoie
 * aucun email) : si le navigateur était resté en démonstration, on passe en mode connecté quand
 * il est disponible. Sans API configurée, la page le dit et le formulaire reste désactivé.
 */
export function useConnectedForEmailLink(): { connected: boolean } {
  const { mode, setMode } = useData();
  useEffect(() => {
    if (mode === "demo" && connectedModeAvailable) setMode("connected");
  }, [mode, setMode]);
  return { connected: mode === "connected" && connectedModeAvailable };
}
