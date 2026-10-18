// Panel de administración de IO Display: pantallas y plantillas, avisos propios, noticias RSS,
// marca y mensaje urgente. Cada cambio se guarda en el servidor al momento; las TVs lo toman
// en su próxima consulta.
import { PLANTILLAS, TIPOS, zonasPorDefecto } from "/plantillas.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fechaHora = (iso) => (iso ? new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short", hourCycle: "h23" }) : "—");
const horaCorta = (iso) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);

let estado = null; // { config, fuentes, notas, pantallas, pantalla, red }
let feedProbado = null;
let avisoEditando = null; // id del aviso en edición, o "" si es nuevo
let imagenAviso = "";

// ---------- API ----------
async function api(metodo, ruta, cuerpo, tipo = "application/json") {
  const r = await fetch(ruta, {
    method: metodo,
    headers: cuerpo ? { "Content-Type": tipo } : {},
    body: cuerpo ? (tipo === "application/json" ? JSON.stringify(cuerpo) : cuerpo) : undefined,
    credentials: "same-origin",
  });
  if (r.status === 401 && ruta !== "/api/login") {
    mostrarLogin();
    throw new Error("Sesión vencida");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Error " + r.status);
  return j;
}

const subirImagen = async (archivo) => (await api("POST", "/api/admin/medios", archivo, archivo.type || "application/octet-stream")).url;

let avisoT;
function avisar(txt, mal) {
  const a = $("aviso");
  a.textContent = txt;
  a.className = "aviso-flotante ver" + (mal ? " mal" : "");
  clearTimeout(avisoT);
  avisoT = setTimeout(() => (a.className = "aviso-flotante"), 2800);
}

async function guardar(cambios, mensaje = "Guardado. Las pantallas lo toman en menos de medio minuto.", { repintarPantallas = false } = {}) {
  try {
    const r = await api("PUT", "/api/admin/config", { ...estado.config, ...cambios });
    estado.config = r.config;
    await cargar({ repintarPantallas, conFormularios: false });
    avisar(mensaje);
    return true;
  } catch (e) {
    avisar(e.message, true);
    return false;
  }
}

// ---------- carga y vistas ----------
function mostrarLogin() {
  $("vista-app").hidden = true;
  $("vista-login").hidden = false;
  $("clave").focus();
}

async function cargar({ repintarPantallas = true, conFormularios = true } = {}) {
  estado = await api("GET", "/api/admin/estado");
  $("vista-login").hidden = true;
  $("vista-app").hidden = false;
  pintarEstado();
  if (repintarPantallas) pintarPantallas();
  else actualizarEstadoPantallas();
  pintarAvisos();
  pintarFuentes();
  pintarNotas();
  if (conFormularios) {
    pintarAjustes();
    pintarUrgente();
  }
}

const enLinea = (visto) => visto && Date.now() - Date.parse(visto) < 75 * 1000;

function pintarEstado() {
  const c = estado.config;
  const conectadas = estado.pantallas.filter((p) => enLinea(p.visto)).length;
  const ok = estado.fuentes.filter((f) => f.ok).length;
  const vigentes = c.avisos.filter((a) => situacionAviso(a).clase === "si").length;
  $("datos-estado").innerHTML = [
    ["Pantallas en línea", `${conectadas}/${c.pantallas.length}`],
    ["Avisos vigentes", `${vigentes}/${c.avisos.length}`],
    ["Noticias en rotación", estado.pantalla.noticias.length],
    ["Fuentes respondiendo", `${ok}/${c.fuentes.length}`],
  ].map(([t, v]) => `<div class="dato"><span class="muted">${t}</span><b>${esc(v)}</b></div>`).join("");

  const p = c.pantallas[0];
  $("vista-nombre").textContent = p.nombre;
  prepararVista($("vista"), p);
}

function pintarUrgente() {
  const u = estado.config.urgente;
  $("u-titulo").value = u.titulo;
  $("u-texto").value = u.texto;
  $("u-color").value = u.color;
  $("form-urgente").classList.toggle("urgente-activo", u.activo);
  $("u-quitar").hidden = !u.activo;
  $("u-mostrar").textContent = u.activo ? "Actualizar el mensaje" : "Mostrar en todas las pantallas";
}

// iframe de vista previa escalado al ancho disponible
const observador = new ResizeObserver((entradas) => entradas.forEach((e) => escalar(e.target)));
function prepararVista(caja, pantalla) {
  const vertical = PLANTILLAS[pantalla.plantilla]?.orientacion === "vertical";
  caja.classList.toggle("vertical", vertical);
  const f = caja.querySelector("iframe");
  const src = `/tv/${pantalla.id}?vista=1`;
  if (f.getAttribute("src") !== src) f.setAttribute("src", src);
  f.dataset.w = vertical ? 1080 : 1920;
  f.dataset.h = vertical ? 1920 : 1080;
  escalar(caja);
  observador.observe(caja);
}
function escalar(caja) {
  const f = caja.querySelector("iframe");
  if (!f || !caja.clientWidth) return;
  f.style.width = f.dataset.w + "px";
  f.style.height = f.dataset.h + "px";
  f.style.transform = `scale(${caja.clientWidth / f.dataset.w})`;
}

// ---------- pantallas ----------
const MINIS = {
  // comillas simples: el valor va dentro de un atributo style="..."
  tablero: { t: "'a b' 3fr 'c c' 1fr / 3fr 1fr", z: ["a", "b", "c"] },
  completa: { t: "'a' 1fr / 1fr", z: ["a"] },
  "principal-barra": { t: "'a' 4fr 'b' 1fr / 1fr", z: ["a", "b"] },
  cuadricula: { t: "'a b' 1fr 'c d' 1fr / 1fr 1fr", z: ["a", "b", "c", "d"] },
  vertical: { t: "'a' 5fr 'b' 4fr 'c' 1fr / 1fr", z: ["a", "b", "c"] },
};
const mini = (k) => `<span class="mini ${PLANTILLAS[k].orientacion === "vertical" ? "vertical" : ""}" style="grid-template:${MINIS[k].t}">${MINIS[k].z.map((z, i) => `<i class="${i ? "" : "p"}" style="grid-area:${z}"></i>`).join("")}</span>`;

function direccionTV(id) {
  const base = estado.red[0] || location.origin;
  return `${base}/tv/${id}`;
}

function textoEstadoTV(visto) {
  if (enLinea(visto)) return ["ok", "En línea"];
  if (visto) return ["mal", `Sin señal desde ${fechaHora(visto)}`];
  return ["", "Todavía no se conectó"];
}

function pintarPantallas() {
  const c = estado.config;
  const vistos = Object.fromEntries(estado.pantallas.map((p) => [p.id, p.visto]));
  $("lista-pantallas").innerHTML = c.pantallas.map((p, i) => {
    const [cls, txt] = textoEstadoTV(vistos[p.id]);
    const pl = PLANTILLAS[p.plantilla];
    return `<article class="tarjeta pantalla" data-i="${i}">
      <div>
        <div class="fila-botones" style="justify-content:space-between"><h3 style="margin:0">${esc(p.nombre)}</h3><span class="estado-tv ${cls}" data-estado="${esc(p.id)}">${txt}</span></div>
        <div class="direccion"><code>${esc(direccionTV(p.id))}</code><button type="button" class="chico" data-copiar="${esc(direccionTV(p.id))}">Copiar</button><a class="boton chico" href="/tv/${esc(p.id)}?vista=1" target="_blank" rel="noopener">Abrir ↗</a></div>
        <label for="pn-${i}">Nombre</label>
        <input id="pn-${i}" data-nombre="${i}" value="${esc(p.nombre)}" maxlength="40" style="margin-bottom:16px">
        <fieldset style="border:0;padding:0"><legend style="font-weight:500;margin-bottom:6px">Plantilla</legend>
          <div class="plantillas">${Object.keys(PLANTILLAS).map((k) => `<label title="${esc(PLANTILLAS[k].descripcion)}"><input type="radio" name="pl-${i}" value="${k}" data-plantilla="${i}" ${k === p.plantilla ? "checked" : ""}>${mini(k)}${esc(PLANTILLAS[k].nombre)}</label>`).join("")}</div>
        </fieldset>
        <div class="zonas-config">${Object.entries(pl.zonas).map(([k, z]) => `<div><label for="z-${i}-${k}">${esc(z.nombre)}</label><select id="z-${i}-${k}" data-zona="${i}" data-z="${k}">${z.tipos.map((t) => `<option value="${t}" ${p.zonas[k] === t ? "selected" : ""}>${esc(TIPOS[t].nombre)}</option>`).join("")}</select></div>`).join("")}</div>
        ${c.pantallas.length > 1 ? `<p style="margin-top:16px"><button type="button" class="chico peligro" data-borrar="${i}">Eliminar pantalla</button></p>` : ""}
      </div>
      <div><div class="vista"><iframe title="Vista previa de ${esc(p.nombre)}" tabindex="-1"></iframe></div><p class="ayuda">Vista previa en vivo.</p></div>
    </article>`;
  }).join("");
  document.querySelectorAll("#lista-pantallas .pantalla").forEach((el) => prepararVista(el.querySelector(".vista"), c.pantallas[el.dataset.i]));
}

function actualizarEstadoPantallas() {
  estado.pantallas.forEach((p) => {
    const el = document.querySelector(`[data-estado="${CSS.escape(p.id)}"]`);
    if (!el) return;
    const [cls, txt] = textoEstadoTV(p.visto);
    el.className = "estado-tv " + cls;
    el.textContent = txt;
  });
}

function cambiarPantalla(i, cambio, mensaje, repintar = false) {
  const pantallas = estado.config.pantallas.map((p, k) => (k == i ? { ...p, ...cambio } : p));
  return guardar({ pantallas }, mensaje, { repintarPantallas: repintar });
}

$("lista-pantallas").addEventListener("change", (e) => {
  const d = e.target.dataset;
  if (d.plantilla !== undefined) {
    const plantilla = e.target.value;
    cambiarPantalla(d.plantilla, { plantilla, zonas: zonasPorDefecto(plantilla) }, `Plantilla: ${PLANTILLAS[plantilla].nombre}.`, true);
  } else if (d.zona !== undefined) {
    const p = estado.config.pantallas[d.zona];
    cambiarPantalla(d.zona, { zonas: { ...p.zonas, [d.z]: e.target.value } }, "Zona actualizada.");
  } else if (d.nombre !== undefined) {
    const nombre = e.target.value.trim();
    if (nombre) cambiarPantalla(d.nombre, { nombre }, "Nombre guardado.", true);
  }
});

$("lista-pantallas").addEventListener("click", async (e) => {
  const d = e.target.dataset;
  if (d.copiar) {
    try {
      await navigator.clipboard.writeText(d.copiar);
      avisar("Dirección copiada.");
    } catch {
      avisar("No se pudo copiar: seleccioná la dirección a mano.", true);
    }
  } else if (d.borrar !== undefined) {
    const p = estado.config.pantallas[d.borrar];
    if (!confirm(`¿Eliminar la pantalla "${p.nombre}"? La TV que la use va a mostrar la principal.`)) return;
    guardar({ pantallas: estado.config.pantallas.filter((_, k) => k != d.borrar) }, `${p.nombre} eliminada.`, { repintarPantallas: true });
  }
});

$("form-nueva-pantalla").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nombre = $("np-nombre").value.trim();
  let id = slug(nombre) || "pantalla";
  const usados = new Set(estado.config.pantallas.map((p) => p.id));
  for (let n = 2; usados.has(id); n++) id = `${slug(nombre)}-${n}`;
  if (await guardar({ pantallas: [...estado.config.pantallas, { id, nombre, plantilla: "tablero", zonas: zonasPorDefecto("tablero") }] }, `${nombre} agregada. Abrí su dirección en la TV.`, { repintarPantallas: true })) {
    $("np-nombre").value = "";
  }
});

