import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

/** Popup, options et service worker (modules ES). Le content script est construit séparément (IIFE). */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: "src",
  base: "./",
  build: {
    outDir: "../dist",
    emptyOutDir: false,
    sourcemap: false,
    rollupOptions: {
      input: {
        popup: fileURLToPath(new URL("./src/popup.html", import.meta.url)),
        options: fileURLToPath(new URL("./src/options.html", import.meta.url)),
        background: fileURLToPath(new URL("./src/background/service-worker.ts", import.meta.url)),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js"),
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
