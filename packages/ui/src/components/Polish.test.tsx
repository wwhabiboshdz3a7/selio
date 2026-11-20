import { cleanup, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { Button, IconButton } from "./Button";
import { Input, Select } from "./Field";
import { CountUp } from "./Kpi";
import { LoadingState, SkeletonRows } from "./States";
import { Table, Td, Th } from "./Table";

afterEach(cleanup);

describe("ergonomie et animations (20 novembre 2026)", () => {
  it("boutons, icônes et champs : 44 px de haut sur téléphone, retour visuel au clic", () => {
    render(<><Button>Enregistrer</Button><Button size="sm">Petit</Button><IconButton label="Fermer">x</IconButton><Input aria-label="Nom" /><Select aria-label="Choix"><option>a</option></Select></>);
    expect(screen.getByRole("button", { name: "Enregistrer" }).className).toContain("max-md:h-11");
    expect(screen.getByRole("button", { name: "Petit" }).className).toContain("max-md:h-11");
    expect(screen.getByRole("button", { name: "Enregistrer" }).className).toContain("press");
    expect(screen.getByRole("button", { name: "Fermer" }).className).toContain("max-md:size-11");
    // 16 px sur téléphone : pas de zoom automatique de Safari iOS au focus.
    expect(screen.getByRole("textbox", { name: "Nom" }).className).toContain("max-md:h-11");
    expect(screen.getByRole("textbox", { name: "Nom" }).className).toContain("max-md:text-md");
    expect(screen.getByRole("combobox", { name: "Choix" }).className).toContain("max-md:h-11");
  });

  it("chargement : squelette et libellé pour les lecteurs d'écran, sans texte « Chargement… » visible", () => {
    render(<LoadingState />);
    const status = screen.getByRole("status");
    expect(status.querySelector(".skeleton")).not.toBeNull();
    expect(status.querySelector(".sr-only")?.textContent).toBe("Chargement…");
    cleanup();
    render(<SkeletonRows rows={2} />);
    expect(screen.getByRole("status", { name: "Chargement…" })).toBeTruthy();
    cleanup();
    render(<LoadingState variant="spinner" label="Ouverture de la session…" />);
    expect(screen.getByText("Ouverture de la session…")).toBeTruthy();
  });

  it("tableau « stack » : chaque cellule reçoit le libellé de sa colonne (fiches sur téléphone)", () => {
    render(
      <Table stack>
        <thead><tr><Th>Article</Th><Th>Statut</Th><Th numeric>Vente</Th></tr></thead>
        <tbody><tr><Td>Pull</Td><Td>Payée</Td><Td numeric>24,00 €</Td></tr><tr><td colSpan={3}>Rien</td></tr></tbody>
      </Table>,
    );
    const table = screen.getByRole("table");
    expect(table.getAttribute("data-stack")).toBe("true");
    const cells = [...table.querySelectorAll("tbody tr:first-child td")];
    expect(cells.map((c) => c.getAttribute("data-label"))).toEqual(["Article", "Statut", "Vente"]);
    expect(table.querySelector("td[colspan]")?.hasAttribute("data-label")).toBe(false);
  });

  it("compteur animé : la valeur finale est rendue d'emblée (pas de mise en page : aucune animation)", () => {
    render(<p><CountUp value={6229} format={(v) => `${(v / 100).toFixed(2).replace(".", ",")} €`} /></p>);
    expect(screen.getByText("62,29 €")).toBeTruthy();
  });
});
