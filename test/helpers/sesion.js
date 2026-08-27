// Cuentas y cookies para los tests.
//
// La suite entera pasó a necesitar sesión el día que el guardia empezó a
// denegar por defecto, así que esto es lo que la mantiene en pie: siembra las
// dos cuentas y devuelve la cookie con la que hacer las peticiones.

const auth = require('../../auth.js');
const { consultar } = require('../../db.js');

// Contraseñas de prueba, nunca de despliegue. Cumplen el mínimo de 12
// caracteres para no tener que meter una excepción en el validador sólo para
// los tests — un validador con puerta trasera es un validador roto.
const CLAVES = {
  admin: 'ClaveDePruebaAlmacen1',
  superadmin: 'ClaveDePruebaSuperadmin1',
};

const USUARIOS = {
  admin: 'almacen-de-prueba',
  superadmin: 'super-de-prueba',
};

// Hashear con scrypt cuesta ~200 ms a propósito, y aquí saldrían dos por cada
// archivo de test. Se cachea en memoria del proceso: el coste es el mismo para
// quien ataca y aquí sólo alarga la espera de quien ya conoce la contraseña.
const cacheHashes = new Map();

async function hashDe(clave) {
  if (!cacheHashes.has(clave)) cacheHashes.set(clave, await auth.hashear(clave));
  return cacheHashes.get(clave);
}

// Siembra las dos cuentas. `opciones.totp` activa el segundo factor en el
// superadmin y devuelve su secreto, para los tests que lo necesiten.
async function sembrarCuentas(opciones = {}) {
  const secreto = opciones.totp ? auth.secretoTotp() : null;

  // sqlite_sequence no existe en Postgres: RESTART IDENTITY hace ese trabajo.
  await consultar(`
    TRUNCATE cuentas, sesiones, codigos_respaldo, retos_totp
    RESTART IDENTITY CASCADE
  `);

  await consultar(
    'INSERT INTO cuentas (usuario, hash, rol, creada_en, activa) VALUES ($1, $2, $3, $4, 1)',
    [USUARIOS.admin, await hashDe(CLAVES.admin), 'admin', new Date().toISOString()]
  );

  await consultar(
    `INSERT INTO cuentas (usuario, hash, rol, totp_secreto, creada_en, activa)
     VALUES ($1, $2, $3, $4, $5, 1)`,
    [USUARIOS.superadmin, await hashDe(CLAVES.superadmin), 'superadmin', secreto, new Date().toISOString()]
  );

  return { secreto };
}

// Añade un código de respaldo canjeable a la cuenta indicada y lo devuelve en
// claro, que es la única vez que existe fuera de su hash.
async function sembrarCodigoRespaldo(usuario) {
  const [codigo] = auth.generarCodigosRespaldo(1);

  await consultar(
    `INSERT INTO codigos_respaldo (id_cuenta, hash)
     SELECT id_cuenta, $1 FROM cuentas WHERE usuario = $2`,
    [await auth.hashear(auth.normalizarCodigoRespaldo(codigo)), usuario]
  );

  return codigo;
}

// Devuelve la cookie lista para reenviar. Si la cuenta tiene segundo factor,
// hace también el segundo paso: quien llama sólo quiere una sesión abierta.
async function iniciarSesion(base, rol = 'superadmin', opciones = {}) {
  const respuesta = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: USUARIOS[rol], clave: CLAVES[rol] }),
  });

  if (!respuesta.ok) {
    throw new Error(`No se pudo iniciar sesión como ${rol}: ${respuesta.status}`);
  }

  const cuerpo = await respuesta.json();

  if (!cuerpo.requiere_totp) return cookieDe(respuesta);

  if (!opciones.secreto) {
    throw new Error(`La cuenta ${rol} pide segundo factor y no se pasó el secreto.`);
  }

  const segundo = await fetch(`${base}/api/auth/totp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reto: cuerpo.reto,
      codigo: auth.codigoPara(opciones.secreto, auth.pasoActual()),
    }),
  });

  if (!segundo.ok) throw new Error(`Falló el segundo factor de ${rol}: ${segundo.status}`);
  return cookieDe(segundo);
}

// `Set-Cookie` trae también los atributos (HttpOnly, SameSite…); para reenviarla
// sólo hace falta el `nombre=valor` de delante.
function cookieDe(respuesta) {
  const cabecera = respuesta.headers.get('set-cookie');
  if (!cabecera) throw new Error('La respuesta no trae Set-Cookie.');
  return cabecera.split(';')[0];
}

module.exports = {
  CLAVES,
  USUARIOS,
  sembrarCuentas,
  sembrarCodigoRespaldo,
  iniciarSesion,
  cookieDe,
};
