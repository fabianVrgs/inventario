# Inventario — Ok-producciones

Inventario de almacén para eventos. Se carga el catálogo de equipos, se arma
la lista del día eligiendo qué sale y en qué cantidad, y se imprime la orden.
**Al imprimir, el stock baja de verdad.**

Express 5 + SQLite sirviendo un frontend estático de HTML/CSS/JS. Sin
framework, sin build step, sin transpilación: lo que está en `public/` es
literalmente lo que corre en el navegador.

## Arrancar

Requiere Node 18 o superior (probado en 24.13.0).

    npm install                                        # sqlite3 compila nativo; tarda la primera vez
    node scripts/cuenta.js crear almacen --rol admin
    node scripts/cuenta.js crear erick --rol superadmin --sin-totp
    npm start                                          # http://localhost:3000

**El paso de las cuentas no se puede saltar.** No hay ninguna cuenta por defecto
—una aplicación que se despliega con `admin`/`admin` ya está comprometida antes
de arrancar— y sin al menos una no se puede entrar a ninguna pantalla. El
servidor lo avisa al arrancar y, con `NODE_ENV=production`, se niega a arrancar:
mejor un fallo ruidoso que una aplicación publicada a la que nadie puede entrar.

Las cuentas **no viajan en el repositorio** a propósito. `db/inventario.db3` sí
está versionada (trae los datos de arranque del almacén), pero su tabla `cuentas`
se queda vacía para que ningún hash de contraseña acabe en GitHub.

`PORT` cambia el puerto. `DB_PATH` cambia la base de datos.

### Cuentas de prueba

> ⚠️ **Estas contraseñas son de prueba y están escritas en un archivo público
> del repositorio.** Valen para probar en local. **Cámbialas antes de publicar
> nada** y no las reutilices en ninguna otra parte: lo que se escribe en un
> README queda en el historial de git para siempre, aunque después se borre.
> (Es exactamente lo que pasó con el `admin`/`1234` que había en la base.)

| Rol | Usuario | Contraseña |
|---|---|---|
| `admin` | `almacen` | `Almacen2026Prueba!` |
| `superadmin` | `erick` | `Super2026Prueba!` |

El script pide la contraseña por teclado y **sin eco**; nunca por argumento,
porque `argv` acaba en el historial del shell y es visible en `ps` para todos los
usuarios de la máquina. Para automatizar, por tubería:

    echo 'Almacen2026Prueba!' | node scripts/cuenta.js crear almacen --rol admin

### Qué puede cada rol

| | `admin` | `superadmin` |
|---|---|---|
| Elegir material y emitir órdenes | ✅ | ✅ |
| Recibir devoluciones | ✅ | ✅ |
| Alta, edición, activar/desactivar | ✅ | ✅ |
| **Borrar** un producto | ❌ | ✅ |
| Gestionar cuentas y ver la bitácora | ❌ | ✅ |

El criterio del reparto no es "es peligrosa" sino **"es irreversible"**.
Desactivar un producto se deshace con un clic y editarlo también; borrarlo se
lleva la fila por delante y deja huérfanas sus `orden_lineas`, y con ellas la
devolución de esa orden. Todo lo demás se queda en el almacén, que es quien
trabaja con esto todo el día.

### Antes de publicar

    node scripts/cuenta.js clave erick        # contraseña de verdad, mínimo 12 caracteres
    node scripts/cuenta.js clave almacen
    node scripts/cuenta.js totp erick         # segundo factor + 8 códigos de respaldo
    node scripts/cuenta.js cerrar-sesiones    # cierra lo que quedara abierto

`totp` imprime una URI `otpauth://` para el QR y ocho códigos de respaldo **una
sola vez**: en la base sólo quedan el secreto y el hash de cada código, así que
no se pueden volver a consultar. Apúntalos en papel — son la única forma de
entrar si pierdes el móvil, y sin ellos perder el móvil es perder la cuenta que
gestiona las cuentas.

