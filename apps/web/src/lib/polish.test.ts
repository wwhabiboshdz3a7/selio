import { z } from "zod";
import { inventoryItemCreate } from "@selio/contracts";
import { fieldErrorMessage } from "./errors";
import { pageSection } from "../app/layout";
import { prefetchRoute, registerPrefetchRoutes } from "../app/prefetch";

describe("messages d'erreur des formulaires", () => {
  it("traduit les erreurs de validation en français, sous le champ", () => {
    const parsed = inventoryItemCreate.safeParse({ title: "" });
    expect(parsed.success).toBe(false);
    const issue = parsed.success ? null : parsed.error.issues.find((i) => i.path[0] === "title")!;
    expect(fieldErrorMessage(issue!)).toBe("Champ obligatoire.");
    const url = z.object({ u: z.string().url() }).safeParse({ u: "pas une adresse" });
    expect(fieldErrorMessage(url.success ? (null as never) : url.error.issues[0]!)).toMatch(/^Adresse web invalide/);
    const long = z.string().max(3).safeParse("abcdef");
    expect(fieldErrorMessage(long.success ? (null as never) : long.error.issues[0]!)).toBe("3 caractères maximum.");
    expect(fieldErrorMessage({ code: "custom", message: "Le plancher ne peut pas dépasser le prix affiché." })).toBe("Le plancher ne peut pas dépasser le prix affiché.");
  });
});

describe("transitions et préchargement", () => {
  it("la messagerie et les paramètres gardent leur cadre (pas de transition entre leurs vues)", () => {
    expect(pageSection("/app/messages")).toBe(pageSection("/app/messages/c-1"));
    expect(pageSection("/app/settings/organisation")).toBe(pageSection("/app/settings/apparence"));
    expect(pageSection("/app/items")).not.toBe(pageSection("/app/items/item-1"));
  });

  it("précharge une seule fois le code de la page survolée, et ignore les adresses inconnues", async () => {
    const lazy = vi.fn(async () => ({ Component: () => null }));
    registerPrefetchRoutes([{ path: "/app", children: [{ path: "orders", lazy }] }]);
    prefetchRoute("/app/orders?status=paid");
    prefetchRoute("/app/orders");
    prefetchRoute("/nulle-part");
    await Promise.resolve();
    await Promise.resolve();
    expect(lazy).toHaveBeenCalledTimes(1);
  });
});
