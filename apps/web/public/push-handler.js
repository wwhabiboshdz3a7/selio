/*
 * Selio — gestionnaire des notifications push (alertes Radar), importé par le service worker généré
 * (vite-plugin-pwa, workbox `importScripts`). Script classique, sans dépendance.
 *
 * - « push » : affiche la notification (titre, texte, icône Selio, adresse dans `data.url`). Le contenu
 *   vient du serveur Selio (`{ title, body, url }`, jamais de donnée du vendeur) ; il est quand même
 *   borné et l'adresse doit être un chemin interne à l'application.
 * - « notificationclick » : ouvre l'application sur `data.url`, ou focalise un onglet Selio déjà
 *   ouvert et l'y amène.
 */
(function (sw) {
  "use strict";

  var FALLBACK_URL = "/app/radar";
  var ICON = "/icon-192.png";
  var BADGE = "/favicon-64.png";

  /** Chemin interne seulement (même règle que `radarAlertPayload.url`) : jamais une adresse externe. */
  function safePath(url) {
    return typeof url === "string" && url.length <= 300 && /^\/[A-Za-z0-9/_-]*$/.test(url) && url.indexOf("//") !== 0 ? url : FALLBACK_URL;
  }

  function clip(value, max, fallback) {
    if (typeof value !== "string") return fallback;
    var s = value.replace(/\s+/g, " ").trim();
    if (!s) return fallback;
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  }

  /** Contenu de la notification, lu sans confiance (JSON attendu, texte brut toléré). */
  function readPayload(data) {
    var raw = {};
    if (data) {
      try {
        raw = data.json() || {};
      } catch (_e) {
        raw = { body: data.text() };
      }
    }
    if (typeof raw !== "object" || raw === null) raw = {};
    var nested = raw.data && typeof raw.data === "object" ? raw.data : {};
    return {
      title: clip(raw.title, 200, "Selio"),
      body: clip(raw.body, 400, "Nouvelle alerte de Selio Radar."),
      url: safePath(raw.url || nested.url),
      tag: typeof raw.tag === "string" ? raw.tag.slice(0, 100) : undefined,
    };
  }

  sw.addEventListener("push", function (event) {
    var p = readPayload(event.data);
    var options = { body: p.body, icon: ICON, badge: BADGE, lang: "fr", data: { url: p.url } };
    if (p.tag) options.tag = p.tag;
    event.waitUntil(sw.registration.showNotification(p.title, options));
  });

  sw.addEventListener("notificationclick", function (event) {
    event.notification.close();
    var path = safePath(event.notification.data && event.notification.data.url);
    var target = new URL(path, sw.location.origin).href;
    event.waitUntil(
      sw.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
        var same = null;
        var any = null;
        for (var i = 0; i < list.length; i++) {
          var c = list[i];
          var origin;
          try {
            origin = new URL(c.url).origin;
          } catch (_e) {
            continue;
          }
          if (origin !== sw.location.origin) continue;
          if (c.url === target) same = c;
          else if (!any) any = c;
        }
        if (same && "focus" in same) return same.focus();
        if (any && "focus" in any) {
          return any.focus().then(function (focused) {
            var client = focused || any;
            return "navigate" in client ? client.navigate(target) : client;
          });
        }
        return sw.clients.openWindow ? sw.clients.openWindow(target) : undefined;
      }),
    );
  });
})(self);
