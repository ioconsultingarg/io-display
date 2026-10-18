// Lectura de feeds RSS 2.0 y Atom sin dependencias.
// No es un parser XML completo: alcanza para los campos que muestra la pantalla.
import { createHash } from "node:crypto";

const ENTIDADES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", uuml: "ü",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ", Uuml: "Ü",
  iquest: "¿", iexcl: "¡", laquo: "«", raquo: "»", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
  hellip: "…", mdash: "—", ndash: "–", middot: "·", deg: "°", euro: "€", copy: "©", reg: "®", trade: "™",
};

export function decodificar(txt) {
  return txt.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : m;
    }
    return ENTIDADES[e] ?? m;
  });
}

const sinCdata = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");

// Texto plano a partir de un fragmento que puede traer HTML escapado o en CDATA
export function textoPlano(s) {
  if (!s) return "";
  let t = decodificar(sinCdata(s)); // el HTML suele venir escapado: primero se des-escapa
  t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ");
  return decodificar(t).replace(/\s+/g, " ").trim();
}

export function recortar(txt, max) {
  if (txt.length <= max) return txt;
  const corte = txt.slice(0, max);
  const esp = corte.lastIndexOf(" ");
  return (esp > max * 0.6 ? corte.slice(0, esp) : corte) + "…";
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function bloques(xml, tag) {
  return xml.match(new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, "gi")) || [];
}

function campo(b, ...tags) {
  for (const t of tags) {
    const m = b.match(new RegExp(`<${escRe(t)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escRe(t)}>`, "i"));
    if (m && m[1].trim()) return m[1];
  }
  return "";
}

function atributo(b, tag, attr, condicion) {
  const re = new RegExp(`<${escRe(tag)}\\b[^>]*>`, "gi");
  for (const etiqueta of b.match(re) || []) {
    if (condicion && !condicion(etiqueta)) continue;
    const m = etiqueta.match(new RegExp(`\\b${attr}\\s*=\\s*["']([^"']+)["']`, "i"));
    if (m) return decodificar(m[1]);
  }
  return "";
}

const primeraImagen = (html) => {
  const m = decodificar(sinCdata(html || "")).match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : "";
};

export const idDe = (link, titulo) => createHash("sha1").update(link || titulo).digest("hex").slice(0, 12);

export function parsearFeed(xml, fuente) {
  const items = [...bloques(xml, "item"), ...bloques(xml, "entry")];
  return items
    .map((b) => {
      const titulo = textoPlano(campo(b, "title"));
      let link = textoPlano(campo(b, "link"));
      if (!/^https?:/i.test(link)) link = atributo(b, "link", "href", (e) => !/rel=["'](?!alternate)/i.test(e));
      const fechaTxt = textoPlano(campo(b, "pubDate", "dc:date", "published", "updated"));
      const fecha = new Date(fechaTxt);
      const desc = campo(b, "description", "summary");
      const cuerpo = campo(b, "content:encoded", "content");
      let resumen = recortar(textoPlano(desc || cuerpo), 240);
      if (titulo && resumen.startsWith(titulo)) resumen = resumen.slice(titulo.length).trim();
      let imagen =
        atributo(b, "media:content", "url", (e) => !/medium=["'](?!image)/i.test(e)) ||
        atributo(b, "media:thumbnail", "url") ||
        atributo(b, "enclosure", "url", (e) => /type=["']image/i.test(e)) ||
        primeraImagen(cuerpo) ||
        primeraImagen(desc);
      if (!/^https:\/\//i.test(imagen)) imagen = ""; // solo https: la TV no carga contenido mixto
      return {
        id: idDe(link, titulo),
        titulo: recortar(titulo, 200),
        resumen,
        link: /^https?:\/\//i.test(link) ? link : "",
        imagen,
        fecha: isNaN(fecha) ? null : fecha.toISOString(),
        fuente: fuente.nombre,
        fuenteId: fuente.id,
      };
    })
    .filter((n) => n.titulo && n.link);
}

export function tituloDelFeed(xml) {
  const canal = xml.match(/<channel[\s>][\s\S]*?<item[\s>]/i)?.[0] || xml.slice(0, 4000);
  return textoPlano(campo(canal, "title"));
}

// Bloquea direcciones de la red interna: el admin solo debería poder apuntar a medios públicos
export function urlPublicaValida(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(u.protocol)) return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".localhost") || h === "::1" || h === "0.0.0.0") return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return false;
  if (/^f[cd]|^fe80/.test(h) && h.includes(":")) return false;
  return true;
}

export async function bajarFeed(url, { timeoutMs = 15000 } = {}) {
  // Las redirecciones se siguen a mano para revalidar cada destino (no saltar a la red interna)
  let r;
  for (let saltos = 0; ; saltos++) {
    if (!urlPublicaValida(url)) throw new Error("Dirección no permitida");
    r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (PantallaNoticiasIT; +https://ioconsulting.com.ar)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
    const destino = r.headers.get("location");
    if (r.status >= 300 && r.status < 400 && destino) {
      if (saltos >= 4) throw new Error("Demasiadas redirecciones");
      url = new URL(destino, url).href;
      continue;
    }
    break;
  }
  if (!r.ok) throw new Error("HTTP " + r.status);
  const texto = await r.text();
  if (texto.length > 5_000_000) throw new Error("Feed demasiado grande");
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(texto)) throw new Error("No es un feed RSS/Atom");
  return texto;
}
