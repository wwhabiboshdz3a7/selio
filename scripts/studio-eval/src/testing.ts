import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { HealthResult, LabelReadResult, MeasurementsReadResult, StudioImagesInput } from "@selio/ai";
import type { LabelFieldName, MeasurementName } from "@selio/contracts";
import { LABELS_DIR, TAPES_DIR, TRUTH_FILE } from "./dataset";
import type { StudioAI } from "./readers";

/**
 * Aides de test (jamais importées par le script) : JPEG factices (en-tête SOF0 avec les dimensions, assez
 * pour `checkModelImage`), jeux écrits dans un dossier temporaire du système, service IA factice qui répond
 * dans l'ordre. Aucune vraie photo n'entre dans le dépôt.
 */

export function fakeJpeg(width: number, height: number, total = 2_000): Uint8Array {
  const head = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  const out = new Uint8Array(Math.max(total, head.length + 2));
  out.set(head);
  out[out.length - 2] = 0xff;
  out[out.length - 1] = 0xd9;
  return out;
}

export interface DatasetSpec {
  labelsCsv?: string;
  labelPhotos?: Record<string, Uint8Array>;
  tapesCsv?: string;
  tapePhotos?: Record<string, Uint8Array>;
}

export async function tempDir(prefix = "selio-studio-eval-"): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

/** Écrit un jeu de validation dans un dossier temporaire et renvoie son chemin. */
export async function writeDataset(spec: DatasetSpec, root?: string): Promise<string> {
  const dir = root ?? (await tempDir());
  if (spec.labelsCsv !== undefined) {
    await mkdir(path.join(dir, LABELS_DIR), { recursive: true });
    await writeFile(path.join(dir, LABELS_DIR, TRUTH_FILE), spec.labelsCsv, "utf8");
    for (const [name, bytes] of Object.entries(spec.labelPhotos ?? {})) await writeFile(path.join(dir, LABELS_DIR, name), bytes);
  }
  if (spec.tapesCsv !== undefined) {
    await mkdir(path.join(dir, TAPES_DIR), { recursive: true });
    await writeFile(path.join(dir, TAPES_DIR, TRUTH_FILE), spec.tapesCsv, "utf8");
    for (const [name, bytes] of Object.entries(spec.tapePhotos ?? {})) await writeFile(path.join(dir, TAPES_DIR, name), bytes);
  }
  return dir;
}

export type FakeLabelAnswer = Partial<Record<LabelFieldName, { value: string; confidence?: number }>> | Error;
export type FakeTapeAnswer = { tapeVisible?: boolean; measurements?: { name: MeasurementName; valueCm: number; confidence?: number }[] } | Error;

/** Service IA factice : répond dans l'ordre des appels, enregistre ce qu'il reçoit. */
export class FakeAI implements StudioAI {
  readonly labelCalls: { images: string[]; ocrFallback: boolean | undefined }[] = [];
  readonly tapeCalls: { images: string[]; garmentKind: string | undefined }[] = [];
  healthResult: HealthResult = {
    ok: true,
    status: "healthy",
    message: "Ollama joignable (factice)",
    latencyMs: 3,
    model: "texte-factice",
    provider: "ollama",
    details: { models: [{ role: "text", name: "texte-factice", present: true }, { role: "vision", name: "vision-factice", present: true }] },
  };
  simulated = false;

  constructor(
    private readonly labels: FakeLabelAnswer[] = [],
    private readonly tapes: FakeTapeAnswer[] = [],
  ) {}

  async health(): Promise<HealthResult> {
    return this.healthResult;
  }

  async readLabel(_orgId: string, input: StudioImagesInput, opts: { ocrFallback?: boolean } = {}): Promise<LabelReadResult> {
    const images = Array.isArray(input) ? input : input.images;
    this.labelCalls.push({ images, ocrFallback: opts.ocrFallback });
    const answer = this.labels[this.labelCalls.length - 1] ?? {};
    if (answer instanceof Error) throw answer;
    const field = (k: LabelFieldName) => (answer[k] ? { value: answer[k]!.value, confidence: answer[k]!.confidence ?? 0.9, readFrom: "label" as const } : { value: null, confidence: 0, readFrom: null });
    const empty = (["brand", "size", "material", "reference"] as const).filter((k) => !answer[k]);
    return {
      data: { brand: field("brand"), size: field("size"), material: field("material"), reference: field("reference"), careSymbols: [], text: null },
      questions: empty.map((k) => ({ field: k, reason: "missing" as const, text: `Quelle est la ${k} ?` })),
      rejected: [],
      ocr: { configured: false, attempted: false, used: false, model: null, text: null },
      ocrUsed: false,
      provider: this.simulated ? "mock" : "ollama",
      model: "vision-factice",
      latencyMs: 120,
      usage: { promptTokens: 10, outputTokens: 5 },
      simulated: this.simulated,
      warnings: [],
    };
  }

  async readMeasurements(_orgId: string, input: StudioImagesInput): Promise<MeasurementsReadResult> {
    const images = Array.isArray(input) ? input : input.images;
    this.tapeCalls.push({ images, garmentKind: Array.isArray(input) ? undefined : input.garmentKind });
    const answer = this.tapes[this.tapeCalls.length - 1] ?? {};
    if (answer instanceof Error) throw answer;
    const measurements = (answer.measurements ?? []).map((m) => ({ name: m.name, valueCm: m.valueCm, confidence: m.confidence ?? 0.9, evidence: "tape_photo" as const }));
    return {
      data: { tapeVisible: answer.tapeVisible ?? measurements.length > 0, measurements },
      questions: [],
      rejected: [],
      provider: this.simulated ? "mock" : "ollama",
      model: "vision-factice",
      latencyMs: 250,
      usage: { promptTokens: 10, outputTokens: 5 },
      simulated: this.simulated,
      warnings: [],
    };
  }
}
