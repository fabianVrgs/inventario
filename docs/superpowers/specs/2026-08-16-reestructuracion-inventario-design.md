# Reestructuración del inventario: catálogo, selección y orden del día

**Fecha:** 2026-08-16
**Estado:** diseño acordado, implementación mayormente completa (ver §9)

## 1. Problema

El sistema tenía una sola pantalla que mezclaba tres responsabilidades y no
cumplía ninguna:

- **La selección no persistía.** `logica.js` restaba la cantidad sobre un objeto
  JavaScript en memoria. No había `POST` ni `PUT`: el descuento era puramente
  visual y se perdía al recargar. La base de datos nunca cambiaba.
- **El CRUD era falso.** `inventario.html` operaba sobre un array hardcodeado,
  con un campo `estado` ("Disponible" / "No disponible") que no existía en el
  esquema.
- **No había formato imprimible.** `orden_del_dia.html` existía enlazado desde
  el menú, pero con 0 bytes.
- **El esquema no permitía descontar.** La cantidad vivía en una tabla puente
  `detalle_inventario`, y el único endpoint que la leía (`/api/productoSubproceso`)
  no devolvía ids — era imposible saber qué fila actualizar.

El objetivo declarado ("que la lista seleccionada pase a un formato imprimible")
no era alcanzable sin tocar el esquema. Por eso el alcance se movió de agregar un
botón a reestructurar desde la base de datos.

## 2. Resultado buscado

Tres pantallas con roles disjuntos:

| Pantalla | Rol | No hace |
|---|---|---|
| **Inventario** | Administrar el catálogo: alta, edición, activar/desactivar, borrado | No selecciona para eventos |
| **Principal** | Elegir de lo disponible, con cantidad | No edita el catálogo |
| **Orden del día** | Revisar el formato e imprimir (descontando) | No cambia la selección |

Flujo: el usuario carga el catálogo en Inventario → selecciona en Principal →
revisa en Orden del día → imprime, y ahí es donde el stock baja de verdad.

## 3. Decisiones tomadas

| Tema | Decisión | Razón |
|---|---|---|
| Esquema | El producto lleva su propia área y cantidad; se elimina `detalle_inventario` | Un producto está en un área y tiene una cantidad. La tabla puente modelaba una relación N:M que los datos reales nunca usaron (0 productos en más de un área) |
| Selección | Marcar **y** elegir cantidad | Pedir "3 de 15" es el caso normal en un almacén |
| Descuento | Real, al confirmar la impresión | El papel impreso es el compromiso: lo que se imprimió, salió |
| Imprimir dos veces | Descuenta **una sola vez** | Sacar dos copias del mismo papel es normal; descontar dos veces dejaría el inventario mal y no hay forma de devolver material |
| Evento / Responsable | Inputs en pantalla, que se reflejan en el impreso | Se teclean antes de imprimir; si están vacíos salen como rayas para llenar a mano |
| Login y usuarios | Fuera de alcance | Decisión explícita: "después lo miramos" |

## 4. Modelo de datos

```
areas                          productos
┌───────────┬───────────┐      ┌─────────────┬────────────────────────┐
│ id_area   │ nombre    │      │ id_producto │ INTEGER PK             │
├───────────┼───────────┤◄─────┤ nombre      │ TEXT NOT NULL          │
│ 1         │ luces     │      │ marca       │ TEXT                   │
│ 2         │ pantalla  │      │ descripcion │ TEXT                   │
│ 3         │ Sonido    │      │ cantidad    │ INTEGER NOT NULL DEF 0 │
│ 4         │ estructura│      │ activo      │ INTEGER NOT NULL DEF 1 │
└───────────┴───────────┘      │ id_area     │ FK → areas             │
                               └─────────────┴────────────────────────┘
```

`areas` es `subprocesos` renombrada, conservando los ids. `usuarios` e
`historial_login` quedan sin uso pero sin estorbar.

Dos columnas cargan todo el peso del diseño:

- **`cantidad`** es el stock real y la única fuente de verdad. Sólo
  `POST /api/ordenes` y el CRUD la escriben.
- **`activo`** separa "existe en el catálogo" de "se puede pedir hoy". Un
  producto desactivado sigue en el inventario pero no aparece en la Principal.

### Migración `001-productos-con-area.sql`

SQLite no permite agregar claves foráneas con `ALTER TABLE`, así que va por
tabla nueva + rename, todo dentro de una transacción:

1. `CREATE TABLE areas`, poblada desde `subprocesos` conservando ids.
2. `CREATE TABLE productos_nuevo` con el esquema de arriba.
3. Volcado con `LEFT JOIN detalle_inventario`:
   `cantidad = COALESCE(d.cantidad, 0)`, `id_area = d.id_subproceso`,
   y `activo = 0` para los que no tenían fila en la tabla puente.
4. `DROP TABLE productos` → `RENAME productos_nuevo TO productos`.
5. `DROP TABLE detalle_inventario`, `DROP TABLE subprocesos`.