Órdenes completas del script:

    node scripts/cuenta.js listar
    node scripts/cuenta.js crear <usuario> --rol admin|superadmin [--sin-totp]
    node scripts/cuenta.js clave <usuario>              # cambia la clave Y cierra sus sesiones
    node scripts/cuenta.js rol <usuario> <rol>
    node scripts/cuenta.js baja <usuario> | alta <usuario>
    node scripts/cuenta.js totp <usuario>
    node scripts/cuenta.js cerrar-sesiones [usuario]

## Cómo está organizado

    server.js              backend: conexión, middlewares, guardia y todas las rutas
    auth.js                criptografía: scrypt, tokens de sesión, TOTP
    scripts/cuenta.js      alta y gestión de cuentas (la única forma de crear una)
    public/                lo que sirve express.static, tal cual corre en el navegador
      html/                una página por pantalla, más login.html
      css/                 base.css (tokens y primitivas) + una hoja por pantalla
      js/                  un archivo por pantalla, más sesion.js (compartido)
      img/
    db/
      inventario.db3       la base, versionada (trae los datos de arranque)
      migrations/          *.sql numerados + run.js, el runner
    test/
      api.test.js          reglas de negocio
      auth.test.js         guardia, roles, sesiones, CSRF, fuerza bruta, TOTP
      cripto.test.js       auth.js, sin levantar servidor
      arranque.test.js     la app contra una base sin migrar
      helpers/db.js        recrea el esquema en una base temporal
      helpers/sesion.js    siembra cuentas y devuelve la cookie
    DESIGN.md              el sistema visual: tokens, primitivas, decisiones
    PRODUCT.md             para qué existe cada pantalla y qué se dejó fuera
    CLAUDE.md              guía para agentes; incluye las trampas del repo

Cada pantalla es su propio trío `html` + `css` + `js`, sin nada compartido
salvo `base.css` y `sesion.js`. **Los nombres todavía no coinciden entre sí**
(`index.html` va con `logica.js` y `style.css`; `inventario.html` con
`edit.js`), que es la deuda más visible del repo.

`auth.js` es lo único que se sacó de `server.js`: son funciones puras, se
prueban sin levantar servidor, y es el código donde un fallo silencioso cuesta
más caro. El resto del backend sigue en un solo archivo.

## Las tres pantallas

| Pantalla | Ruta | Qué hace |
|---|---|---|
| **Principal** | `/` | Elegir de lo disponible, con cantidad. No edita el catálogo. |
| **Inventario** | `/html/inventario.html` | Administrar el catálogo: alta, edición, activar/desactivar, borrado, export CSV. Y **recibir devoluciones**: aquí es donde vuelve a subir el stock. |
| **Orden del día** | `/html/orden_del_dia.html` | Revisar el formato, ajustarlo e imprimir. Aquí es donde baja el stock. |

El flujo va de izquierda a derecha: se carga el catálogo en Inventario, se
selecciona en la Principal, se revisa en Orden del día, se imprime. Y **cierra
el círculo** volviendo a Inventario cuando el material regresa del evento: se
teclea el N.º que la orden lleva impreso y se repone de una vez todo lo que salió.

Cinco reglas del negocio que explican casi todo el diseño:

- **`activo` separa "existe en el catálogo" de "se puede pedir hoy".** Un
  producto desactivado sigue en Inventario pero no aparece en la Principal.
- **Imprimir dos veces descuenta una sola vez.** Sacar dos copias del mismo
  papel es normal; descontar dos veces dejaría el inventario corto.
- **Recibir dos veces la misma orden repone una sola vez.** La regla espejo, y
  garantizada por un `UNIQUE` en la base y no por un `if`: devolver dos veces
  infla el inventario con material que no existe.
- **Ajustar la orden se puede hasta el momento de imprimir**, tanto desde la
  Principal como desde la propia Orden del día (`− + ✕` en cada línea). Después
  de imprimir la orden queda cerrada, y se cierra del todo con "Empezar una
  nueva orden".
- **Cada orden emitida queda registrada** en `ordenes` / `orden_lineas`, con
  fecha, evento y responsable, dentro de la misma transacción que el descuento;
  y su regreso en `devoluciones`, con la fecha y quién lo recibió.

