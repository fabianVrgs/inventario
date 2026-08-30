# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

Inventario de almacén para "Ok-producciones": Express 5 + Postgres (Supabase) sirviendo un
frontend estático de HTML/CSS/JS sin framework ni build step. El código vive en
`src/server.js` (backend, monolítico), `src/auth.js` (criptografía), `src/db.js` (única puerta
al pool de Postgres), `public/` (frontend) y `scripts/cuenta.js` (alta de cuentas). **Dos dependencias en total**:
`express` y `pg`. Antes de añadir una tercera, mira si `node:crypto` ya lo hace — es lo que se
hizo con scrypt y TOTP. El código y los comentarios están en español: mantén ese idioma al
escribir código o mensajes de commit aquí.

## Comandos

```bash
npm install                    # sólo JS: pg no compila nada nativo (a diferencia de sqlite3)
npm start                      # --env-file=.env, arranca en :3000 (PORT lo cambia)
npm test                       # 128 tests con el runner nativo de node

# Sin cuentas no se puede entrar a ninguna pantalla: no hay ninguna por defecto.
# Ésta es la vía de arranque; las demás cuentas se crean ya desde /html/cuentas.html.
node --env-file=.env scripts/cuenta.js crear erick --rol superadmin
node --env-file=.env scripts/cuenta.js listar
node --env-file=.env scripts/cuenta.js roles
```

Un solo archivo: `node --env-file=.env --test test/auth.test.js`. Un solo test: añade
`--test-name-pattern "elimina el producto"` a lo anterior.

El glob de `npm test` (`"test/**/*.test.js"`) va entrecomillado a propósito: sin comillas lo
expande el shell, y `node --test test/` falla con `MODULE_NOT_FOUND` porque Node resuelve la
ruta como módulo, no como directorio. No hay linter configurado.

Inspeccionar la base: `execute_sql` del MCP de Supabase, o `psql "$DATABASE_URL"` — ya no hay
ningún `node -e` con `sqlite3`.

## Arquitectura

**Backend — `src/`, tres archivos.** `server.js` sigue siendo el monolito:
middlewares, guardia, rutas, `app.listen()`. `auth.js` es lo único que se sacó por no depender
de HTTP —scrypt, tokens, y el TOTP y los códigos de respaldo que quedaron dormidos
(ver «Estado conocido»)— y se prueba sin servidor
(`test/cripto.test.js`). `db.js` es la ÚNICA puerta a Postgres: nadie más construye un `Pool`.
Expone `consultar()` (una consulta suelta) y `enTransaccion(fn)` (cliente dedicado con
`BEGIN`/`COMMIT`/`ROLLBACK`). Dos ganchos existen sólo para testear: `app.listen()` va
envuelto en `require.main === module`, y el final exporta la app con `pool` en `app.locals`
para cerrarlo en el teardown. (El tercero de antes, `DB_PATH`, se fue con SQLite: la conexión
sale de `DATABASE_URL`/`DATABASE_URL_TEST`, leídas dentro de `db.js`.)

Los tres viven en `src/` desde la reorganización, y eso trae un detalle que ya mordió una vez:
**`public/` y `certs/` están un nivel por encima**, así que toda ruta a ellas sube con `..`.
En `server.js` las dos formas de alcanzar `public/` —el estático y el `sendFile` de las
pantallas— salen ahora de la constante `PUBLICO`. Antes no: `express.static` recibía la cadena
`'public'`, relativa al `process.cwd()`, mientras las pantallas usaban `__dirname`. Con los
módulos en la raíz los dos caminos coincidían por casualidad; desde `src/` sólo se habría roto
uno, dando un 404 en `/` y `/login` con los estáticos funcionando.

**Doce cosas que se aprendieron migrando de SQLite y muerden si se editan a ciegas:**

- `db.js` construye el pool UNA vez, al cargarse. `DATABASE_URL_TEST` gana a `DATABASE_URL`
  para que ni el peor test, con las dos puestas, escriba sobre la base real.
