// IO Display — servidor de cartelería digital (Node 18+, sin dependencias)
//   /tv/<pantalla>  lo que muestra cada TV: solo lectura, sin controles
//   /admin          panel con clave: pantallas, plantillas, avisos, noticias RSS, marca
// La vista previa del admin enmarca /tv: por eso se permite el mismo origen y nada más.
// Uso: node servidor.mjs   (variables opcionales: PORT, ADMIN_CLAVE, DATA_DIR)
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";
import { Almacen, mediosEnUso } from "./src/almacen.mjs";
import { Medios, MAX_BYTES } from "./src/medios.mjs";
import { Auth } from "./src/auth.mjs";
import { bajarFeed, parsearFeed, tituloDelFeed, urlPublicaValida } from "./src/rss.mjs";

const RAIZ = fileURLToPath(new URL(".", import.meta.url));
const PUBLICO = join(RAIZ, "public");
const DATA = process.env.DATA_DIR || join(RAIZ, "data");
const PUERTO = Number(process.env.PORT) || 8080;
const REFRESCO_MS = 10 * 60 * 1000;
const MAX_CUERPO = 200 * 1024;

const almacen = new Almacen(DATA);
await almacen.iniciar();
const auth = new Auth(DATA);
const infoClave = await auth.iniciar();
const medios = new Medios(DATA);
await medios.iniciar();

const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".jpg": "image/jpeg", ".webp": "image/webp", ".webmanifest": "application/manifest+json" };
const SEGURIDAD = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "SAMEORIGIN",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'",
};

const responder = (res, status, cuerpo, extra = {}) => {
  const json = typeof cuerpo !== "string";
  res.writeHead(status, { ...SEGURIDAD, "Content-Type": json ? "application/json; charset=utf-8" : "text/plain; charset=utf-8", "Cache-Control": "no-store", ...extra });
  res.end(json ? JSON.stringify(cuerpo) : cuerpo);
};

async function leerJSON(req) {
  if (!/^application\/json/.test(req.headers["content-type"] || "")) throw Object.assign(new Error("Se esperaba JSON"), { status: 415 });
  let total = 0;
  const partes = [];
  for await (const p of req) {
    total += p.length;
    if (total > MAX_CUERPO) throw Object.assign(new Error("Cuerpo demasiado grande"), { status: 413 });
    partes.push(p);
  }
  try {
    return JSON.parse(Buffer.concat(partes).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("JSON inválido"), { status: 400 });
  }
}

