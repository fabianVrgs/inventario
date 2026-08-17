const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Base de datos SQLite
const dbPath = process.env.DB_PATH || './db/inventario.db3';
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Error al conectar a la base de datos:', err.message);
  } else {
    console.log('✅ Conectado a la base de datos SQLite.');
  }
});

// `db/inventario.db3` está versionado con la 001 aplicada pero sin la 002 ni la
// 003, así que recién clonado no tiene estas tablas y POST /api/ordenes responde
// 500 (`no such table: ordenes`). Crearlas al arrancar es idempotente y deja
// la app usable sin correr el runner de migraciones a mano.
//
// Se encola aquí, antes de declarar cualquier ruta, para que sqlite3 lo
// procese en esta conexión antes de la primera consulta de una petición.
// El DDL debe seguir igual al de db/migrations/002-registro-de-ordenes.sql y
// db/migrations/003-devoluciones.sql.
//
// Este bloque es también la razón por la que la 003 añade una tabla en vez de
// una columna a `ordenes`: `CREATE TABLE IF NOT EXISTS` no añade columnas a una
// tabla que ya existe, y `ALTER TABLE ... ADD COLUMN` no admite `IF NOT EXISTS`
// en SQLite, así que no hay forma idempotente de asegurarla desde aquí.
db.serialize(() => {
  db.exec(
    `CREATE TABLE IF NOT EXISTS ordenes (
       id_orden    INTEGER PRIMARY KEY AUTOINCREMENT,
       creada_en   TEXT NOT NULL,
       evento      TEXT,
       responsable TEXT
     );

     CREATE TABLE IF NOT EXISTS orden_lineas (
       id_linea    INTEGER PRIMARY KEY AUTOINCREMENT,
       id_orden    INTEGER NOT NULL REFERENCES ordenes(id_orden),
       id_producto INTEGER NOT NULL REFERENCES productos(id_producto),
       nombre      TEXT NOT NULL,
       cantidad    INTEGER NOT NULL
     );

     CREATE INDEX IF NOT EXISTS idx_orden_lineas_orden ON orden_lineas(id_orden);

     CREATE TABLE IF NOT EXISTS devoluciones (
       id_devolucion INTEGER PRIMARY KEY AUTOINCREMENT,
       id_orden      INTEGER NOT NULL UNIQUE REFERENCES ordenes(id_orden),
       recibida_en   TEXT NOT NULL,
       recibida_por  TEXT
     );`,
    (errEsquema) => {
      if (errEsquema) {
        console.error('❌ Error al asegurar las tablas de órdenes:', errEsquema.message);
      }
    }
  );
});

// Ruta principal
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/html/index.html');
});


// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Manejo de errores
app.use((err, req, res, next) => {
  console.error('❌ Error en el servidor:', err.message);
  res.status(500).send('Error interno del servidor');
});

// Iniciar servidor solo al ejecutar `node server.js`.
// Al importarse (tests) se exporta la app sin abrir puerto.
if (require.main === module) {
  app.listen(port, () => {
    console.log(`Servidor Express corriendo en http://localhost:${port}`);
  });
}

// API Read
app.get('/api/productos', (req, res) => {
  const { activo } = req.query;

  let sql = `
    SELECT p.*, a.nombre AS area
    FROM productos p
    LEFT JOIN areas a ON p.id_area = a.id_area
  `;
  const params = [];

  if (activo !== undefined) {
    sql += ' WHERE p.activo = ?';
    params.push(activo);
  }

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});
 //API Read ID
app.get('/api/productos/:id', (req, res) => {
  const id = req.params.id;
  db.get("SELECT * FROM productos WHERE id_producto = ?", [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(row);
  });
});

// Valida los campos comunes de POST/PUT. Devuelve un mensaje de error o null.
function validarProducto({ nombre, cantidad }) {
  if (!nombre) {
    return 'El nombre del producto es obligatorio.';
  }
  if (cantidad !== undefined && (typeof cantidad !== 'number' || cantidad < 0)) {
    return 'La cantidad no puede ser negativa.';
  }
  return null;
}