// ---------- avisos ----------
const hoyLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Misma regla que el servidor, para mostrar el estado en la lista
function situacionAviso(a) {
  if (!a.activo) return { clase: "no", txt: "Pausado" };
  const hoy = hoyLocal();
  if (a.hasta && hoy > a.hasta) return { clase: "no", txt: "Vencido" };
  if (a.desde && hoy < a.desde) return { clase: "prog", txt: `Desde el ${a.desde.split("-").reverse().join("/")}` };
  if (a.horaDesde && a.horaHasta) {
    const ahora = new Date();
    const m = ahora.getHours() * 60 + ahora.getMinutes();
    const [ini, fin] = [a.horaDesde, a.horaHasta].map((h) => +h.slice(0, 2) * 60 + +h.slice(3));
    const dentro = ini <= fin ? m >= ini && m < fin : m >= ini || m < fin;
    if (!dentro) return { clase: "prog", txt: `De ${a.horaDesde} a ${a.horaHasta}` };
  }
  return { clase: "si", txt: "En pantalla" };
}

function pintarAvisos() {
  const c = estado.config;
  const nombres = Object.fromEntries(c.pantallas.map((p) => [p.id, p.nombre]));
  $("lista-avisos").innerHTML = c.avisos.length
    ? c.avisos.map((a) => {
        const s = situacionAviso(a);
        const vigencia = [a.desde && `desde ${a.desde.split("-").reverse().join("/")}`, a.hasta && `hasta ${a.hasta.split("-").reverse().join("/")}`, a.horaDesde && a.horaHasta && `de ${a.horaDesde} a ${a.horaHasta}`].filter(Boolean).join(" · ") || "Sin vencimiento";
        const donde = a.pantallas.length ? a.pantallas.map((id) => nombres[id]).join(", ") : "Todas las pantallas";
        return `<div class="aviso">
          <div class="mini-img" style="${a.imagen ? `background-image:url('${esc(a.imagen)}')` : ""}">${a.imagen ? "" : "Sin imagen"}</div>
          <div>
            <div style="font-weight:500">${esc(a.titulo || "(sin título, solo imagen)")}</div>
            <div class="meta"><span class="badge ${s.clase}">${esc(s.txt)}</span>${a.formato === "afiche" ? `<span class="badge">Afiche</span>` : ""}<span>${esc(vigencia)}</span><span>${esc(donde)}</span><span>${a.segundos} s</span>${a.link ? `<span>Con QR</span>` : ""}</div>
          </div>
          <div class="acciones">
            <button type="button" class="chico" data-editar="${esc(a.id)}">Editar</button>
            <button type="button" class="chico" data-pausar="${esc(a.id)}">${a.activo ? "Pausar" : "Activar"}</button>
            <button type="button" class="chico peligro" data-eliminar="${esc(a.id)}">Eliminar</button>
          </div>
        </div>`;
      }).join("")
    : `<p class="muted">Todavía no hay avisos. Creá el primero con "Nuevo aviso".</p>`;
}

