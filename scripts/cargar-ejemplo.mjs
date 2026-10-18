// Carga el contenido de ejemplo (pantallas, avisos e imágenes de la demo) en data/.
// Uso: npm run ejemplo            (solo si todavía no hay configuración)
//      npm run ejemplo -- --forzar (reemplaza la configuración actual; la clave del admin no se toca)
import { cp, access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const DATA = process.env.DATA_DIR || join(RAIZ, "data");
const EJEMPLO = join(RAIZ, "ejemplo");
const forzar = process.argv.includes("--forzar");

const existe = (ruta) => access(ruta).then(() => true, () => false);

if ((await existe(join(DATA, "config.json"))) && !forzar) {
  console.log("Ya hay una configuración en data/. Para reemplazarla: npm run ejemplo -- --forzar");
  process.exit(1);
}
await mkdir(join(DATA, "medios"), { recursive: true });
await cp(join(EJEMPLO, "config.json"), join(DATA, "config.json"));
await cp(join(EJEMPLO, "medios"), join(DATA, "medios"), { recursive: true });
console.log("Contenido de ejemplo cargado: pantallas Principal y Comedor, 2 avisos con imagen. Arrancá con npm start.");
