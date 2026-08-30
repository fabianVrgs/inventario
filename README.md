# Inventario — Ok-producciones

Inventario de almacén para eventos. Se carga el catálogo de equipos, se arma la lista del día
eligiendo qué sale y en qué cantidad, y se imprime la orden. **Al imprimir, el stock baja de
verdad.**

Express 5 + Postgres (Supabase) sirviendo un frontend estático de HTML/CSS/JS. Sin framework,
sin build step, sin transpilación: lo que está en `public/` es literalmente lo que corre en
el navegador.

## Arrancar

Requiere Node 20.6 o superior —el mínimo real de `--env-file`, que usan `npm start`,
`npm test` y cada llamada a `scripts/cuenta.js` de este README; con Node 18 nada de eso
arranca— y un proyecto de Supabase (o cualquier Postgres) con `db/esquema.sql` ya aplicado.

1. **Base de datos.** Aplica el esquema una sola vez contra tu proyecto (SQL Editor de
   Supabase, o `psql "$DATABASE_URL" -f db/esquema.sql`). No es una migración: es DDL de una
   sola pasada, pensado para correr una vez por base.
2. **Variables de entorno.** Copia `.env.example` a `.env` y rellena las cadenas de conexión:

   ```bash
   cp .env.example .env
   ```

   | Variable | Para qué |
   |---|---|
   | `DATABASE_URL` | Pooler en modo **transacción** (puerto `6543`). El que usa producción. |
   | `DATABASE_URL_TEST` | Pooler en modo **sesión** (puerto `5432`). Sólo lo usan los tests: el modo transacción no garantiza que un `SET search_path` sobreviva entre transacciones, y el aislamiento de la suite depende de eso. |
   | `CONFIAR_EN_PROXY` | `1` detrás de un proxy inverso o en Vercel; en blanco en tu máquina. |
   | `ORIGEN_PERMITIDO` | Opcional, no viene en `.env.example`. Sólo hace falta si el `Host` que llega no coincide con tu dominio público. |

   `certs/supabase-ca.crt` (el certificado del pooler) sí va en el repo: es público, no un
   secreto, y sin él `pg` no puede verificar la conexión TLS.

3. **Instalar y crear la primera cuenta.** No hay ninguna cuenta por defecto —una aplicación
   que se despliega con `admin`/`admin` ya está comprometida antes de arrancar— y sin al
   menos una no se puede entrar a ninguna pantalla. El servidor lo avisa al arrancar y, con
   `NODE_ENV=production`, se niega a hacerlo: mejor un fallo ruidoso que una aplicación
   publicada a la que nadie puede entrar.

   ```bash
   npm install
   node --env-file=.env scripts/cuenta.js crear erick --rol superadmin
   npm start                                          # http://localhost:3000
   ```

   Con esa primera cuenta ya se entra a **Cuentas** (`/html/cuentas.html`) y las demás se
   crean desde ahí, sin volver a la terminal.

El script pide la contraseña por teclado y **sin eco**; nunca por argumento, porque `argv`
acaba en el historial del shell y es visible en `ps` para todos los usuarios de la máquina.

Desde que existe la pantalla de **Cuentas**, esto es sobre todo la vía de arranque y de
rescate: crear la primera cuenta, o recuperar el acceso desde el servidor. Las altas del día
a día se hacen en el navegador. Los roles son dos y no se crean en ninguno de los dos sitios;
`roles` los enseña.
Para automatizar, por tubería:

    echo 'Almacen2026Prueba!' | node --env-file=.env scripts/cuenta.js crear almacen --rol admin

### Qué puede cada rol

Hay **dos roles**, y son fijos: `superadmin` y `admin`. Viven como filas en la tabla `roles`
con la lista de **permisos** que cada uno lleva, y nada los crea ni los edita — ni la web ni
el script. Son tres permisos, y es corto a propósito:

| Permiso | Qué abre | superadmin | admin |
|---|---|:--:|:--:|
| `productos.eliminar` | **Borrar** un producto del catálogo | ✅ | — |
| `cuentas.gestionar` | La pantalla de cuentas: altas, roles y contraseñas | ✅ | — |
| `accesos.ver` | La bitácora de accesos | ✅ | — |

**Todo lo demás no tiene permiso porque no lo necesita**: elegir material, emitir órdenes,
recibir devoluciones y dar de alta, editar o desactivar productos los puede hacer cualquier
cuenta con sesión. El criterio de lo que sí lleva permiso no es "es peligroso" sino
**"es irreversible"**: desactivar un producto se deshace con un clic y editarlo también;
borrarlo se lleva la fila por delante y deja huérfanas sus `orden_lineas`, y con ellas la
devolución de esa orden.

