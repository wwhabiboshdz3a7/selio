/**
 * Mesure de capacité et de coût : `pnpm ai:bench` (mêmes variables que `pnpm ai:diagnose`).
 * Trois mesures, choisies par BENCH_MODE :
 * - `reply` (défaut) : réponses acheteur réalistes sur le modèle de texte (« mon IA perso »),
 *   AI_MAX_CONCURRENCY à la fois pendant BENCH_SECONDS (60 par défaut) → réponses par minute,
 *   p50/p95 et jetons. Repère attendu sur la machine : environ 15 réponses par minute.
 * - `photo` : annonces Studio à partir d'une photo (BENCH_PHOTO=chemin.jpg, répétée
 *   BENCH_PHOTOS fois par annonce, 1 par défaut) sur le modèle de vision → secondes par photo.
 *   Repère attendu : environ 3,6 s par photo.
 * - `embed` : lots de BENCH_BATCH titres (16 par défaut) sur le modèle d'embedding → textes par
 *   seconde et p50/p95 par lot.
 * Avec BENCH_WATTS (puissance de la machine en charge, lue au wattmètre), le coût d'électricité
 * par réponse est calculé au prix BENCH_KWH_EUR (0,2001 € par défaut, tarif Bleu option Base au
 * 1er août 2026).
 */
import { readFile } from "node:fs/promises";
import { buildListingGenerationRequest, buildReplyRequest, createProvider, loadAIConfig, type AIProvider, type ReplyContext } from "../src/index";

const num = (v: string | undefined, fallback: number) => (v && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : fallback);
const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
const settings = { tone: "friendly" as const, signature: "" };
const counter = (counterCents: number, floorCents: number) => ({ decision: "counter" as const, counterCents, reasons: [], requiresApproval: true, floorCents, marginAtOfferCents: 0, marginRateAtOffer: 0 });

const SAMPLES: ReplyContext[] = [
  { buyerName: "Léa", itemTitle: "Pull Ralph Lauren bleu marine M", listedPriceCents: 3500, floorPriceCents: 2600, decision: null, offerCents: null, settings, messages: [{ direction: "inbound", body: "Bonjour, il est toujours disponible ? Vous pouvez me donner les mesures aisselle à aisselle ?" }] },
  { buyerName: "Nora", itemTitle: "Jean Levi's 501 W32 L32", listedPriceCents: 4000, floorPriceCents: 3000, decision: counter(3400, 3000), offerCents: 2800, settings, messages: [{ direction: "inbound", body: "Bonjour, 28 € ça vous irait ?" }] },
  { buyerName: null, itemTitle: "Veste en jean Carhartt L", listedPriceCents: 5500, floorPriceCents: 4200, decision: null, offerCents: null, settings, messages: [{ direction: "inbound", body: "Bonjour, je prends si vous faites un lot avec le sweat gris." }, { direction: "outbound", body: "Bonjour, oui c'est possible, je regarde le prix pour les deux." }, { direction: "inbound", body: "Super, et l'envoi peut se faire demain ?" }] },
  { buyerName: "Sami", itemTitle: "Baskets Nike Air Force 1 blanches 42", listedPriceCents: 6000, floorPriceCents: 4800, decision: counter(5200, 4800), offerCents: 4500, settings, messages: [{ direction: "inbound", body: "Bonjour, 45 € et je paie tout de suite." }] },
];

const TITLES = [
  "Pull Ralph Lauren bleu marine taille M", "Jean Levi's 501 W32 L32 bleu brut", "Veste en jean Carhartt L kaki", "Baskets Nike Air Force 1 blanches 42",
  "Doudoune The North Face Nuptse noire S", "Robe midi Sézane verte 38", "Sac Longchamp Pliage noir", "Chemise Tommy Hilfiger bleu ciel L",
  "Sweat Stone Island gris M", "Bottines Dr. Martens 1460 noires 41", "Trench Zara camel M", "Polo Lacoste blanc L",
  "Blouse en soie Maje blanche 36", "Jupe plissée Mango beige 38", "Lunettes Ray-Ban Wayfarer noires", "T-shirt Uniqlo blanc XL",
];