**El runner exige la ruta de la base de datos explícitamente** y no tiene valor
por defecto, para que sea imposible migrar la base real por accidente:

```bash
node db/migrations/run.js db/migrations/001-productos-con-area.sql db/inventario.db3
```

#### Resultado real de la migración (ya aplicada)

| id | nombre | cantidad | activo | área |
|---|---|---|---|---|
| 1 | vim2 | 4 | 1 | luces |
| 2 | blinder | 18 | 1 | luces |
| 5 | BT3 | 0 | 0 | — |
| 6 | Array | 0 | 0 | — |
| 7 | BT3 | 30 | 1 | Sonido |
| 8 | Array | 15 | 1 | Sonido |
| 11 | Bases de Microfonos | 0 | 0 | — |

Los ids 5, 6 y 11 son huérfanos: no tenían fila en `detalle_inventario`, así que
entraron en 0 e inactivos. **`BT3` y `Array` quedan duplicados** (5/7 y 6/8). No
se fusionaron a propósito: fusionarlos sería perder datos por adivinanza. La vía
de limpieza es el CRUD — lo que hace crítico el defecto de §10.

La columna `observaciones` de la tabla puente se perdió en la migración. Tenía
cuatro valores (`blinder`, `parcot`, `bt3`, `array`) que no correspondían con su
producto y uno de los cuales (`parcot`) ni siquiera está en el catálogo. Siguen
recuperables desde `db/inventario.db3.bak`.

## 5. API

Todo vive en `server.js`. Las consultas usan la API de callbacks de `sqlite3`;
en `db.run` se usa `function(err)` y no arrow, porque el handler depende de
`this.lastID` y `this.changes`.

| Método | Ruta | Para qué |
|---|---|---|
| GET | `/api/productos` | Catálogo completo, con el nombre del área vía `LEFT JOIN` |
| GET | `/api/productos?activo=1` | Sólo lo disponible (Principal) |
| GET | `/api/productos/:id` | Detalle |
| POST | `/api/productos` | Crear. Nace `activo = 1` |
| PUT | `/api/productos/:id` | Editar |
| PATCH | `/api/productos/:id/activo` | Activar / desactivar sin mandar el objeto entero |
| DELETE | `/api/productos/:id` | Eliminar |
| GET | `/api/areas` | Poblar el `<select>` del formulario |
| POST | `/api/ordenes` | Confirmar la orden y descontar |

`/api/productoSubproceso` se eliminó: existía para el join contra
`detalle_inventario`. La agrupación por área ahora sale de `productos.id_area`.

### `POST /api/ordenes` — el único camino que escribe stock

Recibe `{ lineas: [{ id_producto, cantidad }] }`, donde ambos campos deben ser
**números** (se valida con `typeof`; los strings se rechazan con 400).

El orden de las operaciones no es negociable:

1. **Validar la forma** de cada línea: entero positivo. Si no, 400.
2. **Releer las cantidades de la base**, nunca confiar en las del navegador —
   vienen de un page load que puede tener horas.
3. **Agrupar las líneas repetidas del mismo producto ANTES de comparar contra el
   stock.** Si se comparara línea por línea, dos pedidos de 3 contra un stock de
   4 pasarían por separado y dejarían la cantidad en −2.
4. Si algo no alcanza: `ROLLBACK` y **409 con `{faltantes}`**, sin descontar nada.
5. Si todo cabe: un `UPDATE` por producto con el total ya sumado, y `COMMIT`.

Todo dentro de `BEGIN` / `COMMIT` en `db.serialize`. **Todo o nada:** no puede
quedar media orden descontada.

## 6. Pantallas

**Inventario** (`inventario.html` + `edit.js`) — la UI ya existía (tabla, modales
de detalle/editar/eliminar, export CSV); lo que cambia es el origen de los datos:
del array hardcodeado a la API. El campo `estado` inventado pasa a ser el `activo`
real, con su toggle, y se agrega el `<select>` de área.

**Principal** (`index.html` + `logica.js`) — consume `/api/productos?activo=1`,
agrupa por área y arma la selección con cantidad. Tres arreglos de fondo:

- El `id="lista"` estaba **duplicado** (un `<div>` y un `<ul>`). `getElementById`
  devolvía el primero, así que los ítems seleccionados caían en el div equivocado
  y el `<ul>` de "Lista seleccionada" nunca se usaba. Renombrado a `#resultados`.
- Se borró el `<script>` inline que duplicaba el fetch y escribía en el mismo nodo.
- `#btnImprimir` sale de esta pantalla: imprimir vive en Orden del día.

**Orden del día** (`orden_del_dia.html` + `orden.js`) — lee la selección, la
agrupa por área y la pinta en el formato: encabezado con fecha automática,
secciones por área, líneas `producto ....... cantidad`, y pie con responsable y
firma. El botón Imprimir hace `POST /api/ordenes`; con 200 marca la orden como
aplicada y llama `window.print()`, con 409 muestra qué producto ya no alcanza y
**no imprime**. Los estilos van en `style-orden.css`, con un bloque `@media print`
que oculta botones y navegación.

