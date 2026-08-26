const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const auth = require('./auth.js');

// `cors` estaba aquí y se quitó a propósito. Respondía
// `Access-Control-Allow-Origin: *` a cualquier origen de internet, y desde que
// hay cookies de sesión eso es contradecir la misma política de origen que nos
// protege. El frontend se sirve del mismo origen que la API, así que nunca
// necesitó CORS para nada.

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

// `db/inventario.db3` está versionado con la 001 aplicada pero sin las
// migraciones siguientes, así que recién clonado no tiene estas tablas y
// POST /api/ordenes responde 500 (`no such table: ordenes`). Crearlas al
// arrancar es idempotente y deja la app usable sin correr el runner a mano.
//
// Se encola aquí, antes de declarar cualquier ruta, para que sqlite3 lo
// procese en esta conexión antes de la primera consulta de una petición.
// El DDL debe seguir igual al de db/migrations/002-registro-de-ordenes.sql,
// 003-devoluciones.sql y 004-cuentas.sql — son las mismas definiciones escritas
// dos veces, y si cambia una tiene que cambiar la otra.
//
// De la 004 se replican los CREATE pero NO sus dos DROP: aquí solo se asegura
// lo que debe existir. Borrar `usuarios` es cosa de la migración, que se corre
// una vez y con copia de seguridad delante.
//
// Este bloque es también la razón por la que la 003 y la 004 añaden tablas en
// vez de columnas: `CREATE TABLE IF NOT EXISTS` no añade columnas a una tabla
// que ya existe, y `ALTER TABLE ... ADD COLUMN` no admite `IF NOT EXISTS` en
// SQLite, así que no hay forma idempotente de asegurarlas desde aquí.
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
     );

     CREATE TABLE IF NOT EXISTS cuentas (
       id_cuenta        INTEGER PRIMARY KEY AUTOINCREMENT,
       usuario          TEXT NOT NULL UNIQUE COLLATE NOCASE,
       hash             TEXT NOT NULL,
       rol              TEXT NOT NULL CHECK (rol IN ('admin', 'superadmin')),
       totp_secreto     TEXT,
       totp_ultimo_paso INTEGER,
       creada_en        TEXT NOT NULL,
       activa           INTEGER NOT NULL DEFAULT 1
     );

     CREATE TABLE IF NOT EXISTS sesiones (
       id_sesion  INTEGER PRIMARY KEY AUTOINCREMENT,
       hash_token TEXT NOT NULL UNIQUE,
       id_cuenta  INTEGER NOT NULL REFERENCES cuentas(id_cuenta),
       creada_en  TEXT NOT NULL,
       vista_en   TEXT NOT NULL,
       expira_en  TEXT NOT NULL,
       ip         TEXT,
       agente     TEXT
     );

     CREATE INDEX IF NOT EXISTS idx_sesiones_cuenta ON sesiones(id_cuenta);

     CREATE TABLE IF NOT EXISTS codigos_respaldo (
       id_codigo INTEGER PRIMARY KEY AUTOINCREMENT,
       id_cuenta INTEGER NOT NULL REFERENCES cuentas(id_cuenta),
       hash      TEXT NOT NULL,
       usado_en  TEXT
     );

     CREATE INDEX IF NOT EXISTS idx_codigos_respaldo_cuenta ON codigos_respaldo(id_cuenta);

     CREATE TABLE IF NOT EXISTS accesos (
       id_acceso   INTEGER PRIMARY KEY AUTOINCREMENT,
       ocurrido_en TEXT NOT NULL,
       usuario     TEXT,
       resultado   TEXT NOT NULL,
       ip          TEXT
     );

     CREATE INDEX IF NOT EXISTS idx_accesos_fecha ON accesos(ocurrido_en);`,
    (errEsquema) => {
      if (errEsquema) {
        console.error('❌ Error al asegurar las tablas:', errEsquema.message);
      }
    }
  );
});

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
const MINUTOS_RETO_TOTP = 5;

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
  db.run(
    'INSERT INTO accesos (ocurrido_en, usuario, resultado, ip) VALUES (?, ?, ?, ?)',
    [ahora(), usuario ?? null, resultado, ipDe(req)],
    (err) => {
      if (err) console.error('❌ No se pudo registrar el acceso:', err.message);
    }
  );
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
// Se cuenta por IP y por usuario a la vez: sólo por IP, una botnet reparte los
// intentos entre mil direcciones; sólo por usuario, se prueban mil usuarios
// distintos desde la misma máquina.
//
// Vive en memoria y se pierde al reiniciar. Es aceptable: quien ataca no decide
// cuándo reiniciamos, y la alternativa —escribir en la base en cada intento
// fallido— convierte el propio login en un modo de castigar al disco.
const intentos = new Map();
const FALLOS_DE_GRACIA = 3;
const ESPERA_MAXIMA_MS = 15 * 60 * 1000;

function esperaTras(fallos) {
  if (fallos <= FALLOS_DE_GRACIA) return 0;
  return Math.min(2 ** (fallos - FALLOS_DE_GRACIA) * 1000, ESPERA_MAXIMA_MS);
}

// Devuelve los milisegundos que faltan, o 0 si puede pasar.
function bloqueoRestante(claves) {
  let restante = 0;
  for (const clave of claves) {
    const registro = intentos.get(clave);
    if (registro) restante = Math.max(restante, registro.hasta - Date.now());
  }
  return Math.max(0, restante);
}

function anotarFallo(claves) {
  for (const clave of claves) {
    const registro = intentos.get(clave) || { fallos: 0, hasta: 0 };
    registro.fallos += 1;
    registro.hasta = Date.now() + esperaTras(registro.fallos);
    intentos.set(clave, registro);
  }
}

function limpiarFallos(claves) {
  for (const clave of claves) intentos.delete(clave);
}

// Sólo para los tests: cada uno necesita empezar sin el castigo del anterior.
function reiniciarLimites() {
  intentos.clear();
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
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();

  const origen = req.headers.origin;
  if (!origen) return next();

  const protocolo = TRAS_PROXY ? req.headers['x-forwarded-proto'] || req.protocol : req.protocol;
  const propio = process.env.ORIGEN_PERMITIDO || `${protocolo}://${req.headers.host}`;

  if (origen !== propio) {
    return res.status(403).json({ error: 'Petición rechazada: origen no permitido.' });
  }
  next();
});

