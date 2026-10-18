// Panel de administración: elige fuentes, destaca u oculta notas y ajusta el ritmo.
// Cada cambio se guarda en el servidor al momento; la TV lo toma en su próxima consulta.
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fechaHora = (iso) => (iso ? new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short", hourCycle: "h23" }) : "—");

  let estado = null; // { config, fuentes, notas, pantalla }
  let feedProbado = null;

  // ---------- API ----------
  async function api(metodo, ruta, cuerpo) {
    const r = await fetch(ruta, {
      method: metodo,
      headers: cuerpo ? { "Content-Type": "application/json" } : {},
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
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

  let avisoT;
  function avisar(txt, mal) {
    const a = $("aviso");
    a.textContent = txt;
    a.className = "aviso-flotante ver" + (mal ? " mal" : "");
    clearTimeout(avisoT);
    avisoT = setTimeout(() => (a.className = "aviso-flotante"), 2600);
  }

  async function guardar(cambios, mensaje = "Guardado. La TV lo toma en menos de un minuto.") {
    try {
      const r = await api("PUT", "/api/admin/config", { ...estado.config, ...cambios });
      estado.config = r.config;
      await cargar();
      avisar(mensaje);
    } catch (e) {
      avisar(e.message, true);
    }
  }

  // ---------- vistas ----------
  function mostrarLogin() {
    $("vista-app").hidden = true;
    $("vista-login").hidden = false;
    $("clave").focus();
  }

  // conAjustes=false en el refresco periódico, para no pisar un formulario a medio editar
  async function cargar(conAjustes = true) {
    estado = await api("GET", "/api/admin/estado");
    $("vista-login").hidden = true;
    $("vista-app").hidden = false;
    pintarEstado();
    pintarFuentes();
    pintarNotas();
    if (conAjustes) pintarAjustes();
  }

  function pintarEstado() {
    const p = estado.pantalla;
    const ok = estado.fuentes.filter((f) => f.ok).length;
    const activas = estado.config.fuentes.filter((f) => f.activa).length;
    const ultima = estado.fuentes.map((f) => f.actualizado).filter(Boolean).sort().pop();
    $("datos-estado").innerHTML = [
      ["Noticias en rotación", p.noticias.length],
      ["Destacadas", estado.config.destacadas.length],
      ["Fuentes activas", `${activas}`],
      ["Respondiendo", `${ok}/${estado.config.fuentes.length}`],
      ["Última actualización", ultima ? new Date(ultima).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false }) : "—"],
      ["Vuelta completa", `${Math.round((p.noticias.length * estado.config.segundos) / 60)} min`],
    ].map(([t, v]) => `<div class="dato"><span class="muted">${t}</span><b>${esc(v)}</b></div>`).join("");
  }

  function pintarFuentes() {
    const porId = Object.fromEntries(estado.fuentes.map((f) => [f.id, f]));
    $("tabla-fuentes").innerHTML = estado.config.fuentes.map((f, i) => {
      const e = porId[f.id] || {};
      const st = e.ok ? `<span class="estado-f">${e.notas} notas · ${fechaHora(e.actualizado)}</span>`
        : e.error ? `<span class="estado-f mal" title="${esc(e.error)}">Sin respuesta${e.notas ? ` · usa copia (${e.notas})` : ""}</span>`
        : `<span class="estado-f nada">Pendiente</span>`;
      return `<tr>
        <td><input type="checkbox" data-activa="${i}" ${f.activa ? "checked" : ""} aria-label="Mostrar ${esc(f.nombre)} en la TV"></td>
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

  function pintarNotas() {
    const q = $("buscar").value.trim().toLowerCase();
    const fuente = $("filtro-fuente").value;
    const verOcultas = $("ver-ocultas").checked;
    const enPantalla = new Set(estado.pantalla.noticias.map((n) => n.id));
    // las destacadas que ya no están en ningún feed también se listan
    const ids = new Set(estado.notas.map((n) => n.id));
    const lista = [...estado.config.destacadas.filter((n) => !ids.has(n.id)).map((n) => ({ ...n, destacada: true, oculta: false })), ...estado.notas]
      .filter((n) => (!fuente || n.fuenteId === fuente) && (!q || n.titulo.toLowerCase().includes(q)) && (verOcultas || !n.oculta));

    $("lista-notas").innerHTML = lista.length
      ? lista.slice(0, 300).map((n) => {
          const badges = [
            n.destacada && `<span class="badge d">Destacada</span>`,
            n.oculta && `<span class="badge o">Oculta</span>`,
            !n.oculta && n.filtrada && `<span class="badge f">Excluida por palabra</span>`,
            !n.oculta && !n.filtrada && enPantalla.has(n.id) && `<span class="badge">En la TV</span>`,
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

  function pintarAjustes() {
    const c = estado.config;
    $("a-titulo").value = c.titulo;
    $("a-segundos").value = c.segundos;
    $("a-horas").value = c.horas;
    $("a-porfuente").value = c.porFuente;
    $("a-excluir").value = c.excluir.join("\n");
    $("a-solo").checked = c.soloDestacadas;
  }

  // ---------- eventos ----------
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

  $("tabla-fuentes").addEventListener("change", (e) => {
    const i = e.target.dataset.activa;
    if (i === undefined) return;
    const fuentes = estado.config.fuentes.map((f, k) => (k == i ? { ...f, activa: e.target.checked } : f));
    guardar({ fuentes });
  });

  $("tabla-fuentes").addEventListener("click", (e) => {
    const i = e.target.dataset.quitar;
    if (i === undefined) return;
    const f = estado.config.fuentes[i];
    if (!confirm(`¿Quitar ${f.nombre} de la lista de fuentes?`)) return;
    guardar({ fuentes: estado.config.fuentes.filter((_, k) => k != i) }, `${f.nombre} quitada.`);
  });

  $("refrescar").addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Actualizando…";
    try {
      await api("POST", "/api/admin/refrescar");
      await cargar();
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
    const id = nombre.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) + "-" + Math.random().toString(36).slice(2, 6);
    await guardar({ fuentes: [...estado.config.fuentes, { id, nombre, url, activa: true }] }, `${nombre} agregada. Trayendo sus noticias…`);
    $("form-fuente").reset();
    $("agregar").disabled = true;
    $("resultado-prueba").textContent = "";
    feedProbado = null;
    setTimeout(() => cargar().catch(() => {}), 6000); // el servidor baja el feed nuevo en segundo plano
  });

  $("lista-notas").addEventListener("click", (e) => {
    const d = e.target.dataset;
    const c = estado.config;
    if (d.destacar) {
      const ya = c.destacadas.some((n) => n.id === d.destacar);
      const nota = estado.notas.find((n) => n.id === d.destacar);
      const destacadas = ya ? c.destacadas.filter((n) => n.id !== d.destacar) : [...c.destacadas, nota];
      guardar({ destacadas }, ya ? "Ya no está destacada." : "Destacada: sale primero en la rotación.");
    } else if (d.ocultar) {
      const ya = c.ocultas.includes(d.ocultar);
      guardar({ ocultas: ya ? c.ocultas.filter((x) => x !== d.ocultar) : [...c.ocultas, d.ocultar] }, ya ? "Vuelve a mostrarse en la TV." : "Oculta: no sale más en la TV.");
    }
  });

  ["buscar", "filtro-fuente", "ver-ocultas"].forEach((id) => $(id).addEventListener("input", pintarNotas));

  $("form-ajustes").addEventListener("submit", (e) => {
    e.preventDefault();
    guardar({
      titulo: $("a-titulo").value,
      segundos: +$("a-segundos").value,
      horas: +$("a-horas").value,
      porFuente: +$("a-porfuente").value,
      excluir: $("a-excluir").value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
      soloDestacadas: $("a-solo").checked,
    }, "Ajustes guardados.");
  });

  // vista previa de la TV escalada al ancho disponible
  function escalarVista() {
    const v = $("vista");
    v.querySelector("iframe").style.transform = `scale(${v.clientWidth / 1920})`;
  }
  new ResizeObserver(escalarVista).observe($("vista"));

  // ---------- arranque ----------
  cargar().catch(() => mostrarLogin());
  setInterval(() => !$("vista-app").hidden && document.visibilityState === "visible" && cargar(false).catch(() => {}), 60000);
})();