function mostrarImagenAviso() {
  $("a-previa").hidden = !imagenAviso;
  $("a-quitar-img").hidden = !imagenAviso;
  $("a-previa").style.backgroundImage = imagenAviso ? `url('${imagenAviso}')` : "";
}

function abrirFormAviso(a) {
  avisoEditando = a ? a.id : "";
  imagenAviso = a?.imagen || "";
  $("titulo-form-aviso").textContent = a ? "Editar aviso" : "Nuevo aviso";
  $("a-titulo").value = a?.titulo || "";
  $("a-texto").value = a?.texto || "";
  $("a-link").value = a?.link || "";
  $("a-segundos").value = a?.segundos || 12;
  $("a-desde").value = a?.desde || "";
  $("a-hasta").value = a?.hasta || "";
  $("a-hdesde").value = a?.horaDesde || "";
  $("a-hhasta").value = a?.horaHasta || "";
  $("a-activo").checked = a ? a.activo : true;
  (a?.formato === "afiche" ? $("a-f-afiche") : $("a-f-tarjeta")).checked = true;
  $("a-archivo").value = "";
  $("a-pantallas").innerHTML = estado.config.pantallas.map((p) => `<div class="fila-check"><input type="checkbox" id="ap-${esc(p.id)}" value="${esc(p.id)}" ${a?.pantallas.includes(p.id) ? "checked" : ""}><label for="ap-${esc(p.id)}">${esc(p.nombre)}</label></div>`).join("");
  mostrarImagenAviso();
  $("form-aviso").hidden = false;
  $("a-titulo").focus();
}

