# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

Inventario de almacén para "Ok-producciones": Express 5 + SQLite3 sirviendo un frontend estático de HTML/CSS/JS sin framework ni build step. Todo el código de la aplicación vive en dos lugares: `server.js` (backend completo, monolítico) y `public/` (frontend).

El código y los comentarios están en español. Mantén ese idioma al escribir código o mensajes de commit aquí.

## Comandos

```bash
npm install          # instala dependencias (sqlite3 compila nativo vía node-gyp/prebuild)
npm start            # arranca en http://localhost:3000 (PORT lo cambia)
npm test             # suite de API con el runner nativo de node
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

**Backend — `server.js`.** Un solo archivo con todo: conexión a SQLite, middlewares, rutas y `app.listen()`. Las consultas usan la API de callbacks de `sqlite3` (`db.all` / `db.get` / `db.run`), no promesas. En `db.run` se usa `function(err)` (no arrow) porque el handler depende de `this.lastID` y `this.changes`.

Orden inusual del archivo, importante al editar: la ruta `/` y `app.listen()` están declaradas **antes** de los middlewares y de las rutas `/api/*`. Funciona porque `listen` es asíncrono, pero cualquier middleware nuevo debe registrarse antes de las rutas que deba afectar.

Tres ganchos existen solo para poder testear, no los quites: `DB_PATH` (env) elige la base, `app.listen()` está envuelto en `require.main === module` para que importar el módulo no abra puerto, y el final exporta la app con la conexión colgada en `app.locals.db` para cerrarla en el teardown.

**Tests — `test/`.** Runner nativo de Node, cero dependencias extra. `test/helpers/db.js` recrea el esquema en una base temporal sembrada; los tests levantan la app en puerto efímero (`listen(0)`) y la consultan con `fetch`. Nunca escriben sobre `db/inventario.db3`.

Una trampa al añadir tests: `process.env.DB_PATH` debe fijarse **antes** del
`require('../server.js')`, porque la conexión se abre al cargar el módulo. El orden entre
tests sí da igual: `beforeEach` llama a `sembrar()` y deja la base en el estado inicial,
así que ninguno depende de lo que mutó el anterior.

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
                               └─────────────┴────────────────────────┘
```

- **La cantidad vive en el producto**, no en una tabla puente. `activo` decide si el
  producto aparece en la pantalla principal.
- `usuarios`, `historial_login` — existen pero ninguna ruta ni UI las usa. No hay
  autenticación; quedó explícitamente para después.

Las migraciones van en `db/migrations/`, aplicadas con el runner:

```bash
node db/migrations/run.js db/migrations/001-productos-con-area.sql db/inventario.db3
```

El runner **no tiene ruta de base por defecto** a propósito: hay que pasarla siempre, para
que sea imposible migrar la base real por accidente. Haz copia antes
(`db/inventario.db3.bak` es la de la migración 001, que plegó `detalle_inventario` a
`productos.cantidad` y renombró `subprocesos` a `areas`).

**Frontend — `public/`.** Servido como estático (`express.static('public')`), por lo que
las rutas absolutas son `/css/...`, `/js/...`, `/html/...`. Tres pantallas con roles
separados:

- `html/index.html` + `js/logica.js` — principal. Lista lo disponible
  (`/api/productos?activo=1`) agrupado por área y arma la selección con cantidad.
  **Además del filtro `activo=1`, oculta lo que no tiene existencias**: una fila se
  pinta si `cantidadDisponible > 0` *o* si ya está en la selección. Lo segundo no es
  un adorno — sin ello la fila desaparecería bajo el dedo justo al tomar la última
  unidad, y desde la Principal no habría forma de devolverla.
  La cantidad se ajusta con un contador en la propia fila (`− n +`); **no hay modal**
  en esta pantalla desde el rediseño.
- `html/inventario.html` + `js/edit.js` — CRUD real contra la API: alta, edición,
  activar/desactivar, borrado, export CSV.
- `html/orden_del_dia.html` + `js/orden.js` — el formato imprimible. Lee la selección,
  la agrupa por área y al confirmar descuenta de verdad.

**Capa de diseño.** `public/css/base.css` se carga antes que la hoja de cada pantalla y
contiene todos los tokens, el reset y las primitivas. El sistema está descrito en
`DESIGN.md` (visual) y `PRODUCT.md` (estratégico), ambos en la raíz. Tres cosas que
muerden si se editan a ciegas:

- Los colores son **OKLCH**, con un bloque `@supports not (color: oklch(...))` que los
  repite en hex. Si cambias un token, recalcula también su hex.
- `[hidden] { display: none !important }` es obligatorio (ver el contrato de `orden.js`).
- **No pongas `position: sticky` en el `thead` de Inventario.** El `overflow-x: auto` de
  `.table-container` lo vuelve scrollport en los dos ejes y la cabecera acaba empujada
  sobre la primera fila. Está documentado en el propio CSS.

**Contrato entre principal y orden del día:** `sessionStorage`, clave `ordenSeleccion`,
un array de `{ id_producto, nombre, marca, area, cantidad }` donde `id_producto` y
`cantidad` son **números** — el backend valida con `typeof === 'number'` y rechaza strings
con 400. `cantidad` es lo pedido, no lo disponible.

Hay una **segunda clave, `ordenAplicada`**: vale `"true"` cuando el descuento de la orden
actual ya se aplicó, y es lo que hace que imprimir dos veces descuente una sola. Su
invariante: **quien escriba `ordenSeleccion` debe borrar `ordenAplicada`.** Si la selección
cambia, la orden es otra y su descuento está pendiente; dejar la clave en `"true"` hace que
Orden del día imprima sin llamar a `/api/ordenes` — papel por material nunca descontado.

La otra mitad: **la Principal no rehidrata una selección cuya orden ya se aplicó.**
Si `ordenAplicada` es `"true"` al cargar, arranca en limpio en vez de recuperar
`ordenSeleccion` — esa orden ya está consumida y volver a mostrarla la
descontaría dos veces si se reenvía. `ordenSeleccion` se deja en
`sessionStorage` a propósito pese a esto: es lo que permite a Orden del día
reimprimir el mismo papel sin volver a llamar a `/api/ordenes`.

**`POST /api/ordenes` es el único camino que escribe stock.** Valida todo antes de tocar
nada, agrupa las líneas repetidas del mismo producto **antes** de comparar contra el stock
(si no, dos pedidos que caben por separado dejarían la cantidad en negativo), y aplica los
`UPDATE` dentro de una transacción: todo o nada. Responde 409 con `{faltantes}` sin
descontar si algo no alcanza.

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
