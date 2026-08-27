// Si un proceso de test revienta o se corta con Ctrl-C, su esquema queda.
// Esto los barre antes de cada corrida.
const { pool } = require('../db.js');

(async () => {
  const { rows } = await pool.query(
    `SELECT schema_name FROM information_schema.schemata
     WHERE schema_name LIKE 'inventario\\_test\\_%' OR schema_name LIKE 'db\\_test\\_%'`
  );
  for (const { schema_name } of rows) {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema_name} CASCADE`);
    console.log(`esquema huérfano borrado: ${schema_name}`);
  }
  await pool.end();
})().catch((e) => {
  console.error('no se pudieron limpiar los esquemas:', e.message);
  process.exit(1);
});
