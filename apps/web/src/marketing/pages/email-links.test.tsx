import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { ReactNode } from "react";
import { DataProvider, queryClient } from "../../lib/data/provider";
import { HUB_PATH } from "../../app/spaces/paths";
import { passwordFormErrors, takeTokenFromUrl } from "../email-links";
import AcceptInvite from "./AcceptInvite";
import ForgotPassword from "./ForgotPassword";
import Login from "./Login";
import ResetPassword from "./ResetPassword";

interface Call { url: string; body: Record<string, unknown> | undefined }

/** Remplace `fetch` : enregistre chaque appel de l'ApiClient et répond ce qu'on lui dit. */
function stubFetch(respond: (url: string) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined });
    return respond(url);
  }));
  return calls;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function renderConnected(path: string, element: ReactNode) {
  const router = createMemoryRouter(
    [{ path, element }, { path: "/connexion", element: <p>Page de connexion</p> }, { path: HUB_PATH, element: <p>Accueil des espaces</p> }],
    { initialEntries: [path] },
  );
  render(<DataProvider forceMode="connected"><RouterProvider router={router} /></DataProvider>);
}

const typePassword = (label: string, value: string) => fireEvent.change(screen.getByLabelText(new RegExp(`^${label}`)), { target: { value } });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  queryClient.clear();
  window.history.replaceState({}, "", "/");
});

describe("liens reçus par email : jeton", () => {
  it("lit le jeton puis le retire de l'adresse en gardant le reste", () => {
    window.history.replaceState({ usr: 1 }, "", "/mot-de-passe?token=abc_DEF-123&lang=fr#haut");
    expect(takeTokenFromUrl()).toBe("abc_DEF-123");
    expect(window.location.pathname + window.location.search + window.location.hash).toBe("/mot-de-passe?lang=fr#haut");
    expect(window.history.state).toEqual({ usr: 1 });
    expect(takeTokenFromUrl()).toBeNull();
    window.history.replaceState({}, "", "/invitation?token=");
    expect(takeTokenFromUrl()).toBeNull();
  });

  it("mot de passe : dix caractères minimum et confirmation identique (même règle que le serveur)", () => {
    expect(passwordFormErrors("court", "court")).toEqual({ password: "10 caractères minimum." });
    expect(passwordFormErrors("assez-long-1", "autre-chose-2")).toEqual({ confirm: "Les deux mots de passe ne correspondent pas." });
    expect(passwordFormErrors("assez-long-1", "assez-long-1")).toEqual({});
  });
});

