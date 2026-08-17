-- Migración 003: devoluciones
--
-- La 002 dejó registrado lo que sale del almacén, pero el negocio es de ida y
-- vuelta: el material va a un evento y regresa. Hasta ahora el stock quedaba
-- descontado para siempre y la vuelta se corregía a mano desde el CRUD,
-- producto por producto y sin constancia de a qué orden correspondía. No había
-- forma de responder cuándo volvió lo que salió el martes.
--
-- Una fila aquí significa "esta orden ya regresó completa". La devolución es
-- todo o nada, igual que la salida, así que basta una fila por orden y no hace
-- falta una tabla de líneas: lo que volvió es exactamente lo que dice
-- `orden_lineas`.
--
-- `UNIQUE` en `id_orden` es la pieza importante y no un adorno del índice:
-- convierte "una orden se devuelve una sola vez" en garantía de la base en vez
-- de en un `if` de la aplicación. Es el espejo de la regla que ya existe para
-- la salida — imprimir dos veces descuenta una sola — y merece el mismo rigor,
-- porque devolver dos veces infla el inventario con material que no existe.
--
-- Como la 002, es puramente aditiva: solo CREATE TABLE. No toca ninguna tabla
-- existente, así que una versión vieja de la app sigue funcionando contra una
-- base ya migrada. Revertir es DROP TABLE devoluciones; no hay pérdida de datos
-- previos porque nace vacía.
--
-- Si algún día hicieran falta devoluciones parciales, el camino es añadir
-- `devolucion_lineas` y quitar el UNIQUE, sin reescribir nada de esto.

BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS devoluciones (
  id_devolucion INTEGER PRIMARY KEY AUTOINCREMENT,
  id_orden      INTEGER NOT NULL UNIQUE REFERENCES ordenes(id_orden),
  recibida_en   TEXT NOT NULL,              -- ISO-8601 en UTC, lo pone el servidor
  recibida_por  TEXT
);

COMMIT;
