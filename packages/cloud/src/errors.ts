/** Erreurs de la fenêtre de connexion (sans dépendance au navigateur). */

export class LoginWindowClosedError extends Error {
  constructor() {
    super("La fenêtre de connexion est fermée.");
    this.name = "LoginWindowClosedError";
  }
}

/** Erreur d'entrée volontairement muette : jamais le contenu de l'événement. */
export class LoginInputError extends Error {
  constructor(message = "Événement d'entrée refusé.") {
    super(message);
    this.name = "LoginInputError";
  }
}
