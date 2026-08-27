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

// Se fija ANTES de requerir db.js, y el orden es lo único que separa a los
// tests de la base real: db.js registra su hook de search_path al cargarse.
// Si un archivo de test requiriera este helper y fijara la variable después,
// el hook ya estaría puesto y todo caería en `public`.
process.env.ESQUEMA_BD = ESQUEMA;

const { pool, consultar } = require('../../db.js');

// El mismo DDL que producción, leído del archivo real: si el esquema cambia y
// aquí no, los tests correrían contra un modelo que ya no existe.
const DDL = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'esquema.sql'), 'utf8');

async function crearEsquema() {
  await pool.query(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE`);
  await pool.query(`CREATE SCHEMA ${ESQUEMA}`);
  await consultar(DDL);
  return ESQUEMA;
}

async function borrarEsquema() {
  await pool.query(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE`);
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
  // Cinturón y tirantes. Esta función ejecuta TRUNCATE, así que antes se
  // asegura de que NO está apuntando a `public`: si el aislamiento por esquema
  // fallara por cualquier motivo, esto es lo que impide que una corrida de
  // tests borre el inventario real del almacén.
  const { rows } = await consultar('SELECT current_schema() AS esquema');
  if (rows[0].esquema !== ESQUEMA) {
    throw new Error(
      `sembrar() apuntaba a "${rows[0].esquema}" y no a "${ESQUEMA}". ` +
      'Abortado antes del TRUNCATE.'
    );
  }

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

module.exports = { crearEsquema, borrarEsquema, sembrar, ESQUEMA };
