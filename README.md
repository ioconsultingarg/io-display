# IO Display · Pantalla de noticias IT

Pantalla para una TV encendida las 24 horas en un espacio común. Muestra noticias de informática que
toma de RSS en español, una por vez, siempre citando la fuente: el medio, cuándo se publicó, el link y
un QR para leer la nota completa en el celular.

Tiene dos partes:

| | Dirección | Para qué |
|---|---|---|
| **Pantalla** | `/tv` | La que se ve en la TV. No tiene controles ni se puede manejar: rota las noticias sola. |
| **Administración** | `/admin` | Con clave. Desde acá se eligen las fuentes y las noticias que se ven. |

## Cómo se usa

Requiere Node 18.17 o superior y no instala dependencias.

```bash
npm start
```

- TV: `http://<ip-de-la-pc>:8080/tv` (al arrancar, la consola muestra las direcciones de la red local)
- Admin: `http://<ip-de-la-pc>:8080/admin`

La primera vez se genera una clave de administración en `data/clave-admin.txt`. Para elegir otra, se
arranca con la variable `ADMIN_CLAVE` (mínimo 8 caracteres).

## Qué se puede elegir desde el admin

- **Fuentes**: prender o apagar cada medio, quitarlo o agregar uno nuevo. Al agregarlo se prueba el feed
  antes de guardarlo.
- **Noticias**: *destacar* una nota (sale primero y queda fija aunque el medio la saque de su feed) u
  *ocultarla* (no sale más en la TV).
- **Ajustes**: título de la pantalla, segundos por noticia, antigüedad máxima, notas por medio, palabras
  a excluir y la opción de mostrar solo las destacadas.

La TV consulta al servidor cada minuto, así que los cambios se ven en menos de un minuto, sin tocarla.

## Qué pasa si se corta algo

| Corte | Qué hace |
|---|---|
| Se cae un medio | El servidor sigue mostrando lo último que trajo de ese medio. En la TV, ese medio aparece con borde punteado. |
| Se corta internet | El servidor sigue sirviendo su caché (`data/cache.json`), también si se reinicia sin conexión. |
| Se cae el servidor o la red local | La TV sigue rotando con la última lista que recibió y avisa en rojo arriba. |
| La TV recarga la página con el servidor caído | Con el service worker, la página arranca igual desde la copia guardada. Esto funciona solo en `localhost` o con https: es una regla del navegador. Por eso la TV no se recarga sola si el servidor no responde. |

Una vez por día la pantalla se recarga para no acumular memoria, pero solo si el servidor responde.

## Estructura

```
servidor.mjs        servidor HTTP: páginas, API de la TV y API del admin
src/rss.mjs         descarga y lectura de RSS/Atom (sin dependencias)
src/almacen.mjs     configuración, caché en disco y armado de la lista que se ve
src/auth.mjs        clave del admin, sesiones y límite de intentos
public/tv.*         pantalla de la TV
public/admin.*      panel de administración
public/sw.js        service worker (copia de la pantalla para cortes)
public/vendor/      qrcode-generator (MIT, Kazuhiko Arase)
data/               config, caché y clave (no se sube al repo)
test/               npm test
```

## Seguridad

- La pantalla solo lee: `/api/pantalla` no recibe datos.
- El admin pide la clave. Usa una cookie `HttpOnly` y `SameSite=Strict`, y bloquea por 15 minutos después
  de 5 intentos fallidos.
- Solo se aceptan feeds en direcciones públicas: se bloquean `localhost` y las IP de la red interna,
  también si un feed redirige hacia ellas.
- Hay headers CSP y `nosniff`, y la pantalla solo puede mostrarse embebida en el propio admin.
- El servidor usa http. Si el admin se va a usar fuera de la red local, hay que ponerlo detrás de https
  (por ejemplo, un proxy reverso o Cloudflare Tunnel).

## Dejarlo funcionando en la TV

1. En una PC o mini PC de la red, dejar `npm start` corriendo como servicio (Programador de tareas de
   Windows con "al iniciar", o `pm2`).
2. En la TV, o en el dispositivo conectado a ella, abrir `/tv` en modo quiosco. Por ejemplo, en Chrome:
   `chrome --kiosk http://<ip>:8080/tv`.
3. Si el navegador de la TV corre en la misma PC que el servidor, conviene usar
   `http://localhost:8080/tv`: así también funciona la copia del service worker.
