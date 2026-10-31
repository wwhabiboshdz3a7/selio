import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { ToastProvider } from "@selio/ui";
import { DataProvider } from "./lib/data/provider";
import { router } from "./router";
import { registerSW } from "virtual:pwa-register";
import { installDiagnostics } from "./lib/diagnostics";
import "./styles.css";

installDiagnostics();
// Mise à jour automatique : le nouveau service worker prend la main dès qu'une version est publiée.
registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DataProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </DataProvider>
  </StrictMode>,
);