- **`orden_lineas.id_producto` no tiene clave foránea, y es la única del esquema sin ella.**
  Borrar un producto (`DELETE /api/productos/:id`, superadmin) deja líneas huérfanas a
  propósito: son el registro histórico, no un defecto. La FK convertiría esa decisión de
  producto en un `23503`.
- **`(p.id_producto IS NOT NULL)::int AS existe`, en `SQL_LINEAS_DE_ORDEN`.** Sin el `::int`
  Postgres devuelve booleano, el `=== 1` de abajo falla siempre y la devolución responde 200
  sin reponer nada — éxito aparente, material perdido. Mismo patrón en el `count(*)::int`
  del aviso de arranque y en el del guardia del último superadmin de `scripts/cuenta.js`.
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
  `require('../src/server.js')` —lo exige `test/helpers/db.js`, que revienta si `db.js` ya estaba en
  `require.cache`—; toda función que trunque llama primero a `exigirEsquemaDePruebas()`, y el
  DDL de esquema pasa por el candado de `test/helpers/candado.js` (`pg_advisory_xact_lock`)
  para que dos corridas no se interbloqueen. En juego: que la suite haga `TRUNCATE` sobre
  `public`, la base real.
- **`CONFIAR_EN_PROXY=1` es obligatoria en Vercel**, o `req.ip` es la IP del proxy para todos
  y el limitador por IP se vuelve un bloqueo global.
- **`vercel.json` describe el despliegue entero, y sustituye a la autodetección.** Antes no
  existía: Vercel encontraba `server.js` en la raíz exportando una app de Express y servía
  `public/` desde su CDN por su cuenta. Mover el código a `src/` habría roto eso en silencio.
  Dos detalles del archivo deciden si producción arranca. **`includeFiles`**: el empaquetador
  decide qué sube analizando los `require`, y ni `express.static` ni el `readFileSync` del
  certificado son analizables, así que `public/**` y `certs/**` van nombrados a mano — sin el
  segundo la función muere al cargar `db.js`. **`routes` y no `rewrites`**: los `rewrites` se
  compilan con `check: true`, o sea que la plataforma mira el sistema de archivos DESPUÉS de
  casar, y los estáticos volverían a salir del CDN sin pasar por Express. Ese era justo el
  agujero anterior: la CSP no llegaba a ninguna página HTML y el guardia de `cuentas.html` no
  protegía nada en producción.
- **El aviso de "no hay cuentas activas" corre fuera de `require.main === module`**, porque en
  Vercel el módulo se importa y nunca se ejecuta con `node src/server.js`.
- **Supabase activa RLS solo en cada tabla nueva** (`rls_auto_enable()`). Las doce tablas
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
`test/helpers/limpiar-esquemas.js` como `pretest`: barre esquemas huérfanos de una
corrida cortada (`process.kill(pid, 0)` contra el PID del nombre). Sigue viva una trampa de
antes: **toda petición a `/api/*` necesita sesión** — `test/helpers/sesion.js` siembra las
cuentas y devuelve la cookie. Si el test provoca logins fallidos, hay que llamar a
`app.locals.reiniciarLimites()` en el `beforeEach`: el contador vive en la tabla
`intentos_login`, no en memoria, pero sigue compartido por todos los tests del archivo (misma IP).

**Modelo de datos.** Doce tablas en `db/esquema.sql`, aplicado una sola vez contra Supabase —
ya no hay migraciones ni runner: eso vivía en SQLite y se fue con ella. `db/cambio-2026-08-roles.sql`
NO es una migración ni resucita el runner: es el ALTER de un solo uso que le puso la tabla
`roles` a la base que ya estaba desplegada. **No lo borres aunque el CRUD de roles se haya
retirado**: describe un cambio que la base real TIENE aplicado, y la tabla sigue ahí. El
estado final sigue viviendo en `esquema.sql`.

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

