// Tests de auth.js. No levantan servidor ni tocan la base: son funciones puras,
// y poder probarlas así es justamente por lo que el módulo está separado.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const auth = require('../auth.js');

// ---------------------------------------------------------------------------
// Contraseñas
// ---------------------------------------------------------------------------

test('hashear acepta la contraseña correcta y rechaza la equivocada', async () => {
  const hash = await auth.hashear('Almacen2026Prueba!');

  assert.equal(await auth.verificar('Almacen2026Prueba!', hash), true);
  assert.equal(await auth.verificar('Almacen2026Prueba', hash), false);
  assert.equal(await auth.verificar('', hash), false);
});

test('la misma contraseña produce hashes distintos', async () => {
  // Si la sal no fuese aleatoria por cuenta, dos personas con la misma
  // contraseña compartirían hash y una tabla precalculada las rompería a la vez.
  const [a, b] = await Promise.all([auth.hashear('misma clave larga'), auth.hashear('misma clave larga')]);

  assert.notEqual(a, b);
  assert.equal(await auth.verificar('misma clave larga', a), true);
  assert.equal(await auth.verificar('misma clave larga', b), true);
});

test('el hash lleva encima sus propios parámetros', async () => {
  const hash = await auth.hashear('otra clave larga');
  const partes = hash.split('$');

  assert.equal(partes.length, 6);
  assert.equal(partes[0], 'scrypt');
  assert.equal(Number(partes[1]), 2 ** 16);
});

test('verifica hashes generados con parámetros antiguos', async () => {
  // La razón de ser del formato autodescriptivo: subir el coste para las
  // contraseñas nuevas no puede dejar fuera a quien ya tenía una.
  const sal = crypto.randomBytes(16);
  const derivada = crypto.scryptSync('clave del pasado', sal, 64, { N: 1024, r: 8, p: 1 });
  const viejo = ['scrypt', 1024, 8, 1, sal.toString('base64'), derivada.toString('base64')].join('$');

  assert.equal(await auth.verificar('clave del pasado', viejo), true);
  assert.equal(await auth.verificar('otra cosa', viejo), false);
});

test('un hash corrupto no deja entrar a nadie', async () => {
  for (const basura of ['', 'x', 'scrypt$a$b$c$d$e', 'bcrypt$1$2$3$4$5', null, undefined, 42]) {
    assert.equal(await auth.verificar('lo que sea', basura), false, `no debía aceptar ${basura}`);
  }
});

test('el hash señuelo es verificable y estable', async () => {
  // Existe para que un usuario inexistente cueste lo mismo que una contraseña
  // equivocada. Si cambiara en cada llamada, cada login pagaría un hasheo extra.
  const uno = await auth.hashSeñuelo();
  const dos = await auth.hashSeñuelo();

  assert.equal(uno, dos);
  assert.equal(await auth.verificar('cualquier cosa', uno), false);
});

// ---------------------------------------------------------------------------
// Tokens de sesión
// ---------------------------------------------------------------------------

test('los tokens de sesión son largos y nunca se repiten', () => {
  const vistos = new Set();
  for (let i = 0; i < 500; i += 1) vistos.add(auth.nuevoToken());

  assert.equal(vistos.size, 500);
  // 32 bytes en base64url son 43 caracteres.
  assert.equal(auth.nuevoToken().length, 43);
});

test('hashToken es determinista y no reversible a simple vista', () => {
  const token = auth.nuevoToken();

  assert.equal(auth.hashToken(token), auth.hashToken(token));
  assert.notEqual(auth.hashToken(token), token);
  assert.match(auth.hashToken(token), /^[0-9a-f]{64}$/);
  assert.notEqual(auth.hashToken(token), auth.hashToken(auth.nuevoToken()));
});

// ---------------------------------------------------------------------------
// TOTP
// ---------------------------------------------------------------------------

// "12345678901234567890" en ASCII, codificado en base32: el secreto de los
// vectores de prueba del RFC 6238.
const SECRETO_RFC = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test('codigoPara reproduce los vectores del RFC 6238', () => {
  // El RFC publica los códigos de 8 dígitos; los nuestros son de 6, o sea los
  // seis últimos. Que esto cuadre es lo que garantiza que cualquier app de
  // autenticación calcule lo mismo que nosotros.
  assert.equal(auth.codigoPara(SECRETO_RFC, Math.floor(59 / 30)), '287082');
  assert.equal(auth.codigoPara(SECRETO_RFC, Math.floor(1111111109 / 30)), '081804');
  assert.equal(auth.codigoPara(SECRETO_RFC, Math.floor(1234567890 / 30)), '005924');
});

