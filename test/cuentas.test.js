// Tests del centro de gestión: altas, contraseñas, roles y permisos.
//
// Van aparte de auth.test.js porque aquél comprueba cómo se entra y se sale, y
// aquí lo que se prueba es lo que puede hacer quien ya entró — y sobre todo lo
// que NO puede, que es donde vive el riesgo.
//
// El test que más vale de este archivo es "un rol creado desde la API borra
// productos de verdad": es la diferencia entre roles que son permisos y roles
// que son etiquetas de adorno.

const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');

// El require de ./helpers/db YA fijó process.env.ESQUEMA_BD en su nivel
// superior, y por eso va arriba del todo: server.js carga db.js, y db.js lee
// esa variable UNA sola vez, al cargarse el módulo.
const { crearEsquema, borrarEsquema, sembrar, consultar } = require('./helpers/db');
const { CLAVES, USUARIOS, sembrarCuentas, iniciarSesion } = require('./helpers/sesion');

let servidor;
let base;
let app;
let cookie;

const CLAVE_NUEVA = 'ClaveDePruebaNueva1';
const OTRA_CLAVE = 'OtraClaveDePrueba22';

before(async () => {
  await crearEsquema();

  app = require('../server.js');

  servidor = app.listen(0);
  await once(servidor, 'listening');
  base = `http://127.0.0.1:${servidor.address().port}`;
});

// Los roles se limpian AQUÍ y no en helpers/sesion.js a propósito: éste es el
// único archivo que los crea, y meter en el helper compartido un borrado de
// roles obligaría a re-sembrar allí las dos filas que db/esquema.sql ya escribe
// — la misma verdad en dos sitios, y la copia del helper envejeciendo sola.
//
// `admin` y `superadmin` se dejan y se devuelven a sus permisos de fábrica: son
// parte del esquema, no datos de un test. `admin` los pierde de vista con
// facilidad porque es editable.
async function restaurarRoles() {
  await consultar("DELETE FROM roles WHERE nombre NOT IN ('admin', 'superadmin')");
  await consultar("UPDATE roles SET permisos = '{}' WHERE nombre = 'admin'");
  await consultar(
    `UPDATE roles SET permisos = '{productos.eliminar,cuentas.gestionar,accesos.ver}'
     WHERE nombre = 'superadmin'`
  );
}

beforeEach(async () => {
  await sembrar();
  await sembrarCuentas();
  await restaurarRoles();
  // Varios tests de aquí provocan logins fallidos a propósito (la contraseña
  // vieja después de restablecerla). Sin esto, los siguientes se encontrarían
  // bloqueados por IP: todos salen de 127.0.0.1.
  await app.locals.reiniciarLimites();

  cookie = await iniciarSesion(base);
});

after(async () => {
  if (servidor) {
    servidor.close();
    await once(servidor, 'close');
  }
  await borrarEsquema();
  await app.locals.pool.end();
});

const con = (galleta, ruta, opciones = {}) =>
  fetch(`${base}${ruta}`, {
    ...opciones,
    headers: { 'Content-Type': 'application/json', Cookie: galleta, ...(opciones.headers || {}) },
  });

const entrar = (usuario, clave) =>
  fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario, clave }),
  });

const cookieDeLogin = async (usuario, clave) => {
  const respuesta = await entrar(usuario, clave);
  assert.equal(respuesta.status, 200, `no se pudo entrar como ${usuario}`);
  return respuesta.headers.get('set-cookie').split(';')[0];
};

const crearCuenta = (cuerpo, galleta = cookie) =>
  con(galleta, '/api/cuentas', { method: 'POST', body: JSON.stringify(cuerpo) });

const crearRol = (cuerpo, galleta = cookie) =>
  con(galleta, '/api/roles', { method: 'POST', body: JSON.stringify(cuerpo) });

const idDe = async (usuario) =>
  (await consultar('SELECT id_cuenta FROM cuentas WHERE usuario = $1', [usuario])).rows[0]
    .id_cuenta;

