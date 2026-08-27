// Cada ARCHIVO de test tiene su propio esquema Postgres. El runner de node
// ejecuta cada archivo en su propio proceso y los corre en paralelo, así que
// contra un esquema compartido se pisarían: sembrar() vacía las tablas en cada
// beforeEach.
//
// Antes esto se resolvía con un archivo .db3 temporal por proceso. El esquema
// hace exactamente lo mismo.
const fs = require('node:fs');
const path = require('node:path');

const ESQUEMA = `inventario_test_${process.pid}`;

// Se fija ANTES de requerir db.js, y aquí SÍ importa el orden respecto al
// `require`: db.js lee ESQUEMA_BD una sola vez, al cargarse (al construir el
// Pool), no en cada conexión. Si algo requiriera `../../db.js` antes de que
// esta línea corriera, el pool nacería sin `options: -c search_path=...` y
// ya no habría forma de arreglarlo después: todas las conexiones de ese pool
// vivirían en `public` — la base real del almacén — y `sembrar()` haría
// TRUNCATE ahí en cada test. El guardia de abajo existe precisamente para que
// ese olvido no pueda pasar en silencio.
if (require.cache[require.resolve('../../db.js')]) {
  throw new Error('db.js ya estaba cargado: ESQUEMA_BD llega tarde y el aislamiento no se aplicaría.');
}
process.env.ESQUEMA_BD = ESQUEMA;

const { pool, consultar } = require('../../db.js');

// El candado que serializa el DDL de esquema (CREATE/DROP SCHEMA) entre
// procesos de test vive en su propio módulo — ./candado.js — y no aquí,
// porque test/db.test.js también hace su propio DDL de esquema y necesita el
// mismo candado sin heredar el `ESQUEMA_BD`/`require.cache` de ESTE archivo
// (ver el comentario de candado.js para el porqué).
const { conCandadoDeDDL } = require('./candado.js');

// El mismo DDL que producción, leído del archivo real: si el esquema cambia y
// aquí no, los tests correrían contra un modelo que ya no existe.
const DDL = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'esquema.sql'), 'utf8');

async function crearEsquema() {
  await conCandadoDeDDL(pool, async (cliente) => {
    await cliente.query(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE`);
    await cliente.query(`CREATE SCHEMA ${ESQUEMA}`);
  });
  await consultar(DDL);
  return ESQUEMA;
}

async function borrarEsquema() {
  await conCandadoDeDDL(pool, async (cliente) => {
    await cliente.query(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE`);
  });
}

// Cinturón y tirantes para TODO lo que trunca. Se llama antes de cualquier
// TRUNCATE en este helper y en helpers/sesion.js: si el aislamiento por
// esquema fallara por cualquier motivo, esto es lo que impide que una
// corrida de tests borre el inventario o las cuentas reales de `public`.
// Una sola función con nombre en vez de repetir el mismo SELECT en cada
// sitio que trunca.
async function exigirEsquemaDePruebas() {
  const { rows } = await consultar('SELECT current_schema() AS esquema');
  if (rows[0].esquema !== ESQUEMA) {
    throw new Error(
      `Se esperaba estar en el esquema "${ESQUEMA}" y la conexión apuntaba a ` +
      `"${rows[0].esquema}". Abortado antes del TRUNCATE.`
    );
  }
}

// Los mismos datos que sembraba la versión SQLite, literales.
const DATOS_AREAS = `
  INSERT INTO areas (id_area, nombre) VALUES
    (1, 'luces'),
    (2, 'Sonido')
`;

const DATOS_PRODUCTOS = `
  INSERT INTO productos (id_producto, nombre, marca, descripcion, cantidad, activo, id_area) VALUES
    (1, 'vim2',      'Clay Paky', 'Cabeza móvil',          4,  1, 1),
    (2, 'BT3',       'yamaha',    'Bafle de tres vías',    30, 1, 2),
    (3, 'Cable XLR', 'Proel',     'Cable XLR de 5 metros', 40, 1, 2),
    (4, 'Array',     'rcf',       'Line array',            15, 0, 2)
`;

// OJO con qué se vacía aquí. Esto corre en el beforeEach de cada test, mientras
// que las cuentas se siembran UNA vez en el before. Incluir `cuentas` en el
// TRUNCATE dejaría sin dueño la sesión con la que el archivo entero hace sus
// peticiones, y la suite fallaría con 401 a partir del segundo test.
//
// RESTART IDENTITY no es cosmético: varios tests asumen id_producto = 1 y = 2.
// El CASCADE es seguro: nada fuera de esta lista referencia a estas tablas
// —orden_lineas.id_producto no tiene clave foránea a propósito— así que no
// arrastra nada que no esté ya nombrado.
async function sembrar() {
  await exigirEsquemaDePruebas();

  await consultar(`
    TRUNCATE areas, productos, ordenes, orden_lineas, devoluciones
    RESTART IDENTITY CASCADE
  `);
  await consultar(DATOS_AREAS);
  await consultar(DATOS_PRODUCTOS);

  // Con ids explícitos la secuencia se queda en 1; sin esto, el primer alta de
  // producto de cualquier test chocaría con la clave primaria.
  await consultar('ALTER TABLE areas ALTER COLUMN id_area RESTART WITH 3');
  await consultar('ALTER TABLE productos ALTER COLUMN id_producto RESTART WITH 5');
}

// `consultar` se reexporta (viene del `../../db.js` de la raíz) para que
// helpers/sesion.js — y cualquier otro helper de test— lo tomen de AQUÍ y no
// del db.js de la raíz directamente. Es la misma razón por la que sesion.js
// requiere este archivo en vez de aquél: una sola puerta de entrada que
// obliga a pasar primero por donde se fija `ESQUEMA_BD`, así ningún helper
// puede saltarse ese orden y truncar cuentas contra `public`, la base real.
module.exports = {
  crearEsquema,
  borrarEsquema,
  sembrar,
  exigirEsquemaDePruebas,
  consultar,
  ESQUEMA,
};
