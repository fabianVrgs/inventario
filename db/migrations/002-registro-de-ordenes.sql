-- Migración 002: registro de órdenes
--
-- Hasta ahora, aplicar una orden solo hacía
--   UPDATE productos SET cantidad = cantidad - ?
-- así que el stock cambiaba y el motivo se perdía: no había forma de
-- responder qué salió el martes, para qué evento ni quién lo pidió. La única
-- copia de esa información era el papel impreso.
--
-- Estas dos tablas guardan la orden en el mismo COMMIT que el descuento, así
-- que no puede existir stock descontado sin su registro ni al revés.
--
-- A diferencia de la 001, esta migración es puramente aditiva: solo CREATE
-- TABLE / CREATE INDEX. No toca ninguna tabla existente, así que una versión
-- vieja de la app sigue funcionando contra una base ya migrada (durante el
-- rollout simplemente no escribe estas tablas). Revertir es DROP de las dos
-- tablas; no hay pérdida de datos previos porque nacen vacías.

BEGIN TRANSACTION;

-- Cabecera de la orden. `evento` y `responsable` son los dos campos que se
-- teclean en el formato antes de imprimir; van NULL si se imprimió en blanco
-- para rellenarlos a mano en el papel.
CREATE TABLE IF NOT EXISTS ordenes (
  id_orden    INTEGER PRIMARY KEY AUTOINCREMENT,
  creada_en   TEXT NOT NULL,              -- ISO-8601 en UTC, lo pone el servidor
  evento      TEXT,
  responsable TEXT
);

-- Una fila por producto de la orden, con las líneas repetidas ya sumadas
-- (igual que el UPDATE de stock, que agrupa antes de descontar).
--
-- `nombre` se copia a propósito, aunque `productos` ya lo tenga: esto es un
-- registro histórico, no una vista. Si el producto se renombra o se borra del
-- catálogo, la orden de marzo tiene que seguir diciendo qué salió de verdad.
-- Lo escribe el servidor desde su propio SELECT, nunca desde el navegador.
CREATE TABLE IF NOT EXISTS orden_lineas (
  id_linea    INTEGER PRIMARY KEY AUTOINCREMENT,
  id_orden    INTEGER NOT NULL REFERENCES ordenes(id_orden),
  id_producto INTEGER NOT NULL REFERENCES productos(id_producto),
  nombre      TEXT NOT NULL,
  cantidad    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orden_lineas_orden ON orden_lineas(id_orden);

COMMIT;
