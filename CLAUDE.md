# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

Inventario de almacén para "Ok-producciones": Express 5 + Postgres (Supabase) sirviendo un
frontend estático de HTML/CSS/JS sin framework ni build step. El código vive en `server.js`
(backend, monolítico), `auth.js` (criptografía), `db.js` (única puerta al pool de Postgres),
`public/` (frontend) y `scripts/cuenta.js` (alta de cuentas). **Dos dependencias en total**:
`express` y `pg`. Antes de añadir una tercera, mira si `node:crypto` ya lo hace — es lo que se
hizo con scrypt y TOTP. El código y los comentarios están en español: mantén ese idioma al
escribir código o mensajes de commit aquí.

## Comandos

```bash
npm install                    # sólo JS: pg no compila nada nativo (a diferencia de sqlite3)
npm start                      # --env-file=.env, arranca en :3000 (PORT lo cambia)
npm test                       # 114 tests con el runner nativo de node

# Sin cuentas no se puede entrar a ninguna pantalla: no hay ninguna por defecto.
node --env-file=.env scripts/cuenta.js crear almacen --rol admin
node --env-file=.env scripts/cuenta.js crear erick --rol superadmin --sin-totp
node --env-file=.env scripts/cuenta.js listar
```

Un solo archivo: `node --env-file=.env --test test/auth.test.js`. Un solo test: añade
`--test-name-pattern "elimina el producto"` a lo anterior.

El glob de `npm test` (`"test/**/*.test.js"`) va entrecomillado a propósito: sin comillas lo
expande el shell, y `node --test test/` falla con `MODULE_NOT_FOUND` porque Node resuelve la
ruta como módulo, no como directorio. No hay linter configurado.

Inspeccionar la base: `execute_sql` del MCP de Supabase, o `psql "$DATABASE_URL"` — ya no hay
ningún `node -e` con `sqlite3`.

## Arquitectura

**Backend — `server.js`, `auth.js` y `db.js`.** `server.js` sigue siendo el monolito:
middlewares, guardia, rutas, `app.listen()`. `auth.js` es lo único que se sacó por no depender
de HTTP —scrypt, tokens, TOTP, códigos de respaldo— y se prueba sin servidor
(`test/cripto.test.js`). `db.js` es la ÚNICA puerta a Postgres: nadie más construye un `Pool`.
Expone `consultar()` (una consulta suelta) y `enTransaccion(fn)` (cliente dedicado con
`BEGIN`/`COMMIT`/`ROLLBACK`). Dos ganchos existen sólo para testear: `app.listen()` va
envuelto en `require.main === module`, y el final exporta la app con `pool` en `app.locals`
para cerrarlo en el teardown. (El tercero de antes, `DB_PATH`, se fue con SQLite: la conexión
sale de `DATABASE_URL`/`DATABASE_URL_TEST`, leídas dentro de `db.js`.)

**Doce cosas que se aprendieron migrando de SQLite y muerden si se editan a ciegas:**

- `db.js` construye el pool UNA vez, al cargarse. `DATABASE_URL_TEST` gana a `DATABASE_URL`
  para que ni el peor test, con las dos puestas, escriba sobre la base real.
- **`orden_lineas.id_producto` no tiene clave foránea, y es la única del esquema sin ella.**
  Borrar un producto (`DELETE /api/productos/:id`, superadmin) deja líneas huérfanas a
  propósito: son el registro histórico, no un defecto. La FK convertiría esa decisión de
  producto en un `23503`.
- **`(p.id_producto IS NOT NULL)::int AS existe`, en `SQL_LINEAS_DE_ORDEN`.** Sin el `::int`
  Postgres devuelve booleano, el `=== 1` de abajo falla siempre y la devolución responde 200
  sin reponer nada — éxito aparente, material perdido. Mismo patrón en `con_totp`
  (`GET /api/cuentas`) y en `count(*)::int` del aviso de arranque.
- **`FOR UPDATE ... ORDER BY id_producto`, en `POST /api/ordenes`.** Sustituye a la
  serialización de la conexión única de SQLite: sin el candado de fila, dos órdenes
  simultáneas descuentan las dos y dejan el stock en negativo. El `ORDER BY` evita el
  interbloqueo entre órdenes que piden los mismos productos en distinto orden.
- **Las lecturas de la devolución ya van DENTRO de la transacción.** Antes iban fuera porque
  había una sola conexión de módulo y un `ROLLBACK` —el camino normal, teclear mal un
  número— se llevaba lo que otra petición escribía. Con un cliente por transacción esa razón
  desapareció.
- **Dos poolers de Supabase**: transacción (`:6543`) en producción, sesión (`:5432`) en tests.
  El de transacción no garantiza que un `SET search_path` sobreviva entre transacciones, y el
  aislamiento por esquema de los tests depende de eso.
