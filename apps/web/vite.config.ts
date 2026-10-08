import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";

// Vitrine + application Selio : SPA Vite, déployée en statique (Netlify).
// Aucun secret ici : seules les variables VITE_* publiques sont exposées.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["favicon-32.png", "favicon-64.png", "apple-touch-icon.png", "logo-noir.png", "logo-blanc.png"],
      manifest: {
        name: "Selio — Gestion pour revendeurs",
        short_name: "Selio",
        description: "Stock, conversations, clients, commandes et marges des revendeurs Vinted, au même endroit.",
        lang: "fr",
        start_url: "/app?source=pwa",
        scope: "/",
        display: "standalone",
        background_color: "#FAFAFA",
        theme_color: "#0B0B0C",
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
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
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
