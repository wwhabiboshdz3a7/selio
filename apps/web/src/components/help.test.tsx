import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, matchRoutes, MemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { helpEntries } from "@selio/domain/help";
import { router } from "../router";
import { FaqBrowser, HelpAskPanel, askFaqLocally, frenchSpacing } from "./help";

afterEach(() => cleanup());

describe("aide : liens internes de la FAQ", () => {
  // Garde-fou : si une page change d'adresse, la réponse qui y renvoie doit suivre.
  it("chaque lien d'une réponse mène à une vraie page (ni page inconnue ni redirection générique)", () => {
    const links = helpEntries().flatMap((e) => (e.link ? [{ id: e.id, href: e.link.href }] : []));
    expect(links.length).toBeGreaterThan(20);
    for (const { id, href } of links) {
      const matches = matchRoutes(router.routes, href);
      expect(matches, `${id} → ${href}`).not.toBeNull();
      expect(matches!.at(-1)!.route.path, `${id} → ${href}`).not.toBe("*");
    }
  });
});

describe("aide : typographie", () => {
  it("espaces insécables entre un nombre et son unité, avant la ponctuation haute et dans les guillemets", () => {
    expect(frenchSpacing("« 1 semaine ou 5 000 articles ? »")).toBe("« 1 semaine ou 5 000 articles ? »");
    expect(frenchSpacing("Prix : 19 €")).toBe("Prix : 19 €");
  });
});

describe("aide : composants", () => {
  it("la recherche instantanée filtre et ouvre la meilleure réponse", () => {
    render(<MemoryRouter><FaqBrowser basePath="/faq" appLinks={false} /></MemoryRouter>);
    expect(document.querySelectorAll("details").length).toBe(helpEntries().length);
    fireEvent.change(screen.getByLabelText("Rechercher dans l'aide"), { target: { value: "exporter mes données" } });
    expect(screen.getByText(/réponses? pour « exporter mes données »/)).toBeTruthy();
    const first = document.querySelector("details")!;
    expect(first.id).toBe("export-donnees");
    expect(first.hasAttribute("open")).toBe(true);
    // Sur la vitrine sans session, pas de lien vers les pages de l'application.
    expect(within(first).queryByRole("link", { name: /Export et suppression/ })).toBeNull();
  });

  it("une ancre partagée ouvre la question visée", async () => {
    const r = createMemoryRouter([{ path: "/faq", element: <FaqBrowser basePath="/faq" appLinks /> }], { initialEntries: ["/faq#achat-reel"] });
    render(<RouterProvider router={r} />);
    await waitFor(() => expect(document.getElementById("achat-reel")!.hasAttribute("open")).toBe(true));
    expect(document.getElementById("affiliation-vinted")!.hasAttribute("open")).toBe(false);
  });

  it("« Poser une question » : réponse tirée de la FAQ, questions sources cliquables", async () => {
    render(<MemoryRouter><HelpAskPanel engine="local" ask={askFaqLocally} sourceHref={(id) => `/faq#${id}`} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("Votre question"), { target: { value: "Combien de temps dure l'essai gratuit ?" } });
    fireEvent.click(screen.getByRole("button", { name: "Demander" }));
    await waitFor(() => expect(screen.getByTestId("help-origin").textContent).toBe("Réponse tirée de la FAQ"));
    const source = screen.getByRole("link", { name: /Comment fonctionne l.essai gratuit de\s14\sjours/ });
    expect(source.getAttribute("href")).toBe("/faq#essai-decouverte");
  });

  it("question hors du champ de l'aide : aucune invention, aucune source", async () => {
    render(<MemoryRouter><HelpAskPanel engine="local" ask={askFaqLocally} sourceHref={(id) => `/faq#${id}`} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("Votre question"), { target: { value: "Quelle est la recette des crêpes ?" } });
    fireEvent.click(screen.getByRole("button", { name: "Demander" }));
    await waitFor(() => expect(screen.getByTestId("help-origin").textContent).toBe("Aucune réponse dans la FAQ"));
    expect(screen.queryByText("Questions sources")).toBeNull();
  });
});