- **Un esquema Postgres por archivo de test.** `ESQUEMA_BD` se fija **antes** del
  `require('../server.js')` —lo exige `test/helpers/db.js`, que revienta si `db.js` ya estaba en
  `require.cache`—; toda función que trunque llama primero a `exigirEsquemaDePruebas()`, y el
  DDL de esquema pasa por el candado de `test/helpers/candado.js` (`pg_advisory_xact_lock`)
  para que dos corridas no se interbloqueen. En juego: que la suite haga `TRUNCATE` sobre
  `public`, la base real.
- **`CONFIAR_EN_PROXY=1` es obligatoria en Vercel**, o `req.ip` es la IP del proxy para todos
  y el limitador por IP se vuelve un bloqueo global.
- **El aviso de "no hay cuentas activas" corre fuera de `require.main === module`**, porque en
  Vercel el módulo se importa y nunca se ejecuta con `node server.js`.
- **Supabase activa RLS solo en cada tabla nueva** (`rls_auto_enable()`). Las once tablas
  tienen RLS y CERO políticas, y ÉSE es el estado correcto: `anon`/`authenticated` no leen
  nada, la app entra como dueño por `pg`. **No crear políticas RLS**: no gobernarían ningún
  acceso real.
- **El avance de una secuencia (`GENERATED ... AS IDENTITY`) no es transaccional**: un
  `ROLLBACK` no lo revierte. Por eso `areas` ya se saltó un id durante la migración.
- **`pg` no cancela la consulta al agotar `query_timeout`**: rechaza la promesa pero la
  sentencia sigue en el servidor. Si el propio `ROLLBACK` falla, `enTransaccion` DESTRUYE el
  cliente (`release(true)`) en vez de devolverlo al pool con una transacción abierta dentro.

**Tests — `test/`.** Runner nativo de Node, cero dependencias extra. Cada archivo corre en su
propio proceso y vive en su propio esquema, sembrado por `test/helpers/db.js`; la app se
levanta en puerto efímero (`listen(0)`) y se consulta con `fetch`. `npm test` corre antes
`scripts/limpiar-esquemas-de-prueba.js` como `pretest`: barre esquemas huérfanos de una
corrida cortada (`process.kill(pid, 0)` contra el PID del nombre). Nunca se escribe sobre
`public`. Sigue viva una trampa de antes: **toda petición a `/api/*` necesita sesión** —
`test/helpers/sesion.js` siembra las cuentas y devuelve la cookie. Si el test provoca logins
fallidos, hay que llamar a `app.locals.reiniciarLimites()` en el `beforeEach`: el contador
vive en la tabla `intentos_login`, no en memoria, pero sigue compartido por todos los tests
del archivo (misma IP).

**Modelo de datos.** Once tablas en `db/esquema.sql`, aplicado una sola vez contra Supabase —
ya no hay migraciones ni runner: eso vivía en SQLite y se fue con ella.

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
│ creada_en   │ TEXT NOT NULL │  │    └─►│ id_producto │ SIN FK (a prop.) │
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

Autenticación, cuatro tablas más y ninguna FK hacia el inventario:
`cuentas(id_cuenta PK, usuario UNIQUE lower, hash, rol, totp_secreto, totp_ultimo_paso)`,
`sesiones(id_sesion PK, id_cuenta FK, hash_token UNIQUE, vista_en, expira_en)`,
`codigos_respaldo(id_codigo PK, id_cuenta FK, hash, usado_en)`,
`accesos(id_acceso PK, ocurrido_en, usuario texto suelto, resultado, ip)`. Y dos tablas nuevas
de esta migración, que reemplazan sendos `Map` de proceso —en Vercel hay N instancias, y un
reto o un contador guardado en una no existía para las demás—:
`retos_totp(reto PK, id_cuenta FK, expira_en)` (2º factor pendiente, 5 min) e
`intentos_login(clave PK "ip:x"/"usuario:y", fallos, ultimo_en)` (el limitador).

- **La cantidad vive en el producto** (no en tabla puente); `activo` decide si sale en la Principal.
- **`ordenes`/`orden_lineas` son el registro histórico**, escrito en el MISMO `COMMIT` que el
  descuento; `orden_lineas.nombre` duplica el del producto a propósito para que la orden vieja
  siga diciendo qué salió aunque éste se renombre o se borre.
- **`devoluciones` cierra el ciclo**: una fila = "esta orden volvió completa". El `UNIQUE` en
  `id_orden` hace de "se devuelve una sola vez" una garantía de la base y no un `if`.
- **`accesos.usuario` guarda lo que se TECLEÓ**, exista o no la cuenta —de ahí que no sea FK—:
  los intentos contra nombres inventados son justo los que delatan un ataque. `usuarios` e
  `historial_login` (la contraseña en plano `admin`/`1234`) ya no llegaron a este esquema: se
  habían borrado en SQLite antes de migrar a Postgres.

