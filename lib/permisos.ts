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
// Utilidad GENÉRICA: normaliza un valor crudo (típicamente `usuarios.admin_nivel`
// de una fila que YA SABEMOS que existe y está activa, o el `admin_nivel` que llegó
// en el body al crear una cuenta nueva) a un nivel válido, cayendo a 'principal' si
// viene vacío/corrupto. A propósito NO es la función que decide si una sesión puede
// autorizar una request: para eso ver `nivelDe`/`permisosDe` más abajo, que sí
// distinguen "la fila no existe o está inactiva/archivada" (deniega todo) de "la fila
// existe y está activa, pero el valor guardado es raro" (aquí sí cae a 'principal',
// igual que el DEFAULT de la columna en la BD — ver lib/db.ts).
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
  // Contratos digitales: ver, emitir y anular los seis documentos de una reserva.
  // Se le da a los mismos niveles que contabilidad (no a secretaría) porque un
  // documento emitido es un acto jurídico con el cliente y con el propietario, y
  // anularlo tumba firmas ya recogidas.
  contratos:    ['principal', 'socio'],
  mercado:      ['principal', 'socio'],
  calculadora:  ['principal', 'socio'],
  buses:        ['principal', 'socio'],
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
  // `config_editar` se partió en dos casillas independientes (ver nota más abajo).
  // `config_editar_operativo` conserva los mismos niveles base que tenía `config_editar`.
  config_editar_operativo:  ['principal'], // admin_whatsapp, pico_placa
  // `config_editar_financiero` toca dinero (comisión) y datos fiscales (NIT): nunca
  // 'secretaria' por defecto, aunque sí es asignable por excepción como cualquier otra área.
  config_editar_financiero: ['principal', 'socio'], // comisión, empresa/NIT, referidos
  // Suscribir un contrato EN NOMBRE DE DrivePass (EL AGENTE). El texto de los seis
  // documentos dice que quien firma por la empresa es su REPRESENTANTE LEGAL, así que
  // este permiso es el más estrecho del sistema después de `usuarios_gestion`: solo
  // 'principal' por nivel. Sí es asignable por excepción (no reparte permisos ni crea
  // cuentas, así que no habilita escalada), para que el día que el representante legal
  // sea otra persona del equipo se le pueda dar la casilla sin subirlo a principal.
  contratos_firmar_agente:  ['principal'],
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
// `config_editar_operativo` y `config_editar_financiero` SÍ son asignables: entre
// las dos solo permiten guardar config del sistema (whatsapp, pico y placa, comisión,
// datos fiscales, referidos); ninguna reparte permisos ni crea cuentas, así que no
// habilitan escalada de privilegios. Se separaron en dos casillas para que dar acceso
// a ajustar pico y placa (operativo) no implique dar acceso a la comisión de la
// plataforma ni al NIT de la empresa (financiero) — ver PUT /api/config.
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
  buses: 'Buses',
  reservas: 'Reservas',
  contabilidad: 'Contabilidad',
  contratos: 'Contratos digitales',
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
  config_editar_operativo: 'Config. operativa (WhatsApp, pico y placa)',
  config_editar_financiero: 'Config. financiera (comisión, NIT, referidos)',
  contratos_firmar_agente: 'Firmar contratos como DrivePass (representante legal)',
  usuarios_gestion: 'Gestión del equipo',
};

export function areaLabel(area: string): string {
  return AREA_LABEL[area] || area;
}