// API Create
app.post('/api/productos', (req, res) => {
  const { nombre, marca, descripcion, cantidad, id_area } = req.body;

  const errorValidacion = validarProducto(req.body);
  if (errorValidacion) {
    return res.status(400).json({ error: errorValidacion });
  }

  const sql = `INSERT INTO productos (nombre, marca, descripcion, cantidad, activo, id_area) VALUES (?, ?, ?, ?, 1, ?)`;

  db.run(sql, [nombre, marca, descripcion, cantidad ?? 0, id_area ?? null], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    res.status(201).json({
      mensaje: 'Producto creado exitosamente',
      id: this.lastID,
      nombre,
      marca,
      descripcion,
      cantidad: cantidad ?? 0,
      id_area: id_area ?? null,
    });
  });
});

// API Update
app.put('/api/productos/:id', (req, res) => {
  const id = req.params.id;
  const { nombre, marca, descripcion, cantidad, id_area } = req.body;

  const errorValidacion = validarProducto(req.body);
  if (errorValidacion) {
    return res.status(400).json({ error: errorValidacion });
  }

  const sql = `UPDATE productos SET nombre = ?, marca = ?, descripcion = ?, cantidad = ?, id_area = ? WHERE id_producto = ?`;

  db.run(sql, [nombre, marca, descripcion, cantidad ?? 0, id_area ?? null, id], function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    res.json({ mensaje: 'Producto reemplazado correctamente' });
  });
});

// API Activar/Desactivar
app.patch('/api/productos/:id/activo', (req, res) => {
  const id = req.params.id;
  const { activo } = req.body;

  const sql = `UPDATE productos SET activo = ? WHERE id_producto = ?`;

  db.run(sql, [activo ? 1 : 0, id], function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    res.json({ mensaje: 'Estado actualizado correctamente' });
  });
});

