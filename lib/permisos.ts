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
  nfc:          ['principal', 'socio'],
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

// ── Permisos por empleado (excepciones al nivel) ─────────────────────────────
// El nivel sigue siendo la plantilla base. Encima, cada cuenta de admin puede
// tener un mapa de excepciones explícitas: { "contabilidad": true, "vehiculos": false }.
// Un usuario sin excepciones se comporta EXACTAMENTE igual que antes de esta función.
export type PermisosExtra = Record<string, boolean>;

// `usuarios_gestion` es la raíz de confianza del sistema: quien la tiene puede
// repartir permisos y cambiar niveles. Si se pudiera otorgar por casilla, un socio
// con esa casilla podría auto-asignarse todo y escalar a dueño. Por eso queda
// atada al nivel `principal` y NUNCA es asignable por excepción.
//
// `config_editar` SÍ es asignable: solo permite guardar la comisión / pico y placa;
// no reparte permisos ni crea cuentas, así que no habilita escalada de privilegios.
export const AREA_NO_ASIGNABLE = 'usuarios_gestion';

// Lista blanca: únicas claves que pueden aparecer en un mapa de excepciones.
export const AREAS_ASIGNABLES: string[] = Object.keys(AREA_NIVELES).filter(a => a !== AREA_NO_ASIGNABLE);

export function esAreaAsignable(area: string): boolean {
  return area !== AREA_NO_ASIGNABLE && Object.prototype.hasOwnProperty.call(AREA_NIVELES, area);
}

// Etiquetas legibles: mismos nombres que muestran las pestañas del panel.
export const AREA_LABEL: Record<string, string> = {
  usuarios: 'Usuarios',
  vehiculos: 'Vehículos',
  reservas: 'Reservas',
  contabilidad: 'Contabilidad',
  mercado: 'Mercado',
  calculadora: 'Calculadora',
  leads: 'Leads',
  soporte: 'Soporte',
  nfc: 'Tarjetas NFC',
  config: 'Configuración',
  auditoria: 'Bitácora',
  operaciones: 'Operaciones',
  panel: 'Panel de hoy',
  tareas: 'Tareas',
  calendario: 'Calendario',
  documentos: 'Documentos',
  tableros: 'Tableros',
  config_editar: 'Guardar cambios de configuración',
  usuarios_gestion: 'Gestión del equipo',
};

export function areaLabel(area: string): string {
  return AREA_LABEL[area] || area;
}

// Agrupación para la interfaz de casillas. El último grupo recoge cualquier área
// asignable que no se haya listado arriba, para que nunca quede una sección oculta
// si se agrega una nueva a AREA_NIVELES.
const GRUPOS_BASE: { titulo: string; areas: string[] }[] = [
  { titulo: 'Panel de administración', areas: ['usuarios', 'vehiculos', 'reservas', 'contabilidad', 'mercado', 'calculadora', 'leads', 'soporte', 'nfc', 'config', 'auditoria'] },
  { titulo: 'Panel de control del equipo', areas: ['panel', 'operaciones', 'tareas', 'calendario', 'documentos', 'tableros'] },
  { titulo: 'Acciones sensibles', areas: ['config_editar'] },
];

export const GRUPOS_AREAS: { titulo: string; areas: string[] }[] = (() => {
  const listadas = new Set(GRUPOS_BASE.flatMap(g => g.areas));
  const grupos = GRUPOS_BASE.map(g => ({ titulo: g.titulo, areas: g.areas.filter(esAreaAsignable) }));
  const sueltas = AREAS_ASIGNABLES.filter(a => !listadas.has(a));
  return sueltas.length ? [...grupos, { titulo: 'Otras', areas: sueltas }] : grupos;
})();

// Parseo tolerante: acepta el string JSON de la columna o un objeto ya parseado.
// Cualquier cosa rara (JSON inválido, array, claves desconocidas, valores no
// booleanos, `usuarios_gestion`) se descarta en silencio. Nunca lanza.
export function parsePermisosExtra(raw: unknown): PermisosExtra {
  let valor: unknown = raw;
  if (typeof valor === 'string') {
    const s = valor.trim();
    if (!s) return {};
    try { valor = JSON.parse(s); } catch { return {}; }
  }
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return {};
  const out: PermisosExtra = {};
  for (const [clave, v] of Object.entries(valor as Record<string, unknown>)) {
    if (!esAreaAsignable(clave)) continue;
    if (typeof v !== 'boolean') continue;
    out[clave] = v;
  }
  return out;
}

export function serializarPermisosExtra(p: PermisosExtra): string {
  return JSON.stringify(parsePermisosExtra(p));
}

// Permiso efectivo. El tercer parámetro es OPCIONAL: sin él, el comportamiento es
// idéntico al de siempre (solo la matriz por nivel).
export function puede(nivel: AdminNivel, area: string, extra?: PermisosExtra | null): boolean {
  const permitidos = AREA_NIVELES[area];
  if (!permitidos) return false;
  if (extra && esAreaAsignable(area)) {
    const excepcion = extra[area];
    if (typeof excepcion === 'boolean') return excepcion;
  }
  return permitidos.includes(nivel);
}

// ¿Es dueño o socio? Usado para el contenido marcado "solo socios" (tareas,
// eventos y documentos restringidos que la secretaría no debe ver).
// OJO: esto va atado al NIVEL a propósito — las casillas por empleado no lo tocan.
export function esSocio(nivel: AdminNivel): boolean {
  return nivel === 'principal' || nivel === 'socio';
}

type DB = Database.Database;

export function nivelDe(db: DB, userId: number): AdminNivel {
  const r = db.prepare('SELECT admin_nivel FROM usuarios WHERE id = ?').get(userId) as { admin_nivel?: string } | undefined;
  return normalizarNivel(r?.admin_nivel);
}

// Nivel + excepciones en una sola consulta. Si la columna aún no existe (BD vieja),
// cae al comportamiento anterior (solo nivel) en vez de tumbar la petición.
export function permisosDe(db: DB, userId: number): { nivel: AdminNivel; extra: PermisosExtra } {
  try {
    const r = db.prepare('SELECT admin_nivel, permisos_extra FROM usuarios WHERE id = ?').get(userId) as
      { admin_nivel?: string; permisos_extra?: string } | undefined;
    return { nivel: normalizarNivel(r?.admin_nivel), extra: parsePermisosExtra(r?.permisos_extra) };
  } catch (e) {
    console.error('[permisos] no se pudo leer permisos_extra:', e instanceof Error ? e.message : e);
    return { nivel: nivelDe(db, userId), extra: {} };
  }
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