Autenticación, cinco tablas más y ninguna FK hacia el inventario:
`roles(nombre PK, descripcion, permisos text[], semilla)`,
`cuentas(id_cuenta PK, usuario UNIQUE lower, hash, rol FK → roles, totp_secreto, totp_ultimo_paso)`
(las dos `totp_*`, dormidas),
`sesiones(id_sesion PK, id_cuenta FK, hash_token UNIQUE, vista_en, expira_en)`,
`codigos_respaldo(id_codigo PK, id_cuenta FK, hash, usado_en)` (dormida),
`accesos(id_acceso PK, ocurrido_en, usuario texto suelto, resultado, ip)`. Y dos tablas nuevas
de esta migración, que reemplazan sendos `Map` de proceso —en Vercel hay N instancias, y un
reto o un contador guardado en una no existía para las demás—:
`retos_totp(reto PK, id_cuenta FK, expira_en)` (dormida, 2º factor pendiente, 5 min) e
`intentos_login(clave PK "ip:x"/"usuario:y", fallos, ultimo_en)` (el limitador).

- **`roles.permisos` es un `text[]` SIN `CHECK`, y NINGUNA ruta lo escribe.** Los roles son dos
  filas fijas y no hay API que las toque: reajustar lo que un rol puede hacer es un `UPDATE` a
  mano contra la base. Un CHECK con la lista de permisos sería esa misma lista escrita dos veces
  y la copia de la base envejecería sola. Que sea tabla y no el viejo `CHECK (rol IN (...))` es
  lo que permite preguntar por el permiso en vez de comparar contra la cadena `'superadmin'`.
- **`superadmin` NO lleva comodín**: tiene los tres permisos escritos. Un `*` haría que cada
  permiso nuevo cayera solo en el rol más poderoso; así, añadir uno obliga a decidir a quién.
- **`roles.semilla` no lo lee nadie ya**, y se queda: distingue el rol que abre la gestión del
  que sólo opera el almacén, y quitarlo pediría un ALTER contra la base desplegada.
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
`/css/*` y `/img/*`. **Cada pantalla se llama igual en sus tres archivos**: Principal
(`principal.html`+`principal.css`+`principal.js`, elige de lo disponible), Inventario (CRUD, y
`devolucion.js` aparte), Orden del día (`orden.*`, imprime y descuenta de verdad), Cuentas
(cuentas y bitácora) y Acceso (`login.*`). Compartidos y de nadie: `base.css`, `sesion.js` y
`devolucion.js`. El porqué de cada pantalla está en `producto/DESIGN.md` y
`producto/PRODUCT.md`.

**Los nombres de las cuatro carpetas de `public/` son reglas de autorización, no rutas.**
`esPublica()` decide por prefijo (`/css/`, `/img/`) y `PANTALLA_DE_CUENTAS` nombra
`/html/cuentas.html` y `/js/cuentas.js` literalmente. Renombrar `public/js` no daría un 404:
dejaría `/js/login.js` fuera de las rutas públicas —login roto— y `cuentas.js` sin su guardia.
Por eso la reorganización renombró los archivos y no las carpetas.

`cuentas.html` y `js/cuentas.js` son los ÚNICOS estáticos con guardia propia, en un `app.use`
colocado ANTES de `express.static` — el orden de los middlewares es lo único que lo hace
cierto. Eso no es la frontera de seguridad (lo es `exigirPermiso` en cada ruta): es no
servirle a nadie una pantalla que sólo le va a dar 403. **Y sólo es cierto en producción desde
que existe `vercel.json`**: mientras Vercel sirvió `public/` desde su CDN, esta ruta no pasaba
por Express, así que la pantalla se entregaba a cualquiera y la CSP no viajaba en ninguna
página. Verde en test y distinto en producción, que es la peor combinación.

Contratos que siguen mordiendo:

- **Nada que dependa del stock se repinta: se PARCHEA.** Es la misma razón por la que la
  fila del producto no se reconstruye (el foco del teclado se iría a `<body>` en cada
  pulsación), y ahora alcanza a tres sitios más de `principal.js`: el recuento de cada área
  (`actualizarConteosDeArea`), el de cada chip de filtro (`actualizarConteosDeFiltro`) y el
  total de la Orden del día (`actualizarResumenDeOrden`, en `orden.js`). Si alguno deja de
  llamarse, la cabecera dice "4 unidades" sobre una fila que dice "Queda 1" — y el de la
  orden **se imprime**.
- **En móvil, la fila del inventario deja UN botón: el del detalle.** Los otros tres se
  ocultan por CSS a ≤640px, así que **el modal de detalle no puede volver a quedarse sólo
  con "Cerrar"**: sus tres acciones (`#btnDetalleEditar`, `#btnDetalleAlternar`,
  `#btnDetalleEliminar`) son las únicas que hay desde un teléfono. Cierran el detalle
  ANTES de actuar, porque dos de ellas abren otra ventana encima y el modal de abajo se
  quedaría atrapando los clics de fuera.
- **`--ancho-pagina` de Orden del día ya no es el de la hoja.** Era `var(--ancho-hoja)` para
  que el nav no saliera más ancho que el papel; con cuatro enlaces, la sesión y el botón de
  imprimir eso envolvía en tres filas. Ahora son 1060px —medido, no redondo— y el `@media`
  que baja el botón al pulgar usa ese mismo número.
- **La clase que `sesion.js` pone en `<html>` es POR PERMISO, no por rol**
  (`permiso-productos-eliminar`), y el CSS pregunta en negativo
  (`:root:not(.permiso-productos-eliminar) .btn-delete`). Con `rol-admin` —como estaba— haría
  falta una regla por rol, y el día que un permiso se mueva de sitio hay que repasarlas todas
  para que el botón de borrar no reaparezca justo para quien no debe verlo.
- **`sessionStorage` mueve la orden en tres claves que van SIEMPRE juntas**: `ordenSeleccion`
  (las líneas), `ordenAplicada` (`"true"` tras el descuento), `ordenId` (el número impreso).
  Quien reescriba `ordenSeleccion` borra las otras dos —selección distinta, otra orden— o acaba
  devolviendo la orden equivocada, que no se deshace.
- **CSP y escapado, dos capas contra XSS.** `script-src 'self'` prohíbe `onclick=`,
  `style=` y `<style>` en el markup (detalle en `server.js`); lo que teclea el usuario se
  escapa antes de `innerHTML` (`escapar()` en `inventario.js`, `escaparHtml()` en `orden.js`).
- **Para verificar el `@media print` no sirve `getComputedStyle`**: en un hijo de un elemento
  oculto devuelve su propio `display`, no `none`, y da por bueno lo que en papel no se ve. Usa
  `elemento.checkVisibility()` —mira los ancestros— con `page.emulateMedia({ media: 'print' })`.
- **Se probó preguntar «¿salió bien el papel?» tras imprimir, y se retiró**: el aviso previo
  ya lo dijo, y dudar de un descuento ya aplicado no ayuda —la razón vive en un comentario de
  `orden.js`; que se probó y se quitó, no.

## Autenticación

**Dos roles fijos, pero el guardia pregunta por el PERMISO.** Los roles son `superadmin` y
`admin`, y no hay forma de crear ni editar ninguno: no queda ninguna ruta que escriba
`roles`. Aun así `exigirSuperadmin` (que comparaba contra la cadena `'superadmin'`) NO
existe: en su sitio está `exigirPermiso('cuentas.gestionar')` y compañía, leyendo
`roles.permisos`. La diferencia importa en dos sitios — el CSS del frontend, que esconde por
permiso y no por rol, y `hayOtroGestor()`, que cuenta quién puede gestionar sin saberse el
nombre del rol.

Los permisos se resuelven en la MISMA consulta que resuelve la sesión —un JOIN con `roles`—,
así que el rol y lo que permite se releen en cada petición y mover a alguien de rol surte
efecto en la siguiente, no dentro de doce horas. Por eso cambiar el rol de una cuenta NO
cierra sesiones; restablecer una contraseña sí, y por otro motivo: ahí se sospecha que
alguien tiene la anterior.

