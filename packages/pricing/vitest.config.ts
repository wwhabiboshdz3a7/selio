import { defineConfig } from "vitest/config";
// Calcul pur sur le processeur : aucune base, aucun réseau. Les tests d'entraînement sur 20 000
// références synthétiques prennent quelques secondes, d'où le délai élargi.
export default defineConfig({ test: { name: "pricing", globals: true, environment: "node", include: ["src/**/*.test.ts"], testTimeout: 180_000 } });
