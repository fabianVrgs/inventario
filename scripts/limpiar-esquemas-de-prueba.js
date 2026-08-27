// Si un proceso de test revienta o se corta con Ctrl-C, su esquema queda.
// Esto los barre antes de cada corrida.
const { pool } = require('../db.js');
// Este script corre como `pretest`: serializado, y ANTES de que arranquen los
// cuatro archivos de test en paralelo. Bajo un solo `npm test` su propio
// DROP SCHEMA nunca puede chocar con el de otro proceso —no hay "otro
// proceso" corriendo todavía—, así que el riesgo que motivó el candado (dos
// DROP SCHEMA simultáneos peleándose por el catálogo) no aplica aquí del
// mismo modo. Sólo se manifestaría con dos `npm test` a la vez —dos personas,
// o dos trabajos de CI en paralelo—, que sí comparten la misma base. Se
// envuelve de todos modos para que «todo el DDL de esquema pasa por el
// candado» sea un invariante sin excepciones: uno con una excepción
// documentada en otro archivo no sobrevive al próximo refactor.
const { conCandadoDeDDL } = require('../test/helpers/candado.js');

(async () => {
  const { rows } = await pool.query(
    `SELECT schema_name FROM information_schema.schemata
     WHERE schema_name LIKE 'inventario\_test\_%' OR schema_name LIKE 'db\_test\_%'`
  );
  for (const { schema_name } of rows) {
    await conCandadoDeDDL(pool, async (cliente) => {
      await cliente.query(`DROP SCHEMA IF EXISTS ${schema_name} CASCADE`);
    });
    console.log(`esquema huérfano borrado: ${schema_name}`);
  }
  await pool.end();
})().catch((e) => {
  console.error('no se pudieron limpiar los esquemas:', e.message);
  process.exit(1);
});
