import { PersonalDataError, parseCsv, parseReferencesCsv, parseReferencesJson } from "./io";

describe("parseCsv", () => {
  it("guillemets, séparateur détecté, BOM et fins de ligne Windows", () => {
    expect(parseCsv('﻿a;b;c\r\n1;"x;y";3\r\n\r\n4;"il dit ""oui""";6')).toEqual([
      ["a", "b", "c"],
      ["1", "x;y", "3"],
      ["4", 'il dit "oui"', "6"],
    ]);
    expect(parseCsv("a,b\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("parseReferencesCsv", () => {
  it("lit les colonnes en camelCase ou snake_case, prix en centimes ou en euros", () => {
    const csv = [
      "brand;category;subcategory;size;condition;listed_price_cents;final_price_eur;listed_at;sold_at;photo_count;source",
      "Levi's;Jeans;Jean droit;W32;Très bon état;3000;27,50;2026-09-01;2026-09-10;6;client_sale",
      ";T-shirts;;M;good;900;;2026-09-02;;;",
    ].join("\n");
    const { references, errors } = parseReferencesCsv(csv);
    expect(errors).toEqual([]);
    expect(references).toHaveLength(2);
    expect(references[0]).toMatchObject({ brand: "Levi's", listedPriceCents: 3000, finalPriceCents: 2750, photoCount: 6, source: "client_sale", soldAt: "2026-09-10" });
    expect(references[1]).toMatchObject({ brand: "", source: "provided_base" });
    expect(references[1]!.finalPriceCents).toBeUndefined();
  });

  it("refuse le fichier entier s'il contient une colonne personnelle ou un identifiant d'annonce", () => {
    for (const col of ["pseudo", "seller_login", "url", "photo_url", "item_id", "titre", "vendeur"]) {
      expect(() => parseReferencesCsv(`brand,category,condition,listedPriceCents,listedAt,${col}\nZara,Robes,good,1500,2026-09-01,x`)).toThrow(PersonalDataError);
    }
  });

  it("refuse une colonne inconnue et liste les lignes invalides", () => {
    expect(() => parseReferencesCsv("brand,category,couleur_preferee\nZara,Robes,x")).toThrow(/Colonnes inconnues/);
    const { references, errors } = parseReferencesCsv(
      ["brand,category,condition,listedPriceCents,listedAt,source", "Zara,Robes,good,abc,2026-09-01,", "Zara,Robes,good,1500,2026-09-01,inventee", "Zara,,good,1500,2026-09-01,"].join("\n"),
    );
    expect(references).toHaveLength(0);
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4]);
    expect(errors[0]!.message).toMatch(/nombre invalide/);
  });
});

describe("parseReferencesJson", () => {
  it("tableau ou { references }, schéma strict", () => {
    const row = { brand: "Zara", category: "Robes", condition: "good", listedPriceCents: 1500, listedAt: "2026-09-01" };
    expect(parseReferencesJson([row]).references[0]).toMatchObject({ ...row, source: "provided_base" });
    expect(parseReferencesJson({ references: [row] }).references).toHaveLength(1);
    const { errors } = parseReferencesJson([{ ...row, listedPriceCents: 12.5 }, { ...row, autre: 1 }, "x"]);
    expect(errors.map((e) => e.line)).toEqual([1, 2, 3]);
    expect(() => parseReferencesJson({ nope: [] })).toThrow(/tableau/);
  });

  it("refuse le fichier si une seule ligne porte un pseudo", () => {
    const row = { brand: "Zara", category: "Robes", condition: "good", listedPriceCents: 1500, listedAt: "2026-09-01" };
    expect(() => parseReferencesJson([row, { ...row, sellerLogin: "quelqu'un" }])).toThrow(PersonalDataError);
  });
});
