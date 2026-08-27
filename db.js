// Única puerta a Postgres. Nadie más construye conexiones.
const { Pool } = require('pg');
const fs = require('node:fs');
const path = require('node:path');

// CA raíz del pooler de Supabase. Es pública, no es un secreto, y por eso se
// versiona: el certificado del pooler no está firmado por una CA del trust
// store de Node, así que sin esto no hay forma de verificarlo.
const ca = fs.readFileSync(path.join(__dirname, 'certs', 'supabase-ca.crt'), 'utf8');

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
});

// Los tests aíslan cada archivo en su propio esquema. En producción no se fija
// y todo vive en `public`.
//
// ESQUEMA_BD se lee DENTRO del callback y no al cargar el módulo, y no es un
// detalle de estilo: si se leyera arriba, bastaría con que un archivo de test
// requiriese este módulo antes de fijar la variable para que el hook quedara
// registrado con `undefined` y el search_path no se aplicara nunca. Los tests
// correrían entonces contra `public` — es decir, contra los datos reales del
// almacén, ejecutando TRUNCATE sobre ellos.
pool.on('connect', (cliente) => {
  const esquema = process.env.ESQUEMA_BD;
  if (esquema) cliente.query(`SET search_path TO ${esquema}`);
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
    return resultado;
  } catch (err) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    cliente.release();
  }
}

module.exports = { pool, consultar, enTransaccion };
