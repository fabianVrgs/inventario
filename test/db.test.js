// Estos tests hablan con Postgres de verdad. Usan su propio esquema para no
// pisar ni la base real ni a los otros archivos de test.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const ESQUEMA = `db_test_${process.pid}`;
process.env.ESQUEMA_BD = ESQUEMA;

const { pool, consultar, enTransaccion } = require('../db.js');
// Sólo el candado, NO test/helpers/db.js: este archivo prueba db.js
// directamente, con su propio ESQUEMA_BD fijado arriba, y helpers/db.js fija
// el suyo propio (con un guardia que revienta si db.js ya estaba cargado).
// Importarlo aquí para nada más que el candado heredaría ese conflicto de
// mala manera sin ganar nada a cambio — candado.js no toca `ESQUEMA_BD` ni
// requiere `db.js`, así que da igual desde qué archivo se use.
const { conCandadoDeDDL } = require('./helpers/candado.js');

before(async () => {
  // Mismo candado que test/helpers/db.js: sin él, dos procesos de test
  // haciendo CREATE/DROP SCHEMA a la vez pueden acabar en
  // `deadlock detected` (40P01) por contención en el catálogo de Postgres,
  // aunque sus esquemas no colisionen entre sí.
  await conCandadoDeDDL(pool, async (cliente) => {
    await cliente.query(`CREATE SCHEMA IF NOT EXISTS ${ESQUEMA}`);
  });
  await consultar('CREATE TABLE caja (n integer)');
});

after(async () => {
  await conCandadoDeDDL(pool, async (cliente) => {
    await cliente.query(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE`);
  });
  await pool.end();
});

test('consultar devuelve filas y rowCount', async () => {
  const r = await consultar('INSERT INTO caja (n) VALUES ($1) RETURNING n', [7]);
  assert.equal(r.rowCount, 1);
  assert.equal(r.rows[0].n, 7);
});

test('enTransaccion confirma si la función resuelve', async () => {
  await enTransaccion(async (cliente) => {
    await cliente.query('INSERT INTO caja (n) VALUES ($1)', [1]);
  });
  const { rows } = await consultar('SELECT count(*)::int AS c FROM caja WHERE n = 1');
  assert.equal(rows[0].c, 1);
});

test('enTransaccion revierte si la función lanza, y propaga el error', async () => {
  await assert.rejects(
    enTransaccion(async (cliente) => {
      await cliente.query('INSERT INTO caja (n) VALUES ($1)', [2]);
      throw new Error('a propósito');
    }),
    /a propósito/
  );
  const { rows } = await consultar('SELECT count(*)::int AS c FROM caja WHERE n = 2');
  assert.equal(rows[0].c, 0, 'el INSERT de una transacción abortada no debe quedar');
});

test('dos transacciones simultáneas no se revierten entre sí', async () => {
  // Esta es la razón entera de usar un cliente por transacción: con una sola
  // conexión, el ROLLBACK de una petición se llevaba por delante lo que otra
  // estuviera haciendo.
  const buena = enTransaccion(async (cliente) => {
    await cliente.query('INSERT INTO caja (n) VALUES ($1)', [3]);
  });
  const mala = enTransaccion(async (cliente) => {
    await cliente.query('INSERT INTO caja (n) VALUES ($1)', [4]);
    throw new Error('esta falla');
  }).catch(() => {});

  await Promise.all([buena, mala]);

  const { rows } = await consultar('SELECT n FROM caja WHERE n IN (3, 4) ORDER BY n');
  assert.deepEqual(rows.map((f) => f.n), [3], 'la transacción buena debe sobrevivir a la mala');
});