// Agrupación para la interfaz de casillas. El último grupo recoge cualquier área
// asignable que no se haya listado arriba, para que nunca quede una sección oculta
// si se agrega una nueva a AREA_NIVELES.
const GRUPOS_BASE: { titulo: string; areas: string[] }[] = [
  { titulo: 'Panel de administración', areas: ['usuarios', 'vehiculos', 'buses', 'reservas', 'contabilidad', 'contratos', 'mercado', 'calculadora', 'leads', 'soporte', 'nfc', 'config', 'auditoria'] },
  { titulo: 'Panel de control del equipo', areas: ['panel', 'operaciones', 'tareas', 'calendario', 'documentos', 'tableros'] },
  { titulo: 'Acciones sensibles', areas: ['config_editar_operativo', 'config_editar_financiero', 'contratos_firmar_agente'] },
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

// Delta de permisos: solo las claves que el cliente cambió desde que abrió el panel
// (no el mapa completo). `null` significa "quitar la excepción" (vuelve al nivel);
// un booleano fija la excepción a ese valor. Se fusiona sobre el valor ACTUAL en BD
// (releído en el momento de escribir) para no pisar cambios de otra sesión que haya
// tocado otras claves del mismo empleado mientras tanto — ver PUT /api/admin/usuarios.
export type PermisosExtraDelta = Record<string, boolean | null>;

export function fusionarPermisosExtra(actual: PermisosExtra, delta: PermisosExtraDelta): PermisosExtra {
  const out: PermisosExtra = { ...parsePermisosExtra(actual) };
  for (const [clave, valor] of Object.entries(delta)) {
    if (!esAreaAsignable(clave)) continue;
    if (valor === null) delete out[clave];
    else if (typeof valor === 'boolean') out[clave] = valor;
  }
  return out;
}

// Permiso efectivo. El tercer parámetro es OPCIONAL: sin él, el comportamiento es
// idéntico al de siempre (solo la matriz por nivel).
// `nivel === null` significa "sin nivel autorizable" (ver `nivelDe`/`permisosDe`: la
// fila del usuario ya no existe, o existe pero no está `activa`) y SIEMPRE deniega,
// sin excepción — ni siquiera una excepción `true` en `permisos_extra` puede pasar
// por encima de esto, porque esa cuenta ya no debería poder autorizar nada.
export function puede(nivel: AdminNivel | null, area: string, extra?: PermisosExtra | null): boolean {
  if (nivel === null) return false;
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

// IMPORTANTE — fuente de autorización de sesión: `nivelDe`/`permisosDe` son las
// funciones que `guardArea`/`adminTieneArea` (y cualquier ruta que las llame directo,
// ver PUT /api/config) usan para decidir si una sesión con JWT válido puede autorizar
// una acción. El JWT (`getCurrentUser()`) sigue siendo válido hasta 7 días aunque la
// fila del usuario cambie o desaparezca de la BD (ver lib/eliminar.ts: "eliminar" una
// cuenta admin sin historial hace un DELETE real, no solo una desactivación), así que
// estas dos funciones son la ÚNICA revalidación real contra el estado actual en BD.
//
// Devuelven `nivel: null` — "sin nivel autorizable", `puede()` lo deniega SIEMPRE —
// en dos casos que hay que tratar igual de estrictos:
//   1) la fila ya no existe (cuenta borrada de verdad);
//   2) la fila existe pero `estado_cuenta !== 'activa'` (desactivada o archivada).
// Solo con la fila existiendo Y activa se cae al nivel normalizado de la columna
// (que sí puede caer a 'principal' por defecto si el valor guardado es raro, ver
// `normalizarNivel`).
export function nivelDe(db: DB, userId: number): AdminNivel | null {
  const r = db.prepare('SELECT admin_nivel, estado_cuenta FROM usuarios WHERE id = ?').get(userId) as
    { admin_nivel?: string; estado_cuenta?: string } | undefined;
  if (!r || r.estado_cuenta !== 'activa') return null;
  return normalizarNivel(r.admin_nivel);
}

// Nivel + excepciones en una sola consulta. Si la columna `permisos_extra` aún no
// existe (BD vieja), cae al comportamiento anterior (solo nivel, vía `nivelDe`, que
// también exige fila activa) en vez de tumbar la petición.
export function permisosDe(db: DB, userId: number): { nivel: AdminNivel | null; extra: PermisosExtra } {
  try {
    const r = db.prepare('SELECT admin_nivel, permisos_extra, estado_cuenta FROM usuarios WHERE id = ?').get(userId) as
      { admin_nivel?: string; permisos_extra?: string; estado_cuenta?: string } | undefined;
    if (!r || r.estado_cuenta !== 'activa') return { nivel: null, extra: {} };
    return { nivel: normalizarNivel(r.admin_nivel), extra: parsePermisosExtra(r.permisos_extra) };
  } catch (e) {
    console.error('[permisos] no se pudo leer permisos_extra:', e instanceof Error ? e.message : e);
    return { nivel: nivelDe(db, userId), extra: {} };
  }
}

// Registro de auditoría (bitácora): quién hizo qué y a qué hora.
//
// `actor.id` admite `null` porque no todo el que puede tocar datos del negocio tiene
// una fila en `usuarios`: el MENSAJERO entra por un enlace con token, sin login, y
// aun así puede borrar fotos de un servicio o dejar sin efecto una inspección. Con
// `id: null` el evento queda igual en la bitácora, identificado por el nombre y la
// nota que escriba el llamador, y la columna `auditoria.usuario_id` (que es nullable
// y ya admite NULL desde que se borra una cuenta, ver lib/eliminar.ts) se deja vacía
// en vez de inventar un id de usuario que no existe.
export type ActorAuditoria = { id: number | null; nombre?: string; correo?: string; nivel?: string };
export type EntradaAuditoria = { area: string; accion: string; detalle?: string; entidad?: string; entidad_id?: number | null };

/**
 * Variante ESTRICTA: no se traga los errores, los propaga.
 *
 * `registrarAuditoria` (abajo) es deliberadamente tolerante — para un evento informativo
 * es mejor perder la línea de bitácora que tumbar la acción del usuario. Pero cuando lo
 * que se registra es un MOVIMIENTO DE PLATA (editar una liquidación, crear o anular un
 * ajuste, consumir ajustes pendientes, detectar una firma manipulada) esa tolerancia es
 * un agujero: el cambio se confirmaba en la BD y el rastro podía no existir.
 *
 * Como estas acciones ocurren dentro de una transacción de better-sqlite3, lanzar aquí
 * revierte TODO el cambio: o queda registrado, o no ocurre.
 */
export function registrarAuditoriaEstricta(db: DB, actor: ActorAuditoria, entry: EntradaAuditoria): void {
  db.prepare(
    `INSERT INTO auditoria (usuario_id, usuario_nombre, usuario_correo, usuario_nivel, area, accion, detalle, entidad, entidad_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    actor.id ?? null, actor.nombre || '', actor.correo || '', actor.nivel || '',
    entry.area, entry.accion, entry.detalle || '', entry.entidad || '', entry.entidad_id ?? null,
  );
}

export function registrarAuditoria(db: DB, actor: ActorAuditoria, entry: EntradaAuditoria) {
  try {
    registrarAuditoriaEstricta(db, actor, entry);
  } catch (e) {
    console.error('[auditoria] no se pudo registrar:', e instanceof Error ? e.message : e);
  }
}
