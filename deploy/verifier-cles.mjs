#!/usr/bin/env node
// Vérifie deploy/.env avant la mise en production. N'affiche AUCUNE valeur secrète : seules les adresses
// publiques, les noms de modèles et les modes (bac à sable / live…) apparaissent. Le rapport peut être partagé.
//   node deploy/verifier-cles.mjs [chemin/vers/.env]
// Code de sortie : 0 = prêt, 1 = au moins un point bloquant.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const file = resolve(process.argv[2] ?? join(here, ".env"));
if (!existsSync(file)) {
  console.error(`Fichier introuvable : ${file}`);
  process.exit(1);
}

const env = {};
for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
}
const PUBLIC = new Set([
  "PUBLIC_WEB_URL",
  "CORS_ORIGINS",
  "API_PUBLIC_URL",
  "STORAGE_ENDPOINT",
  "OLLAMA_BASE_URL",
  "OLLAMA_MODEL",
  "OLLAMA_VISION_MODEL",
  "OLLAMA_EMBED_MODEL",
  "EMAIL_PROVIDER",
  "REVOLUT_MODE",
  "FRANCHISE_TVA",
  "NODE_ENV",
  "GARAGE_CAPACITY",
]);
const results = [];
const ok = (k, msg) => results.push(["ok", k, msg]);
const bad = (k, msg) => results.push(["bloquant", k, msg]);
const warn = (k, msg) => results.push(["à noter", k, msg]);
const show = (k) => (PUBLIC.has(k) && env[k] ? ` (${env[k]})` : "");
const todo = (v) => v === undefined || v === "" || v === "A_REMPLIR" || v === "A_GENERER";
const isHttpsUrl = (v) => {
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !v.endsWith("/");
  } catch {
    return false;
  }
};
const isUrl = (v) => {
  try {
    new URL(v);
    return true;
  } catch {
    return false;
  }
};

function need(k, check, hint) {
  const v = env[k];
  if (todo(v))
    return bad(k, v === "A_GENERER" ? "à générer : node deploy/generer-secrets.mjs" : "à remplir");
  if (check && !check(v)) return bad(k, `format incorrect${show(k)} : ${hint}`);
  ok(k, `renseignée${show(k)}`);
}
function fixed(k, want) {
  if (env[k] === want) ok(k, `= ${want}`);
  else bad(k, `doit valoir ${want} en production (garde-fou)`);
}
function optional(k, emptyMsg) {
  if (env[k]) ok(k, `renseignée${show(k)}`);
  else warn(k, emptyMsg);
}

// 1. Adresses publiques
need("PUBLIC_WEB_URL", isHttpsUrl, "adresse https sans « / » final");
need(
  "CORS_ORIGINS",
  (v) =>
    v
      .split(",")
      .map((s) => s.trim())
      .includes(env.PUBLIC_WEB_URL),
  "doit contenir exactement PUBLIC_WEB_URL",
);
need("API_PUBLIC_URL", isHttpsUrl, "adresse https sans « / » final");
need(
  "OPERATOR_EMAILS",
  (v) => v.split(",").every((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim())),
  "e-mails séparés par des virgules",
);
// 2. Base et chiffrement
need(
  "POSTGRES_PASSWORD",
  (v) => v.length >= 24 && /^[A-Za-z0-9_-]+$/.test(v),
  "au moins 24 caractères, lettres/chiffres seulement",
);
need(
  "APP_DB_PASSWORD",
  (v) => v.length >= 24 && /^[A-Za-z0-9_-]+$/.test(v) && v !== env.POSTGRES_PASSWORD,
  "au moins 24 caractères, différent de POSTGRES_PASSWORD",
);
need(
  "SECRETS_ENCRYPTION_KEY",
  (v) => Buffer.from(v, "base64").length === 32,
  "32 octets en base64",
);
// 3. Garde-fous
fixed("NODE_ENV", "production");
fixed("COOKIE_SECURE", "true");
fixed("TRUST_PROXY", "true");
// 4. IA
fixed("AI_PROVIDER", "ollama");
fixed("ALLOW_AI_FALLBACK", "false");
need(
  "OLLAMA_BASE_URL",
  (v) => isUrl(v) && !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(v),
  "pas 127.0.0.1 : depuis un conteneur, utiliser http://host.docker.internal:11434 (ou l'adresse Tailscale)",
);
need(
  "OLLAMA_MODEL",
  (v) => /^[a-z0-9._\-/]+(:[A-Za-z0-9._-]+)?$/.test(v),
  "nom affiché par « ollama list », ex. qwen2.5:7b-instruct",
);
optional("OLLAMA_VISION_MODEL", "vide : Studio rédigera sans lire les photos");
optional("OLLAMA_EMBED_MODEL", "vide : embeddings désactivés");
need("AI_HEALTH_TOKEN", (v) => v.length >= 16, "au moins 16 caractères");
// 5. Photos
need(
  "STORAGE_ENDPOINT",
  isHttpsUrl,
  "adresse https joignable par le navigateur, ex. https://photos.selio.fr",
);
need("STORAGE_BUCKET", (v) => /^[a-z0-9][a-z0-9.-]{2,62}$/.test(v), "nom de bucket S3 valide");
if (env.STORAGE_REGION === "fr-mrs-1") ok("STORAGE_REGION", "= fr-mrs-1");
else bad("STORAGE_REGION", "doit valoir fr-mrs-1, comme s3_region dans deploy/garage/garage.toml");
need(
  "GARAGE_CAPACITY",
  (v) => /^\d+(\.\d+)?\s*[KMGT]?i?B?$/i.test(v),
  "taille avec unité, ex. 200G",
);
need("GARAGE_RPC_SECRET", (v) => /^[0-9a-f]{64}$/.test(v), "64 caractères hexadécimaux");
need("GARAGE_ADMIN_TOKEN", (v) => v.length >= 32, "au moins 32 caractères");
need(
  "STORAGE_ACCESS_KEY",
  (v) => /^GK[0-9a-f]{24}$/.test(v),
  "format Garage : GK + 24 caractères hexadécimaux",
);
need("STORAGE_SECRET_KEY", (v) => /^[0-9a-f]{64}$/.test(v), "64 caractères hexadécimaux");
// 6. Tunnel
if (todo(env.CLOUDFLARE_TUNNEL_TOKEN))
  bad(
    "CLOUDFLARE_TUNNEL_TOKEN",
    "à remplir (sans tunnel, ni l'API ni les photos ne sont joignables depuis Internet)",
  );
