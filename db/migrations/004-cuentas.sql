-- Migración 004: cuentas, sesiones y bitácora de accesos
--
-- Hasta aquí la aplicación no tenía autenticación de ninguna clase: cualquiera
-- que alcanzara el puerto podía descontar stock, emitir órdenes y borrar
-- productos. Daba igual mientras corría en localhost; deja de dar igual en el
-- momento en que se publica en internet, que es lo que motiva esta migración.
--
-- Dos roles y nada más: `admin` para el almacén (todo lo operativo) y
-- `superadmin` para el dueño (además, gestión de cuentas y borrado definitivo
-- de productos, que es la única operación irreversible del CRUD).
--
-- POR QUÉ TABLAS NUEVAS Y NO COLUMNAS EN `usuarios`
-- El bloque de arranque de server.js solo puede garantizar tablas mediante
-- CREATE TABLE IF NOT EXISTS, y SQLite no admite IF NOT EXISTS en
-- ALTER TABLE ... ADD COLUMN. Es la misma razón por la que la 003 fue una tabla
-- (`devoluciones`) y no una columna `ordenes.devuelta_en`. Con nombres nuevos,
-- el bloque de arranque basta para dejar cualquier base utilizable.
--
-- ESTA MIGRACIÓN NO ES PURAMENTE ADITIVA, a diferencia de la 002 y la 003.
-- Los DROP del final se llevan `usuarios` y `historial_login`:
--   * `historial_login` nunca tuvo una sola fila ni ninguna ruta que la usara.
--   * `usuarios` contenía UNA fila, `admin` / `1234`, con la contraseña EN
--     TEXTO PLANO. Como db/inventario.db3 está versionado en git, esa
--     contraseña ya vive en el historial del repositorio de forma permanente y
--     borrarla aquí no la borra de allí. Por eso `1234` no puede volver a
--     usarse nunca, en ninguna cuenta.
-- Revertir, por tanto, no es un DROP limpio: recuperar aquellas dos tablas
-- exige db/inventario.db3.pre-004.bak. Haz la copia antes de aplicar esto.
--
-- `cuentas` NACE VACÍA Y SE QUEDA VACÍA en la base versionada. Las cuentas se
-- crean en cada despliegue con `node scripts/cuenta.js crear`, de modo que
-- ningún hash de contraseña llegue jamás a GitHub. Es lo que permite seguir
-- versionando db/inventario.db3 con los datos de arranque del almacén, como
-- hasta ahora.

BEGIN TRANSACTION;

-- Las credenciales. `hash` guarda scrypt en formato autodescriptivo
-- (scrypt$N$r$p$sal$hash) para poder subir el coste más adelante sin invalidar
-- los hashes ya emitidos: cada uno lleva encima los parámetros con los que se
-- generó. La contraseña en claro no se escribe en ninguna parte, nunca.
CREATE TABLE IF NOT EXISTS cuentas (
  id_cuenta        INTEGER PRIMARY KEY AUTOINCREMENT,
  -- COLLATE NOCASE: "Erick" y "erick" son la misma persona, y que el UNIQUE lo
  -- impida es mejor que descubrirlo el día que existan las dos cuentas.
  usuario          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  hash             TEXT NOT NULL,
  rol              TEXT NOT NULL CHECK (rol IN ('admin', 'superadmin')),
  -- NULL = esta cuenta no usa segundo factor. Se guarda en base32 porque es lo
  -- que consumen las apps de autenticación por URI otpauth://.
  totp_secreto     TEXT,
  -- Último paso de 30 s consumido. Sin esto, un código interceptado sirve
  -- durante toda su ventana: verificar que "es válido" no basta, hay que
  -- verificar que no se ha usado ya.
  totp_ultimo_paso INTEGER,
  creada_en        TEXT NOT NULL,           -- ISO-8601 en UTC, lo pone el servidor
  activa           INTEGER NOT NULL DEFAULT 1
);

-- Una fila por sesión abierta. Lo que se guarda es el SHA-256 del token, NO el
-- token: quien se lleve el archivo .db3 no se lleva ni una sesión utilizable,
-- porque de un hash no se vuelve al valor de la cookie. Es la misma razón por
-- la que la contraseña se guarda hasheada, aplicada a la credencial temporal.
--
-- Estar en la base y no en un JWT es lo que hace que cerrar una sesión sea
-- borrar una fila, con efecto inmediato. Un token firmado no se puede revocar
-- sin una lista negra, que acabaría siendo esta misma tabla con pasos de más.
CREATE TABLE IF NOT EXISTS sesiones (
  id_sesion  INTEGER PRIMARY KEY AUTOINCREMENT,
  hash_token TEXT NOT NULL UNIQUE,
  id_cuenta  INTEGER NOT NULL REFERENCES cuentas(id_cuenta),
  creada_en  TEXT NOT NULL,
  -- Dos vencimientos y no uno: `expira_en` es el techo absoluto (una sesión no
  -- dura eternamente aunque se use) y `vista_en` alimenta el corte por
  -- inactividad (una tablet olvidada en el almacén se cierra sola).
  vista_en   TEXT NOT NULL,
  expira_en  TEXT NOT NULL,
  ip         TEXT,
  agente     TEXT
);

CREATE INDEX IF NOT EXISTS idx_sesiones_cuenta ON sesiones(id_cuenta);

-- Códigos de un solo uso para entrar cuando el segundo factor no está a mano.
-- Sin ellos, perder el móvil equivale a perder la cuenta de superadmin y con
-- ella la capacidad de gestionar cuentas: el candado se cierra por dentro.
-- Se hashean igual que las contraseñas, por el mismo motivo.
CREATE TABLE IF NOT EXISTS codigos_respaldo (
  id_codigo INTEGER PRIMARY KEY AUTOINCREMENT,
  id_cuenta INTEGER NOT NULL REFERENCES cuentas(id_cuenta),
  hash      TEXT NOT NULL,
  usado_en  TEXT                             -- NULL mientras siga disponible
);

CREATE INDEX IF NOT EXISTS idx_codigos_respaldo_cuenta ON codigos_respaldo(id_cuenta);

-- Bitácora de intentos de entrada. `usuario` guarda LO QUE SE TECLEÓ, exista o
-- no esa cuenta, y por eso es TEXT suelto y no una clave foránea: los intentos
-- contra nombres inventados son justo los que delatan un ataque, y una FK los
-- haría imposibles de registrar.
CREATE TABLE IF NOT EXISTS accesos (
  id_acceso   INTEGER PRIMARY KEY AUTOINCREMENT,
  ocurrido_en TEXT NOT NULL,
  usuario     TEXT,
  resultado   TEXT NOT NULL,                 -- ok | clave | totp | bloqueado | salida
  ip          TEXT
);

CREATE INDEX IF NOT EXISTS idx_accesos_fecha ON accesos(ocurrido_en);

-- Lo prometido arriba. `usuarios` se lleva consigo el admin/1234 en claro.
DROP TABLE IF EXISTS historial_login;
DROP TABLE IF EXISTS usuarios;

COMMIT;
