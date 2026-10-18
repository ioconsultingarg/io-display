// Arma la demo estática para GitHub Pages en _sitio/ (la corre el workflow de Pages cada 30 minutos).
// Usa el contenido de ejemplo/ y baja las noticias en el momento, con la misma lógica del servidor.
// Uso: npm run sitio                (base /io-display/)
//      BASE=/otra-ruta/ npm run sitio
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Almacen } from "../src/almacen.mjs";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const SALIDA = resolve(RAIZ, process.env.SALIDA || "_sitio");
const BASE = process.env.BASE || "/io-display/";

// 1) configuración de ejemplo + noticias frescas
const tmp = await mkdtemp(join(tmpdir(), "io-display-sitio-"));
await cp(join(RAIZ, "ejemplo", "config.json"), join(tmp, "config.json"));
const almacen = new Almacen(tmp);
await almacen.iniciar();
await almacen.refrescar();
await rm(tmp, { recursive: true, force: true });
const ok = Object.values(almacen.cache).filter((c) => c.ok).length;
console.log(`Noticias: ${ok}/${almacen.config.fuentes.length} fuentes respondieron`);

// 2) archivos del sitio
await rm(SALIDA, { recursive: true, force: true });
await mkdir(SALIDA, { recursive: true });
for (const f of ["tv.js", "admin.js", "plantillas.js", "logica.js", "demo.js"]) await cp(join(RAIZ, "public", f), join(SALIDA, f));
await cp(join(RAIZ, "public", "vendor"), join(SALIDA, "vendor"), { recursive: true });
await cp(join(RAIZ, "ejemplo", "medios"), join(SALIDA, "medios"), { recursive: true });
await cp(join(RAIZ, "bocetos"), join(SALIDA, "bocetos"), { recursive: true });
await cp(join(RAIZ, "demo", "index.html"), join(SALIDA, "index.html"));
await writeFile(join(SALIDA, ".nojekyll"), "");
await writeFile(join(SALIDA, "datos.json"), JSON.stringify({ generado: new Date().toISOString(), config: almacen.config, cache: almacen.cache }));

// 3) páginas en modo demo: base de Pages + marca de modo estático
const aDemo = (html) => {
  if (!html.includes('<base href="/">')) throw new Error("Falta <base href=\"/\"> en la página");
  return html.replace('<base href="/">', `<base href="${BASE}">\n<meta name="io-display-modo" content="estatico">`);
};
const tv = aDemo(await readFile(join(RAIZ, "public", "tv.html"), "utf8"));
const admin = aDemo(await readFile(join(RAIZ, "public", "admin.html"), "utf8"));
const escribir = async (ruta, html) => {
  await mkdir(join(SALIDA, ruta), { recursive: true });
  await writeFile(join(SALIDA, ruta, "index.html"), html);
};
await escribir("tv", tv);
for (const p of almacen.config.pantallas) await escribir(join("tv", p.id), tv);
await escribir("admin", admin);
// pantallas creadas en la demo desde el admin: GitHub Pages responde 404.html, que es la misma pantalla
await writeFile(join(SALIDA, "404.html"), tv);

console.log(`Sitio listo en ${SALIDA} (base ${BASE})`);
