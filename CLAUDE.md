# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

Inventario de almacén para "Ok-producciones": Express 5 + Postgres (Supabase) sirviendo un
frontend estático de HTML/CSS/JS sin framework ni build step. El código vive en `server.js`
(backend, monolítico), `auth.js` (criptografía de la autenticación), `db.js` (la única puerta
al pool de Postgres), `public/` (frontend) y `scripts/cuenta.js` (alta de cuentas). **Dos
dependencias en total**: `express` y `pg`. Antes de añadir una tercera, mira si `node:crypto`
ya lo hace — es lo que se hizo con scrypt y TOTP.

El código y los comentarios están en español. Mantén ese idioma al escribir código o mensajes
de commit aquí.

## Comandos

```bash
npm install                    # sólo JS: pg no compila nada nativo (a diferencia de sqlite3)
npm start                      # --env-file=.env, arranca en :3000 (PORT lo cambia)
npm test                       # 112 tests con el runner nativo de node

# Sin cuentas no se puede entrar a ninguna pantalla: no hay ninguna por defecto.
node --env-file=.env scripts/cuenta.js crear almacen --rol admin
node --env-file=.env scripts/cuenta.js crear erick --rol superadmin --sin-totp
node --env-file=.env scripts/cuenta.js listar
```

Un solo archivo: `node --env-file=.env --test test/auth.test.js`.
Un solo test: añade `--test-name-pattern "elimina el producto"` a lo anterior.

El glob de `npm test` (`node --test "test/**/*.test.js"`) va entrecomillado a propósito: sin
comillas lo expande el shell, y `node --test test/` falla con `MODULE_NOT_FOUND` porque Node
resuelve la ruta como módulo, no como directorio.

No hay linter configurado.

Inspeccionar la base: `execute_sql` del MCP de Supabase, o `psql "$DATABASE_URL"`. Ya no hay
ningún `node -e` con `sqlite3`.

## Arquitectura

**Backend — `server.js`, `auth.js` y `db.js`.** `server.js` sigue siendo el monolito:
middlewares, guardia, rutas y `app.listen()`. `auth.js` es lo único que se sacó por no
depender de HTTP —scrypt, tokens de sesión, TOTP, códigos de respaldo— y se prueba sin
levantar servidor (`test/cripto.test.js`). `db.js` es la ÚNICA puerta a Postgres: nadie más
construye un `Pool` ni lee una cadena de conexión. Expone `consultar()` (una consulta suelta
contra el pool) y `enTransaccion(fn)` (un cliente dedicado del pool con `BEGIN`/`COMMIT`, que
hace `ROLLBACK` y decide si el cliente vuelve al pool o se destruye si el propio `ROLLBACK`
falla).

Dos ganchos existen sólo para poder testear: `app.listen()` va envuelto en
`require.main === module` para que importar el módulo no abra puerto, y el final exporta la
app con `pool` colgado en `app.locals` para cerrarlo en el teardown. (El tercero de antes,
`DB_PATH`, se fue con SQLite: la conexión sale de `DATABASE_URL` / `DATABASE_URL_TEST`,
leídas dentro de `db.js`.)

**Doce cosas que se aprendieron migrando de SQLite y muerden si se editan a ciegas:**

- `db.js` construye el pool UNA vez, al cargarse. `DATABASE_URL_TEST` tiene prioridad sobre
  `DATABASE_URL` para que ni el peor test, con las dos variables puestas, pueda escribir
  sobre la base real.
- **`orden_lineas.id_producto` no tiene clave foránea, y es la única del esquema que no la
  lleva.** En SQLite las `REFERENCES` eran decorativas y el diseño depende de eso a
  propósito: `DELETE /api/productos/:id` es una operación real de superadmin, y las líneas
  huérfanas que deja son parte del registro histórico, no un defecto. Declarar la FK
  convertiría esa decisión de producto en un `23503`.