## Cómo se pasan la orden las pantallas

No hay estado en el servidor entre pantallas: viaja por `sessionStorage`, en
tres claves que hay que mover **juntas**.

| Clave | Contenido | Quién la escribe |
|---|---|---|
| `ordenSeleccion` | Array de `{ id_producto, nombre, marca, area, cantidad }`, con `id_producto` y `cantidad` como **números** | Principal y Orden del día, al mover una cantidad |
| `ordenAplicada` | `"true"` cuando el descuento de esa orden ya se aplicó | Orden del día, al emitir |
| `ordenId` | El N.º que asignó la base: lo que se imprime en el papel y lo que se teclea en Inventario para devolver | Orden del día, al emitir |

La regla que las une: **quien escriba `ordenSeleccion` borra `ordenAplicada` y
`ordenId`**, porque una selección distinta es otra orden. Si quedara
`ordenAplicada`, imprimir sacaría papel por material nunca descontado; si
quedara `ordenId`, el papel nuevo llevaría el número del anterior y alguien
devolvería la orden equivocada — que no se deshace. Al revés, con
`ordenAplicada` en `"true"` imprimir sólo reimprime (conservando su número), y
la Principal arranca en limpio en vez de rehidratar una orden ya consumida.
"Empezar una nueva orden" borra las tres. Cada pantalla lo hace desde su propia
`guardarSeleccion()`, en un solo sitio, para que no se pueda olvidar una.

## Probar

    npm test                                        # los 105 tests
    node --test test/auth.test.js                   # un solo archivo
    node --test --test-name-pattern "elimina el producto"   # un solo test

Runner nativo de Node, cero dependencias de test. Los tests levantan la app
en un puerto efímero contra una base temporal: **nunca escriben sobre
`db/inventario.db3`**.

Desde que el guardia deniega por defecto, toda la suite necesita sesión:
`test/helpers/sesion.js` siembra las cuentas y devuelve la cookie, y los tests
de negocio se leen igual que antes. Los que más valen son los de `auth.test.js`
que comprueban que algo **no** pasa: que el hash guardado en `sesiones` no sirve
como cookie, que el rol no escala desde el cliente, que el admin recibe 403 al
borrar **y el producto sigue existiendo después**, y que un código TOTP no vale
dos veces.

El glob de `npm test` va entrecomillado a propósito. Sin comillas lo expande
el shell, y `node --test test/` falla con `MODULE_NOT_FOUND` porque Node
resuelve la ruta como módulo y no como directorio.

## La API

Todo vive en `server.js`.

**Todas las rutas exigen sesión** salvo `/api/auth/login` y `/api/auth/totp`. El
guardia **deniega por defecto**: bloquea lo que no esté en una lista blanca corta
en vez de proteger ruta por ruta. Así una ruta nueva nace protegida, y olvidarse
del candado deja fuera al usuario legítimo —que se nota en el acto— en vez de
dejar entrar a cualquiera, que no se nota nunca.

Las peticiones a `/api/*` sin sesión reciben `401`; la navegación a una pantalla
HTML, un `302` al login.

| Método | Ruta | Para qué |
|---|---|---|
| POST | `/api/auth/login` | Entrar. Devuelve la cookie, o `{ requiere_totp, reto }` |
| POST | `/api/auth/totp` | Canjear el reto con el código de 6 dígitos o uno de respaldo |
| POST | `/api/auth/salir` | Cerrar sesión: borra la fila y vence la cookie |
| GET | `/api/auth/yo` | `{ usuario, rol }`, para pintar la barra |
| GET | `/api/cuentas` | Listar cuentas — **sólo superadmin** |
| PATCH | `/api/cuentas/:id/activa` | Dar de alta o de baja — **sólo superadmin** |
| GET | `/api/accesos` | Bitácora de los últimos 200 accesos — **sólo superadmin** |
| GET | `/api/productos` | Catálogo completo, con el nombre del área |
| GET | `/api/productos?activo=1` | Sólo lo disponible (lo que consume la Principal) |
| GET | `/api/productos/:id` | Detalle |
| POST | `/api/productos` | Crear. Nace `activo = 1` |
| PUT | `/api/productos/:id` | Editar |
| PATCH | `/api/productos/:id/activo` | Activar / desactivar |
| DELETE | `/api/productos/:id` | Eliminar — **sólo superadmin** |
| GET | `/api/areas` | Poblar el selector de área |
| POST | `/api/ordenes` | Confirmar la orden, descontar y registrarla |
| GET | `/api/ordenes/:id` | Leer una orden emitida y si ya se devolvió |
| POST | `/api/ordenes/:id/devolucion` | Recibir la orden y reponer su stock |