type Mode = "reply" | "photo" | "embed";

interface Measure {
  /** Nom de l'unité mesurée (réponse, annonce, lot). */
  unit: string;
  latencies: number[];
  promptTokens: number;
  outputTokens: number;
  failures: number;
  elapsedSeconds: number;
  /** Nombre d'éléments par unité (photos par annonce, textes par lot). */
  perUnit: number;
}

async function loop(parallel: number, seconds: number, one: (i: number) => Promise<{ latencyMs: number; promptTokens: number; outputTokens: number }>): Promise<Measure> {
  const m: Measure = { unit: "", latencies: [], promptTokens: 0, outputTokens: 0, failures: 0, elapsedSeconds: 0, perUnit: 1 };
  let next = 0;
  const started = Date.now();
  const end = started + seconds * 1000;
  const worker = async () => {
    while (Date.now() < end) {
      try {
        const res = await one(next++);
        m.latencies.push(res.latencyMs);
        m.promptTokens += res.promptTokens;
        m.outputTokens += res.outputTokens;
      } catch (err) {
        m.failures += 1;
        console.error("Échec :", err instanceof Error ? err.message : err);
        if (m.failures >= 3 && m.latencies.length === 0) throw new Error("Trois échecs sans aucune réponse : mesure interrompue.");
      }
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
  m.elapsedSeconds = (Date.now() - started) / 1000;
  return m;
}

async function benchReply(provider: AIProvider, parallel: number, seconds: number, timeoutMs: number): Promise<Measure> {
  const m = await loop(parallel, seconds, async (i) => {
    const res = await provider.generateStructured(buildReplyRequest(SAMPLES[i % SAMPLES.length]!), { timeoutMs });
    return { latencyMs: res.latencyMs, promptTokens: res.usage.promptTokens, outputTokens: res.usage.outputTokens };
  });
  return { ...m, unit: "réponse" };
}

async function benchPhoto(provider: AIProvider, parallel: number, seconds: number, timeoutMs: number): Promise<Measure> {
  const path = process.env.BENCH_PHOTO;
  if (!path) throw new Error("BENCH_MODE=photo demande BENCH_PHOTO=<chemin d'une photo JPEG ou PNG réduite>.");
  const image = (await readFile(path)).toString("base64");
  const photos = Math.max(1, Math.min(6, Math.round(num(process.env.BENCH_PHOTOS, 1))));
  const ctx = { images: Array.from({ length: photos }, () => image), fileNames: [path.split(/[\\/]/).pop() ?? "photo.jpg"], hints: {} };
  const m = await loop(parallel, seconds, async () => {
    const res = await provider.generateStructured(buildListingGenerationRequest(ctx), { timeoutMs });
    return { latencyMs: res.latencyMs, promptTokens: res.usage.promptTokens, outputTokens: res.usage.outputTokens };
  });
  return { ...m, unit: "annonce", perUnit: photos };
}

async function benchEmbed(provider: AIProvider, parallel: number, seconds: number, timeoutMs: number): Promise<Measure> {
  if (!provider.embed) throw new Error("Ce fournisseur ne produit pas d'embeddings.");
  const batch = Math.max(1, Math.min(256, Math.round(num(process.env.BENCH_BATCH, 16))));
  const m = await loop(parallel, seconds, async (i) => {
    const texts = Array.from({ length: batch }, (_, k) => TITLES[(i * batch + k) % TITLES.length]!);
    const res = await provider.embed!(texts, { timeoutMs });
    return { latencyMs: res.latencyMs, promptTokens: res.usage.promptTokens, outputTokens: 0 };
  });
  return { ...m, unit: "lot", perUnit: batch };
}

async function main() {
  const config = loadAIConfig(process.env);
  const mode = (["reply", "photo", "embed"] as const).find((m) => m === (process.env.BENCH_MODE ?? "reply")) as Mode | undefined;
  if (!mode) throw new Error(`BENCH_MODE inconnu : ${process.env.BENCH_MODE} (reply, photo ou embed).`);
  const seconds = num(process.env.BENCH_SECONDS, 60);
  const watts = num(process.env.BENCH_WATTS, 0);
  const kwhPrice = num(process.env.BENCH_KWH_EUR, 0.2001);
  const parallel = config.AI_MAX_CONCURRENCY;
  const provider = createProvider(config);
  const modelByMode: Record<Mode, string> = { reply: config.OLLAMA_MODEL, photo: config.OLLAMA_VISION_MODEL ?? "(vision désactivée : modèle de texte)", embed: config.OLLAMA_EMBED_MODEL ?? "(embeddings désactivés)" };
  console.info(`Provider : ${config.AI_PROVIDER} · mesure « ${mode} » · modèle ${modelByMode[mode]} · ${parallel} en parallèle · ${seconds} s`);
  console.info(`Modèles  : texte ${config.OLLAMA_MODEL} (mon IA perso) · photos ${config.OLLAMA_VISION_MODEL ?? "désactivé"} · prix ${config.OLLAMA_EMBED_MODEL ?? "désactivé"}`);
  if (config.AI_PROVIDER === "mock") console.info("Simulateur : les chiffres n'ont aucune valeur, lancer avec AI_PROVIDER=ollama sur la machine IA.");

  const m = mode === "reply" ? await benchReply(provider, parallel, seconds, config.AI_TIMEOUT_MS) : mode === "photo" ? await benchPhoto(provider, parallel, seconds, config.AI_TIMEOUT_MS) : await benchEmbed(provider, parallel, seconds, config.AI_TIMEOUT_MS);

  const done = m.latencies.length;
  if (done === 0) throw new Error("Aucune réponse obtenue.");
  const sorted = [...m.latencies].sort((a, b) => a - b);
  const perMinute = (done / m.elapsedSeconds) * 60;
  const secondsPerUnit = m.elapsedSeconds / done;
  console.info(`Résultat  : ${done} ${m.unit}(s) en ${m.elapsedSeconds.toFixed(1)} s (${m.failures} échec(s))`);
  console.info(`Débit     : ${perMinute.toFixed(1)} ${m.unit}(s) par minute`);
  console.info(`Durée     : p50 ${pct(sorted, 50)} ms · p95 ${pct(sorted, 95)} ms par ${m.unit}`);
  if (mode === "photo") console.info(`Photos    : ${m.perUnit} par annonce → ${(secondsPerUnit / m.perUnit).toFixed(2)} s par photo (repère : environ 3,6 s)`);
  if (mode === "embed") console.info(`Textes    : ${m.perUnit} par lot → ${((done * m.perUnit) / m.elapsedSeconds).toFixed(1)} textes par seconde`);
  if (mode === "reply") console.info(`Repère    : environ 15 réponses par minute attendues sur la machine (à confirmer ici)`);
  if (m.outputTokens > 0) console.info(`Jetons    : ${Math.round(m.promptTokens / done)} lus + ${Math.round(m.outputTokens / done)} écrits par ${m.unit} · ${(m.outputTokens / m.elapsedSeconds).toFixed(1)} jetons écrits par seconde`);
  else console.info(`Jetons    : ${Math.round(m.promptTokens / done)} lus par ${m.unit}`);
  if (watts > 0) {
    const euros = (watts * secondsPerUnit * kwhPrice) / 3_600_000;
    console.info(`Électricité : ${watts} W × ${secondsPerUnit.toFixed(2)} s par ${m.unit} à ${kwhPrice} €/kWh = ${(euros * 100).toFixed(4)} centime par ${m.unit}, ${(euros * 1000).toFixed(3)} € les 1 000`);
  } else {
    console.info("Électricité : renseigner BENCH_WATTS (wattmètre, machine en charge) pour obtenir le coût par réponse.");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
