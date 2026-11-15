import { main } from "./track-check";

/** `pnpm track:check` : vérification hors ligne de la configuration de Selio Track (voir track-check.ts). */
main().then((code) => { process.exitCode = code; }, (err: unknown) => {
  console.error(`Vérification impossible : ${err instanceof Error ? err.message.split("\n")[0] : "erreur"}`);
  process.exitCode = 2;
});
