// Candado de aviso que serializa el DDL de esquema (CREATE/DROP SCHEMA) entre
// los archivos de test, que corren en procesos paralelos. Antes vivía dentro
// de helpers/db.js, pero test/db.test.js también hace su propio DDL de
// esquema (prueba db.js directamente, con su propio ESQUEMA_BD) y necesitaba
// el mismo candado.
//
// Este módulo NO requiere `../../db.js`, y eso es a propósito, no un
// descuido: tanto helpers/db.js como db.test.js fijan `process.env.ESQUEMA_BD`
// por su cuenta ANTES de requerir `../../db.js` (helpers/db.js incluso lo hace
// cumplir con un guardia que revienta si db.js ya estaba cargado). Si este
// archivo hiciera su propio `require('../../db.js')` a nivel superior,
// cualquiera de los dos que lo requiriera primero decidiría con qué
// `ESQUEMA_BD` se construye el pool para el OTRO también, o dispararía ese
// guardia sin venir a cuento. Recibir el `pool` ya abierto como parámetro
// evita el problema entero: da igual desde qué archivo, y en qué orden, se
// llame a `conCandadoDeDDL` — no hay ningún require de `db.js` aquí que
// pueda pisar el de nadie.
const CANDADO_DDL = 918273645; // constante arbitraria, compartida por todos los procesos

// `pg_advisory_xact_lock` y no `pg_advisory_lock`/`pg_advisory_unlock`: el de
// transacción se suelta SOLO al terminar la transacción —COMMIT, ROLLBACK, o
// la sesión que se cae— sin que nadie tenga que acordarse de soltarlo aparte.
// Un candado de SESIÓN exige tomarlo y soltarlo en la MISMA conexión, y aquí
// esa conexión sale de un pool: un olvido, o un `throw` entre las dos
// llamadas, lo dejaría tomado durante toda la vida de esa conexión reciclada
// —colgando a cualquier corrida futura que reutilizara ese cliente del
// pool—. El de transacción no tiene esa forma de fallar.
async function conCandadoDeDDL(pool, fn) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query('SELECT pg_advisory_xact_lock($1)', [CANDADO_DDL]);
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    cliente.release();
    return resultado;
  } catch (err) {
    // Mismo criterio que `enTransaccion` en db.js: si el propio ROLLBACK
    // falla, el cliente se destruye (`release(true)`) en vez de devolverse al
    // pool con la transacción —y con ella el candado— todavía abierta.
    const rollbackFallo = await cliente.query('ROLLBACK').then(
      () => false,
      () => true
    );
    cliente.release(rollbackFallo);
    throw err;
  }
}

module.exports = { conCandadoDeDDL, CANDADO_DDL };
