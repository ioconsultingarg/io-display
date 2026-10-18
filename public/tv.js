// Pantalla de la TV: pide al servidor qué mostrar (plantilla, zonas, noticias, avisos) y lo rota sola.
// Caché ante cortes, en dos capas:
//   1) copia en localStorage de la última respuesta (sirve aunque se caiga el servidor)
//   2) service worker que guarda la página, las imágenes y la última respuesta (solo en localhost o https)
import { PLANTILLAS } from "./plantillas.js";
import { respuestaPantalla } from "./logica.js";
import { ESTATICO, datosBase, configDemo, CLAVE_DEMO } from "./demo.js";

// La ruta se lee relativa a <base>: "tv/<pantalla>" tanto con el servidor como en GitHub Pages
const RAIZ = new URL(document.baseURI).pathname;
const PANTALLA = (location.pathname.slice(RAIZ.length).split("/")[1] || "").toLowerCase();
const CLAVE_COPIA = "io-display:ultima:" + PANTALLA;
// ?vista=1 es la vista previa del admin: no cuenta como TV conectada
const EXTRA = new URLSearchParams(location.search).has("vista") ? "&vista=1" : "";
const CONSULTA_MS = 20 * 1000; // cada cuánto pregunta si cambió algo (incluye el mensaje urgente)
const $ = (id) => document.getElementById(id);
const quieto = matchMedia("(prefers-reduced-motion: reduce)").matches;
// imágenes subidas: "/medios/x" se resuelve contra <base> (en la demo también pueden ser data:)
const medio = (u) => (u && u.startsWith("/medios/") ? new URL(u.slice(1), document.baseURI).href : u);

let datos = null;
let firmaPlantilla = "";
let controladores = [];
let servidorOk = true;
let copiaDe = null;

// ---------- sin interacción: la TV no se maneja ----------
["contextmenu", "keydown", "wheel", "touchstart", "mousedown", "dragstart"].forEach((ev) =>
  addEventListener(ev, (e) => e.preventDefault(), { passive: false, capture: true })
);

// ---------- utilidades ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const hora = (d) => d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
const recortar = (t, max) => {
  if (t.length <= max) return t;
  const i = t.lastIndexOf(" ", max);
  return t.slice(0, i > max * 0.6 ? i : max) + "…";
};

function haceCuanto(iso) {
  if (!iso) return "";
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "ayer" : `hace ${d} días`;
}

function linkCorto(url) {
  try {
    const u = new URL(url);
    const tramo = u.pathname.split("/").filter(Boolean).pop() || "";
    return u.hostname.replace(/^www\./, "") + (tramo ? "/…/" + recortar(tramo, 38) : "");
  } catch {
    return "";
  }
}

function qrSVG(url) {
  if (!url || typeof qrcode !== "function") return "";
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  const n = qr.getModuleCount();
  let p = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) p += `M${x} ${y}h1v1h-1z`;
  return `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges" role="img" aria-label="Código QR"><path d="${p}" fill="#000"/></svg>`;
}

function animar(elementos, desde, opciones = {}) {
  if (quieto) return;
  elementos.forEach((el, k) =>
    el.animate([desde, { opacity: 1, transform: "none" }], { duration: 420, easing: "cubic-bezier(.34,1.56,.64,1)", fill: "backwards", delay: k * 70, ...opciones })
  );
}

function barraProgreso(el, ms) {
  if (!el) return;
  el.getAnimations().forEach((a) => a.cancel());
  el.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: ms, easing: "linear", fill: "forwards" });
}

// ---------- qué se rota en cada zona ----------
const noticia = (n) => ({ ...n, clase: "noticia" });
const aviso = (a) => ({ ...a, clase: "aviso" });

function armarLista(tipo, d) {
  const ns = d.noticias.map(noticia);
  const as = d.avisos.map(aviso);
  if (tipo === "noticias") return ns.length ? ns : as;
  if (tipo === "avisos") return as.length ? as : ns;
  // mixto: un aviso cada N noticias
  if (!as.length) return ns;
  if (!ns.length) return as;
  const lista = [];
  let k = 0;
  ns.forEach((n, i) => {
    lista.push(n);
    if ((i + 1) % d.intercalar === 0) lista.push(as[k++ % as.length]);
  });
  // que cada aviso salga al menos una vez por vuelta
  while (k < as.length) lista.splice(Math.min(lista.length, (k + 1) * (d.intercalar + 1) - 1), 0, as[k++]);
  return lista;
}

