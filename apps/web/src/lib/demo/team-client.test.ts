import { beforeEach, describe, expect, it } from "vitest";
import { MemoryDemoStorage } from "@selio/demo-data";
import { REFERRAL_CODE_RE } from "@selio/contracts";
import { DemoClient } from "./client";

let client: DemoClient;
beforeEach(async () => {
  client = new DemoClient(new MemoryDemoStorage(), () => new Date("2026-11-08T12:00:00Z"));
  await client.login({ email: "marie@demo.selio.local", password: "demo" });
});

describe("démonstration : rôles d'équipe, parrainage, supervision", () => {
  it("essai de rôle : la session et les règles suivent le rôle essayé, puis reviennent au sien", async () => {
    expect((await client.getSession())!.role).toBe("owner");
    const s = await client.previewRole("photographer");
    expect(s.role).toBe("photographer");
    // Les droits du rôle s'appliquent aussi aux actions de la démo.
    await expect(client.getReferral()).rejects.toMatchObject({ status: 403 });
    expect((await client.previewRole(null)).role).toBe("owner");
    // Revenir à son propre rôle par la liste équivaut à arrêter l'essai.
    expect((await client.previewRole("owner")).role).toBe("owner");
  });

  it("ajout de photos seul (« items.photos.write ») : le contributeur photos peut, la lecture seule non, 12 au plus", async () => {
    const [item] = (await client.listItems({ pageSize: 1 })).items;
    const before = item!.photos.length;
    await client.previewRole("photographer");
    const photo = { id: "ph-new-1", url: "data:image/png;base64,AAAA", alt: "dos.png", position: 0 };
    const after = await client.addItemPhotos(item!.id, [photo]);
    expect(after.photos).toHaveLength(before + 1);
    expect(after.photos.at(-1)).toMatchObject({ id: "ph-new-1", position: before });
    // Le reste de l'article ne bouge pas.
    expect(after.title).toBe(item!.title);
    expect(after.purchasePriceCents).toBe(item!.purchasePriceCents);
    const many = Array.from({ length: 12 }, (_, i) => ({ ...photo, id: `ph-${i}` }));
    await expect(client.addItemPhotos(item!.id, many)).rejects.toMatchObject({ status: 400 });
    await client.previewRole("viewer");
    await expect(client.addItemPhotos(item!.id, [photo])).rejects.toMatchObject({ status: 403 });
  });

  it("parrainage de la démo : ouvert en « proposition », code valide, lien d'inscription prérempli", async () => {
    const r = await client.getReferral();
    expect(r).toMatchObject({ enabled: true, proposal: true });
    expect(REFERRAL_CODE_RE.test(r.code!)).toBe(true);
    expect(r.shareUrl).toMatch(new RegExp(`/inscription\\?parrain=${r.code}$`));
  });

  it("inscription avec un code : jamais bloquante, le code est seulement noté", async () => {
    await expect(client.register({ email: "lea@exemple.fr", password: "motdepasse-long", displayName: "Léa", orgName: "Boutique Léa", referralCode: "ab3-k7q" })).resolves.toMatchObject({ role: "owner" });
    expect((await client.listAuditLogs(20)).find((a) => a.action === "referral.code_noted")?.meta).toMatchObject({ code: "AB3K7Q", simulated: true });
    await expect(client.register({ email: "lea@exemple.fr", password: "motdepasse-long", displayName: "Léa", orgName: "Boutique Léa", referralCode: "n'importe quoi" })).resolves.toBeTruthy();
    const audit = await client.listAuditLogs(20);
    expect(audit.some((a) => a.action === "referral.code_noted")).toBe(false);
  });

  it("supervision : réservée aux opérateurs Selio, exemple marqué simulé", async () => {
    const d = await client.getHealthDetails();
    expect(d.simulated).toBe(true);
    expect(d.supervision.failuresBeforeAlert).toBe(3);
    expect(d.supervision.targets.map((t) => t.name)).toEqual(["API Selio", "Assistant IA"]);
  });
});
