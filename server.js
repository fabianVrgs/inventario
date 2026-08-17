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
