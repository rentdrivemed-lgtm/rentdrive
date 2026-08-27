// Helpers de servidor compartidos por el Panel de Control interno (Tareas /
// Calendario / Documentos / Tableros). Solo lo importan rutas de API.
import type Database from 'better-sqlite3';

type DB = Database.Database;

export type MiembroEquipo = { id: number; nombre: string; correo: string; admin_nivel: string };

// Lista de miembros del equipo (cuentas admin activas) — para asignar tareas,
// invitar a tableros, etc.
export function miembrosEquipo(db: DB): MiembroEquipo[] {
  // `estado_cuenta = 'activa'` (comparación directa, no `!= 'inactiva'`): la columna
  // tiene DEFAULT 'activa' + CHECK(IN ('activa','inactiva','archivada')) desde el
  // CREATE TABLE original (no es una columna agregada después sin default), así que
  // no hay cuentas legacy con estado_cuenta NULL que el COALESCE necesitara cubrir.
  // Con `!= 'inactiva'` una cuenta admin ARCHIVADA seguía colando como miembro de
  // equipo asignable/activo — con la comparación directa, solo 'activa' cuenta.
  return db.prepare(
    `SELECT id, nombre, correo, COALESCE(admin_nivel,'principal') AS admin_nivel
     FROM usuarios
     WHERE rol = 'admin' AND estado_cuenta = 'activa'
     ORDER BY nombre`
  ).all() as MiembroEquipo[];
}

// Notifica en la campana interna a un conjunto de destinatarios (por id).
export function notificarUsuarios(
  db: DB,
  destinatarios: number[],
  n: { tipo: string; titulo: string; mensaje: string; referencia_id?: number | null; referencia_tipo?: string },
) {
  if (!destinatarios.length) return;
  const ins = db.prepare(
    `INSERT INTO notificaciones (destinatario_id, tipo, titulo, mensaje, referencia_id, referencia_tipo)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const unicos = Array.from(new Set(destinatarios.filter(Boolean)));
  for (const uid of unicos) {
    try { ins.run(uid, n.tipo, n.titulo, n.mensaje, n.referencia_id ?? null, n.referencia_tipo ?? 'panel'); }
    catch (e) { console.error('[panel] notificar falló:', e instanceof Error ? e.message : e); }
  }
}

// ¿El usuario puede ver/editar este tablero? (es el creador o un colaborador invitado)
export function puedeVerTablero(db: DB, tableroId: number, userId: number): boolean {
  const t = db.prepare('SELECT created_by FROM tableros WHERE id = ?').get(tableroId) as { created_by: number } | undefined;
  if (!t) return false;
  if (Number(t.created_by) === userId) return true;
  const c = db.prepare('SELECT 1 FROM tablero_colaboradores WHERE tablero_id = ? AND usuario_id = ?').get(tableroId, userId);
  return !!c;
}

// Notifica a todo el equipo (opcionalmente excluyendo al autor de la acción).
// `soloSocios` restringe a dueño/socios (para eventos/tareas reservadas).
export function notificarEquipo(
  db: DB,
  n: { tipo: string; titulo: string; mensaje: string; excepto?: number; soloSocios?: boolean; referencia_id?: number | null; referencia_tipo?: string },
) {
  const miembros = miembrosEquipo(db).filter(m => {
    if (n.excepto && m.id === n.excepto) return false;
    if (n.soloSocios && !(m.admin_nivel === 'principal' || m.admin_nivel === 'socio')) return false;
    return true;
  });
  notificarUsuarios(db, miembros.map(m => m.id), n);
}
