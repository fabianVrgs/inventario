const express = require('express');
const path = require('path');
const auth = require('./auth.js');

// Única puerta a Postgres: la consulta suelta, el envoltorio de transacción y
// el pool. Aquí no se construye ninguna conexión, y por eso ya no hay ningún
// `DB_PATH` ni bloque `CREATE TABLE IF NOT EXISTS` al arrancar: aquel existía
// porque el `.db3` versionado iba por detrás de sus migraciones, y el esquema
// ahora se aplica una sola vez desde `db/esquema.sql`.
const { consultar, enTransaccion, pool } = require('./db.js');

// `cors` estaba aquí y se quitó a propósito. Respondía
// `Access-Control-Allow-Origin: *` a cualquier origen de internet, y desde que
// hay cookies de sesión eso es contradecir la misma política de origen que nos
// protege. El frontend se sirve del mismo origen que la API, así que nunca
// necesitó CORS para nada.

const app = express();
const port = process.env.PORT || 3000;

// ===========================================================================
// AUTENTICACIÓN
// ===========================================================================
//
// ORDEN: todo lo de esta sección se registra ANTES de `express.static` y de
// cualquier ruta. No es estilo, es la diferencia entre proteger la aplicación y
// creer que se protege: `express.static` sirve `/html/inventario.html` a quien
// lo pida, así que un guardia declarado después no llega a ejecutarse nunca.
//
// Antes de esto, el archivo declaraba la ruta `/` y `app.listen()` arriba del
// todo, delante de los middlewares. Funcionaba porque `listen` es asíncrono,
// pero convertía el orden en una trampa permanente. Ahora el archivo va en el
// orden normal —middlewares, rutas, manejador de errores, listen— justamente
// para que añadir un middleware nuevo no exija recordar nada.
//
// EL GUARDIA DENIEGA POR DEFECTO. `guardiaDeAcceso` bloquea todo lo que no esté
// en `RUTAS_PUBLICAS`, en vez de proteger ruta por ruta. Así, una ruta nueva
// nace protegida y olvidarse de ponerle el candado no puede pasar: el olvido
// deja fuera al usuario legítimo, que se nota en el acto, en vez de dejar
// entrar a cualquiera, que no se nota nunca.

// Techo absoluto de la sesión: pasadas estas horas hay que volver a entrar,
// se haya usado o no. Y corte por inactividad: una tablet olvidada encima de
// una caja en el almacén se cierra sola.
const HORAS_SESION = 12;
const HORAS_INACTIVIDAD = 2;
const NOMBRE_COOKIE = 'sesion';

const EN_PRODUCCION = process.env.NODE_ENV === 'production';

// Express anuncia `X-Powered-By: Express` en cada respuesta. No es una
// vulnerabilidad por sí sola, pero es información gratis: le dice a quien esté
// tanteando qué pila tiene delante y por tanto qué fallos conocidos probar
// primero. Callarlo no defiende de nada, pero tampoco ayuda a nadie.
app.disable('x-powered-by');

// Activar esto sin un proxy inverso delante sería contraproducente: haría
// creíble un `X-Forwarded-For` que cualquiera puede inventar, y el límite de
// intentos por IP dejaría de servir para nada. Por eso es explícito y no
// automático.
const TRAS_PROXY = process.env.CONFIAR_EN_PROXY === '1';
if (TRAS_PROXY) app.set('trust proxy', 1);

function ahora() {
  return new Date().toISOString();
}

function enHoras(horas) {
  return new Date(Date.now() + horas * 3600 * 1000).toISOString();
}

// Express trae `res.cookie` para escribir, pero no nada para leer sin
// `cookie-parser`. Son seis líneas y evitan una dependencia.
function leerCookie(req, nombre) {
  const cabecera = req.headers.cookie;
  if (!cabecera) return null;

  for (const trozo of cabecera.split(';')) {
    const igual = trozo.indexOf('=');
    if (igual === -1) continue;
    if (trozo.slice(0, igual).trim() === nombre) {
      return decodeURIComponent(trozo.slice(igual + 1).trim());
    }
  }
  return null;
}

// `httpOnly` es lo que hace que un XSS no pueda leer la sesión — por eso el
// token no toca `localStorage` en ningún momento. `sameSite: strict` es la
// defensa principal contra CSRF: el navegador no adjunta esta cookie a nada que
// venga de otro sitio. `secure` sólo en producción, porque en `http://localhost`
// el navegador descartaría una cookie marcada así y no se podría ni desarrollar.
function opcionesCookie() {
  return {
    httpOnly: true,
    secure: EN_PRODUCCION,
    sameSite: 'strict',
    path: '/',
    maxAge: HORAS_SESION * 3600 * 1000,
  };
}

function ipDe(req) {
  return req.ip || req.socket?.remoteAddress || null;
}

// Bitácora de intentos. Se escribe sin esperar y sin cortar la petición si
// falla: no poder registrar un acceso es un problema, pero dejar a alguien sin
// entrar por eso es peor.
function registrarAcceso(usuario, resultado, req) {
  consultar(
    'INSERT INTO accesos (ocurrido_en, usuario, resultado, ip) VALUES ($1, $2, $3, $4)',
    [ahora(), usuario ?? null, resultado, ipDe(req)]
  ).catch((err) => console.error('❌ No se pudo registrar el acceso:', err.message));
}

// ---------------------------------------------------------------------------
// Límite de intentos
// ---------------------------------------------------------------------------
//
// Retraso creciente, NO bloqueo de cuenta. Bloquear tras N fallos parece más
// seguro y es al revés: convierte el login en una palanca para dejar fuera al
// dueño: basta con saber su nombre de usuario y fallar cinco veces a propósito.
// El retraso hace inviable la fuerza bruta sin regalar esa palanca a nadie.
//
// Los tres primeros fallos son gratis: teclear mal la contraseña tres veces es
// lo normal, y castigarlo antes molesta al dueño mucho más de lo que estorba a
// quien ataca. La espera se fija AL FALLAR el cuarto, así que el quinto intento
// es el primero que se encuentra la puerta cerrada. De ahí en adelante se
// duplica —2 s, 4 s, 8 s…— hasta el techo de quince minutos, que es lo que
// convierte un diccionario de un millón de palabras en varios años.
//
// Se cuenta por IP y por usuario a la vez: sólo por IP, una botnet reparte los
// intentos entre mil direcciones; sólo por usuario, se prueban mil usuarios
// distintos desde la misma máquina.
//
// El contador vive en la base y no en un Map porque en serverless hay N
// instancias: cada una contaría sus propios fallos, así que los tres de
// gracia se multiplicarían por el número de instancias y la defensa contra
// fuerza bruta dejaría de valer.
//
// La objeción original —"escribir en la base en cada intento fallido convierte
// el login en un modo de castigar al disco"— razonaba sobre fsync en un disco
// local. Contra Postgres, con los volúmenes de un almacén, es ruido.
//
// Se guarda `ultimo_en` y NO el instante de desbloqueo ya calculado: así
// anotar un fallo es UN solo INSERT ... ON CONFLICT para las dos claves a la
// vez, en vez de SELECT + calcular + UPDATE. La espera se aplica al leer, que
// es donde esperaTras() ya vive.
const FALLOS_DE_GRACIA = 3;
const ESPERA_MAXIMA_MS = 15 * 60 * 1000;

