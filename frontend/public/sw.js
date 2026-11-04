// Service worker Zedeka. À Lomé le courant et Internet coupent souvent :
// - fichiers JS/CSS/polices (/_next/static/, nom à empreinte, contenu immuable) gardés sur le téléphone ;
// - pages client (accueil, restaurant, colis, suivi) et lectures publiques de l'API (restaurants et menus, zones,
//   suivi d'une commande, publicités) : toujours demandées au réseau d'abord, donc toujours à jour ; la dernière
//   réponse est gardée et ressert seulement quand le réseau manque, avec son heure (en-tête x-zedeka-saved-at) ;
// - sinon, la page « hors ligne ».
// Rien de personnel n'est gardé ici : ni /api/customer, ni le détail ou la clôture d'une commande.
const CACHE = "zedeka-v4";
const STATIC = "zedeka-static";
const PAGES = "zedeka-pages";
const DATA = "zedeka-data";
const STATIC_MAX = 120; // fichiers gardés au plus (les plus anciens partent après plusieurs mises à jour du site)
const PAGES_MAX = 40;
const DATA_MAX = 80;
const OFFLINE = "/hors-ligne";
// Pages de l'appli client gardées pour le hors-ligne.
const KEPT_PAGES = /^\/(app(\/(recherche|commandes|zed))?|r\/[^/]+|colis|commande\/[^/]+)\/?$/;
// Lectures publiques de l'API gardées pour le hors-ligne.
const KEPT_DATA = /^\/api\/(restaurants(\/[^/]+)?|zones|ads|zed\/config|parcel-categories|parcel-pricing|policies|orders\/[^/]+)$/;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![CACHE, STATIC, PAGES, DATA].includes(k)).map((k) => caches.delete(k))))
      // Préchargement des pages : la requête part pendant que le service worker démarre, au lieu d'attendre après lui.
      .then(() => self.registration.navigationPreload?.enable())
      .catch(() => {})
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.mode === "navigate") {
    const keep = url.origin === self.location.origin && KEPT_PAGES.test(url.pathname);
    event.respondWith(
      Promise.resolve(event.preloadResponse)
        .then((preloaded) => preloaded || fetch(request))
        .then((response) => {
          if (keep && response.ok) event.waitUntil(save(PAGES, pageKey(url), response.clone(), PAGES_MAX));
          return response;
        })
        .catch(() => (keep ? caches.open(PAGES).then((c) => c.match(pageKey(url))) : Promise.resolve(null)).then((hit) => hit || caches.match(OFFLINE)).then((hit) => hit || offlineStub())),
    );
    return;
  }
  if (request.method === "GET" && url.origin === self.location.origin && KEPT_DATA.test(url.pathname) && !request.headers.has("authorization")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) event.waitUntil(save(DATA, request.url, response.clone(), DATA_MAX));
          return response;
        })
        .catch((e) => caches.open(DATA).then((c) => c.match(request.url)).then((hit) => hit || Promise.reject(e))),
    );
    return;
  }
  if (request.method === "GET" && url.origin === self.location.origin && url.pathname.startsWith("/_next/static/")) {
    event.respondWith(staticFile(event, request));
  }
});

// Dernier recours si même la page « hors ligne » n'a pas pu être gardée (première visite coupée, mémoire vidée).
function offlineStub() {
  const html =
    '<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    "<title>Zedeka hors ligne</title><body style=\"font-family:system-ui,sans-serif;padding:32px 20px;color:#1c1917;background:#fafaf9\">" +
    "<h1 style=\"font-size:22px\">Pas de réseau</h1><p>Cette page n'a pas encore été ouverte sur ce téléphone. Réessayez quand le réseau revient.</p>" +
    '<p><a href="/app" style="color:#047857">Revenir à l\'accueil</a></p></body></html>';
  return new Response(html, { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
}

function staticFile(event, request) {
  return caches.open(STATIC).then((cache) =>
    cache.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok) event.waitUntil(cache.put(request, response.clone()).then(() => trim(cache)).catch(() => {}));
          return response;
        }),
    ),
  );
}

// Une page se garde sans ses paramètres (?_rsc=…, filtres) : une seule copie par adresse.
const pageKey = (url) => url.origin + url.pathname;

// Copie gardée avec son heure, pour que l'écran puisse dire « données de 13:31 ».
function save(name, key, response, max) {
  return response
    .blob()
    .then((body) => {
      const headers = new Headers(response.headers);
      headers.set("x-zedeka-saved-at", new Date().toISOString());
      return caches.open(name).then((cache) =>
        cache
          .put(key, new Response(body, { status: response.status, statusText: response.statusText, headers }))
          .then(() => cache.keys())
          .then((keys) => Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((k) => cache.delete(k)))),
      );
    })
    .catch(() => {});
}

function trim(cache) {
  return cache.keys().then((keys) => Promise.all(keys.slice(0, Math.max(0, keys.length - STATIC_MAX)).map((k) => cache.delete(k))));
}

// Alertes des partenaires (nouvelle commande, réservation, commande sans réponse) et de l'équipe de l'admin.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Zedeka", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    // Les pages ouvertes (suivi d'une commande…) se mettent à jour tout de suite, sans attendre leur prochain tour.
    notifyPages(data).then(() =>
      // Notification de l'équipe (admin) alors qu'une page de l'admin est sous les yeux : la page affiche
      // elle-même un bandeau et joue le son, sans pop-up du système en double.
      (data.id ? visibleAdmin() : Promise.resolve(null)).then((client) => {
        if (client) return client.postMessage({ type: "zedeka-staff-notification", id: data.id });
        return show(data);
      }),
    ),
  );
});

function notifyPages(data) {
  return self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then((list) => list.forEach((c) => c.postMessage({ type: "zedeka-push", url: data.url || "" })))
    .catch(() => {});
}

function visibleAdmin() {
  return self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then((list) => list.find((c) => c.visibilityState === "visible" && c.focused && new URL(c.url).pathname.startsWith("/admin")) || null);
}

function show(data) {
  return self.registration.showNotification(data.title || "Zedeka", {
    body: data.body || "",
    tag: data.tag,
    renotify: Boolean(data.tag),
    requireInteraction: Boolean(data.alarm),
    vibrate: data.alarm ? [500, 200, 500, 200, 500] : [200],
    icon: "/pwa-icon/192",
    badge: "/pwa-icon/192",
    data: { url: data.url || "/" },
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const same = list.find((c) => new URL(c.url).pathname.split("/")[1] === new URL(url).pathname.split("/")[1]);
      if (same) return same.focus().then((c) => c.navigate(url));
      return self.clients.openWindow(url);
    }),
  );
});