**Hay exactamente dos caminos que escriben stock: `POST /api/ordenes` descuenta
y `POST /api/ordenes/:id/devolucion` repone.** Ninguna otra ruta toca
`productos.cantidad` salvo el CRUD, que la fija a mano.

`POST /api/ordenes` recibe
`{ lineas: [{ id_producto, cantidad }], evento?, responsable? }`, donde
`id_producto` y `cantidad` deben ser **números** (los strings se rechazan con
400) y los dos textos son opcionales, de hasta 200 caracteres. Valida todo
antes de tocar nada, relee las cantidades de la base en vez de confiar en las
del navegador, suma las líneas repetidas del mismo producto **antes** de
compararlas contra el stock, y aplica los `UPDATE` **junto con el registro de
la orden** dentro de una transacción: todo o nada. Si algo no alcanza responde
409 con `{ faltantes }` sin descontar nada; si sale bien, 200 con `{ id_orden }`.

El principio detrás: **nunca imprimir un papel que no corresponda al estado
real del inventario.** Si el descuento no se pudo aplicar, no hay papel. Y al
revés: si se aplicó, queda registrado quién se llevó qué aunque la impresora
falle. Como el descuento es inmediato y no se deshace desde la app, se avisa
con un diálogo antes de emitir.

`GET /api/ordenes/:id` devuelve la cabecera, la `devolucion` (o `null`) y las
líneas. Cada línea trae, además del `nombre` histórico, si el producto todavía
`existe`, su `nombre_actual` —para poder casarla con la tabla de Inventario si
se renombró— y si está `activo`.

`POST /api/ordenes/:id/devolucion` acepta `{ recibida_por? }` y repone con
`cantidad = cantidad + ?`, dentro de una transacción y dejando constancia en
`devoluciones`. Responde 200 con `{ devueltas, omitidas }`, 404 si la orden no
existe, 409 si ya se recibió y 400 si el número no es un entero positivo. Tres
cosas que conviene saber:

- **No filtra por `activo`**: el stock es físico y `activo` sólo dice si se
  puede pedir hoy. Pero cada línea devuelta informa su `activo`, porque si no
  el material volvería a un producto que la Principal no lista y quedaría
  invisible.
- **Si una línea apunta a un producto ya eliminado**, se repone el resto y esa
  línea sale en `omitidas`. La orden queda devuelta igual: si no, se quedaría
  pendiente para siempre.
- **No hay forma de anular una devolución.** El `UNIQUE` impide devolver dos
  veces la misma orden, pero no devolver la equivocada; eso se corrige a mano
  desde el CRUD. Por eso el diálogo de confirmación muestra la identidad de la
  orden y no sólo su número.

## Modelo de datos