else if (env.CLOUDFLARE_TUNNEL_TOKEN.length < 80)
  bad("CLOUDFLARE_TUNNEL_TOKEN", "trop court : copier toute la valeur après « --token »");
else ok("CLOUDFLARE_TUNNEL_TOKEN", "renseigné");
// 7. Notifications
need(
  "VAPID_PUBLIC_KEY",
  (v) => Buffer.from(v, "base64url").length === 65,
  "clé publique P-256 (87 caractères base64url)",
);
need(
  "VAPID_PRIVATE_KEY",
  (v) => Buffer.from(v, "base64url").length === 32,
  "clé privée P-256 (43 caractères base64url)",
);
need(
  "VAPID_SUBJECT",
  (v) => /^mailto:[^@\s]+@[^@\s]+$/.test(v) || isHttpsUrl(v),
  "mailto:adresse ou URL https",
);
// 8. E-mails
if (env.EMAIL_PROVIDER === "smtp") {
  need(
    "SMTP_URL",
    (v) => /^smtps?:\/\/[^@]+@[^:/]+(:\d+)?\/?$/.test(v),
    "smtp(s)://utilisateur:motdepasse@hôte:port",
  );
  need("EMAIL_FROM", (v) => /<[^>]+@[^>]+>|^[^@\s]+@[^@\s]+$/.test(v), "Nom <adresse@domaine>");
} else
  warn(
    "EMAIL_PROVIDER",
    "noop : aucun e-mail ne part (invitations, mot de passe oublié, échecs de paiement)",
  );
// 9. Paiement
if (todo(env.REVOLUT_SECRET_KEY))
  warn("REVOLUT_SECRET_KEY", "vide : paiement désactivé (essais non débités)");
else {
  if (/^sk_/.test(env.REVOLUT_SECRET_KEY)) ok("REVOLUT_SECRET_KEY", "renseignée (sk_…)");
  else bad("REVOLUT_SECRET_KEY", "doit commencer par sk_ (clé secrète, pas la clé publique)");
  if (todo(env.REVOLUT_WEBHOOK_SECRET))
    bad("REVOLUT_WEBHOOK_SECRET", "à remplir : sans lui, aucun paiement n'est confirmé");
  else if (/^wsk_/.test(env.REVOLUT_WEBHOOK_SECRET))
    ok("REVOLUT_WEBHOOK_SECRET", "renseigné (wsk_…)");
  else bad("REVOLUT_WEBHOOK_SECRET", "doit commencer par wsk_");
}
if (env.REVOLUT_MODE === "live") {
  if (env.REVOLUT_LIVE_ALLOWED === "true") warn("REVOLUT_MODE", "live : argent réel encaissé");
  else
    bad("REVOLUT_MODE", "live exige REVOLUT_LIVE_ALLOWED=true (après validation en bac à sable)");
} else ok("REVOLUT_MODE", `= ${env.REVOLUT_MODE || "sandbox"} (bac à sable)`);
need("FRANCHISE_TVA", (v) => v === "true" || v === "false", "true ou false");
// 10. Verrous juridiques
for (const k of [
  "CLOUD_ENABLED",
  "CLOUD_HEAVY_ACTIONS",
  "RADAR_AUTO_ENABLED",
  "RADAR_REAL_PURCHASE",
]) {
  if (env[k] === "true") warn(k, "OUVERT : uniquement après l'avis écrit de l'avocat");
  else ok(k, "fermé");
}

const n = (s) => results.filter((r) => r[0] === s).length;
console.info(`Vérification des clés de production — ${file.split(/[\\/]/).slice(-2).join("/")}\n`);
for (const [s, k, msg] of results)
  console.info(`${s === "ok" ? "  ✓" : s === "bloquant" ? "  ✗" : "  !"} ${k.padEnd(26)} ${msg}`);
console.info(`\n${n("ok")} bon(s) · ${n("bloquant")} bloquant(s) · ${n("à noter")} à noter`);
console.info(
  n("bloquant")
    ? "Pas encore prêt : corriger les lignes ✗ puis relancer."
    : "Prêt pour la mise en production (les lignes ! sont des choix assumés).",
);
console.info("Ce rapport ne contient aucune valeur secrète : il peut être partagé.");
process.exit(n("bloquant") ? 1 : 0);
