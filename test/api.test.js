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

// ------------------------------------------------- registro de las órdenes

const consultar = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.all(sql, params, (err, filas) => (err ? reject(err) : resolve(filas)))
  );

test('POST /api/ordenes deja registrada la orden con sus líneas', async () => {
  const res = await enviar('POST', '/api/ordenes', {
    lineas: [
      { id_producto: 1, cantidad: 3 },
      { id_producto: 2, cantidad: 10 },
    ],
    evento: 'Feria de agosto',
    responsable: 'Bodega',
  });
  assert.equal(res.status, 200);

  const { id_orden } = await res.json();
  assert.ok(Number.isInteger(id_orden), 'la respuesta debe traer el id de la orden');

  const [orden] = await consultar('SELECT * FROM ordenes WHERE id_orden = ?', [id_orden]);
  assert.equal(orden.evento, 'Feria de agosto');
  assert.equal(orden.responsable, 'Bodega');
  assert.ok(!Number.isNaN(Date.parse(orden.creada_en)), 'creada_en debe ser una fecha ISO');

  const lineas = await consultar(
    'SELECT * FROM orden_lineas WHERE id_orden = ? ORDER BY id_producto',
    [id_orden]
  );
  assert.equal(lineas.length, 2);
  assert.deepEqual(
    lineas.map((l) => [l.id_producto, l.nombre, l.cantidad]),
    [[1, 'vim2', 3], [2, 'BT3', 10]]
  );
});

test('POST /api/ordenes guarda el nombre que tenía el producto al salir', async () => {
  const res = await enviar('POST', '/api/ordenes', {
    lineas: [{ id_producto: 3, cantidad: 2 }],
  });
  assert.equal(res.status, 200);
  const { id_orden } = await res.json();

  // El catálogo cambia después: el registro histórico no debe moverse con él.
  await enviar('PUT', '/api/productos/3', { nombre: 'Otro nombre', cantidad: 38, id_area: 2 });

  const [linea] = await consultar('SELECT * FROM orden_lineas WHERE id_orden = ?', [id_orden]);
  assert.equal(linea.nombre, 'Cable XLR', 'el nombre del registro es el del momento de la salida');
});

test('POST /api/ordenes registra las líneas repetidas ya sumadas', async () => {
  const res = await enviar('POST', '/api/ordenes', {
    lineas: [
      { id_producto: 1, cantidad: 1 },
      { id_producto: 1, cantidad: 2 },
    ],
  });
  assert.equal(res.status, 200);
  const { id_orden } = await res.json();

  const lineas = await consultar('SELECT * FROM orden_lineas WHERE id_orden = ?', [id_orden]);
  assert.equal(lineas.length, 1, 'una fila por producto, no una por línea enviada');
  assert.equal(lineas[0].cantidad, 3);
});

test('POST /api/ordenes acepta evento y responsable en blanco', async () => {
  const res = await enviar('POST', '/api/ordenes', {
    lineas: [{ id_producto: 1, cantidad: 1 }],
    evento: '   ',
    responsable: '',
  });
  assert.equal(res.status, 200);
  const { id_orden } = await res.json();

  const [orden] = await consultar('SELECT * FROM ordenes WHERE id_orden = ?', [id_orden]);
  assert.equal(orden.evento, null, 'en blanco se guarda como NULL, no como cadena vacía');
  assert.equal(orden.responsable, null);
});

test('POST /api/ordenes no registra nada cuando responde 409', async () => {
  const res = await enviar('POST', '/api/ordenes', {
    lineas: [
      { id_producto: 2, cantidad: 10 }, // cabe
      { id_producto: 1, cantidad: 99 }, // no cabe
    ],
    evento: 'La que no salió',
  });
  assert.equal(res.status, 409);

  // El registro va en la MISMA transacción que el descuento: si no sale
  // material, no puede quedar constancia de que salió.
  assert.deepEqual(await consultar('SELECT * FROM ordenes'), []);
  assert.deepEqual(await consultar('SELECT * FROM orden_lineas'), []);
});

test('POST /api/ordenes no registra nada cuando responde 400', async () => {
  const res = await enviar('POST', '/api/ordenes', {
    lineas: [{ id_producto: 1, cantidad: -2 }],
  });
  assert.equal(res.status, 400);
  assert.deepEqual(await consultar('SELECT * FROM ordenes'), []);
});

test('POST /api/ordenes rechaza evento o responsable que no sean texto', async () => {
  const res = await enviar('POST', '/api/ordenes', {
    lineas: [{ id_producto: 1, cantidad: 1 }],
    evento: { nombre: 'inyección' },
  });
  assert.equal(res.status, 400);
  assert.equal(await cantidadDe(1), 4);
});

// ------------------------------------------------------------- devoluciones