Dicho de otro modo: **el admin hace todo el almacén y el superadmin además administra**. La
pantalla de **Cuentas** (`/html/cuentas.html`) —altas, cambios de rol, contraseñas y la
bitácora— es lo único que el admin no ve; el servidor ni siquiera se la sirve.

Se probó tener una pantalla que creara roles a medida marcando casillas, y se retiró: un
almacén con dos roles no la necesitaba, y un CRUD de roles es una manera fácil de dejarse
fuera solo. Reajustar lo que un rol puede hacer es hoy un `UPDATE` a mano sobre
`roles.permisos`, y por eso el guardia sigue preguntando por el permiso y no por el nombre:
mover a alguien de rol surte efecto en su siguiente petición.

Un guardarraíl que el servidor impone y no se puede saltar desde ninguna pantalla:

- **Nunca puede quedar cero cuentas activas con `cuentas.gestionar`.** Dar de baja a la
  última o moverla a `admin` responden `409`: quedarse sin ninguna cerraría la gestión por
  dentro, sin forma de reabrirla desde la web.

### Antes de publicar

```bash
node --env-file=.env scripts/cuenta.js clave erick        # contraseña de verdad, mínimo 12 caracteres
node --env-file=.env scripts/cuenta.js clave almacen
node --env-file=.env scripts/cuenta.js cerrar-sesiones    # cierra lo que quedara abierto
```

Órdenes completas del script:

    node --env-file=.env scripts/cuenta.js listar
    node --env-file=.env scripts/cuenta.js roles                 # los dos roles y qué permite cada uno
    node --env-file=.env scripts/cuenta.js crear <usuario> --rol <rol>
    node --env-file=.env scripts/cuenta.js clave <usuario>       # cambia la clave Y cierra sus sesiones
    node --env-file=.env scripts/cuenta.js rol <usuario> <rol>
    node --env-file=.env scripts/cuenta.js baja <usuario> | alta <usuario>
    node --env-file=.env scripts/cuenta.js cerrar-sesiones [usuario]

## Cómo está organizado

    vercel.json            punto de entrada y enrutado del despliegue, explícitos
    src/
      server.js             backend: guardia y todas las rutas (monolito a propósito)
      auth.js               criptografía: scrypt, tokens de sesión, y TOTP dormido (ver «Estado conocido» en CLAUDE.md)
      db.js                 única puerta a Postgres: el pool, consultar() y enTransaccion()
    scripts/cuenta.js      alta y gestión de cuentas desde la terminal (crea la primera)
    public/                lo que sirve express.static, tal cual corre en el navegador
      html/                una página por pantalla, más login.html
      css/                 base.css (tokens y primitivas) + una hoja por pantalla
      js/                  un archivo por pantalla, más sesion.js y devolucion.js
    db/
      esquema.sql           el DDL completo, aplicado una sola vez
      cambio-2026-08-roles.sql   cambio de un solo uso sobre la base ya desplegada
    certs/supabase-ca.crt  CA pública del pooler, versionada a propósito (NO bajo db/)
    test/
      api.test.js           reglas de negocio
      auth.test.js           guardia, sesiones, CSRF, fuerza bruta
      cuentas.test.js        altas, contraseñas, permisos y sus guardarraíles
      cripto.test.js         auth.js, sin levantar servidor
      db.test.js             db.js contra Postgres real: consultar, enTransaccion, aislamiento
      helpers/db.js          crea/borra el esquema de cada archivo de test y lo siembra
      helpers/sesion.js      siembra cuentas y devuelve la cookie
      helpers/candado.js     serializa el DDL de esquema entre procesos de test
      helpers/limpiar-esquemas.js   barre esquemas huérfanos de una corrida cortada (pretest)
    producto/
      DESIGN.md             el sistema visual: tokens, primitivas, decisiones
      PRODUCT.md            para qué existe cada pantalla y qué se dejó fuera
    CLAUDE.md              guía para agentes; incluye las trampas del repo

Cada pantalla es su propio trío `html` + `css` + `js`, y **los tres se llaman igual**:
`principal`, `inventario`, `orden`, `cuentas`, `login`. Lo único compartido son `base.css`,
`sesion.js` y `devolucion.js`, que no pertenecen a ninguna.

Dos nombres de carpeta que conviene no tocar sin leer antes:

- **`public/css`, `public/js`, `public/img` y `public/html`** no son sólo rutas: son reglas de
  autorización. El guardia decide qué es público por prefijo (`/css/`, `/img/`) y protege la
  pantalla de gestión nombrando `/html/cuentas.html` y `/js/cuentas.js`. Renombrar una de esas
  carpetas no da un 404 — deja el login sin su CSS o la gestión sin guardia.
- **`producto/` y no `doc/`**, porque `docs/` está en `.gitignore` y se diferencia en una
  letra: un typo dejaría el archivo fuera del repo sin avisar.

## Las tres pantallas