$("nuevo-aviso").addEventListener("click", () => abrirFormAviso(null));
$("a-cancelar").addEventListener("click", () => ($("form-aviso").hidden = true));
$("a-quitar-img").addEventListener("click", () => {
  imagenAviso = "";
  $("a-archivo").value = "";
  mostrarImagenAviso();
});

$("a-archivo").addEventListener("change", async () => {
  const f = $("a-archivo").files[0];
  if (!f) return;
  if (f.size > 8 * 1024 * 1024) return avisar("La imagen supera los 8 MB.", true);
  avisar("Subiendo imagen…");
  try {
    imagenAviso = await subirImagen(f);
    mostrarImagenAviso();
    avisar("Imagen lista. Falta guardar el aviso.");
  } catch (e) {
    avisar(e.message, true);
  }
});

$("form-aviso").addEventListener("submit", async (e) => {
  e.preventDefault();
  const datos = {
    id: avisoEditando || "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    titulo: $("a-titulo").value.trim(),
    texto: $("a-texto").value.trim(),
    imagen: imagenAviso,
    link: $("a-link").value.trim(),
    formato: document.querySelector('input[name="a-formato"]:checked').value,
    segundos: +$("a-segundos").value,
    desde: $("a-desde").value,
    hasta: $("a-hasta").value,
    horaDesde: $("a-hdesde").value,
    horaHasta: $("a-hhasta").value,
    pantallas: [...$("a-pantallas").querySelectorAll("input:checked")].map((i) => i.value),
    activo: $("a-activo").checked,
  };
  if (!datos.titulo && !datos.imagen) return avisar("El aviso necesita al menos un título o una imagen.", true);
  if (datos.formato === "afiche" && !datos.imagen) return avisar("El formato afiche necesita una imagen.", true);
  if (datos.desde && datos.hasta && datos.desde > datos.hasta) return avisar("La fecha 'desde' es posterior a 'hasta'.", true);
  if (!!datos.horaDesde !== !!datos.horaHasta) return avisar("Completá las dos horas o ninguna.", true);
  const avisos = avisoEditando ? estado.config.avisos.map((a) => (a.id === avisoEditando ? datos : a)) : [datos, ...estado.config.avisos];
  if (await guardar({ avisos }, avisoEditando ? "Aviso actualizado." : "Aviso creado.")) $("form-aviso").hidden = true;
});

