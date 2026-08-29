-- Cambio de UN SOLO USO sobre la base ya desplegada: los roles pasan de ser un
-- CHECK con dos valores a una tabla con permisos, que es lo que permite crear
-- roles nuevos desde la pantalla de cuentas.
--
-- ESTE ARCHIVO NO ES UNA MIGRACIÓN NI HAY RUNNER QUE LO EJECUTE. Aquí no se
-- volvió a meter el sistema de migraciones que se fue con SQLite: el estado
-- final del esquema vive —y sigue viviendo— en db/esquema.sql, que es lo que
-- se aplica a una instalación nueva y lo que leen los tests. Esto existe sólo
-- porque la base de producción ya estaba creada cuando el cambio se hizo.
--
-- Se aplica una vez, a mano:
--   psql "$DATABASE_URL" -f db/cambio-2026-08-roles.sql
-- (o con execute_sql del MCP de Supabase). Después, este archivo es historia.
--
-- Va todo en una transacción: a media aplicación, con la tabla creada pero sin
-- la clave foránea, la aplicación arrancaría y el guardia no encontraría ni un
-- permiso — es decir, nadie podría hacer nada.

BEGIN;

CREATE TABLE roles (
  nombre      text PRIMARY KEY,
  descripcion text,
  permisos    text[] NOT NULL DEFAULT '{}',
  semilla     integer NOT NULL DEFAULT 0
);

INSERT INTO roles (nombre, descripcion, permisos, semilla) VALUES
  ('superadmin', 'Gestiona cuentas y roles, ve la bitácora y borra productos.',
   '{productos.eliminar,cuentas.gestionar,accesos.ver}', 1),
  ('admin', 'Operación diaria del almacén: inventario, órdenes y devoluciones.',
   '{}', 0);

-- El CHECK se va y la FK ocupa su sitio. El orden importa: mientras el CHECK
-- exista, ningún rol nuevo cabría en la columna.
ALTER TABLE cuentas DROP CONSTRAINT cuentas_rol_check;

ALTER TABLE cuentas
  ADD CONSTRAINT cuentas_rol_fkey FOREIGN KEY (rol) REFERENCES roles(nombre);

COMMIT;

-- Comprobación después de aplicar (debe devolver las cuentas con su rol y los
-- permisos que ese rol trae; si alguna sale sin fila de roles, la FK no está):
--   SELECT c.usuario, c.rol, r.permisos
--   FROM cuentas c JOIN roles r ON r.nombre = c.rol
--   ORDER BY c.id_cuenta;
