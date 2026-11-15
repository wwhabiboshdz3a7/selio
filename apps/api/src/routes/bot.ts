import type { FastifyInstance } from "fastify";
import { bot } from "@selio/core";

/**
 * Selio Bot (préfixe /api/bot) : synthèse des bots (tous les rôles qui lisent les automatisations) et
 * coupe-circuit de l'organisation, « Tout arrêter » et « Reprendre » (titulaire et administrateur,
 * audit `bot.stopped` / `bot.resumed`). Le coupe-circuit est relu par le worker avant chaque action
 * automatique (règles, Selio Cloud, lecture en direct, Radar Auto, file serveur) et par la file de l'extension.
 */
export interface BotRouteOptions {
  /** Selio Cloud ouvert sur ce serveur (CLOUD_ENABLED et relais Redis). */
  cloudServerEnabled: boolean;
  /** Heures actives du Cloud (CLOUD_ACTIVE_HOURS). */
  cloudActiveHours: { startHour: number; endHour: number };
}

export default async function botRoutes(app: FastifyInstance, opts: BotRouteOptions) {
  const o = { cloudServerEnabled: opts.cloudServerEnabled, cloudActiveHours: opts.cloudActiveHours };
  app.get("/api/bot", async (req) => bot.summary(app.requireCtx(req), o));
  app.post("/api/bot/stop", async (req) => bot.stopAll(app.requireCtx(req), o));
  app.post("/api/bot/resume", async (req) => bot.resumeAll(app.requireCtx(req), o));
}
