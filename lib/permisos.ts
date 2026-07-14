// Roles internos del área administrativa (sub-niveles de rol='admin').
// Módulo PURO: sin imports de servidor (better-sqlite3 solo como tipo) para poder
// reutilizar la matriz de permisos también en componentes de cliente.
import type Database from 'better-sqlite3';

export type AdminNivel = 'principal' | 'socio' | 'secretaria';
export const NIVELES: AdminNivel[] = ['principal', 'socio', 'secretaria'];

export const NIVEL_LABEL: Record<AdminNivel, string> = {
  principal: 'Administrador principal',
  socio: 'Socio',
  secretaria: 'Secretaría / punto de atención',
};

export function esNivel(v: unknown): v is AdminNivel {
  return v === 'principal' || v === 'socio' || v === 'secretaria';
}
export function normalizarNivel(v: unknown): AdminNivel {
  return esNivel(v) ? v : 'principal';
}

// Matriz de acceso por área. Cambiar aquí ajusta permisos en todo el sistema
// (tabs del panel y gating de las APIs).
export const AREA_NIVELES: Record<string, AdminNivel[]> = {
  // Secciones (tabs)
  usuarios:     ['principal', 'socio'],
  vehiculos:    ['principal', 'socio'],
  reservas:     ['principal', 'socio', 'secretaria'],
  operaciones:  ['principal', 'socio', 'secretaria'],
  contabilidad: ['principal', 'socio'],
  mercado:      ['principal', 'socio'],
  calculadora:  ['principal', 'socio'],
  leads:        ['principal', 'socio', 'secretaria'],
  soporte:      ['principal', 'socio', 'secretaria'],
  config:       ['principal', 'socio'],
  auditoria:    ['principal', 'socio'],
  // Panel de Control interno (página aparte /control) — módulos de trabajo del equipo
  panel:        ['principal', 'socio', 'secretaria'],
  tareas:       ['principal', 'socio', 'secretaria'],
  calendario:   ['principal', 'socio', 'secretaria'],
  documentos:   ['principal', 'socio', 'secretaria'],
  tableros:     ['principal', 'socio', 'secretaria'],
  // Acciones sensibles (gating fino, más allá de ver la sección)
  usuarios_gestion: ['principal'], // crear cuentas de equipo, cambiar nivel/estado, resetear clave
  config_editar:    ['principal'], // guardar comisión / config
};

export function puede(nivel: AdminNivel, area: string): boolean {
  const permitidos = AREA_NIVELES[area];
  return permitidos ? permitidos.includes(nivel) : false;
}

// ¿Es dueño o socio? Usado para el contenido marcado "solo socios" (tareas,
// eventos y documentos restringidos que la secretaría no debe ver).
export function esSocio(nivel: AdminNivel): boolean {
  return nivel === 'principal' || nivel === 'socio';
}

type DB = Database.Database;

export function nivelDe(db: DB, userId: number): AdminNivel {
  const r = db.prepare('SELECT admin_nivel FROM usuarios WHERE id = ?').get(userId) as { admin_nivel?: string } | undefined;
  return normalizarNivel(r?.admin_nivel);
}

// Registro de auditoría (bitácora): quién hizo qué y a qué hora.
export function registrarAuditoria(
  db: DB,
  actor: { id: number; nombre?: string; correo?: string; nivel?: string },
  entry: { area: string; accion: string; detalle?: string; entidad?: string; entidad_id?: number | null },
) {
  try {
    db.prepare(
      `INSERT INTO auditoria (usuario_id, usuario_nombre, usuario_correo, usuario_nivel, area, accion, detalle, entidad, entidad_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      actor.id, actor.nombre || '', actor.correo || '', actor.nivel || '',
      entry.area, entry.accion, entry.detalle || '', entry.entidad || '', entry.entidad_id ?? null,
    );
  } catch (e) {
    console.error('[auditoria] no se pudo registrar:', e instanceof Error ? e.message : e);
  }
}
