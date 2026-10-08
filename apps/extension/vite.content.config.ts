import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

/** Content script : un seul fichier IIFE (pas d'import ES dans le monde isolé de la page). */
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: false,
    lib: {
      entry: fileURLToPath(new URL("./src/content/vinted.ts", import.meta.url)),
      name: "SelioContent",
      formats: ["iife"],
      fileName: () => "content.js",
    },
    rollupOptions: { output: { extend: true } },
  },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
});