const duracion = (item, d) => (item.clase === "aviso" ? item.segundos : d.segundos) * 1000;

// ---------- dibujo de una tarjeta ----------
function htmlNoticia(n) {
  return `<article class="tarjeta ${n.imagen ? "" : "sin-foto"}">
    <div class="etiqueta">
      ${n.destacada ? `<span class="chip claro">Destacada</span>` : ""}
      <span class="chip">${esc(n.fuente)}</span>
      <span class="chip gris mono">${haceCuanto(n.fecha)}</span>
    </div>
    <h1 class="titulo">${esc(n.titulo)}</h1>
    <p class="texto">${esc(n.resumen)}</p>
    <div class="foto">${n.imagen ? `<img src="${esc(n.imagen)}" alt="" referrerpolicy="no-referrer">` : ""}</div>
    <dl class="cita">
      <div class="qr">${qrSVG(n.link)}</div>
      <div><dt>Fuente</dt><dd>${esc(n.fuente)}</dd><div class="url mono">${esc(linkCorto(n.link))}</div><div class="leer">Escaneá el código para leer la nota completa</div></div>
    </dl>
    <div class="progreso"><i></i></div>
  </article>`;
}

function htmlAviso(aviso, marca) {
  const a = { ...aviso, imagen: medio(aviso.imagen) };
  if (a.formato === "afiche" && a.imagen) {
    return `<article class="afiche">
      <div class="fondo" style="background-image:url('${esc(a.imagen)}')"></div>
      <img src="${esc(a.imagen)}" alt="${esc(a.titulo)}">
      ${a.link ? `<div class="qr-esquina">${qrSVG(a.link)}</div>` : ""}
      <div class="progreso"><i></i></div>
    </article>`;
  }
  return `<article class="tarjeta ${a.imagen ? "" : "sin-foto"}">
    <div class="etiqueta"><span class="chip claro">${esc(marca.nombre)}</span></div>
    <h1 class="titulo">${esc(a.titulo)}</h1>
    <p class="texto">${esc(a.texto)}</p>
    <div class="foto">${a.imagen ? `<img src="${esc(a.imagen)}" alt="">` : ""}</div>
    ${a.link ? `<dl class="cita"><div class="qr">${qrSVG(a.link)}</div><div><dt>Más información</dt><dd>${esc(linkCorto(a.link).split("/")[0])}</dd><div class="leer">Escaneá el código con el celular</div></div></dl>` : ""}
    <div class="progreso"><i></i></div>
  </article>`;
}

// ---------- controladores de zona ----------
// Rotador: muestra de a una noticia o aviso, cada uno con su duración.
function rotador(el, tipo, desfase, alCambiar) {
  let lista = [];
  let i = desfase;
  let t = null;
  let d = null;

  function mostrar() {
    clearTimeout(t);
    if (!lista.length) {
      el.innerHTML = `<div class="vacio"><b>No hay contenido para mostrar</b>Revisá las fuentes y los avisos en el panel de administración.</div>`;
      alCambiar && alCambiar(null, [], 0);
      return;
    }
    i = i % lista.length;
    const item = lista[i];
    const ms = duracion(item, d);
    el.innerHTML = item.clase === "aviso" ? htmlAviso(item, d.marca) : htmlNoticia(item);
    el.querySelectorAll("img").forEach((img) => img.addEventListener("error", () => img.remove()));
    animar([...el.querySelectorAll(".tarjeta > :not(.progreso), .afiche > img")], { opacity: 0, transform: "translateY(16px)" });
    barraProgreso(el.querySelector(".progreso i"), ms);
    const siguientes = [];
    for (let k = 1; k <= Math.min(4, lista.length - 1); k++) siguientes.push(lista[(i + k) % lista.length]);
    alCambiar && alCambiar(item, siguientes, ms);
    t = setTimeout(() => {
      i++;
      mostrar();
    }, ms);
  }

  return {
    actualizar(nuevos) {
      const actual = lista.length ? lista[i % lista.length]?.id : null;
      const primeraVez = !d;
      d = nuevos;
      lista = armarLista(tipo, d);
      if (primeraVez) return mostrar();
      const pos = lista.findIndex((x) => x.id === actual);
      if (pos >= 0) i = pos;
      else mostrar(); // lo que se veía ya no está (lo sacaron desde el admin): pasar a otro ya
    },
    destruir: () => clearTimeout(t),
  };
}