### Contrato entre Principal y Orden del día

`sessionStorage`, clave `ordenSeleccion`, un array de:

```js
{ id_producto: Number, nombre: String, marca: String, area: String, cantidad: Number }
```

`id_producto` y `cantidad` **son números** — el backend los valida con `typeof` y
rechaza strings con 400. `cantidad` es lo pedido, no lo disponible. Seleccionar
dos veces el mismo producto suma en la misma entrada, no crea una segunda.

Orden del día **filtra las líneas mal formadas en vez de reventar**: una entrada
corrupta se descarta y el resto de la orden se muestra igual.

Una segunda clave, `ordenAplicada`, guarda si el descuento ya se hizo. Vive en
`sessionStorage` además de en memoria para sobrevivir a un F5, y es lo que
implementa la decisión de "imprimir dos veces descuenta una sola vez".

## 7. Manejo de errores

| Situación | Respuesta |
|---|---|
| Línea con cantidad 0, negativa o no entera | 400, nada se toca |
| Producto inexistente en la orden | 409, tratado como stock 0 |
| Stock insuficiente en cualquier línea | 409 con `{faltantes}`, **ninguna** línea se aplica |
| Falla un `UPDATE` a media transacción | `ROLLBACK` y 500 |
| El servidor no responde | Aviso en pantalla, no se imprime |

El principio de fondo: **nunca imprimir un papel que no corresponda al estado
real del inventario.** Si el descuento no se pudo aplicar, no hay papel.

## 8. Pruebas

Runner nativo de Node, cero dependencias extra. 22 tests en `test/api.test.js`,
todos en verde.

Tres ganchos en `server.js` existen sólo para poder testear y no deben quitarse:
`DB_PATH` por entorno elige la base, `app.listen()` va envuelto en
`require.main === module` para que importar el módulo no abra puerto, y el final
exporta la app con la conexión en `app.locals.db` para cerrarla en el teardown.

`process.env.DB_PATH` debe fijarse **antes** del `require('../server.js')`: la
conexión se abre al cargar el módulo. `beforeEach` llama a `sembrar()`, así que
ningún test depende de lo que mutó el anterior.

Casos que importan más que el resto:

- El filtro `?activo=1` omite los desactivados.
- La orden feliz descuenta; agotar exactamente el stock se permite.
- Stock insuficiente → 409 **y las cantidades quedan intactas**.
- Una orden con una línea que cabe y otra que no **no aplica ninguna de las dos**.
- Dos líneas de 3 contra un stock de 4 → 409, sin dejar el stock negativo.
- Dos líneas que juntas sí caben → 200.

## 9. Estado de la implementación

| Pieza | Estado |
|---|---|
| Migración 001 | Aplicada y verificada sobre la base real, con respaldo en `.bak` |
| `server.js` + endpoints | Completo, 22/22 tests en verde |
| Contrato `sessionStorage` | Verificado leyendo ambos extremos |
| `logica.js`, `edit.js`, `orden.js` | Escritos, sintaxis correcta, **sin verificar en navegador** |

Las tres pantallas nunca se recorrieron de punta a punta en un navegador. El
código está escrito y el contrato entre páginas revisado a mano, pero el
comportamiento real no está comprobado.

### Verificación pendiente

1. Inventario → crear un producto, desactivarlo, confirmar que **desaparece** de
   la Principal → reactivarlo.
2. Principal → seleccionar 2 productos de áreas distintas con cantidades.
3. Orden del día → verificar agrupación y cantidades.
4. Imprimir → confirmar en la vista previa que no salen botones ni menú.
5. Confirmar el descuento real consultando `cantidad` antes y después.
6. Pedir más de lo que hay → 409, no imprime, cantidades intactas.

## 10. Defectos conocidos

**El CRUD sólo carga productos activos** (`edit.js:63` pide `?activo=1`).
Desactivar un producto lo saca de la única pantalla desde donde podría
reactivarse: una trampa de una sola vía. Hoy los productos 5, 6 y 11 están
inactivos y por lo tanto son **invisibles en el CRUD**, que es justamente donde
el diseño dice que deben limpiarse los duplicados de la migración.

Corrección: Inventario debe pedir `/api/productos` sin filtro y mostrar el estado
como una columna. El filtro `?activo=1` es de la Principal, no del CRUD.

## 11. Fuera de alcance

- **Usuarios y login.** Diferido explícitamente.
- **Devolución de material.** El descuento es de una sola vía; corregir un error
  obliga a editar la cantidad desde el CRUD.
- **Historial de órdenes.** No se guarda qué se pidió ni cuándo: la orden
  descuenta y desaparece. Si más adelante hace falta auditar, hay que agregar
  una tabla `ordenes`.
- **Fusión de duplicados.** Se resuelve a mano desde el CRUD (bloqueado por §10).
- **`.gitignore` y `node_modules` versionado.** Pendiente aparte.
