import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { AppError, cloud } from "@selio/core";
import { wsClientMessageSchema, workerScreenMessageSchema, type CloudRelay, type WorkerScreenMessage } from "../cloud-relay";

/**
 * Selio Cloud (préfixe /api/cloud) : accord, disponibilité selon l'offre, comptes, journal et
 * fenêtre de connexion. Toutes les routes exigent la session (cookie), sauf la WebSocket de la
 * fenêtre, authentifiée par son ticket (haché en base, à durée courte, montré une seule fois, et
 * consommé par la première WebSocket : une seconde connexion avec le même ticket est refusée).
 * Quand la WebSocket se ferme sans connexion réussie (onglet fermé, coupure), la fenêtre est
 * annulée : le navigateur du Cloud se referme aussitôt, rien de ce qui a été tapé ne reste ouvert.
 *
 * L'API n'ouvre jamais de navigateur : le worker le fait (file « selio-cloud-login »), l'API relaie
 * images et entrées par Redis. Aucun mot de passe Vinted ne transite ailleurs que dans les événements
 * clavier relayés tels quels, jamais journalisés : le journal de la route ne reçoit que des compteurs.
 */
export interface CloudRouteOptions {
  /** CLOUD_ENABLED : sans lui, la fenêtre de connexion répond 503 (le reste reste consultable). */
  enabled: boolean;
  /** Relais Redis ; null sans REDIS_URL ou Cloud désactivé. */
  relay: CloudRelay | null;
  /** Heures actives (CLOUD_ACTIVE_HOURS), affichées avec la disponibilité. */
  activeHours: { startHour: number; endHour: number };
  /** Origines autorisées (CORS_ORIGINS) : une WebSocket venue d'ailleurs est refusée. */
  allowedOrigins: string[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TICKET_RE = /^[A-Za-z0-9_-]{20,200}$/;
/**
 * Événements acceptés par seconde et par fenêtre. Les déplacements de souris ont leur propre budget :
 * en sauter un est sans conséquence, alors qu'une frappe perdue fausserait la saisie du client.
 */
const MAX_INPUTS_PER_SECOND = 60;
const MAX_MOVES_PER_SECOND = 30;
/** Au-delà, la WebSocket est fermée (client défaillant ou malveillant). */
const MAX_REJECTED = 50;
/** Images en attente d'envoi au-delà desquelles une image est sautée (connexion lente). */
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

export interface PendingSocket {
  loginSessionId: string;
  expiresAt: string;
  token: string;
}
/** État validé par `preValidation` puis repris par le gestionnaire de la WebSocket. */
const pending = new WeakMap<FastifyRequest, PendingSocket>();

const cloudDisabled = () => new AppError("cloud_disabled", "Selio Cloud n'est pas activé sur ce serveur : la fenêtre de connexion est indisponible.", 503);
const badTicket = () => new AppError("unauthorized", "Ticket de connexion invalide ou expiré.", 401);

export default async function cloudRoutes(app: FastifyInstance, opts: CloudRouteOptions) {
  const serverEnabled = opts.enabled && opts.relay !== null;

  app.get("/api/cloud/overview", async (req) => ({ ...(await cloud.overview(app.requireCtx(req))), serverEnabled, activeHours: opts.activeHours }));
  app.get("/api/cloud/consent", async (req) => cloud.consent(app.requireCtx(req)));
  app.post("/api/cloud/consent", async (req) => cloud.acceptConsent(app.requireCtx(req), req.body));
  // Disponibilité selon l'offre, plus deux informations du serveur : Cloud activé ici, heures actives.
  app.get("/api/cloud/availability", async (req) => ({ ...(await cloud.availability(app.requireCtx(req))), serverEnabled, activeHours: opts.activeHours }));

  app.get("/api/cloud/accounts", async (req) => cloud.listAccounts(app.requireCtx(req)));
  app.post("/api/cloud/accounts", async (req, reply) => {
    const account = await cloud.enableAccount(app.requireCtx(req), req.body ?? {});
    reply.status(201);
    return account;
  });
  app.post<{ Params: { id: string } }>("/api/cloud/accounts/:id/pause", async (req) => cloud.pause(app.requireCtx(req), req.params.id));
  app.post<{ Params: { id: string } }>("/api/cloud/accounts/:id/resume", async (req) => cloud.resume(app.requireCtx(req), req.params.id, req.body ?? {}));
  app.post<{ Params: { id: string } }>("/api/cloud/accounts/:id/stop", async (req) => cloud.stop(app.requireCtx(req), req.params.id));
  app.delete<{ Params: { id: string } }>("/api/cloud/accounts/:id/session", async (req) => cloud.deleteSession(app.requireCtx(req), req.params.id));
  app.patch<{ Params: { id: string } }>("/api/cloud/accounts/:id/settings", async (req) => cloud.updateSettings(app.requireCtx(req), req.params.id, req.body ?? {}));

  app.get("/api/cloud/journal", async (req) => cloud.journal(app.requireCtx(req), req.query ?? {}));
  app.get("/api/cloud/journal.csv", async (req, reply) => {
    const csv = await cloud.exportJournal(app.requireCtx(req), req.query ?? {});
    reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", "attachment; filename=selio-cloud-journal.csv");
    return csv;
  });

  /**
   * Ouvre une fenêtre de connexion : ticket renvoyé une seule fois (jamais journalisé, jamais mis en
   * cache), fenêtre mise en file pour le worker. 5 demandes par utilisateur et par quart d'heure.
   */
  app.post<{ Params: { id: string } }>(
    "/api/cloud/accounts/:id/login",
    { config: { rateLimit: { max: 5, timeWindow: "15 minutes", keyGenerator: (req: FastifyRequest) => (req.orgCtx ? `cloud-login:${req.orgCtx.userId}` : `cloud-login-ip:${req.ip}`) } } },
    async (req, reply) => {
      const ctx = app.requireCtx(req);
      if (!serverEnabled || !opts.relay) throw cloudDisabled();
      const ticket = await cloud.startLogin(ctx, req.params.id);
      try {
        await opts.relay.enqueueLogin(ticket.loginSessionId);
      } catch {
        await cloud.cancelLogin(ctx, ticket.loginSessionId).catch(() => {});
        throw new AppError("cloud_busy", "La fenêtre de connexion n'a pas pu être préparée : réessayez dans un instant.", 503);
      }
      reply.status(201).header("cache-control", "no-store");
      return ticket;
    },
  );

  /** Ferme la fenêtre sans se connecter (bouton « Annuler ») : le worker referme le navigateur. */
  app.post<{ Params: { id: string } }>("/api/cloud/login/:id/cancel", async (req, reply) => {
    const ctx = app.requireCtx(req);
    await cloud.cancelLogin(ctx, req.params.id);
    await opts.relay?.publishInput(req.params.id, { type: "cancel" }).catch(() => {});
    reply.status(204);
  });

  app.get<{ Params: { id: string }; Querystring: { ticket?: string } }>(
    "/api/cloud/login/:id/ws",
    {
      websocket: true,
      // Tout est vérifié avant la mise à niveau : un refus répond en HTTP (401, 403, 409, 503).
      preValidation: async (req) => {
        const origin = req.headers.origin;
        if (origin && !opts.allowedOrigins.includes(origin)) throw new AppError("forbidden", "Origine refusée.", 403);
        const id = req.params.id;
        const ticket = typeof req.query.ticket === "string" ? req.query.ticket : "";
        if (!UUID_RE.test(id) || !TICKET_RE.test(ticket)) throw badTicket();
        // Lecture seule d'abord : un refus (ticket inconnu, serveur sans Cloud) ne consomme rien.
        const found = await cloud.findLoginByTicket(app.services, ticket);
        if (!found || found.loginSessionId !== id) throw badTicket();
        if (!serverEnabled || !opts.relay) throw cloudDisabled();
        const ttl = new Date(found.expiresAt).getTime() - app.services.now().getTime();
        if (ttl <= 0) throw badTicket();
        const token = await opts.relay.acquireSocket(id, ttl);
        if (!token) throw new AppError("conflict", "Cette fenêtre de connexion est déjà ouverte ailleurs.", 409);
        // Ticket consommé (UPDATE conditionnel) : il ne sert qu'une fois, même après la fermeture de cette WebSocket.
        const ref = await cloud.attachLoginTicket(app.services, ticket).catch(() => null);
        if (!ref || ref.loginSessionId !== id) {
          await opts.relay.releaseSocket(id, token).catch(() => {});
          throw badTicket();
        }
        pending.set(req, { loginSessionId: id, expiresAt: ref.expiresAt, token });
      },
    },
    (socket, req) => {
      const state = pending.get(req);
      pending.delete(req);
      if (!state || !opts.relay) {
        socket.close(1011, "indisponible");
        return;
      }
      const relay = opts.relay;
      relayLoginSocket(socket, req, relay, state, app.services.now, async (why) => {
        // Fermeture sans connexion réussie : la fenêtre est fermée en base et le worker referme Chromium.
        await relay.publishInput(state.loginSessionId, { type: "cancel" }).catch(() => {});
        await cloud.abandonLogin(app.services, state.loginSessionId, why === "expired" ? "expired" : "cancelled").catch(() => false);
      });
    },
  );
}

/**
 * Branche une WebSocket sur les canaux Redis de la fenêtre (gestionnaires attachés sans délai).
 * `onAbandon` est appelé une fois si la WebSocket se ferme avant « done » (ou sur « cancel ») : la
 * fenêtre ne reste jamais ouverte sans client, puisque le ticket ne permet pas de se reconnecter.
 */
export function relayLoginSocket(socket: WebSocket, req: FastifyRequest, relay: CloudRelay, state: PendingSocket, now: () => Date, onAbandon: (why: string) => Promise<void> = async () => {}): void {
  const { loginSessionId } = state;
  // Compteurs seulement : jamais le contenu d'un événement, jamais le ticket.
  const counters = { frames: 0, framesSkipped: 0, inputs: 0, rejected: 0, dropped: 0 };
  let outcome = "client_closed";
  let finished = false;
  let unsubscribe: (() => Promise<void>) | null = null;
  let windowStart = Date.now();
  let windowCount = 0;
  let movesCount = 0;

  const send = (payload: Record<string, unknown>) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
  };
  // Fin sans connexion réussie (fermeture de l'onglet, coupure, annulation, client défaillant) : la
  // fenêtre est annulée. Une fin décidée par le worker (« done » ou « closed ») ne l'est pas.
  let workerEnded = false;
  // Désabonnement, verrou rendu et bilan (compteurs) : une seule fois, dès la fin décidée ou à la fermeture.
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(expiry);
    void (async () => {
      if (!workerEnded) await onAbandon(outcome).catch(() => {});
      await unsubscribe?.().catch(() => {});
      await relay.releaseSocket(loginSessionId, state.token).catch(() => {});
      req.log.info({ loginSessionId, outcome, ...counters }, "cloud : fenêtre de connexion fermée");
    })();
  };
  const end = (why: string, code = 1000) => {
    if (finished) return;
    outcome = why;
    finished = true;
    if (socket.readyState === socket.OPEN || socket.readyState === socket.CONNECTING) socket.close(code, why);
    cleanup();
  };

