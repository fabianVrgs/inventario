// Alta y gestión de cuentas. La ÚNICA forma de crear una: no hay registro
// público ni cuenta por defecto, porque una aplicación que se despliega con
// admin/admin ya está comprometida antes de arrancar.
//
// Uso:
//   node scripts/cuenta.js listar
//   node scripts/cuenta.js crear <usuario> --rol admin|superadmin [--sin-totp]
//   node scripts/cuenta.js clave <usuario>
//   node scripts/cuenta.js rol <usuario> <admin|superadmin>
//   node scripts/cuenta.js baja <usuario>
//   node scripts/cuenta.js alta <usuario>
//   node scripts/cuenta.js totp <usuario>
//   node scripts/cuenta.js cerrar-sesiones [usuario]
//
// La base sale de DB_PATH o, si no está, de ./db/inventario.db3. A diferencia
// del runner de migraciones —que exige la ruta siempre para que sea imposible
// migrar la base real por accidente— aquí sí hay valor por defecto: crear una
// cuenta no destruye nada, y obligar a escribir la ruta cada vez sólo
// conseguiría que se copie y pegue sin mirar. Aun así se imprime cuál es.

'use strict';

const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();
const auth = require('../auth.js');

const RUTA_BASE = path.resolve(process.env.DB_PATH || './db/inventario.db3');
const ROLES = ['admin', 'superadmin'];

// Mínimo largo, no "una mayúscula y un símbolo". Las reglas de composición
// producen Password1! —que está en todos los diccionarios— y no producen
// entropía; el largo sí. Doce es el suelo, no el objetivo.
const LARGO_MINIMO = 12;

// Lista corta a propósito: no pretende ser un diccionario, sino atrapar el
// impulso de escribir lo primero para "probar" y dejarlo puesto para siempre.
const CLAVES_PROHIBIDAS = new Set([
  '123456789012', 'contraseña12', 'password1234', 'qwertyuiop12',
  'administrador', 'inventario12', 'okproducciones', 'almacen12345',
  'aaaaaaaaaaaa', '111111111111', 'passwordpassword', '123456123456',
]);

