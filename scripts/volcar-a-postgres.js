// Vuelca db/inventario.db3 a Postgres. DE UN SOLO USO: se borra en la tarea 10.
// Va por `pg` y no por el MCP porque son datos, no DDL, y necesitan una sola
// transacción que cubra las cinco tablas.
//
// NO viajan `cuentas` ni `sesiones`: las cuentas se crean de cero con
// scripts/cuenta.js, para que ningún hash de contraseña llegue a GitHub.
// `codigos_respaldo` está vacía y `accesos` son 7 filas de bitácora local.
const sqlite3 = require('sqlite3');
const { enTransaccion, pool } = require('../db.js');

const origen = new sqlite3.Database('./db/inventario.db3');
const leer = (sql) =>
  new Promise((res, rej) => origen.all(sql, [], (e, filas) => (e ? rej(e) : res(filas))));

const TABLAS = [
  { nombre: 'areas', pk: 'id_area', columnas: ['id_area', 'nombre'] },
  { nombre: 'productos', pk: 'id_producto',
    columnas: ['id_producto', 'nombre', 'marca', 'descripcion', 'cantidad', 'activo', 'id_area'] },
  { nombre: 'ordenes', pk: 'id_orden', columnas: ['id_orden', 'creada_en', 'evento', 'responsable'] },
  { nombre: 'orden_lineas', pk: 'id_linea',
    columnas: ['id_linea', 'id_orden', 'id_producto', 'nombre', 'cantidad'] },
  { nombre: 'devoluciones', pk: 'id_devolucion',
    columnas: ['id_devolucion', 'id_orden', 'recibida_en', 'recibida_por'] },
];

(async () => {
  await enTransaccion(async (cliente) => {
    for (const { nombre, pk, columnas } of TABLAS) {
      const filas = await leer(`SELECT ${columnas.join(', ')} FROM ${nombre} ORDER BY ${pk}`);
      const marcadores = columnas.map((_, i) => `$${i + 1}`).join(', ');

      for (const fila of filas) {
        await cliente.query(
          `INSERT INTO ${nombre} (${columnas.join(', ')}) VALUES (${marcadores})`,
          columnas.map((c) => fila[c])
        );
      }

      // Con ids explícitos la secuencia se queda en 1. Sin esto, el primer
      // INSERT de la app chocaría con la clave primaria.
      const { rows } = await cliente.query(`SELECT coalesce(max(${pk}), 0) + 1 AS siguiente FROM ${nombre}`);
      await cliente.query(
        `ALTER TABLE ${nombre} ALTER COLUMN ${pk} RESTART WITH ${rows[0].siguiente}`
      );

      console.log(`${nombre}: ${filas.length} filas, secuencia en ${rows[0].siguiente}`);
    }
  });

  origen.close();
  await pool.end();
})().catch((e) => {
  console.error('FALLÓ, nada se escribió:', e.message);
  process.exit(1);
});
