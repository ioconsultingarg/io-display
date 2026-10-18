// Service worker de la pantalla: guarda la página y la última lista para que la TV
// arranque aunque el servidor no responda. Solo actúa sobre /tv y sus archivos;
// el panel admin nunca pasa por acá.
const CACHE = "pantalla-it-v1";
const BASE = ["/tv", "/tv.js", "/vendor/qrcode.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Red primero (para tomar cambios del admin) y caché si la red falla
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  const ruta = u.pathname === "/" || u.pathname === "/tv/" ? "/tv" : u.pathname;
  if (!BASE.includes(ruta) && ruta !== "/api/pantalla") return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok) {
          const copia = r.clone();
          caches.open(CACHE).then((c) => c.put(ruta, copia));
        }
        return r;
      })
      .catch(async () => {
        const r = await caches.match(ruta);
        if (!r) return Response.error();
        if (ruta !== "/api/pantalla") return r;
        // marca la respuesta para que la pantalla avise que está mostrando una copia
        const h = new Headers(r.headers);
        h.set("X-Copia", "1");
        return new Response(await r.blob(), { status: 200, headers: h });
      })
  );
});
