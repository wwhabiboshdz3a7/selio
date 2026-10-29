import { describe, expect, it } from "vitest";
import { ISSUER_PLACEHOLDER, invoiceIssuer } from "./env";

const EMPTY = { VITE_INVOICE_ISSUER_NAME: "", VITE_INVOICE_ISSUER_ADDRESS: "", VITE_INVOICE_ISSUER_SIREN: "", VITE_INVOICE_ISSUER_VAT: "", VITE_INVOICE_ISSUER_EMAIL: "" };

describe("mentions de l'émetteur des factures (configuration publique du site)", () => {
  it("sans configuration : « Selio », « à compléter » partout, et la liste des champs manquants", () => {
    const issuer = invoiceIssuer(EMPTY);
    expect(issuer.name).toBe("Selio");
    expect(issuer.addressLines).toEqual([`Adresse ${ISSUER_PLACEHOLDER}`]);
    expect(issuer.siren).toBe(ISSUER_PLACEHOLDER);
    expect(issuer.vatNumber).toBe(ISSUER_PLACEHOLDER);
    expect(issuer.email).toBe(ISSUER_PLACEHOLDER);
    expect(issuer.missing).toEqual(["address", "siren", "vatNumber", "email"]);
  });

  it("renseignée : raison sociale, lignes d'adresse séparées par « | », plus rien à compléter", () => {
    const issuer = invoiceIssuer({
      VITE_INVOICE_ISSUER_NAME: " Selio SAS ",
      VITE_INVOICE_ISSUER_ADDRESS: "12 rue de l'Exemple | 13001 Marseille | France",
      VITE_INVOICE_ISSUER_SIREN: "000 000 000",
      VITE_INVOICE_ISSUER_VAT: "FR00000000000",
      VITE_INVOICE_ISSUER_EMAIL: "facturation@exemple.fr",
    });
    expect(issuer.name).toBe("Selio SAS");
    expect(issuer.addressLines).toEqual(["12 rue de l'Exemple", "13001 Marseille", "France"]);
    expect(issuer.siren).toBe("000 000 000");
    expect(issuer.vatNumber).toBe("FR00000000000");
    expect(issuer.email).toBe("facturation@exemple.fr");
    expect(issuer.missing).toEqual([]);
  });

  it("à moitié renseignée : seuls les champs vides sont signalés", () => {
    const issuer = invoiceIssuer({ ...EMPTY, VITE_INVOICE_ISSUER_ADDRESS: "1 rue A | 75001 Paris", VITE_INVOICE_ISSUER_EMAIL: "contact@exemple.fr" });
    expect(issuer.missing).toEqual(["siren", "vatNumber"]);
    expect(issuer.addressLines).toEqual(["1 rue A", "75001 Paris"]);
  });
});
