// Service worker de la pantalla: guarda la página, las imágenes subidas y la última respuesta
// del servidor, para que la TV arranque aunque el servidor no responda.
// Solo actúa sobre /tv y lo que usa; el panel admin nunca pasa por acá.
const CACHE = "io-display-v2";
const BASE = ["/tv.js", "/plantillas.js", "/vendor/qrcode.js"];

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

const esPantalla = (ruta) => ruta === "/" || /^\/tv(\/[a-z0-9-]*)?\/?$/.test(ruta);

self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  const ruta = u.pathname;

  // imágenes subidas: nunca cambian (nombre aleatorio), primero caché
  if (ruta.startsWith("/medios/")) {
    e.respondWith(
      caches.match(e.request).then((r) => r || fetch(e.request).then((resp) => {
        if (resp.ok) {
          const copia = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copia));
        }
        return resp;
      }))
    );
    return;
  }

  if (!esPantalla(ruta) && !BASE.includes(ruta) && ruta !== "/api/pantalla") return;
  const clave = ruta === "/api/pantalla" ? ruta + u.search : esPantalla(ruta) ? "/tv.html" : ruta;

  // red primero (para tomar cambios del admin) y caché si la red falla
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok) {
          const copia = r.clone();
          caches.open(CACHE).then((c) => c.put(clave, copia));
        }
        return r;
      })
      .catch(async () => {
        const r = await caches.match(clave);
        if (!r) return Response.error();
        if (ruta !== "/api/pantalla") return r;
        // marca la respuesta para que la pantalla avise que está mostrando una copia
        const h = new Headers(r.headers);
        h.set("X-Copia", "1");
        return new Response(await r.blob(), { status: 200, headers: h });
      })
  );
});
