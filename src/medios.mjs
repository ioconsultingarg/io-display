// Imágenes que sube el admin (avisos y logo). Se guardan en data/medios con nombre aleatorio
// y se sirven desde el mismo servidor, así la TV las sigue mostrando aunque se corte internet.
import { randomBytes } from "node:crypto";
import { mkdir, writeFile, readdir, stat, unlink, readFile } from "node:fs/promises";
import { join } from "node:path";

export const MAX_BYTES = 8 * 1024 * 1024;
const RE_ARCHIVO = /^[a-f0-9]{24}\.(jpg|png|webp|gif)$/;
const TIPOS = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

// Se decide el tipo por los primeros bytes, no por lo que declara el navegador (SVG no se acepta)
export function tipoDeImagen(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (/^GIF8[79]a/.test(buf.toString("ascii", 0, 6))) return "gif";
  return null;
}

export class Medios {
  constructor(dir) {
    this.dir = join(dir, "medios");
  }

  async iniciar() {
    await mkdir(this.dir, { recursive: true });
  }

  async guardar(buf) {
    const ext = tipoDeImagen(buf);
    if (!ext) throw Object.assign(new Error("El archivo no es una imagen JPG, PNG, WebP o GIF"), { status: 415 });
    const nombre = randomBytes(12).toString("hex") + "." + ext;
    await writeFile(join(this.dir, nombre), buf);
    return "/medios/" + nombre;
  }

  async leer(nombre) {
    if (!RE_ARCHIVO.test(nombre)) return null;
    try {
      return { cuerpo: await readFile(join(this.dir, nombre)), tipo: TIPOS[nombre.split(".").pop()] };
    } catch {
      return null;
    }
  }

  // Borra lo que ya no usa ningún aviso ni el logo. Respeta lo subido en la última hora,
  // porque puede estar en un formulario que todavía no se guardó.
  async limpiar(enUso) {
    const usados = new Set([...enUso].map((u) => u.replace("/medios/", "")));
    for (const f of await readdir(this.dir).catch(() => [])) {
      if (!RE_ARCHIVO.test(f) || usados.has(f)) continue;
      const ruta = join(this.dir, f);
      const { mtimeMs } = await stat(ruta);
      if (Date.now() - mtimeMs > 3600 * 1000) await unlink(ruta).catch(() => {});
    }
  }
}
