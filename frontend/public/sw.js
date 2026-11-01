// Service worker Zedeka : page « hors ligne » quand le réseau manque. Rien d'autre n'est mis en cache,
// pour que les menus, les prix et le suivi des commandes soient toujours à jour.
const CACHE = "zedeka-v2";
const OFFLINE = "/hors-ligne";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});

// Alertes des partenaires (nouvelle commande, réservation, commande sans réponse) et de l'équipe de l'admin.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Zedeka", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    // Notification de l'équipe (admin) alors qu'une page de l'admin est sous les yeux : la page affiche
    // elle-même un bandeau et joue le son, sans pop-up du système en double.
    (data.id ? visibleAdmin() : Promise.resolve(null)).then((client) => {
      if (client) return client.postMessage({ type: "zedeka-staff-notification", id: data.id });
      return show(data);
    }),
  );
});

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