function fallar(mensaje) {
  console.error(`ERROR: ${mensaje}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Entrada por teclado
// ---------------------------------------------------------------------------

// Entrada por tubería: se lee TODO stdin una sola vez y se reparte por líneas.
//
// Sin esto, la segunda pregunta se colgaba para siempre: la primera consumía el
// flujo hasta 'end', y volver a esperar 'end' sobre un flujo ya terminado no
// dispara nada. Se descubrió al probar `echo clave | node scripts/cuenta.js`.
let lineasPendientes = null;

function leerLineaDeTuberia() {
  if (lineasPendientes === null) {
    const fs = require('node:fs');
    let bruto = '';
    try {
      bruto = fs.readFileSync(0, 'utf8');
    } catch {
      bruto = '';
    }
    lineasPendientes = bruto.split(/\r?\n/);
  }
  return (lineasPendientes.shift() ?? '').trim();
}

// La contraseña NUNCA se pasa por argumento. `argv` acaba en el historial del
// shell, queda en los logs de cualquier CI y es visible en `ps` para todos los
// usuarios de la máquina mientras el proceso corre. Se pide por stdin y sin eco.
function preguntarOculto(mensaje) {
  return new Promise((resolve) => {
    const stdin = process.stdin;

    // Sin terminal (una tubería, un script de despliegue) no hay eco que
    // ocultar: se lee la línea tal cual. Es lo que permite
    // `echo "$CLAVE" | node scripts/cuenta.js crear …` sin que la contraseña
    // pase nunca por argv.
    if (!stdin.isTTY) return resolve(leerLineaDeTuberia());

    process.stdout.write(mensaje);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let clave = '';

    const alRecibir = (caracter) => {
      switch (caracter) {
        case '\r':
        case '\n':
        case '\u0004': // Ctrl+D
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', alRecibir);
          process.stdout.write('\n');
          resolve(clave);
          break;
        case '\u0003': // Ctrl+C
          stdin.setRawMode(false);
          process.stdout.write('\n');
          process.exit(130);
          break;
        case '\u007f': // borrar
        case '\b':
          clave = clave.slice(0, -1);
          break;
        default:
          // Se descartan los caracteres de control; las flechas y demás llegan
          // como secuencias de escape y no deben acabar dentro de la contraseña.
          if (caracter >= ' ') clave += caracter;
      }
    };

    stdin.on('data', alRecibir);
  });
}

async function pedirClaveNueva() {
  const clave = await preguntarOculto('Contraseña nueva: ');

  if (clave.length < LARGO_MINIMO) {
    fallar(`La contraseña debe tener al menos ${LARGO_MINIMO} caracteres (tiene ${clave.length}).`);
  }
  if (CLAVES_PROHIBIDAS.has(clave.toLowerCase())) {
    fallar('Esa contraseña está en las listas de las que se prueban primero. Elige otra.');
  }

  // La confirmación existe para atrapar una errata al teclear a ciegas. Por
  // tubería no hay errata posible —lo que llega es lo que el script mandó— así
  // que pedir la línea dos veces sólo sería una trampa para quien automatice.
  if (process.stdin.isTTY) {
    const repetida = await preguntarOculto('Repítela: ');
    if (clave !== repetida) fallar('Las dos contraseñas no coinciden.');
  }

  return clave;
}

// ---------------------------------------------------------------------------
// Base de datos
// ---------------------------------------------------------------------------

const db = new sqlite3.Database(RUTA_BASE, sqlite3.OPEN_READWRITE, (err) => {
  if (err) fallar(`No se pudo abrir la base ${RUTA_BASE}: ${err.message}`);
});

const consultar = (sql, parametros = []) =>
  new Promise((resolve, reject) =>
    db.all(sql, parametros, (err, filas) => (err ? reject(err) : resolve(filas)))
  );

const unaFila = (sql, parametros = []) =>
  new Promise((resolve, reject) =>
    db.get(sql, parametros, (err, fila) => (err ? reject(err) : resolve(fila)))
  );

const ejecutar = (sql, parametros = []) =>
  new Promise((resolve, reject) =>
    db.run(sql, parametros, function (err) {
      return err ? reject(err) : resolve(this);
    })
  );

async function buscarCuenta(usuario) {
  const cuenta = await unaFila('SELECT * FROM cuentas WHERE usuario = ?', [usuario]);
  if (!cuenta) fallar(`No existe la cuenta "${usuario}".`);
  return cuenta;
}

// ---------------------------------------------------------------------------
// Segundo factor
// ---------------------------------------------------------------------------

// El secreto y los códigos se imprimen UNA sola vez, aquí y ahora. No se puede
// volver a consultarlos: en la base sólo queda el secreto (que la app necesita
// para verificar) y el HASH de cada código. Quien no los guarde tendrá que
// regenerarlos, que es exactamente como debe ser.
async function activarTotp(idCuenta, usuario) {
  const secreto = auth.secretoTotp();
  const codigos = auth.generarCodigosRespaldo();

  await ejecutar('UPDATE cuentas SET totp_secreto = ?, totp_ultimo_paso = NULL WHERE id_cuenta = ?', [
    secreto,
    idCuenta,
  ]);

  await ejecutar('DELETE FROM codigos_respaldo WHERE id_cuenta = ?', [idCuenta]);
  for (const codigo of codigos) {
    await ejecutar('INSERT INTO codigos_respaldo (id_cuenta, hash) VALUES (?, ?)', [
      idCuenta,
      await auth.hashear(auth.normalizarCodigoRespaldo(codigo)),
    ]);
  }

  console.log('\n── Segundo factor ──────────────────────────────────────────');
  console.log('Añade esta cuenta a tu aplicación de autenticación con esta URI');
  console.log('(o pega el secreto a mano):\n');
  console.log(`  ${auth.uriTotp(usuario, secreto)}\n`);
  console.log(`  Secreto: ${secreto}\n`);
  console.log('CÓDIGOS DE RESPALDO — apúntalos en papel y guárdalos fuera del');
  console.log('ordenador. Cada uno sirve UNA vez, y son la única forma de entrar');
  console.log('si pierdes el móvil. No se pueden volver a consultar.\n');
  for (const codigo of codigos) console.log(`  ${codigo}`);
  console.log('────────────────────────────────────────────────────────────\n');
}

// ---------------------------------------------------------------------------
// Órdenes
// ---------------------------------------------------------------------------

const ordenes = {
  async listar() {
    const filas = await consultar(
      `SELECT usuario, rol, activa, creada_en, totp_secreto IS NOT NULL AS con_totp
       FROM cuentas ORDER BY id_cuenta`
    );

    if (filas.length === 0) {
      console.log('No hay ninguna cuenta. Crea la primera con:');
      console.log('  node scripts/cuenta.js crear <usuario> --rol superadmin');
      return;
    }

    console.log('USUARIO              ROL          ESTADO    2FA  CREADA');
    for (const f of filas) {
      console.log(
        `${f.usuario.padEnd(20)} ${f.rol.padEnd(12)} ` +
          `${(f.activa ? 'activa' : 'de baja').padEnd(9)} ` +
          `${(f.con_totp ? 'sí' : 'no').padEnd(4)} ${f.creada_en.slice(0, 10)}`
      );
    }
  },

  async crear(argumentos) {
    const usuario = argumentos._[0];
    const rol = argumentos.rol;

    if (!usuario) fallar('Falta el nombre de usuario.');
    if (!ROLES.includes(rol)) fallar(`--rol debe ser ${ROLES.join(' o ')}.`);
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(usuario)) {
      fallar('El usuario admite letras, números, punto, guion y guion bajo, entre 3 y 32 caracteres.');
    }

    const repetido = await unaFila('SELECT id_cuenta FROM cuentas WHERE usuario = ?', [usuario]);
    if (repetido) fallar(`Ya existe la cuenta "${usuario}".`);

    const clave = await pedirClaveNueva();

    process.stdout.write('Calculando el hash (scrypt tarda a propósito)… ');
    const hash = await auth.hashear(clave);
    console.log('listo.');

    const resultado = await ejecutar(
      'INSERT INTO cuentas (usuario, hash, rol, creada_en, activa) VALUES (?, ?, ?, ?, 1)',
      [usuario, hash, rol, new Date().toISOString()]
    );

    console.log(`\n✅ Cuenta "${usuario}" creada con rol ${rol}.`);

    // El segundo factor es de serie en el superadmin: es la cuenta que puede
    // gestionar cuentas y borrar productos, y una contraseña reutilizada que
    // aparezca en una filtración es el escenario más probable de todos.
    if (rol === 'superadmin' && !argumentos['sin-totp']) {
      await activarTotp(resultado.lastID, usuario);
    } else if (rol === 'superadmin') {
      console.log('⚠️  Creada SIN segundo factor (--sin-totp). Actívalo antes de publicar:');
      console.log(`   node scripts/cuenta.js totp ${usuario}`);
    }
  },

  async clave(argumentos) {
    const cuenta = await buscarCuenta(argumentos._[0]);
    const clave = await pedirClaveNueva();

    process.stdout.write('Calculando el hash… ');
    await ejecutar('UPDATE cuentas SET hash = ? WHERE id_cuenta = ?', [
      await auth.hashear(clave),
      cuenta.id_cuenta,
    ]);
    console.log('listo.');

    // Cambiar la contraseña sin cerrar las sesiones abiertas no sirve de nada
    // durante las siguientes doce horas — y si se cambia es, muchas veces,
    // precisamente porque se sospecha que alguien tiene una.
    const borradas = await ejecutar('DELETE FROM sesiones WHERE id_cuenta = ?', [cuenta.id_cuenta]);
    console.log(`✅ Contraseña cambiada. Sesiones cerradas: ${borradas.changes}.`);
  },

  async rol(argumentos) {
    const cuenta = await buscarCuenta(argumentos._[0]);
    const nuevo = argumentos._[1];
    if (!ROLES.includes(nuevo)) fallar(`El rol debe ser ${ROLES.join(' o ')}.`);

    await ejecutar('UPDATE cuentas SET rol = ? WHERE id_cuenta = ?', [nuevo, cuenta.id_cuenta]);
    console.log(`✅ "${cuenta.usuario}" pasa a ${nuevo}.`);
  },

  async baja(argumentos) {
    const cuenta = await buscarCuenta(argumentos._[0]);

    const superadmins = await unaFila(
      "SELECT count(*) AS total FROM cuentas WHERE rol = 'superadmin' AND activa = 1 AND id_cuenta != ?",
      [cuenta.id_cuenta]
    );
    if (cuenta.rol === 'superadmin' && superadmins.total === 0) {
      fallar('Es el último superadmin activo. Dar de baja al último cierra la gestión de cuentas por dentro.');
    }

    await ejecutar('UPDATE cuentas SET activa = 0 WHERE id_cuenta = ?', [cuenta.id_cuenta]);
    const borradas = await ejecutar('DELETE FROM sesiones WHERE id_cuenta = ?', [cuenta.id_cuenta]);
    console.log(`✅ "${cuenta.usuario}" de baja. Sesiones cerradas: ${borradas.changes}.`);
  },

  async alta(argumentos) {
    const cuenta = await buscarCuenta(argumentos._[0]);
    await ejecutar('UPDATE cuentas SET activa = 1 WHERE id_cuenta = ?', [cuenta.id_cuenta]);
    console.log(`✅ "${cuenta.usuario}" reactivada.`);
  },

  async totp(argumentos) {
    const cuenta = await buscarCuenta(argumentos._[0]);
    await activarTotp(cuenta.id_cuenta, cuenta.usuario);
    console.log('✅ Segundo factor activado. Los códigos de respaldo anteriores ya no valen.');
  },

  async 'cerrar-sesiones'(argumentos) {
    if (argumentos._[0]) {
      const cuenta = await buscarCuenta(argumentos._[0]);
      const r = await ejecutar('DELETE FROM sesiones WHERE id_cuenta = ?', [cuenta.id_cuenta]);
      console.log(`✅ Sesiones cerradas de "${cuenta.usuario}": ${r.changes}.`);
      return;
    }

    const r = await ejecutar('DELETE FROM sesiones');
    console.log(`✅ Todas las sesiones cerradas: ${r.changes}.`);
  },
};

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

// Analizador mínimo: `--rol admin` y banderas sueltas como `--sin-totp`. No
// hace falta más, y una dependencia para esto sería justo lo contrario de lo
// que persigue el resto del proyecto.
function analizar(argv) {
  const resultado = { _: [] };

  for (let i = 0; i < argv.length; i += 1) {
    const pieza = argv[i];
    if (!pieza.startsWith('--')) {
      resultado._.push(pieza);
      continue;
    }
    const nombre = pieza.slice(2);
    const siguiente = argv[i + 1];
    if (siguiente && !siguiente.startsWith('--')) {
      resultado[nombre] = siguiente;
      i += 1;
    } else {
      resultado[nombre] = true;
    }
  }

  return resultado;
}

async function principal() {
  const [orden, ...resto] = process.argv.slice(2);

  if (!orden || !Object.prototype.hasOwnProperty.call(ordenes, orden)) {
    console.error('Uso: node scripts/cuenta.js <orden> [argumentos]\n');
    console.error('Órdenes:');
    console.error('  listar');
    console.error('  crear <usuario> --rol admin|superadmin [--sin-totp]');
    console.error('  clave <usuario>');
    console.error('  rol <usuario> <admin|superadmin>');
    console.error('  baja <usuario>   |  alta <usuario>');
    console.error('  totp <usuario>');
    console.error('  cerrar-sesiones [usuario]');
    process.exit(1);
  }

  console.log(`Base de datos: ${RUTA_BASE}\n`);
  await ordenes[orden](analizar(resto));
}

principal()
  .then(() => db.close())
  .catch((err) => {
    db.close();
    fallar(err.message);
  });
