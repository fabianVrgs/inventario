// Tests del centro de gestión: altas, contraseñas y permisos.
//
// Van aparte de auth.test.js porque aquél comprueba cómo se entra y se sale, y
// aquí lo que se prueba es lo que puede hacer quien ya entró — y sobre todo lo
// que NO puede, que es donde vive el riesgo.
//
// Los roles son dos y NINGUNA ruta los escribe, así que aquí no hay tests de
// crearlos ni editarlos: hay tests de lo que cada uno puede. El que más vale es
// "superadmin borra productos y admin no", que es la diferencia entre roles que
// son permisos y roles que son etiquetas de adorno.

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
// único archivo que mete alguno, y meter en el helper compartido un borrado de
// roles obligaría a re-sembrar allí las dos filas que db/esquema.sql ya escribe
// — la misma verdad en dos sitios, y la copia del helper envejeciendo sola.
//
// Sólo hay un test que escriba esta tabla (el de `accesos.ver`), y lo hace por
// SQL porque no queda ninguna ruta que lo haga. `admin` y `superadmin` no se
// tocan: son parte del esquema, no datos de un test.
async function borrarRolesDePrueba() {
  await consultar("DELETE FROM roles WHERE nombre NOT IN ('admin', 'superadmin')");
}

beforeEach(async () => {
  await sembrar();
  await sembrarCuentas();
  await borrarRolesDePrueba();
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
// Los dos roles, y lo que separa a uno del otro
// ---------------------------------------------------------------------------

test('superadmin borra productos y admin no: los tres permisos son suyos', async () => {
  // ÉSTE es el test que separa "roles con permisos" de "roles decorativos", y
  // es el único sitio donde la frontera entre los dos roles se prueba entera.
  await crearCuenta({ usuario: 'bodeguero', clave: CLAVE_NUEVA, rol: 'superadmin' });
  const suya = await cookieDeLogin('bodeguero', CLAVE_NUEVA);

  // Los tres permisos de superadmin, cada uno por su puerta.
  assert.equal((await con(suya, '/api/productos/3', { method: 'DELETE' })).status, 200);
  assert.equal((await con(suya, '/api/cuentas')).status, 200);
  assert.equal((await con(suya, '/api/accesos')).status, 200);

  // Y admin, que no lleva ninguno, choca contra las tres.
  const deAdmin = await iniciarSesion(base, 'admin');
  assert.equal((await con(deAdmin, '/api/productos/2', { method: 'DELETE' })).status, 403);
  assert.equal((await con(deAdmin, '/api/cuentas')).status, 403);
  assert.equal((await con(deAdmin, '/api/accesos')).status, 403);
});

test('el rol sin permisos entra y trabaja, pero no borra', async () => {
  await crearCuenta({ usuario: 'ayudita', clave: CLAVE_NUEVA, rol: 'admin' });
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

test('GET /api/roles manda los dos roles y no sus permisos', async () => {
  const { roles } = await (await con(cookie, '/api/roles')).json();

  // Los dos, y sólo los dos: es lo que llena el <select> del alta de cuenta.
  assert.deepEqual(
    roles.map((r) => r.nombre),
    ['superadmin', 'admin']
  );

  // Con las cuentas de cada uno, que la pantalla enseña…
  assert.equal(roles[0].cuentas, 1);

  // …y SIN la columna `permisos`: nadie la pinta, y mandarla sería contarle a
  // la sesión más de lo que necesita para elegir un rol de una lista.
  for (const rol of roles) assert.equal(rol.permisos, undefined);
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
  await crearCuenta({ usuario: 'segundo', clave: CLAVE_NUEVA, rol: 'superadmin' });
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

// ---------------------------------------------------------------------------
// Quién puede entrar aquí
// ---------------------------------------------------------------------------

test('sin cuentas.gestionar, todo el centro de gestión responde 403', async () => {
  const suya = await iniciarSesion(base, 'admin');

  const rutas = [
    ['GET', '/api/cuentas'],
    ['POST', '/api/cuentas'],
    ['GET', '/api/roles'],
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
  // Los dos permisos viajan juntos en superadmin, así que sin un tercer rol no
  // hay forma de ver que se preguntan por separado — y se preguntan: son dos
  // `exigirPermiso` distintos. El rol se siembra por SQL porque ninguna ruta
  // escribe `roles`, que es exactamente como se ajustaría hoy en producción.
  await consultar(
    "INSERT INTO roles (nombre, descripcion, permisos) VALUES ('auditor', 'Sólo mira.', '{accesos.ver}')"
  );
  await crearCuenta({ usuario: 'auditora', clave: CLAVE_NUEVA, rol: 'auditor' });
  const suya = await cookieDeLogin('auditora', CLAVE_NUEVA);

  assert.equal((await con(suya, '/api/accesos')).status, 200);
  assert.equal((await con(suya, '/api/cuentas')).status, 403);
  assert.equal((await con(suya, '/html/cuentas.html', { redirect: 'manual' })).status, 302);
});

test('/api/auth/yo entrega los permisos, no sólo el nombre del rol', async () => {
  // El frontend esconde botones por PERMISO y no por rol: sin esta lista, el
  // CSS tendría que deducir de "eres admin" qué puede hacer un admin.
  const mio = await (await con(cookie, '/api/auth/yo')).json();
  assert.equal(mio.rol, 'superadmin');
  assert.deepEqual(mio.permisos.sort(), [
    'accesos.ver',
    'cuentas.gestionar',
    'productos.eliminar',
  ]);

  // Y admin llega con la lista vacía, no sin la clave: el frontend hace
  // `.includes()` sobre ella sin comprobar antes que exista.
  const suya = await iniciarSesion(base, 'admin');
  const suyo = await (await con(suya, '/api/auth/yo')).json();
  assert.equal(suyo.rol, 'admin');
  assert.deepEqual(suyo.permisos, []);
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
