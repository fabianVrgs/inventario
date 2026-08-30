// Alta y gestión de cuentas. La ÚNICA forma de crear una: no hay registro
// público ni cuenta por defecto, porque una aplicación que se despliega con
// admin/admin ya está comprometida antes de arrancar.
//
// Uso:
//   node scripts/cuenta.js listar
//   node scripts/cuenta.js roles
//   node scripts/cuenta.js crear <usuario> --rol <rol>
//   node scripts/cuenta.js clave <usuario>
//   node scripts/cuenta.js rol <usuario> <rol>
//   node scripts/cuenta.js baja <usuario>
//   node scripts/cuenta.js alta <usuario>
//   node scripts/cuenta.js cerrar-sesiones [usuario]
//
// Los roles son dos —`superadmin`, que gestiona cuentas y ve la bitácora, y
// `admin`, que hace el resto del almacén—, y viven como filas en la tabla
// `roles` con los permisos que cada uno lleva. Nada los crea ni los edita: ni
// este script ni la web. Aquí sólo se LEEN, y `roles` los enseña. Sigue siendo
// la única forma de crear la PRIMERA cuenta, que es lo que abre
// /html/cuentas.html.
//
// La base sale de DATABASE_URL (o DATABASE_URL_TEST, que db.js prioriza) y del
// esquema en ESQUEMA_BD — sin ella, `public`, que es la base real. Se imprime
// cuál esquema se usa, nunca la cadena de conexión: ahí va la contraseña.

'use strict';

// Para `stty`: es como se apaga el eco en las terminales donde node no puede
// usar el modo crudo. Ver hayTerminal() y apagarEco(), más abajo.
const { execFileSync } = require('node:child_process');
const { consultar, pool } = require('../src/db.js');
const auth = require('../src/auth.js');

// Ni la lista de roles ni las reglas de la contraseña se escriben aquí. Los
// roles están en la base, que es también de donde los lee el servidor: una
// constante aquí sería la misma verdad en dos sitios. Las reglas están en
// auth.js, porque hay DOS puertas por las que nace una cuenta —esta y la
// pantalla— y con las reglas escritas dos veces, la segunda copia se afloja el
// día que estorbe: sería justo la que deja pasar la contraseña débil.

