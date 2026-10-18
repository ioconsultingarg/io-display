import { test } from "node:test";
import assert from "node:assert/strict";
import { sanearConfig, avisoVigente, CONFIG_POR_DEFECTO, mediosEnUso } from "../src/almacen.mjs";
import { tipoDeImagen } from "../src/medios.mjs";

const aviso = (extra = {}) => sanearConfig({ ...CONFIG_POR_DEFECTO, avisos: [{ id: "a1", titulo: "Hola", ...extra }] }).avisos[0];
const fecha = (s) => new Date(s); // hora local

test("aviso sin restricciones sale siempre y en todas las pantallas", () => {
  assert.equal(avisoVigente(aviso(), "principal", fecha("2026-10-18T10:00")), true);
});

test("aviso respeta fechas desde/hasta (inclusive)", () => {
  const a = aviso({ desde: "2026-10-18", hasta: "2026-10-20" });
  assert.equal(avisoVigente(a, "principal", fecha("2026-10-17T23:59")), false);
  assert.equal(avisoVigente(a, "principal", fecha("2026-10-18T00:00")), true);
  assert.equal(avisoVigente(a, "principal", fecha("2026-10-20T23:59")), true);
  assert.equal(avisoVigente(a, "principal", fecha("2026-10-21T00:00")), false);
});

test("aviso respeta la franja horaria, también la que cruza la medianoche", () => {
  const dia = aviso({ horaDesde: "08:00", horaHasta: "12:00" });
  assert.equal(avisoVigente(dia, "principal", fecha("2026-10-18T07:59")), false);
  assert.equal(avisoVigente(dia, "principal", fecha("2026-10-18T08:00")), true);
  assert.equal(avisoVigente(dia, "principal", fecha("2026-10-18T12:00")), false);
  const noche = aviso({ horaDesde: "22:00", horaHasta: "06:00" });
  assert.equal(avisoVigente(noche, "principal", fecha("2026-10-18T23:30")), true);
  assert.equal(avisoVigente(noche, "principal", fecha("2026-10-18T05:59")), true);
  assert.equal(avisoVigente(noche, "principal", fecha("2026-10-18T12:00")), false);
});

test("aviso pausado o de otra pantalla no sale", () => {
  const c = sanearConfig({
    ...CONFIG_POR_DEFECTO,
    pantallas: [{ id: "recepcion", nombre: "Recepción", plantilla: "completa" }, { id: "comedor", nombre: "Comedor", plantilla: "cuadricula" }],
    avisos: [{ id: "a1", titulo: "Menú", pantallas: ["comedor", "inexistente"] }, { id: "a2", titulo: "Pausado", activo: false }],
  });
  assert.deepEqual(c.avisos[0].pantallas, ["comedor"]); // las pantallas que no existen se descartan
  assert.equal(avisoVigente(c.avisos[0], "recepcion"), false);
  assert.equal(avisoVigente(c.avisos[0], "comedor"), true);
  assert.equal(avisoVigente(c.avisos[1], "comedor"), false);
});

test("pantallas: plantilla y zonas inválidas se corrigen, ids únicos", () => {
  const c = sanearConfig({
    ...CONFIG_POR_DEFECTO,
    pantallas: [
      { id: "Sala de Espera", nombre: "Sala de espera", plantilla: "inventada", zonas: { principal: "hackeo" } },
      { id: "sala-de-espera", nombre: "Duplicada", plantilla: "completa" },
      { id: "c", nombre: "Cuadrícula", plantilla: "cuadricula", zonas: { z1: "avisos", z2: "cola" } },
    ],
  });
  assert.equal(c.pantallas.length, 2);
  assert.equal(c.pantallas[0].id, "sala-de-espera");
  assert.equal(c.pantallas[0].plantilla, "tablero");
  assert.equal(c.pantallas[0].zonas.principal, "mixto");
  assert.equal(c.pantallas[1].zonas.z1, "avisos");
  assert.equal(c.pantallas[1].zonas.z2, "avisos"); // "cola" no vale en la cuadrícula: queda el valor por defecto
});

test("sin pantallas, queda la principal", () => {
  assert.equal(sanearConfig({ ...CONFIG_POR_DEFECTO, pantallas: [] }).pantallas[0].id, "principal");
});

test("imágenes: solo rutas propias de /medios y colores válidos", () => {
  const c = sanearConfig({
    ...CONFIG_POR_DEFECTO,
    marca: { nombre: "ACME", acento: "red; background:url(x)", logo: "https://otro.com/logo.png" },
    avisos: [{ id: "a", titulo: "x", imagen: "/medios/../../secreto.png" }, { id: "b", titulo: "y", imagen: "/medios/0123456789abcdef01234567.png" }],
  });
  assert.equal(c.marca.acento, "#EF4444");
  assert.equal(c.marca.logo, "");
  assert.equal(c.avisos[0].imagen, "");
  assert.deepEqual([...mediosEnUso(c)], ["/medios/0123456789abcdef01234567.png"]);
});

test("tipoDeImagen reconoce por contenido y rechaza SVG/HTML", () => {
  assert.equal(tipoDeImagen(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), "jpg");
  assert.equal(tipoDeImagen(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])), "png");
  assert.equal(tipoDeImagen(Buffer.from("RIFF0000WEBPVP8 ")), "webp");
  assert.equal(tipoDeImagen(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>')), null);
  assert.equal(tipoDeImagen(Buffer.from("<html><body>hola</body></html>")), null);
});

test("migra la config de la versión 1 (titulo → marca)", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { Almacen } = await import("../src/almacen.mjs");
  const dir = await mkdtemp(join(tmpdir(), "io-display-"));
  await writeFile(join(dir, "config.json"), JSON.stringify({ titulo: "Sala IT", segundos: 20 }));
  const a = new Almacen(dir);
  await a.iniciar();
  assert.equal(a.config.marca.nombre, "Sala IT");
  assert.equal(a.config.segundos, 20);
  assert.equal(a.config.pantallas[0].id, "principal");
  await rm(dir, { recursive: true });
});
