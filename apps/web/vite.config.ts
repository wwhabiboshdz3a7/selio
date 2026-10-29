import { defineConfig } from "vite";
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

// Vitrine + application Selio : SPA Vite, déployée en statique (Netlify).
// Aucun secret ici : seules les variables VITE_* publiques sont exposées.
export default defineConfig({
  define: { __SELIO_BUILD__: JSON.stringify(buildId()) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Mise à jour automatique : une nouvelle version publiée remplace immédiatement l'ancienne
      // (avec « prompt » sans interface, un navigateur pouvait rester bloqué sur une version périmée).
      registerType: "autoUpdate",
      includeAssets: ["favicon-32.png", "favicon-64.png", "apple-touch-icon.png", "logo-noir.png", "logo-blanc.png"],
      manifest: {
        name: "Selio — Gestion pour revendeurs",
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
        globPatterns: ["**/*.{js,css,html,png,woff2,webmanifest}"],
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
          react: ["react", "react-dom", "react-router"],
          query: ["@tanstack/react-query"],
        },
      },
    },
  },
  server: {
    proxy: { "/api": { target: process.env.VITE_DEV_API_PROXY ?? "http://127.0.0.1:8787", changeOrigin: true } },
  },
});
