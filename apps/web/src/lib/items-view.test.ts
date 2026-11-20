import { describe, expect, it } from "vitest";
import { adjustedPrice } from "@selio/contracts";
import { activeItemFilters, isTypingTarget, itemsKeyAction, itemsQueryFromParams } from "./items-view";
import { moveItem, SHORTCUTS } from "../app/components/shortcuts";

describe("Articles et stock : filtres dans l'adresse", () => {
  it("lit recherche, statut, compte, sans photo, marge, en ligne, tri et page", () => {
    const q = itemsQueryFromParams(new URLSearchParams("q=pull&status=listed&account=c1&photos=none&margin=low&online=14&sort=price_desc&page=2"));
    expect(q).toMatchObject({ q: "pull", status: "listed", connectionId: "c1", photos: "none", margin: "low", minDaysOnline: 14, sort: "price_desc", page: 2, pageSize: 24 });
    expect(itemsQueryFromParams(new URLSearchParams("margin=nimporte&page=-3"))).toMatchObject({ margin: undefined, page: 1, sort: "updated_desc" });
  });

  it("filtres actifs nommés (catégorie, marque, compte, sans photo, marge)", () => {
    const f = activeItemFilters(new URLSearchParams("category=shoes&brand=Nike&account=c1&photos=none&margin=negative&q=x&status=listed"), { accounts: { c1: "Boutique Marie" } });
    expect(f.map((x) => x.label)).toEqual(["Chaussures", "Nike", "Boutique Marie", "Sans photo", "Marge négative"]);
  });
});

describe("raccourcis clavier", () => {
  const ev = (key: string, extra: Partial<KeyboardEvent> = {}, target: EventTarget | null = document.body) => ({ key, ctrlKey: false, metaKey: false, altKey: false, target, ...extra });
  it("« / » cherche, « n » crée, Échap vide ; jamais pendant une saisie ni avec Ctrl ou Cmd", () => {
    expect(itemsKeyAction(ev("/"))).toBe("search");
    expect(itemsKeyAction(ev("n"))).toBe("new");
    expect(itemsKeyAction(ev("Escape"))).toBe("clear");
    expect(itemsKeyAction(ev("n", { ctrlKey: true }))).toBeNull();
    expect(itemsKeyAction(ev("/", { metaKey: true }))).toBeNull();
    const input = document.createElement("input");
    expect(isTypingTarget(input)).toBe(true);
    expect(itemsKeyAction(ev("n", {}, input))).toBeNull();
    expect(isTypingTarget(document.createElement("div"))).toBe(false);
  });
});

describe("raccourcis personnalisés : ordre", () => {
  it("déplace un raccourci", () => {
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
    expect(SHORTCUTS.orders_to_ship.to).toBe("/app/orders?status=paid");
  });

  it("ajustement de prix en lot : arrondi à 10 centimes, jamais sous le plancher", () => {
    expect(adjustedPrice(1999, null, -0.1)).toBe(1800);
    expect(adjustedPrice(1500, 1400, -0.1)).toBe(1400);
    expect(adjustedPrice(null, null, 0.2)).toBeNull();
  });
});