// Devolver es la segunda mitad de un ciclo que empieza descontando, así que
// casi todo lo de aquí necesita una orden ya emitida.
const emitir = async (lineas, extra = {}) => {
  const res = await enviar('POST', '/api/ordenes', { lineas, ...extra });
  assert.equal(res.status, 200, 'la orden de partida debe emitirse bien');
  return (await res.json()).id_orden;
};

const devolver = (idOrden, cuerpo = {}) =>
  enviar('POST', `/api/ordenes/${idOrden}/devolucion`, cuerpo);

test('GET /api/ordenes/:id devuelve la orden con sus líneas', async () => {
  const idOrden = await emitir(
    [
      { id_producto: 1, cantidad: 3 },
      { id_producto: 2, cantidad: 10 },
    ],
    { evento: 'Feria de agosto', responsable: 'Bodega' }
  );

  const res = await get(`/api/ordenes/${idOrden}`);
  assert.equal(res.status, 200);

  const orden = await res.json();
  assert.equal(orden.id_orden, idOrden);
  assert.equal(orden.evento, 'Feria de agosto');
  assert.equal(orden.responsable, 'Bodega');
  assert.ok(!Number.isNaN(Date.parse(orden.creada_en)), 'creada_en debe ser una fecha ISO');
  assert.equal(orden.devolucion, null, 'una orden recién emitida no está devuelta');
  assert.deepEqual(
    orden.lineas.map((l) => [l.id_producto, l.nombre, l.cantidad, l.existe]),
    [
      [1, 'vim2', 3, true],
      [2, 'BT3', 10, true],
    ]
  );
});

test('GET /api/ordenes/:id responde 404 si la orden no existe', async () => {
  const res = await get('/api/ordenes/999');
  assert.equal(res.status, 404);
});

test('GET /api/ordenes/:id responde 400 si el número no es un entero positivo', async () => {
  assert.equal((await get('/api/ordenes/abc')).status, 400);
  assert.equal((await get('/api/ordenes/0')).status, 400);
  assert.equal((await get('/api/ordenes/-3')).status, 400);
});

test('GET /api/ordenes/:id marca la línea cuyo producto ya no existe', async () => {
  const idOrden = await emitir([{ id_producto: 3, cantidad: 2 }]);
  assert.equal((await enviar('DELETE', '/api/productos/3')).status, 200);

  const { lineas } = await (await get(`/api/ordenes/${idOrden}`)).json();
  assert.equal(lineas.length, 1, 'la línea del registro sobrevive al borrado del producto');
  assert.equal(lineas[0].nombre, 'Cable XLR', 'y sigue diciendo qué salió');
  assert.equal(lineas[0].existe, false);
});

test('GET /api/ordenes/:id informa la devolución ya registrada', async () => {
  const idOrden = await emitir([{ id_producto: 1, cantidad: 2 }]);
  assert.equal((await devolver(idOrden, { recibida_por: 'Erick' })).status, 200);

  const { devolucion } = await (await get(`/api/ordenes/${idOrden}`)).json();
  assert.equal(devolucion.recibida_por, 'Erick');
  assert.ok(!Number.isNaN(Date.parse(devolucion.recibida_en)), 'recibida_en debe ser ISO');
});

test('POST /api/ordenes/:id/devolucion repone el stock que salió', async () => {
  const idOrden = await emitir([
    { id_producto: 1, cantidad: 3 },
    { id_producto: 2, cantidad: 10 },
  ]);
  assert.equal(await cantidadDe(1), 1);
  assert.equal(await cantidadDe(2), 20);

  const res = await devolver(idOrden);
  assert.equal(res.status, 200);

  const cuerpo = await res.json();
  assert.equal(cuerpo.id_orden, idOrden);
  assert.deepEqual(
    cuerpo.devueltas.map((l) => [l.id_producto, l.cantidad]),
    [
      [1, 3],
      [2, 10],
    ]
  );
  assert.deepEqual(cuerpo.omitidas, []);

  assert.equal(await cantidadDe(1), 4, 'vuelve al stock que había antes de la salida');
  assert.equal(await cantidadDe(2), 30);
});

test('POST /api/ordenes/:id/devolucion deja constancia de cuándo llegó y quién recibió', async () => {
  const idOrden = await emitir([{ id_producto: 1, cantidad: 1 }]);
  assert.equal((await devolver(idOrden, { recibida_por: 'Erick' })).status, 200);

  const filas = await consultar('SELECT * FROM devoluciones WHERE id_orden = ?', [idOrden]);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].recibida_por, 'Erick');
  assert.ok(!Number.isNaN(Date.parse(filas[0].recibida_en)), 'recibida_en debe ser una fecha ISO');
});