function fallar(mensaje) {
  console.error(`ERROR: ${mensaje}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Entrada por teclado: lector de líneas sobre stdin
// ---------------------------------------------------------------------------
//
// Se engancha UNA vez al flujo y va repartiendo líneas según se piden. La
// primera versión leía todo stdin de golpe con readFileSync(0) y tenía dos
// fallos que sólo se ven usándolo desde una terminal de verdad:
//
//   1. readFileSync(0) espera al FIN DEL FLUJO, no al salto de línea. Pulsar
//      Enter no hacía nada; habría hecho falta un Ctrl+D.
//   2. La rama sin terminal no imprimía el aviso, así que el programa se
//      quedaba mudo esperando algo que nadie sabía que tenía que escribir.
//
// Repartir por líneas y no por flujo entero resuelve además el motivo por el
// que aquello existía: dos preguntas seguidas sobre el mismo stdin.
let bufer = '';
let enEspera = [];
let flujoTerminado = false;
let enganchado = false;

function engancharStdin() {
  if (enganchado) return;
  enganchado = true;

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (trozo) => {
    bufer += trozo;
    repartir();
  });
  process.stdin.on('end', () => {
    flujoTerminado = true;
    repartir();
  });
}

function repartir() {
  while (enEspera.length > 0) {
    const salto = bufer.indexOf('\n');

    if (salto !== -1) {
      const linea = bufer.slice(0, salto);
      bufer = bufer.slice(salto + 1);
      enEspera.shift()(linea.replace(/\r$/, ''));
      continue;
    }

    // Sin salto final: si el flujo ya acabó, lo que quede es la última línea.
    // Es el caso de `printf 'clave' | node …`, sin \n al final.
    if (flujoTerminado) {
      const linea = bufer;
      bufer = '';
      enEspera.shift()(linea.replace(/\r$/, ''));
      continue;
    }

    return; // aún no hay línea completa; se resolverá al llegar más datos
  }
}

function leerLinea() {
  engancharStdin();
  process.stdin.resume();
  return new Promise((resolve) => {
    enEspera.push(resolve);
    repartir();
  });
}

// ---------------------------------------------------------------------------
// ¿Hay una persona al otro lado?
// ---------------------------------------------------------------------------
//
// `process.stdin.isTTY` NO basta en Windows. Git Bash usa mintty, que entrega
// stdin por una tubería aunque la sesión sea interactiva, así que ahí isTTY es
// false y sin embargo hay alguien tecleando. Tratarlo como una tubería es lo
// que dejaba el programa mudo.
//
// La prueba fiable es preguntarle a `stty`: si responde, hay una terminal
// detrás. Si no existe el mandato o falla, es una tubería de verdad.
let interactivo = null;

function hayTerminal() {
  if (interactivo !== null) return interactivo;

  if (process.stdin.isTTY) {
    interactivo = true;
    return true;
  }

  try {
    execFileSync('stty', ['-a'], { stdio: ['inherit', 'ignore', 'ignore'] });
    interactivo = true;
  } catch {
    interactivo = false;
  }
  return interactivo;
}

// Apaga el eco de la terminal con `stty` para las consolas donde node no puede
// usar el modo crudo (otra vez mintty). Devuelve cómo volver a encenderlo, o
// null si no se pudo — y entonces hay que AVISAR de que se va a ver lo tecleado,
// porque una contraseña visible que el usuario cree oculta es peor que una que
// sabe que se ve.
function apagarEco() {
  try {
    execFileSync('stty', ['-echo'], { stdio: ['inherit', 'ignore', 'ignore'] });
    return () => {
      try {
        execFileSync('stty', ['echo'], { stdio: ['inherit', 'ignore', 'ignore'] });
      } catch {
        /* si no se puede restaurar, la terminal se arregla al cerrarla */
      }
    };
  } catch {
    return null;
  }
}

// La contraseña NUNCA se pasa por argumento. `argv` acaba en el historial del
// shell, queda en los logs de cualquier CI y es visible en `ps` para todos los
// usuarios de la máquina mientras el proceso corre. Se pide por stdin y sin eco.
async function preguntarOculto(mensaje) {
  const stdin = process.stdin;

  // El aviso se imprime SIEMPRE, en los tres caminos. Que faltara en uno de
  // ellos era el fallo: el programa esperaba en silencio.
  process.stdout.write(mensaje);

  // Camino 2: hay terminal pero node no puede ponerla en modo crudo (mintty).
  // Se apaga el eco con stty y se lee una línea normal.
  if (!stdin.isTTY) {
    const restaurarEco = hayTerminal() ? apagarEco() : null;

    if (hayTerminal() && !restaurarEco) {
      process.stdout.write('\n⚠️  Esta terminal no deja ocultar lo que escribes; se verá.\n' + mensaje);
    }

    const linea = await leerLinea();

    if (restaurarEco) restaurarEco();
    // El salto lo escribimos nosotros: con el eco apagado, el Enter no se ve.
    if (hayTerminal()) process.stdout.write('\n');

    return linea.trim();
  }

  // Camino 1: terminal de verdad (PowerShell, cmd, Windows Terminal). Modo
  // crudo, carácter a carácter y sin eco.
  return new Promise((resolve) => {
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

  const problema = auth.revisarClave(clave);
  if (problema) fallar(problema);

  // La confirmación existe para atrapar una errata al teclear a ciegas. Por
  // tubería no hay errata posible —lo que llega es lo que el script mandó— así
  // que pedir la línea dos veces sólo sería una trampa para quien automatice.
  if (hayTerminal()) {
    const repetida = await preguntarOculto('Repítela: ');
    if (clave !== repetida) fallar('Las dos contraseñas no coinciden.');
  }

  return clave;
}

// ---------------------------------------------------------------------------
// Base de datos
// ---------------------------------------------------------------------------

// Envoltorios finos sobre `consultar` de db.js. `ejecutar` devuelve el número
// de filas afectadas (antes `this.changes` de sqlite3); las órdenes que lo
// usan para un UPDATE/DELETE de "cuántas sesiones cerré" se ajustan abajo.
const ejecutar = async (sql, parametros = []) => (await consultar(sql, parametros)).rowCount;
const unaFila = async (sql, parametros = []) => (await consultar(sql, parametros)).rows[0];
const todas = async (sql, parametros = []) => (await consultar(sql, parametros)).rows;

// Los roles salen de la tabla, no de una constante: es la misma fuente que lee
// el servidor, así que los dos reconocen siempre lo mismo.
async function rolesDisponibles() {
  return (await todas('SELECT nombre FROM roles ORDER BY nombre')).map((f) => f.nombre);
}

async function exigirRolExistente(rol) {
  const roles = await rolesDisponibles();
  if (!roles.includes(rol)) fallar(`El rol debe ser uno de: ${roles.join(', ')}.`);
}

async function gestionaCuentas(rol) {
  const fila = await unaFila(
    "SELECT ('cuentas.gestionar' = ANY (permisos)) AS gestiona FROM roles WHERE nombre = $1",
    [rol]
  );
  return fila?.gestiona === true;
}

// El mismo invariante que impone la API, y por el mismo motivo: si no queda
// ninguna cuenta activa capaz de gestionar cuentas, la gestión se cierra por
// dentro. Está repetido aquí, y no reutilizado, porque este script escribe la
// base sin pasar por la API. Pregunta por el PERMISO y no por el nombre del
// rol, igual que el servidor: sustituye al viejo guardia del "último
// superadmin", que dejó de valer en cuanto los roles pasaron a ser filas.
//
// count(*)::int: sin el cast, `pg` devuelve el bigint como cadena ("0") para no
// perder precisión, y `=== 0` nunca sería cierto.
async function exigirQueQuedeUnGestor(cuenta) {
  const { total } = await unaFila(
    `SELECT count(*)::int AS total
     FROM cuentas c
     JOIN roles r ON r.nombre = c.rol
     WHERE c.activa = 1
       AND 'cuentas.gestionar' = ANY (r.permisos)
       AND c.id_cuenta != $1`,
    [cuenta.id_cuenta]
  );

  if (total === 0) {
    fallar(
      'Es la única cuenta activa que puede gestionar cuentas. Dejarla fuera cierra ' +
        'la gestión por dentro, sin forma de reabrirla desde la web.'
    );
  }
}

async function buscarCuenta(usuario) {
  // lower(usuario) = lower($1): Postgres no tiene COLLATE NOCASE, y el índice
  // único de la base es sobre lower(usuario). Comparar en crudo dejaría de
  // encontrar "Erick" al teclear "erick", que es justo lo que ese índice
  // impide que existan como dos cuentas distintas.
  const cuenta = await unaFila('SELECT * FROM cuentas WHERE lower(usuario) = lower($1)', [usuario]);
  if (!cuenta) fallar(`No existe la cuenta "${usuario}".`);
  return cuenta;
}

// ---------------------------------------------------------------------------
// Órdenes
// ---------------------------------------------------------------------------

const ordenes = {
  async listar() {
    const filas = await todas(
      `SELECT usuario, rol, activa, creada_en
       FROM cuentas ORDER BY id_cuenta`
    );

    if (filas.length === 0) {
      console.log('No hay ninguna cuenta. Crea la primera con:');
      console.log('  node scripts/cuenta.js crear <usuario> --rol superadmin');
      return;
    }

    console.log('USUARIO              ROL          ESTADO    CREADA');
    for (const f of filas) {
      console.log(
        `${f.usuario.padEnd(20)} ${f.rol.padEnd(12)} ` +
          `${(f.activa ? 'activa' : 'de baja').padEnd(9)} ${f.creada_en.slice(0, 10)}`
      );
    }
  },

  async crear(argumentos) {
    const usuario = argumentos._[0];
    const rol = argumentos.rol;

    if (!usuario) fallar('Falta el nombre de usuario.');

    const problema = auth.revisarUsuario(usuario);
    if (problema) fallar(problema);

    if (!rol || rol === true) fallar(`Falta --rol. Los que hay: ${(await rolesDisponibles()).join(', ')}.`);
    await exigirRolExistente(rol);

    // lower(usuario) = lower($1): mismo motivo que en buscarCuenta. Sin esto,
    // el alta parece válida y es el índice único de la base —no este script—
    // quien la rechaza, con el error feo de una restricción violada en vez
    // del aviso claro de "ese usuario ya existe".
    const repetido = await unaFila('SELECT id_cuenta FROM cuentas WHERE lower(usuario) = lower($1)', [usuario]);
    if (repetido) fallar(`Ya existe la cuenta "${usuario}".`);

    const clave = await pedirClaveNueva();

    process.stdout.write('Calculando el hash (scrypt tarda a propósito)… ');
    const hash = await auth.hashear(clave);
    console.log('listo.');

    // RETURNING id_cuenta en vez de this.lastID: aquí sí hace falta la fila
    // (no sólo el conteo de cambios), así que se usa unaFila y no ejecutar.
    const fila = await unaFila(
      'INSERT INTO cuentas (usuario, hash, rol, creada_en, activa) VALUES ($1, $2, $3, $4, 1) RETURNING id_cuenta',
      [usuario, hash, rol, new Date().toISOString()]
    );

    console.log(`\n✅ Cuenta "${usuario}" creada con rol ${rol}.`);
  },

  // Comprueba una contraseña contra la guardada, sin abrir sesión ni tocar
  // nada. Existe para separar dos preguntas que desde la pantalla de login se
  // confunden: "¿es incorrecta la contraseña?" y "¿está capturando bien lo que
  // tecleo esta terminal?".
  //
  // Por eso informa de CUÁNTOS caracteres recibió. Si tecleas dieciséis y dice
  // tres, el problema es el prompt y no la contraseña. El número no revela nada
  // que no sepa ya quien está sentado delante.
  async probar(argumentos) {
    const cuenta = await buscarCuenta(argumentos._[0]);
    const clave = await preguntarOculto('Contraseña a comprobar: ');

    console.log(`\nSe capturaron ${clave.length} caracteres.`);
    if (clave.length === 0) {
      console.log('⚠️  No se recibió nada: el problema está en la terminal, no en la contraseña.');
      return;
    }

    process.stdout.write('Comprobando… ');
    const coincide = await auth.verificar(clave, cuenta.hash);

    console.log(
      coincide
        ? `\n✅ COINCIDE con la contraseña guardada de "${cuenta.usuario}".`
        : `\n❌ NO coincide con la guardada de "${cuenta.usuario}".\n` +
            `   Si el número de caracteres es el que esperabas, la contraseña\n` +
            `   guardada es otra: cámbiala con "node scripts/cuenta.js clave ${cuenta.usuario}".`
    );
  },

  async clave(argumentos) {
    const cuenta = await buscarCuenta(argumentos._[0]);
    const clave = await pedirClaveNueva();

    process.stdout.write('Calculando el hash… ');
    await ejecutar('UPDATE cuentas SET hash = $1 WHERE id_cuenta = $2', [
      await auth.hashear(clave),
      cuenta.id_cuenta,
    ]);
    console.log('listo.');

    // Cambiar la contraseña sin cerrar las sesiones abiertas no sirve de nada
    // durante las siguientes doce horas — y si se cambia es, muchas veces,
    // precisamente porque se sospecha que alguien tiene una.
    const borradas = await ejecutar('DELETE FROM sesiones WHERE id_cuenta = $1', [cuenta.id_cuenta]);
    console.log(`✅ Contraseña cambiada. Sesiones cerradas: ${borradas}.`);
  },

  async roles() {
    const filas = await todas(
      `SELECT r.nombre, r.permisos,
              (SELECT count(*)::int FROM cuentas c WHERE c.rol = r.nombre) AS cuentas
       FROM roles r
       ORDER BY r.semilla DESC, r.nombre`
    );

    console.log('ROL                  CUENTAS  PERMISOS');
    for (const f of filas) {
      console.log(
        `${f.nombre.padEnd(20)} ${String(f.cuentas).padEnd(8)} ` +
          `${f.permisos.length > 0 ? f.permisos.join(', ') : '—'}`
      );
    }
    // Si alguna vez hay que reajustar lo que un rol puede hacer, es un UPDATE
    // a mano sobre `roles.permisos` contra la base — no hay ruta que lo escriba.
    console.log('\nSon fijos: no hay forma de crear ni editar roles desde la aplicación.');
  },

  async rol(argumentos) {
    const cuenta = await buscarCuenta(argumentos._[0]);
    const nuevo = argumentos._[1];
    await exigirRolExistente(nuevo);

    // Sólo hay algo que proteger si el rol de destino NO gestiona cuentas:
    // mover a alguien de un rol gestor a otro no deja el sistema sin ninguno.
    if ((await gestionaCuentas(cuenta.rol)) && !(await gestionaCuentas(nuevo))) {
      await exigirQueQuedeUnGestor(cuenta);
    }

    await ejecutar('UPDATE cuentas SET rol = $1 WHERE id_cuenta = $2', [nuevo, cuenta.id_cuenta]);
    console.log(`✅ "${cuenta.usuario}" pasa a ${nuevo}.`);
  },

  async baja(argumentos) {
    const cuenta = await buscarCuenta(argumentos._[0]);

    if (cuenta.activa === 1 && (await gestionaCuentas(cuenta.rol))) {
      await exigirQueQuedeUnGestor(cuenta);
    }

    await ejecutar('UPDATE cuentas SET activa = 0 WHERE id_cuenta = $1', [cuenta.id_cuenta]);
    const borradas = await ejecutar('DELETE FROM sesiones WHERE id_cuenta = $1', [cuenta.id_cuenta]);
    console.log(`✅ "${cuenta.usuario}" de baja. Sesiones cerradas: ${borradas}.`);
  },

  async alta(argumentos) {
    const cuenta = await buscarCuenta(argumentos._[0]);
    await ejecutar('UPDATE cuentas SET activa = 1 WHERE id_cuenta = $1', [cuenta.id_cuenta]);
    console.log(`✅ "${cuenta.usuario}" reactivada.`);
  },

  async 'cerrar-sesiones'(argumentos) {
    if (argumentos._[0]) {
      const cuenta = await buscarCuenta(argumentos._[0]);
      const r = await ejecutar('DELETE FROM sesiones WHERE id_cuenta = $1', [cuenta.id_cuenta]);
      console.log(`✅ Sesiones cerradas de "${cuenta.usuario}": ${r}.`);
      return;
    }

    const r = await ejecutar('DELETE FROM sesiones');
    console.log(`✅ Todas las sesiones cerradas: ${r}.`);
  },
};

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

// Analizador mínimo: `--rol admin` es la única bandera que queda. No hace
// falta más, y una dependencia para esto sería justo lo contrario de lo que
// persigue el resto del proyecto.
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
    console.error('  roles              los roles que hay y qué permite cada uno');
    console.error('  crear <usuario> --rol <rol>');
    console.error('  clave <usuario>');
    console.error('  probar <usuario>   comprueba una contraseña sin abrir sesión');
    console.error('  rol <usuario> <rol>');
    console.error('  baja <usuario>   |  alta <usuario>');
    console.error('  cerrar-sesiones [usuario]');
    process.exit(1);
  }

  // Sólo el esquema, nunca la cadena de conexión: DATABASE_URL lleva la
  // contraseña, y este script tiene prohibido imprimirla.
  console.log(`Esquema: ${process.env.ESQUEMA_BD || 'public'}\n`);
  await ordenes[orden](analizar(resto));
}

principal()
  .then(async () => {
    // stdin resumido mantiene vivo el bucle de eventos y el proceso no
    // terminaría nunca después de preguntar la contraseña.
    process.stdin.pause();
    // Sin esto el proceso se queda colgado esperando conexiones ociosas: es
    // un script de un solo uso, no un servidor de larga vida.
    await pool.end();
  })
  .catch(async (err) => {
    process.stdin.pause();
    await pool.end();
    fallar(err.message);
  });
