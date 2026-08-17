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
| **Inventario** | `/html/inventario.html` | Administrar el catálogo: alta, edición, activar/desactivar, borrado, export CSV. |
| **Orden del día** | `/html/orden_del_dia.html` | Revisar el formato, ajustarlo e imprimir. Aquí es donde baja el stock. |

El flujo es de izquierda a derecha: se carga el catálogo en Inventario, se
selecciona en la Principal, se revisa en Orden del día, se imprime.

Cuatro reglas del negocio que explican casi todo el diseño:

- **`activo` separa "existe en el catálogo" de "se puede pedir hoy".** Un
  producto desactivado sigue en Inventario pero no aparece en la Principal.
- **Imprimir dos veces descuenta una sola vez.** Sacar dos copias del mismo
  papel es normal; descontar dos veces dejaría el inventario mal.
- **Devolver material se puede hasta el momento de imprimir**, tanto desde la
  Principal como desde la propia Orden del día (`− + ✕` en cada línea). Después
  de imprimir la orden queda cerrada, y se cierra del todo con "Empezar una
  nueva orden".
- **Cada orden emitida queda registrada** en `ordenes` / `orden_lineas`, con
  fecha, evento y responsable, dentro de la misma transacción que el descuento.

## Cómo se pasan la orden las pantallas

No hay estado en el servidor entre pantallas: viaja por `sessionStorage`, en
dos claves que hay que mover **juntas**.

| Clave | Contenido | Quién la escribe |
|---|---|---|
| `ordenSeleccion` | Array de `{ id_producto, nombre, marca, area, cantidad }`, con `id_producto` y `cantidad` como **números** | Principal y Orden del día, al mover una cantidad |
| `ordenAplicada` | `"true"` cuando el descuento de esa orden ya se aplicó | Orden del día, al emitir |

La regla que las une: **quien escriba `ordenSeleccion` borra `ordenAplicada`**,
porque una selección distinta es otra orden y su descuento está pendiente. Al
revés, con `ordenAplicada` en `"true"` imprimir sólo reimprime, y la Principal
arranca en limpio en vez de rehidratar una orden ya consumida. "Empezar una
nueva orden" borra las dos. Cada pantalla lo hace desde su propia
`guardarSeleccion()`, en un solo sitio, para que no se pueda olvidar la mitad.

## Probar

    npm test                                        # los 29 tests de API
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

**`POST /api/ordenes` es el único camino que escribe stock.** Recibe
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
    │ id_orden    │ INTEGER PK    │◄─────┤ id_orden    │ FK → ordenes     │
    │ creada_en   │ TEXT NOT NULL │  └──►│ id_producto │ FK → productos   │
    │ evento      │ TEXT          │      │ nombre      │ TEXT NOT NULL    │
    │ responsable │ TEXT          │      │ cantidad    │ INTEGER NOT NULL │
    └─────────────┴───────────────┘      └─────────────┴──────────────────┘

La cantidad vive en el producto, no en una tabla puente.

`ordenes` / `orden_lineas` son el registro histórico de lo que salió del
almacén, escrito en el mismo `COMMIT` que el descuento. `orden_lineas.nombre`
duplica a propósito el nombre del producto: es un registro, no una vista, y si
el producto se renombra o se borra, la orden vieja tiene que seguir diciendo
qué salió de verdad.

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

Al añadir una migración, actualiza también el esquema de
`test/helpers/db.js`: es el que recrean los tests.

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
- **Deshacer una orden ya emitida.** Devolver material se puede hasta el
  momento de imprimir; después el descuento es de una sola vía y corregirlo
  obliga a editar la cantidad a mano desde Inventario. La orden queda
  registrada aunque se corrija el stock por fuera.
- **Consultar el historial.** Las órdenes **sí** se guardan (`ordenes` /
  `orden_lineas`), pero nada las lee todavía: no hay `GET /api/ordenes` ni
  pantalla que las muestre. Por ahora se consultan con SQL.