// ---------------------------------------------------------------------------
// Alta de cuentas
// ---------------------------------------------------------------------------

test('el alta crea una cuenta que puede entrar de verdad', async () => {
  const respuesta = await crearCuenta({
    usuario: 'bodeguero',
    clave: CLAVE_NUEVA,
    rol: 'admin',
  });
  assert.equal(respuesta.status, 201);

  const cuerpo = await respuesta.json();
  assert.equal(cuerpo.usuario, 'bodeguero');
  assert.equal(cuerpo.rol, 'admin');
  assert.equal(cuerpo.activa, true);
  // Lo mismo que se exige a GET /api/cuentas: el hash no sale ni aquí.
  assert.equal(cuerpo.hash, undefined);

  const entrada = await entrar('bodeguero', CLAVE_NUEVA);
  assert.equal(entrada.status, 200);
});

test('el alta aplica las mismas reglas que scripts/cuenta.js', async () => {
  const corta = await crearCuenta({ usuario: 'bodeguero', clave: 'corta', rol: 'admin' });
  assert.equal(corta.status, 400);
  assert.match((await corta.json()).error, /12 caracteres/);

  const prohibida = await crearCuenta({
    usuario: 'bodeguero',
    clave: 'almacen12345',
    rol: 'admin',
  });
  assert.equal(prohibida.status, 400);
  assert.match((await prohibida.json()).error, /se prueban primero/);

  const feo = await crearCuenta({ usuario: 'con espacio', clave: CLAVE_NUEVA, rol: 'admin' });
  assert.equal(feo.status, 400);

  // Ninguna de las tres llegó a escribir nada.
  const { rows } = await consultar('SELECT count(*)::int AS total FROM cuentas');
  assert.equal(rows[0].total, 2);
});

test('el usuario repetido se rechaza aunque cambie de mayúsculas', async () => {
  assert.equal((await crearCuenta({ usuario: 'Erick', clave: CLAVE_NUEVA, rol: 'admin' })).status, 201);

  const otra = await crearCuenta({ usuario: 'erick', clave: OTRA_CLAVE, rol: 'admin' });
  assert.equal(otra.status, 409);
  assert.match((await otra.json()).error, /Ya existe/);
});

test('no se puede crear una cuenta con un rol que no existe', async () => {
  const respuesta = await crearCuenta({ usuario: 'fantasma', clave: CLAVE_NUEVA, rol: 'inventado' });
  assert.equal(respuesta.status, 400);
  assert.match((await respuesta.json()).error, /rol no existe/);
});

// ---------------------------------------------------------------------------
// Contraseñas
// ---------------------------------------------------------------------------

test('restablecer la contraseña deja fuera la vieja y cierra las sesiones', async () => {
  await crearCuenta({ usuario: 'bodeguero', clave: CLAVE_NUEVA, rol: 'admin' });
  const suya = await cookieDeLogin('bodeguero', CLAVE_NUEVA);
  const id = await idDe('bodeguero');

  // Su sesión funciona antes del cambio.
  assert.equal((await con(suya, '/api/productos')).status, 200);

  const respuesta = await con(cookie, `/api/cuentas/${id}/clave`, {
    method: 'POST',
    body: JSON.stringify({ clave: OTRA_CLAVE }),
  });
  assert.equal(respuesta.status, 200);
  assert.equal((await respuesta.json()).sesiones_cerradas, 1);

  // La sesión que tenía abierta ya no vale.
  assert.equal((await con(suya, '/api/productos')).status, 401);

  assert.equal((await entrar('bodeguero', CLAVE_NUEVA)).status, 401);
  assert.equal((await entrar('bodeguero', OTRA_CLAVE)).status, 200);
});

test('la contraseña nueva también pasa por el validador', async () => {
  await crearCuenta({ usuario: 'bodeguero', clave: CLAVE_NUEVA, rol: 'admin' });
  const id = await idDe('bodeguero');

  const respuesta = await con(cookie, `/api/cuentas/${id}/clave`, {
    method: 'POST',
    body: JSON.stringify({ clave: '1234' }),
  });
  assert.equal(respuesta.status, 400);

  // Y la vieja sigue sirviendo: el rechazo no dejó la cuenta a medias.
  assert.equal((await entrar('bodeguero', CLAVE_NUEVA)).status, 200);
});

