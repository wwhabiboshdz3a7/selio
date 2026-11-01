#!/usr/bin/env node
// Remplace chaque « A_GENERER » de deploy/.env par une valeur aléatoire forte, sans jamais afficher de valeur.
//   node deploy/generer-secrets.mjs                 (fichier par défaut : deploy/.env)
//   node deploy/generer-secrets.mjs chemin/vers/.env
// Les valeurs déjà remplies ne sont jamais modifiées : relancer le script est sans danger.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const file = resolve(process.argv[2] ?? join(here, ".env"));
if (!existsSync(file)) {
  console.error(
    `Fichier introuvable : ${file}\nCopier d'abord le modèle : deploy/cles-production.modele.env → deploy/.env`,
  );
  process.exit(1);
}

const hex = (n) => randomBytes(n).toString("hex");
// Paire VAPID (Web Push) : courbe P-256, clé publique non compressée (65 octets) et clé privée (32 octets), en base64url.
function vapid() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pub = publicKey.export({ format: "jwk" }),
    priv = privateKey.export({ format: "jwk" });
  const raw = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(pub.x, "base64url"),
    Buffer.from(pub.y, "base64url"),
  ]);
  return { VAPID_PUBLIC_KEY: raw.toString("base64url"), VAPID_PRIVATE_KEY: priv.d };
}
let pair = null;
const GENERATORS = {
  POSTGRES_PASSWORD: () => hex(24), // hexadécimal : sans caractère à échapper dans DATABASE_URL
  APP_DB_PASSWORD: () => hex(24),
  SECRETS_ENCRYPTION_KEY: () => randomBytes(32).toString("base64"),
  AI_HEALTH_TOKEN: () => hex(24),
  GARAGE_RPC_SECRET: () => hex(32), // 64 caractères hexadécimaux, format imposé par Garage
  GARAGE_ADMIN_TOKEN: () => hex(24),
  STORAGE_ACCESS_KEY: () => `GK${hex(12)}`, // format des clés Garage : « GK » + 24 caractères hexadécimaux
  STORAGE_SECRET_KEY: () => hex(32),
  VAPID_PUBLIC_KEY: () => (pair ??= vapid()).VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY: () => (pair ??= vapid()).VAPID_PRIVATE_KEY,
};

const text = readFileSync(file, "utf8");
const eol = text.includes("\r\n") ? "\r\n" : "\n";
const filled = [],
  unknown = [];
const lines = text.split(/\r?\n/).map((line) => {
  const m = line.match(/^([A-Z0-9_]+)=A_GENERER\s*$/);
  if (!m) return line;
  const gen = GENERATORS[m[1]];
  if (!gen) {
    unknown.push(m[1]);
    return line;
  }
  filled.push(m[1]);
  return `${m[1]}=${gen()}`;
});
// Une paire VAPID n'est valable qu'entière : si une seule moitié était à générer, on ne touche à rien.
if (filled.includes("VAPID_PUBLIC_KEY") !== filled.includes("VAPID_PRIVATE_KEY")) {
  console.error(
    "VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY doivent être générées ensemble : remettre les deux à A_GENERER.",
  );
  process.exit(1);
}
if (filled.length) {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, lines.join(eol), { mode: 0o600 });
  try {
    chmodSync(tmp, statSync(file).mode & 0o777 & ~0o077);
  } catch {
    /* Windows : droits gérés par le système */
  }
  renameSync(tmp, file);
}
console.info(
  filled.length
    ? `Généré (${filled.length}) : ${filled.join(", ")}`
    : "Rien à générer : aucune ligne « A_GENERER ».",
);
if (unknown.length) console.info(`À remplir à la main (pas de générateur) : ${unknown.join(", ")}`);
console.info(
  "Aucune valeur n'a été affichée. Étape suivante : remplacer les « A_REMPLIR », puis node deploy/verifier-cles.mjs",
);