- **`(p.id_producto IS NOT NULL)::int AS existe`, en `SQL_LINEAS_DE_ORDEN`.** Sin el `::int`
  Postgres devuelve booleano, el `=== 1` de más abajo falla siempre, y
  `POST /api/ordenes/:id/devolucion` responde 200 sin reponer nada — éxito aparente, material
  perdido. El mismo patrón se repite en `con_totp` (`GET /api/cuentas`) y en el aviso de
  arranque (`count(*)::int`): `pg` no da enteros ni booleanos gratis donde `sqlite3` sí.
- **`FOR UPDATE ... ORDER BY id_producto`, en `POST /api/ordenes`.** Sustituye a la
  serialización que daba SQLite con una sola conexión: sin el candado de fila, dos órdenes
  simultáneas pasan las dos la comprobación de stock y lo dejan en negativo. El `ORDER BY`
  evita que dos órdenes con los mismos productos en distinto orden se esperen en círculo.
- **Las lecturas de `POST /api/ordenes/:id/devolucion` ya van DENTRO de la transacción.**
  Antes iban fuera porque había una sola conexión de módulo y un `ROLLBACK` —el camino
  normal, teclear mal un número— se llevaba por delante lo que otra petición estuviera
  escribiendo. Con un cliente dedicado por transacción esa razón desapareció.
- **Dos poolers de Supabase, no uno**: el de transacción (`:6543`) en producción, el de
  sesión (`:5432`) en los tests. El de transacción no garantiza que un `SET search_path`
  sobreviva entre transacciones, y el aislamiento por esquema de los tests depende de eso.
- **Un esquema Postgres por archivo de test.** `ESQUEMA_BD` se fija **antes** del
  `require('../server.js')` —igual que `DB_PATH` antes, sólo que ahora lo hace cumplir
  `test/helpers/db.js`, que revienta si `db.js` ya estaba en `require.cache` (llegaría
  tarde). Toda función que trunque llama primero a `exigirEsquemaDePruebas()`, y todo el DDL
  de esquema (`CREATE`/`DROP SCHEMA`) pasa por el candado de aviso de
  `test/helpers/candado.js` (`pg_advisory_xact_lock`) para que dos corridas no se
  interbloqueen. Lo que está en juego si algo de esto falla: la suite ejecutando `TRUNCATE`
  sobre `public`, la base real del almacén.
- **`CONFIAR_EN_PROXY=1` es obligatoria en Vercel.** Sin ella `req.ip` es la IP del proxy para
  todo el mundo, y el limitador de intentos por IP se convierte en un bloqueo global.
- **El aviso de "no hay cuentas activas" corre fuera de `require.main === module`.** En
  Vercel el módulo se importa y nunca se ejecuta con `node server.js`, así que algo que
  dependiera de esa condición no correría nunca en un despliegue nuevo.
- **Supabase trae un event trigger, `rls_auto_enable()`, que activa RLS en cada tabla nueva
  de `public`.** Las once tablas tienen RLS activo y CERO políticas, y ÉSE es el estado
  correcto: `anon`/`authenticated` no leen nada, y la app entra como dueño por `pg` y lee
  todo. **No crear políticas RLS**: no gobernarían ningún acceso real, porque nada entra
  como `anon`/`authenticated`.
- **El avance de una secuencia (`GENERATED ... AS IDENTITY`) no es transaccional.** Un
  `ROLLBACK` no lo revierte. Por eso `areas` ya se saltó un id durante la migración: no es un
  bug, es cómo funcionan las secuencias en cualquier Postgres.
- **`pg` no cancela la consulta al agotar `query_timeout`**: rechaza la promesa, pero la
  sentencia sigue corriendo en el servidor. Por eso `enTransaccion` decide cómo soltar el
  cliente según si el propio `ROLLBACK` tuvo éxito: si falló, lo DESTRUYE (`release(true)`)
  en vez de devolverlo al pool con una transacción todavía abierta dentro — el único hueco
  por el que una transacción podría cruzar de una petición a la siguiente.