describe("vitrine › Nouveau mot de passe (/mot-de-passe)", () => {
  it("retire le jeton de l'adresse avant le rendu, envoie token + mot de passe à l'API, puis renvoie vers la connexion", async () => {
    window.history.replaceState({}, "", "/mot-de-passe?token=jeton-de-test-123");
    const calls = stubFetch(() => new Response(null, { status: 204 }));
    renderConnected("/mot-de-passe", <ResetPassword />);
    expect(window.location.search).toBe("");
    expect(window.location.pathname).toBe("/mot-de-passe");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Nouveau mot de passe");
    // Confirmation différente : erreur de saisie, aucun appel réseau.
    typePassword("Nouveau mot de passe", "nouveau-mdp-B2");
    typePassword("Confirmer le mot de passe", "autre-mdp-C3");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le mot de passe" }));
    expect(screen.getByText("Les deux mots de passe ne correspondent pas.")).toBeTruthy();
    expect(calls).toHaveLength(0);
    typePassword("Confirmer le mot de passe", "nouveau-mdp-B2");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le mot de passe" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ url: "/api/auth/password/reset", body: { token: "jeton-de-test-123", password: "nouveau-mdp-B2" } });
    expect(await screen.findByText("Mot de passe modifié")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Se connecter" }).getAttribute("href")).toBe("/connexion");
  });

  it("lien expiré ou déjà utilisé : message du serveur et proposition d'un nouveau lien", async () => {
    window.history.replaceState({}, "", "/mot-de-passe?token=jeton-perime");
    stubFetch(() => json(400, { error: { code: "token_invalid", message: "Ce lien n'est plus valable : il est inconnu, expiré ou a déjà servi. Demandez-en un nouveau." } }));
    renderConnected("/mot-de-passe", <ResetPassword />);
    typePassword("Nouveau mot de passe", "nouveau-mdp-B2");
    typePassword("Confirmer le mot de passe", "nouveau-mdp-B2");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le mot de passe" }));
    expect(await screen.findByText("Lien expiré ou déjà utilisé")).toBeTruthy();
    expect(screen.getByText(/n'est plus valable/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Demander un nouveau lien" }).getAttribute("href")).toBe("/mot-de-passe-oublie");
  });

  it("sans jeton : lien incomplet, aucun formulaire", () => {
    const calls = stubFetch(() => new Response(null, { status: 204 }));
    renderConnected("/mot-de-passe", <ResetPassword />);
    expect(screen.getByText("Lien incomplet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Enregistrer le mot de passe" })).toBeNull();
    expect(screen.getByRole("link", { name: "Demander un nouveau lien" }).getAttribute("href")).toBe("/mot-de-passe-oublie");
    expect(calls).toHaveLength(0);
  });
});

describe("vitrine › Invitation (/invitation)", () => {
  it("retire le jeton de l'adresse, envoie nom + mot de passe, puis ouvre l'accueil des espaces avec la session reçue", async () => {
    window.history.replaceState({}, "", "/invitation?token=invitation-de-test-456");
    const session = { mode: "connected", user: { id: "u1", email: "ines@test.local", displayName: "Inès", isOperator: false, createdAt: "2026-10-28T00:00:00.000Z" }, org: { id: "o1", name: "Boutique A", slug: "boutique-a", settings: {}, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" }, role: "operator", memberships: [] };
    const calls = stubFetch(() => json(200, session));
    renderConnected("/invitation", <AcceptInvite />);
    expect(window.location.search).toBe("");
    fireEvent.change(screen.getByLabelText(/^Votre nom/), { target: { value: "  Inès " } });
    typePassword("Mot de passe", "ines-mdp-solide-1");
    typePassword("Confirmer le mot de passe", "ines-mdp-solide-1");
    fireEvent.click(screen.getByRole("button", { name: "Rejoindre et se connecter" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ url: "/api/auth/invite/accept", body: { token: "invitation-de-test-456", password: "ines-mdp-solide-1", displayName: "Inès" } });
    expect(await screen.findByText("Accueil des espaces")).toBeTruthy();
    expect(queryClient.getQueryData(["session", "connected"])).toEqual(session);
  });

  it("invitation expirée : message et consigne, sans jeton : lien incomplet", async () => {
    window.history.replaceState({}, "", "/invitation?token=perimee");
    stubFetch(() => json(400, { error: { code: "token_invalid", message: "Ce lien n'est plus valable : il est inconnu, expiré ou a déjà servi. Demandez-en un nouveau." } }));
    renderConnected("/invitation", <AcceptInvite />);
    typePassword("Mot de passe", "ines-mdp-solide-1");
    typePassword("Confirmer le mot de passe", "ines-mdp-solide-1");
    fireEvent.click(screen.getByRole("button", { name: "Rejoindre et se connecter" }));
    expect(await screen.findByText("Invitation expirée ou déjà utilisée")).toBeTruthy();
    expect(screen.getByText(/nouvelle invitation à l'administrateur/)).toBeTruthy();
    cleanup();
    window.history.replaceState({}, "", "/invitation");
    renderConnected("/invitation", <AcceptInvite />);
    expect(screen.getByText("Lien incomplet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Rejoindre et se connecter" })).toBeNull();
  });
});

describe("vitrine › Mot de passe oublié (/mot-de-passe-oublie) et lien depuis la connexion", () => {
  it("envoie l'adresse normalisée et affiche la même confirmation quel que soit le compte", async () => {
    const calls = stubFetch(() => new Response(null, { status: 204 }));
    renderConnected("/mot-de-passe-oublie", <ForgotPassword />);
    fireEvent.click(screen.getByRole("button", { name: "Envoyer le lien" }));
    expect(screen.getByText("Saisissez une adresse email valide.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: " Bob@Test.local " } });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer le lien" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ url: "/api/auth/password/forgot", body: { email: "bob@test.local" } });
    expect(await screen.findByText("Demande enregistrée")).toBeTruthy();
    expect(screen.getByText(/Si un compte existe avec cette adresse/).textContent).toContain("valable une heure");
    expect(screen.getByRole("link", { name: "Retour à la connexion" }).getAttribute("href")).toBe("/connexion");
  });

  it("la page de connexion mène à « Mot de passe oublié ? »", () => {
    stubFetch(() => new Response(null, { status: 204 }));
    renderConnected("/connexion", <Login />);
    expect(screen.getByRole("link", { name: "Mot de passe oublié ?" }).getAttribute("href")).toBe("/mot-de-passe-oublie");
  });
});
