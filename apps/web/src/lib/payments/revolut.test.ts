import { afterEach, describe, expect, it, vi } from "vitest";
import { WIDGET_LOAD_ERROR, describeRevolutError, payWithRevolutPopup, setRevolutLoaderForTests, widgetMode, type RevolutWidgetInstance } from "./revolut";

afterEach(() => setRevolutLoaderForTests(null));

describe("formulaire Revolut Checkout (fenêtre popup)", () => {
  it("mode du widget : bac à sable par défaut, « prod » seulement quand l'API est en live", () => {
    expect(widgetMode("sandbox")).toBe("sandbox");
    expect(widgetMode(null)).toBe("sandbox");
    expect(widgetMode(undefined)).toBe("sandbox");
    expect(widgetMode("live")).toBe("prod");
  });

  it("ouvre le formulaire avec la carte enregistrée « pour le marchand » et relaie succès, erreur et annulation", async () => {
    const payWithPopup = vi.fn();
    const destroy = vi.fn();
    const loader = vi.fn(async (): Promise<RevolutWidgetInstance> => ({ payWithPopup, destroy }));
    setRevolutLoaderForTests(loader);
    const handlers = { onSuccess: vi.fn(), onError: vi.fn(), onCancel: vi.fn() };
    const instance = await payWithRevolutPopup({ token: "tok_public_123", mode: "sandbox", email: "marie@exemple.fr", name: "Marie Lefèvre" }, handlers);
    // Le chargeur ne reçoit que le jeton public de la commande et le mode : jamais une clé secrète.
    expect(loader).toHaveBeenCalledWith("tok_public_123", "sandbox");
    expect(payWithPopup).toHaveBeenCalledTimes(1);
    const opts = payWithPopup.mock.calls[0]![0];
    expect(opts).toMatchObject({ savePaymentMethodFor: "merchant", email: "marie@exemple.fr", name: "Marie Lefèvre", locale: "fr" });
    opts.onSuccess!();
    expect(handlers.onSuccess).toHaveBeenCalledTimes(1);
    // L'erreur du widget est traduite : jamais son message brut (qui pourrait contenir des détails techniques).
    opts.onError!({ type: "error.declined", message: "Card 4242 declined by issuer" });
    expect(handlers.onError).toHaveBeenCalledWith(expect.stringMatching(/refusé par votre banque/));
    expect(handlers.onError.mock.calls[0]![0]).not.toMatch(/4242|issuer/);
    opts.onCancel!();
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
    instance.destroy();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("script Revolut non chargé (réseau, bloqueur, CSP) : rejet, et un message qui dit que rien n'a été débité", async () => {
    setRevolutLoaderForTests(async () => {
      throw new Error("embed.js bloqué");
    });
    const handlers = { onSuccess: vi.fn(), onError: vi.fn(), onCancel: vi.fn() };
    await expect(payWithRevolutPopup({ token: "tok", mode: "live" }, handlers)).rejects.toThrow(/bloqué/);
    expect(handlers.onError).not.toHaveBeenCalled();
    expect(WIDGET_LOAD_ERROR).toMatch(/Rien n'a été débité/);
  });

  it("messages d'erreur lisibles, repli générique sans donnée de carte", () => {
    expect(describeRevolutError({ type: "error.insufficient-funds", message: "raw" })).toMatch(/Fonds insuffisants/);
    expect(describeRevolutError({ type: "error.3ds-failed" })).toMatch(/3-D Secure/);
    expect(describeRevolutError({ type: "error.order-already-completed" })).toMatch(/déjà payée/);
    const generic = describeRevolutError({ type: "error.unknown-thing", message: "stack trace 4111 1111" });
    expect(generic).toMatch(/n'a pas abouti/);
    expect(generic).toMatch(/Aucun montant n'a été débité/);
    expect(generic).not.toMatch(/4111|stack/);
    expect(describeRevolutError(null)).toMatch(/Aucun montant n'a été débité/);
    expect(describeRevolutError(new Error("réseau"))).toMatch(/réessayer/);
  });
});