$("lista-avisos").addEventListener("click", (e) => {
  const d = e.target.dataset;
  const avisos = estado.config.avisos;
  if (d.editar) abrirFormAviso(avisos.find((a) => a.id === d.editar));
  else if (d.pausar) {
    const a = avisos.find((x) => x.id === d.pausar);
    guardar({ avisos: avisos.map((x) => (x.id === d.pausar ? { ...x, activo: !x.activo } : x)) }, a.activo ? "Aviso pausado." : "Aviso activado.");
  } else if (d.eliminar) {
    const a = avisos.find((x) => x.id === d.eliminar);
    if (confirm(`¿Eliminar el aviso "${a.titulo || "sin título"}"?`)) guardar({ avisos: avisos.filter((x) => x.id !== d.eliminar) }, "Aviso eliminado.");
  }
});

// ---------- urgente ----------
$("form-urgente").addEventListener("submit", (e) => {
  e.preventDefault();
  const urgente = { activo: true, titulo: $("u-titulo").value.trim(), texto: $("u-texto").value.trim(), color: $("u-color").value };
  if (!confirm("El mensaje va a tapar todas las pantallas hasta que lo quites. ¿Mostrarlo?")) return;
  guardar({ urgente }, "Mensaje urgente en todas las pantallas.").then(pintarUrgente);
});
$("u-quitar").addEventListener("click", () => guardar({ urgente: { ...estado.config.urgente, activo: false } }, "Mensaje urgente quitado.").then(pintarUrgente));

// ---------- noticias: fuentes ----------
function pintarFuentes() {
  const porId = Object.fromEntries(estado.fuentes.map((f) => [f.id, f]));
  $("tabla-fuentes").innerHTML = estado.config.fuentes.map((f, i) => {
    const e = porId[f.id] || {};
    const st = e.ok ? `<span class="estado-f">${e.notas} notas · ${fechaHora(e.actualizado)}</span>`
      : e.error ? `<span class="estado-f mal" title="${esc(e.error)}">Sin respuesta${e.notas ? ` · usa copia (${e.notas})` : ""}</span>`
      : `<span class="estado-f nada">Pendiente</span>`;
    return `<tr>
      <td><input type="checkbox" data-activa="${i}" ${f.activa ? "checked" : ""} aria-label="Usar ${esc(f.nombre)}"></td>
      <td><b>${esc(f.nombre)}</b></td>
      <td class="url mono">${esc(f.url)}</td>
      <td>${st}</td>
      <td><button class="chico" type="button" data-quitar="${i}">Quitar</button></td>
    </tr>`;
  }).join("");
  const sel = $("filtro-fuente");
  const previo = sel.value;
  sel.innerHTML = `<option value="">Todos</option>` + estado.config.fuentes.map((f) => `<option value="${esc(f.id)}">${esc(f.nombre)}</option>`).join("");
  sel.value = previo;
}

