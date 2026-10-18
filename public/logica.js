// Lógica pura de IO Display: qué ve cada pantalla a partir de la configuración y el caché de noticias.
// No toca disco ni red, así la usan igual el servidor (Node) y la demo estática (navegador, GitHub Pages).

export function recortar(txt, max) {
  if (txt.length <= max) return txt;
  const corte = txt.slice(0, max);
  const esp = corte.lastIndexOf(" ");
  return (esp > max * 0.6 ? corte.slice(0, esp) : corte) + "…";
}

const normalizar = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function filtrada(nota, config) {
  if (config.ocultas.includes(nota.id)) return true;
  if (!config.excluir.length) return false;
  const t = normalizar(nota.titulo + " " + nota.resumen);
  return config.excluir.some((p) => t.includes(normalizar(p)));
}

// Noticias en rotación: destacadas primero, después intercaladas por medio.
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

// Hash corto (FNV-1a) para la versión: cambia si cambia algo visible en la pantalla
export function versionDe(obj) {
  const s = JSON.stringify(obj);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0") + s.length.toString(16);
}

// Lo que recibe una TV: plantilla, marca, avisos vigentes, noticias y mensaje urgente
export function respuestaPantalla(config, cache, id, ahora = new Date()) {
  const p = config.pantallas.find((x) => x.id === id) || config.pantallas[0];
  const cuerpo = {
    marca: config.marca,
    pantalla: p,
    intercalar: config.intercalar,
    avisos: config.avisos.filter((a) => avisoVigente(a, p.id, ahora)).map(({ id, titulo, texto, imagen, link, formato, segundos }) => ({ id, titulo, texto, imagen, link, formato, segundos })),
    urgente: config.urgente.activo ? config.urgente : null,
    ...armarPantalla(config, cache, ahora.getTime()),
  };
  return { version: versionDe(cuerpo), generado: ahora.toISOString(), ...cuerpo };
}

// Para el admin: todas las notas en caché, marcadas según la config
export function notasParaAdmin(config, cache) {
  const destacadas = new Set(config.destacadas.map((n) => n.id));
  return config.fuentes
    .flatMap((f) => (cache[f.id]?.items || []).map((n) => ({ ...n, fuente: f.nombre })))
    .sort((a, b) => Date.parse(b.fecha || 0) - Date.parse(a.fecha || 0))
    .map((n) => ({ ...n, oculta: config.ocultas.includes(n.id), destacada: destacadas.has(n.id), filtrada: filtrada({ ...n, id: "" }, config) }));
}

export function estadoFuentes(config, cache) {
  return config.fuentes.map((f) => {
    const c = cache[f.id] || {};
    return { id: f.id, ok: !!c.ok, error: c.error || null, actualizado: c.actualizado || null, notas: (c.items || []).length };
  });
}
