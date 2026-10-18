// Configuración (lo que elige el admin) y caché de feeds, ambos persistidos en data/.
// El caché en disco es lo que permite que la TV siga mostrando noticias si se corta internet
// o si se reinicia el equipo sin conexión.
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { bajarFeed, parsearFeed, urlPublicaValida, recortar } from "./rss.mjs";
import { PLANTILLAS, zonasPorDefecto } from "../public/plantillas.js";

export const FUENTES_POR_DEFECTO = [
  { id: "xataka", nombre: "Xataka", url: "https://www.xataka.com/feedburner.xml" },
  { id: "genbeta", nombre: "Genbeta", url: "https://www.genbeta.com/feedburner.xml" },
  { id: "hipertextual", nombre: "Hipertextual", url: "https://hipertextual.com/feed" },
  { id: "muycomputer", nombre: "MuyComputer", url: "https://www.muycomputer.com/feed/" },
  { id: "infobae", nombre: "Infobae Tecno", url: "https://www.infobae.com/arc/outboundfeeds/rss/category/tecno/" },
  { id: "fayerwayer", nombre: "FayerWayer", url: "https://www.fayerwayer.com/arc/outboundfeeds/rss/?outputType=xml" },
  { id: "welivesecurity", nombre: "WeLiveSecurity", url: "https://www.welivesecurity.com/es/rss/feed/" },
  { id: "muyseguridad", nombre: "MuySeguridad", url: "https://www.muyseguridad.net/feed/" },
].map((f) => ({ ...f, activa: true }));

export const CONFIG_POR_DEFECTO = {
  marca: { nombre: "Informática hoy", acento: "#EF4444", logo: "" },
  pantallas: [{ id: "principal", nombre: "Pantalla principal", plantilla: "tablero", zonas: zonasPorDefecto("tablero") }],
  avisos: [], // contenido propio del cliente: imagen + textos, con vigencia y pantallas destino
  urgente: { activo: false, titulo: "", texto: "", color: "rojo" }, // tapa todas las pantallas
  intercalar: 3, // en zonas "mixto": un aviso cada N noticias
  fuentes: FUENTES_POR_DEFECTO,
  ocultas: [], // ids de notas que el admin sacó de la pantalla
  destacadas: [], // notas completas fijadas por el admin (sobreviven aunque el feed las rote)
  excluir: [], // palabras: si aparecen en título o resumen, la nota no sale
  soloDestacadas: false,
  segundos: 14,
  horas: 72,
  porFuente: 6,
};

const LIMITES = { fuentes: 30, ocultas: 1000, destacadas: 40, excluir: 60, avisos: 100, pantallas: 30 };
const RE_MEDIO = /^\/medios\/[a-f0-9]{24}\.(jpg|png|webp|gif)$/;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const slug = (s) => texto(s, 40).toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const entero = (v, min, max, def) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const texto = (v, max) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