test('POST /api/ordenes/:id/devolucion acepta quién recibe en blanco', async () => {
  const idOrden = await emitir([{ id_producto: 1, cantidad: 1 }]);
  assert.equal((await devolver(idOrden, { recibida_por: '   ' })).status, 200);

  const [fila] = await consultar('SELECT * FROM devoluciones WHERE id_orden = ?', [idOrden]);
  assert.equal(fila.recibida_por, null, 'en blanco se guarda como NULL, no como cadena vacía');
});

test('POST /api/ordenes/:id/devolucion rechaza quién recibe si no es texto', async () => {
  const idOrden = await emitir([{ id_producto: 1, cantidad: 3 }]);

  const res = await devolver(idOrden, { recibida_por: { nombre: 'inyección' } });
  assert.equal(res.status, 400);
  assert.equal(await cantidadDe(1), 1, 'un 400 no puede reponer nada');
  assert.deepEqual(await consultar('SELECT * FROM devoluciones'), []);
});

test('POST /api/ordenes/:id/devolucion responde 409 si la orden ya se devolvió', async () => {
  const idOrden = await emitir([{ id_producto: 1, cantidad: 3 }]);
  assert.equal((await devolver(idOrden)).status, 200);
  assert.equal(await cantidadDe(1), 4);

  const res = await devolver(idOrden);
  assert.equal(res.status, 409);

  const cuerpo = await res.json();
  assert.ok(cuerpo.devolucion, 'el 409 dice cuándo se recibió, para que se vea que ya está');

  // Lo que de verdad importa: devolver dos veces no infla el inventario con
  // material que no existe.
  assert.equal(await cantidadDe(1), 4, 'la segunda devolución no vuelve a sumar');
  assert.equal(
    (await consultar('SELECT * FROM devoluciones WHERE id_orden = ?', [idOrden])).length,
    1,
    'y no deja una segunda constancia'
  );
});

test('POST /api/ordenes/:id/devolucion responde 404 si la orden no existe', async () => {
  const res = await devolver(999);
  assert.equal(res.status, 404);
  assert.equal(await cantidadDe(1), 4, 'no toca el stock');
  assert.deepEqual(await consultar('SELECT * FROM devoluciones'), []);
});

test('POST /api/ordenes/:id/devolucion repone igual a un producto desactivado', async () => {
  // El producto 4 está sembrado con activo = 0 y 15 unidades. `activo` sólo
  // dice si se puede pedir hoy; el stock es físico y vuelve igual.
  const idOrden = await emitir([{ id_producto: 4, cantidad: 5 }]);
  assert.equal(await cantidadDe(4), 10);

  assert.equal((await devolver(idOrden)).status, 200);
  assert.equal(await cantidadDe(4), 15);
});

test('POST /api/ordenes/:id/devolucion omite la línea sin producto y repone las demás', async () => {
  const idOrden = await emitir([
    { id_producto: 1, cantidad: 3 },
    { id_producto: 3, cantidad: 2 },
  ]);
  assert.equal((await enviar('DELETE', '/api/productos/3')).status, 200);

  const res = await devolver(idOrden);
  assert.equal(res.status, 200);

  const cuerpo = await res.json();
  assert.deepEqual(
    cuerpo.devueltas.map((l) => l.id_producto),
    [1]
  );
  assert.deepEqual(
    cuerpo.omitidas.map((l) => [l.id_producto, l.nombre, l.cantidad]),
    [[3, 'Cable XLR', 2]],
    'lo que no se pudo reponer se informa, no se calla'
  );

  assert.equal(await cantidadDe(1), 4, 'lo que sí existe vuelve al stock');
  assert.equal(
    (await consultar('SELECT * FROM devoluciones WHERE id_orden = ?', [idOrden])).length,
    1,
    'la orden queda devuelta: si no, se quedaría pendiente para siempre'
  );
});

// El timeout no es decorativo: si el COMMIT dependiera de que termine alguna
// escritura, en este caso no habría ninguna, la petición no respondería nunca y
// `npm test` se quedaría colgado para siempre en vez de fallar.
test('POST /api/ordenes/:id/devolucion cierra la orden aunque no quede ningún producto', { timeout: 5000 }, async () => {
  const idOrden = await emitir([{ id_producto: 3, cantidad: 2 }]);
  assert.equal((await enviar('DELETE', '/api/productos/3')).status, 200);

  const res = await devolver(idOrden);
  assert.equal(res.status, 200);

  const cuerpo = await res.json();
  assert.deepEqual(cuerpo.devueltas, []);
  assert.equal(cuerpo.omitidas.length, 1);
  assert.equal(
    (await consultar('SELECT * FROM devoluciones WHERE id_orden = ?', [idOrden])).length,
    1
  );
});

test('POST /api/ordenes/:id/devolucion responde 400 si el número no es un entero positivo', async () => {
  assert.equal((await devolver('abc')).status, 400);
  assert.equal((await devolver(0)).status, 400);
  assert.deepEqual(await consultar('SELECT * FROM devoluciones'), []);
});

