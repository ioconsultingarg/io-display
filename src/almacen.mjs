// Configuración (lo que elige el admin) y caché de feeds, ambos persistidos en data/.
// El caché en disco es lo que permite que la TV siga mostrando noticias si se corta internet
// o si se reinicia el equipo sin conexión.
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { bajarFeed, parsearFeed, urlPublicaValida, recortar } from "./rss.mjs";

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
  titulo: "Informática hoy",
  fuentes: FUENTES_POR_DEFECTO,
  ocultas: [], // ids de notas que el admin sacó de la pantalla
  destacadas: [], // notas completas fijadas por el admin (sobreviven aunque el feed las rote)
  excluir: [], // palabras: si aparecen en título o resumen, la nota no sale
  soloDestacadas: false,
  segundos: 14,
  horas: 72,
  porFuente: 6,
};

const LIMITES = { fuentes: 30, ocultas: 1000, destacadas: 40, excluir: 60 };

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

  return {
    titulo: texto(c.titulo ?? previa.titulo, 40) || d.titulo,
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
    titulo: config.titulo,
    segundos: config.segundos,
    noticias: noticias.slice(0, 80).map(({ id, titulo, resumen, link, imagen, fecha, fuente, fuenteId, destacada }) => ({
      id, titulo, resumen: recortar(resumen || "", 240), link, imagen, fecha, fuente, fuenteId, destacada: !!destacada,
    })),
    fuentes: activas.map((f) => ({ id: f.id, nombre: f.nombre, ok: !!cache[f.id]?.ok, actualizado: cache[f.id]?.actualizado || null })),
  };
}

export class Almacen {
  constructor(dir) {
    this.dir = dir;
    this.config = structuredClone(CONFIG_POR_DEFECTO);
    this.cache = {};
    this.version = Date.now();
    this.refrescando = null;
  }

  async iniciar() {
    await mkdir(this.dir, { recursive: true });
    this.config = sanearConfig({ ...CONFIG_POR_DEFECTO, ...(await this.#leer("config.json")) });
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

  pantalla() {
    return { version: this.version, generado: new Date().toISOString(), ...armarPantalla(this.config, this.cache) };
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
