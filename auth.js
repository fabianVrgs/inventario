// Criptografía de la autenticación: contraseñas, tokens de sesión, segundo
// factor y códigos de respaldo.
//
// Vive fuera de server.js —que por lo demás sigue siendo monolítico a
// propósito— por dos razones. La primera es que aquí no hay ni una petición
// HTTP: son funciones puras que se pueden probar sin levantar un servidor, y
// este es justo el código en el que un fallo silencioso cuesta más caro. La
// segunda es que su corrección se argumenta en términos que no tienen nada que
// ver con inventarios, y mezclarlo con las rutas obligaría a leer las dos cosas
// a la vez.
//
// CERO DEPENDENCIAS NUEVAS: todo sale de node:crypto. No es purismo. Cada
// paquete que se añade es código de terceros que corre con los mismos permisos
// que el nuestro y que hay que mantener actualizado; para lo que hace falta
// aquí, la biblioteca estándar ya trae scrypt (RFC 7914) y HMAC.

'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);

// ---------------------------------------------------------------------------
// Contraseñas
// ---------------------------------------------------------------------------

// Parámetros de scrypt. N es el coste: 2^16 pide 64 MiB de memoria por intento
// (128 * N * r bytes), lo que tarda ~100-200 ms en hardware normal. Para dos
// usuarios que entran una vez al día es imperceptible; para quien pruebe
// millones de combinaciones con GPUs es la diferencia entre horas y siglos,
// porque scrypt es duro en MEMORIA y no sólo en CPU — y la memoria es
// justamente lo que no se paraleliza barato.
//
// `maxmem` va por encima de lo que pide N para que node no aborte con
// ERR_CRYPTO_INVALID_SCRYPT_PARAM: el límite por defecto son 32 MiB.
const N = 2 ** 16;
const R = 8;
const P = 1;
const LARGO_CLAVE = 64;
const MAXMEM = 128 * N * R * 2;

// El formato es AUTODESCRIPTIVO: cada hash lleva encima los parámetros con los
// que se generó. Así, el día que 2^16 se quede corto, basta subir N para las
// contraseñas nuevas — las viejas se siguen verificando con los suyos y se
// migran al vuelo cuando su dueño vuelva a escribirlas.
//
//   scrypt$65536$8$1$<sal en base64>$<hash en base64>
function serializar(sal, derivada) {
  return ['scrypt', N, R, P, sal.toString('base64'), derivada.toString('base64')].join('$');
}

