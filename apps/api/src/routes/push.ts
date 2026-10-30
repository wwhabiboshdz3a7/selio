import type { FastifyInstance, FastifyRequest } from "fastify";
import { radarAlertPayload } from "@selio/contracts";
import { repos } from "@selio/db";
import { AppError, radarAlerts, requireAction, withOrg } from "@selio/core";
import { isAllowedPushEndpoint } from "../push";

/**
 * Notifications Web Push de la PWA (préfixe /api/push), pour les alertes de Selio Radar.
 *
 * - GET /api/push/config : `{ enabled, publicKey }` (clé publique VAPID seulement ; sans clés, `enabled: false`).
 * - POST /api/push/subscriptions : abonne l'appareil de l'utilisateur (adresse d'un service de
 *   notification connu, clés de chiffrement de l'abonnement) ; un appareil ne reçoit les alertes que
 *   d'une organisation.
 * - DELETE /api/push/subscriptions : désabonne un appareil de l'utilisateur (`endpoint`).
 * - DELETE /api/push/subscriptions/:id : retire un appareil de l'utilisateur par son identifiant
 *   (appareil perdu, ancien téléphone), depuis Paramètres › Notifications.
 * - GET /api/push/subscriptions : appareils abonnés de l'utilisateur, sans les clés.
 * - POST /api/push/test : notification de test vers les appareils de l'utilisateur.
 *
 * Les clés d'un abonnement ne sont jamais renvoyées ni journalisées ; l'adresse non plus.
 */
export interface PushRouteOptions {
  /** Clé publique VAPID (null : notifications désactivées sur ce serveur). */
  publicKey: string | null;
}

const pushDisabled = () => new AppError("push_disabled", "Les notifications ne sont pas activées sur ce serveur (clés VAPID absentes).", 503);

/** Limites par utilisateur (adresse IP sans session). */
const perUser = (prefix: string, max: number, timeWindow: string) => ({
  rateLimit: { max, timeWindow, keyGenerator: (req: FastifyRequest) => (req.orgCtx ? `${prefix}:${req.orgCtx.userId}` : `${prefix}-ip:${req.ip}`) },
});

const TEST_PAYLOAD = radarAlertPayload.parse({
  title: "Selio : notifications activées",
  body: "Cet appareil recevra les alertes de Selio Radar (bonnes affaires, paiement à valider, pause du compte Achat).",
  url: "/app/radar",
});

export default async function pushRoutes(app: FastifyInstance, opts: PushRouteOptions) {
  const enabled = () => opts.publicKey !== null && Boolean(app.services.push);

  app.get("/api/push/config", async (req) => {
    app.requireCtx(req);
    return enabled() ? { enabled: true, publicKey: opts.publicKey } : { enabled: false, publicKey: null };
  });

  app.get("/api/push/subscriptions", async (req) => radarAlerts.listPushSubscriptions(app.requireCtx(req)));

  app.post("/api/push/subscriptions", { config: perUser("push-sub", 20, "15 minutes") }, async (req, reply) => {
    const ctx = app.requireCtx(req);
    if (!enabled()) throw pushDisabled();
    const endpoint = (req.body as { endpoint?: unknown } | null)?.endpoint;
    if (typeof endpoint !== "string" || !isAllowedPushEndpoint(endpoint)) {
      throw new AppError("validation", "Adresse de notification refusée : seuls les services de notification des navigateurs (Google, Mozilla, Microsoft, Apple) sont acceptés.", 400);
    }
    const saved = await radarAlerts.subscribePush(ctx, req.body);
    reply.status(201).header("cache-control", "no-store");
    return saved;
  });

  app.delete("/api/push/subscriptions", { config: perUser("push-sub", 20, "15 minutes") }, async (req) => {
    const ctx = app.requireCtx(req);
    const fromBody = (req.body as { endpoint?: unknown } | null)?.endpoint;
    const fromQuery = (req.query as { endpoint?: unknown } | null)?.endpoint;
    const endpoint = typeof fromBody === "string" ? fromBody : typeof fromQuery === "string" ? fromQuery : "";
    return radarAlerts.unsubscribePush(ctx, endpoint);
  });

  app.delete<{ Params: { id: string } }>("/api/push/subscriptions/:id", { config: perUser("push-sub", 20, "15 minutes") }, async (req) => radarAlerts.removePushSubscription(app.requireCtx(req), req.params.id));

  /** Notification de test vers les appareils de l'utilisateur : 404/410 → appareil désactivé. 5 par quart d'heure. */
  app.post("/api/push/test", { config: perUser("push-test", 5, "15 minutes") }, async (req) => {
    const ctx = app.requireCtx(req);
    requireAction(ctx, "radar.read");
    const push = app.services.push;
    if (!enabled() || !push) throw pushDisabled();
    const subs = await withOrg(ctx, (tx) => repos.pushSubscriptions.listActive(tx, ctx.userId));
    if (subs.length === 0) throw new AppError("not_found", "Aucun appareil abonné aux notifications pour votre compte.", 404);
    let sent = 0, failed = 0, disabled = 0;
    const outcomes: { id: string; kind: "ok" | "gone" | "error" }[] = [];
    for (const sub of subs) {
      const res = await push.send({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, TEST_PAYLOAD).catch((err: unknown) => ({ ok: false, statusCode: (err as { statusCode?: number } | null)?.statusCode ?? null }));
      const gone = !res.ok && (res.statusCode === 404 || res.statusCode === 410);
      outcomes.push({ id: sub.id, kind: res.ok ? "ok" : gone ? "gone" : "error" });
      if (res.ok) sent++;
      else if (gone) disabled++;
      else failed++;
    }
    const at = app.services.now().toISOString();
    await withOrg(ctx, async (tx) => {
      for (const o of outcomes) {
        if (o.kind === "ok") await repos.pushSubscriptions.markUsed(tx, o.id, at);
        else if (o.kind === "gone") await repos.pushSubscriptions.disable(tx, o.id, at);
      }
    });
    return { devices: subs.length, sent, failed, disabled };
  });
}
