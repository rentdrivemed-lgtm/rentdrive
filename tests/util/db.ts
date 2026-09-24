// Base de pruebas: el esquema REAL, en memoria, una por archivo de prueba.
//
// Se levanta con `initDb` de lib/db.ts —la misma función que usa la aplicación— para
// que las pruebas se rompan cuando cambie una restricción del esquema. Una copia del
// DDL escrita a mano aquí se desincronizaría al primer ALTER y las pruebas pasarían
// verificando algo que ya no existe.
import Database from 'better-sqlite3';
import { initDb } from '@/lib/db';

export type DB = Database.Database;

export function baseDePrueba(): DB {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initDb(db);
  return db;
}

let secuencia = 0;

/**
 * Crea una cuenta con el perfil COMPLETO (los cinco campos que exige el contrato de
 * vinculación). Se le pasa `parcial` para dejar alguno en blanco a propósito.
 */
export function crearUsuario(db: DB, parcial: Partial<{
  nombre: string; correo: string; rol: string; documento: string;
  ciudad: string; direccion: string; estado_cuenta: string;
}> = {}): number {
  secuencia += 1;
  const nombre = parcial.nombre ?? `Persona De Prueba ${secuencia}`;
  const correo = parcial.correo ?? `persona${secuencia}@ejemplo.com`;
  const rol = parcial.rol ?? 'usuario';

  const res = db.prepare(
    "INSERT INTO usuarios (nombre, correo, password, rol, documento_identidad, estado_cuenta) VALUES (?,?,?,?,?,?)"
  ).run(
    nombre, correo, 'x', rol,
    parcial.documento ?? `10000000${secuencia}`,
    parcial.estado_cuenta ?? 'activa',
  );
  const id = Number(res.lastInsertRowid);

  // ciudad y direccion son columnas añadidas por migración: se escriben aparte para no
  // depender de su posición en el INSERT de arriba.
  db.prepare('UPDATE usuarios SET ciudad = ?, direccion = ? WHERE id = ?')
    .run(parcial.ciudad ?? 'Medellín', parcial.direccion ?? 'Calle 10 # 20-30', id);

  return id;
}

/** Un admin con los permisos que se le pasen, en el nivel indicado. */
export function crearAdmin(db: DB, nivel: 'principal' | 'socio' | 'secretaria', areas?: string[]): number {
  const id = crearUsuario(db, { rol: 'admin' });
  db.prepare('UPDATE usuarios SET admin_nivel = ? WHERE id = ?').run(nivel, id);
  if (areas) {
    db.prepare('UPDATE usuarios SET admin_areas = ? WHERE id = ?').run(JSON.stringify(areas), id);
  }
  return id;
}