async function servirArchivo(res, ruta) {
  const destino = normalize(join(PUBLICO, ruta));
  if (!destino.startsWith(PUBLICO + sep)) return responder(res, 403, "Prohibido");
  try {
    const cuerpo = await readFile(destino);
    res.writeHead(200, { ...SEGURIDAD, "Content-Type": TIPOS[extname(destino)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(cuerpo);
  } catch {
    responder(res, 404, "No encontrado");
  }
}

const ipDe = (req) => req.socket.remoteAddress || "?";
const direccionesRed = () => Object.values(networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);

async function leerBinario(req) {
  const declarado = Number(req.headers["content-length"] || 0);
  if (declarado > MAX_BYTES) throw Object.assign(new Error("La imagen supera los 8 MB"), { status: 413 });
  let total = 0;
  const partes = [];
  for await (const p of req) {
    total += p.length;
    if (total > MAX_BYTES) throw Object.assign(new Error("La imagen supera los 8 MB"), { status: 413 });
    partes.push(p);
  }
  return Buffer.concat(partes);
}

// ---------- API del admin (todas requieren sesión) ----------
const admin = {
  "GET /api/admin/estado": () => ({
    config: almacen.config,
    fuentes: almacen.estadoFuentes(),
    notas: almacen.todasLasNotas(),
    pantallas: almacen.estadoPantallas(),
    pantalla: almacen.pantalla(almacen.config.pantallas[0].id, { registrar: false }),
    red: direccionesRed().map((ip) => `http://${ip}:${PUERTO}`), // para armar la dirección de cada TV
  }),
  "PUT /api/admin/config": async (req) => {
    const config = await almacen.guardarConfig(await leerJSON(req));
    medios.limpiar(mediosEnUso(config)).catch(() => {});
    return { ok: true, config };
  },
  "POST /api/admin/medios": async (req) => ({ ok: true, url: await medios.guardar(await leerBinario(req)) }),
  "POST /api/admin/refrescar": async () => {
    await almacen.refrescar();
    return { ok: true, fuentes: almacen.estadoFuentes() };
  },
  "POST /api/admin/probar-feed": async (req) => {
    const { url } = await leerJSON(req);
    if (!urlPublicaValida(url)) return { ok: false, error: "La dirección tiene que ser http(s) y pública" };
    try {
      const xml = await bajarFeed(url);
      const notas = parsearFeed(xml, { id: "prueba", nombre: "prueba" });
      return { ok: notas.length > 0, titulo: tituloDelFeed(xml), notas: notas.length, ejemplo: notas[0]?.titulo || null, error: notas.length ? null : "El feed no trajo notas" };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  },
};

http
  .createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    const ruta = u.pathname;
    try {
      // --- públicas (TV) ---
      if (req.method === "GET" && (ruta === "/" || /^\/tv(\/[a-z0-9-]*)?\/?$/.test(ruta))) return servirArchivo(res, "tv.html");
      if (req.method === "GET" && (ruta === "/admin" || ruta === "/admin/")) return servirArchivo(res, "admin.html");
      if (req.method === "GET" && ruta === "/api/pantalla") return responder(res, 200, almacen.pantalla(u.searchParams.get("p") || "", { registrar: !u.searchParams.has("vista") }));
      if (req.method === "GET" && ruta.startsWith("/medios/")) {
        const m = await medios.leer(ruta.slice(8));
        if (!m) return responder(res, 404, "No encontrado");
        res.writeHead(200, { ...SEGURIDAD, "Content-Type": m.tipo, "Cache-Control": "public, max-age=31536000, immutable" });
        return res.end(m.cuerpo);
      }

      // --- sesión ---
      if (req.method === "POST" && ruta === "/api/login") {
        const { clave } = await leerJSON(req);
        const r = auth.ingresar(ipDe(req), clave);
        if (!r.ok) return responder(res, r.motivo === "bloqueada" ? 429 : 401, { ok: false, error: r.motivo === "bloqueada" ? "Demasiados intentos. Probá en 15 minutos." : "Clave incorrecta" });
        return responder(res, 200, { ok: true }, { "Set-Cookie": Auth.cookie(r.token) });
      }
      if (req.method === "POST" && ruta === "/api/logout") {
        auth.salir(req);
        return responder(res, 200, { ok: true }, { "Set-Cookie": Auth.cookie("", 0) });
      }

      // --- admin ---
      const manejador = admin[`${req.method} ${ruta}`];
      if (manejador) {
        if (!auth.valida(req)) return responder(res, 401, { ok: false, error: "Sesión vencida" });
        return responder(res, 200, await manejador(req));
      }

      // --- archivos estáticos ---
      if (req.method === "GET" && !ruta.startsWith("/api/")) return servirArchivo(res, decodeURIComponent(ruta).slice(1));
      responder(res, 404, "No encontrado");
    } catch (e) {
      responder(res, e.status || 500, { ok: false, error: e.status ? e.message : "Error interno" });
      if (!e.status) console.error(e);
    }
  })
  .listen(PUERTO, "0.0.0.0", () => {
    const ips = direccionesRed();
    console.log(`IO Display`);
    console.log(`  TV:    http://localhost:${PUERTO}/tv/<pantalla>` + ips.map((ip) => `  ·  http://${ip}:${PUERTO}/tv/<pantalla>`).join(""));
    console.log(`  Admin: http://localhost:${PUERTO}/admin`);
    if (infoClave.generada) console.log(`  Se generó una clave de admin nueva en ${infoClave.ruta}`);
    else if (infoClave.ruta) console.log(`  Clave de admin: ver ${infoClave.ruta}`);
  });

// Primer refresco al arrancar (mientras tanto se sirve el caché en disco) y luego cada 10 minutos
almacen.refrescar().catch((e) => console.error("refresco inicial:", e));
setInterval(() => almacen.refrescar().catch((e) => console.error("refresco:", e)), REFRESCO_MS);
setInterval(() => medios.limpiar(mediosEnUso(almacen.config)).catch(() => {}), 3600 * 1000);
