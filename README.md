# Inventario — Ok-producciones

Inventario de almacén para eventos. Se carga el catálogo de equipos, se arma
la lista del día eligiendo qué sale y en qué cantidad, y se imprime la orden.
**Al imprimir, el stock baja de verdad.**

Express 5 + SQLite sirviendo un frontend estático de HTML/CSS/JS. Sin
framework, sin build step, sin transpilación: lo que está en `public/` es
literalmente lo que corre en el navegador.

## Arrancar

Requiere Node 18 o superior (probado en 24.13.0).

    npm install     # sqlite3 compila nativo; puede tardar la primera vez
    npm start       # http://localhost:3000

`PORT` cambia el puerto. `DB_PATH` cambia la base de datos.

## Cómo está organizado

    server.js              backend completo: conexión, middlewares y todas las rutas
    public/                lo que sirve express.static, tal cual corre en el navegador
      html/                una página por pantalla
      css/                 base.css (tokens y primitivas) + una hoja por pantalla
      js/                  un archivo por pantalla
      img/
    db/
      inventario.db3       la base, versionada (trae los datos de arranque)
      migrations/          *.sql numerados + run.js, el runner
    test/
      api.test.js          la suite completa
      helpers/db.js        recrea el esquema en una base temporal
    DESIGN.md              el sistema visual: tokens, primitivas, decisiones
    PRODUCT.md             para qué existe cada pantalla y qué se dejó fuera
    CLAUDE.md              guía para agentes; incluye las trampas del repo

Cada pantalla es su propio trío `html` + `css` + `js`, sin nada compartido
salvo `base.css`. **Los nombres todavía no coinciden entre sí** (`index.html`
va con `logica.js` y `style.css`; `inventario.html` con `edit.js`), que es la
deuda más visible del repo.

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

    npm test                                        # los 55 tests de API
    node --test test/api.test.js                    # un solo archivo
    node --test --test-name-pattern "elimina el producto"   # un solo test

Runner nativo de Node, cero dependencias de test. Los tests levantan la app
en un puerto efímero contra una base temporal: **nunca escriben sobre
`db/inventario.db3`**.

El glob de `npm test` va entrecomillado a propósito. Sin comillas lo expande
el shell, y `node --test test/` falla con `MODULE_NOT_FOUND` porque Node
resuelve la ruta como módulo y no como directorio.

## La API

Todo vive en `server.js`.

| Método | Ruta | Para qué |
|---|---|---|
| GET | `/api/productos` | Catálogo completo, con el nombre del área |
| GET | `/api/productos?activo=1` | Sólo lo disponible (lo que consume la Principal) |
| GET | `/api/productos/:id` | Detalle |
| POST | `/api/productos` | Crear. Nace `activo = 1` |
| PUT | `/api/productos/:id` | Editar |
| PATCH | `/api/productos/:id/activo` | Activar / desactivar |
| DELETE | `/api/productos/:id` | Eliminar |
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

Las tablas `usuarios` e `historial_login` existen pero ninguna ruta ni
pantalla las usa: **no hay autenticación**, quedó explícitamente para después.

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

## Fuera de alcance

- **Usuarios y login.** Diferido explícitamente. Las órdenes guardan el
  responsable como texto tecleado, no como un usuario del sistema.
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
