-- Datos exportados desde rentdrive.db (SQLite)
-- Ejecutar DESPUÉS de schema.sql en el SQL Editor de Supabase
BEGIN;

-- usuarios: 5 filas
INSERT INTO usuarios (id,nombre,correo,password,rol,documento_identidad,estado_cuenta,celular,tipo_documento,fecha_nacimiento,direccion,ciudad,numero_licencia,contacto_emergencia,created_at) VALUES (1,'Administrador','admin@rentdrive.com','$2b$10$771FRh6KypQaooHdnmBWNueASOfQnNeCOVx5kjEO/7IWxhAbecs6e','admin',NULL,'activa','','cedula','','','Medellín','','{}','2026-05-07 21:55:21');
COMMIT;