`db/inventario.db3` está versionada a propósito: trae los datos de arranque
del almacén.

    areas                     productos
    ┌─────────┬────────┐      ┌─────────────┬────────────────────────┐
    │ id_area │ nombre │◄─────┤ id_producto │ INTEGER PK             │
    └─────────┴────────┘      │ nombre      │ TEXT NOT NULL          │
                              │ marca       │ TEXT                   │
                              │ descripcion │ TEXT                   │
                              │ cantidad    │ INTEGER NOT NULL DEF 0 │
                              │ activo      │ INTEGER NOT NULL DEF 1 │
                              │ id_area     │ FK → areas             │
                              └──────┬──────┴────────────────────────┘
                                     │
    ordenes                          │   orden_lineas
    ┌─────────────┬───────────────┐  │   ┌─────────────┬──────────────────┐
    │ id_orden    │ INTEGER PK    │◄┬────┤ id_orden    │ FK → ordenes     │
    │ creada_en   │ TEXT NOT NULL │ │ └─►│ id_producto │ FK → productos   │
    │ evento      │ TEXT          │ │    │ nombre      │ TEXT NOT NULL    │
    │ responsable │ TEXT          │ │    │ cantidad    │ INTEGER NOT NULL │
    └─────────────┴───────────────┘ │    └─────────────┴──────────────────┘
                                    │
                                    │    devoluciones
                                    │    ┌──────────────┬─────────────────────┐
                                    └────┤ id_orden     │ FK → ordenes UNIQUE │
                                         │ recibida_en  │ TEXT NOT NULL       │
                                         │ recibida_por │ TEXT                │
                                         └──────────────┴─────────────────────┘

La cantidad vive en el producto, no en una tabla puente.

`ordenes` / `orden_lineas` son el registro histórico de lo que salió del
almacén, escrito en el mismo `COMMIT` que el descuento. `orden_lineas.nombre`
duplica a propósito el nombre del producto: es un registro, no una vista, y si
el producto se renombra o se borra, la orden vieja tiene que seguir diciendo
qué salió de verdad.

`devoluciones` es la vuelta: una fila significa "esta orden regresó completa".
Como la devolución es todo o nada, basta una fila por orden y no hace falta una
tabla de líneas — lo que volvió es lo que dice `orden_lineas`. El `UNIQUE` en
`id_orden` es lo que impide devolver dos veces la misma orden, y está en la base
justamente para no depender de que la aplicación se acuerde de comprobarlo.

Ojo: las `REFERENCES` son decorativas, porque no hay `PRAGMA foreign_keys = ON`
en ninguna parte. Por eso borrar un producto desde el CRUD deja sus
`orden_lineas` apuntando a un id que ya no existe, y la devolución tiene que
tratar ese caso a mano.

La autenticación vive en cuatro tablas aparte, que no se relacionan con las de
inventario:

    cuentas                              sesiones
    ┌──────────────────┬──────────────┐  ┌────────────┬─────────────────────┐
    │ id_cuenta        │ INTEGER PK   │◄─┤ id_cuenta  │ FK → cuentas        │
    │ usuario          │ UNIQUE NOCASE│  │ hash_token │ SHA-256 DEL token   │
    │ hash             │ scrypt$N$r$p │  │ creada_en  │ TEXT NOT NULL       │
    │ rol              │ admin|superad│  │ vista_en   │ corte por inactivid.│
    │ totp_secreto     │ base32, NULL │  │ expira_en  │ techo absoluto      │
    │ totp_ultimo_paso │ anti-replay  │  │ ip, agente │ TEXT                │
    │ creada_en, activa│              │  └────────────┴─────────────────────┘
    └──────────────────┴──────────────┘
                                         codigos_respaldo      accesos
                                         ┌───────────┬────┐   ┌─────────────┐
                                         │ id_cuenta │ FK │   │ ocurrido_en │
                                         │ hash      │    │   │ usuario     │
                                         │ usado_en  │NULL│   │ resultado   │
                                         └───────────┴────┘   │ ip          │
                                                              └─────────────┘

Dos decisiones que conviene entender antes de tocar nada:

- **De la sesión se guarda el SHA-256 del token, nunca el token.** Quien se lleve
  el archivo `.db3` no se lleva ni una sesión utilizable: de un hash no se vuelve
  atrás. Es la misma idea que hashear la contraseña, aplicada a la credencial
  temporal. Y estar en la base y no en un JWT es lo que hace que cerrar una
  sesión sea borrar una fila, con efecto inmediato.
- **`accesos.usuario` guarda lo que se TECLEÓ**, exista o no esa cuenta, y por
  eso es texto suelto y no una clave foránea: los intentos contra nombres
  inventados son justo los que delatan un ataque, y una FK los haría imposibles
  de registrar.

