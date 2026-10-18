// Núcleo compartido de los bocetos de estilo (los 4 diseños que se compararon antes de elegir el Tablero).
// Cada boceto solo dibuja; los datos salen de acá.
//   - Servido por IO Display (/bocetos/...): usa /api/pantalla, la misma lista curada que ven las TVs.
//   - Abierto suelto desde el disco: baja los RSS por rss2json (respaldo parcial: no siempre responden todos).
(function () {
  "use strict";

  const FUENTES = window.FUENTES_IT || [];
  const CLAVE_CACHE = "io-display:bocetos:v1";
  const POR_FUENTE = 6;
  const MAX_HORAS = 72;
  const REFRESCO_MS = 15 * 60 * 1000;
  const RECARGA_DIARIA_MS = 24 * 60 * 60 * 1000;

  // ---------- utilidades ----------
  const textoPlano = (html) => {
    if (!html) return "";
    const d = new DOMParser().parseFromString(html, "text/html");
    return (d.body.textContent || "").replace(/\s+/g, " ").trim();
  };

  const recortar = (txt, max) => {
    if (txt.length <= max) return txt;
    const corte = txt.slice(0, max);
    const i = corte.lastIndexOf(" ");
    return (i > max * 0.6 ? corte.slice(0, i) : corte) + "…";
  };

  const primeraImagen = (html) => {
    const m = (html || "").match(/<img[^>]+src=["']([^"']+)["']/i);
    return m ? m[1] : "";
  };

  const sitioDe = (url) => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch (e) {
      return "";
    }
  };

  // ---------- orden: intercalado por medio ----------
  function ordenar(todas) {
    const vistos = new Set();
    const limite = Date.now() - MAX_HORAS * 3600 * 1000;
    const porFuente = {};
    todas
      .filter((n) => n.titulo && !vistos.has(n.id) && vistos.add(n.id))
      .sort((a, b) => b.fecha - a.fecha)
      .forEach((n) => (porFuente[n.fuenteId] ||= []).push(n));
    for (const k in porFuente) {
      const recientes = porFuente[k].filter((n) => n.fecha >= limite);
      porFuente[k] = (recientes.length ? recientes : porFuente[k].slice(0, 2)).slice(0, POR_FUENTE);
    }
    const recientes = Object.values(porFuente).flat().sort((a, b) => b.fecha - a.fecha);
    const rotacion = [];
    const colas = Object.values(porFuente).map((l) => [...l]);
    while (colas.some((c) => c.length)) colas.forEach((c) => c.length && rotacion.push(c.shift()));
    return { recientes, rotacion };
  }

  // ---------- origen 1: el servidor de IO Display ----------
  async function desdeServidor() {
    const r = await fetch("/api/pantalla?vista=1", { cache: "no-store" });
    if (!r.ok) throw new Error("servidor " + r.status);
    const d = await r.json();
    const rotacion = d.noticias.map((n) => ({ ...n, fecha: n.fecha ? new Date(n.fecha) : new Date(), sitio: sitioDe(n.link) }));
    const recientes = [...rotacion].sort((a, b) => b.fecha - a.fecha);
    const caidas = d.fuentes.filter((f) => !f.ok).length;
    return { recientes, rotacion, origen: "vivo", caidas, total: d.fuentes.length, fuentes: d.fuentes.map((f) => ({ id: f.id, nombre: f.nombre })) };
  }

  // ---------- origen 2: rss2json (sin servidor) ----------
  function armar(fuente, it) {
    const fecha = it.pubDate ? new Date(it.pubDate.replace(" ", "T") + "Z") : new Date();
    const titulo = textoPlano(it.title);
    let resumen = recortar(textoPlano(it.description || it.content), 240);
    if (resumen.startsWith(titulo)) resumen = resumen.slice(titulo.length).trim();
    const imagen = it.thumbnail || (it.enclosure && it.enclosure.link) || primeraImagen(it.content);
    return {
      id: it.link || titulo, titulo, resumen, link: it.link,
      imagen: /^https:/.test(imagen || "") ? imagen : "",
      fecha: isNaN(fecha) ? new Date() : fecha,
      fuente: fuente.nombre, fuenteId: fuente.id, sitio: fuente.sitio,
    };
  }

  async function desdeRss2json() {
    const res = await Promise.allSettled(
      FUENTES.map(async (f) => {
        const j = await (await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(f.url)}`)).json();
        if (j.status !== "ok") throw new Error(f.nombre);
        return j.items.map((it) => armar(f, it));
      })
    );
    const ok = res.filter((r) => r.status === "fulfilled").flatMap((r) => r.value);
    if (!ok.length) throw new Error("sin fuentes");
    const caidas = res.filter((r) => r.status === "rejected").length;
    return { ...ordenar(ok), origen: "vivo", caidas, total: FUENTES.length, fuentes: FUENTES };
  }

  const guardarCache = (d) => {
    try {
      localStorage.setItem(CLAVE_CACHE, JSON.stringify({ t: Date.now(), d }));
    } catch (e) {}
  };
  const leerCache = () => {
    try {
      const c = JSON.parse(localStorage.getItem(CLAVE_CACHE));
      if (!c) return null;
      const fechas = (l) => l.map((n) => ({ ...n, fecha: new Date(n.fecha) }));
      return { ...c.d, recientes: fechas(c.d.recientes), rotacion: fechas(c.d.rotacion), origen: "cache" };
    } catch (e) {
      return null;
    }
  };

  async function cargar() {
    for (const origen of [desdeServidor, desdeRss2json]) {
      try {
        const d = await origen();
        guardarCache(d);
        return d;
      } catch (e) {}
    }
    const cache = leerCache();
    if (cache) return cache;
    return {
      recientes: [], rotacion: [{ id: "demo", titulo: "Sin conexión a las fuentes", resumen: "Se reintenta cada 15 minutos.", link: "", imagen: "", fecha: new Date(), fuente: "Modo demostración", fuenteId: "", sitio: "" }],
      origen: "demo", caidas: FUENTES.length, total: FUENTES.length, fuentes: FUENTES,
    };
  }

  // ---------- helpers de presentación ----------
  function haceCuanto(fecha) {
    const min = Math.max(0, Math.round((Date.now() - fecha) / 60000));
    if (min < 1) return "recién";
    if (min < 60) return `hace ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `hace ${h} h`;
    const d = Math.round(h / 24);
    return d === 1 ? "ayer" : `hace ${d} días`;
  }

  const fmtHora = (d) => d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
  const fmtFecha = (d) => d.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });

  function linkCorto(url) {
    try {
      const u = new URL(url);
      const camino = u.pathname.split("/").filter(Boolean).slice(-1)[0] || "";
      return u.hostname.replace(/^www\./, "") + (camino ? "/…/" + recortar(camino, 38) : "");
    } catch (e) {
      return "";
    }
  }

  function qrSVG(url, opciones = {}) {
    if (!url || typeof qrcode !== "function") return "";
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    const n = qr.getModuleCount();
    const c = opciones.color || "#000";
    let p = "";
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) p += `M${x} ${y}h1v1h-1z`;
    return `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges" aria-label="Código QR de la nota"><path d="${p}" fill="${c}"/></svg>`;
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const reducirMovimiento = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- ciclo de vida ----------
  // iniciar({ alCargar(datos), alRotar(nota, indice, datos), cadaMs })
  function iniciar({ alCargar, alRotar, cadaMs = 14000 }) {
    let datos = null;
    let i = 0;
    const paso = () => {
      if (!datos || !datos.rotacion.length) return;
      i = i % datos.rotacion.length;
      alRotar && alRotar(datos.rotacion[i], i, datos);
      i++;
    };
    const refrescar = async () => {
      const primeraVez = !datos;
      datos = await cargar();
      alCargar && alCargar(datos);
      if (primeraVez) {
        paso();
        setInterval(paso, cadaMs);
      }
    };
    refrescar();
    setInterval(refrescar, REFRESCO_MS);
    setTimeout(() => location.reload(), RECARGA_DIARIA_MS);
    addEventListener("online", refrescar);
  }

  function reloj(fn) {
    fn(new Date());
    setInterval(() => fn(new Date()), 1000);
  }

  window.PantallaIT = { iniciar, reloj, haceCuanto, fmtHora, fmtFecha, linkCorto, qrSVG, esc, recortar, reducirMovimiento, FUENTES };
})();
