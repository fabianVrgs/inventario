// Tests de la autenticación de punta a punta: guardia, roles, sesiones, CSRF,
// límite de intentos y segundo factor.
//
// Van aparte de api.test.js porque aquel comprueba reglas de negocio dando la
// sesión por hecha, y aquí la sesión ES el asunto. Comparten proceso y base
// temporal por el mismo motivo de siempre: server.js abre la conexión al
// cargarse, así que una base distinta necesitaría otro proceso.

const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { once } = require('node:events');

const { crearBaseTemporal, sembrar } = require('./helpers/db');
const {
  CLAVES,
  USUARIOS,
  sembrarCuentas,
  sembrarCodigoRespaldo,
  iniciarSesion,
  cookieDe,
} = require('./helpers/sesion');
const auth = require('../auth.js');

let servidor;
let base;
let dirTemporal;
let db;
let app;

before(async () => {
  const { dir, archivo } = await crearBaseTemporal();
  dirTemporal = dir;
  process.env.DB_PATH = archivo;

  app = require('../server.js');
  db = app.locals.db;

  servidor = app.listen(0);
  await once(servidor, 'listening');
  base = `http://127.0.0.1:${servidor.address().port}`;
});

beforeEach(async () => {
  await sembrar();
  await sembrarCuentas();
  // El límite de intentos vive en memoria del proceso. Sin reiniciarlo, el test
  // que prueba la fuerza bruta dejaría a los siguientes bloqueados por IP —
  // todos salen de 127.0.0.1.
  app.locals.reiniciarLimites();
});

after(async () => {
  if (servidor) {
    servidor.close();
    await once(servidor, 'close');
  }
  if (db) await new Promise((r) => db.close(r));
  if (dirTemporal) fs.rmSync(dirTemporal, { recursive: true, force: true });
});

const entrar = (usuario, clave, extra = {}) =>
  fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario, clave, ...extra }),
  });

const conCookie = (cookie, ruta, opciones = {}) =>
  fetch(`${base}${ruta}`, {
    ...opciones,
    headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(opciones.headers || {}) },
  });

const filaDeSesion = () =>
  new Promise((res, rej) =>
    db.get('SELECT * FROM sesiones LIMIT 1', [], (e, r) => (e ? rej(e) : res(r)))
  );

const ejecutar = (sql, parametros = []) =>
  new Promise((res, rej) => db.run(sql, parametros, (e) => (e ? rej(e) : res())));

// ---------------------------------------------------------------------------
// Entrar y salir
// ---------------------------------------------------------------------------