$("tabla-fuentes").addEventListener("change", (e) => {
  const i = e.target.dataset.activa;
  if (i === undefined) return;
  guardar({ fuentes: estado.config.fuentes.map((f, k) => (k == i ? { ...f, activa: e.target.checked } : f)) });
});

$("tabla-fuentes").addEventListener("click", (e) => {
  const i = e.target.dataset.quitar;
  if (i === undefined) return;
  const f = estado.config.fuentes[i];
  if (confirm(`¿Quitar ${f.nombre} de la lista de fuentes?`)) guardar({ fuentes: estado.config.fuentes.filter((_, k) => k != i) }, `${f.nombre} quitada.`);
});

$("refrescar").addEventListener("click", async (e) => {
  e.target.disabled = true;
  e.target.textContent = "Actualizando…";
  try {
    await api("POST", "/api/admin/refrescar");
    await cargar({ repintarPantallas: false, conFormularios: false });
    avisar("Noticias actualizadas.");
  } catch (err) {
    avisar(err.message, true);
  }
  e.target.disabled = false;
  e.target.textContent = "Actualizar las noticias ahora";
});

$("f-url").addEventListener("input", () => {
  feedProbado = null;
  $("agregar").disabled = true;
});

$("probar").addEventListener("click", async () => {
  const url = $("f-url").value.trim();
  const res = $("resultado-prueba");
  if (!url) return $("f-url").focus();
  res.textContent = "Probando el feed…";
  $("probar").disabled = true;
  try {
    const r = await api("POST", "/api/admin/probar-feed", { url });
    if (r.ok) {
      feedProbado = url;
      if (!$("f-nombre").value.trim()) $("f-nombre").value = (r.titulo || "").slice(0, 40);
      res.innerHTML = `✔ Funciona: <b>${esc(r.titulo || "sin título")}</b>, ${r.notas} notas. Ejemplo: “${esc(r.ejemplo)}”`;
      $("agregar").disabled = false;
    } else {
      res.textContent = "✖ No se pudo leer: " + r.error;
    }
  } catch (e) {
    res.textContent = "✖ " + e.message;
  }
  $("probar").disabled = false;
});

$("form-fuente").addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = $("f-url").value.trim();
  const nombre = $("f-nombre").value.trim();
  if (feedProbado !== url) return avisar("Probá el feed antes de agregarlo.", true);
  if (!nombre) return $("f-nombre").focus();
  if (estado.config.fuentes.some((f) => f.url === url)) return avisar("Esa fuente ya está en la lista.", true);
  const id = slug(nombre) + "-" + Math.random().toString(36).slice(2, 6);
  await guardar({ fuentes: [...estado.config.fuentes, { id, nombre, url, activa: true }] }, `${nombre} agregada. Trayendo sus noticias…`);
  $("form-fuente").reset();
  $("agregar").disabled = true;
  $("resultado-prueba").textContent = "";
  feedProbado = null;
  setTimeout(() => cargar({ repintarPantallas: false, conFormularios: false }).catch(() => {}), 6000);
});

// ---------- noticias: notas ----------
function pintarNotas() {
  const q = $("buscar").value.trim().toLowerCase();
  const fuente = $("filtro-fuente").value;
  const verOcultas = $("ver-ocultas").checked;
  const enPantalla = new Set(estado.pantalla.noticias.map((n) => n.id));
  const ids = new Set(estado.notas.map((n) => n.id));
  const lista = [...estado.config.destacadas.filter((n) => !ids.has(n.id)).map((n) => ({ ...n, destacada: true, oculta: false })), ...estado.notas]
    .filter((n) => (!fuente || n.fuenteId === fuente) && (!q || n.titulo.toLowerCase().includes(q)) && (verOcultas || !n.oculta));
  $("lista-notas").innerHTML = lista.length
    ? lista.slice(0, 300).map((n) => {
        const badges = [
          n.destacada && `<span class="badge d">Destacada</span>`,
          n.oculta && `<span class="badge o">Oculta</span>`,
          !n.oculta && n.filtrada && `<span class="badge f">Excluida por palabra</span>`,
          !n.oculta && !n.filtrada && enPantalla.has(n.id) && `<span class="badge">En rotación</span>`,
        ].filter(Boolean).join("");
        return `<div class="nota ${n.oculta ? "apagada" : ""}">
          <div>
            <div class="titulo">${esc(n.titulo)}</div>
            <div class="meta"><span>${esc(n.fuente)}</span><span>${fechaHora(n.fecha)}</span>${badges}<a href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">Abrir nota ↗</a></div>
          </div>
          <div class="acciones">
            <button class="chico" type="button" data-destacar="${esc(n.id)}" aria-pressed="${n.destacada}">${n.destacada ? "Quitar destacado" : "Destacar"}</button>
            <button class="chico" type="button" data-ocultar="${esc(n.id)}" aria-pressed="${n.oculta}">${n.oculta ? "Volver a mostrar" : "Ocultar"}</button>
          </div>
        </div>`;
      }).join("")
    : `<p class="muted">No hay notas con ese filtro.</p>`;
}