**Frontend — `public/`.** Estático, detrás del guardia salvo `/login`, `/js/login.js`,
`/css/*` y `/img/*`. Principal (`index.html`+`logica.js`, elige de lo disponible), Inventario
(`inventario.html`+`edit.js`, CRUD y `devolucion.js`), Orden del día
(`orden_del_dia.html`+`orden.js`, imprime y descuenta de verdad); `sesion.js` compartido por
las tres. Nada de esto lo tocó la migración; el porqué de cada pantalla está en `DESIGN.md` y
`PRODUCT.md`.

Contratos que siguen mordiendo:

- **`sessionStorage` mueve la orden en tres claves que van SIEMPRE juntas**: `ordenSeleccion`
  (las líneas), `ordenAplicada` (`"true"` tras el descuento), `ordenId` (el número impreso).
  Quien reescriba `ordenSeleccion` borra las otras dos —selección distinta, otra orden— o acaba
  devolviendo la orden equivocada, que no se deshace.
- **CSP y escapado, dos capas contra XSS.** `script-src 'self'` prohíbe `onclick=`,
  `style=` y `<style>` en el markup (detalle en `server.js`); lo que teclea el usuario se
  escapa antes de `innerHTML` (`escapar()` en `edit.js`, `escaparHtml()` en `orden.js`).
- **Para verificar el `@media print` no sirve `getComputedStyle`**: en un hijo de un elemento
  oculto devuelve su propio `display`, no `none`, y da por bueno lo que en papel no se ve. Usa
  `elemento.checkVisibility()` —mira los ancestros— con `page.emulateMedia({ media: 'print' })`.
- **Se probó preguntar «¿salió bien el papel?» tras imprimir, y se retiró**: el aviso previo
  ya lo dijo, y dudar de un descuento ya aplicado no ayuda —la razón vive en un comentario de
  `orden.js`; que se probó y se quitó, no.

## Autenticación

Dos roles: `admin` (todo lo operativo) y `superadmin` (además cuentas, bitácora y **borrar**
productos —el criterio es «irreversible», no «peligroso»). Sigue igual que en SQLite —y
comentado en detalle en `server.js`—: guardia que **deniega por defecto**, SHA-256 del token
en `sesiones` (nunca el token), nada de `localStorage` (cookie `HttpOnly`), sin `cors()`,
`Origin` que acepta que falte (`curl`, no un navegador), límite de intentos que retrasa y no
bloquea cuentas, TOTP que rechaza cualquier paso **menor o igual** al último consumido.
**`cuentas` nunca tiene filas en el repo** —ya no hay ni `.db3` versionado que pudiera
llevarlas— y se crean con `scripts/cuenta.js` en cada despliegue.

**Dos caminos escriben stock, y sólo dos**: `POST /api/ordenes` descuenta (`FOR UPDATE`,
agrupa antes de comparar contra el stock, y escribe líneas y descuentos con `unnest` en dos
sentencias, no en un bucle) y `POST /api/ordenes/:id/devolucion` repone
(`cantidad = cantidad + ?`, mapea `23505` a 409) — el porqué de cada detalle, en los doce
puntos de arriba y en los comentarios del propio `server.js`.

**`GET /api/salud` es la ÚNICA ruta de `/api/` sin sesión**, y está en `RUTAS_PUBLICAS` a
propósito: el guardia deniega por defecto, así que abrirla es una decisión. Hace `SELECT 1`
porque tiene que TOCAR LA BASE — Supabase free pausa el proyecto tras ~7 días sin actividad
y un almacén pasa semanas sin emitir órdenes, así que un ping que sólo despertara a Vercel
dejaría dormir justo al que se pausa. Lo llama a diario
`.github/workflows/mantener-supabase-despierto.yml`. Ojo con el cron: `*/5` en día-del-mes
NO es «cada 5 días» (son los días 1, 6, 11… y del 26 al 1 pasan 6), por eso va diario.

## Estado conocido (no son bugs que introdujiste)

- **Hay productos duplicados en el catálogo**, arrastrados del volcado de un solo uso desde
  SQLite: `BT3` existe como id 5 y 7, `Array` como 6 y 8; los ids 5, 6 y 11 quedaron sin área
  y con cantidad 0. No se fusionaron a propósito — se limpian desde el CRUD.
- Sí hay `.gitignore`: excluye `node_modules/`, `docs/`, `.claude/`, `.playwright-mcp/`,
  `*.bak` y `.env`. **Ya no hay ninguna base de datos versionada** —`db/inventario.db3` se
  borró junto con SQLite—; sólo `db/esquema.sql` y `certs/` (la CA del pooler) viajan.