test('POST /api/ordenes/:id/devolucion rechaza quién recibe si pasa de 200 caracteres', async () => {
  const idOrden = await emitir([{ id_producto: 1, cantidad: 1 }]);

  const res = await devolver(idOrden, { recibida_por: 'a'.repeat(201) });
  assert.equal(res.status, 400);
  assert.deepEqual(await consultar('SELECT * FROM devoluciones'), []);
});

test('POST /api/ordenes/:id/devolucion recorta los espacios de quién recibe', async () => {
  const idOrden = await emitir([{ id_producto: 1, cantidad: 1 }]);
  assert.equal((await devolver(idOrden, { recibida_por: '  Ana  ' })).status, 200);

  const [fila] = await consultar('SELECT * FROM devoluciones WHERE id_orden = ?', [idOrden]);
  assert.equal(fila.recibida_por, 'Ana');
});

test('POST /api/ordenes/:id/devolucion suma al stock actual, no restaura el de antes de la orden', async () => {
  const idOrden = await emitir([{ id_producto: 1, cantidad: 3 }]);
  assert.equal(await cantidadDe(1), 1);

  // El almacenista corrige el conteo a mano mientras el material está fuera.
  await enviar('PUT', '/api/productos/1', { nombre: 'vim2', cantidad: 10, id_area: 1 });

  assert.equal((await devolver(idOrden)).status, 200);
  assert.equal(await cantidadDe(1), 13, 'las 3 que vuelven se suman a las 10 que hay');
});

test('POST /api/ordenes/:id/devolucion sólo bloquea la orden ya devuelta, no las demás', async () => {
  const primera = await emitir([{ id_producto: 1, cantidad: 1 }]);
  const segunda = await emitir([{ id_producto: 2, cantidad: 1 }]);

  assert.equal((await devolver(primera)).status, 200);
  assert.equal((await devolver(segunda)).status, 200, 'el UNIQUE es por orden, no global');
});

test('POST /api/ordenes/:id/devolucion acumula cuando dos órdenes comparten producto', async () => {
  const primera = await emitir([{ id_producto: 1, cantidad: 2 }]);
  const segunda = await emitir([{ id_producto: 1, cantidad: 1 }]);
  assert.equal(await cantidadDe(1), 1);

  assert.equal((await devolver(primera)).status, 200);
  assert.equal((await devolver(segunda)).status, 200);
  assert.equal(await cantidadDe(1), 4);
});

test('POST /api/ordenes/:id/devolucion no altera el registro histórico de la salida', async () => {
  const idOrden = await emitir([{ id_producto: 1, cantidad: 3 }], { evento: 'Feria' });
  const antes = await consultar('SELECT * FROM orden_lineas WHERE id_orden = ?', [idOrden]);

  assert.equal((await devolver(idOrden)).status, 200);

  const [orden] = await consultar('SELECT * FROM ordenes WHERE id_orden = ?', [idOrden]);
  assert.equal(orden.evento, 'Feria', 'la orden sigue diciendo qué salió y para qué');
  assert.deepEqual(
    await consultar('SELECT * FROM orden_lineas WHERE id_orden = ?', [idOrden]),
    antes,
    'devolver no reescribe las líneas: son un registro, no un saldo'
  );
});

test('GET /api/ordenes/:id no atribuye a una orden la devolución de otra', async () => {
  const primera = await emitir([{ id_producto: 1, cantidad: 1 }]);
  const segunda = await emitir([{ id_producto: 2, cantidad: 1 }]);
  assert.equal((await devolver(primera)).status, 200);

  const orden = await (await get(`/api/ordenes/${segunda}`)).json();
  assert.equal(orden.devolucion, null);
});

test('GET /api/ordenes/:id distingue el nombre de la salida del nombre actual', async () => {
  const idOrden = await emitir([{ id_producto: 3, cantidad: 2 }]);
  await enviar('PUT', '/api/productos/3', { nombre: 'Cable XLR 10m', cantidad: 38, id_area: 2 });

  const { lineas } = await (await get(`/api/ordenes/${idOrden}`)).json();
  assert.equal(lineas[0].nombre, 'Cable XLR', 'el histórico no se mueve');
  assert.equal(lineas[0].nombre_actual, 'Cable XLR 10m', 'y se puede casar con el catálogo de hoy');
});

test('GET /api/ordenes/:id avisa de que el producto está desactivado', async () => {
  // El 4 está sembrado con activo = 0: su material vuelve al stock, pero no se
  // podrá pedir desde la Principal hasta reactivarlo.
  const idOrden = await emitir([{ id_producto: 4, cantidad: 5 }]);

  const { lineas } = await (await get(`/api/ordenes/${idOrden}`)).json();
  assert.equal(lineas[0].existe, true);
  assert.equal(lineas[0].activo, false);
});
