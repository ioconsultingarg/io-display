// Modo demo estático (GitHub Pages): no hay servidor.
//   - datos.json trae la configuración de ejemplo y el caché de noticias, regenerado por GitHub Actions.
//   - Lo que se cambia en el admin se guarda en este navegador (localStorage), y las pantallas abiertas
//     en el mismo navegador lo toman. No se publica nada para otros visitantes.
export const ESTATICO = !!document.querySelector('meta[name="io-display-modo"][content="estatico"]');

const CLAVE = "io-display:demo:config";
let base = null;
let cargado = 0;

export async function datosBase() {
  if (!base || Date.now() - cargado > 10 * 60 * 1000) {
    const r = await fetch(new URL("datos.json", document.baseURI), { cache: "no-store" });
    if (!r.ok) throw new Error("datos.json " + r.status);
    base = await r.json();
    cargado = Date.now();
  }
  return base;
}

export function configDemo(b) {
  try {
    const c = JSON.parse(localStorage.getItem(CLAVE));
    if (c && Array.isArray(c.pantallas)) return c;
  } catch {}
  return b.config;
}

export function guardarConfigDemo(config) {
  localStorage.setItem(CLAVE, JSON.stringify(config)); // puede fallar si se llena (imágenes grandes)
}

export function restablecerDemo() {
  localStorage.removeItem(CLAVE);
}

export const CLAVE_DEMO = CLAVE;