  const expiry = setTimeout(() => {
    send({ type: "closed", reason: "expired" });
    end("expired");
  }, Math.max(0, new Date(state.expiresAt).getTime() - now().getTime()));
  expiry.unref?.();

  socket.on("message", (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
    if (finished) return;
    const t = Date.now();
    if (t - windowStart >= 1000) {
      windowStart = t;
      windowCount = 0;
      movesCount = 0;
    }
    // Plafond global (avant toute lecture) : protège le relais d'un client qui inonde la WebSocket.
    if (++windowCount > MAX_INPUTS_PER_SECOND + MAX_MOVES_PER_SECOND) {
      counters.dropped++;
      return;
    }
    let parsed: unknown = null;
    if (!isBinary) {
      try {
        parsed = JSON.parse(Buffer.isBuffer(data) ? data.toString("utf8") : Array.isArray(data) ? Buffer.concat(data).toString("utf8") : Buffer.from(data).toString("utf8"));
      } catch {
        parsed = null;
      }
    }
    const msg = wsClientMessageSchema.safeParse(parsed);
    if (!msg.success) {
      counters.rejected++;
      if (counters.rejected > MAX_REJECTED) end("too_many_invalid", 1008);
      return;
    }
    if (msg.data.type === "cancel") {
      void relay.publishInput(loginSessionId, { type: "cancel" }).catch(() => {});
      send({ type: "closed", reason: "cancelled" });
      end("cancelled");
      return;
    }
    if (msg.data.type === "mouse" && msg.data.action === "move" && ++movesCount > MAX_MOVES_PER_SECOND) {
      counters.dropped++;
      return;
    }
    counters.inputs++;
    relay.publishInput(loginSessionId, { type: "input", event: msg.data }).catch(() => {
      counters.dropped++;
    });
  });

