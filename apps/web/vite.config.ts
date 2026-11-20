import { defineConfig, loadEnv, type Plugin } from "vite";
import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";
import { execSync } from "node:child_process";

/** Identifiant de build affiché dans les rapports d'erreur (commit Netlify, sinon git local). */
function buildId(): string {
  const fromEnv = process.env.COMMIT_REF ?? process.env.GITHUB_SHA;
  let sha = fromEnv ? fromEnv.slice(0, 7) : "";
  if (!sha) {
    try {
      sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      sha = "local";
    }
  }
  return `${sha}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
}

/**
 * Préchargement de la police Inter (400 pour le texte, 600 pour les titres) : le navigateur la
 * télécharge en même temps que le JavaScript au lieu d'attendre le premier rendu, ce qui avance
 * l'affichage du titre de la vitrine (LCP). Les noms des fichiers (avec empreinte) sont lus
 * dans le bundle au moment du build.
 */
function preloadFonts(): Plugin {
  return {
    name: "selio-preload-fonts",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        const files = Object.keys(ctx.bundle ?? {}).filter((f) => /inter-latin-(400|600)-normal-[^/]*\.woff2$/.test(f));
        return files.map((f) => ({ tag: "link", attrs: { rel: "preload", href: `/${f}`, as: "font", type: "font/woff2", crossorigin: "" }, injectTo: "head" as const }));
      },
    },
  };
}

/**
 * Publicité et mesure (src/marketing/consent.ts) : si un identifiant est fourni au build, la CSP
 * de netlify.toml doit autoriser les hôtes de Google ou de Meta (lignes prêtes, en commentaire,
 * dans netlify.toml). Le build le rappelle, sans échouer.
 */
function checkTrackingCsp(mode: string): Plugin {
  return {
    name: "selio-tracking-csp",
    apply: "build",
    buildStart() {
      const env = loadEnv(mode, process.cwd(), "VITE_");
      const needs = [
        env.VITE_GA4_ID || env.VITE_GOOGLE_ADS_ID ? "https://www.googletagmanager.com" : null,
        env.VITE_META_PIXEL_ID ? "https://connect.facebook.net" : null,
      ].filter((h): h is string => h !== null);
      if (!needs.length) return;
      let csp = "";
      try {
        csp = readFileSync(fileURLToPath(new URL("../../netlify.toml", import.meta.url)), "utf8").split("\n").find((l) => /^\s*Content-Security-Policy\s*=/.test(l)) ?? "";
      } catch {
        return;
      }
      for (const host of needs) {
        if (!csp.includes(host)) this.warn(`Identifiant de mesure ou de publicité fourni, mais ${host} manque à la CSP de netlify.toml : le script sera bloqué en production (voir docs/VITRINE.md, « Publicité »).`);
      }
    },
  };
}

// Vitrine + application Selio : SPA Vite, déployée en statique (Netlify).
// Aucun secret ici : seules les variables VITE_* publiques sont exposées.
export default defineConfig(({ mode }) => ({
  define: { __SELIO_BUILD__: JSON.stringify(buildId()) },
  plugins: [
    react(),
    tailwindcss(),
    preloadFonts(),
    checkTrackingCsp(mode),
    VitePWA({
      // Mise à jour automatique : une nouvelle version publiée remplace immédiatement l'ancienne
      // (avec « prompt » sans interface, un navigateur pouvait rester bloqué sur une version périmée).
      registerType: "autoUpdate",
      includeAssets: ["favicon-32.png", "favicon-64.png", "apple-touch-icon.png", "logo-noir.png", "logo-blanc.png"],
      manifest: {
        name: "Selio Manager — Gestion pour revendeurs",
        short_name: "Selio",
        description: "Stock, conversations, clients, commandes et marges des revendeurs Vinted, au même endroit.",
        lang: "fr",
        start_url: "/app?source=pwa",
        scope: "/",
        display: "standalone",
        background_color: "#F5F5F7",
        theme_color: "#1C1A24",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Notifications push (alertes Selio Radar) : gestionnaire « push » et « notificationclick » dans
        // public/push-handler.js, chargé par le service worker généré (workbox reste en generateSW).
        importScripts: ["push-handler.js"],
        globPatterns: ["**/*.{js,css,html,png,woff2,webmanifest}"],
        // Images de partage (Open Graph, 1200 × 630) : lues par les réseaux sociaux, jamais utiles hors ligne.
        globIgnores: ["og/**"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        clientsClaim: true,
        skipWaiting: true,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkOnly",
          },
          {
            // Photos réelles de la démo : chargées à la demande puis gardées en cache (pas de pré-cache de 3 Mo).
            urlPattern: ({ url }) => url.pathname.startsWith("/demo/photos/"),
            handler: "CacheFirst",
            options: { cacheName: "selio-demo-photos", expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // L'index de @selio/connectors réexporte le client Revolut (serveur, node:crypto) ; le
      // navigateur n'en exécute jamais rien (élagué), mais Rollup exige que le module existe.
      "node:crypto": fileURLToPath(new URL("./src/lib/shims/node-crypto.ts", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          // react-dom/client (le rendu) rejoint React : un morceau stable, mis en cache d'un déploiement à l'autre.
          react: ["react", "react-dom", "react-dom/client", "react-router"],
          query: ["@tanstack/react-query"],
        },
      },
    },
  },
  server: {
    proxy: { "/api": { target: process.env.VITE_DEV_API_PROXY ?? "http://127.0.0.1:8787", changeOrigin: true } },
  },
}));
