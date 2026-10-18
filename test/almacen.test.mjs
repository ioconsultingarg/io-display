import { test } from "node:test";
import assert from "node:assert/strict";
import { armarPantalla, sanearConfig, CONFIG_POR_DEFECTO } from "../src/almacen.mjs";

const AHORA = Date.parse("2026-10-18T20:00:00Z");
const nota = (id, fuenteId, horasAtras, titulo = "Nota " + id) => ({
  id, titulo, resumen: "", link: "https://m.com/" + id, imagen: "", fecha: new Date(AHORA - horasAtras * 3600e3).toISOString(), fuente: fuenteId, fuenteId,
});
const base = (extra = {}) => sanearConfig({
  ...CONFIG_POR_DEFECTO,
  fuentes: [{ id: "a", nombre: "A", url: "https://a.com/rss", activa: true }, { id: "b", nombre: "B", url: "https://b.com/rss", activa: true }],
  ...extra,
});
const cache = {
  a: { ok: true, items: [nota("a1", "a", 1), nota("a2", "a", 2), nota("a3", "a", 200)] },
  b: { ok: false, items: [nota("b1", "b", 3, "Gran oferta de notebooks")] },
};

test("intercala fuentes y descarta notas viejas", () => {
  const p = armarPantalla(base(), cache, AHORA);
  assert.deepEqual(p.noticias.map((n) => n.id), ["a1", "b1", "a2"]);
  assert.equal(p.fuentes.find((f) => f.id === "b").ok, false);
});

test("ocultas y palabras excluidas no salen (sin importar tildes ni mayúsculas)", () => {
  const p = armarPantalla(base({ ocultas: ["a1"], excluir: ["OFERTA"] }), cache, AHORA);
  assert.deepEqual(p.noticias.map((n) => n.id), ["a2"]);
});

test("las destacadas van primero, aunque ya no estén en el feed", () => {
  const vieja = nota("z9", "a", 500);
  const p = armarPantalla(base({ destacadas: [vieja] }), cache, AHORA);
  assert.equal(p.noticias[0].id, "z9");
  assert.equal(p.noticias[0].destacada, true);
});

test("solo destacadas, con respaldo si no hay ninguna", () => {
  assert.deepEqual(armarPantalla(base({ soloDestacadas: true, destacadas: [nota("a2", "a", 2)] }), cache, AHORA).noticias.map((n) => n.id), ["a2"]);
  assert.equal(armarPantalla(base({ soloDestacadas: true }), cache, AHORA).noticias.length, 3);
});

test("fuente apagada no aparece", () => {
  const c = base();
  c.fuentes[1].activa = false;
  assert.deepEqual(armarPantalla(c, cache, AHORA).noticias.map((n) => n.id), ["a1", "a2"]);
});

test("sanearConfig corrige rangos y rechaza URLs internas", () => {
  const c = sanearConfig({ segundos: 2, horas: 9999, fuentes: [{ id: "x", nombre: "X", url: "http://127.0.0.1/rss" }, { id: "y", nombre: "Y", url: "https://y.com/rss" }] });
  assert.equal(c.segundos, 8);
  assert.equal(c.horas, 168);
  assert.deepEqual(c.fuentes.map((f) => f.id), ["y"]);
});

test("al reiniciar sin internet, el servidor sirve lo que quedó en el caché en disco", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { Almacen } = await import("../src/almacen.mjs");
  const dir = await mkdtemp(join(tmpdir(), "pantalla-"));
  const reciente = { ...nota("c1", "xataka", 0), fecha: new Date().toISOString() };
  await writeFile(join(dir, "cache.json"), JSON.stringify({ xataka: { ok: true, items: [reciente], actualizado: new Date().toISOString() } }));
  const a = new Almacen(dir);
  await a.iniciar(); // sin llamar a refrescar(): equivale a no tener red
  const p = a.pantalla();
  assert.deepEqual(p.noticias.map((n) => n.id), ["c1"]);
  assert.equal(p.noticias[0].fuente, "Xataka");
  await rm(dir, { recursive: true });
});