// 5. Resolución de la sesión. Deja `req.cuenta` puesto o no, pero no bloquea a
//    nadie: de decidir se encarga el guardia siguiente.
app.use((req, res, next) => {
  const token = leerCookie(req, NOMBRE_COOKIE);
  if (!token) return next();

  db.get(
    `SELECT s.id_sesion, s.vista_en, s.expira_en,
            c.id_cuenta, c.usuario, c.rol, c.activa
     FROM sesiones s
     JOIN cuentas c ON c.id_cuenta = s.id_cuenta
     WHERE s.hash_token = ?`,
    [auth.hashToken(token)],
    (err, fila) => {
      // Un fallo de base no puede convertirse en "adelante, pase": ante la
      // duda, sin sesión.
      if (err || !fila) return next();

      const instante = Date.now();
      const vencida = Date.parse(fila.expira_en) <= instante;
      const dormida = Date.parse(fila.vista_en) + HORAS_INACTIVIDAD * 3600 * 1000 <= instante;

      if (vencida || dormida || fila.activa !== 1) {
        // Se borra la fila en vez de dejarla: una sesión muerta que sigue en la
        // tabla es sólo material para que alguien la resucite si cambia el reloj.
        db.run('DELETE FROM sesiones WHERE id_sesion = ?', [fila.id_sesion]);
        res.clearCookie(NOMBRE_COOKIE, { ...opcionesCookie(), maxAge: undefined });
        return next();
      }

      req.cuenta = { id_cuenta: fila.id_cuenta, usuario: fila.usuario, rol: fila.rol };
      req.idSesion = fila.id_sesion;

      // `vista_en` se refresca como mucho una vez por minuto. Escribirlo en cada
      // petición convertiría cargar una pantalla —que dispara varias— en una
      // ráfaga de escrituras sobre la única conexión que tenemos.
      if (instante - Date.parse(fila.vista_en) > 60_000) {
        db.run('UPDATE sesiones SET vista_en = ? WHERE id_sesion = ?', [ahora(), fila.id_sesion]);
      }

      next();
    }
  );
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

// Retos de segundo factor pendientes: contraseña ya verificada, código todavía
// no. NO son una sesión y por eso no son una cookie — son un pagaré de cinco
// minutos que sólo sirve para canjearlo en /api/auth/totp.
const retos = new Map();

function purgarRetos() {
  const instante = Date.now();
  for (const [clave, reto] of retos) if (reto.expira <= instante) retos.delete(clave);
}

function abrirSesion(cuenta, req, res, respuesta) {
  const token = auth.nuevoToken();

  db.run(
    `INSERT INTO sesiones (hash_token, id_cuenta, creada_en, vista_en, expira_en, ip, agente)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      auth.hashToken(token),
      cuenta.id_cuenta,
      ahora(),
      ahora(),
      enHoras(HORAS_SESION),
      ipDe(req),
      String(req.headers['user-agent'] || '').slice(0, 200),
    ],
    (err) => {
      if (err) return res.status(500).json({ error: 'No se pudo abrir la sesión.' });

      registrarAcceso(cuenta.usuario, 'ok', req);
      res.cookie(NOMBRE_COOKIE, token, opcionesCookie());
      res.json({ usuario: cuenta.usuario, rol: cuenta.rol, ...respuesta });
    }
  );
}

// Mensaje ÚNICO para "no existe" y para "contraseña incorrecta". Distinguirlos
// sería decirle a quien prueba qué nombres de usuario existen, que es la mitad
// del trabajo hecho.
const CREDENCIALES_MALAS = 'Usuario o contraseña incorrectos.';

app.post('/api/auth/login', (req, res) => {
  const usuario = typeof req.body?.usuario === 'string' ? req.body.usuario.trim() : '';
  const clave = typeof req.body?.clave === 'string' ? req.body.clave : '';

  if (!usuario || !clave) {
    return res.status(400).json({ error: 'Escribe usuario y contraseña.' });
  }

  const claves = clavesDeIntento(req, usuario);
  const restante = bloqueoRestante(claves);
  if (restante > 0) {
    registrarAcceso(usuario, 'bloqueado', req);
    res.setHeader('Retry-After', String(Math.ceil(restante / 1000)));
    return res.status(429).json({
      error: `Demasiados intentos fallidos. Espera ${Math.ceil(restante / 1000)} segundos.`,
      espera_segundos: Math.ceil(restante / 1000),
    });
  }

  db.get(
    'SELECT id_cuenta, usuario, hash, rol, totp_secreto, totp_ultimo_paso FROM cuentas WHERE usuario = ? AND activa = 1',
    [usuario],
    async (err, cuenta) => {
      if (err) return res.status(500).json({ error: err.message });

      try {
        // Si la cuenta no existe se verifica igualmente contra un hash señuelo.
        // Sin esto, el usuario inexistente respondería en un milisegundo y el
        // existente en doscientos: cronómetro en mano, eso enumera las cuentas.
        const hash = cuenta ? cuenta.hash : await auth.hashSeñuelo();
        const correcta = await auth.verificar(clave, hash);

        if (!cuenta || !correcta) {
          anotarFallo(claves);
          registrarAcceso(usuario, 'clave', req);
          return res.status(401).json({ error: CREDENCIALES_MALAS });
        }

        limpiarFallos(claves);

        if (cuenta.totp_secreto) {
          purgarRetos();
          const reto = auth.nuevoToken();
          retos.set(reto, {
            id_cuenta: cuenta.id_cuenta,
            expira: Date.now() + MINUTOS_RETO_TOTP * 60 * 1000,
          });
          return res.json({ requiere_totp: true, reto });
        }

        abrirSesion(cuenta, req, res, {});
      } catch (errInterno) {
        res.status(500).json({ error: errInterno.message });
      }
    }
  );
});

// Segundo paso: canjea el reto por una sesión de verdad. Acepta tanto el código
// de seis dígitos de la app como uno de los códigos de respaldo en papel, en el
// mismo campo — quien ha perdido el móvil no está para elegir pestaña.
app.post('/api/auth/totp', (req, res) => {
  purgarRetos();

  const pendiente = retos.get(req.body?.reto);
  if (!pendiente) {
    return res.status(401).json({ error: 'La verificación caducó. Vuelve a iniciar sesión.' });
  }

  const codigo = String(req.body?.codigo ?? '').trim();
  const claves = clavesDeIntento(req, `reto:${pendiente.id_cuenta}`);
  const restante = bloqueoRestante(claves);
  if (restante > 0) {
    res.setHeader('Retry-After', String(Math.ceil(restante / 1000)));
    return res.status(429).json({
      error: `Demasiados intentos fallidos. Espera ${Math.ceil(restante / 1000)} segundos.`,
      espera_segundos: Math.ceil(restante / 1000),
    });
  }

  db.get(
    'SELECT id_cuenta, usuario, rol, totp_secreto, totp_ultimo_paso FROM cuentas WHERE id_cuenta = ? AND activa = 1',
    [pendiente.id_cuenta],
    (err, cuenta) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!cuenta) return res.status(401).json({ error: CREDENCIALES_MALAS });

      const veredicto = auth.verificarTotp(cuenta.totp_secreto, codigo, cuenta.totp_ultimo_paso);

      if (veredicto.ok) {
        // El reto se consume pase lo que pase después: un pagaré se cobra una vez.
        retos.delete(req.body.reto);
        limpiarFallos(claves);
        // Guardar el paso es lo que impide reutilizar el mismo código dentro de
        // sus 30 segundos de vida.
        db.run('UPDATE cuentas SET totp_ultimo_paso = ? WHERE id_cuenta = ?', [
          veredicto.paso,
          cuenta.id_cuenta,
        ]);
        return abrirSesion(cuenta, req, res, {});
      }

      canjearCodigoDeRespaldo(cuenta, codigo, req, res, () => {
        anotarFallo(claves);
        registrarAcceso(cuenta.usuario, 'totp', req);
        res.status(401).json({ error: 'Código incorrecto o ya utilizado.' });
      });
    }
  );
});

// Los códigos de respaldo son de un solo uso: se marcan gastados en el mismo
// momento en que sirven. Si no, el papel se convierte en una contraseña
// permanente y sin segundo factor.
function canjearCodigoDeRespaldo(cuenta, codigo, req, res, alFallar) {
  const normalizado = auth.normalizarCodigoRespaldo(codigo);
  if (!normalizado) return alFallar();

  db.all(
    'SELECT id_codigo, hash FROM codigos_respaldo WHERE id_cuenta = ? AND usado_en IS NULL',
    [cuenta.id_cuenta],
    async (err, filas) => {
      if (err || !filas || filas.length === 0) return alFallar();

      try {
        for (const fila of filas) {
          if (await auth.verificar(normalizado, fila.hash)) {
            db.run('UPDATE codigos_respaldo SET usado_en = ? WHERE id_codigo = ?', [ahora(), fila.id_codigo]);
            retos.delete(req.body.reto);
            return abrirSesion(cuenta, req, res, { codigo_respaldo_usado: true });
          }
        }
      } catch (errInterno) {
        return res.status(500).json({ error: errInterno.message });
      }

      alFallar();
    }
  );
}

app.post('/api/auth/salir', (req, res) => {
  db.run('DELETE FROM sesiones WHERE id_sesion = ?', [req.idSesion], () => {
    registrarAcceso(req.cuenta.usuario, 'salida', req);
    res.clearCookie(NOMBRE_COOKIE, { ...opcionesCookie(), maxAge: undefined });
    res.json({ mensaje: 'Sesión cerrada.' });
  });
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

app.get('/api/cuentas', exigirSuperadmin, (req, res) => {
  // El hash no sale de aquí ni para el superadmin: no le sirve de nada y sí le
  // sirve a quien consiga mirar la pantalla.
  db.all(
    `SELECT id_cuenta, usuario, rol, creada_en, activa,
            totp_secreto IS NOT NULL AS con_totp
     FROM cuentas ORDER BY id_cuenta`,
    [],
    (err, filas) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(filas.map((f) => ({ ...f, con_totp: f.con_totp === 1, activa: f.activa === 1 })));
    }
  );
});

app.patch('/api/cuentas/:id/activa', exigirSuperadmin, (req, res) => {
  const id = Number(req.params.id);
  const activa = req.body?.activa ? 1 : 0;

  // Quedarse sin ningún superadmin activo dejaría la gestión de cuentas cerrada
  // por dentro, sin forma de volver a abrirla desde la web.
  if (!activa && id === req.cuenta.id_cuenta) {
    return res.status(409).json({ error: 'No puedes desactivar tu propia cuenta.' });
  }

  db.run('UPDATE cuentas SET activa = ? WHERE id_cuenta = ?', [activa, id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Cuenta no encontrada.' });

    // Desactivar sin cerrar sus sesiones no serviría de nada durante las
    // próximas doce horas.
    if (!activa) db.run('DELETE FROM sesiones WHERE id_cuenta = ?', [id]);
    res.json({ mensaje: 'Cuenta actualizada.' });
  });
});

app.get('/api/accesos', exigirSuperadmin, (req, res) => {
  db.all('SELECT * FROM accesos ORDER BY id_acceso DESC LIMIT 200', [], (err, filas) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(filas);
  });
});

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
//
// La ÚNICA ruta del CRUD reservada al superadmin. El criterio no es "es
// peligrosa" sino "es irreversible": desactivar un producto se deshace con un
// clic, editarlo también, pero borrarlo se lleva por delante la fila y deja
// huérfanas sus `orden_lineas` — y con ellas la devolución de esa orden.
// Lo demás se lo queda el almacén, que es quien trabaja con esto todo el día.
app.delete('/api/productos/:id', exigirSuperadmin, (req, res) => {
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

// Arranca sólo al ejecutar `node server.js`. Al importarse (tests) se exporta
// la app sin abrir puerto.
if (require.main === module) {
  // Sin ninguna cuenta no hay forma de entrar, y una aplicación publicada en
  // internet a la que nadie puede entrar es un despliegue roto que parece
  // funcionar. Se avisa fuerte y, en producción, no se arranca: mejor un fallo
  // ruidoso ahora que descubrirlo el lunes.
  db.get('SELECT count(*) AS total FROM cuentas WHERE activa = 1', [], (err, fila) => {
    if (!err && fila.total === 0) {
      console.error('❌ No hay ninguna cuenta activa. Crea una con:');
      console.error('   node scripts/cuenta.js crear <usuario> --rol superadmin');
      if (EN_PRODUCCION) process.exit(1);
      console.error('   (se arranca igual porque NODE_ENV no es "production")');
    }

    app.listen(port, () => {
      console.log(`Servidor Express corriendo en http://localhost:${port}`);
    });
  });
}

// Expuestas para los tests: `db` para cerrar la conexión en el teardown y
// `reiniciarLimites` para que un test no herede el castigo por intentos
// fallidos del anterior.
app.locals.db = db;
app.locals.reiniciarLimites = reiniciarLimites;
module.exports = app;