Son tres permisos, y los tres son de `superadmin`: `productos.eliminar`, `cuentas.gestionar`
y `accesos.ver` — exactamente lo que separa a admin de superadmin. `admin` va con la lista
VACÍA y hace todo lo demás: ver el inventario, editarlo, emitir órdenes y recibir
devoluciones siguen abiertos a cualquier sesión.

**Se probó una pantalla que creaba roles a medida, y se retiró** (2026-08-29). Con dos roles
no hacía falta, y un CRUD de roles es una manera fácil de dejarse fuera solo. Lo que quedó de
ella: la tabla `roles` (con la fila `admin` a cero permisos y `semilla` sin lectores), el
`GET /api/roles` de sólo lectura que llena el `<select>` del alta, y `exigirPermiso`. Lo que
NO quedó: `PERMISOS`, `revisarPermisos`, `ROL_VALIDO`, las tres rutas de escritura y la
sección Roles de la pantalla. Si vuelve, vuelve con su catálogo — no antes.

**Un invariante que el servidor impone y ningún cliente puede saltarse**: nunca puede quedar
cero cuentas activas con `cuentas.gestionar`. Generaliza el viejo guardia del "último
superadmin", vive en `hayOtroGestor()` de `server.js` y está repetido en `scripts/cuenta.js`
porque el script escribe la base sin pasar por la API. Con el CRUD de roles fuera quedan dos
maneras de romperlo y las dos pasan por una cuenta —bajarla o moverla a `admin`—; la tercera,
quitarle el permiso al rol, ya no tiene puerta.

Lo demás sigue igual que en SQLite —y comentado en detalle en `server.js`—: guardia que
**deniega por defecto**, SHA-256 del token en `sesiones` (nunca el token), nada de
`localStorage` (cookie `HttpOnly`), sin `cors()`, `Origin` que acepta que falte (`curl`, no un
navegador), límite de intentos que retrasa y no bloquea cuentas. **Un solo factor**: usuario y
contraseña, sin segundo paso (el TOTP se retiró; ver «Estado conocido»).
**`cuentas` nunca tiene filas en el repo** —ya no hay ni `.db3` versionado que pudiera
llevarlas—: la primera se crea con `scripts/cuenta.js` en cada despliegue y las demás ya desde
`/html/cuentas.html`.

**Las reglas de usuario y contraseña viven en `auth.js`** (`revisarUsuario`, `revisarClave`) y
NO en quien las usa. Hay dos puertas por las que nace una cuenta —la pantalla y el script— y
con las reglas escritas dos veces, la segunda copia es la que se afloja el día que estorbe.

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
  `.superpowers/`, `*.bak` y `.env`. **Ya no hay ninguna base de datos versionada** —`db/inventario.db3` se
  borró junto con SQLite—; sólo `db/esquema.sql` y `certs/` (la CA del pooler) viajan.
- **El segundo factor está DORMIDO, no borrado, y es deliberado.** Se retiró el 2026-08-28
  (la spec vive en `docs/`, que no se versiona): el login es de un solo paso. Pero siguen
  ahí, sin un solo lector, las 9 exportaciones TOTP de `auth.js` con
  sus tests de `cripto.test.js`, las columnas `cuentas.totp_secreto` / `totp_ultimo_paso` y
  las tablas `codigos_respaldo` / `retos_totp`. **No las borres por parecer restos**: la
  decisión fue que volver al 2º factor cueste recablear y no rehacer una migración contra
  la base real. Dos trampas concretas: `test/helpers/sesion.js` DEBE seguir truncando
  `codigos_respaldo` y `retos_totp` junto a `cuentas` —tienen FK, y Postgres rechaza el
  TRUNCATE con `0A000` si no van en la misma sentencia, aunque estén vacías—, y hay un test
  guardián en `auth.test.js` que siembra `totp_secreto` y exige que el login la ignore.
