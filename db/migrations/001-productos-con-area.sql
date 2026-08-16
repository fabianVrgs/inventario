-- Migración 001: productos con área y cantidad propia
--
-- Reestructura el modelo de datos: `productos` pasa a tener su propio
-- `cantidad` y `id_area` (antes vivían en la tabla puente
-- `detalle_inventario`, con cantidad por subproceso y no por producto).
-- `subprocesos` se renombra conceptualmente a `areas` y `detalle_inventario`
-- desaparece.
--
-- SQLite no soporta agregar una FOREIGN KEY con ALTER TABLE, así que el
-- patrón es: crear tabla nueva con el esquema destino, volcar los datos,
-- borrar la vieja y renombrar. Todo dentro de una sola transacción para
-- que un fallo a mitad de camino no deje la base en un estado intermedio.
--
-- NOTA sobre `observaciones` (columna de detalle_inventario que se pierde):
-- en los datos reales NO está vacía — las 4 filas de detalle_inventario
-- traen un valor ('blinder', 'parcot', 'bt3', 'array'), pero en los 4 casos
-- el valor duplica el nombre del producto (o el de otro producto ya
-- existente en el catálogo) y no aporta información nueva. Aun así, se
-- descarta tal como pide el esquema destino; queda documentado aquí por si
-- se necesita recuperarla del archivo .bak más adelante.

BEGIN TRANSACTION;

-- 1. `areas` reemplaza a `subprocesos`, conservando los mismos IDs para que
--    `id_area` en productos siga apuntando a la fila correcta sin remapeo.
CREATE TABLE areas (
  id_area INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE
);

INSERT INTO areas (id_area, nombre)
SELECT id_subproceso, nombre FROM subprocesos;

-- 2. Tabla `productos` con el esquema destino (cantidad y área propias).
CREATE TABLE productos_nuevo (
  id_producto INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  marca TEXT,
  descripcion TEXT,
  cantidad INTEGER NOT NULL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1,
  id_area INTEGER REFERENCES areas(id_area)
);

-- 3. Volcado: LEFT JOIN contra detalle_inventario porque no todo producto
--    tiene fila de detalle (productos huérfanos). Se verificó de antemano
--    que ningún producto aparece en más de un id_subproceso, así que el
--    LEFT JOIN no puede multiplicar filas ni generar ambigüedad en el fold
--    a `cantidad`.
--    - cantidad: la de detalle, o 0 si no tiene fila (huérfano).
--    - id_area: el id_subproceso de detalle, o NULL si no tiene fila.
--    - activo: 1 si tenía fila en detalle, 0 si es huérfano (el usuario
--      decide después, desde el CRUD, si esos productos huérfanos —o los
--      duplicados que sobreviven sin fusionarse— se reactivan o se borran).
INSERT INTO productos_nuevo (id_producto, nombre, marca, descripcion, cantidad, activo, id_area)
SELECT
  p.id_producto,
  p.nombre,
  p.marca,
  p.descripcion,
  COALESCE(d.cantidad, 0)      AS cantidad,
  CASE WHEN d.id_detalle IS NULL THEN 0 ELSE 1 END AS activo,
  d.id_subproceso               AS id_area
FROM productos p
LEFT JOIN detalle_inventario d ON d.id_producto = p.id_producto;

-- 4. Reemplaza la tabla vieja por la nueva.
DROP TABLE productos;
ALTER TABLE productos_nuevo RENAME TO productos;

-- 5. Elimina las tablas que quedan obsoletas tras la reestructuración.
DROP TABLE detalle_inventario;
DROP TABLE subprocesos;

COMMIT;