| Pantalla | Ruta | Qué hace |
|---|---|---|
| **Principal** | `/` | Elegir de lo disponible, con cantidad. No edita el catálogo. |
| **Inventario** | `/html/inventario.html` | Administrar el catálogo: alta, edición, activar/desactivar, borrado, export CSV. Y **recibir devoluciones**. |
| **Orden del día** | `/html/orden.html` | Revisar el formato, ajustarlo e imprimir. Aquí es donde baja el stock. |

El flujo va de izquierda a derecha: catálogo en Inventario → selección en la Principal →
revisión en Orden del día → imprimir. Y cierra el círculo volviendo a Inventario cuando el
material regresa: se teclea el N.º impreso en la orden y se repone de una vez todo lo que
salió.

Cinco reglas de negocio explican casi todo el diseño:

- **`activo` separa "existe en el catálogo" de "se puede pedir hoy".**
- **Imprimir dos veces descuenta una sola vez.**
- **Recibir dos veces la misma orden repone una sola vez**, garantizado por un `UNIQUE` en la
  base y no por un `if`.
- **Ajustar la orden se puede hasta el momento de imprimir**, desde la Principal o desde la
  propia Orden del día. Después queda cerrada, y se cierra del todo con "Empezar una nueva
  orden".
- **Cada orden emitida queda registrada** en `ordenes`/`orden_lineas`, dentro de la misma
  transacción que el descuento; y su regreso en `devoluciones`.

La orden viaja entre pantallas por `sessionStorage`, en tres claves que se mueven **juntas**:
`ordenSeleccion` (la lista elegida), `ordenAplicada` (si ya se descontó) y `ordenId` (el
número impreso, el que se teclea para devolver). Quien cambia la selección borra las otras
dos — el detalle completo, y por qué, está en `CLAUDE.md`.

## Probar

    npm test                                                 # los 128 tests
    node --env-file=.env --test test/auth.test.js            # un solo archivo
    node --env-file=.env --test --test-name-pattern "elimina el producto"   # un solo test

Runner nativo de Node, cero dependencias de test. Cada archivo levanta la app en un puerto
efímero contra su propio esquema de Postgres (`inventario_test_<pid>`); **nunca se escribe
sobre `public`**, que es donde vive el inventario real.

Desde que el guardia deniega por defecto, toda la suite necesita sesión:
`test/helpers/sesion.js` siembra las cuentas y devuelve la cookie. Los tests que más valen son
los de `auth.test.js` que comprueban que algo **no** pasa: que el hash guardado en `sesiones`
no sirve como cookie, que el rol no escala desde el cliente, que el admin recibe 403 al
borrar **y el producto sigue existiendo después**.

## La API

Todo vive en `src/server.js`. Todas las rutas exigen sesión salvo `/api/auth/login` y `/api/salud`;
las peticiones a `/api/*` sin sesión reciben `401`, la navegación a una pantalla HTML un `302`
al login.

| Método | Ruta | Para qué |
|---|---|---|
| POST | `/api/auth/login` | Entrar. Devuelve la cookie de sesión |
| POST | `/api/auth/salir` | Cerrar sesión |
| GET | `/api/auth/yo` | `{ usuario, rol, permisos }`, para pintar la barra y esconder lo que no toca |
| GET | `/api/cuentas` | Listar cuentas — `cuentas.gestionar` |
| POST | `/api/cuentas` | Crear una cuenta — `cuentas.gestionar` |
| PATCH | `/api/cuentas/:id/activa` | Dar de alta o de baja — `cuentas.gestionar` |
| PATCH | `/api/cuentas/:id/rol` | Cambiar su rol — `cuentas.gestionar` |
| POST | `/api/cuentas/:id/clave` | Restablecer su contraseña y cerrar sus sesiones — `cuentas.gestionar` |
| GET | `/api/roles` | Los dos roles, para el `<select>` del alta — `cuentas.gestionar` |
| GET | `/api/accesos` | Bitácora de los últimos 200 accesos — `accesos.ver` |
| GET | `/api/productos` `?activo=1` | Catálogo completo, o sólo lo disponible |
| POST/PUT/DELETE | `/api/productos[/:id]` | CRUD. Borrar exige `productos.eliminar` |
| PATCH | `/api/productos/:id/activo` | Activar / desactivar |
| GET | `/api/areas` | Poblar el selector de área |
| POST | `/api/ordenes` | Confirmar la orden, descontar y registrarla |
| GET | `/api/ordenes/:id` | Leer una orden emitida y si ya se devolvió |
| POST | `/api/ordenes/:id/devolucion` | Recibir la orden y reponer su stock |
| GET | `/api/salud` | `{ ok: true }` tras un `SELECT 1`. **Sin sesión** — ver abajo |