**Tests — `test/`.** Runner nativo de Node, cero dependencias extra. Cada archivo corre en su
propio proceso (el runner los paraleliza) y por eso cada uno vive en su propio esquema,
sembrado por `test/helpers/db.js`; la app se levanta en puerto efímero (`listen(0)`) y se
consulta con `fetch`. `npm test` corre antes `scripts/limpiar-esquemas-de-prueba.js` como
`pretest`: barre esquemas huérfanos de una corrida cortada, comprobando con
`process.kill(pid, 0)` si el proceso dueño sigue vivo. Nunca se escribe sobre `public`.

Sigue viva una trampa de antes: **toda petición a `/api/*` necesita sesión.**
`test/helpers/sesion.js` siembra las cuentas y devuelve la cookie; los tests de negocio la
piden una vez en `before` y la reenvían desde sus helpers. Si el test provoca logins
fallidos, hay que llamar a `app.locals.reiniciarLimites()` en el `beforeEach`: el contador
vive ahora en la tabla `intentos_login` y no en memoria, pero sigue siendo compartido por
todos los tests del archivo (misma IP), así que uno dejaría bloqueados a los siguientes.

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

cuentas                              sesiones                retos_totp
┌──────────────────┬──────────────┐  ┌────────────┬────────┐ ┌──────────┬───────────┐
│ id_cuenta         │ INTEGER PK  │◄─┤ id_cuenta  │ FK     │ │ reto     │ PK, 5 min │
│ usuario           │ UNIQUE lower│  │ hash_token │ SHA-256│ │ id_cuenta│ FK        │
│ hash              │ scrypt$N$r$p│  │ vista_en   │ inact. │ │ expira_en│ TEXT      │
│ rol,totp_secreto  │             │  │ expira_en  │ techo  │ └──────────┴───────────┘
│ totp_ultimo_paso  │ anti-replay │  └────────────┴────────┘ intentos_login
└──────────────────┴──────────────┘  codigos_respaldo        ┌───────┬───────────┐
                                      ┌───────────┬───┐       │ clave │ PK ip/usr │
                                      │ id_cuenta │FK │       │ fallos│ integer   │