function deserializar(texto) {
  if (typeof texto !== 'string') return null;
  const partes = texto.split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return null;

  const n = Number(partes[1]);
  const r = Number(partes[2]);
  const p = Number(partes[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return null;

  return {
    n,
    r,
    p,
    sal: Buffer.from(partes[4], 'base64'),
    derivada: Buffer.from(partes[5], 'base64'),
  };
}

async function hashear(clave) {
  if (typeof clave !== 'string' || clave.length === 0) {
    throw new TypeError('La contraseña debe ser una cadena no vacía.');
  }
  // Sal por cuenta, aleatoria: sin ella, dos personas con la misma contraseña
  // tendrían el mismo hash, y una sola tabla precalculada las rompería a las
  // dos de golpe.
  const sal = crypto.randomBytes(16);
  const derivada = await scrypt(clave, sal, LARGO_CLAVE, { N, r: R, p: P, maxmem: MAXMEM });
  return serializar(sal, derivada);
}

async function verificar(clave, hash) {
  const partes = deserializar(hash);
  if (!partes || typeof clave !== 'string' || partes.derivada.length === 0) return false;

  const derivada = await scrypt(clave, partes.sal, partes.derivada.length, {
    N: partes.n,
    r: partes.r,
    p: partes.p,
    maxmem: 128 * partes.n * partes.r * 2,
  });

  return iguales(derivada, partes.derivada);
}

// `timingSafeEqual` exige buffers del mismo largo y lanza si no lo son, así que
// la comprobación de longitud va antes. Compararlos con === filtraría
// información por el tiempo de respuesta: la comparación normal de cadenas se
// corta en el primer byte distinto, y medir eso permite adivinar un secreto
// byte a byte.
function iguales(a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b) || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Hash contra el que verificar cuando el usuario NO existe.
//
// Sin esto, un login con usuario inexistente respondería en un milisegundo y
// uno con contraseña equivocada en doscientos, y esa diferencia es un oráculo:
// permite averiguar qué cuentas existen sin acertar ni una contraseña. Con
// esto, los dos caminos hacen exactamente el mismo trabajo.
//
// Se calcula una sola vez y en diferido: hacerlo al cargar el módulo añadiría
// 200 ms al arranque del servidor por algo que quizá no llegue a usarse.
let señuelo = null;
async function hashSeñuelo() {
  if (!señuelo) señuelo = await hashear(crypto.randomBytes(32).toString('hex'));
  return señuelo;
}

// ---------------------------------------------------------------------------
// Tokens de sesión
// ---------------------------------------------------------------------------

// 256 bits de aleatoriedad criptográfica. Adivinar uno por fuerza bruta no es
// "difícil", es imposible en cualquier sentido físico del término, así que la
// sesión no necesita más protección que no filtrarse.
function nuevoToken() {
  return crypto.randomBytes(32).toString('base64url');
}

// En la base se guarda ESTO, no el token. Un token robado de la tabla no
// existe: de un SHA-256 no se vuelve atrás.
//
// Aquí sí vale un hash rápido, al revés que con las contraseñas: el token ya
// tiene 256 bits de entropía, así que no hay diccionario que probar, y
// encarecer el cálculo sólo penalizaría a cada petición legítima.
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// ---------------------------------------------------------------------------
// Segundo factor (TOTP, RFC 6238)
// ---------------------------------------------------------------------------
// DORMIDO desde el 2026-08-28: nada llama a este bloque ni a los códigos de
// respaldo de más abajo. Se conserva a propósito para que volver al segundo
// factor sea recablear y no reescribir. No lo borres por parecer un resto.

const ALFABETO_BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PASO_SEGUNDOS = 30;
const DIGITOS = 6;
// Ventana de tolerancia, en pasos hacia atrás y hacia adelante. ±1 son 30
// segundos de margen: suficiente para un reloj de móvil algo desfasado y para
// quien empieza a teclear justo antes de que el código cambie. Más ventana es
// más superficie: cada paso admitido es otro código válido a la vez.
const VENTANA = 1;

function aBase32(buffer) {
  let bits = 0;
  let valor = 0;
  let salida = '';

  for (const byte of buffer) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      salida += ALFABETO_BASE32[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) salida += ALFABETO_BASE32[(valor << (5 - bits)) & 31];

  return salida;
}

function desdeBase32(texto) {
  let bits = 0;
  let valor = 0;
  const bytes = [];

  for (const caracter of String(texto).toUpperCase().replace(/=+$/, '')) {
    const indice = ALFABETO_BASE32.indexOf(caracter);
    if (indice === -1) throw new Error(`Carácter inválido en base32: ${caracter}`);
    valor = (valor << 5) | indice;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

// 160 bits, que es el largo del bloque de SHA-1 y lo que recomienda el RFC 4226.
function secretoTotp() {
  return aBase32(crypto.randomBytes(20));
}

// URI que consumen Google Authenticator, Aegis, 1Password y compañía, sea
// tecleada o dentro de un QR. El emisor sale dos veces —en la etiqueta y en el
// parámetro— porque hay apps que sólo leen una de las dos.
function uriTotp(usuario, secreto, emisor = 'Ok-producciones Almacen') {
  const etiqueta = encodeURIComponent(`${emisor}:${usuario}`);
  const parametros = new URLSearchParams({
    secret: secreto,
    issuer: emisor,
    algorithm: 'SHA1',
    digits: String(DIGITOS),
    period: String(PASO_SEGUNDOS),
  });
  return `otpauth://totp/${etiqueta}?${parametros}`;
}

function pasoActual(ahoraMs = Date.now()) {
  return Math.floor(ahoraMs / 1000 / PASO_SEGUNDOS);
}

// HOTP del RFC 4226: HMAC-SHA1 sobre el contador en 8 bytes big-endian, y de
// ahí una "truncación dinámica" que elige 4 bytes según el último nibble del
// resultado. El & 0x7f del primero borra el bit de signo, porque el RFC se
// escribió pensando en enteros de 32 bits con signo.
function codigoPara(secreto, paso) {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(paso));

  const hmac = crypto.createHmac('sha1', desdeBase32(secreto)).update(contador).digest();
  const desplazamiento = hmac[hmac.length - 1] & 0x0f;
  const binario =
    ((hmac[desplazamiento] & 0x7f) << 24) |
    (hmac[desplazamiento + 1] << 16) |
    (hmac[desplazamiento + 2] << 8) |
    hmac[desplazamiento + 3];

  return String(binario % 10 ** DIGITOS).padStart(DIGITOS, '0');
}

// Devuelve { ok, paso }. `paso` es el que se consumió, y quien llama TIENE que
// guardarlo en cuentas.totp_ultimo_paso.
//
// El anti-replay es la parte que se olvida y la que más importa: un código vale
// durante 30 segundos completos, así que quien lo lea por encima del hombro, o
// lo intercepte, puede reutilizarlo dentro de esa ventana. Se rechaza cualquier
// paso MENOR O IGUAL al último consumido, no sólo el igual: aceptar uno
// anterior que aún caiga dentro de la ventana sería la misma reutilización por
// otro camino.
function verificarTotp(secreto, codigo, ultimoPaso = null, ahoraMs = Date.now()) {
  const limpio = String(codigo ?? '').replace(/\s/g, '');
  if (!new RegExp(`^\\d{${DIGITOS}}$`).test(limpio)) return { ok: false, paso: null };

  const centro = pasoActual(ahoraMs);

  for (let salto = -VENTANA; salto <= VENTANA; salto += 1) {
    const paso = centro + salto;
    if (ultimoPaso !== null && paso <= ultimoPaso) continue;

    const esperado = Buffer.from(codigoPara(secreto, paso), 'utf8');
    if (iguales(Buffer.from(limpio, 'utf8'), esperado)) return { ok: true, paso };
  }

  return { ok: false, paso: null };
}

// ---------------------------------------------------------------------------
// Códigos de respaldo
// ---------------------------------------------------------------------------

// La salida de emergencia que tendría el segundo factor si estuviera activo:
// hoy el login es de un solo paso y perder el móvil no cuesta nada. Este
// bloque está DORMIDO igual que el TOTP de arriba —ver la nota que lo precede.
//
// Alfabeto sin 0/O ni 1/I/L: se leen en papel y se teclean a mano, y confundir
// dos caracteres gasta un código de un solo uso.
const ALFABETO_RESPALDO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODIGOS_RESPALDO = 8;

function generarCodigosRespaldo(cuantos = CODIGOS_RESPALDO) {
  const codigos = [];

  for (let i = 0; i < cuantos; i += 1) {
    let bruto = '';
    // randomInt y no Math.random: esto es una credencial, no un sorteo.
    for (let j = 0; j < 10; j += 1) {
      bruto += ALFABETO_RESPALDO[crypto.randomInt(ALFABETO_RESPALDO.length)];
    }
    codigos.push(`${bruto.slice(0, 5)}-${bruto.slice(5)}`);
  }

  return codigos;
}

// Se normaliza antes de hashear y antes de comparar, para que el guion y las
// mayúsculas no decidan si alguien puede entrar.
function normalizarCodigoRespaldo(codigo) {
  return String(codigo ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

module.exports = {
  hashear,
  verificar,
  hashSeñuelo,
  nuevoToken,
  hashToken,
  secretoTotp,
  uriTotp,
  verificarTotp,
  codigoPara,
  pasoActual,
  generarCodigosRespaldo,
  normalizarCodigoRespaldo,
  PASO_SEGUNDOS,
  CODIGOS_RESPALDO,
};