// Valida todo lo que llega del panel admin. Lo que no cumple se descarta o se corrige.
export function sanearConfig(c, previa = CONFIG_POR_DEFECTO) {
  const d = CONFIG_POR_DEFECTO;
  const ids = new Set();
  const fuentes = (Array.isArray(c.fuentes) ? c.fuentes : previa.fuentes)
    .slice(0, LIMITES.fuentes)
    .map((f) => ({
      id: texto(f.id, 40).toLowerCase().replace(/[^a-z0-9-]/g, "") || "f" + Math.random().toString(36).slice(2, 8),
      nombre: texto(f.nombre, 40),
      url: texto(f.url, 500),
      activa: f.activa !== false,
    }))
    .filter((f) => f.nombre && urlPublicaValida(f.url) && !ids.has(f.id) && ids.add(f.id));

  const destacadas = (Array.isArray(c.destacadas) ? c.destacadas : [])
    .slice(0, LIMITES.destacadas)
    .filter((n) => n && n.id && n.titulo && /^https?:\/\//.test(n.link || ""))
    .map((n) => ({
      id: texto(n.id, 40), titulo: texto(n.titulo, 200), resumen: texto(n.resumen, 260),
      link: texto(n.link, 1000), imagen: /^https:\/\//.test(n.imagen || "") ? texto(n.imagen, 1000) : "",
      fecha: isNaN(new Date(n.fecha)) ? null : new Date(n.fecha).toISOString(),
      fuente: texto(n.fuente, 40), fuenteId: texto(n.fuenteId, 40),
    }));

  const m = c.marca || previa.marca || d.marca;
  const marca = {
    nombre: texto(m.nombre ?? c.titulo, 40) || d.marca.nombre, // "titulo" es el nombre de la versión anterior
    acento: /^#[0-9a-f]{6}$/i.test(m.acento || "") ? m.acento : d.marca.acento,
    logo: RE_MEDIO.test(m.logo || "") ? m.logo : "",
  };

  const idsP = new Set();
  const pantallas = (Array.isArray(c.pantallas) ? c.pantallas : previa.pantallas || d.pantallas)
    .slice(0, LIMITES.pantallas)
    .map((p) => {
      const plantilla = PLANTILLAS[p.plantilla] ? p.plantilla : "tablero";
      const zonas = zonasPorDefecto(plantilla);
      for (const [k, z] of Object.entries(PLANTILLAS[plantilla].zonas)) if (z.tipos.includes(p.zonas?.[k])) zonas[k] = p.zonas[k];
      return { id: slug(p.id || p.nombre) || "pantalla", nombre: texto(p.nombre, 40) || "Pantalla", plantilla, zonas };
    })
    .filter((p) => !idsP.has(p.id) && idsP.add(p.id));
  if (!pantallas.length) pantallas.push(structuredClone(d.pantallas[0]));

  const idsA = new Set();
  const avisos = (Array.isArray(c.avisos) ? c.avisos : previa.avisos || [])
    .slice(0, LIMITES.avisos)
    .map((a) => ({
      id: texto(a.id, 30).replace(/[^a-z0-9-]/gi, "") || "a" + Math.random().toString(36).slice(2, 10),
      titulo: texto(a.titulo, 120),
      texto: texto(a.texto, 400),
      imagen: RE_MEDIO.test(a.imagen || "") ? a.imagen : "",
      link: /^https?:\/\//.test(a.link || "") ? texto(a.link, 1000) : "",
      formato: a.formato === "afiche" ? "afiche" : "tarjeta", // afiche = la imagen sola a toda la zona
      segundos: entero(a.segundos, 5, 120, 12),
      desde: RE_FECHA.test(a.desde || "") ? a.desde : "",
      hasta: RE_FECHA.test(a.hasta || "") ? a.hasta : "",
      horaDesde: RE_HORA.test(a.horaDesde || "") ? a.horaDesde : "",
      horaHasta: RE_HORA.test(a.horaHasta || "") ? a.horaHasta : "",
      pantallas: (Array.isArray(a.pantallas) ? a.pantallas : []).filter((id) => idsP.has(id)), // vacío = todas
      activo: a.activo !== false,
    }))
    .filter((a) => (a.titulo || a.imagen) && !idsA.has(a.id) && idsA.add(a.id));

  const u = c.urgente || previa.urgente || d.urgente;
  const urgente = {
    activo: u.activo === true,
    titulo: texto(u.titulo, 80),
    texto: texto(u.texto, 300),
    color: ["rojo", "ambar", "azul"].includes(u.color) ? u.color : "rojo",
  };

  return {
    marca,
    pantallas,
    avisos,
    urgente,
    intercalar: entero(c.intercalar, 1, 10, d.intercalar),
    fuentes,
    ocultas: [...new Set((Array.isArray(c.ocultas) ? c.ocultas : []).map((x) => texto(x, 40)).filter(Boolean))].slice(-LIMITES.ocultas),
    destacadas,
    excluir: [...new Set((Array.isArray(c.excluir) ? c.excluir : []).map((x) => texto(x, 40).toLowerCase()).filter(Boolean))].slice(0, LIMITES.excluir),
    soloDestacadas: c.soloDestacadas === true,
    segundos: entero(c.segundos, 8, 60, d.segundos),
    horas: entero(c.horas, 6, 168, d.horas),
    porFuente: entero(c.porFuente, 1, 15, d.porFuente),
  };
}

const normalizar = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function filtrada(nota, config) {
  if (config.ocultas.includes(nota.id)) return true;
  if (!config.excluir.length) return false;
  const t = normalizar(nota.titulo + " " + nota.resumen);
  return config.excluir.some((p) => t.includes(normalizar(p)));
}

// Arma la lista final que se ve en la TV. Pura: no toca disco ni red (se testea aparte).
export function armarPantalla(config, cache, ahora = Date.now()) {
  const activas = config.fuentes.filter((f) => f.activa);
  const limite = ahora - config.horas * 3600 * 1000;
  const vistos = new Set();

  const destacadas = config.destacadas
    .filter((n) => !config.ocultas.includes(n.id) && !vistos.has(n.id) && vistos.add(n.id))
    .map((n) => ({ ...n, destacada: true }));

  const colas = activas.map((f) =>
    (cache[f.id]?.items || [])
      .filter((n) => !vistos.has(n.id) && !filtrada(n, config))
      .filter((n) => (n.fecha ? Date.parse(n.fecha) : 0) >= limite)
      .sort((a, b) => Date.parse(b.fecha) - Date.parse(a.fecha))
      .slice(0, config.porFuente)
      .map((n) => ({ ...n, fuente: f.nombre }))
  );
  // intercaladas: una de cada medio por vuelta, así se ven todas las fuentes
  const resto = [];
  while (colas.some((c) => c.length)) colas.forEach((c) => c.length && resto.push(c.shift()));
  resto.forEach((n) => vistos.add(n.id));

  const noticias = config.soloDestacadas && destacadas.length ? destacadas : [...destacadas, ...resto];
  return {
    segundos: config.segundos,
    noticias: noticias.slice(0, 80).map(({ id, titulo, resumen, link, imagen, fecha, fuente, fuenteId, destacada }) => ({
      id, titulo, resumen: recortar(resumen || "", 240), link, imagen, fecha, fuente, fuenteId, destacada: !!destacada,
    })),
    fuentes: activas.map((f) => ({ id: f.id, nombre: f.nombre, ok: !!cache[f.id]?.ok, actualizado: cache[f.id]?.actualizado || null })),
  };
}

const dosDig = (n) => String(n).padStart(2, "0");
const fechaLocal = (d) => `${d.getFullYear()}-${dosDig(d.getMonth() + 1)}-${dosDig(d.getDate())}`;
const minutos = (hhmm) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3);

