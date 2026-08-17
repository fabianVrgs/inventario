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

## Las tres pantallas

| Pantalla | Ruta | Qué hace |
|---|---|---|
| **Principal** | `/` | Elegir de lo disponible, con cantidad. No edita el catálogo. |
| **Inventario** | `/html/inventario.html` | Administrar el catálogo: alta, edición, activar/desactivar, borrado, export CSV. |
| **Orden del día** | `/html/orden_del_dia.html` | Revisar el formato e imprimir. Aquí es donde baja el stock. |

El flujo es de izquierda a derecha: se carga el catálogo en Inventario, se
selecciona en la Principal, se revisa en Orden del día, se imprime.

Dos reglas del negocio que explican casi todo el diseño:

- **`activo` separa "existe en el catálogo" de "se puede pedir hoy".** Un
  producto desactivado sigue en Inventario pero no aparece en la Principal.
- **Imprimir dos veces descuenta una sola vez.** Sacar dos copias del mismo
  papel es normal; descontar dos veces dejaría el inventario mal y no hay
  forma de devolver material.

## Probar

    npm test                                        # los 22 tests de API
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
| POST | `/api/ordenes` | Confirmar la orden y descontar |

**`POST /api/ordenes` es el único camino que escribe stock.** Recibe
`{ lineas: [{ id_producto, cantidad }] }`, donde ambos campos deben ser
**números** (los strings se rechazan con 400). Valida todo antes de tocar
nada, relee las cantidades de la base en vez de confiar en las del navegador,
suma las líneas repetidas del mismo producto **antes** de compararlas contra
el stock, y aplica los `UPDATE` dentro de una transacción: todo o nada. Si
algo no alcanza responde 409 con `{ faltantes }` sin descontar nada.

El principio detrás: **nunca imprimir un papel que no corresponda al estado
real del inventario.** Si el descuento no se pudo aplicar, no hay papel.

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
                              └─────────────┴────────────────────────┘

La cantidad vive en el producto, no en una tabla puente. Las tablas
`usuarios` e `historial_login` existen pero ninguna ruta ni pantalla las usa:
**no hay autenticación**, quedó explícitamente para después.

No hay CLI de sqlite3 instalado. Para inspeccionar la base:

    node -e "const s=require('sqlite3');new s.Database('./db/inventario.db3').all('SELECT * FROM productos',[],(e,r)=>console.table(e||r))"

### Migraciones

Van en `db/migrations/`, aplicadas con el runner:

    node db/migrations/run.js db/migrations/001-productos-con-area.sql db/inventario.db3

El runner **no tiene ruta de base por defecto** a propósito: hay que pasarla
siempre, para que sea imposible migrar la base real por accidente. Haz copia
antes de correr cualquier migración.

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

- **Usuarios y login.** Diferido explícitamente.
- **Devolución de material.** El descuento es de una sola vía; corregir un
  error obliga a editar la cantidad desde Inventario.
- **Historial de órdenes.** No se guarda qué se pidió ni cuándo: la orden
  descuenta y desaparece.