$("lista-notas").addEventListener("click", (e) => {
  const d = e.target.dataset;
  const c = estado.config;
  if (d.destacar) {
    const ya = c.destacadas.some((n) => n.id === d.destacar);
    const nota = estado.notas.find((n) => n.id === d.destacar);
    guardar({ destacadas: ya ? c.destacadas.filter((n) => n.id !== d.destacar) : [...c.destacadas, nota] }, ya ? "Ya no está destacada." : "Destacada: sale primero en la rotación.");
  } else if (d.ocultar) {
    const ya = c.ocultas.includes(d.ocultar);
    guardar({ ocultas: ya ? c.ocultas.filter((x) => x !== d.ocultar) : [...c.ocultas, d.ocultar] }, ya ? "Vuelve a mostrarse." : "Oculta: no sale más en las pantallas.");
  }
});
["buscar", "filtro-fuente", "ver-ocultas"].forEach((id) => $(id).addEventListener("input", pintarNotas));

// ---------- marca y ajustes ----------
let logo = "";
function pintarAjustes() {
  const c = estado.config;
  $("m-nombre").value = c.marca.nombre;
  $("m-acento").value = c.marca.acento;
  logo = c.marca.logo;
  mostrarLogo();
  $("r-segundos").value = c.segundos;
  $("r-intercalar").value = c.intercalar;
  $("r-horas").value = c.horas;
  $("r-porfuente").value = c.porFuente;
  $("r-excluir").value = c.excluir.join("\n");
  $("r-solo").checked = c.soloDestacadas;
}
function mostrarLogo() {
  $("m-logo-previa").hidden = !logo;
  $("m-quitar-logo").hidden = !logo;
  if (logo) $("m-logo-previa").src = logo;
}
$("m-logo").addEventListener("change", async () => {
  const f = $("m-logo").files[0];
  if (!f) return;
  try {
    logo = await subirImagen(f);
    mostrarLogo();
    avisar("Logo listo. Falta guardar.");
  } catch (e) {
    avisar(e.message, true);
  }
});
$("m-quitar-logo").addEventListener("click", () => {
  logo = "";
  $("m-logo").value = "";
  mostrarLogo();
});
$("form-ajustes").addEventListener("submit", (e) => {
  e.preventDefault();
  guardar({
    marca: { nombre: $("m-nombre").value, acento: $("m-acento").value, logo },
    segundos: +$("r-segundos").value,
    intercalar: +$("r-intercalar").value,
    horas: +$("r-horas").value,
    porFuente: +$("r-porfuente").value,
    excluir: $("r-excluir").value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
    soloDestacadas: $("r-solo").checked,
  }, "Marca y ajustes guardados.");
});

// ---------- sesión y pestañas ----------
$("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("error-login").textContent = "";
  try {
    await api("POST", "/api/login", { clave: $("clave").value });
    $("clave").value = "";
    await cargar();
  } catch (err) {
    $("error-login").textContent = err.message;
  }
});

$("salir").addEventListener("click", async () => {
  await api("POST", "/api/logout").catch(() => {});
  mostrarLogin();
});

document.querySelectorAll(".pestanas button").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll(".pestanas button").forEach((x) => x.setAttribute("aria-selected", x === b));
    document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== b.dataset.p));
  })
);

// ---------- arranque ----------
cargar().catch(() => mostrarLogin());
// refresco periódico sin pisar formularios ni recargar las vistas previas
setInterval(() => !$("vista-app").hidden && document.visibilityState === "visible" && cargar({ repintarPantallas: false, conFormularios: false }).catch(() => {}), 30000);