function cola(el) {
  el.innerHTML = `<div class="cola"><h2>A continuación</h2><div class="lista"></div></div>`;
  const lista = el.querySelector(".lista");
  return {
    alCambiar(_actual, siguientes) {
      lista.innerHTML = siguientes
        .map((s, k) => `<div class="item"><div class="q"><b>${esc(s.clase === "aviso" ? datos.marca.nombre : s.fuente)}</b><span class="mono">${k === 0 ? "Siguiente" : s.clase === "aviso" ? "" : haceCuanto(s.fecha)}</span></div><p>${esc(s.titulo)}</p></div>`)
        .join("");
      animar([...lista.children], { opacity: 0, transform: "translateY(16px) scale(.92)" }, { delay: 200 });
    },
  };
}

function fuentes(el) {
  el.innerHTML = `<div class="fuentes"><div class="progreso"><i></i></div><div class="t">Fuentes</div><div class="chips"></div></div>`;
  const chips = el.querySelector(".chips");
  return {
    actualizar(d) {
      chips.innerHTML = d.fuentes.map((f) => `<span data-id="${esc(f.id)}" class="${f.ok ? "" : "caida"}">${esc(f.nombre)}</span>`).join("");
    },
    alCambiar(actual, _s, ms) {
      chips.querySelectorAll("span").forEach((s) => s.classList.toggle("on", !!actual && s.dataset.id === actual.fuenteId));
      barraProgreso(el.querySelector(".progreso i"), ms);
    },
  };
}

function titulares(el) {
  el.innerHTML = `<div class="titulares"><div class="etq">Titulares</div><div class="cinta"></div></div>`;
  const cinta = el.querySelector(".cinta");
  let firma = "";
  return {
    actualizar(d) {
      const items = [...d.avisos.filter((a) => a.titulo).map((a) => [d.marca.nombre, a.titulo]), ...d.noticias.slice(0, 30).map((n) => [n.fuente, n.titulo])];
      const html = items.map(([f, t]) => `<span><b>${esc(f)}</b>${esc(t)}</span>`).join("");
      if (html === firma) return; // no reiniciar la cinta si no cambió nada
      firma = html;
      cinta.innerHTML = html + html; // duplicado para el bucle continuo
      const largo = items.reduce((s, [f, t]) => s + f.length + t.length, 0);
      cinta.style.setProperty("--duracion", Math.max(60, Math.round(largo * 0.22)) + "s");
    },
  };
}

// ---------- armado de la plantilla ----------
function construir(d) {
  controladores.forEach((c) => c.destruir && c.destruir());
  controladores = [];
  const p = PLANTILLAS[d.pantalla.plantilla] || PLANTILLAS.tablero;
  document.body.className = `p-${d.pantalla.plantilla}${p.orientacion === "vertical" ? " vertical" : ""}`;
  const main = $("zonas");
  main.innerHTML = Object.keys(p.zonas).map((k) => `<section class="zona z-${k}" style="grid-area:${k}" data-zona="${k}"></section>`).join("");

  // primero los que siguen a la zona principal (cola, fuentes), después los rotadores
  const seguidores = [];
  const el = (k) => main.querySelector(`[data-zona="${k}"]`);
  for (const k of Object.keys(p.zonas)) {
    const tipo = d.pantalla.zonas[k];
    if (tipo === "cola") seguidores.push(cola(el(k)));
    if (tipo === "fuentes") seguidores.push(fuentes(el(k)));
    if (tipo === "titulares") controladores.push(titulares(el(k)));
  }
  controladores.push(...seguidores);
  Object.keys(p.zonas).forEach((k, n) => {
    const tipo = d.pantalla.zonas[k];
    if (!["mixto", "noticias", "avisos"].includes(tipo)) return;
    const esPrincipal = k === "principal" || k === "z1";
    // en la cuadrícula cada zona arranca en otro punto (su número) para no mostrar lo mismo a la vez
    controladores.push(rotador(el(k), tipo, n, esPrincipal ? (a, s, ms) => seguidores.forEach((f) => f.alCambiar(a, s, ms)) : null));
  });
}

// ---------- marca, estado, urgente ----------
function colorSobre(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.5 ? "#000000" : "#FFFFFF";
}

function pintarMarca(m) {
  document.documentElement.style.setProperty("--color-accent", m.acento);
  document.documentElement.style.setProperty("--color-on-accent", colorSobre(m.acento));
  $("nombre").textContent = m.nombre;
  document.title = m.nombre;
  const actual = $("marca").querySelector("img, svg");
  const logo = medio(m.logo);
  if (logo && !(actual.tagName === "IMG" && actual.getAttribute("src") === logo)) {
    const img = document.createElement("img");
    img.src = logo;
    img.alt = "";
    actual.replaceWith(img);
  }
}

