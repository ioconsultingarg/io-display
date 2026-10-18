# IO Display · Cartelería digital

Cartelería digital para TVs encendidas las 24 horas: recepciones, comedores, salas de espera, locales.
Cada pantalla combina **noticias por RSS**, siempre citando la fuente con un QR a la nota, y **avisos
propios del cliente** (promociones, novedades, avisos de RR. HH., menús) con imagen, texto y QR.

Se instala uno por cliente, en una PC o mini PC de su red. Así sigue funcionando aunque se corte
internet.

| | Dirección | Para qué |
|---|---|---|
| **Pantallas** | `/tv/<pantalla>` | Lo que se ve en cada TV. No tiene controles ni se puede manejar: rota sola. |
| **Administración** | `/admin` | Con clave. Desde acá se decide qué se ve, en qué pantalla y cómo. |

## Cómo se usa

Requiere Node 18.17 o superior y no instala dependencias.

```bash
npm start
```

- Admin: `http://<ip-de-la-pc>:8080/admin`
- Cada TV: la dirección que muestra el admin en **Pantallas** (por ejemplo `http://192.168.0.10:8080/tv/recepcion`)

La primera vez se genera una clave de administración en `data/clave-admin.txt`. Para elegir otra, se
arranca con la variable `ADMIN_CLAVE` (mínimo 8 caracteres).

### Contenido de ejemplo

Para una demo, o para arrancar con algo armado:

```bash
npm run ejemplo
```

Carga desde `ejemplo/` dos pantallas (Principal en Tablero y Comedor en cuadrícula 2×2) y dos avisos con
imagen: una capacitación con QR y un menú del día en formato afiche, que sale solo en el Comedor. No pisa una
configuración existente. Para reemplazarla: `npm run ejemplo -- --forzar`.

### Qué vive en el repo y qué no

Todo el sistema y el contenido de ejemplo están en el repo. `data/` no se sube. Se genera al usar la
instalación de cada cliente y tiene:

- `config.json`: lo que se define en el admin
- `medios/`: las imágenes subidas
- `cache.json`: las últimas noticias, se regenera solo
- `clave-admin.txt`: la clave del admin. Nunca va al repo, porque una contraseña en git queda en el historial.

## Qué se define desde el admin

- **Pantallas**: una por TV, cada una con su dirección. El admin muestra si está en línea y una vista
  previa en vivo.
- **Plantilla (cuadrícula)** de cada pantalla, y qué muestra cada zona:

  | Plantilla | Zonas |
  |---|---|
  | Tablero | principal, columna lateral, barra inferior |
  | Pantalla completa | principal |
  | Principal con barra | principal, barra inferior |
  | Cuadrícula 2×2 | cuatro zonas |
  | Vertical (tótem) | principal, lista, barra inferior (para TVs paradas) |

  Una zona grande puede mostrar noticias y avisos intercalados, solo noticias o solo avisos. La lateral
  muestra "A continuación" (lo que viene en la principal), avisos o noticias. La barra muestra las
  fuentes citadas o titulares que corren.
- **Avisos propios**: título, texto, imagen subida y QR opcional. Tienen dos formatos: *tarjeta* (texto
  con la imagen al costado) o *afiche* (la imagen sola, a toda la zona). Se pueden limitar a fechas, a una
  franja horaria (también una que cruce la medianoche) y a ciertas pantallas.
- **Noticias RSS**: fuentes (prender, apagar, agregar probando el feed antes), notas destacadas u
  ocultas, palabras a excluir y antigüedad máxima.
- **Marca**: nombre, logo y color de acento. El texto sobre el acento se ajusta solo para que tenga
  contraste.
- **Mensaje urgente**: tapa todas las pantallas hasta que se quita. Sirve para emergencias, simulacros o
  cortes de servicio.

Las TVs consultan al servidor cada 20 segundos, así que los cambios se ven enseguida, sin tocarlas.

## Bocetos de estilo

En `/bocetos/` están los cuatro diseños que se compararon antes de construir IO Display, uno por cada skill de
diseño: Diario de Informática (editorial), **Tablero de Informática (el elegido)**, Terminal (Anime.js, con los
colores de IO Consulting) y Radar IT (aurora y bento). Sirven como referencia si un cliente quiere otra
estética. Muestran las mismas noticias que las TVs; abiertos sueltos desde el disco, usan rss2json como
respaldo.

## Qué pasa si se corta algo

| Corte | Qué hace |
|---|---|
| Se cae un medio | El servidor sigue mostrando lo último que trajo de ese medio. |
| Se corta internet | El servidor sigue sirviendo su caché (`data/cache.json`) y las imágenes subidas, que están en el propio equipo. También funciona si el equipo se reinicia sin conexión. |
| Se cae el servidor o la red local | Cada TV sigue rotando con lo último que recibió y avisa en rojo arriba. |
| La TV recarga la página con el servidor caído | Con el service worker, la página arranca igual desde la copia, con imágenes incluidas. Esto funciona solo en `localhost` o con https: es una regla del navegador. Por eso la TV no se recarga sola si el servidor no responde. |

## Estructura

```
servidor.mjs        servidor HTTP: páginas, API de las TVs y API del admin
src/rss.mjs         descarga y lectura de RSS/Atom
src/almacen.mjs     configuración, caché, vigencia de avisos y armado de cada pantalla
src/medios.mjs      imágenes subidas: validación por contenido, guardado y limpieza
src/auth.mjs        clave del admin, sesiones y límite de intentos
public/plantillas.js  plantillas y zonas (las usan el servidor, el admin y las TVs)
public/tv.*         pantalla de las TVs
public/admin.*      panel de administración
public/sw.js        service worker (copia para cortes)
public/vendor/      qrcode-generator (MIT, Kazuhiko Arase)
bocetos/            los 4 estilos que se compararon, con su galería (/bocetos/)
ejemplo/            contenido de demo (npm run ejemplo)
scripts/            cargar-ejemplo.mjs
data/               config, caché, imágenes y clave de cada instalación (no se sube al repo)
test/               npm test
```

## Seguridad

- Las TVs solo leen: `/api/pantalla` no recibe datos.
- El admin pide la clave. Usa una cookie `HttpOnly` y `SameSite=Strict`, y bloquea por 15 minutos después
  de 5 intentos fallidos.
- Imágenes: hasta 8 MB, y el tipo (JPG, PNG, WebP o GIF) se valida por contenido. No se aceptan SVG.
  Se guardan con nombre aleatorio, y las que ningún aviso usa se borran solas.
- Solo se aceptan feeds en direcciones públicas: se bloquean `localhost` y las IP de la red interna,
  también si un feed redirige hacia ellas.
- Hay headers CSP y `nosniff`, y las pantallas solo pueden mostrarse embebidas en el propio admin. Los
  bocetos tienen una CSP propia, más abierta, porque cargan GSAP, Anime.js y el QR desde CDN. La TV y el admin
  mantienen la estricta.
- El servidor usa http. Si el admin se va a usar fuera de la red local, hay que ponerlo detrás de https
  (por ejemplo, un proxy reverso o Cloudflare Tunnel).

## Instalación en el cliente

1. En una PC o mini PC de la red, dejar `npm start` corriendo como servicio (Programador de tareas de
   Windows con "al iniciar", o `pm2`).
2. En cada TV, o en el dispositivo conectado a ella, abrir su dirección en modo quiosco. Por ejemplo, en
   Chrome: `chrome --kiosk http://<ip>:8080/tv/recepcion`.
3. Si el navegador de la TV corre en la misma PC que el servidor, conviene usar `http://localhost:8080/...`:
   así también funciona la copia del service worker.