// ¿Corresponde mostrar este aviso ahora en esta pantalla? (hora local del equipo)
export function avisoVigente(a, pantallaId, ahora = new Date()) {
  if (!a.activo) return false;
  if (a.pantallas.length && !a.pantallas.includes(pantallaId)) return false;
  const hoy = fechaLocal(ahora);
  if (a.desde && hoy < a.desde) return false;
  if (a.hasta && hoy > a.hasta) return false;
  if (a.horaDesde && a.horaHasta) {
    const m = ahora.getHours() * 60 + ahora.getMinutes();
    const ini = minutos(a.horaDesde), fin = minutos(a.horaHasta);
    const dentro = ini <= fin ? m >= ini && m < fin : m >= ini || m < fin; // franja que cruza la medianoche
    if (!dentro) return false;
  }
  return true;
}

// Archivos subidos que siguen en uso (para limpiar los huérfanos)
export const mediosEnUso = (config) => new Set([config.marca.logo, ...config.avisos.map((a) => a.imagen)].filter(Boolean));

export class Almacen {
  constructor(dir) {
    this.dir = dir;
    this.config = structuredClone(CONFIG_POR_DEFECTO);
    this.cache = {};
    this.version = Date.now();
    this.refrescando = null;
    this.vistas = new Map(); // pantallaId -> último contacto de la TV
  }

  async iniciar() {
    await mkdir(this.dir, { recursive: true });
    const leida = (await this.#leer("config.json")) || {};
    if (leida.titulo && !leida.marca) leida.marca = { ...CONFIG_POR_DEFECTO.marca, nombre: leida.titulo }; // config de la versión 1
    this.config = sanearConfig({ ...CONFIG_POR_DEFECTO, ...leida });
    this.cache = (await this.#leer("cache.json")) || {};
  }

  async #leer(nombre) {
    try {
      return JSON.parse(await readFile(join(this.dir, nombre), "utf8"));
    } catch {
      return null;
    }
  }

  // Escritura atómica: si se corta la luz a mitad de camino no queda un JSON roto
  async #guardar(nombre, datos) {
    const ruta = join(this.dir, nombre);
    await writeFile(ruta + ".tmp", JSON.stringify(datos, null, 1));
    await rename(ruta + ".tmp", ruta);
  }