function esperaTras(fallos) {
  if (fallos <= FALLOS_DE_GRACIA) return 0;
  return Math.min(2 ** (fallos - FALLOS_DE_GRACIA) * 1000, ESPERA_MAXIMA_MS);
}

// Devuelve los milisegundos que faltan, o 0 si puede pasar.
async function bloqueoRestante(claves) {
  const { rows } = await consultar(
    'SELECT fallos, ultimo_en FROM intentos_login WHERE clave = ANY($1::text[])',
    [claves]
  );

  let restante = 0;
  for (const fila of rows) {
    const hasta = Date.parse(fila.ultimo_en) + esperaTras(fila.fallos);
    restante = Math.max(restante, hasta - Date.now());
  }
  return Math.max(0, restante);
}

async function anotarFallo(claves) {
  await consultar(
    `INSERT INTO intentos_login (clave, fallos, ultimo_en)
     SELECT c, 1, $2 FROM unnest($1::text[]) AS c
     ON CONFLICT (clave) DO UPDATE
       SET fallos = intentos_login.fallos + 1,
           ultimo_en = EXCLUDED.ultimo_en`,
    [claves, ahora()]
  );
}

async function limpiarFallos(claves) {
  await consultar('DELETE FROM intentos_login WHERE clave = ANY($1::text[])', [claves]);
}

// Sólo para los tests: cada uno necesita empezar sin el castigo del anterior.
async function reiniciarLimites() {
  await consultar('DELETE FROM intentos_login');
}

function clavesDeIntento(req, usuario) {
  return [`ip:${ipDe(req)}`, `usuario:${String(usuario ?? '').toLowerCase()}`];
}

// ---------------------------------------------------------------------------
// Middlewares, en el orden en que se ejecutan
// ---------------------------------------------------------------------------

// 1. Cabeceras de seguridad. A mano y no con `helmet`, para no añadir una
//    dependencia por diez líneas que además conviene leer y entender.
app.use((req, res, next) => {
  // La CSP es la red que queda si algún día entra un XSS. `script-src 'self'`
  // significa que sólo se ejecuta JavaScript servido desde este origen: ni
  // `onclick=` en el HTML, ni un `<script>` inyectado en un campo de texto.
  // Es también la razón por la que en este proyecto ya no hay manejadores en
  // línea; `'unsafe-inline'` los devolvería, y con ellos el agujero.
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'", // nadie nos mete en un iframe: sin clickjacking
      "base-uri 'none'", // un <base> inyectado redirigiría todas las rutas relativas
      "object-src 'none'",
    ].join('; ')
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), interest-cohort=()');

  // HSTS sólo si la petición llegó cifrada. Mandarlo por HTTP es inútil —el
  // navegador lo ignora— y en desarrollo dejaría localhost clavado en https
  // durante un año en el navegador de quien lo probó.
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // Nada de esto debe quedar en una caché compartida ni en el botón "atrás"
  // después de cerrar sesión.
  if (req.path.startsWith('/api/') || req.path.endsWith('.html') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-store');
  }

  next();
});

// 2. Forzado de HTTPS. Sólo tiene sentido tras un proxy que termine el TLS:
//    él sabe por dónde llegó la petición y nos lo dice en `x-forwarded-proto`.
app.use((req, res, next) => {
  if (TRAS_PROXY && req.headers['x-forwarded-proto'] === 'http') {
    return res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
  }
  next();
});

// 3. Cuerpo JSON, con techo. Sin `limit` alguien puede mandar cien megas en un
//    POST y hacernos gastar memoria a coste cero para él.
app.use(express.json({ limit: '100kb' }));

// 4. Guardia de Origin: la segunda capa contra CSRF, detrás de `SameSite`.
//
//    `Origin` es de los headers que el navegador rellena él y que JavaScript no
//    puede falsificar. Si viene y NO es el nuestro, la petición nace en otra
//    página y no se atiende.
//
//    Que FALTE sí se acepta, y no es un agujero: los navegadores mandan Origin
//    en toda petición con efectos (POST, PUT, PATCH, DELETE), tanto de fetch
//    como de formulario. Quien no lo manda es curl o un script — que no es el
//    escenario de CSRF, porque ahí no hay ninguna cookie ajena que aprovechar.
//    Se comparan los ANFITRIONES, no las cadenas de origen enteras.
//
//    La primera versión comparaba `${protocolo}://${host}` y se rompía en
//    cuanto había un proxy inverso delante: el navegador manda
//    `Origin: https://…`, pero el proxy habla HTTP con nosotros, así que
//    `req.protocol` decía `http` y la comparación fallaba. Resultado: un 403
//    en cada acción, incluido el login, con el mensaje de abajo. Sólo se
//    arreglaba acordándose de poner CONFIAR_EN_PROXY=1, y una defensa que hay
//    que recordar activar para que la aplicación no se rompa entera no es una
//    defensa, es una trampa.
//
//    Comparar anfitriones no afloja nada: el CSRF es una pregunta sobre QUIÉN
//    origina la petición, y eso es el anfitrión. Para que `http://nuestro-host`
//    fuese un ataque habría que controlar nuestro propio dominio, que es una
//    partida ya perdida por otro sitio. Y de que se hable por HTTPS ya se
//    encarga la redirección y la cookie `Secure`, no esta comprobación.
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();

  const origen = req.headers.origin;
  if (!origen) return next();

  // Una lista explícita, si la hay, manda sobre todo lo demás: es la salida
  // para cuando el `Host` que llega no es el dominio público (algunos proxys).
  if (process.env.ORIGEN_PERMITIDO) {
    const permitidos = process.env.ORIGEN_PERMITIDO.split(',').map((o) => o.trim());
    if (permitidos.includes(origen)) return next();
    return res.status(403).json({ error: 'Petición rechazada: origen no permitido.' });
  }

  let anfitrionDelOrigen;
  try {
    anfitrionDelOrigen = new URL(origen).host;
  } catch {
    // `Origin: null` (un sandbox, un archivo local) no es el nuestro.
    return res.status(403).json({ error: 'Petición rechazada: origen no permitido.' });
  }

  const propio = TRAS_PROXY
    ? req.headers['x-forwarded-host'] || req.headers.host
    : req.headers.host;

  if (anfitrionDelOrigen !== propio) {
    return res.status(403).json({ error: 'Petición rechazada: origen no permitido.' });
  }
  next();
});

