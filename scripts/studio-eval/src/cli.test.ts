import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CliError, main, parseArgs } from "./cli";
import { FakeAI, fakeJpeg, tempDir, writeDataset } from "./testing";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { log: (l: string) => out.push(l), error: (l: string) => err.push(l) } };
}

async function sampleDataset(): Promise<string> {
  const dir = await writeDataset({
    labelsCsv: "photo;brand;size\ne1.jpg;Levi's;M\ne2.jpg;Zara;S\n",
    labelPhotos: { "e1.jpg": fakeJpeg(800, 600), "e2.jpg": fakeJpeg(800, 600) },
    tapesCsv: "article;garmentKind;photos;chest\nA1;top;a1.jpg;52\n",
    tapePhotos: { "a1.jpg": fakeJpeg(900, 900) },
  });
  dirs.push(dir);
  return dir;
}

describe("parseArgs", () => {
  it("lit le dossier et toutes les options", () => {
    expect(parseArgs(["/jeu", "--mode", "api", "--out", "r.md", "--json", "--only", "mesures", "--limit", "5", "--no-ocr", "--allow-mock"])).toEqual({
      dataset: "/jeu", mode: "api", out: "r.md", json: true, only: "tapes", limit: 5, ocr: false, allowMock: true, help: false,
    });
    expect(parseArgs(["--only", "etiquettes", "/jeu"]).only).toBe("labels");
    expect(parseArgs([]).dataset).toBeNull();
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  it("refuse une option inconnue, un mode inconnu, une limite nulle, un argument en trop", () => {
    expect(() => parseArgs(["--zzz"])).toThrow(CliError);
    expect(() => parseArgs(["--mode", "autre"])).toThrow(/direct » ou « api/);
    expect(() => parseArgs(["--limit", "0"])).toThrow(/--limit/);
    expect(() => parseArgs(["--only", "photos"])).toThrow(/--only/);
    expect(() => parseArgs(["/a", "/b"])).toThrow(/argument en trop/);
  });
});

describe("main", () => {
  it("écrit un rapport daté dans le dossier des rapports et rend 0 pour une mesure réelle", async () => {
    const dataset = await sampleDataset();
    const reports = await tempDir("selio-rapports-");
    dirs.push(reports);
    const ai = new FakeAI([{ brand: { value: "Levi's" }, size: { value: "M" } }, { brand: { value: "Zara" }, size: { value: "M" } }], [{ measurements: [{ name: "chest", valueCm: 52 }] }]);
    const { out, err, io: cio } = io();
    const code = await main([dataset, "--json"], { INIT_CWD: "/" }, cio, { createService: () => ai, reportsDir: reports, now: () => new Date(2026, 10, 6, 9, 5) });
    expect(err).toEqual([]);
    expect(code).toBe(0);
    const files = (await readdir(reports)).sort();
    expect(files).toEqual(["2026-11-06-0905-studio-eval.json", "2026-11-06-0905-studio-eval.md"]);
    const md = await readFile(path.join(reports, files[1]!), "utf8");
    expect(md).toContain("**Marques et tailles justes : 75,0 % (objectif ≥ 95,0 %) — non atteint.**");
    expect(md).toContain("**Mesures justes à 1 cm près : 100,0 % (objectif ≥ 90,0 %) — atteint.**");
    const json = JSON.parse(await readFile(path.join(reports, files[0]!), "utf8")) as { labels: { cases: unknown[] } };
    expect(json.labels.cases).toHaveLength(2);
    expect(out.some((l) => l.startsWith("Rapport : ") && l.endsWith("(+ .json)"))).toBe(true);
    expect(out.some((l) => l.startsWith("Étiquettes : 2 lue(s) · marques et tailles justes 75,0 %"))).toBe(true);
  });

  it("refuse le simulateur sans --allow-mock, l'accepte avec, et rend alors 3 avec un rapport qui ne mesure rien", async () => {
    const dataset = await sampleDataset();
    const reports = await tempDir("selio-rapports-");
    dirs.push(reports);
    const refused = io();
    expect(await main([dataset], { AI_PROVIDER: "mock" }, refused.io, { reportsDir: reports })).toBe(1);
    expect(refused.err[0]).toMatch(/AI_PROVIDER=mock.*--allow-mock/);
    expect(await readdir(reports)).toEqual([]);

    const allowed = io();
    const out = path.join(reports, "simule.md");
    expect(await main([dataset, "--allow-mock", "--out", out, "--limit", "1"], { AI_PROVIDER: "mock", INIT_CWD: "/" }, allowed.io, { reportsDir: reports })).toBe(3);
    const md = await readFile(out, "utf8");
    expect(md).toContain("SIMULATEUR — CE RAPPORT NE MESURE RIEN");
    expect(md).toContain("- Jeu : 1 photo(s) d'étiquette");
    expect(allowed.err).toEqual(["SIMULATEUR : ce rapport ne mesure rien. Relancez avec AI_PROVIDER=ollama sur la machine."]);
  });

  it("rend 2 quand rien n'a pu être évalué (toutes les photos écartées)", async () => {
    const dir = await writeDataset({ labelsCsv: "photo;brand\ngrande.jpg;Zara\n", labelPhotos: { "grande.jpg": fakeJpeg(2000, 1500) } });
    dirs.push(dir);
    const reports = await tempDir("selio-rapports-");
    dirs.push(reports);
    const { err, io: cio } = io();
    expect(await main([dir], {}, cio, { createService: () => new FakeAI(), reportsDir: reports })).toBe(2);
    expect(err.at(-1)).toMatch(/Rien n'a pu être évalué/);
    expect(await readdir(reports)).toHaveLength(1);
  });

  it("rend 1 avec un message clair : dossier absent, vérité refusée, mode api sans identifiants, serveur injoignable, option inconnue", async () => {
    const absent = io();
    expect(await main(["/nulle/part"], {}, absent.io)).toBe(1);
    expect(absent.err[0]).toMatch(/Dossier introuvable/);

    const bad = await writeDataset({ labelsCsv: "photo;pseudo\ne.jpg;x\n" });
    dirs.push(bad);
    const refused = io();
    expect(await main([bad], {}, refused.io)).toBe(1);
    expect(refused.err[0]).toMatch(/colonne\(s\) inconnue\(s\) « pseudo »/);

    const dataset = await sampleDataset();
    const api = io();
    expect(await main([dataset, "--mode", "api"], {}, api.io)).toBe(1);
    expect(api.err[0]).toMatch(/STUDIO_EVAL_EMAIL et STUDIO_EVAL_PASSWORD/);
    expect(api.err.join("\n")).not.toContain("secret");

    const down = new FakeAI();
    down.health = async () => {
      throw new Error("ECONNREFUSED 10.0.0.5:11434");
    };
    const unreachable = io();
    expect(await main([dataset], {}, unreachable.io, { createService: () => down })).toBe(1);
    expect(unreachable.err[0]).toMatch(/Serveur IA injoignable/);

    const unknown = io();
    expect(await main(["--zzz"], {}, unknown.io)).toBe(1);
    expect(unknown.err[1]).toMatch(/^Usage/);

    const help = io();
    expect(await main(["--help"], {}, help.io)).toBe(0);
    expect(help.out[0]).toMatch(/^Usage/);
  });

  it("en mode api, le mot de passe ne part que dans la requête de connexion", async () => {
    const dataset = await sampleDataset();
    const reports = await tempDir("selio-rapports-");
    dirs.push(reports);
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (typeof init?.body === "string") bodies.push(init.body);
      const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
      if (url.endsWith("/api/auth/login")) return json(200, { ok: true }, { "set-cookie": "selio_session=s; Path=/" });
      if (url.endsWith("/api/studio/limits")) return json(200, { vision: { available: true, simulated: false, ocrConfigured: false } });
      return json(201, { batchId: "b", articles: [{ fields: { brand: { value: "Levi's", source: "label", confidence: 0.9 }, size: { value: "M", source: "label", confidence: 0.9 }, material: { value: null, source: null }, reference: { value: null, source: null } }, tapeVisible: true, measurements: [{ name: "chest", valueCm: 52, source: "tape_photo", confidence: 0.9 }], questions: [], warnings: [] }], warnings: [], simulated: false, ocr: { configured: false, used: false } });
    };
    const { out, err, io: cio } = io();
    const code = await main([dataset, "--mode", "api", "--out", path.join(reports, "api.md")], { STUDIO_EVAL_EMAIL: "equipe@selio.test", STUDIO_EVAL_PASSWORD: "secret-de-test", STUDIO_EVAL_API_URL: "http://127.0.0.1:8787", INIT_CWD: "/" }, cio, { fetchImpl });
    expect(err).toEqual([]);
    expect(code).toBe(0);
    expect(bodies.filter((b) => b.includes("secret-de-test"))).toHaveLength(1);
    const md = await readFile(path.join(reports, "api.md"), "utf8");
    expect(md).toContain("mode : API locale (http://127.0.0.1:8787, POST /api/studio/prepare)");
    expect(md).not.toContain("secret-de-test");
    expect(md).not.toContain("equipe@selio.test");
    expect(out.join("\n")).not.toContain("secret-de-test");
  });
});