accesos                               │ hash,usado│   │       │ultimo_en│ TEXT    │
┌─────────────┐                       └───────────┴───┘       └───────┴───────────┘
│ ocurrido_en │
│ usuario,ip  │
│ resultado   │
└─────────────┘
```

- **La cantidad vive en el producto**, no en una tabla puente. `activo` decide si el producto
  aparece en la Principal.
- **`ordenes`/`orden_lineas` son el registro histórico de lo que salió**, escrito en el MISMO
  `COMMIT` que el descuento. Las líneas van agrupadas por producto, igual que el descuento;
  `orden_lineas.nombre` duplica el del producto a propósito —si éste se renombra o se
  borra, la orden vieja debe seguir diciendo qué salió—, y lo escribe el servidor desde su
  propio `SELECT`, nunca el cliente.
- **`devoluciones` cierra el ciclo**: una fila = "esta orden volvió completa". El `UNIQUE` en
  `id_orden` es la pieza importante, no un adorno: hace de "una orden se devuelve una sola
  vez" una garantía de la base y no un `if`. Devolver no reescribe `ordenes` ni
  `orden_lineas`: son un registro, no un saldo.
- **`retos_totp` e `intentos_login` reemplazan dos `Map` de proceso** que vivían en memoria
  del servidor SQLite: en Vercel hay N instancias, así que un reto guardado en la instancia A
  o un contador de fallos en la instancia B no existían para las demás. Ahora ambos viven en
  la base y cualquier instancia los ve igual.
- **`accesos.usuario` guarda lo que se TECLEÓ**, exista o no esa cuenta, y por eso es texto
  suelto y no una FK: los intentos contra nombres inventados son justo los que delatan un
  ataque, y una FK los haría imposibles de registrar.
- `usuarios` e `historial_login` (la contraseña en texto plano `admin`/`1234`) no llegaron a
  este esquema: se habían borrado ya en SQLite antes de la migración a Postgres.

**Frontend — `public/`.** Servido como estático, detrás del guardia salvo `/login`,
`/js/login.js`, `/css/*` y `/img/*`. Tres pantallas con roles separados, más el login:
Principal (`index.html`+`logica.js`, elige de lo disponible), Inventario
(`inventario.html`+`edit.js`, CRUD y `devolucion.js` para recibir), Orden del día
(`orden_del_dia.html`+`orden.js`, imprime y descuenta de verdad). `sesion.js` es compartido
por las tres, cargado siempre primero. Nada de esto lo tocó la migración; ver `DESIGN.md` y
`PRODUCT.md` para el porqué de cada pantalla.

Tres contratos que siguen mordiendo:

- **`sessionStorage` mueve la orden entre pantallas en tres claves que van SIEMPRE juntas**:
  `ordenSeleccion` (array de líneas), `ordenAplicada` (`"true"` tras el descuento) y
  `ordenId` (el número impreso). Quien reescriba `ordenSeleccion` debe borrar las otras dos
  —una selección distinta es otra orden— o alguien acaba devolviendo la orden equivocada,
  que no se deshace. Cada pantalla lo hace desde su propia `guardarSeleccion()`.
- **CSP `script-src 'self'; style-src 'self'`, cero manejadores en atributo.** No vuelvas a
  escribir `onclick=`, `style=` ni un `<style>` en el markup; el navegador no los ejecuta y
  `'unsafe-inline'` anularía la mitad de la defensa contra XSS.
- **Todo lo que teclea el usuario se escapa antes de ir a `innerHTML`** (`escapar()` en
  `edit.js`, `escaparHtml()` en `orden.js`): un producto llamado `<img src=x onerror=...>`
  se ejecutaría al abrir Inventario si no.

## Autenticación

Dos roles: `admin` (todo lo operativo) y `superadmin` (además, cuentas, bitácora y
**borrar** productos —el criterio es «irreversible», no «peligroso»). Lo que sigue igual que
en SQLite: el guardia **deniega por defecto** (una ruta nueva nace protegida); en `sesiones`
se guarda el SHA-256 del token, nunca el token; nada de `localStorage` para la cookie
(`HttpOnly`); `cors()` no vuelve; el guardia de `Origin` acepta que falte (lo manda todo
navegador en peticiones con efectos; quien no lo manda es `curl`); el límite de intentos
retrasa y no bloquea cuentas; el TOTP rechaza cualquier paso **menor o igual** al último
consumido. **`cuentas` nunca tiene filas en el repo** —ya no hay ni `.db3` versionado que
pudiera llevarlas— y se crean con `scripts/cuenta.js` en cada despliegue; el servidor avisa
al arrancar si no hay ninguna activa (ver el ítem de Vercel, arriba).

**Dos caminos escriben stock, y sólo dos**: `POST /api/ordenes` descuenta (agrupa líneas
repetidas antes de comparar contra el stock, todo dentro de una transacción con
`FOR UPDATE`) y `POST /api/ordenes/:id/devolucion` repone (`cantidad = cantidad + ?`, mapea
el `23505` del `UNIQUE` a 409). Los detalles de por qué cada uno es como es están en los
doce puntos de arriba y en los comentarios del propio `server.js`.

## Estado conocido (no son bugs que introdujiste)

- **Hay productos duplicados en el catálogo**, arrastrados del volcado de un solo uso desde
  SQLite: `BT3` existe como id 5 y 7, `Array` como 6 y 8; los ids 5, 6 y 11 quedaron sin área
  y con cantidad 0. No se fusionaron a propósito — se limpian desde el CRUD.
- Sí hay `.gitignore`: excluye `node_modules/`, `docs/`, `.claude/`, `.playwright-mcp/`,
  `*.bak` y `.env`. **Ya no hay ninguna base de datos versionada** —`db/inventario.db3` se
  borró junto con SQLite—; sólo `db/esquema.sql` (el DDL) y `db/certs/` (la CA pública del
  pooler) viajan en el repo.
