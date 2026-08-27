# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

Inventario de almacén para "Ok-producciones": Express 5 + SQLite3 sirviendo un frontend estático de HTML/CSS/JS sin framework ni build step. El código vive en `server.js` (backend, monolítico), `auth.js` (criptografía de la autenticación), `public/` (frontend) y `scripts/cuenta.js` (alta de cuentas). **Dos dependencias en total**: `express` y `sqlite3`. Antes de añadir una tercera, mira si `node:crypto` ya lo hace — es lo que se hizo con scrypt y TOTP.

El código y los comentarios están en español. Mantén ese idioma al escribir código o mensajes de commit aquí.

## Comandos

```bash
npm install          # instala dependencias (sqlite3 compila nativo vía node-gyp/prebuild)
npm start            # arranca en http://localhost:3000 (PORT lo cambia)
npm test             # 105 tests con el runner nativo de node

# Sin cuentas no se puede entrar a ninguna pantalla: no hay ninguna por defecto.
node scripts/cuenta.js crear almacen --rol admin
node scripts/cuenta.js crear erick --rol superadmin --sin-totp
node scripts/cuenta.js listar
```

Un solo test: `node --test --test-name-pattern "elimina el producto"`.
Un solo archivo: `node --test test/api.test.js`.

El glob del script (`node --test "test/**/*.test.js"`) va entrecomillado a propósito: sin
comillas lo expande el shell, y `node --test test/` falla con `MODULE_NOT_FOUND` porque
Node resuelve la ruta como módulo, no como directorio.

No hay linter configurado.

Inspeccionar la base de datos (no hay CLI de sqlite3 instalado; usa el módulo de node):

```bash
node -e "const s=require('sqlite3');new s.Database('./db/inventario.db3').all('SELECT * FROM productos',[],(e,r)=>console.log(e||r))"
```

## Arquitectura

**Backend — `server.js` y `auth.js`.** `server.js` sigue siendo el monolito: conexión a SQLite, middlewares, guardia, rutas y `app.listen()`. `auth.js` es lo único que se sacó — scrypt, tokens de sesión, TOTP y códigos de respaldo—, porque no tiene ni una petición HTTP y se prueba sin levantar servidor (`test/cripto.test.js`). Las consultas usan la API de callbacks de `sqlite3` (`db.all` / `db.get` / `db.run`), no promesas. En `db.run` se usa `function(err)` (no arrow) porque el handler depende de `this.lastID` y `this.changes`.

**El orden inusual del archivo YA NO EXISTE.** La ruta `/` y `app.listen()` estaban declaradas antes de los middlewares; ahora el archivo va en el orden normal: middlewares → rutas → manejador de errores → `listen`. Se cambió al añadir la autenticación, porque aquel orden convertía en trampa permanente la regla que el guardia necesita: **un middleware registrado después de `express.static` no llega a ejecutarse**, y `express.static` sirve `/html/inventario.html` a quien lo pida. Al añadir un middleware nuevo, colócalo donde le toque en esa cadena.

El manejador de errores también se movió al final. Estaba entre los middlewares, donde Express nunca lo llamaba —los de cuatro argumentos sólo atrapan lo lanzado en algo registrado antes que ellos—, así que respondía el de por defecto: con la traza completa fuera de producción.

Tres ganchos existen solo para poder testear, no los quites: `DB_PATH` (env) elige la base, `app.listen()` está envuelto en `require.main === module` para que importar el módulo no abra puerto, y el final exporta la app con la conexión colgada en `app.locals.db` para cerrarla en el teardown.

Al abrir la conexión, `server.js` crea con `CREATE TABLE IF NOT EXISTS` todo lo
que añaden la 002, la 003 y la 004. No es una migración: es porque
`db/inventario.db3` está versionado con la 001 aplicada pero **sin las
siguientes**, y recién clonado `POST /api/ordenes` moría con `no such table:
ordenes`. Si cambias el DDL de una de esas migraciones, cambia también ese
bloque — son la misma definición escrita dos veces. De la 004 se replican los
`CREATE` pero **no sus dos `DROP`**: ahí sólo se asegura lo que debe existir.

**Tests — `test/`.** Runner nativo de Node, cero dependencias extra. `test/helpers/db.js` recrea el esquema en una base temporal sembrada; los tests levantan la app en puerto efímero (`listen(0)`) y la consultan con `fetch`. Nunca escriben sobre `db/inventario.db3`.

Dos trampas al añadir tests:

- `process.env.DB_PATH` debe fijarse **antes** del `require('../server.js')`, porque la
  conexión se abre al cargar el módulo. El orden entre tests sí da igual: `beforeEach`
  llama a `sembrar()` y deja la base en el estado inicial.
- **Toda petición a `/api/*` necesita sesión.** `test/helpers/sesion.js` siembra las
  cuentas y devuelve la cookie; `api.test.js` la pide una vez en `before` y la reenvía
  desde sus helpers `get`/`enviar`. Y si el test provoca logins fallidos, hay que llamar
  a `app.locals.reiniciarLimites()` en el `beforeEach`: el contador de intentos vive en
  memoria del proceso y todos los tests salen de la misma IP, así que uno dejaría
  bloqueados a los siguientes.

**Modelo de datos — `db/inventario.db3`** (versionado en git):

```
areas                          productos
┌───────────┬──────────┐       ┌─────────────┬────────────────────────┐
│ id_area   │ nombre   │◄──────┤ id_producto │ INTEGER PK             │
└───────────┴──────────┘       │ nombre      │ TEXT NOT NULL          │
                               │ marca       │ TEXT                   │
                               │ descripcion │ TEXT                   │
                               │ cantidad    │ INTEGER NOT NULL DEF 0 │
                               │ activo      │ INTEGER NOT NULL DEF 1 │
                               │ id_area     │ FK → areas             │
                               └──────┬──────┴────────────────────────┘
                                      │
ordenes                               │  orden_lineas
┌─────────────┬───────────────┐       │  ┌─────────────┬──────────────────┐
│ id_orden    │ INTEGER PK    │◄─┬───────┤ id_orden    │ FK → ordenes     │
│ creada_en   │ TEXT NOT NULL │  │    └─►│ id_producto │ FK → productos   │
│ evento      │ TEXT          │  │       │ nombre      │ TEXT NOT NULL    │
│ responsable │ TEXT          │  │       │ cantidad    │ INTEGER NOT NULL │
└─────────────┴───────────────┘  │       └─────────────┴──────────────────┘
                                 │
                                 │  devoluciones
                                 │  ┌───────────────┬────────────────────┐
                                 └──┤ id_orden      │ FK → ordenes UNIQUE│
                                    │ recibida_en   │ TEXT NOT NULL      │
                                    │ recibida_por  │ TEXT               │
                                    └───────────────┴────────────────────┘
```

- **La cantidad vive en el producto**, no en una tabla puente. `activo` decide si el
  producto aparece en la pantalla principal.
- **`ordenes` / `orden_lineas` son el registro histórico de lo que salió** (migración
  002), escrito en el MISMO `COMMIT` que el descuento: no puede haber stock descontado
  sin constancia del motivo, ni constancia de una salida que se revirtió. Las líneas van
  **ya agrupadas por producto**, igual que el descuento. `orden_lineas.nombre` duplica a
  propósito el del producto — es un registro, no una vista: si el producto se renombra o
  se borra, la orden de marzo debe seguir diciendo qué salió. Lo escribe el servidor
  desde su propio `SELECT`, nunca el cliente.
- **`devoluciones` cierra el ciclo** (migración 003): una fila = "esta orden volvió
  completa". Es **todo o nada** como la salida, así que basta una fila por orden y no hay
  tabla de líneas — lo que volvió es lo que dice `orden_lineas`. El **`UNIQUE` en `id_orden`
  es la pieza importante**, no un adorno del índice: hace de "una orden se devuelve una sola
  vez" una garantía de la base y no un `if`, igual que "imprimir dos veces descuenta una
  sola". Devolver **no reescribe `ordenes` ni `orden_lineas`**: son un registro, no un saldo.
- Las **`REFERENCES` son decorativas**: no hay `PRAGMA foreign_keys = ON` en ninguna parte.
  De ahí las líneas huérfanas — borrar un producto deja sus `orden_lineas` apuntando a un id
  que ya no está, y la devolución trata ese caso a mano.
- **`usuarios` e `historial_login` YA NO EXISTEN**: la 004 las borró. `usuarios`
  tenía una fila, `admin` / `1234`, con la contraseña **en texto plano**; como la
  base está versionada, esa contraseña sigue en el historial de git y no puede
  reutilizarse jamás. Las sustituyen `cuentas`, `sesiones`, `codigos_respaldo` y
  `accesos` (ver «Autenticación», más abajo).

Las migraciones van en `db/migrations/`, aplicadas con el runner:

```bash
node db/migrations/run.js db/migrations/001-productos-con-area.sql db/inventario.db3
```

El runner **no tiene ruta de base por defecto** a propósito: hay que pasarla siempre, para
que sea imposible migrar la base real por accidente. Haz copia antes
(`db/inventario.db3.bak` es la de la migración 001, que plegó `detalle_inventario` a
`productos.cantidad` y renombró `subprocesos` a `areas`;
`db/inventario.db3.pre-002.bak` es la de la 002; `db/inventario.db3.pre-003.bak`, la de
la 003).

La **002** y la **003** son puramente aditivas (solo `CREATE TABLE` / `CREATE INDEX`): una
versión vieja de la app sigue funcionando contra una base migrada, y revertirlas es un
`DROP` de sus tablas. La **004** (`db/inventario.db3.pre-004.bak`) **no lo es**: además de
crear las cuatro tablas de autenticación, borra `usuarios` e `historial_login`, así que
revertirla exige el respaldo. Si añades una migración, **el esquema de `test/helpers/db.js`
tiene que reflejarla** o los tests correrán contra un modelo que ya no existe.

Y el bloque de arranque de `server.js` **obliga a que una migración aditiva cree una tabla
y no añada una columna**: `CREATE TABLE IF NOT EXISTS` no añade columnas a una tabla que ya
existe, y `ADD COLUMN` no admite `IF NOT EXISTS` en SQLite, así que una columna nueva no se
puede asegurar de forma idempotente desde ahí. De ahí que la 003 sea la tabla `devoluciones`
y no un `ordenes.devuelta_en`.

**Frontend — `public/`.** Servido como estático (`express.static('public')`), por lo que
las rutas absolutas son `/css/...`, `/js/...`, `/html/...`. **Todo esto va detrás del
guardia** salvo `/login`, `/js/login.js`, `/css/*` y `/img/*`. Tres pantallas de
aplicación con roles separados, más el login:

- `html/index.html` + `js/logica.js` — principal. Lista lo disponible
  (`/api/productos?activo=1`) agrupado por área y arma la selección con cantidad.
  **Además del filtro `activo=1`, oculta lo que no tiene existencias**: una fila se
  pinta si `cantidadDisponible > 0` *o* si ya está en la selección. Lo segundo no es
  un adorno — sin ello la fila desaparecería bajo el dedo justo al tomar la última
  unidad, y desde la Principal no habría forma de devolverla.
  La cantidad se ajusta con un contador en la propia fila (`− n +`); **no hay modal**
  en esta pantalla desde el rediseño.
- `html/inventario.html` + `js/edit.js` — CRUD real contra la API: alta, edición,
  activar/desactivar, borrado, export CSV. Y `js/devolucion.js`, la sección **Recibir
  devolución** encima de la tabla: se teclea el N.º impreso en la orden y se repone todo lo
  que salió. Va **en IIFE por obligación**: `edit.js` no lo está y declara sus `const` en el
  nivel superior, que los classic scripts comparten, así que repetir un nombre allí rompería
  el archivo entero al parsear. (El id `buscar` ya lo usa el buscador del CRUD.)
- `html/orden_del_dia.html` + `js/orden.js` — el formato imprimible. Lee la selección,
  la agrupa por área y al confirmar descuenta de verdad. **También la ajusta**: cada
  línea trae `− + ✕` (`.no-imprimir`), así que devolver material no obliga a volver a
  la Principal. El `+` necesita saber cuánto hay, así que esta pantalla también pide
  `/api/productos?activo=1`; si falla queda deshabilitado y solo se puede bajar o
  quitar — nunca al revés, porque bajar jamás deja el stock corto.
  Lleva la misma `.barra-app` que las otras dos, con el botón de imprimir **dentro**:
  dos barras `sticky; top: 0` se solapan cuando la de navegación envuelve en móvil.
  Bajo 700px ese botón pasa a `fixed` abajo. En el estado vacío se oculta el **botón**,
  nunca la barra.

- `html/login.html` + `js/login.js` + `css/login.css` — **lo único que se sirve sin
  sesión**, y por eso va en archivos propios: así se lee de un vistazo qué CSS y qué
  JavaScript puede ver un desconocido. Dos pasos, el segundo sólo si la cuenta tiene
  TOTP. `login.js` va **en IIFE**, por la misma razón que `devolucion.js`.