// ---------------------------------------------------------------------------
// Roles con permisos de verdad
// ---------------------------------------------------------------------------

test('un rol creado desde la API borra productos de verdad', async () => {
  // ÉSTE es el test que separa "roles con permisos" de "roles decorativos".
  const rol = await crearRol({
    nombre: 'bodega',
    descripcion: 'Sólo el almacén físico.',
    permisos: ['productos.eliminar'],
  });
  assert.equal(rol.status, 201);

  await crearCuenta({ usuario: 'bodeguero', clave: CLAVE_NUEVA, rol: 'bodega' });
  const suya = await cookieDeLogin('bodeguero', CLAVE_NUEVA);

  // Puede lo que su rol incluye…
  assert.equal((await con(suya, '/api/productos/3', { method: 'DELETE' })).status, 200);

  // …y nada de lo que no.
  assert.equal((await con(suya, '/api/cuentas')).status, 403);
  assert.equal((await con(suya, '/api/accesos')).status, 403);
  assert.equal((await con(suya, '/api/roles')).status, 403);
});

test('el rol sin permisos entra y trabaja, pero no borra', async () => {
  await crearRol({ nombre: 'ayudante', descripcion: '', permisos: [] });
  await crearCuenta({ usuario: 'ayudita', clave: CLAVE_NUEVA, rol: 'ayudante' });
  const suya = await cookieDeLogin('ayudita', CLAVE_NUEVA);

  // El día a día del almacén no está detrás de ningún permiso, y así sigue.
  assert.equal((await con(suya, '/api/productos')).status, 200);
  assert.equal(
    (
      await con(suya, '/api/productos', {
        method: 'POST',
        body: JSON.stringify({ nombre: 'Foco', marca: 'X', descripcion: 'y', cantidad: 1 }),
      })
    ).status,
    201
  );

  assert.equal((await con(suya, '/api/productos/3', { method: 'DELETE' })).status, 403);
});

test('el catálogo de permisos es cerrado: uno inventado se rechaza', async () => {
  const respuesta = await crearRol({
    nombre: 'todopoderoso',
    descripcion: '',
    permisos: ['productos.eliminar', 'base.borrar'],
  });
  assert.equal(respuesta.status, 400);
  assert.match((await respuesta.json()).error, /base\.borrar/);

  const { rows } = await consultar("SELECT count(*)::int AS total FROM roles WHERE nombre = 'todopoderoso'");
  assert.equal(rows[0].total, 0);
});

test('el nombre del rol se normaliza y se valida', async () => {
  assert.equal((await crearRol({ nombre: 'Bodega', permisos: [] })).status, 201);

  const { rows } = await consultar('SELECT nombre FROM roles ORDER BY nombre');
  assert.ok(rows.some((f) => f.nombre === 'bodega'));

  assert.equal((await crearRol({ nombre: 'ab', permisos: [] })).status, 400);
  assert.equal((await crearRol({ nombre: 'con espacio', permisos: [] })).status, 400);
  assert.equal((await crearRol({ nombre: '9lives', permisos: [] })).status, 400);
});

test('editar un rol cambia lo que pueden sus cuentas sin volver a entrar', async () => {
  await crearRol({ nombre: 'bodega', permisos: ['productos.eliminar'] });
  await crearCuenta({ usuario: 'bodeguero', clave: CLAVE_NUEVA, rol: 'bodega' });
  const suya = await cookieDeLogin('bodeguero', CLAVE_NUEVA);

  assert.equal((await con(suya, '/api/productos/3', { method: 'DELETE' })).status, 200);

  // Se le quita el permiso al ROL, sin tocar ni la cuenta ni su sesión.
  const editado = await con(cookie, '/api/roles/bodega', {
    method: 'PUT',
    body: JSON.stringify({ descripcion: 'Ya no borra.', permisos: [] }),
  });
  assert.equal(editado.status, 200);

  // La MISMA cookie, sin volver a entrar: el permiso se relee en cada petición.
  assert.equal((await con(suya, '/api/productos/2', { method: 'DELETE' })).status, 403);
});

