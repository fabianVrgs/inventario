const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3');

// Esquema equivalente al de db/inventario.db3 tras la migración 001.
// Se recrea en un archivo temporal para que los tests nunca escriban
// sobre la base versionada.
const ESQUEMA_001 = `
  CREATE TABLE areas (
    id_area INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE
  );

  CREATE TABLE productos (
    id_producto INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    marca TEXT,
    descripcion TEXT,
    cantidad INTEGER NOT NULL DEFAULT 0,
    activo INTEGER NOT NULL DEFAULT 1,
    id_area INTEGER REFERENCES areas(id_area)
  );
`;

// Lo que añade la migración 002. Separado a propósito: `crearBaseSinOrdenes`
// omite este bloque para reproducir una base a la que aún no se le aplicó.
const ESQUEMA_002 = `
  CREATE TABLE ordenes (
    id_orden    INTEGER PRIMARY KEY AUTOINCREMENT,
    creada_en   TEXT NOT NULL,
    evento      TEXT,
    responsable TEXT
  );

  CREATE TABLE orden_lineas (
    id_linea    INTEGER PRIMARY KEY AUTOINCREMENT,
    id_orden    INTEGER NOT NULL REFERENCES ordenes(id_orden),
    id_producto INTEGER NOT NULL REFERENCES productos(id_producto),
    nombre      TEXT NOT NULL,
    cantidad    INTEGER NOT NULL
  );

  CREATE INDEX idx_orden_lineas_orden ON orden_lineas(id_orden);
`;

// Lo que añade la migración 003. Una fila por orden ya devuelta; el UNIQUE es
// lo que impide devolver dos veces la misma.
const ESQUEMA_003 = `
  CREATE TABLE devoluciones (
    id_devolucion INTEGER PRIMARY KEY AUTOINCREMENT,
    id_orden      INTEGER NOT NULL UNIQUE REFERENCES ordenes(id_orden),
    recibida_en   TEXT NOT NULL,
    recibida_por  TEXT
  );
`;

// Lo que añade la migración 004: autenticación. `cuentas` nace vacía a
// propósito — cada test siembra las que necesita con test/helpers/sesion.js.
const ESQUEMA_004 = `
  CREATE TABLE cuentas (
    id_cuenta        INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario          TEXT NOT NULL UNIQUE COLLATE NOCASE,
    hash             TEXT NOT NULL,
    rol              TEXT NOT NULL CHECK (rol IN ('admin', 'superadmin')),
    totp_secreto     TEXT,
    totp_ultimo_paso INTEGER,
    creada_en        TEXT NOT NULL,
    activa           INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE sesiones (
    id_sesion  INTEGER PRIMARY KEY AUTOINCREMENT,
    hash_token TEXT NOT NULL UNIQUE,
    id_cuenta  INTEGER NOT NULL REFERENCES cuentas(id_cuenta),
    creada_en  TEXT NOT NULL,
    vista_en   TEXT NOT NULL,
    expira_en  TEXT NOT NULL,
    ip         TEXT,
    agente     TEXT
  );

  CREATE INDEX idx_sesiones_cuenta ON sesiones(id_cuenta);

  CREATE TABLE codigos_respaldo (
    id_codigo INTEGER PRIMARY KEY AUTOINCREMENT,
    id_cuenta INTEGER NOT NULL REFERENCES cuentas(id_cuenta),
    hash      TEXT NOT NULL,
    usado_en  TEXT
  );

  CREATE INDEX idx_codigos_respaldo_cuenta ON codigos_respaldo(id_cuenta);

  CREATE TABLE accesos (
    id_acceso   INTEGER PRIMARY KEY AUTOINCREMENT,
    ocurrido_en TEXT NOT NULL,
    usuario     TEXT,
    resultado   TEXT NOT NULL,
    ip          TEXT
  );

  CREATE INDEX idx_accesos_fecha ON accesos(ocurrido_en);
`;

const ESQUEMA = ESQUEMA_001 + ESQUEMA_002 + ESQUEMA_003 + ESQUEMA_004;

const DATOS = `
  INSERT INTO areas (id_area, nombre) VALUES
    (1, 'luces'),
    (2, 'Sonido');

  INSERT INTO productos (id_producto, nombre, marca, descripcion, cantidad, activo, id_area) VALUES
    (1, 'vim2',      'Clay Paky', 'Cabeza móvil',          4,  1, 1),
    (2, 'BT3',       'yamaha',    'Bafle de tres vías',    30, 1, 2),
    (3, 'Cable XLR', 'Proel',     'Cable XLR de 5 metros', 40, 1, 2),
    (4, 'Array',     'rcf',       'Line array',            15, 0, 2);
`;

// Crea la base temporal con el esquema vacío y devuelve su ruta.
function crearBaseTemporal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inventario-test-'));
  const archivo = path.join(dir, 'inventario.db3');

  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(archivo, (err) => {
      if (err) return reject(err);

      db.exec(ESQUEMA, (err) => {
        if (err) return reject(err);
        db.close((err) => (err ? reject(err) : resolve({ dir, archivo })));
      });
    });
  });
}

// Crea una base con la 001 aplicada pero SIN la 002, ya sembrada: reproduce
// db/inventario.db3 tal como está versionada en el repo, donde las tablas de
// órdenes no existen todavía.
function crearBaseSinOrdenes() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inventario-test-sin-ordenes-'));
  const archivo = path.join(dir, 'inventario.db3');

  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(archivo, (err) => {
      if (err) return reject(err);

      db.exec(ESQUEMA_001 + DATOS, (err) => {
        if (err) return reject(err);
        db.close((err) => (err ? reject(err) : resolve({ dir, archivo })));
      });
    });
  });
}

// Deja la base en el estado sembrado. Se llama antes de cada test para que
// ninguno dependa de las mutaciones del anterior.
function sembrar(db) {
  return new Promise((resolve, reject) => {
    db.exec(
      `DELETE FROM devoluciones;
       DELETE FROM orden_lineas;
       DELETE FROM ordenes;
       DELETE FROM productos;
       DELETE FROM areas;
       DELETE FROM sqlite_sequence
         WHERE name IN ('productos', 'areas', 'ordenes', 'orden_lineas', 'devoluciones');
       ${DATOS}`,
      (err) => (err ? reject(err) : resolve())
    );
  });
}

module.exports = { crearBaseTemporal, crearBaseSinOrdenes, sembrar };
