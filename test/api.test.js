const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { once } = require('node:events');
const { crearBaseTemporal, sembrar } = require('./helpers/db');

let servidor;
let base;
let dirTemporal;
let db;

before(async () => {
  const { dir, archivo } = await crearBaseTemporal();
  dirTemporal = dir;

  // Debe fijarse antes de importar server.js: la conexión se abre al cargar.
  process.env.DB_PATH = archivo;

  const app = require('../server.js');
  db = app.locals.db;

  servidor = app.listen(0); // puerto efímero: no choca con el 3000 en uso
  await once(servidor, 'listening');
  base = `http://127.0.0.1:${servidor.address().port}`;
});

// Cada test arranca con los mismos datos, sin importar qué mutó el anterior.
beforeEach(() => sembrar(db));

after(async () => {
  if (servidor) {
    servidor.close();
    await once(servidor, 'close');
  }
  if (db) await new Promise((r) => db.close(r));
  if (dirTemporal) fs.rmSync(dirTemporal, { recursive: true, force: true });
});

const get = (ruta) => fetch(`${base}${ruta}`);
const enviar = (metodo, ruta, cuerpo) =>
  fetch(`${base}${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });

const cantidadDe = async (id) => (await (await get(`/api/productos/${id}`)).json()).cantidad;

// ---------------------------------------------------------------- catálogo

test('GET /api/productos devuelve todo el catálogo con el nombre del área', async () => {
  const res = await get('/api/productos');
  assert.equal(res.status, 200);

  const productos = await res.json();
  assert.equal(productos.length, 4);

  const vim2 = productos.find((p) => p.nombre === 'vim2');
  assert.equal(vim2.area, 'luces');
  assert.equal(vim2.cantidad, 4);
  assert.equal(vim2.activo, 1);
});

test('GET /api/productos?activo=1 omite los desactivados', async () => {
  const res = await get('/api/productos?activo=1');
  assert.equal(res.status, 200);

  const productos = await res.json();
  assert.equal(productos.length, 3);
  assert.ok(
    !productos.some((p) => p.nombre === 'Array'),
    'Array está desactivado y no debe aparecer'
  );
});

test('GET /api/productos/:id devuelve un producto', async () => {
  const producto = await (await get('/api/productos/2')).json();
  assert.equal(producto.nombre, 'BT3');
  assert.equal(producto.cantidad, 30);
});

test('GET /api/productos/:id responde 404 si no existe', async () => {
  const res = await get('/api/productos/999');
  assert.equal(res.status, 404);
});

test('GET /api/areas devuelve las áreas para el selector', async () => {
  const res = await get('/api/areas');
  assert.equal(res.status, 200);

  const areas = await res.json();
  assert.deepEqual(
    areas.map((a) => a.nombre).sort(),
    ['Sonido', 'luces']
  );
});

// ------------------------------------------------------------------- CRUD

test('POST /api/productos crea con cantidad, área y activo', async () => {
  const res = await enviar('POST', '/api/productos', {
    nombre: 'Bases de Micrófonos',
    marca: 'K&M',
    descripcion: 'Base recta',
    cantidad: 20,
    id_area: 2,
  });
  assert.equal(res.status, 201);

  const { id } = await res.json();
  const creado = await (await get(`/api/productos/${id}`)).json();
  assert.equal(creado.cantidad, 20);
  assert.equal(creado.id_area, 2);
  assert.equal(creado.activo, 1, 'un producto nuevo nace activo');
});

test('POST /api/productos rechaza sin nombre', async () => {
  const res = await enviar('POST', '/api/productos', { cantidad: 5, id_area: 1 });
  assert.equal(res.status, 400);
});

test('POST /api/productos rechaza cantidad negativa', async () => {
  const res = await enviar('POST', '/api/productos', {
    nombre: 'Imposible',
    cantidad: -3,
    id_area: 1,
  });
  assert.equal(res.status, 400);
});

test('PUT /api/productos/:id actualiza cantidad y área', async () => {
  const res = await enviar('PUT', '/api/productos/3', {
    nombre: 'Cable XLR 10m',
    marca: 'Proel',
    descripcion: 'Cable XLR de 10 metros',
    cantidad: 55,
    id_area: 1,
  });
  assert.equal(res.status, 200);

  const actualizado = await (await get('/api/productos/3')).json();
  assert.equal(actualizado.nombre, 'Cable XLR 10m');
  assert.equal(actualizado.cantidad, 55);
  assert.equal(actualizado.id_area, 1);
});

test('PUT /api/productos/:id responde 404 si no existe', async () => {
  const res = await enviar('PUT', '/api/productos/999', { nombre: 'Fantasma', cantidad: 1 });
  assert.equal(res.status, 404);
});

test('PATCH /api/productos/:id/activo desactiva y lo saca de los disponibles', async () => {
  const res = await enviar('PATCH', '/api/productos/2/activo', { activo: 0 });
  assert.equal(res.status, 200);

  const disponibles = await (await get('/api/productos?activo=1')).json();
  assert.ok(!disponibles.some((p) => p.nombre === 'BT3'));
});

test('PATCH /api/productos/:id/activo vuelve a activar', async () => {
  const res = await enviar('PATCH', '/api/productos/4/activo', { activo: 1 });
  assert.equal(res.status, 200);

  const disponibles = await (await get('/api/productos?activo=1')).json();
  assert.ok(disponibles.some((p) => p.nombre === 'Array'));
});

test('DELETE /api/productos/:id elimina el producto', async () => {
  const res = await enviar('DELETE', '/api/productos/1');
  assert.equal(res.status, 200);
  assert.equal((await get('/api/productos/1')).status, 404);
});

// ----------------------------------------------------------------- órdenes

test('POST /api/ordenes descuenta las cantidades pedidas', async () => {
  const res = await enviar('POST', '/api/ordenes', {
    lineas: [
      { id_producto: 1, cantidad: 3 },
      { id_producto: 2, cantidad: 10 },
    ],
  });
  assert.equal(res.status, 200);

  assert.equal(await cantidadDe(1), 1);
  assert.equal(await cantidadDe(2), 20);
});

test('POST /api/ordenes permite agotar exactamente el stock', async () => {
  const res = await enviar('POST', '/api/ordenes', {
    lineas: [{ id_producto: 1, cantidad: 4 }],
  });
  assert.equal(res.status, 200);
  assert.equal(await cantidadDe(1), 0);
});

test('POST /api/ordenes responde 409 si no alcanza el stock', async () => {
  const res = await enviar('POST', '/api/ordenes', {
    lineas: [{ id_producto: 1, cantidad: 5 }],
  });
  assert.equal(res.status, 409);

  const cuerpo = await res.json();
  assert.equal(cuerpo.faltantes[0].id_producto, 1);
  assert.equal(cuerpo.faltantes[0].disponible, 4);
});

test('POST /api/ordenes no descuenta nada si una sola línea falla', async () => {
  const res = await enviar('POST', '/api/ordenes', {
    lineas: [
      { id_producto: 2, cantidad: 10 }, // cabe
      { id_producto: 1, cantidad: 99 }, // no cabe
    ],
  });
  assert.equal(res.status, 409);

  // La línea que sí cabía tampoco debe haberse aplicado.
  assert.equal(await cantidadDe(2), 30, 'la orden es todo o nada');
  assert.equal(await cantidadDe(1), 4);
});

test('POST /api/ordenes rechaza un producto inexistente', async () => {
  const res = await enviar('POST', '/api/ordenes', {
    lineas: [{ id_producto: 999, cantidad: 1 }],
  });
  assert.equal(res.status, 409);
});

test('POST /api/ordenes suma las líneas repetidas del mismo producto', async () => {
  // Dos líneas de 3 con sólo 4 en stock: por separado cada una cabe,
  // pero juntas no. Debe rechazarse, no dejar el stock en negativo.
  const res = await enviar('POST', '/api/ordenes', {
    lineas: [
      { id_producto: 1, cantidad: 3 },
      { id_producto: 1, cantidad: 3 },
    ],
  });
  assert.equal(res.status, 409);
  assert.equal(await cantidadDe(1), 4, 'el stock no debe quedar negativo');
});

test('POST /api/ordenes acepta líneas repetidas si juntas caben', async () => {
  const res = await enviar('POST', '/api/ordenes', {
    lineas: [
      { id_producto: 1, cantidad: 1 },
      { id_producto: 1, cantidad: 2 },
    ],
  });
  assert.equal(res.status, 200);
  assert.equal(await cantidadDe(1), 1);
});

test('POST /api/ordenes rechaza una orden vacía', async () => {
  const res = await enviar('POST', '/api/ordenes', { lineas: [] });
  assert.equal(res.status, 400);
});

test('POST /api/ordenes rechaza cantidad cero o negativa', async () => {
  const res = await enviar('POST', '/api/ordenes', {
    lineas: [{ id_producto: 1, cantidad: 0 }],
  });
  assert.equal(res.status, 400);
  assert.equal(await cantidadDe(1), 4);
});
