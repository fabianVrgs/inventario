const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const port = 3000;

// Base de datos SQLite
const db = new sqlite3.Database('./db/inventario.db3', (err) => {
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
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/html/inventario.html');
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

//Iniciar servidor
app.listen(port, () => {
  console.log(`Servidor Express corriendo en http://localhost:${port}`);
});

// API subproceso
app.get('/api/productoSubproceso', (req, res) => {
  const sql = `
    SELECT 
      s.nombre AS subproceso,
      p.nombre AS producto,
      d.cantidad,
      d.marca,

    FROM detalle_inventario d
    JOIN productos p ON d.id_producto = p.id_producto
    JOIN subprocesos s ON d.id_subproceso = s.id_subproceso
    ORDER BY s.nombre;
  `;

  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// API Read
app.get('/api/productos', (req, res) => {
  db.all('SELECT * FROM productos', [], (err, rows) => {
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

// API Create
app.post('/api/productos', (req, res) => {
  const { nombre, descripcion } = req.body;

  if (!nombre) {
    return res.status(400).json({ error: 'El nombre del producto es obligatorio.' });
  }

  const sql = `INSERT INTO productos (nombre, descripcion) VALUES (?, ?)`;

  db.run(sql, [nombre, descripcion], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    res.status(201).json({
      mensaje: 'Producto creado exitosamente',
      id: this.lastID,
      nombre,
      descripcion
    });
  });
});

// API Update
app.put('/api/productos/:id', (req, res) => {
  const id = req.params.id;
  const { nombre, descripcion } = req.body;

  if (!nombre) {
    return res.status(400).json({ error: 'El nombre del producto es obligatorio.' });
  }

  const sql = `UPDATE productos SET nombre = ?, descripcion = ? WHERE id_producto = ?`;

  db.run(sql, [nombre, descripcion, id], function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    res.json({ mensaje: 'Producto reemplazado correctamente' });
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