test('el login correcto devuelve una cookie HttpOnly y SameSite', async () => {
  const respuesta = await entrar(USUARIOS.admin, CLAVES.admin);
  assert.equal(respuesta.status, 200);

  const galleta = respuesta.headers.get('set-cookie');
  // Estos tres atributos son la defensa, no un adorno: HttpOnly impide que un
  // XSS lea la sesión y SameSite es lo que para el CSRF.
  assert.match(galleta, /HttpOnly/i);
  assert.match(galleta, /SameSite=Strict/i);
  assert.match(galleta, /Path=\//i);

  const cuerpo = await respuesta.json();
  assert.equal(cuerpo.usuario, USUARIOS.admin);
  assert.equal(cuerpo.rol, 'admin');
});

test('la contraseña mala y el usuario inexistente dicen exactamente lo mismo', async () => {
  // Si se distinguieran, probar nombres hasta ver el otro mensaje enumeraría
  // las cuentas sin acertar ni una contraseña.
  const mala = await entrar(USUARIOS.admin, 'esta-no-es-la-clave');
  const fantasma = await entrar('no-existe-nadie-asi', 'esta-no-es-la-clave');

  assert.equal(mala.status, 401);
  assert.equal(fantasma.status, 401);
  assert.deepEqual(await mala.json(), await fantasma.json());
});

test('no se entra con la contraseña de otra cuenta', async () => {
  const respuesta = await entrar(USUARIOS.admin, CLAVES.superadmin);
  assert.equal(respuesta.status, 401);
});

test('salir deja la cookie inservible y borra la fila de la sesión', async () => {
  const cookie = await iniciarSesion(base, 'admin');
  assert.equal((await conCookie(cookie, '/api/productos')).status, 200);

  const salida = await conCookie(cookie, '/api/auth/salir', { method: 'POST' });
  assert.equal(salida.status, 200);

  assert.equal((await conCookie(cookie, '/api/productos')).status, 401);
  assert.equal(await filaDeSesion(), undefined, 'la fila no puede quedarse en la tabla');
});

// ---------------------------------------------------------------------------
// El guardia
// ---------------------------------------------------------------------------

test('sin sesión, la API responde 401 y no filtra datos', async () => {
  const respuesta = await fetch(`${base}/api/productos`);
  assert.equal(respuesta.status, 401);

  const cuerpo = await respuesta.json();
  assert.ok(!Array.isArray(cuerpo), 'no puede devolver el catálogo');
  assert.ok(cuerpo.error);
});

test('sin sesión, una pantalla HTML lleva al login', async () => {
  const respuesta = await fetch(`${base}/html/inventario.html`, { redirect: 'manual' });

  assert.equal(respuesta.status, 302);
  assert.equal(respuesta.headers.get('location'), '/login');
});

test('el guardia protege TODAS las rutas de la API, no una lista', async () => {
  // Denegar por defecto significa que una ruta nueva nace protegida. Si algún
  // día esto falla, es que alguien invirtió el criterio.
  const rutas = [
    ['GET', '/api/productos'],
    ['GET', '/api/productos/1'],
    ['GET', '/api/areas'],
    ['GET', '/api/ordenes/1'],
    ['POST', '/api/ordenes'],
    ['POST', '/api/productos'],
    ['PUT', '/api/productos/1'],
    ['PATCH', '/api/productos/1/activo'],
    ['DELETE', '/api/productos/1'],
    ['GET', '/api/cuentas'],
    ['GET', '/api/accesos'],
    ['GET', '/api/auth/yo'],
  ];

  for (const [metodo, ruta] of rutas) {
    const respuesta = await fetch(`${base}${ruta}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json' },
      body: metodo === 'GET' || metodo === 'DELETE' ? undefined : '{}',
    });
    assert.equal(respuesta.status, 401, `${metodo} ${ruta} debería exigir sesión`);
  }
});

test('la pantalla de login y sus recursos sí se sirven sin sesión', async () => {
  for (const ruta of ['/login', '/js/login.js', '/css/base.css', '/css/login.css']) {
    const respuesta = await fetch(`${base}${ruta}`);
    assert.equal(respuesta.status, 200, `${ruta} tiene que ser accesible para poder entrar`);
  }
});

test('el resto del JavaScript de la aplicación NO se sirve sin sesión', async () => {
  for (const ruta of ['/js/edit.js', '/js/logica.js', '/js/orden.js', '/js/sesion.js']) {
    const respuesta = await fetch(`${base}${ruta}`, { redirect: 'manual' });
    assert.equal(respuesta.status, 302, `${ruta} no tiene por qué leerlo un desconocido`);
  }
});

// ---------------------------------------------------------------------------
// Cookies falsas y sesiones muertas
// ---------------------------------------------------------------------------

test('un token inventado no abre nada', async () => {
  const respuesta = await conCookie(`sesion=${auth.nuevoToken()}`, '/api/productos');
  assert.equal(respuesta.status, 401);
});

test('el hash de la tabla no sirve como cookie', async () => {
  // Lo que se guarda es el SHA-256 del token. Quien se lleve el .db3 tiene eso
  // y nada más: presentarlo como si fuera la cookie no puede funcionar.
  await iniciarSesion(base, 'admin');
  const fila = await filaDeSesion();

  const respuesta = await conCookie(`sesion=${fila.hash_token}`, '/api/productos');
  assert.equal(respuesta.status, 401);
});

test('una sesión pasada de su vencimiento absoluto no vale, y se borra', async () => {
  const cookie = await iniciarSesion(base, 'admin');
  await ejecutar('UPDATE sesiones SET expira_en = ?', [new Date(Date.now() - 1000).toISOString()]);

  assert.equal((await conCookie(cookie, '/api/productos')).status, 401);
  assert.equal(await filaDeSesion(), undefined, 'una sesión muerta no se queda en la tabla');
});

test('una sesión dormida más de lo permitido no vale', async () => {
  // La tablet olvidada encima de una caja. El techo absoluto sigue lejos, pero
  // el corte por inactividad la cierra igual.
  const cookie = await iniciarSesion(base, 'admin');
  const hace3Horas = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  await ejecutar('UPDATE sesiones SET vista_en = ?', [hace3Horas]);

  assert.equal((await conCookie(cookie, '/api/productos')).status, 401);
});

test('dar de baja una cuenta invalida su sesión ya abierta', async () => {
  const cookie = await iniciarSesion(base, 'admin');
  await ejecutar('UPDATE cuentas SET activa = 0 WHERE usuario = ?', [USUARIOS.admin]);

  assert.equal((await conCookie(cookie, '/api/productos')).status, 401);
});

test('una cuenta de baja tampoco puede volver a entrar', async () => {
  await ejecutar('UPDATE cuentas SET activa = 0 WHERE usuario = ?', [USUARIOS.admin]);
  assert.equal((await entrar(USUARIOS.admin, CLAVES.admin)).status, 401);
});

// ---------------------------------------------------------------------------
// Reparto de permisos
// ---------------------------------------------------------------------------

test('el admin no puede borrar productos y el superadmin sí', async () => {
  const deAdmin = await iniciarSesion(base, 'admin');
  const negado = await conCookie(deAdmin, '/api/productos/1', { method: 'DELETE' });
  assert.equal(negado.status, 403);

  // Y no basta con que responda 403: el producto tiene que seguir ahí.
  const sigue = await conCookie(deAdmin, '/api/productos/1');
  assert.equal(sigue.status, 200);

  const deSuper = await iniciarSesion(base, 'superadmin');
  const borrado = await conCookie(deSuper, '/api/productos/1', { method: 'DELETE' });
  assert.equal(borrado.status, 200);
});

test('el admin hace todo lo demás del inventario', async () => {
  // El reparto no es "el admin mira y el superadmin trabaja". Es al revés: el
  // almacén trabaja con esto todo el día y sólo lo irreversible se reserva.
  const cookie = await iniciarSesion(base, 'admin');

  const alta = await conCookie(cookie, '/api/productos', {
    method: 'POST',
    body: JSON.stringify({ nombre: 'Foco nuevo', cantidad: 3 }),
  });
  assert.equal(alta.status, 201);

  const edicion = await conCookie(cookie, '/api/productos/1', {
    method: 'PUT',
    body: JSON.stringify({ nombre: 'vim2', cantidad: 4 }),
  });
  assert.equal(edicion.status, 200);

  const orden = await conCookie(cookie, '/api/ordenes', {
    method: 'POST',
    body: JSON.stringify({ lineas: [{ id_producto: 1, cantidad: 1 }] }),
  });
  assert.equal(orden.status, 200);

  const { id_orden } = await orden.json();
  const devolucion = await conCookie(cookie, `/api/ordenes/${id_orden}/devolucion`, {
    method: 'POST',
    body: JSON.stringify({ recibida_por: 'almacén' }),
  });
  assert.equal(devolucion.status, 200);
});

test('la gestión de cuentas y la bitácora son sólo del superadmin', async () => {
  const deAdmin = await iniciarSesion(base, 'admin');
  assert.equal((await conCookie(deAdmin, '/api/cuentas')).status, 403);
  assert.equal((await conCookie(deAdmin, '/api/accesos')).status, 403);

  const deSuper = await iniciarSesion(base, 'superadmin');
  assert.equal((await conCookie(deSuper, '/api/cuentas')).status, 200);
  assert.equal((await conCookie(deSuper, '/api/accesos')).status, 200);
});

test('el rol NO se puede escalar desde el cliente', async () => {
  // Ni pidiéndolo en el login...
  const respuesta = await entrar(USUARIOS.admin, CLAVES.admin, { rol: 'superadmin' });
  const cuerpo = await respuesta.json();
  assert.equal(cuerpo.rol, 'admin');

  // ...ni con la sesión ya abierta. El rol se relee de la base en cada
  // petición, así que no hay nada en la cookie que manipular.
  const cookie = cookieDe(respuesta);
  const quienSoy = await conCookie(cookie, '/api/auth/yo');
  assert.equal((await quienSoy.json()).rol, 'admin');
  assert.equal((await conCookie(cookie, '/api/productos/1', { method: 'DELETE' })).status, 403);
});

test('la lista de cuentas no devuelve ni un hash de contraseña', async () => {
  const cookie = await iniciarSesion(base, 'superadmin');
  const cuentas = await (await conCookie(cookie, '/api/cuentas')).json();

  assert.ok(cuentas.length >= 2);
  for (const cuenta of cuentas) {
    assert.equal(cuenta.hash, undefined, 'el hash no sale de la base ni para el superadmin');
    assert.equal(cuenta.totp_secreto, undefined, 'el secreto del segundo factor tampoco');
  }
});

// ---------------------------------------------------------------------------
// CSRF
// ---------------------------------------------------------------------------

test('un POST con Origin de otro sitio se rechaza', async () => {
  const cookie = await iniciarSesion(base, 'superadmin');

  const respuesta = await conCookie(cookie, '/api/productos', {
    method: 'POST',
    headers: { Origin: 'https://sitio-que-no-es-el-nuestro.example' },
    body: JSON.stringify({ nombre: 'colado desde fuera', cantidad: 1 }),
  });

  assert.equal(respuesta.status, 403);
});

test('un POST con nuestro propio Origin pasa', async () => {
  const cookie = await iniciarSesion(base, 'superadmin');

  const respuesta = await conCookie(cookie, '/api/productos', {
    method: 'POST',
    headers: { Origin: base },
    body: JSON.stringify({ nombre: 'desde la propia pantalla', cantidad: 1 }),
  });

  assert.equal(respuesta.status, 201);
});

test('detrás de un proxy HTTPS, el Origin del navegador pasa', async () => {
  // El caso que rompió el despliegue: el navegador manda `Origin: https://…`
  // pero el proxy inverso habla HTTP con nosotros, así que `req.protocol` dice
  // "http". Comparando la cadena entera fallaba y devolvía 403 en cada acción,
  // login incluido. Se comparan anfitriones, que es lo que el CSRF pregunta.
  const cookie = await iniciarSesion(base, 'superadmin');
  const anfitrion = new URL(base).host;

  const respuesta = await conCookie(cookie, '/api/productos', {
    method: 'POST',
    headers: {
      Origin: `https://${anfitrion}`,
      'X-Forwarded-Proto': 'https',
    },
    body: JSON.stringify({ nombre: 'emitido tras un proxy', cantidad: 1 }),
  });

  assert.equal(respuesta.status, 201);
});

test('un Origin con nuestro anfitrión pero otro puerto se rechaza', async () => {
  // El puerto forma parte del anfitrión, así que otra aplicación en la misma
  // máquina sigue siendo otro origen.
  const cookie = await iniciarSesion(base, 'superadmin');

  const respuesta = await conCookie(cookie, '/api/productos', {
    method: 'POST',
    headers: { Origin: 'http://127.0.0.1:1' },
    body: JSON.stringify({ nombre: 'desde otro puerto', cantidad: 1 }),
  });

  assert.equal(respuesta.status, 403);
});

test('un Origin ilegible (null, un sandbox) se rechaza', async () => {
  const cookie = await iniciarSesion(base, 'superadmin');

  const respuesta = await conCookie(cookie, '/api/productos', {
    method: 'POST',
    headers: { Origin: 'null' },
    body: JSON.stringify({ nombre: 'desde un sandbox', cantidad: 1 }),
  });

  assert.equal(respuesta.status, 403);
});

test('un GET con Origin ajeno NO se rechaza', async () => {
  // Un GET no cambia nada, y bloquearlo rompería enlaces legítimos sin ganar
  // nada: lo que hay que parar son las peticiones con efectos.
  const cookie = await iniciarSesion(base, 'superadmin');

  const respuesta = await conCookie(cookie, '/api/productos', {
    headers: { Origin: 'https://otro-sitio.example' },
  });

  assert.equal(respuesta.status, 200);
});

// ---------------------------------------------------------------------------
// Fuerza bruta
// ---------------------------------------------------------------------------

test('los intentos fallidos acaban en 429 con Retry-After', async () => {
  // Tres fallos son gratis: teclear mal la contraseña tres veces es lo normal,
  // y castigarlo antes molesta al dueño mucho más de lo que estorba a quien
  // ataca. El castigo empieza DESPUÉS del cuarto, así que es el quinto intento
  // el que ya se encuentra la puerta cerrada.
  for (let i = 0; i < 4; i += 1) {
    const respuesta = await entrar(USUARIOS.admin, 'clave-equivocada');
    assert.equal(respuesta.status, 401, `el intento ${i + 1} aún no debe bloquear`);
  }

  const bloqueado = await entrar(USUARIOS.admin, 'clave-equivocada');
  assert.equal(bloqueado.status, 429);
  assert.ok(Number(bloqueado.headers.get('retry-after')) > 0, 'debe decir cuánto esperar');
});

test('el bloqueo alcanza también a la contraseña correcta', async () => {
  // Si el acierto se saltara el castigo, se podría seguir probando sin coste:
  // el retraso sólo sirve si frena también el intento bueno.
  for (let i = 0; i < 4; i += 1) await entrar(USUARIOS.admin, 'clave-equivocada');

  const respuesta = await entrar(USUARIOS.admin, CLAVES.admin);
  assert.equal(respuesta.status, 429);
});

test('los intentos fallidos quedan registrados en la bitácora', async () => {
  await entrar('alguien-que-no-existe', 'probando');
  await entrar(USUARIOS.admin, 'clave-equivocada');

  const cookie = await iniciarSesion(base, 'superadmin');
  const accesos = await (await conCookie(cookie, '/api/accesos')).json();

  const usuarios = accesos.map((a) => a.usuario);
  assert.ok(usuarios.includes('alguien-que-no-existe'), 'el nombre tecleado se registra aunque no exista');
  assert.ok(accesos.some((a) => a.resultado === 'clave'));
  assert.ok(accesos.some((a) => a.resultado === 'ok'));
});

// ---------------------------------------------------------------------------
// Segundo factor
// ---------------------------------------------------------------------------

test('con TOTP activo, la contraseña sola no abre sesión', async () => {
  const { secreto } = await sembrarCuentas({ totp: true });

  const respuesta = await entrar(USUARIOS.superadmin, CLAVES.superadmin);
  assert.equal(respuesta.status, 200);

  const cuerpo = await respuesta.json();
  assert.equal(cuerpo.requiere_totp, true);
  assert.ok(cuerpo.reto);
  assert.equal(respuesta.headers.get('set-cookie'), null, 'todavía no hay sesión que dar');
  assert.ok(secreto);
});

test('el código correcto canjea el reto por una sesión', async () => {
  const { secreto } = await sembrarCuentas({ totp: true });
  const cookie = await iniciarSesion(base, 'superadmin', { secreto });

  const respuesta = await conCookie(cookie, '/api/auth/yo');
  assert.equal(respuesta.status, 200);
  assert.equal((await respuesta.json()).rol, 'superadmin');
});

test('el mismo código no sirve dos veces', async () => {
  // Anti-replay. Un código vale 30 segundos: sin esto, quien lo vea por encima
  // del hombro entra con él mientras siga en ventana.
  const { secreto } = await sembrarCuentas({ totp: true });
  const codigo = auth.codigoPara(secreto, auth.pasoActual());

  const primero = await entrar(USUARIOS.superadmin, CLAVES.superadmin);
  const canje1 = await fetch(`${base}/api/auth/totp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reto: (await primero.json()).reto, codigo }),
  });
  assert.equal(canje1.status, 200);

  const segundo = await entrar(USUARIOS.superadmin, CLAVES.superadmin);
  const canje2 = await fetch(`${base}/api/auth/totp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reto: (await segundo.json()).reto, codigo }),
  });
  assert.equal(canje2.status, 401, 'el código ya se consumió');
});

