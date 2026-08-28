// Cuentas y cookies para los tests.
//
// La suite entera pasó a necesitar sesión el día que el guardia empezó a
// denegar por defecto, así que esto es lo que la mantiene en pie: siembra las
// dos cuentas y devuelve la cookie con la que hacer las peticiones.

const auth = require('../../auth.js');

// Se importa el helper de test, no el db.js de la raíz directamente. No es
// por sus símbolos —sólo se usan `consultar` y `exigirEsquemaDePruebas`,
// que este archivo podría reexportar igual de bien—: es para que el grafo de
// módulos garantice el orden. `./db.js` fija `process.env.ESQUEMA_BD` ANTES
// de requerir el db.js de la raíz; si aquí se requiriera ese db.js
// directamente, un archivo de test que importara sólo `helpers/sesion`
// (sin pasar antes por `helpers/db`) truncaría cuentas contra `public` sin
// que nada lo impidiera. Requerir `./db.js` hace ese orden imposible de
// saltarse, en vez de depender de que cada archivo importe en el orden
// correcto.
const { consultar, exigirEsquemaDePruebas } = require('./db.js');

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

// Siembra las dos cuentas de prueba.
async function sembrarCuentas() {
  await exigirEsquemaDePruebas();

  // sqlite_sequence no existe en Postgres: RESTART IDENTITY hace ese trabajo.
  //
  // codigos_respaldo y retos_totp siguen aquí aunque el segundo factor ya no se
  // use, y NO son un resto que limpiar: las dos tienen una FK a `cuentas`, y
  // Postgres rechaza `TRUNCATE cuentas` con 0A000 ("cannot truncate a table
  // referenced in a foreign key constraint") si las tablas que la referencian no
  // se truncan en la MISMA sentencia. La restricción existe aunque estén vacías.
  await consultar(`
    TRUNCATE cuentas, sesiones, codigos_respaldo, retos_totp
    RESTART IDENTITY CASCADE
  `);

  await consultar(
    'INSERT INTO cuentas (usuario, hash, rol, creada_en, activa) VALUES ($1, $2, $3, $4, 1)',
    [USUARIOS.admin, await hashDe(CLAVES.admin), 'admin', new Date().toISOString()]
  );

  await consultar(
    'INSERT INTO cuentas (usuario, hash, rol, creada_en, activa) VALUES ($1, $2, $3, $4, 1)',
    [USUARIOS.superadmin, await hashDe(CLAVES.superadmin), 'superadmin', new Date().toISOString()]
  );
}

// Devuelve la cookie lista para reenviar.
async function iniciarSesion(base, rol = 'superadmin') {
  const respuesta = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: USUARIOS[rol], clave: CLAVES[rol] }),
  });

  if (!respuesta.ok) {
    throw new Error(`No se pudo iniciar sesión como ${rol}: ${respuesta.status}`);
  }

  return cookieDe(respuesta);
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
  iniciarSesion,
  cookieDe,
};
