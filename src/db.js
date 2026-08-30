// Única puerta a Postgres. Nadie más construye conexiones.
const { Pool } = require('pg');
const fs = require('node:fs');
const path = require('node:path');

// CA raíz del pooler de Supabase. Es pública, no es un secreto, y por eso se
// versiona: el certificado del pooler no está firmado por una CA del trust
// store de Node, así que sin esto no hay forma de verificarlo.
// El `..` sale de `src/`: el certificado vive en `certs/`, en la raiz del repo.
const ca = fs.readFileSync(path.join(__dirname, '..', 'certs', 'supabase-ca.crt'), 'utf8');

// DATABASE_URL_TEST tiene prioridad a propósito: así un test no puede tocar
// producción ni aunque el .env traiga las dos.
const cadena = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;
if (!cadena) {
  throw new Error('Falta DATABASE_URL (o DATABASE_URL_TEST). Mira .env.example.');
}

// Vercel fija VERCEL=1 en sus funciones. Fuera de ahí hay UN proceso de larga
// vida atendiendo todo, y ahí `max: 1` serializaría cada petición sobre una
// única conexión. En Vercel es al revés: hay N instancias concurrentes y cada
// una abriría su propio pool, así que con `max: 10` se agota el límite de
// conexiones de Supabase en cuanto entran varias personas a la vez. Una por
// instancia, y que el pooler haga el multiplexado.
const enVercel = process.env.VERCEL === '1';

// Los tests aíslan cada archivo en su propio esquema. En producción no se fija
// y todo vive en `public`.
//
// ESQUEMA_BD se lee AQUÍ, al construir el pool (es decir, al cargar el
// módulo), y no dentro de un callback posterior — y eso ya no es un peligro:
// `pool.on('connect')` no espera a su manejador, así que un `SET search_path`
// disparado ahí queda suelto (sin `await` ni `catch` posibles) y el cliente
// se entrega a quien lo pidió mientras la consulta sigue en vuelo; si se
// rechaza, la conexión se queda con el search_path por defecto y nadie se
// entera. Se vio de verdad: 1 de cada 5 corridas de la suite fallaba con
// `relation "ordenes" does not exist`.
//
// La alternativa es pasar el esquema en `options`, que Postgres aplica en el
// paquete de arranque de la conexión, del lado del servidor, antes de que
// ninguna consulta pueda ejecutarse — no hay ventana de carrera posible. El
// costo es el contrato: quien cargue `db.js` debe haber fijado `ESQUEMA_BD`
// ANTES del `require`, porque se lee una sola vez aquí y no en cada conexión.
// `test/helpers/db.js` la fija en su nivel superior antes de requerir este
// módulo, y `test/helpers/sesion.js` requiere ese helper (nunca `db.js`
// directo) precisamente para heredar ese orden por el grafo de módulos. Quien
// añada un archivo de test nuevo debe entrar por ahí.
const esquema = process.env.ESQUEMA_BD;

// Va interpolado en `options` de abajo, así que un valor con espacios o
// punto y coma podría colar opciones extra en el paquete de arranque de la
// conexión (`-c search_path=x -c otra_cosa=y`, por ejemplo). Sólo minúsculas,
// dígitos y guión bajo — que es exactamente lo que genera
// `test/helpers/db.js` (`inventario_test_<pid>`) — puede llegar hasta aquí.
if (esquema && !/^[a-z0-9_]+$/.test(esquema)) {
  throw new Error(
    `ESQUEMA_BD tiene un valor inválido: "${esquema}". Sólo se permiten ` +
    'minúsculas, dígitos y guión bajo.'
  );
}

const pool = new Pool({
  connectionString: cadena,
  ssl: { ca, rejectUnauthorized: true },
  max: enVercel ? 1 : 10,
  // Presupuesto de UNA invocación en Vercel: abrir conexión y luego correr la
  // consulta, en secuencia, por debajo del techo de 10 s de maxDuration.
  //
  // Sólo quedan estos tres porque son los únicos que funcionan aquí: `pg` los
  // aplica del lado del cliente. Los de servidor (statement_timeout,
  // lock_timeout, idle_in_transaction_session_timeout) los DESCARTA el pooler
  // en modo transacción, así que serían protección de mentira. Donde de verdad
  // hacen falta —las dos transacciones que escriben stock— se fijan con
  // SET LOCAL dentro de la propia transacción.
  connectionTimeoutMillis: enVercel ? 4000 : 10000,
  idleTimeoutMillis: enVercel ? 10000 : 30000,
  query_timeout: enVercel ? 5000 : 20000,
  // Sólo cuando hay esquema de pruebas; en producción se omite y todo vive en `public`.
  ...(esquema ? { options: `-c search_path=${esquema}` } : {}),
});

// El pooler cierra las conexiones ociosas de forma rutinaria. Cuando lo hace, el
// cliente inactivo emite 'error' EN EL POOL, no en la consulta de nadie: sin
// este manejador Node lo trata como excepción no capturada y tumba el proceso
// entero. El pool descarta el cliente roto y abre otro solo; no hay nada que
// reparar aquí.
pool.on('error', (err) => console.error('[db] cliente ocioso descartado:', err.message));

function consultar(sql, params) {
  return pool.query(sql, params);
}

// Toma un cliente DEDICADO del pool. Es la diferencia que hace posible que las
// lecturas de la devolución vivan dentro de su transacción: con una sola
// conexión de módulo, BEGIN/COMMIT eran de conexión y no de petición, así que
// un ROLLBACK se llevaba por delante lo que otra petición estuviera haciendo.
async function enTransaccion(fn) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    // Aquí sí valen: SET LOCAL es de transacción, y el pooler lo respeta.
    await cliente.query("SET LOCAL statement_timeout = '5s'");
    await cliente.query("SET LOCAL lock_timeout = '3s'");
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    cliente.release();
    return resultado;
  } catch (err) {
    // pg 8.23 no cancela la consulta al agotar `query_timeout`: rechaza la
    // promesa pero la sentencia sigue corriendo del lado del servidor. Si es
    // el propio ROLLBACK el que se topa con ese timeout, el `.catch(() => {})`
    // de antes se tragaba el fallo y el `finally` devolvía al pool un cliente
    // con la transacción todavía abierta — el único punto por el que una
    // transacción podría cruzar de esta petición a la siguiente, justo lo que
    // esta migración vino a cerrar. Por eso el resultado del ROLLBACK decide
    // cómo se suelta el cliente: si falló, `release(true)` le dice a `pg` que
    // lo DESTRUYA en vez de devolverlo al pool para que otra petición lo
    // reutilice con una transacción colgada dentro.
    const rollbackFallo = await cliente.query('ROLLBACK').then(
      () => false,
      () => true
    );
    cliente.release(rollbackFallo);
    throw err;
  }
}

module.exports = { pool, consultar, enTransaccion };