function pintarEstado() {
  if (!datos) return;
  const ok = datos.fuentes.filter((f) => f.ok).length;
  const total = datos.fuentes.length;
  const ultima = datos.fuentes.map((f) => f.actualizado).filter(Boolean).sort().pop();
  let txt, clase;
  if (!servidorOk) {
    txt = `Sin conexión con el servidor · mostrando copia de las ${copiaDe ? hora(new Date(copiaDe)) : "—"}`;
    clase = "error";
  } else if (total && ok < total) {
    txt = `Actualizado ${ultima ? hora(new Date(ultima)) : "—"} · ${ok} de ${total} fuentes en línea`;
    clase = ok ? "aviso" : "error";
  } else {
    txt = total ? `Actualizado ${ultima ? hora(new Date(ultima)) : "—"} · ${total} fuentes` : "En línea";
    clase = "";
  }
  $("estado").textContent = txt;
  $("punto").className = "punto " + clase;
}

function pintarUrgente(u) {
  const el = $("urgente");
  el.className = u ? "ver " + u.color : "";
  if (u) {
    $("urgente-titulo").textContent = u.titulo;
    $("urgente-texto").textContent = u.texto;
  }
}

// ---------- datos ----------
function aplicar(nuevos) {
  const cambio = !datos || nuevos.version !== datos.version;
  datos = nuevos;
  pintarEstado();
  if (!cambio) return;
  pintarMarca(datos.marca);
  pintarUrgente(datos.urgente);
  const firma = JSON.stringify(datos.pantalla);
  if (firma !== firmaPlantilla) {
    firmaPlantilla = firma;
    construir(datos);
  }
  controladores.forEach((c) => c.actualizar && c.actualizar(datos));
}

const urlPantalla = () => new URL(`api/pantalla?p=${encodeURIComponent(PANTALLA)}${EXTRA}`, document.baseURI);

// Demo estática: misma respuesta que daría el servidor, calculada en el navegador
async function respuestaDemo() {
  const b = await datosBase();
  return respuestaPantalla(configDemo(b), b.cache, PANTALLA);
}

async function consultar() {
  try {
    if (ESTATICO) {
      servidorOk = true;
      copiaDe = null;
      return aplicar(await respuestaDemo());
    }
    const r = await fetch(urlPantalla(), { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    const nuevos = await r.json();
    if (r.headers.get("X-Copia")) {
      // respondió el service worker con la copia guardada: el servidor no está
      servidorOk = false;
      copiaDe = Date.parse(nuevos.generado) || Date.now();
      if (!datos) aplicar(nuevos);
      return pintarEstado();
    }
    servidorOk = true;
    copiaDe = null;
    try {
      localStorage.setItem(CLAVE_COPIA, JSON.stringify({ t: Date.now(), datos: nuevos }));
    } catch {}
    aplicar(nuevos);
  } catch {
    servidorOk = false;
    if (!datos) {
      try {
        const copia = JSON.parse(localStorage.getItem(CLAVE_COPIA));
        if (copia) {
          copiaDe = copia.t;
          aplicar(copia.datos);
        }
      } catch {}
    } else if (!copiaDe) {
      copiaDe = Date.now();
    }
    pintarEstado();
  }
}

// ---------- arranque ----------
function reloj() {
  const d = new Date();
  $("hora").textContent = hora(d);
  const f = d.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
  $("fecha").textContent = f[0].toUpperCase() + f.slice(1);
}
reloj();
setInterval(reloj, 1000);

consultar();
setInterval(consultar, CONSULTA_MS);
// en la demo, un cambio guardado en el admin (otra pestaña del mismo navegador) se ve al instante
if (ESTATICO) addEventListener("storage", (e) => e.key === CLAVE_DEMO && consultar());

// Recarga diaria para no acumular memoria, solo si el servidor responde
// (si no responde, recargar dejaría la TV en blanco donde no hay service worker).
setInterval(async () => {
  if (performance.now() < 24 * 3600 * 1000) return;
  try {
    const r = await fetch(ESTATICO ? new URL("datos.json", document.baseURI) : urlPantalla(), { cache: "no-store" });
    if (r.ok && !r.headers.get("X-Copia")) location.reload();
  } catch {}
}, 10 * 60 * 1000);

if (!ESTATICO && "serviceWorker" in navigator && isSecureContext) navigator.serviceWorker.register("sw.js").catch(() => {});
