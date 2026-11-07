import { describe, expect, it } from "vitest";
import { detectSeparator, parseCsv } from "./csv";

describe("csv", () => {
  it("détecte le séparateur sur l'en-tête (point-virgule par défaut)", () => {
    expect(detectSeparator("photo;brand;size")).toBe(";");
    expect(detectSeparator("photo,brand,size")).toBe(",");
    expect(detectSeparator("photo\tbrand\tsize")).toBe("\t");
    expect(detectSeparator("photo")).toBe(";");
  });

  it("lit l'en-tête, les lignes, les guillemets doublés et le séparateur entre guillemets", () => {
    const t = parseCsv('photo,brand,size\ne1.jpg,"Levi\'s",W32 L32\ne2.jpg,"Dolce ""&"" Gabbana","38, FR"\n');
    expect(t.separator).toBe(",");
    expect(t.header).toEqual(["photo", "brand", "size"]);
    expect(t.rows).toEqual([
      ["e1.jpg", "Levi's", "W32 L32"],
      ["e2.jpg", 'Dolce "&" Gabbana', "38, FR"],
    ]);
    expect(t.lineNumbers).toEqual([2, 3]);
  });

  it("tolère le BOM, les fins de ligne CRLF et les lignes vides, en gardant le numéro de ligne du fichier", () => {
    const t = parseCsv("﻿photo;brand\r\n\r\ne1.jpg;Zara\r\n;\r\ne2.jpg;Nike\r\n");
    expect(t.header).toEqual(["photo", "brand"]);
    expect(t.rows).toEqual([
      ["e1.jpg", "Zara"],
      ["e2.jpg", "Nike"],
    ]);
    expect(t.lineNumbers).toEqual([3, 5]);
  });

  it("rend un tableau vide sans ligne", () => {
    const t = parseCsv("photo;brand\n");
    expect(t.rows).toEqual([]);
  });
});