**`/api/salud` existe para que Supabase no pause el proyecto.** El plan gratuito lo duerme
tras ~7 días sin actividad, y un almacén puede pasar semanas sin emitir una orden. Por eso
la ruta toca la base de verdad: un ping que sólo despertara a Vercel dejaría dormir al que
se pausa. La llama a diario `.github/workflows/mantener-supabase-despierto.yml`, y se puede
lanzar a mano desde la pestaña Actions. No lee ni revela ningún dato, que es lo que permite
servirla sin sesión.

**Hay exactamente dos caminos que escriben stock**: `POST /api/ordenes` descuenta y
`POST /api/ordenes/:id/devolucion` repone. Ninguna otra ruta toca `productos.cantidad` salvo
el CRUD, que la fija a mano.

## Cómo está protegido

| Amenaza | Qué la para |
|---|---|
| Entrar sin credenciales | Guardia que deniega por defecto: todo exige sesión salvo login y sus recursos. |
| Robo de sesión por XSS | Cookie `HttpOnly` — el token no toca `localStorage`. CSP `script-src 'self'`, cero manejadores en línea, escapado de todo lo que teclea el usuario. |
| CSRF | `SameSite=Strict` + rechazo de todo método con efectos cuyo `Origin` no sea el propio. |
| Fuerza bruta | Retraso creciente por IP y por usuario (2 s, 4 s, 8 s… hasta 15 min). Sin bloqueo de cuenta. |
| Enumerar usuarios | Mismo mensaje y mismo tiempo para usuario inexistente y contraseña mala. |
| Robo de la base | scrypt N=2^16 con sal por cuenta; de las sesiones sólo el SHA-256 del token. RLS activo en las doce tablas, sin políticas: `anon`/`authenticated` no leen nada. |
| Contraseña filtrada | **Nada.** El segundo factor se retiró a propósito (ver «Estado conocido» en `CLAUDE.md`): es el riesgo aceptado a cambio de un login de un solo paso. |
| Escalada de rol | El rol y sus permisos se releen de la base en CADA petición, en la misma consulta que resuelve la sesión: mover a alguien de rol surte efecto en la siguiente, no dentro de doce horas. Y ninguna ruta escribe `roles.permisos`, así que no hay forma de darse permisos desde dentro. |
| Quedarse fuera de la gestión | El servidor rechaza con `409` cualquier cambio que deje cero cuentas activas con `cuentas.gestionar`, y `superadmin` no se puede editar ni borrar. |
| Escucha de red | HTTPS obligatorio en producción (cookie `Secure` + HSTS), terminado por el proxy. |

La sesión dura **12 horas** como techo absoluto y se cierra sola tras **2 horas** sin
actividad. Cerrar sesión borra también las tres claves de `sessionStorage`.

## Publicar en internet

La aplicación no termina TLS ella misma: eso lo hace un proxy inverso o la propia plataforma
(Vercel, Railway…) delante.

En Vercel el despliegue lo describe `vercel.json`, y no la autodetección: fija `src/server.js`
como punto de entrada y manda **todo** el tráfico a Express. Dos detalles deciden si el
despliegue arranca o no. El primero es `includeFiles`: el empaquetador decide qué sube leyendo
los `require`, y ni `express.static` ni la lectura del certificado son analizables así, de modo
que `public/` y `certs/` hay que nombrarlos a mano. El segundo es que sean `routes` y no
`rewrites` — los `rewrites` consultan el sistema de archivos DESPUÉS de casar, así que los
estáticos volverían a salir del CDN sin pasar por el guardia ni por la CSP.

    NODE_ENV=production CONFIAR_EN_PROXY=1 npm start

`CONFIAR_EN_PROXY=1` hace que se lean `X-Forwarded-For`/`X-Forwarded-Proto`. **Actívalo sólo
si hay un proxy de verdad delante**: sin él, cualquiera se inventa esas cabeceras y el límite
de intentos por IP deja de servir para nada. En Vercel es obligatoria: sin ella `req.ip` es
la IP del proxy para todo el mundo y el limitador se vuelve un bloqueo global.

A diferencia de la versión con SQLite, el disco ya no importa: los datos viven en Supabase,
así que un redeploy o una plataforma con disco efímero (Railway, Render, Vercel) no pierde
nada. Haz copia de la base con las herramientas de respaldo de Supabase.

## Fuera de alcance

- **Recuperar la contraseña por correo, registro público, OAuth.** Se recupera con
  `scripts/cuenta.js` desde el servidor; son dos personas y dos cuentas.
- **Deshacer una orden ya emitida, o anular una devolución.** El descuento y la devolución
  son de una sola vía; un error se corrige a mano desde Inventario, editando la cantidad.
- **Listar órdenes o consultar el historial.** `GET /api/ordenes/:id` lee una orden por su
  número, que es lo que necesita la devolución. No hay pantalla de historial: para eso, SQL.
