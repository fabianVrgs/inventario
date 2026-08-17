// Runner de migraciones SQL para db/inventario.db3.
//
// Uso:
//   node db/migrations/run.js <archivo.sql> [ruta_base_de_datos]
//   DB_PATH=<ruta_base_de_datos> node db/migrations/run.js <archivo.sql>
//
// La ruta de la base de datos se toma del segundo argumento si se pasa,
// si no del env DB_PATH. A propósito NO hay una ruta por defecto: exigir
// que siempre se indique explícitamente evita correr una migración sobre
// db/inventario.db3 por accidente.
//
// El .sql debe traer su propio BEGIN TRANSACTION / COMMIT. Si algo falla
// a mitad de camino, este runner emite ROLLBACK explícito antes de morir,
// para no dejar la base en un estado a medias, y termina con código de
// salida distinto de cero.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();

function main() {
  const sqlFileArg = process.argv[2];
  const dbPathArg = process.argv[3] || process.env.DB_PATH;

  if (!sqlFileArg) {
    fallar('Falta el archivo .sql a aplicar. Uso: node db/migrations/run.js <archivo.sql> [ruta_base_de_datos]');
  }
  if (!dbPathArg) {
    fallar('Falta la ruta de la base de datos. Pásala como segundo argumento o en el env DB_PATH.');
  }

  const sqlPath = path.resolve(sqlFileArg);
  const dbPath = path.resolve(dbPathArg);

  if (!fs.existsSync(sqlPath)) {
    fallar(`No existe el archivo SQL: ${sqlPath}`);
  }
  if (!fs.existsSync(dbPath)) {
    fallar(`No existe la base de datos: ${dbPath}`);
  }

  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log(`Aplicando ${sqlPath}`);
  console.log(`  sobre    ${dbPath}`);

  const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
    if (err) fallar(`No se pudo abrir la base de datos: ${err.message}`);

    db.exec(sql, (execErr) => {
      if (execErr) {
        // El .sql ya trae BEGIN/COMMIT; si exec falló a mitad de camino
        // puede haber quedado una transacción abierta. La revertimos
        // explícitamente para no dejar la base a medias.
        db.exec('ROLLBACK;', () => {
          db.close(() => {
            fallar(`La migración falló y se revirtió: ${execErr.message}`);
          });
        });
        return;
      }

      db.close((closeErr) => {
        if (closeErr) fallar(`Migración aplicada, pero falló el cierre de la conexión: ${closeErr.message}`);
        console.log('Migración aplicada correctamente.');
      });
    });
  });
}

function fallar(mensaje) {
  console.error(`ERROR: ${mensaje}`);
  process.exit(1);
}

main();