test('secretoTotp genera secretos base32 de 160 bits', () => {
  const secreto = auth.secretoTotp();

  assert.equal(secreto.length, 32); // 20 bytes en base32
  assert.match(secreto, /^[A-Z2-7]+$/);
  assert.notEqual(secreto, auth.secretoTotp());
});

test('uriTotp arma un otpauth:// que las apps saben leer', () => {
  const uri = auth.uriTotp('erick', SECRETO_RFC);

  assert.ok(uri.startsWith('otpauth://totp/'));
  assert.ok(uri.includes(`secret=${SECRETO_RFC}`));
  assert.ok(uri.includes('digits=6'));
  assert.ok(uri.includes('period=30'));
});

test('verificarTotp acepta el código del momento', () => {
  const ahora = 1_700_000_000_000;
  const paso = auth.pasoActual(ahora);

  const resultado = auth.verificarTotp(SECRETO_RFC, auth.codigoPara(SECRETO_RFC, paso), null, ahora);

  assert.equal(resultado.ok, true);
  assert.equal(resultado.paso, paso);
});

test('verificarTotp rechaza el mismo código dos veces', () => {
  // Anti-replay. Un código vale 30 segundos enteros: sin esto, quien lo lea por
  // encima del hombro entra con él mientras siga en ventana.
  const ahora = 1_700_000_000_000;
  const paso = auth.pasoActual(ahora);
  const codigo = auth.codigoPara(SECRETO_RFC, paso);

  const primero = auth.verificarTotp(SECRETO_RFC, codigo, null, ahora);
  assert.equal(primero.ok, true);

  const segundo = auth.verificarTotp(SECRETO_RFC, codigo, primero.paso, ahora);
  assert.equal(segundo.ok, false, 'el mismo código no puede servir dos veces');
});

test('verificarTotp rechaza un código anterior al ya consumido', () => {
  // La misma reutilización por otro camino: el paso previo sigue dentro de la
  // ventana de ±1, así que rechazar sólo el igual no bastaría.
  const ahora = 1_700_000_000_000;
  const paso = auth.pasoActual(ahora);

  const anterior = auth.verificarTotp(SECRETO_RFC, auth.codigoPara(SECRETO_RFC, paso - 1), paso, ahora);

  assert.equal(anterior.ok, false);
});

test('verificarTotp tolera un paso de desfase, pero no dos', () => {
  const ahora = 1_700_000_000_000;
  const paso = auth.pasoActual(ahora);

  assert.equal(auth.verificarTotp(SECRETO_RFC, auth.codigoPara(SECRETO_RFC, paso - 1), null, ahora).ok, true);
  assert.equal(auth.verificarTotp(SECRETO_RFC, auth.codigoPara(SECRETO_RFC, paso + 1), null, ahora).ok, true);
  assert.equal(auth.verificarTotp(SECRETO_RFC, auth.codigoPara(SECRETO_RFC, paso - 2), null, ahora).ok, false);
  assert.equal(auth.verificarTotp(SECRETO_RFC, auth.codigoPara(SECRETO_RFC, paso + 2), null, ahora).ok, false);
});

test('verificarTotp descarta lo que ni siquiera son seis dígitos', () => {
  for (const basura of ['', '12345', '1234567', 'abcdef', null, undefined, {}]) {
    assert.equal(auth.verificarTotp(SECRETO_RFC, basura).ok, false, `no debía aceptar ${basura}`);
  }
});

// ---------------------------------------------------------------------------
// Códigos de respaldo
// ---------------------------------------------------------------------------

test('genera ocho códigos de respaldo distintos y legibles', () => {
  const codigos = auth.generarCodigosRespaldo();

  assert.equal(codigos.length, 8);
  assert.equal(new Set(codigos).size, 8);

  for (const codigo of codigos) {
    assert.match(codigo, /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    // Sin caracteres que se confundan al teclear desde un papel.
    assert.ok(!/[01OIL]/.test(codigo), `${codigo} trae un carácter ambiguo`);
  }
});

test('normalizarCodigoRespaldo ignora guiones, espacios y mayúsculas', () => {
  assert.equal(auth.normalizarCodigoRespaldo('abcde-fghjk'), 'ABCDEFGHJK');
  assert.equal(auth.normalizarCodigoRespaldo('ABCDE FGHJK'), 'ABCDEFGHJK');
  assert.equal(auth.normalizarCodigoRespaldo('ABCDEFGHJK'), 'ABCDEFGHJK');
  assert.equal(auth.normalizarCodigoRespaldo(null), '');
});
