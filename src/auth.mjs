// Acceso al panel admin: una sola clave, sesiones en memoria con cookie HttpOnly.
// La pantalla de la TV no necesita (ni tiene) acceso a nada de esto.
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DURACION_MS = 12 * 60 * 60 * 1000;
const MAX_FALLOS = 5;
const VENTANA_FALLOS_MS = 15 * 60 * 1000;

const hash = (s) => createHash("sha256").update(String(s)).digest();

export class Auth {
  constructor(dir) {
    this.dir = dir;
    this.sesiones = new Map(); // token -> vence
    this.fallos = new Map(); // ip -> { n, desde }
  }

  // La clave sale de ADMIN_CLAVE o, si no está, se genera una vez y se guarda en data/clave-admin.txt
  async iniciar() {
    let clave = process.env.ADMIN_CLAVE;
    let generada = false;
    if (!clave) {
      const ruta = join(this.dir, "clave-admin.txt");
      try {
        clave = (await readFile(ruta, "utf8")).trim();
      } catch {
        clave = randomBytes(9).toString("base64url");
        await writeFile(ruta, clave + "\n", { mode: 0o600 });
        generada = true;
      }
    }
    if (clave.length < 8) throw new Error("La clave del admin debe tener al menos 8 caracteres");
    this.hashClave = hash(clave);
    return { generada, ruta: process.env.ADMIN_CLAVE ? null : join(this.dir, "clave-admin.txt") };
  }

  bloqueada(ip) {
    const f = this.fallos.get(ip);
    if (!f) return false;
    if (Date.now() - f.desde > VENTANA_FALLOS_MS) {
      this.fallos.delete(ip);
      return false;
    }
    return f.n >= MAX_FALLOS;
  }

  ingresar(ip, clave) {
    if (this.bloqueada(ip)) return { ok: false, motivo: "bloqueada" };
    if (typeof clave !== "string" || !timingSafeEqual(hash(clave), this.hashClave)) {
      const f = this.fallos.get(ip) || { n: 0, desde: Date.now() };
      f.n++;
      this.fallos.set(ip, f);
      return { ok: false, motivo: "clave" };
    }
    this.fallos.delete(ip);
    const token = randomBytes(32).toString("base64url");
    this.sesiones.set(token, Date.now() + DURACION_MS);
    return { ok: true, token };
  }

  valida(req) {
    const token = leerCookie(req, "sesion");
    const vence = token && this.sesiones.get(token);
    if (!vence) return false;
    if (vence < Date.now()) {
      this.sesiones.delete(token);
      return false;
    }
    return true;
  }

  salir(req) {
    this.sesiones.delete(leerCookie(req, "sesion"));
  }

  static cookie(token, maxAge = DURACION_MS / 1000) {
    return `sesion=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
  }
}

function leerCookie(req, nombre) {
  const m = (req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${nombre}=([^;]+)`));
  return m ? m[1] : null;
}