La migración **004** se llevó `usuarios` e `historial_login`. La primera contenía
una fila, `admin` / `1234`, **con la contraseña en texto plano**; como la base
está versionada, esa contraseña sigue en el historial de git y no puede
reutilizarse nunca.

No hay CLI de sqlite3 instalado. Para inspeccionar la base:

    node -e "const s=require('sqlite3');new s.Database('./db/inventario.db3').all('SELECT * FROM productos',[],(e,r)=>console.table(e||r))"

### Migraciones

Van en `db/migrations/`, aplicadas con el runner:

    node db/migrations/run.js db/migrations/002-registro-de-ordenes.sql db/inventario.db3

El runner **no tiene ruta de base por defecto** a propósito: hay que pasarla
siempre, para que sea imposible migrar la base real por accidente. Haz copia
antes de correr cualquier migración.

- **001** plegó `detalle_inventario` a `productos.cantidad` y renombró
  `subprocesos` a `areas`. Copia previa: `db/inventario.db3.bak`.
- **002** añadió `ordenes` y `orden_lineas`. Es puramente aditiva (solo
  `CREATE TABLE`), así que una versión vieja de la app funciona igual contra
  una base ya migrada. Copia previa: `db/inventario.db3.pre-002.bak`.
- **003** añadió `devoluciones`. También aditiva; revertirla es un `DROP TABLE`.
  Copia previa: `db/inventario.db3.pre-003.bak`.
- **004** añadió `cuentas`, `sesiones`, `codigos_respaldo` y `accesos`. **No es
  puramente aditiva**, al contrario que la 002 y la 003: sus dos `DROP` se llevan
  `usuarios` e `historial_login`, así que revertirla no es un `DROP` limpio y
  recuperar aquellas tablas exige el respaldo. Copia previa:
  `db/inventario.db3.pre-004.bak`.

Al añadir una migración, actualiza también el esquema de
`test/helpers/db.js`: es el que recrean los tests.

Y ten en cuenta el bloque de arranque de `server.js`, que asegura estas tablas
con `CREATE TABLE IF NOT EXISTS` para que la app funcione recién clonada sin
correr el runner a mano. **Eso obliga a que una migración aditiva cree una tabla
en vez de añadir una columna**: `IF NOT EXISTS` no añade columnas a una tabla que
ya existe, y `ALTER TABLE ... ADD COLUMN` no admite `IF NOT EXISTS` en SQLite, así
que no habría forma idempotente de asegurarla. Es la razón por la que la 003 es
una tabla y no un `ordenes.devuelta_en`.

## Estado conocido

Nada de esto son bugs recientes; son consecuencias documentadas de la
migración 001.

- **Hay productos duplicados en el catálogo.** `BT3` existe como id 5 y 7,
  `Array` como 6 y 8. Los ids 5, 6 y 11 quedaron sin área y en cantidad 0
  porque no tenían fila en la tabla puente. No se fusionaron a propósito:
  fusionarlos sería perder datos por adivinanza. Se limpian a mano desde
  Inventario.
- **La columna `observaciones` se perdió en la migración 001.** Tenía cuatro
  valores que no cuadraban con su producto; siguen recuperables desde el
  respaldo de la base.

## Cómo está protegido

Nada de esto es "100% seguro" —eso no existe— pero cierra los vectores conocidos,
de modo que el eslabón más débil sea la contraseña y no el código.

| Amenaza | Qué la para |
|---|---|
| Entrar sin credenciales | Guardia que **deniega por defecto**: todo exige sesión salvo la pantalla de login y sus recursos. |
| Robo de sesión por XSS | Cookie `HttpOnly` — el token no toca `localStorage` jamás. Más CSP `script-src 'self'`, cero manejadores en línea, y escapado de todo lo que teclea el usuario. |
| CSRF | `SameSite=Strict`, y además rechazo de todo método con efectos cuyo `Origin` no sea el propio. |
| Fuerza bruta | Retraso creciente por IP **y** por usuario (2 s, 4 s, 8 s… hasta 15 min). Sin bloqueo de cuenta: bloquear regala una forma de dejar fuera al dueño sabiendo sólo su usuario. |
| Enumerar usuarios | Mismo mensaje **y mismo tiempo** para usuario inexistente y contraseña mala, verificando contra un hash señuelo. |
| Robo del archivo `.db3` | scrypt N=2^16 (64 MiB por intento) con sal por cuenta; de las sesiones sólo el SHA-256 del token. |
| Contraseña del superadmin filtrada | Segundo factor TOTP, con anti-replay: un código no sirve dos veces. |
| Escalada de admin a superadmin | El rol se relee de la base en cada petición. No hay nada firmado ni en la cookie que el cliente pueda tocar. |
| Escucha de red | HTTPS obligatorio en producción (cookie `Secure` + HSTS). Lo termina el proxy inverso. |