// 5. Resolución de la sesión. Deja `req.cuenta` puesto o no, pero no bloquea a
//    nadie: de decidir se encarga el guardia siguiente.
app.use(async (req, res, next) => {
  const token = leerCookie(req, NOMBRE_COOKIE);
  if (!token) return next();

  let fila;
  try {
    const { rows } = await consultar(
      `SELECT s.id_sesion, s.vista_en, s.expira_en,
              c.id_cuenta, c.usuario, c.rol, c.activa
       FROM sesiones s
       JOIN cuentas c ON c.id_cuenta = s.id_cuenta
       WHERE s.hash_token = $1`,
      [auth.hashToken(token)]
    );
    fila = rows[0];
  } catch (err) {
    // Un fallo de base no puede convertirse en "adelante, pase": ante la
    // duda, sin sesión.
    console.error('[sesion] no se pudo resolver la sesión:', err.message);
    return next();
  }

  if (!fila) return next();

  const instante = Date.now();
  const vencida = Date.parse(fila.expira_en) <= instante;
  const dormida = Date.parse(fila.vista_en) + HORAS_INACTIVIDAD * 3600 * 1000 <= instante;

  if (vencida || dormida || fila.activa !== 1) {
    // Se borra la fila en vez de dejarla: una sesión muerta que sigue en la
    // tabla es sólo material para que alguien la resucite si cambia el reloj.
    // Se espera al borrado —a diferencia del refresco de `vista_en`— porque hay
    // un test que comprueba la tabla justo después de la respuesta.
    try {
      await consultar('DELETE FROM sesiones WHERE id_sesion = $1', [fila.id_sesion]);
    } catch (err) {
      console.error('[sesion] no se pudo borrar la sesión muerta:', err.message);
    }
    res.clearCookie(NOMBRE_COOKIE, { ...opcionesCookie(), maxAge: undefined });
    return next();
  }

  req.cuenta = { id_cuenta: fila.id_cuenta, usuario: fila.usuario, rol: fila.rol };
  req.idSesion = fila.id_sesion;

  // `vista_en` se refresca como mucho una vez por minuto. Escribirlo en cada
  // petición convertiría cargar una pantalla —que dispara varias— en una ráfaga
  // de escrituras, y ahora además en una ráfaga de clientes del pool.
  if (instante - Date.parse(fila.vista_en) > 60_000) {
    consultar('UPDATE sesiones SET vista_en = $1 WHERE id_sesion = $2', [ahora(), fila.id_sesion])
      .catch((err) => console.error('[sesion] no se pudo refrescar vista_en:', err.message));
  }

  next();
});

// 6. El guardia. Todo lo que no esté aquí exige sesión.
//
//    La lista es corta a propósito y son exactamente las piezas que hacen falta
//    para PODER entrar: la pantalla de login, su JavaScript, los estilos, el
//    logo y las dos rutas del propio login. Nada más — ni siquiera el resto de
//    `/js/`, que es la interfaz del almacén y no tiene por qué leerla un
//    desconocido.
const RUTAS_PUBLICAS = [
  '/login',
  '/js/login.js',
  '/favicon.ico',
  '/api/auth/login',
  '/api/auth/totp',
  '/api/salud',
];

function esPublica(ruta) {
  return RUTAS_PUBLICAS.includes(ruta) || ruta.startsWith('/css/') || ruta.startsWith('/img/');
}

app.use((req, res, next) => {
  if (esPublica(req.path) || req.cuenta) return next();

  // Dos respuestas distintas porque son dos clientes distintos. A `fetch` se le
  // responde 401 y él decide; a alguien que teclea una dirección en la barra
  // hay que llevarlo al login, no enseñarle un JSON.
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Necesitas iniciar sesión.' });
  }
  res.redirect(302, '/login');
});

// Única ruta de /api/ que se sirve sin sesión, y va escrita aquí a propósito:
// el guardia DENIEGA POR DEFECTO, así que añadirla a RUTAS_PUBLICAS es una
// decisión, no un descuido. No lee ni revela ningún dato; su único efecto es
// abrir una conexión a Postgres, que es justo lo que hace falta para que
// Supabase no dé el proyecto por inactivo y lo pause.
//
// Tiene que TOCAR LA BASE. Un ping que sólo despierte a Vercel dejaría dormir
// a Supabase, que es el que se pausa.
app.get('/api/salud', async (req, res) => {
  try {
    await consultar('SELECT 1');
    res.json({ ok: true });
  } catch (err) {
    console.error('[salud]', err.message);
    res.status(503).json({ ok: false });
  }
});

// 7. Estáticos. Ya detrás del guardia: a partir de aquí, todo lo que sirva este
//    middleware lo pide alguien con sesión (o está en la lista pública).
//
//    `setHeaders` corrige algo que se descubrió probándolo con curl: el
//    `Cache-Control: no-store` que puso el middleware 1 lo PISA `express.static`
//    con su propio `public, max-age=0`, porque escribe la cabecera después. Sin
//    esto, el botón "atrás" del navegador puede repintar el inventario entero
//    desde la caché después de cerrar sesión. Las hojas de estilo y los scripts
//    conservan su caché normal: ahí no hay nada privado.
app.use(
  express.static('public', {
    setHeaders: (res, rutaArchivo) => {
      if (rutaArchivo.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
    },
  })
);

function exigirSuperadmin(req, res, next) {
  if (req.cuenta?.rol !== 'superadmin') {
    return res.status(403).json({ error: 'Esta acción es sólo para el superadministrador.' });
  }
  next();
}

// ---------------------------------------------------------------------------
// Pantallas
// ---------------------------------------------------------------------------

// `sendFile` también escribe su propio Cache-Control, así que estas dos rutas
// repiten el no-store por la misma razón que `express.static` de arriba.
function enviarPantalla(res, archivo) {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'html', archivo));
}