test('el rol semilla superadmin no se edita ni se borra', async () => {
  const editado = await con(cookie, '/api/roles/superadmin', {
    method: 'PUT',
    body: JSON.stringify({ descripcion: 'mío', permisos: [] }),
  });
  assert.equal(editado.status, 409);

  const borrado = await con(cookie, '/api/roles/superadmin', { method: 'DELETE' });
  assert.equal(borrado.status, 409);

  const { rows } = await consultar("SELECT permisos FROM roles WHERE nombre = 'superadmin'");
  assert.deepEqual(rows[0].permisos.sort(), [
    'accesos.ver',
    'cuentas.gestionar',
    'productos.eliminar',
  ]);
});

test('admin sí es editable: es el rol operativo, no la vía de vuelta', async () => {
  const respuesta = await con(cookie, '/api/roles/admin', {
    method: 'PUT',
    body: JSON.stringify({ descripcion: 'Ahora también borra.', permisos: ['productos.eliminar'] }),
  });
  assert.equal(respuesta.status, 200);

  const suya = await iniciarSesion(base, 'admin');
  assert.equal((await con(suya, '/api/productos/3', { method: 'DELETE' })).status, 200);
});

test('un rol con cuentas dentro no se puede borrar', async () => {
  await crearRol({ nombre: 'bodega', permisos: [] });
  await crearCuenta({ usuario: 'bodeguero', clave: CLAVE_NUEVA, rol: 'bodega' });

  const respuesta = await con(cookie, '/api/roles/bodega', { method: 'DELETE' });
  assert.equal(respuesta.status, 409);
  assert.match((await respuesta.json()).error, /Cámbiales el rol/);

  // Vaciado el rol, sí se va.
  const id = await idDe('bodeguero');
  assert.equal(
    (await con(cookie, `/api/cuentas/${id}/rol`, { method: 'PATCH', body: JSON.stringify({ rol: 'admin' }) }))
      .status,
    200
  );
  assert.equal((await con(cookie, '/api/roles/bodega', { method: 'DELETE' })).status, 200);
});

test('GET /api/roles manda el catálogo junto a los roles', async () => {
  const cuerpo = await (await con(cookie, '/api/roles')).json();

  assert.deepEqual(cuerpo.permisos.sort(), [
    'accesos.ver',
    'cuentas.gestionar',
    'productos.eliminar',
  ]);

  const superadmin = cuerpo.roles.find((r) => r.nombre === 'superadmin');
  assert.equal(superadmin.semilla, true);
  assert.equal(superadmin.cuentas, 1);

  const admin = cuerpo.roles.find((r) => r.nombre === 'admin');
  assert.equal(admin.semilla, false);
});

// ---------------------------------------------------------------------------
// El invariante: nunca cero cuentas que puedan gestionar cuentas
// ---------------------------------------------------------------------------

test('no se puede dar de baja a la única cuenta que gestiona cuentas', async () => {
  // Se crea un segundo gestor y se le da de baja al primero: hasta aquí, bien.
  await crearCuenta({ usuario: 'segundo', clave: CLAVE_NUEVA, rol: 'superadmin' });
  const suya = await cookieDeLogin('segundo', CLAVE_NUEVA);
  const primero = await idDe(USUARIOS.superadmin);

  assert.equal(
    (await con(suya, `/api/cuentas/${primero}/activa`, { method: 'PATCH', body: JSON.stringify({ activa: false }) }))
      .status,
    200
  );

  // Y ahora ya no queda ningún otro: bajarse a sí mismo se rechaza.
  const propio = await idDe('segundo');
  const respuesta = await con(suya, `/api/cuentas/${propio}/activa`, {
    method: 'PATCH',
    body: JSON.stringify({ activa: false }),
  });
  assert.equal(respuesta.status, 409);
  assert.match((await respuesta.json()).error, /tu propia cuenta/);

  // La cuenta sigue activa: el rechazo no dejó nada a medias.
  const { rows } = await consultar('SELECT activa FROM cuentas WHERE id_cuenta = $1', [propio]);
  assert.equal(rows[0].activa, 1);
});

