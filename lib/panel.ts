// Helpers de servidor compartidos por el Panel de Control interno (Tareas /
// Calendario / Documentos / Tableros). Solo lo importan rutas de API.
import type Database from 'better-sqlite3';

type DB = Database.Database;

export type MiembroEquipo = { id: number; nombre: string; correo: string; admin_nivel: string };

// Lista de miembros del equipo (cuentas admin activas) — para asignar tareas,
// invitar a tableros, etc.
export function miembrosEquipo(db: DB): MiembroEquipo[] {
  return db.prepare(
    `SELECT id, nombre, correo, COALESCE(admin_nivel,'principal') AS admin_nivel
     FROM usuarios
     WHERE rol = 'admin' AND COALESCE(estado_cuenta,'activa') != 'inactiva'
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
