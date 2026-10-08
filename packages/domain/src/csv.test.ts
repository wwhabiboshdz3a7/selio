import { describe, expect, it } from "vitest";
import { parseCsv, previewInventoryImport, toCsv, parseFrDate } from "./csv";

describe("csv", () => {
  it("parse les guillemets, retours à la ligne et séparateurs", () => {
    const rows = parseCsv('Titre;Marque\n"Veste ""chaude""";"Nike\nParis"\n');
    expect(rows).toEqual([["Titre", "Marque"], ['Veste "chaude"', "Nike\nParis"]]);
    expect(parseCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("prévisualise un import avec erreurs ligne par ligne", () => {
    const csv = ["Titre;Marque;Prix d'achat;Prix affiché;Statut;État", "Veste;Nike;12,50;35;en vente;bon état", ";Adidas;10;20;en stock;", "Pull;Zara;abc;30;vendu;", "Jean;Levi's;20;40;inconnu;"].join("\n");
    const p = previewInventoryImport(csv);
    expect(p.rows).toHaveLength(4);
    expect(p.rows[0]!.item?.purchasePriceCents).toBe(1250);
    expect(p.rows[0]!.item?.status).toBe("listed");
    expect(p.rows[1]!.errors[0]).toMatch(/Titre manquant/);
    expect(p.rows[2]!.errors[0]).toMatch(/illisible/);
    expect(p.rows[3]!.errors[0]).toMatch(/Statut inconnu/);
    expect(p.validCount).toBe(1);
    expect(p.errorCount).toBe(3);
  });
  it("refuse un fichier sans colonne titre", () => {
    const p = previewInventoryImport("a;b\n1;2");
    expect(p.errorCount).toBe(1);
    expect(p.rows[0]!.errors[0]).toMatch(/Titre/);
  });
  it("neutralise les injections de formule à l'export", () => {
    expect(toCsv([["=SUM(A1)", "ok"]])).toContain("'=SUM(A1)");
  });
  it("parse les dates françaises", () => {
    expect(parseFrDate("05/10/2026")).toBe("2026-10-05T12:00:00.000Z");
    expect(parseFrDate("2026-10-05")).toBe("2026-10-05T12:00:00.000Z");
    expect(parseFrDate("31/02/2026")).toBeNull();
  });
});