test('no se puede bajar al último gestor ni siendo otra cuenta quien lo intenta', async () => {
  // Un segundo gestor baja al primero, y luego un tercero —sin permiso— no
  // puede hacer nada; el que queda es el único, y él mismo se protege.
  const soloGestor = await idDe(USUARIOS.superadmin);

  const respuesta = await con(cookie, `/api/cuentas/${soloGestor}/activa`, {
    method: 'PATCH',
    body: JSON.stringify({ activa: false }),
  });
  assert.equal(respuesta.status, 409);
});

test('no se puede mover al último gestor a un rol que no gestiona', async () => {
  const propio = await idDe(USUARIOS.superadmin);

  const respuesta = await con(cookie, `/api/cuentas/${propio}/rol`, {
    method: 'PATCH',
    body: JSON.stringify({ rol: 'admin' }),
  });
  assert.equal(respuesta.status, 409);
  assert.match((await respuesta.json()).error, /a ti mismo/);

  const { rows } = await consultar('SELECT rol FROM cuentas WHERE id_cuenta = $1', [propio]);
  assert.equal(rows[0].rol, 'superadmin');
});

test('a otro gestor sí se le puede mover, mientras quede alguien', async () => {
  await crearRol({ nombre: 'gestor', permisos: ['cuentas.gestionar'] });
  await crearCuenta({ usuario: 'segundo', clave: CLAVE_NUEVA, rol: 'gestor' });
  const id = await idDe('segundo');

  assert.equal(
    (await con(cookie, `/api/cuentas/${id}/rol`, { method: 'PATCH', body: JSON.stringify({ rol: 'admin' }) }))
      .status,
    200
  );

  // Y desde su sesión ya no gestiona nada.
  const suya = await cookieDeLogin('segundo', CLAVE_NUEVA);
  assert.equal((await con(suya, '/api/cuentas')).status, 403);
});

test('no se le puede quitar la gestión al único rol que la tiene', async () => {
  // superadmin es semilla y ya lo protege el 409 de "no se puede modificar";
  // aquí se comprueba el otro camino: un rol gestor normal.
  await crearRol({ nombre: 'gestor', permisos: ['cuentas.gestionar'] });
  await crearCuenta({ usuario: 'segundo', clave: CLAVE_NUEVA, rol: 'gestor' });

  // Con el superadmin de fábrica todavía activo, quitarlo se permite.
  assert.equal(
    (await con(cookie, '/api/roles/gestor', { method: 'PUT', body: JSON.stringify({ permisos: [] }) }))
      .status,
    200
  );

  // Se devuelve el permiso y se deja a `gestor` como único camino.
  await con(cookie, '/api/roles/gestor', {
    method: 'PUT',
    body: JSON.stringify({ permisos: ['cuentas.gestionar'] }),
  });
  const suyo = await idDe(USUARIOS.superadmin);
  const suya = await cookieDeLogin('segundo', CLAVE_NUEVA);
  await con(suya, `/api/cuentas/${suyo}/activa`, {
    method: 'PATCH',
    body: JSON.stringify({ activa: false }),
  });

  const respuesta = await con(suya, '/api/roles/gestor', {
    method: 'PUT',
    body: JSON.stringify({ permisos: [] }),
  });
  assert.equal(respuesta.status, 409);
  assert.match((await respuesta.json()).error, /sin ninguna cuenta/);
});

// ---------------------------------------------------------------------------
// Quién puede entrar aquí
// ---------------------------------------------------------------------------

