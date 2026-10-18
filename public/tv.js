// Pantalla de la TV: pide al servidor la lista ya filtrada por el admin y la rota sola.
// Caché ante cortes, en dos capas:
//   1) copia en localStorage de la última lista (sirve aunque se caiga el servidor)
//   2) service worker que guarda la página (solo en localhost o https, por regla del navegador)
(function () {
  "use strict";

  const CLAVE_COPIA = "pantalla-it:ultima";
  const CONSULTA_MS = 60 * 1000; // cada cuánto pregunta si el admin cambió algo
  const $ = (id) => document.getElementById(id);
  const quieto = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let datos = null; // { version, titulo, segundos, noticias, fuentes, generado }
  let indice = 0;
  let temporizador = null;
  let servidorOk = true;
  let copiaDe = null;

  // ---------- sin interacción: la TV no se maneja ----------
  ["contextmenu", "keydown", "wheel", "touchstart", "mousedown", "dragstart"].forEach((ev) =>
    addEventListener(ev, (e) => e.preventDefault(), { passive: false, capture: true })
  );

  // ---------- utilidades ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const recortar = (t, max) => {
    if (t.length <= max) return t;
    const i = t.lastIndexOf(" ", max);
    return t.slice(0, i > max * 0.6 ? i : max) + "…";
  };
  const hora = (d) => d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });

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
    return `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges" role="img" aria-label="Código QR de la nota"><path d="${p}" fill="#000"/></svg>`;
  }

  function animar(sel, desde, opciones) {
    if (quieto) return;
    document.querySelectorAll(sel).forEach((el, k) =>
      el.animate([desde, { opacity: 1, transform: "none" }], { duration: 420, easing: "cubic-bezier(.34,1.56,.64,1)", fill: "backwards", delay: k * 70, ...opciones })
    );
  }

  // ---------- reloj ----------
  function reloj() {
    const d = new Date();
    $("hora").textContent = hora(d);
    const f = d.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
    $("fecha").textContent = f[0].toUpperCase() + f.slice(1);
  }
  reloj();
  setInterval(reloj, 1000);

  // ---------- estado ----------
  function pintarEstado() {
    if (!datos) return;
    const ok = datos.fuentes.filter((f) => f.ok).length;
    const total = datos.fuentes.length;
    const ultima = datos.fuentes.map((f) => f.actualizado).filter(Boolean).sort().pop();
    let txt, clase;
    if (!servidorOk) {
      txt = `Sin conexión con el servidor · mostrando copia de las ${copiaDe ? hora(new Date(copiaDe)) : "—"}`;
      clase = "error";
    } else if (ok < total) {
      txt = `Actualizado ${ultima ? hora(new Date(ultima)) : "—"} · ${ok} de ${total} fuentes en línea`;
      clase = ok ? "aviso" : "error";
    } else {
      txt = `Actualizado ${ultima ? hora(new Date(ultima)) : "—"} · ${total} fuentes`;
      clase = "";
    }
    $("estado").textContent = txt;
    $("punto").className = "punto " + clase;
    $("titulo").textContent = datos.titulo || "Informática hoy";
    document.title = datos.titulo || "Informática hoy";
    $("fuentes").innerHTML = datos.fuentes.map((f) => `<span data-id="${esc(f.id)}" class="${f.ok ? "" : "caida"}">${esc(f.nombre)}</span>`).join("");
  }

  // ---------- rotación ----------
  function mostrar() {
    if (!datos) return;
    const lista = datos.noticias;
    if (!lista.length) {
      $("actual").innerHTML = `<div class="vacio"><h1>No hay noticias para mostrar</h1><p>Revisá las fuentes y filtros en el panel de administración.</p></div>`;
      $("cola").innerHTML = "";
      return;
    }
    indice = indice % lista.length;
    const n = lista[indice];

    $("actual").innerHTML = `
      <div class="etiqueta">
        ${n.destacada ? `<span class="chip destacada">Destacada</span>` : ""}
        <span class="chip">${esc(n.fuente)}</span>
        <span class="chip gris mono">${haceCuanto(n.fecha)}</span>
      </div>
      <h1>${esc(n.titulo)}</h1>
      <p class="resumen">${esc(n.resumen)}</p>
      <div class="lado"><div class="img">${n.imagen ? `<img src="${esc(n.imagen)}" alt="" referrerpolicy="no-referrer">` : ""}</div></div>
      <dl class="cita">
        <div class="qr">${qrSVG(n.link)}</div>
        <div><dt>Fuente</dt><dd>${esc(n.fuente)}</dd><div class="url mono">${esc(linkCorto(n.link))}</div><div class="leer">Escaneá el código para leer la nota completa</div></div>
      </dl>`;
    const img = $("actual").querySelector("img");
    if (img) img.addEventListener("error", () => img.remove());

    const siguientes = [];
    for (let k = 1; k <= Math.min(4, lista.length - 1); k++) siguientes.push(lista[(indice + k) % lista.length]);
    $("cola").innerHTML = siguientes
      .map((s, k) => `<div class="item"><div class="q"><b>${esc(s.fuente)}</b><span class="mono">${k === 0 ? "Siguiente" : haceCuanto(s.fecha)}</span></div><p>${esc(s.titulo)}</p></div>`)
      .join("");

    document.querySelectorAll(".fuentes span").forEach((s) => s.classList.toggle("on", s.dataset.id === n.fuenteId));

    const ms = (datos.segundos || 14) * 1000;
    animar("#actual > *", { opacity: 0, transform: "translateY(16px)" });
    animar("#cola .item", { opacity: 0, transform: "translateY(16px) scale(.92)" }, { delay: 200 });
    $("barra").getAnimations().forEach((a) => a.cancel());
    $("barra").animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: ms, easing: "linear", fill: "forwards" });

    clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      indice++;
      mostrar();
    }, ms);
  }

  // ---------- datos ----------
  function aplicar(nuevos) {
    const actualId = datos && datos.noticias[indice % datos.noticias.length]?.id;
    const primeraVez = !datos;
    const cambio = !datos || nuevos.version !== datos.version;
    datos = nuevos;
    pintarEstado();
    if (primeraVez) return mostrar();
    if (cambio) {
      // seguir desde la nota que se estaba viendo, si sigue en la lista
      const pos = datos.noticias.findIndex((n) => n.id === actualId);
      indice = pos >= 0 ? pos : 0;
      if (pos < 0) mostrar(); // la sacaron desde el admin: pasar a otra ya
    }
  }

  async function consultar() {
    try {
      const r = await fetch("/api/pantalla", { cache: "no-store" });
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
    if (servidorOk) copiaDe = null;
  }

  consultar();
  setInterval(consultar, CONSULTA_MS);

  // Recarga diaria para no acumular memoria, solo si el servidor responde
  // (si no responde, recargar dejaría la TV en blanco donde no hay service worker).
  setInterval(async () => {
    if (performance.now() < 24 * 3600 * 1000) return;
    try {
      const r = await fetch("/api/pantalla", { cache: "no-store" });
      if (r.ok) location.reload();
    } catch {}
  }, 10 * 60 * 1000);

  if ("serviceWorker" in navigator && isSecureContext) navigator.serviceWorker.register("/sw.js").catch(() => {});
})();
