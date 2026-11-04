// Amorce du fil d'entraînement en développement et dans les tests (sources TypeScript) : enregistre tsx
// dans ce fil, puis charge `pricing-train-thread.ts`. En production, le fil compilé
// (dist/pricing-train-thread.js) est lancé directement, sans cette amorce.
import { workerData } from "node:worker_threads";

const { register } = await import(workerData.tsxApi);
register();
await import(workerData.entry);