- `js/sesion.js` — compartido por las TRES pantallas de aplicación, y cargado
  **siempre primero**: envuelve `window.fetch` y sólo cubre lo que se pida después de
  estar cargado. Pinta la barra de sesión, trata el 401 (no el 403: ése significa "tu
  sesión vale, pero esto no es para ti") y, al salir, borra las tres claves de
  `sessionStorage`. **En IIFE por obligación**, igual que `devolucion.js`.

**Autenticación.** Dos roles: `admin` (todo lo operativo) y `superadmin` (además,
cuentas, bitácora y **borrar** productos — el criterio es «irreversible», no
«peligroso»). Ocho cosas que muerden si se editan a ciegas:

- **El guardia DENIEGA POR DEFECTO.** Bloquea todo lo que no esté en `RUTAS_PUBLICAS`
  en vez de proteger ruta por ruta, así que **una ruta nueva nace protegida**. No lo
  inviertas: el olvido, así, deja fuera al usuario legítimo —se nota en el acto— en
  vez de dejar entrar a cualquiera, que no se nota nunca.
- **En la tabla `sesiones` se guarda el SHA-256 del token, nunca el token.** Llevarse
  el `.db3` no entrega ninguna sesión viva. Por eso no hay JWT: revocarlo exigiría una
  lista negra, que es esta tabla con pasos de más.
- **Nada de `localStorage` para el token.** La cookie es `HttpOnly` y eso es justo lo
  que hace que un XSS no pueda leerla.
- **`app.use(cors())` se quitó** y no debe volver: respondía `Access-Control-Allow-Origin: *`
  a todo internet, y con cookies de sesión eso contradice la política de origen que nos
  protege. El frontend es del mismo origen y nunca lo necesitó.
- **El guardia de `Origin` acepta que FALTE**, y no es un descuido: los navegadores lo
  mandan siempre en peticiones con efectos, y quien no lo manda es `curl`, que no tiene
  ninguna cookie ajena que aprovechar. Exigirlo rompería los tests y la API sin ganar nada.
- **El límite de intentos NO bloquea cuentas**, sólo retrasa. Bloquear regala una forma
  de dejar fuera al dueño sabiendo sólo su usuario. Tres fallos son gratis; la espera se
  fija al fallar el cuarto, así que el quinto intento es el primero que ve un 429.
- **El TOTP lleva anti-replay** (`cuentas.totp_ultimo_paso`) y rechaza cualquier paso
  **menor o igual** al último consumido, no sólo el igual: el paso anterior sigue dentro
  de la ventana de ±1.
- **`cuentas` se queda VACÍA en la base versionada**, a propósito, para que ningún hash
  de contraseña llegue a GitHub. Las cuentas se crean con `scripts/cuenta.js` en cada
  despliegue, y el servidor avisa al arrancar si no hay ninguna (en producción, no
  arranca).

`server.js` también fija `Cache-Control: no-store` en el HTML **dos veces**: en el
middleware de cabeceras y otra vez en `express.static` (opción `setHeaders`) y en
`enviarPantalla`. No es redundancia: `express.static` y `sendFile` escriben su propio
`public, max-age=0` DESPUÉS y pisan el primero, y sin eso el botón «atrás» repinta el
inventario entero desde la caché tras cerrar sesión.

**Capa de diseño.** `public/css/base.css` se carga antes que la hoja de cada pantalla y
contiene todos los tokens, el reset y las primitivas. El sistema está descrito en
`DESIGN.md` (visual) y `PRODUCT.md` (estratégico), ambos en la raíz. Tres cosas que
muerden si se editan a ciegas:

- Los colores son **OKLCH**, con un bloque `@supports not (color: oklch(...))` que los
  repite en hex. Si cambias un token, recalcula también su hex.
- `[hidden] { display: none !important }` es obligatorio (ver el contrato de `orden.js`).
- **No vuelvas a escribir `onclick=` ni ningún manejador en atributo, ni un `<style>` o
  un `style=` en el markup.** La CSP es `script-src 'self'; style-src 'self'` y el
  navegador no los ejecuta. Había siete `onclick` y se pasaron a `addEventListener`
  (los cuatro de las filas, con delegación en el `<tbody>`). Poner `'unsafe-inline'`
  para recuperarlos anularía justo la mitad de la cabecera que sirve contra XSS.
- **Todo lo que teclea el usuario se escapa antes de ir a `innerHTML`.** `edit.js`
  interpolaba `nombre`, `marca`, `descripcion` y `area` en crudo: un producto llamado
  `<img src=x onerror="...">` quedaba almacenado y se ejecutaba al abrir Inventario.
  `edit.js` tiene `escapar()` y `orden.js` `escaparHtml()`; usa el que corresponda.
- **No pongas `position: sticky` en el `thead` de Inventario.** El `overflow-x: auto` de
  `.table-container` lo vuelve scrollport en los dos ejes y la cabecera acaba empujada
  sobre la primera fila. Está documentado en el propio CSS.

**Contrato entre principal y orden del día:** `sessionStorage`, clave `ordenSeleccion`,
un array de `{ id_producto, nombre, marca, area, cantidad }` donde `id_producto` y
`cantidad` son **números** — el backend valida con `typeof === 'number'` y rechaza strings
con 400. `cantidad` es lo pedido, no lo disponible.

Hay una **segunda clave, `ordenAplicada`** (`"true"` = el descuento ya se aplicó, y es lo que
hace que imprimir dos veces descuente una sola) y una **tercera, `ordenId`**: el número que
asignó la base, el que se imprime en el papel y el que se teclea en Inventario para devolver.

El invariante cubre las dos: **quien escriba `ordenSeleccion` debe borrar `ordenAplicada` y
`ordenId`.** Si la selección cambia, la orden es otra: dejar `ordenAplicada` en `"true"` hace
imprimir sin llamar a `/api/ordenes` —papel por material nunca descontado—, y dejar `ordenId`
haría que el papel nuevo llevara el número del anterior, con lo que alguien **devolvería una
orden equivocada**, que es irreversible y peor que quedarse sin número. Escriben las claves
**las dos pantallas** —`logica.js` al mover un contador, `orden.js` al ajustar una línea—,
cada una por su `guardarSeleccion()`, que hace las tres cosas a la vez precisamente para que
no se pueda olvidar ninguna. `devolucion.js` **no escribe ninguna**: recibir el material no
reabre la orden.

La otra mitad: **la Principal no rehidrata una selección cuya orden ya se aplicó.**
Si `ordenAplicada` es `"true"` al cargar, arranca en limpio en vez de recuperar
`ordenSeleccion` — esa orden ya está consumida y volver a mostrarla la
descontaría dos veces si se reenvía. `ordenSeleccion` se deja en
`sessionStorage` a propósito pese a esto: es lo que permite a Orden del día
reimprimir el mismo papel sin volver a llamar a `/api/ordenes`.

Y la tercera operación, que faltaba y era un bug: **cerrar la orden borra las TRES
claves** (botón "Empezar una nueva orden"). Sin ella, una orden ya impresa se quedaba
pegada para siempre: la Principal arrancaba en limpio, así que no tenía nada que quitar
y nunca reescribía la clave, e imprimir solo reimprimía.

**El N.º se pinta desde `cerrarOrdenEnPantalla()`**, no en la rama del 200: esa función es la
única puerta al estado "aplicada" —se entra por el POST y por una recarga—, y pintar en dos
sitios acabaría dejando la reimpresión sin número. Y `marcarOrdenAplicada` escribe en
`sessionStorage` **dentro de un `try/catch`** porque `setItem` lanza en modo privado: sin
envolver, la excepción caería en el `catch` de red de `emitirOrden` y el usuario vería "no se
pudo conectar" sobre una orden ya descontada, y sin papel — `window.print()` no se ejecutaría.

**Hay dos caminos que escriben stock, y solo dos: `POST /api/ordenes` descuenta y
`POST /api/ordenes/:id/devolucion` repone.**

`POST /api/ordenes` valida todo antes de tocar nada, agrupa las líneas repetidas del mismo
producto **antes** de comparar contra el stock (si no, dos pedidos que caben por separado
dejarían la cantidad en negativo), y aplica los `UPDATE` **junto con el registro de la
orden** dentro de una transacción: todo o nada. Responde 409 con `{faltantes}` sin descontar
si algo no alcanza, y 200 con `{id_orden}`. Acepta `evento` y `responsable` opcionales
(texto, máximo 200); en blanco se guardan como `NULL`, no como cadena vacía.

`GET /api/ordenes/:id` es el primer lector de esas tablas: cabecera, `devolucion` (o `null`)
y las líneas con `existe`, `nombre_actual` y `activo` — tres datos que el histórico por sí
solo no da. En su `SELECT`, **`p.nombre` va aliasado a `nombre_actual` obligatoriamente**:
sqlite3 devuelve la fila como objeto plano y una segunda columna `nombre` sobreescribiría en
silencio la histórica.

`POST /api/ordenes/:id/devolucion` repone con `cantidad = cantidad + ?`. Cuatro trampas, las
cuatro comentadas en el propio `server.js`:

- **Las lecturas previas van FUERA de la transacción**, al contrario que en
  `POST /api/ordenes`. Hay una sola conexión y `BEGIN`/`COMMIT` son de conexión, no de
  petición: lo que otra petición ejecute entre nuestro `BEGIN` y nuestro `ROLLBACK` se
  revierte con ella. Y aquí el `ROLLBACK` sería el camino **normal** —teclear mal un
  número— en la misma pantalla en la que el CRUD escribe todo el rato.
- **El `SQLITE_CONSTRAINT` del UNIQUE se mapea a 409**, no a 500: es la red del hueco entre
  el `SELECT` de "¿ya está devuelta?" y el `INSERT`.
- **`devueltas`/`omitidas` se construyen con `this.changes`**, no con el snapshot: un
  `UPDATE` que no encuentra fila no da error en SQLite, da cero cambios.
- **Con cero líneas reponibles el `COMMIT` sale directo**, o el contador nace en cero y la
  petición no responde nunca. Su test lleva `timeout` explícito: un test colgado bloquea
  `npm test` entero en vez de fallar.

No se filtra por `activo` al reponer —el stock es físico—, pero la respuesta marca `activo`
en cada línea y la pantalla lo avisa: si no, el material volvería a un producto que la
Principal no lista y quedaría invisible.

**No hay forma de anular una devolución.** El UNIQUE impide devolver dos veces la misma
orden, no devolver la equivocada: teclear 21 en vez de 12 suma material a productos ajenos y
deja la 21 bloqueada para siempre; se arregla a mano por el CRUD. Por eso el `<dialog>`
muestra la **identidad** de la orden —fecha, evento, responsable y líneas—, no solo el
número. Y las órdenes anteriores a la 003 no llevan número impreso: no se encuentran desde
la UI, se cuadran a mano.

**Se avisa antes de emitir, y solo antes.** El descuento es inmediato y no se deshace
desde la app, así que un `<dialog>` lo dice con las unidades delante antes del `POST`. Es
`<dialog>` nativo y no el `.modal` de Inventario porque ese se abre conmutando
`style.display`, que es justo lo que choca con el `[hidden]` del que depende `orden.js`.
La primitiva `.dialogo` vive en `base.css` (con su `@keyframes`) porque la comparten las
**dos** acciones irreversibles que escriben stock: emitir y recibir.

Después de imprimir **no se pregunta nada**, aunque el navegador tampoco sepa si el papel
salió (`afterprint` se dispara igual al imprimir que al cancelar, y la web no ve la cola
de impresión). Se probó preguntar "¿salió bien el papel?" y se retiró: el aviso previo ya
lo dijo, y una segunda pregunta invita a dudar de un descuento ya aplicado. Si la
impresora falla, "Reimprimir" está a la vista y no vuelve a descontar.

Se descarta separarlo en "Imprimir" + "Confirmar salida": invierte el riesgo. Un papel sin
descontar significa material fuera del almacén que el sistema cree tener, y eso no se
detecta hasta el siguiente inventario; una orden descontada sin papel se ve al instante y
se arregla reimprimiendo.

**Para verificar el `@media print` no sirve `getComputedStyle`**: en un hijo de un
elemento oculto devuelve su propio `display`, no `none`, y da por bueno lo que en papel no
se ve. Usa `elemento.checkVisibility()`, que sí mira los ancestros, con
`page.emulateMedia({ media: 'print' })`.

## Estado conocido (no son bugs que introdujiste)

- **Hay productos duplicados en el catálogo**: `BT3` existe como id 5 y 7, `Array` como 6
  y 8. Los ids 5, 6 y 11 quedaron sin área y con cantidad 0 tras la migración porque no
  tenían fila en la tabla puente. No se fusionaron a propósito — se limpian desde el CRUD.
- La columna `observaciones` de la tabla puente se perdió en la migración 001. Tenía 4
  valores (`blinder`, `parcot`, `bt3`, `array`) que no cuadraban con su producto; siguen
  recuperables desde `db/inventario.db3.bak`.
- Sí hay `.gitignore`: excluye `node_modules/`, `docs/`, `.claude/`,
  `.playwright-mcp/` y los `*.bak`. `db/inventario.db3` **sí** se versiona a
  propósito, porque trae los datos de arranque del almacén.
