// El .db3 versionado en el repo tiene la migración 001 aplicada pero no la 002,
// así que no trae `ordenes` ni `orden_lineas`. Estos tests arrancan la app
// contra una base así — la que se clona — y comprueban que funciona sin haber
// corrido el runner de migraciones a mano.
//
// Van en un archivo aparte de api.test.js a propósito: el runner de node
// ejecuta cada archivo en su propio proceso, y `server.js` abre la conexión al
// cargarse, así que dos bases distintas necesitan dos procesos.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { once } = require('node:events');
const { crearBaseSinOrdenes } = require('./helpers/db');

let servidor;
let base;
let dirTemporal;
let db;

before(async () => {
  const { dir, archivo } = await crearBaseSinOrdenes();
  dirTemporal = dir;

  // Debe fijarse antes de importar server.js: la conexión se abre al cargar.
  process.env.DB_PATH = archivo;

  const app = require('../server.js');
  db = app.locals.db;

  servidor = app.listen(0);
  await once(servidor, 'listening');
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  if (servidor) {
    servidor.close();
    await once(servidor, 'close');
  }
  if (db) await new Promise((r) => db.close(r));
  if (dirTemporal) fs.rmSync(dirTemporal, { recursive: true, force: true });
});

test('POST /api/ordenes funciona contra una base sin la 002 aplicada', async () => {
  const respuesta = await fetch(`${base}/api/ordenes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      evento: 'Feria de agosto',
      responsable: 'bodega',
      lineas: [{ id_producto: 1, cantidad: 2 }],
    }),
  });

  assert.equal(respuesta.status, 200);

  // Y el descuento se aplicó de verdad: vim2 arranca sembrado en 4.
  const fila = await new Promise((res, rej) =>
    db.get('SELECT cantidad FROM productos WHERE id_producto = 1', [], (e, r) =>
      e ? rej(e) : res(r)
    )
  );
  assert.equal(fila.cantidad, 2);
});

test('devolver funciona contra una base sin la 003 aplicada', async () => {
  const emitida = await fetch(`${base}/api/ordenes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lineas: [{ id_producto: 2, cantidad: 4 }] }),
  });
  assert.equal(emitida.status, 200);
  const { id_orden } = await emitida.json();

  const devuelta = await fetch(`${base}/api/ordenes/${id_orden}/devolucion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recibida_por: 'bodega' }),
  });
  assert.equal(devuelta.status, 200, 'el bloque DDL del arranque debe haber creado `devoluciones`');

  // BT3 arranca sembrado en 30: salieron 4 y volvieron las 4.
  const fila = await new Promise((res, rej) =>
    db.get('SELECT cantidad FROM productos WHERE id_producto = 2', [], (e, r) =>
      e ? rej(e) : res(r)
    )
  );
  assert.equal(fila.cantidad, 30);
});