app.get('/login', (req, res) => {
  // Con sesión abierta, la pantalla de login no tiene nada que ofrecer.
  if (req.cuenta) return res.redirect(302, '/');
  enviarPantalla(res, 'login.html');
});

app.get('/', (req, res) => {
  enviarPantalla(res, 'index.html');
});

// ---------------------------------------------------------------------------
// Rutas de sesión
// ---------------------------------------------------------------------------

async function abrirSesion(cuenta, req, res) {
  const token = auth.nuevoToken();

  try {
    await consultar(
      `INSERT INTO sesiones (hash_token, id_cuenta, creada_en, vista_en, expira_en, ip, agente)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        auth.hashToken(token),
        cuenta.id_cuenta,
        ahora(),
        ahora(),
        enHoras(HORAS_SESION),
        ipDe(req),
        String(req.headers['user-agent'] || '').slice(0, 200),
      ]
    );
  } catch (err) {
    console.error('[login] no se pudo abrir la sesión:', err.message);
    return res.status(500).json({ error: 'No se pudo abrir la sesión.' });
  }

  registrarAcceso(cuenta.usuario, 'ok', req);
  res.cookie(NOMBRE_COOKIE, token, opcionesCookie());
  res.json({ usuario: cuenta.usuario, rol: cuenta.rol });
}

// Mensaje ÚNICO para "no existe" y para "contraseña incorrecta". Distinguirlos
// sería decirle a quien prueba qué nombres de usuario existen, que es la mitad
// del trabajo hecho.
const CREDENCIALES_MALAS = 'Usuario o contraseña incorrectos.';

app.post('/api/auth/login', async (req, res) => {
  const usuario = typeof req.body?.usuario === 'string' ? req.body.usuario.trim() : '';
  const clave = typeof req.body?.clave === 'string' ? req.body.clave : '';

  if (!usuario || !clave) {
    return res.status(400).json({ error: 'Escribe usuario y contraseña.' });
  }

  const claves = clavesDeIntento(req, usuario);
  const restante = await bloqueoRestante(claves);
  if (restante > 0) {
    registrarAcceso(usuario, 'bloqueado', req);
    res.setHeader('Retry-After', String(Math.ceil(restante / 1000)));
    return res.status(429).json({
      error: `Demasiados intentos fallidos. Espera ${Math.ceil(restante / 1000)} segundos.`,
      espera_segundos: Math.ceil(restante / 1000),
    });
  }

  try {
    // `lower(usuario) = lower($1)` sustituye al `COLLATE NOCASE` de SQLite, que
    // en Postgres no existe. El índice único de `db/esquema.sql` está sobre
    // `lower(usuario)`, así que ésta es la consulta que lo aprovecha — y sin
    // ella "Erick" y "erick" dejarían de ser la misma persona.
    const { rows } = await consultar(
      `SELECT id_cuenta, usuario, hash, rol
       FROM cuentas WHERE lower(usuario) = lower($1) AND activa = 1`,
      [usuario]
    );
    const cuenta = rows[0];

    // Si la cuenta no existe se verifica igualmente contra un hash señuelo.
    // Sin esto, el usuario inexistente respondería en un milisegundo y el
    // existente en doscientos: cronómetro en mano, eso enumera las cuentas.
    const hash = cuenta ? cuenta.hash : await auth.hashSeñuelo();
    const correcta = await auth.verificar(clave, hash);

    if (!cuenta || !correcta) {
      await anotarFallo(claves);
      registrarAcceso(usuario, 'clave', req);
      return res.status(401).json({ error: CREDENCIALES_MALAS });
    }

    await limpiarFallos(claves);

    await abrirSesion(cuenta, req, res);
  } catch (err) {
    console.error('[login]', err.message);
    res.status(500).json({ error: 'Error interno.' });
  }
});

app.post('/api/auth/salir', async (req, res) => {
  // El borrado se intenta y no se comprueba: la versión SQLite ignoraba el
  // error del callback igual, porque salir no puede fallar de cara al usuario —
  // la cookie se limpia pase lo que pase.
  try {
    await consultar('DELETE FROM sesiones WHERE id_sesion = $1', [req.idSesion]);
  } catch (err) {
    console.error('[salir] no se pudo borrar la sesión:', err.message);
  }

  registrarAcceso(req.cuenta.usuario, 'salida', req);
  res.clearCookie(NOMBRE_COOKIE, { ...opcionesCookie(), maxAge: undefined });
  res.json({ mensaje: 'Sesión cerrada.' });
});

// Lo que necesita el frontend para pintar la barra y esconder lo que esta
// cuenta no puede hacer. Ese ocultamiento es cosmético: la frontera de verdad
// está en `exigirSuperadmin`, aquí abajo, y así lo comprueban los tests.
app.get('/api/auth/yo', (req, res) => {
  res.json({ usuario: req.cuenta.usuario, rol: req.cuenta.rol });
});

// ---------------------------------------------------------------------------
// Administración de cuentas (sólo superadmin)
// ---------------------------------------------------------------------------

app.get('/api/cuentas', exigirSuperadmin, async (req, res) => {
  // El hash no sale de aquí ni para el superadmin: no le sirve de nada y sí le
  // sirve a quien consiga mirar la pantalla.
  try {
    const { rows } = await consultar(
      `SELECT id_cuenta, usuario, rol, creada_en, activa
       FROM cuentas ORDER BY id_cuenta`
    );
    res.json(rows.map((f) => ({ ...f, activa: f.activa === 1 })));
  } catch (err) {
    console.error('[cuentas]', err.message);
    res.status(500).json({ error: 'Error interno.' });
  }
});

app.patch('/api/cuentas/:id/activa', exigirSuperadmin, async (req, res) => {
  // `Number('abc')` da NaN, que colado en `WHERE id_cuenta = $2` no casaba con
  // nada en SQLite (0 filas, 404) pero en Postgres es un 22P02 al intentar
  // convertirlo a entero: 500 donde antes había 404. Se valida aquí en vez de
  // reutilizar `idProductoValido` porque esto no es un producto — mismo
  // criterio (entero positivo o rechazo), función propia para no mezclar los
  // dos dominios.
  const texto = String(req.params.id).trim();
  const id = /^\d+$/.test(texto) ? Number(texto) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(404).json({ error: 'Cuenta no encontrada.' });
  }
  const activa = req.body?.activa ? 1 : 0;

  // Quedarse sin ningún superadmin activo dejaría la gestión de cuentas cerrada
  // por dentro, sin forma de volver a abrirla desde la web.
  if (!activa && id === req.cuenta.id_cuenta) {
    return res.status(409).json({ error: 'No puedes desactivar tu propia cuenta.' });
  }

  try {
    const { rowCount } = await consultar('UPDATE cuentas SET activa = $1 WHERE id_cuenta = $2', [
      activa,
      id,
    ]);
    if (rowCount === 0) return res.status(404).json({ error: 'Cuenta no encontrada.' });

    // Desactivar sin cerrar sus sesiones no serviría de nada durante las
    // próximas doce horas. Se espera al borrado: responder antes dejaría un
    // hueco en el que la cuenta ya desactivada sigue entrando.
    if (!activa) await consultar('DELETE FROM sesiones WHERE id_cuenta = $1', [id]);
    res.json({ mensaje: 'Cuenta actualizada.' });
  } catch (err) {
    console.error('[cuentas/activa]', err.message);
    res.status(500).json({ error: 'Error interno.' });
  }
});

app.get('/api/accesos', exigirSuperadmin, async (req, res) => {
  try {
    const { rows } = await consultar('SELECT * FROM accesos ORDER BY id_acceso DESC LIMIT 200');
    res.json(rows);
  } catch (err) {
    console.error('[accesos]', err.message);
    res.status(500).json({ error: 'Error interno.' });
  }
});

// API Read
app.get('/api/productos', async (req, res) => {
  const { activo } = req.query;

  // `a.nombre AS area` va aliasado por el mismo motivo que `nombre_actual` en
  // SQL_LINEAS_DE_ORDEN: `p.*` ya trae una columna `nombre` y pg devuelve la
  // fila como objeto plano, así que sin el alias la segunda la sobreescribiría.
  let sql = `
    SELECT p.*, a.nombre AS area
    FROM productos p
    LEFT JOIN areas a ON p.id_area = a.id_area
  `;
  const params = [];

  if (activo !== undefined) {
    // El valor llega como texto de la query string (o como array si `activo`
    // se repite: Express junta `?activo=1&activo=2` en ['1','2']). En SQLite,
    // `activo = 'abc'` o `activo = '1,2'` simplemente no casaban con ninguna
    // fila y la respuesta era 200 []. Postgres es estricto: el ::int de abajo
    // lanzaría 22P02 con cualquiera de esos valores, convirtiendo un 200 []
    // en un 500. Se valida ANTES de tocar la base para conservar la respuesta
    // de siempre en vez de sumar un código de estado nuevo.
    const texto = Array.isArray(activo) ? String(activo) : activo;
    if (!/^\d+$/.test(texto)) return res.json([]);

    sql += ' WHERE p.activo = $1::int';
    params.push(Number(texto));
  }

  try {
    const { rows } = await consultar(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('[productos]', err.message);
    res.status(500).json({ error: 'Error interno.' });
  }
});
// En SQLite, `WHERE id_producto = 'abc'` no casaba con nada y la ruta acababa
// en 404 por la vía del SQL. Postgres es estricto con los tipos y ese mismo
// caso sería un error de conversión: un 500 donde antes había un 404 — para
// quien lo recibe, "algo se rompió" en vez de "ese producto no está". Esto
// conserva la respuesta de siempre sin añadir un código de estado nuevo.
function idProductoValido(valor) {
  const texto = String(valor).trim();
  if (!/^\d+$/.test(texto)) return null;
  const id = Number(texto);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

const NO_ENCONTRADO = { error: 'Producto no encontrado' };

 //API Read ID
app.get('/api/productos/:id', async (req, res) => {
  const id = idProductoValido(req.params.id);
  if (id === null) return res.status(404).json(NO_ENCONTRADO);

  try {
    const { rows } = await consultar('SELECT * FROM productos WHERE id_producto = $1', [id]);
    if (!rows[0]) return res.status(404).json(NO_ENCONTRADO);
    res.json(rows[0]);
  } catch (err) {
    console.error('[productos/:id]', err.message);
    res.status(500).json({ error: 'Error interno.' });
  }
});

// Valida los campos comunes de POST/PUT. Devuelve un mensaje de error o null.
function validarProducto({ nombre, cantidad }) {
  if (!nombre) {
    return 'El nombre del producto es obligatorio.';
  }
  // `Number.isInteger` es la parte nueva: una `cantidad` como 1.5 pasaba este
  // chequeo y llegaba a una columna `INTEGER` de Postgres, que la rechaza con
  // 22P02 — 500 donde correspondía 400. SQLite, sin tipos estrictos, la habría
  // aceptado y truncado en silencio, que tampoco es lo que se quiere; ahora se
  // rechaza explícitamente en los dos motores.
  if (
    cantidad !== undefined &&
    (typeof cantidad !== 'number' || !Number.isInteger(cantidad) || cantidad < 0)
  ) {
    return 'La cantidad debe ser un entero mayor o igual a cero.';
  }
  return null;
}

// API Create
app.post('/api/productos', async (req, res) => {
  const { nombre, marca, descripcion, cantidad, id_area } = req.body;

  const errorValidacion = validarProducto(req.body);
  if (errorValidacion) {
    return res.status(400).json({ error: errorValidacion });
  }

  // `RETURNING id_producto` sustituye al `this.lastID` de sqlite3: es la misma
  // información, pero de la propia sentencia y no de un estado colgado del
  // handler — de ahí que ya no haga falta `function` en vez de arrow.
  const sql = `INSERT INTO productos (nombre, marca, descripcion, cantidad, activo, id_area)
               VALUES ($1, $2, $3, $4, 1, $5) RETURNING id_producto`;

  try {
    const { rows } = await consultar(sql, [
      nombre,
      marca ?? null,
      descripcion ?? null,
      cantidad ?? 0,
      id_area ?? null,
    ]);

    res.status(201).json({
      mensaje: 'Producto creado exitosamente',
      id: rows[0].id_producto,
      nombre,
      marca,
      descripcion,
      cantidad: cantidad ?? 0,
      id_area: id_area ?? null,
    });
  } catch (err) {
    // 23503 es foreign_key_violation: un `id_area` que no existe. SQLite no
    // aplicaba la FK (server.js la documenta como "decorativa" en el esquema
    // viejo) así que esto colaba y dejaba el producto huérfano; Postgres sí la
    // aplica y lo rechaza. Se traduce a 400 en vez de dejar que suba como 500,
    // igual que el 23505 de la devolución.
    if (err.code === '23503') {
      return res.status(400).json({ error: 'El área indicada no existe.' });
    }
    console.error('[productos:alta]', err.message);
    res.status(500).json({ error: 'Error interno.' });
  }
});

// API Update
app.put('/api/productos/:id', async (req, res) => {
  const id = idProductoValido(req.params.id);
  const { nombre, marca, descripcion, cantidad, id_area } = req.body;

  const errorValidacion = validarProducto(req.body);
  if (errorValidacion) {
    return res.status(400).json({ error: errorValidacion });
  }

  if (id === null) return res.status(404).json(NO_ENCONTRADO);

  const sql = `UPDATE productos
               SET nombre = $1, marca = $2, descripcion = $3, cantidad = $4, id_area = $5
               WHERE id_producto = $6`;

  try {
    // `rowCount` sustituye a `this.changes`: un UPDATE que no encuentra su fila
    // no da error, da cero cambios — y eso es lo que aquí significa 404.
    const { rowCount } = await consultar(sql, [
      nombre,
      marca ?? null,
      descripcion ?? null,
      cantidad ?? 0,
      id_area ?? null,
      id,
    ]);
    if (rowCount === 0) return res.status(404).json(NO_ENCONTRADO);

    res.json({ mensaje: 'Producto reemplazado correctamente' });
  } catch (err) {
    // Mismo 23503 que en el alta: un `id_area` inexistente.
    if (err.code === '23503') {
      return res.status(400).json({ error: 'El área indicada no existe.' });
    }
    console.error('[productos:edicion]', err.message);
    res.status(500).json({ error: 'Error interno.' });
  }
});

// API Activar/Desactivar
app.patch('/api/productos/:id/activo', async (req, res) => {
  const id = idProductoValido(req.params.id);
  if (id === null) return res.status(404).json(NO_ENCONTRADO);

  const { activo } = req.body;

  try {
    const { rowCount } = await consultar('UPDATE productos SET activo = $1 WHERE id_producto = $2', [
      activo ? 1 : 0,
      id,
    ]);
    if (rowCount === 0) return res.status(404).json(NO_ENCONTRADO);

    res.json({ mensaje: 'Estado actualizado correctamente' });
  } catch (err) {
    console.error('[productos:activo]', err.message);
    res.status(500).json({ error: 'Error interno.' });
  }
});

// API Areas
app.get('/api/areas', async (req, res) => {
  try {
    const { rows } = await consultar('SELECT * FROM areas');
    res.json(rows);
  } catch (err) {
    console.error('[areas]', err.message);
    res.status(500).json({ error: 'Error interno.' });
  }
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
app.post('/api/ordenes', async (req, res) => {
  const { lineas } = req.body;

  if (!Array.isArray(lineas) || lineas.length === 0) {
    return res.status(400).json({ error: 'La orden debe incluir al menos una línea.' });
  }

  for (const linea of lineas) {
    const { id_producto, cantidad } = linea || {};
    if (
      typeof id_producto !== 'number' ||
      !Number.isInteger(id_producto) ||
      id_producto <= 0 ||
      typeof cantidad !== 'number' ||
      !Number.isInteger(cantidad) ||
      cantidad <= 0
    ) {
      // `id_producto` entero es obligatorio: sin este chequeo, un
      // `{ id_producto: 1.5 }` llegaba hasta `ANY($1::int[])` dentro de la
      // transacción, Postgres lo rechazaba con 22P02 (invalid_text_representation
      // para un cast de int) y el catch genérico respondía 500 — donde SQLite,
      // sin tipos estrictos, simplemente no encontraba el producto y daba 409.
      return res.status(400).json({
        error: 'Cada línea debe tener un id_producto entero positivo y una cantidad entera positiva.',
      });
    }
  }

  const evento = normalizarTexto(req.body.evento);
  const responsable = normalizarTexto(req.body.responsable);
  if (evento === undefined || responsable === undefined) {
    return res.status(400).json({
      error: `Evento y responsable deben ser texto de hasta ${LARGO_MAXIMO_TEXTO} caracteres.`,
    });
  }

  try {
    const ids = [...new Set(lineas.map((l) => l.id_producto))];

    const resultado = await enTransaccion(async (cliente) => {
      // Relee las cantidades: nunca confiar en lo que manda el navegador. El
      // nombre también sale de aquí y no del cliente, porque se copia al
      // registro histórico.
      //
      // FOR UPDATE no es un lujo, lo obliga el pool: antes había UNA conexión y
      // SQLite serializaba, así que la carrera entre comprobar el stock y
      // descontarlo casi no se veía. Con N clientes concurrentes sí se ve —dos
      // órdenes pasan las dos la comprobación y descuentan las dos— y la
      // cantidad queda en negativo. Esto sustituye a la serialización perdida.
      //
      // El ORDER BY dentro del FOR UPDATE evita el interbloqueo entre dos
      // órdenes que pidan los mismos productos en distinto orden: si las dos
      // toman los candados siempre en el mismo sentido, no pueden esperarse la
      // una a la otra en círculo.
      const { rows: filas } = await cliente.query(
        `SELECT id_producto, nombre, cantidad FROM productos
         WHERE id_producto = ANY($1::int[])
         ORDER BY id_producto
         FOR UPDATE`,
        [ids]
      );

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
        if (!fila || pedido > disponible) faltantes.push({ id_producto, pedido, disponible });
      }

      // Lanzar es lo que dispara el ROLLBACK. Se marca para distinguirlo de un
      // fallo de verdad al salir.
      if (faltantes.length > 0) {
        const corte = new Error('faltantes');
        corte.faltantes = faltantes;
        throw corte;
      }

      // Cabecera primero: sus líneas necesitan el id que genera este INSERT.
      // `RETURNING` sustituye al `this.lastID` de sqlite3.
      const { rows: cabecera } = await cliente.query(
        'INSERT INTO ordenes (creada_en, evento, responsable) VALUES ($1, $2, $3) RETURNING id_orden',
        [new Date().toISOString(), evento, responsable]
      );
      const idOrden = cabecera[0].id_orden;

      // Dos sentencias fijas, no dos por producto. Antes esto era un bucle con
      // `await` dentro —la línea del registro y el descuento, uno detrás de
      // otro—, o sea `2N+3` viajes en serie: contra un pooler remoto, y con el
      // techo de 10 s de `maxDuration` de Vercel, una orden larga se acercaba
      // al borde por pura latencia acumulada, no por trabajo real.
      //
      // `unnest` deshace los tres arrays en columnas paralelas, así que una
      // sola sentencia escribe las N líneas y otra aplica los N descuentos.
      // Los tres arrays se construyen del MISMO recorrido de claves, que es
      // lo que garantiza que la fila i de cada uno habla del mismo producto.
      const idsPedidos = [...pedidoPorId.keys()];
      const cantidades = idsPedidos.map((id) => pedidoPorId.get(id));
      const nombres = idsPedidos.map((id) => productoPorId.get(id).nombre);

      await cliente.query(
        `INSERT INTO orden_lineas (id_orden, id_producto, nombre, cantidad)
         SELECT $1, p.id, p.nombre, p.cantidad
         FROM unnest($2::int[], $3::text[], $4::int[]) AS p(id, nombre, cantidad)`,
        [idOrden, idsPedidos, nombres, cantidades]
      );

      // `productos.cantidad` va cualificado a propósito: sin el prefijo,
      // `cantidad` es ambigua entre la tabla y la columna que trae el unnest.
      await cliente.query(
        `UPDATE productos SET cantidad = productos.cantidad - d.baja
         FROM unnest($1::int[], $2::int[]) AS d(id, baja)
         WHERE productos.id_producto = d.id`,
        [idsPedidos, cantidades]
      );

      return idOrden;
    });

    res.json({ mensaje: 'Orden aplicada correctamente', id_orden: resultado });
  } catch (err) {
    if (err.faltantes) return res.status(409).json({ faltantes: err.faltantes });
    console.error('[ordenes]', err.message);
    res.status(500).json({ error: 'No se pudo aplicar la orden.' });
  }
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

// `nombre_actual` y `activo_actual` van ALIASADOS y no como `p.nombre`: pg
// devuelve cada fila como objeto plano —igual que sqlite3—, así que una segunda
// columna `nombre` sobreescribiría en silencio la de `orden_lineas`, que es
// justo el nombre histórico que se duplica a propósito para que la orden de
// marzo siga diciendo qué salió aunque el producto se haya renombrado después.
const SQL_LINEAS_DE_ORDEN = `
  SELECT ol.id_producto,
         ol.nombre,
         ol.cantidad,
         p.nombre AS nombre_actual,
         p.activo AS activo_actual,
         -- El ::int NO es cosmético. En SQLite esta expresión daba 1 o 0 y el
         -- código de abajo compara con === 1. En Postgres daría true/false, con
         -- lo que toda línea parecería huérfana y la devolución no repondría
         -- nada — mintiendo con un 200.
         (p.id_producto IS NOT NULL)::int AS existe
  FROM orden_lineas ol
  LEFT JOIN productos p ON p.id_producto = ol.id_producto
  WHERE ol.id_orden = $1
  ORDER BY ol.id_producto
`;

// API Ordenes: lectura de una orden ya emitida. Es lo que la pantalla de
// devolución necesita para mostrar qué salió antes de reponerlo.
app.get('/api/ordenes/:id', async (req, res) => {
  const idOrden = idOrdenValido(req.params.id);
  if (idOrden === null) {
    return res.status(400).json({ error: 'El número de orden debe ser un entero positivo.' });
  }

  try {
    const orden = (await consultar('SELECT * FROM ordenes WHERE id_orden = $1', [idOrden])).rows[0];
    if (!orden) return res.status(404).json({ error: `No existe la orden ${idOrden}.` });

    const devolucion = (
      await consultar('SELECT recibida_en, recibida_por FROM devoluciones WHERE id_orden = $1', [
        idOrden,
      ])
    ).rows[0];

    const { rows: filas } = await consultar(SQL_LINEAS_DE_ORDEN, [idOrden]);

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
  } catch (err) {
    console.error('[ordenes:lectura]', err.message);
    res.status(500).json({ error: 'Error interno.' });
  }
});

// API Devoluciones: repone al stock todo lo que salió en una orden y deja
// constancia de cuándo volvió. Es el SEGUNDO camino que escribe existencias, y
// el espejo de POST /api/ordenes: la salida descuenta, esto suma.
//
// Las tres comprobaciones previas son LECTURAS Y VAN DENTRO DE LA TRANSACCIÓN,
// igual que en POST /api/ordenes. Antes vivían fuera, y el comentario de este
// archivo explicaba por qué: con UNA conexión de módulo, BEGIN/COMMIT eran de
// conexión y no de petición, así que nuestro ROLLBACK —que aquí es el camino
// NORMAL, teclear mal un número— se llevaba por delante lo que el CRUD
// estuviera guardando a la vez. Con un cliente dedicado del pool eso ya no
// puede pasar: cada petición tiene su propia conexión y su propia transacción.
app.post('/api/ordenes/:id/devolucion', async (req, res) => {
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

  try {
    const resultado = await enTransaccion(async (cliente) => {
      const { rows: ordenes } = await cliente.query(
        'SELECT id_orden FROM ordenes WHERE id_orden = $1',
        [idOrden]
      );
      if (ordenes.length === 0) {
        const corte = new Error('no existe');
        corte.estado = 404;
        corte.cuerpo = { error: `No existe la orden ${idOrden}.` };
        throw corte;
      }

      const { rows: yaDevuelta } = await cliente.query(
        'SELECT recibida_en, recibida_por FROM devoluciones WHERE id_orden = $1',
        [idOrden]
      );
      if (yaDevuelta.length > 0) {
        const corte = new Error('ya devuelta');
        corte.estado = 409;
        corte.cuerpo = {
          error: `La orden ${idOrden} ya se recibió; devolverla otra vez inflaría el inventario.`,
          devolucion: yaDevuelta[0],
        };
        throw corte;
      }

      const { rows: filas } = await cliente.query(SQL_LINEAS_DE_ORDEN, [idOrden]);
      if (filas.length === 0) {
        const corte = new Error('sin lineas');
        corte.estado = 409;
        corte.cuerpo = { error: `La orden ${idOrden} no tiene líneas que devolver.` };
        throw corte;
      }

      const describir = (f) => ({
        id_producto: f.id_producto,
        nombre: f.nombre,
        cantidad: f.cantidad,
        activo: f.existe === 1 && f.activo_actual === 1,
      });
      const porProducto = (a, b) => a.id_producto - b.id_producto;

      try {
        await cliente.query(
          'INSERT INTO devoluciones (id_orden, recibida_en, recibida_por) VALUES ($1, $2, $3)',
          [idOrden, new Date().toISOString(), recibidaPor]
        );
      } catch (errInsertar) {
        // El UNIQUE de la 003 es la red que cubre el hueco entre el SELECT de
        // arriba y este INSERT: dos pestañas pulsando a la vez llegan las dos
        // hasta aquí y sólo una puede escribir. 23505 es unique_violation.
        if (errInsertar.code === '23505') {
          const corte = new Error('carrera');
          corte.estado = 409;
          corte.cuerpo = {
            error: `La orden ${idOrden} ya se recibió; devolverla otra vez inflaría el inventario.`,
          };
          throw corte;
        }
        throw errInsertar;
      }

      const devueltas = [];
      const omitidas = filas.filter((f) => f.existe !== 1).map(describir);

      // Con `await` dentro del bucle desaparece el contador de pendientes de la
      // versión con callbacks, y con él la trampa de las cero líneas
      // reponibles: sin nada que iterar, el bucle simplemente no corre y la
      // transacción confirma sola.
      for (const f of filas.filter((f) => f.existe === 1)) {
        // El resultado se decide con `rowCount`, NO con el snapshot: un UPDATE
        // que no encuentra su fila no da error, da cero cambios. Si el
        // producto se borró entre el SELECT de arriba y este UPDATE, decir
        // "devuelta" desde el snapshot sería mentir con un 200.
        const { rowCount } = await cliente.query(
          'UPDATE productos SET cantidad = cantidad + $1 WHERE id_producto = $2',
          [f.cantidad, f.id_producto]
        );
        if (rowCount === 0) omitidas.push(describir(f));
        else devueltas.push(describir(f));
      }

      return {
        mensaje: 'Devolución aplicada correctamente',
        id_orden: idOrden,
        devueltas: devueltas.sort(porProducto),
        omitidas: omitidas.sort(porProducto),
      };
    });

    res.json(resultado);
  } catch (err) {
    if (err.estado) return res.status(err.estado).json(err.cuerpo);
    console.error('[devolucion]', err.message);
    res.status(500).json({ error: 'No se pudo aplicar la devolución.' });
  }
});

// API Delete
//
// La ÚNICA ruta del CRUD reservada al superadmin. El criterio no es "es
// peligrosa" sino "es irreversible": desactivar un producto se deshace con un
// clic, editarlo también, pero borrarlo se lleva por delante la fila y deja
// huérfanas sus `orden_lineas` — y con ellas la devolución de esa orden.
// Lo demás se lo queda el almacén, que es quien trabaja con esto todo el día.
app.delete('/api/productos/:id', exigirSuperadmin, async (req, res) => {
  const id = idProductoValido(req.params.id);
  if (id === null) return res.status(404).json(NO_ENCONTRADO);

  try {
    const { rowCount } = await consultar('DELETE FROM productos WHERE id_producto = $1', [id]);
    if (rowCount === 0) return res.status(404).json(NO_ENCONTRADO);

    res.json({ mensaje: 'Producto eliminado correctamente' });
  } catch (err) {
    console.error('[productos:borrado]', err.message);
    res.status(500).json({ error: 'Error interno.' });
  }
});
// ===========================================================================
// CIERRE: manejador de errores, arranque y exportación
// ===========================================================================

// El manejador de errores va AL FINAL, después de todas las rutas. Antes estaba
// declarado arriba, entre los middlewares, donde Express nunca llegaba a
// llamarlo: los manejadores de cuatro argumentos sólo atrapan lo que se lanza
// en algo registrado ANTES que ellos. Con lo cual quien se encargaba de verdad
// era el manejador por defecto de Express, que fuera de producción responde con
// la traza completa — rutas del disco y estructura interna incluidas.
app.use((err, req, res, next) => {
  console.error('❌ Error en el servidor:', err.message);

  // El detalle va al log del servidor, no al navegador. Un mensaje de error es
  // información gratis para quien está tanteando.
  if (res.headersSent) return next(err);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
  res.status(500).send('Error interno del servidor');
});

// Aviso, no bloqueo: en Vercel el módulo se IMPORTA, nunca se ejecuta con
// `node server.js`, así que todo lo que viviera dentro de
// `require.main === module` allí no corre nunca — y la comprobación de "no hay
// cuentas" es justo lo que hace falta saber en un despliegue nuevo. Por eso
// sale del guardia y corre siempre que se carga el módulo.
consultar('SELECT count(*)::int AS total FROM cuentas WHERE activa = 1')
  .then(({ rows }) => {
    if (rows[0].total === 0) {
      console.error('❌ No hay ninguna cuenta activa. Crea una con:');
      // Con --env-file=.env: sin él, cuenta.js no tiene DATABASE_URL y falla
      // justo en el despliegue nuevo que este aviso existe para cubrir.
      console.error('   node --env-file=.env scripts/cuenta.js crear <usuario> --rol superadmin');
      // El `process.exit(1)` se queda sólo en el camino de `node server.js`:
      // al importarse (tests, Vercel) matar el proceso se llevaría por delante
      // a quien hizo el `require`, así que ahí sólo se avisa fuerte.
      if (EN_PRODUCCION && require.main === module) process.exit(1);
    }
  })
  .catch((err) => console.error('[arranque] no se pudo comprobar las cuentas:', err.message));

// Arranca sólo al ejecutar `node server.js`. Al importarse (tests) se exporta
// la app sin abrir puerto.
if (require.main === module) {
  app.listen(port, () => {
    console.log(`Servidor Express corriendo en http://localhost:${port}`);
  });
}

// Expuestas para los tests: `pool` para cerrarlo en el teardown y
// `reiniciarLimites` para que un test no herede el castigo por intentos
// fallidos del anterior.
app.locals.pool = pool;
app.locals.reiniciarLimites = reiniciarLimites;
module.exports = app;
