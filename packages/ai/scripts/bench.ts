/**
 * Mesure de capacité et de coût : `pnpm ai:bench` (mêmes variables que `pnpm ai:diagnose`).
 * Envoie des demandes de réponse acheteur réalistes pendant BENCH_SECONDS (60 par défaut),
 * AI_MAX_CONCURRENCY à la fois, puis affiche les réponses par minute, les durées p50/p95 et
 * les jetons. Avec BENCH_WATTS (puissance de la machine en charge, lue au wattmètre), le
 * coût d'électricité par réponse est calculé au prix BENCH_KWH_EUR (0,2001 € par défaut,
 * tarif Bleu option Base au 1er août 2026).
 */
import { buildReplyRequest, createProvider, loadAIConfig, type ReplyContext } from "../src/index";

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

async function main() {
  const config = loadAIConfig(process.env);
  const seconds = num(process.env.BENCH_SECONDS, 60);
  const watts = num(process.env.BENCH_WATTS, 0);
  const kwhPrice = num(process.env.BENCH_KWH_EUR, 0.2001);
  const parallel = config.AI_MAX_CONCURRENCY;
  const provider = createProvider(config);
  console.info(`Provider : ${config.AI_PROVIDER} · modèle ${config.OLLAMA_MODEL} · ${parallel} en parallèle · ${seconds} s`);
  if (config.AI_PROVIDER === "mock") console.info("Simulateur : les chiffres n'ont aucune valeur, lancer avec AI_PROVIDER=ollama sur la machine IA.");

  const latencies: number[] = [];
  let promptTokens = 0;
  let outputTokens = 0;
  let failures = 0;
  let next = 0;
  const started = Date.now();
  const end = started + seconds * 1000;
  const worker = async () => {
    while (Date.now() < end) {
      const req = buildReplyRequest(SAMPLES[next++ % SAMPLES.length]!);
      try {
        const res = await provider.generateStructured(req, { timeoutMs: config.AI_TIMEOUT_MS });
        latencies.push(res.latencyMs);
        promptTokens += res.usage.promptTokens;
        outputTokens += res.usage.outputTokens;
      } catch (err) {
        failures += 1;
        console.error("Échec :", err instanceof Error ? err.message : err);
        if (failures >= 3 && latencies.length === 0) throw new Error("Trois échecs sans aucune réponse : mesure interrompue.");
      }
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));

  const elapsed = (Date.now() - started) / 1000;
  const done = latencies.length;
  if (done === 0) throw new Error("Aucune réponse obtenue.");
  const sorted = [...latencies].sort((a, b) => a - b);
  const perMinute = (done / elapsed) * 60;
  const secondsPerReply = elapsed / done;
  console.info(`Réponses  : ${done} en ${elapsed.toFixed(1)} s (${failures} échec(s))`);
  console.info(`Débit     : ${perMinute.toFixed(1)} réponses par minute`);
  console.info(`Durée     : p50 ${pct(sorted, 50)} ms · p95 ${pct(sorted, 95)} ms`);
  console.info(`Jetons    : ${Math.round(promptTokens / done)} lus + ${Math.round(outputTokens / done)} écrits par réponse · ${(outputTokens / elapsed).toFixed(1)} jetons écrits par seconde`);
  if (watts > 0) {
    const euros = (watts * secondsPerReply * kwhPrice) / 3_600_000;
    console.info(`Électricité : ${watts} W × ${secondsPerReply.toFixed(2)} s par réponse à ${kwhPrice} €/kWh = ${(euros * 100).toFixed(4)} centime par réponse, ${(euros * 1000).toFixed(3)} € les 1 000`);
  } else {
    console.info("Électricité : renseigner BENCH_WATTS (wattmètre, machine en charge) pour obtenir le coût par réponse.");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
