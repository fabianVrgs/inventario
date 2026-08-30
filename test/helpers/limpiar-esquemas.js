// Si un proceso de test revienta o se corta con Ctrl-C, su esquema queda.
// Esto los barre antes de cada corrida.
const { pool } = require('../../src/db.js');
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
const { conCandadoDeDDL } = require('./candado.js');

// Un esquema sólo es huérfano si el proceso que lo creó ya no existe. El
// nombre lleva su PID (`inventario_test_<pid>`, `db_test_<pid>`), así que se
// puede preguntar: `process.kill(pid, 0)` no mata nada, sólo comprueba, y
// lanza ESRCH si no hay tal proceso.
//
// Sin esta comprobación, dos `npm test` solapados se destrozan entre sí: el
// segundo borra los esquemas del primero a mitad de corrida y sus tests
// fallan con "current_schema() es null" o 42P01 (`relation ... does not
// exist`) — un fallo que parece del código y no lo es.
function siguePorAhi(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // EPERM = existe, pero es de otro usuario.
  }
}

// Si el nombre no trae un PID reconocible, no hay proceso que preguntar por
// él: es basura de un formato antiguo y se borra sin más.
function pidDe(nombreEsquema) {
  const m = /_(\d+)$/.exec(nombreEsquema);
  return m ? Number(m[1]) : null;
}

(async () => {
  const { rows } = await pool.query(
    `SELECT schema_name FROM information_schema.schemata
     WHERE schema_name LIKE 'inventario\_test\_%' OR schema_name LIKE 'db\_test\_%'`
  );

  let borrados = 0;
  let saltados = 0;

  for (const { schema_name } of rows) {
    const pid = pidDe(schema_name);
    if (pid !== null && siguePorAhi(pid)) {
      saltados += 1;
      continue;
    }

    await conCandadoDeDDL(pool, async (cliente) => {
      await cliente.query(`DROP SCHEMA IF EXISTS ${schema_name} CASCADE`);
    });
    console.log(`esquema huérfano borrado: ${schema_name}`);
    borrados += 1;
  }

  console.log(`limpieza de esquemas: ${borrados} borrados, ${saltados} en uso (saltados)`);
  await pool.end();
})().catch((e) => {
  console.error('no se pudieron limpiar los esquemas:', e.message);
  process.exit(1);
});