  socket.on("close", () => {
    finished = true;
    cleanup();
  });

  const onWorkerMessage = (raw: string) => {
    if (finished) return;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return;
    }
    const parsed = workerScreenMessageSchema.safeParse(value);
    if (!parsed.success) return;
    const msg: WorkerScreenMessage = parsed.data;
    if (msg.type === "frame") {
      if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
        counters.framesSkipped++;
        return;
      }
      counters.frames++;
      send({ type: "frame", data: msg.data, width: msg.width, height: msg.height });
    } else if (msg.type === "status") {
      send({ type: "status", status: msg.status });
    } else if (msg.type === "done") {
      // Connexion détectée par le worker, session chiffrée et enregistrée : fermeture propre.
      workerEnded = true;
      send({ type: "done" });
      end("done");
    } else {
      workerEnded = true;
      send({ type: "closed", reason: msg.reason });
      end(msg.reason);
    }
  };

  relay
    .subscribeScreen(loginSessionId, onWorkerMessage)
    .then(async (unsub) => {
      unsubscribe = unsub;
      if (finished) {
        await unsub().catch(() => {});
        return;
      }
      send({ type: "ready", loginSessionId, expiresAt: state.expiresAt });
      // Le worker renvoie sa dernière image : l'écran Chromium ne change pas forcément tout seul.
      await relay.publishInput(loginSessionId, { type: "hello" });
    })
    .catch(() => {
      send({ type: "closed", reason: "unavailable" });
      end("relay_unavailable", 1011);
    });
}
