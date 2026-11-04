// Service worker Zedeka : page « hors ligne » quand le réseau manque, et fichiers JS/CSS/polices de l'application
// (/_next/static/, nom à empreinte, contenu immuable) gardés sur le téléphone pour que l'application s'ouvre sans les
// retélécharger. Les pages, menus, prix et suivis ne sont jamais mis en cache : ils sont toujours à jour.
const CACHE = "zedeka-v3";
const STATIC = "zedeka-static";
const STATIC_MAX = 120; // fichiers gardés au plus (les plus anciens partent après plusieurs mises à jour du site)
const OFFLINE = "/hors-ligne";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== STATIC).map((k) => caches.delete(k))))
      // Préchargement des pages : la requête part pendant que le service worker démarre, au lieu d'attendre après lui.
      .then(() => self.registration.navigationPreload?.enable())
      .catch(() => {})
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.mode === "navigate") {
    event.respondWith(
      Promise.resolve(event.preloadResponse)
        .then((preloaded) => preloaded || fetch(request))
        .catch(() => caches.match(OFFLINE)),
    );
    return;
  }
  const url = new URL(request.url);
  if (request.method === "GET" && url.origin === self.location.origin && url.pathname.startsWith("/_next/static/")) {
    event.respondWith(staticFile(event, request));
  }
});

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
