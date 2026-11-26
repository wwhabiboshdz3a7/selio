import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { ToastProvider } from "@selio/ui";
import { DataProvider } from "../lib/data/provider";
import { router } from "./router";
import { registerPrefetchRoutes } from "../app/prefetch";
import { installDiagnostics } from "../lib/diagnostics";
import "../styles.css";

/**
 * Point d'entrée du site Selio Admin (build VITE_APP_TARGET=admin, voir vite.config.ts) : aucune vitrine, aucun
 * espace client, aucune application installable. Même API que le site public (relais /api/* de Netlify).
 */
installDiagnostics();
registerPrefetchRoutes(router.routes);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DataProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </DataProvider>
  </StrictMode>,
);
