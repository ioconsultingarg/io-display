import { test } from "node:test";
import assert from "node:assert/strict";
import { parsearFeed, textoPlano, urlPublicaValida } from "../src/rss.mjs";

const fuente = { id: "x", nombre: "Medio X" };

test("parsea RSS 2.0 con CDATA, entidades e imagen en media:content", () => {
  const xml = `<rss><channel><title>Medio</title>
    <item><title><![CDATA[Nueva versión de Linux &amp; más]]></title>
      <link>https://medio.com/nota-1</link>
      <pubDate>Sun, 18 Oct 2026 19:58:30 +0000</pubDate>
      <description>&lt;p&gt;Resumen con &lt;b&gt;HTML&lt;/b&gt; escapado&lt;/p&gt;</description>
      <media:content url="https://medio.com/a.jpg" medium="image"/>
    </item></channel></rss>`;
  const [n] = parsearFeed(xml, fuente);
  assert.equal(n.titulo, "Nueva versión de Linux & más");
  assert.equal(n.link, "https://medio.com/nota-1");
  assert.equal(n.resumen, "Resumen con HTML escapado");
  assert.equal(n.imagen, "https://medio.com/a.jpg");
  assert.equal(n.fecha, "2026-10-18T19:58:30.000Z");
  assert.equal(n.fuente, "Medio X");
});

test("parsea Atom con link por href y descarta imágenes http", () => {
  const xml = `<feed><entry><title>Nota Atom</title>
    <link rel="self" href="https://medio.com/api/1"/><link rel="alternate" href="https://medio.com/atom-1"/>
    <updated>2026-10-18T10:00:00Z</updated>
    <content type="html">&lt;img src="http://inseguro.com/a.jpg"&gt;Texto</content></entry></feed>`;
  const [n] = parsearFeed(xml, fuente);
  assert.equal(n.link, "https://medio.com/atom-1");
  assert.equal(n.imagen, "");
  assert.equal(n.resumen, "Texto");
});

test("descarta items sin título o sin link", () => {
  assert.equal(parsearFeed(`<rss><item><title>Sin link</title></item></rss>`, fuente).length, 0);
});

test("textoPlano quita scripts y decodifica entidades numéricas", () => {
  assert.equal(textoPlano("<script>alert(1)</script>Hola &#233;l &#x2014; fin"), "Hola él — fin");
});

test("urlPublicaValida bloquea la red interna", () => {
  assert.ok(urlPublicaValida("https://www.xataka.com/feedburner.xml"));
  for (const u of ["http://localhost/x", "http://127.0.0.1/x", "http://192.168.0.10/x", "http://10.0.0.1/x", "http://172.20.1.1/x", "http://169.254.169.254/latest", "file:///etc/passwd", "ftp://a.com/x"])
    assert.equal(urlPublicaValida(u), false, u);
});