// API Areas
app.get('/api/areas', (req, res) => {
  db.all('SELECT * FROM areas', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Normaliza los campos de texto del formato (evento, responsable). Devuelve
// `undefined` si el valor no sirve, para poder responder 400 sin ambigüedad:
// null es un valor válido (el campo se dejó en blanco para rellenarlo a mano
// sobre el papel) y no puede confundirse con "lo que mandaron está mal".
const LARGO_MAXIMO_TEXTO = 200;

function normalizarTexto(valor) {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string') return undefined;
  const limpio = valor.trim();
  if (limpio.length === 0) return null;
  if (limpio.length > LARGO_MAXIMO_TEXTO) return undefined;
  return limpio;
}

// API Ordenes: descuenta stock y registra la orden de forma atómica (todo o
// nada). El registro va en el MISMO COMMIT que el descuento a propósito: no
// puede existir stock descontado sin constancia de por qué, ni constancia de
// una salida que no llegó a aplicarse.
app.post('/api/ordenes', (req, res) => {
  const { lineas } = req.body;

  if (!Array.isArray(lineas) || lineas.length === 0) {
    return res.status(400).json({ error: 'La orden debe incluir al menos una línea.' });
  }

  for (const linea of lineas) {
    const { id_producto, cantidad } = linea || {};
    if (
      typeof id_producto !== 'number' ||
      typeof cantidad !== 'number' ||
      !Number.isInteger(cantidad) ||
      cantidad <= 0
    ) {
      return res.status(400).json({ error: 'Cada línea debe tener id_producto y una cantidad entera positiva.' });
    }
  }

  const evento = normalizarTexto(req.body.evento);
  const responsable = normalizarTexto(req.body.responsable);
  if (evento === undefined || responsable === undefined) {
    return res.status(400).json({
      error: `Evento y responsable deben ser texto de hasta ${LARGO_MAXIMO_TEXTO} caracteres.`,
    });
  }

  db.serialize(() => {
    db.run('BEGIN', (errBegin) => {
      if (errBegin) return res.status(500).json({ error: errBegin.message });

      const abortar = (estado, cuerpo) =>
        db.run('ROLLBACK', () => res.status(estado).json(cuerpo));

      // Relee las cantidades actuales: nunca confiar en lo que manda el navegador.
      // El nombre también sale de aquí y no del cliente, porque se copia al
      // registro histórico.
      const ids = lineas.map((l) => l.id_producto);
      const marcadores = ids.map(() => '?').join(',');

      db.all(
        `SELECT id_producto, nombre, cantidad FROM productos WHERE id_producto IN (${marcadores})`,
        ids,
        (errSelect, filas) => {
          if (errSelect) return abortar(500, { error: errSelect.message });

          const productoPorId = new Map(filas.map((f) => [f.id_producto, f]));

          // Un mismo producto puede llegar en varias líneas. Se suman ANTES de
          // validar: si se comparara línea por línea, dos pedidos que caben por
          // separado podrían dejar el stock en negativo entre los dos.
          const pedidoPorId = new Map();
          for (const { id_producto, cantidad } of lineas) {
            pedidoPorId.set(id_producto, (pedidoPorId.get(id_producto) || 0) + cantidad);
          }

          const faltantes = [];
          for (const [id_producto, pedido] of pedidoPorId) {
            const fila = productoPorId.get(id_producto);
            const disponible = fila ? fila.cantidad : 0;
            if (!fila || pedido > disponible) {
              faltantes.push({ id_producto, pedido, disponible });
            }
          }

          if (faltantes.length > 0) return abortar(409, { faltantes });

          // Cabecera primero: sus líneas necesitan el id que genera este INSERT.
          // `function` y no arrow: el handler depende de `this.lastID`.
          db.run(
            'INSERT INTO ordenes (creada_en, evento, responsable) VALUES (?, ?, ?)',
            [new Date().toISOString(), evento, responsable],
            function (errOrden) {
              if (errOrden) return abortar(500, { error: errOrden.message });

              const idOrden = this.lastID;

              // Dos escrituras por producto: la línea del registro y el
              // descuento. Se cuentan juntas porque el COMMIT sólo puede salir
              // cuando han terminado TODAS.
              let pendientes = pedidoPorId.size * 2;
              let fallo = null;

              const alTerminar = (err) => {
                if (err && !fallo) fallo = err;
                pendientes -= 1;
                if (pendientes > 0) return;

                if (fallo) return abortar(500, { error: fallo.message });

                db.run('COMMIT', (errCommit) => {
                  if (errCommit) return res.status(500).json({ error: errCommit.message });
                  res.json({ mensaje: 'Orden aplicada correctamente', id_orden: idOrden });
                });
              };

              pedidoPorId.forEach((cantidad, id_producto) => {
                db.run(
                  'INSERT INTO orden_lineas (id_orden, id_producto, nombre, cantidad) VALUES (?, ?, ?, ?)',
                  [idOrden, id_producto, productoPorId.get(id_producto).nombre, cantidad],
                  alTerminar
                );
                db.run(
                  'UPDATE productos SET cantidad = cantidad - ? WHERE id_producto = ?',
                  [cantidad, id_producto],
                  alTerminar
                );
              });
            }
          );
        }
      );
    });
  });
});

// Los números de orden se validan aquí, a diferencia de `GET /api/productos/:id`
// (server.js:100), que deja pasar cualquier cosa y acaba en 404 por la vía del
// SQL. La diferencia es a propósito: este número lo teclea una persona con prisa,
// y "abc" tiene que decir "eso no es un número de orden", no "esa orden no
// existe" — que le haría pensar que la orden se perdió.
function idOrdenValido(valor) {
  const texto = String(valor).trim();
  if (!/^\d+$/.test(texto)) return null;
  const id = Number(texto);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// `nombre_actual` y `activo_actual` van ALIASADOS y no como `p.nombre`: sqlite3
// devuelve cada fila como objeto plano, así que una segunda columna `nombre`
// sobreescribiría en silencio la de `orden_lineas` — que es justo el nombre
// histórico que la 002 duplica a propósito para que la orden de marzo siga
// diciendo qué salió.
const SQL_LINEAS_DE_ORDEN = `
  SELECT ol.id_producto,
         ol.nombre,
         ol.cantidad,
         p.nombre AS nombre_actual,
         p.activo AS activo_actual,
         p.id_producto IS NOT NULL AS existe
  FROM orden_lineas ol
  LEFT JOIN productos p ON p.id_producto = ol.id_producto
  WHERE ol.id_orden = ?
  ORDER BY ol.id_producto
`;

// API Ordenes: lectura de una orden ya emitida. Es lo que la pantalla de
// devolución necesita para mostrar qué salió antes de reponerlo.
app.get('/api/ordenes/:id', (req, res) => {
  const idOrden = idOrdenValido(req.params.id);
  if (idOrden === null) {
    return res.status(400).json({ error: 'El número de orden debe ser un entero positivo.' });
  }

  db.get('SELECT * FROM ordenes WHERE id_orden = ?', [idOrden], (errOrden, orden) => {
    if (errOrden) return res.status(500).json({ error: errOrden.message });
    if (!orden) return res.status(404).json({ error: `No existe la orden ${idOrden}.` });

    db.get(
      'SELECT recibida_en, recibida_por FROM devoluciones WHERE id_orden = ?',
      [idOrden],
      (errDev, devolucion) => {
        if (errDev) return res.status(500).json({ error: errDev.message });

        db.all(SQL_LINEAS_DE_ORDEN, [idOrden], (errLineas, filas) => {
          if (errLineas) return res.status(500).json({ error: errLineas.message });

          res.json({
            id_orden: orden.id_orden,
            creada_en: orden.creada_en,
            evento: orden.evento,
            responsable: orden.responsable,
            devolucion: devolucion || null,
            lineas: filas.map((f) => ({
              id_producto: f.id_producto,
              nombre: f.nombre,
              cantidad: f.cantidad,
              existe: f.existe === 1,
              // Sólo tienen sentido si el producto sigue en el catálogo. El
              // nombre actual permite casar la línea con la tabla de Inventario
              // cuando el producto se renombró después de salir.
              nombre_actual: f.existe === 1 ? f.nombre_actual : null,
              activo: f.existe === 1 && f.activo_actual === 1,
            })),
          });
        });
      }
    );
  });
});

// API Devoluciones: repone al stock todo lo que salió en una orden y deja
// constancia de cuándo volvió. Es el SEGUNDO camino que escribe existencias, y
// el espejo de POST /api/ordenes: la salida descuenta, esto suma.
//
// Las tres comprobaciones previas son LECTURAS Y VAN FUERA DE LA TRANSACCIÓN, a
// diferencia de POST /api/ordenes. La razón es que hay una sola conexión de
// módulo (server.js:11) y BEGIN/COMMIT son de conexión, no de petición: todo lo
// que otra petición ejecute entre nuestro BEGIN y nuestro ROLLBACK cae dentro de
// nuestra transacción y se revierte con ella. Y aquí el ROLLBACK sería el camino
// NORMAL — teclear mal un número de orden es lo más frecuente que va a pasar —
// en la misma pantalla en la que el CRUD escribe todo el rato. Un 404 no puede
// deshacer la edición que otro acaba de guardar.
app.post('/api/ordenes/:id/devolucion', (req, res) => {
  const idOrden = idOrdenValido(req.params.id);
  if (idOrden === null) {
    return res.status(400).json({ error: 'El número de orden debe ser un entero positivo.' });
  }

  const recibidaPor = normalizarTexto(req.body.recibida_por);
  if (recibidaPor === undefined) {
    return res.status(400).json({
      error: `Quién recibe debe ser texto de hasta ${LARGO_MAXIMO_TEXTO} caracteres.`,
    });
  }

  db.get('SELECT id_orden FROM ordenes WHERE id_orden = ?', [idOrden], (errOrden, orden) => {
    if (errOrden) return res.status(500).json({ error: errOrden.message });
    if (!orden) return res.status(404).json({ error: `No existe la orden ${idOrden}.` });

    db.get(
      'SELECT recibida_en, recibida_por FROM devoluciones WHERE id_orden = ?',
      [idOrden],
      (errYa, devolucion) => {
        if (errYa) return res.status(500).json({ error: errYa.message });
        if (devolucion) {
          return res.status(409).json({
            error: `La orden ${idOrden} ya se recibió; devolverla otra vez inflaría el inventario.`,
            devolucion,
          });
        }

        db.all(SQL_LINEAS_DE_ORDEN, [idOrden], (errLineas, filas) => {
          if (errLineas) return res.status(500).json({ error: errLineas.message });
          if (filas.length === 0) {
            return res.status(409).json({ error: `La orden ${idOrden} no tiene líneas que devolver.` });
          }

          const describir = (f) => ({
            id_producto: f.id_producto,
            nombre: f.nombre,
            cantidad: f.cantidad,
            activo: f.existe === 1 && f.activo_actual === 1,
          });
          const porProducto = (a, b) => a.id_producto - b.id_producto;

          db.serialize(() => {
            db.run('BEGIN', (errBegin) => {
              if (errBegin) return res.status(500).json({ error: errBegin.message });

              const abortar = (estado, cuerpo) =>
                db.run('ROLLBACK', () => res.status(estado).json(cuerpo));

              db.run(
                'INSERT INTO devoluciones (id_orden, recibida_en, recibida_por) VALUES (?, ?, ?)',
                [idOrden, new Date().toISOString(), recibidaPor],
                (errInsertar) => {
                  if (errInsertar) {
                    // El UNIQUE de la 003 es la red que cubre el hueco entre el
                    // SELECT de arriba y este INSERT: dos pestañas pulsando a la
                    // vez llegan las dos hasta aquí, y sólo una puede escribir.
                    if (errInsertar.code === 'SQLITE_CONSTRAINT') {
                      return abortar(409, {
                        error: `La orden ${idOrden} ya se recibió; devolverla otra vez inflaría el inventario.`,
                      });
                    }
                    return abortar(500, { error: errInsertar.message });
                  }

                  const reponibles = filas.filter((f) => f.existe === 1);
                  const devueltas = [];
                  const omitidas = filas.filter((f) => f.existe !== 1).map(describir);

                  let pendientes = reponibles.length;
                  let fallo = null;

                  const cerrar = () => {
                    if (fallo) return abortar(500, { error: fallo.message });

                    db.run('COMMIT', (errCommit) => {
                      if (errCommit) return res.status(500).json({ error: errCommit.message });
                      res.json({
                        mensaje: 'Devolución aplicada correctamente',
                        id_orden: idOrden,
                        devueltas: devueltas.sort(porProducto),
                        omitidas: omitidas.sort(porProducto),
                      });
                    });
                  };

                  // Sin ninguna línea reponible no hay UPDATE que esperar, así
                  // que el COMMIT tiene que salir aquí: si dependiera del
                  // contador, éste nacería en cero, nadie lo decrementaría y la
                  // petición se quedaría colgada sin responder nunca.
                  if (pendientes === 0) return cerrar();

                  reponibles.forEach((f) => {
                    // `function` y no arrow: el resultado se decide con
                    // `this.changes`. Un UPDATE que no encuentra su fila NO da
                    // error en SQLite, da cero cambios — así que si el producto
                    // se borró entre el SELECT de arriba y este UPDATE, decir
                    // "devuelta" desde el snapshot sería mentir con un 200.
                    db.run(
                      'UPDATE productos SET cantidad = cantidad + ? WHERE id_producto = ?',
                      [f.cantidad, f.id_producto],
                      function (errUpdate) {
                        if (errUpdate && !fallo) fallo = errUpdate;
                        else if (this.changes === 0) omitidas.push(describir(f));
                        else devueltas.push(describir(f));

                        pendientes -= 1;
                        if (pendientes === 0) cerrar();
                      }
                    );
                  });
                }
              );
            });
          });
        });
      }
    );
  });
});

// API Delete
app.delete('/api/productos/:id', (req, res) => {
  const id = req.params.id;

  const sql = `DELETE FROM productos WHERE id_producto = ?`;

  db.run(sql, [id], function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    res.json({ mensaje: 'Producto eliminado correctamente' });
  });
});
// Expuesta para que los tests puedan cerrar la conexión en el teardown.
app.locals.db = db;
module.exports = app;