test('un reto ya canjeado no se puede reutilizar', async () => {
  const { secreto } = await sembrarCuentas({ totp: true });

  const login = await entrar(USUARIOS.superadmin, CLAVES.superadmin);
  const { reto } = await login.json();

  const paso = auth.pasoActual();
  const primero = await fetch(`${base}/api/auth/totp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reto, codigo: auth.codigoPara(secreto, paso) }),
  });
  assert.equal(primero.status, 200);

  const segundo = await fetch(`${base}/api/auth/totp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reto, codigo: auth.codigoPara(secreto, paso + 1) }),
  });
  assert.equal(segundo.status, 401, 'un pagaré se cobra una sola vez');
});

test('un reto inventado no abre nada', async () => {
  await sembrarCuentas({ totp: true });

  const respuesta = await fetch(`${base}/api/auth/totp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reto: auth.nuevoToken(), codigo: '123456' }),
  });

  assert.equal(respuesta.status, 401);
});

test('un código de respaldo entra, y sólo una vez', async () => {
  await sembrarCuentas({ totp: true });
  const codigo = await sembrarCodigoRespaldo(USUARIOS.superadmin);

  const canjear = async () => {
    const login = await entrar(USUARIOS.superadmin, CLAVES.superadmin);
    const { reto } = await login.json();
    return fetch(`${base}/api/auth/totp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reto, codigo }),
    });
  };

  const primero = await canjear();
  assert.equal(primero.status, 200);
  assert.equal((await primero.json()).codigo_respaldo_usado, true);

  // Si valiera dos veces sería una contraseña permanente escrita en un papel.
  assert.equal((await canjear()).status, 401);
});