**Lo que NO cubre**, dicho claramente: malware en el dispositivo del operario,
alguien que agarre la tablet ya desbloqueada, un compromiso del proveedor de
hosting, y —el más probable de todos— que reutilices tu contraseña y aparezca en
una filtración. Ese último es justo el que cubre el TOTP, y por eso va de serie
en el superadmin.

La sesión dura **12 horas** como techo absoluto y se cierra sola tras **2 horas**
sin actividad: una tablet olvidada encima de una caja no se queda abierta.

Cerrar sesión borra también las tres claves de `sessionStorage`. Sin eso, quien
entre después en la misma tablet heredaría la selección del turno anterior — y
con `ordenId` heredado devolvería una orden ajena, que no se deshace.

## Publicar en internet

La aplicación no termina TLS ella misma: eso lo hace un proxy inverso delante.

    NODE_ENV=production CONFIAR_EN_PROXY=1 npm start

- `NODE_ENV=production` marca la cookie como `Secure` y hace que el servidor se
  niegue a arrancar sin cuentas.
- `CONFIAR_EN_PROXY=1` hace que se lean `X-Forwarded-For` y `X-Forwarded-Proto`.
  **Actívalo sólo si hay un proxy de verdad delante**: sin él, cualquiera se
  inventa esas cabeceras y el límite de intentos por IP deja de servir para nada.
- `ORIGEN_PERMITIDO=https://tu-dominio` si el `Host` que llega no coincide con el
  dominio público.

Recomendado: **Cloudflare Tunnel** desde la propia máquina. Da HTTPS y dominio
sin abrir un puerto del router, oculta la IP y —lo importante— el `.db3` se queda
en un disco tuyo.

> ⚠️ En **Railway y Render el disco es efímero**: cada redeploy borra
> `db/inventario.db3` y con él todo el inventario. Si vas por ahí, monta un
> volumen persistente antes de meter un solo dato real.

Haz copia del `.db3` con regularidad. Es un solo archivo: copiarlo es la copia de
seguridad entera.

## Fuera de alcance

- **Recuperar la contraseña por correo.** Añadiría un vector de ataque completo
  —secuestrar el buzón— para dos personas que se sientan a un metro. Se recupera
  con `scripts/cuenta.js` desde el servidor.
- **Registro público, verificación por email, OAuth.** Son dos cuentas.
- **Deshacer una orden ya emitida.** Ajustar la orden se puede hasta el momento
  de imprimir. Después el descuento es de una sola vía: lo que existe es
  **recibir la devolución**, que es otra operación con su propia constancia, no
  una anulación. Corregir un descuento equivocado sigue obligando a editar la
  cantidad a mano desde Inventario.
- **Anular una devolución.** Misma historia y el mismo remedio a mano. Devolver
  la orden equivocada es el error que más duele, porque además deja la orden real
  bloqueada por el `UNIQUE`; por eso se confirma mostrando la identidad completa
  de la orden.
- **Listar órdenes o consultar el historial.** `GET /api/ordenes/:id` lee **una**
  orden por su número, que es lo que necesita la devolución. No hay listado de
  órdenes pendientes ni pantalla de historial: para eso, SQL. Consecuencia
  aceptada: las órdenes emitidas antes de la 003 no llevan número impreso, así
  que no se pueden encontrar desde la UI y su stock se cuadra a mano.