  async guardarConfig(nueva) {
    const previa = this.config;
    this.config = sanearConfig(nueva, previa);
    await this.#guardar("config.json", this.config);
    this.version = Date.now();
    const nuevas = this.config.fuentes.filter((f) => f.activa && !this.cache[f.id]);
    if (nuevas.length) this.refrescar(nuevas).catch(() => {});
    return this.config;
  }

  async refrescar(fuentes = this.config.fuentes.filter((f) => f.activa)) {
    if (this.refrescando) return this.refrescando;
    this.refrescando = (async () => {
      await Promise.all(
        fuentes.map(async (f) => {
          const previo = this.cache[f.id] || { items: [] };
          try {
            const items = parsearFeed(await bajarFeed(f.url), f);
            if (!items.length) throw new Error("El feed no trajo notas");
            this.cache[f.id] = { ok: true, items: items.slice(0, 40), actualizado: new Date().toISOString(), error: null };
          } catch (e) {
            // la fuente falló: se conserva lo último que trajo
            this.cache[f.id] = { ...previo, ok: false, error: String(e.message || e).slice(0, 120), intento: new Date().toISOString() };
          }
        })
      );
      // el caché solo guarda fuentes que siguen configuradas
      const vigentes = new Set(this.config.fuentes.map((f) => f.id));
      for (const k of Object.keys(this.cache)) if (!vigentes.has(k)) delete this.cache[k];
      await this.#guardar("cache.json", this.cache);
      this.version = Date.now();
    })().finally(() => (this.refrescando = null));
    return this.refrescando;
  }

  // Lo que pide cada TV. La versión es un hash del contenido: cambia si cambia algo visible
  // (también cuando un aviso entra o sale de su horario, sin que nadie toque la config).
  pantalla(id, { registrar = true } = {}) {
    const c = this.config;
    const p = c.pantallas.find((x) => x.id === id) || c.pantallas[0];
    if (registrar) this.vistas.set(p.id, Date.now());
    const ahora = new Date();
    const cuerpo = {
      marca: c.marca,
      pantalla: p,
      intercalar: c.intercalar,
      avisos: c.avisos.filter((a) => avisoVigente(a, p.id, ahora)).map(({ id, titulo, texto, imagen, link, formato, segundos }) => ({ id, titulo, texto, imagen, link, formato, segundos })),
      urgente: c.urgente.activo ? c.urgente : null,
      ...armarPantalla(c, this.cache),
    };
    const version = createHash("sha1").update(JSON.stringify(cuerpo)).digest("hex").slice(0, 16);
    return { version, generado: ahora.toISOString(), ...cuerpo };
  }

  estadoPantallas() {
    return this.config.pantallas.map((p) => ({ id: p.id, visto: this.vistas.get(p.id) ? new Date(this.vistas.get(p.id)).toISOString() : null }));
  }

  // Para el admin: todas las notas en caché, marcadas según la config
  todasLasNotas() {
    const destacadas = new Set(this.config.destacadas.map((n) => n.id));
    return this.config.fuentes
      .flatMap((f) => (this.cache[f.id]?.items || []).map((n) => ({ ...n, fuente: f.nombre })))
      .sort((a, b) => Date.parse(b.fecha || 0) - Date.parse(a.fecha || 0))
      .map((n) => ({ ...n, oculta: this.config.ocultas.includes(n.id), destacada: destacadas.has(n.id), filtrada: filtrada({ ...n, id: "" }, this.config) }));
  }

  estadoFuentes() {
    return this.config.fuentes.map((f) => {
      const c = this.cache[f.id] || {};
      return { id: f.id, ok: !!c.ok, error: c.error || null, actualizado: c.actualizado || null, notas: (c.items || []).length };
    });
  }
}
