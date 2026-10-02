import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

// Selio — SPA Vite classique (pas de SSR). Deployee en site statique sur
// Netlify, avec l'API en Netlify Functions (dossier netlify/functions).
export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  build: {
    outDir: "dist",
  },
  server: {
    proxy: {
      // En dev local avec `netlify dev`, Netlify proxy deja /api vers les
      // functions. Pour `vite dev` seul (sans Netlify CLI), /api n'est pas
      // disponible : utiliser `netlify dev` pour tester l'API en local.
    },
  },
});