test('sin cuentas.gestionar, todo el centro de gestión responde 403', async () => {
  const suya = await iniciarSesion(base, 'admin');

  const rutas = [
    ['GET', '/api/cuentas'],
    ['POST', '/api/cuentas'],
    ['GET', '/api/roles'],
    ['POST', '/api/roles'],
    ['PUT', '/api/roles/admin'],
    ['DELETE', '/api/roles/admin'],
    ['PATCH', '/api/cuentas/1/activa'],
    ['PATCH', '/api/cuentas/1/rol'],
    ['POST', '/api/cuentas/1/clave'],
    ['GET', '/api/accesos'],
  ];

  for (const [metodo, ruta] of rutas) {
    const respuesta = await con(suya, ruta, { method: metodo, body: metodo === 'GET' ? undefined : '{}' });
    assert.equal(respuesta.status, 403, `${metodo} ${ruta} debería ser 403`);
  }
});

test('la pantalla de gestión no se sirve a quien no la puede usar', async () => {
  const suya = await iniciarSesion(base, 'admin');

  // A quien teclea la dirección se le lleva a una pantalla, no a un JSON.
  const pantalla = await con(suya, '/html/cuentas.html', { redirect: 'manual' });
  assert.equal(pantalla.status, 302);
  assert.equal(pantalla.headers.get('location'), '/');

  // Al <script src> se le responde 403 y ya.
  assert.equal((await con(suya, '/js/cuentas.js')).status, 403);

  // Y al superadmin sí.
  assert.equal((await con(cookie, '/html/cuentas.html')).status, 200);
  assert.equal((await con(cookie, '/js/cuentas.js')).status, 200);
});

test('accesos.ver es un permiso aparte del de gestionar', async () => {
  await crearRol({ nombre: 'auditor', permisos: ['accesos.ver'] });
  await crearCuenta({ usuario: 'auditora', clave: CLAVE_NUEVA, rol: 'auditor' });
  const suya = await cookieDeLogin('auditora', CLAVE_NUEVA);

  assert.equal((await con(suya, '/api/accesos')).status, 200);
  assert.equal((await con(suya, '/api/cuentas')).status, 403);
  assert.equal((await con(suya, '/html/cuentas.html', { redirect: 'manual' })).status, 302);
});

test('/api/auth/yo entrega los permisos, no sólo el nombre del rol', async () => {
  await crearRol({ nombre: 'bodega', permisos: ['productos.eliminar'] });
  await crearCuenta({ usuario: 'bodeguero', clave: CLAVE_NUEVA, rol: 'bodega' });
  const suya = await cookieDeLogin('bodeguero', CLAVE_NUEVA);

  const cuerpo = await (await con(suya, '/api/auth/yo')).json();
  assert.equal(cuerpo.rol, 'bodega');
  assert.deepEqual(cuerpo.permisos, ['productos.eliminar']);
});

test('ni el alta ni el listado dejan salir un hash', async () => {
  await crearCuenta({ usuario: 'bodeguero', clave: CLAVE_NUEVA, rol: 'admin' });

  const listado = await (await con(cookie, '/api/cuentas')).json();
  const texto = JSON.stringify(listado);

  assert.ok(!texto.includes('scrypt'), 'el listado no puede llevar hashes');
  for (const cuenta of listado) assert.equal(cuenta.hash, undefined);
});

test('un id de cuenta que no es un número da 404 y no un error de base', async () => {
  // En Postgres, colar 'abc' en un `WHERE id_cuenta = $1` es un 22P02: sin esta
  // validación sería un 500 donde tiene que haber un 404.
  for (const ruta of ['/api/cuentas/abc/activa', '/api/cuentas/abc/rol']) {
    const respuesta = await con(cookie, ruta, { method: 'PATCH', body: JSON.stringify({}) });
    assert.equal(respuesta.status, 404);
  }

  const clave = await con(cookie, '/api/cuentas/abc/clave', {
    method: 'POST',
    body: JSON.stringify({ clave: CLAVE_NUEVA }),
  });
  assert.equal(clave.status, 404);
});
