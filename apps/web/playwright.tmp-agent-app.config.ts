import base from "./playwright.config";
import { defineConfig } from "@playwright/test";
// Configuration temporaire (agent) : serveur de développement déjà lancé sur 4391, aucun webServer.
export default defineConfig({ ...base, webServer: undefined, reporter: [["list"]], use: { ...base.use, baseURL: "http://127.0.0.1:4391" } });
