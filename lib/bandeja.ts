// ── La bandeja del día (vista HOY del panel unificado) ──────────────────────
//
// Una sola lista priorizada con TODO lo que hay que resolver hoy, venga de donde
// venga: reservas por aprobar, documentos en revisión, servicios sin mensajero,
// devoluciones, inspecciones con hallazgos, liquidaciones por pagar, contratos sin
// firmar, fotos retenidas para revisión manual y soporte sin responder.
//
// Se arma ENTERA EN EL SERVIDOR, en una sola petición (GET /api/panel/bandeja), a
// propósito: la alternativa —diez fetch desde el navegador— multiplica latencia,
// obliga a que el cliente conozca el gating de cada área y hace imposible ordenar
// por urgencia entre fuentes distintas.
//
// ⚠️ CADA FUENTE TIENE SU PROPIA ÁREA DE PERMISOS (`area` en cada item). El endpoint
// solo ejecuta las consultas de las áreas que la sesión puede ver: un `secretaria`
// no recibe ni una fila de contabilidad o de contratos, ni siquiera el contador.
// El área `panel` da acceso a la bandeja, NO a su contenido.
//
// ⚠️ LA BANDEJA NO PUEDE MENTIR. Cada fuente se define de modo que la fila
// DESAPAREZCA cuando el trabajo se resuelve con las herramientas que ya existen
// (aprobar la reserva, asignar el mensajero, marcar la liquidación como pagada…).
// Donde no hay un estado "resuelto" en la base, se acota con la condición más
// cercana que sí lo es, y queda dicho en el comentario de esa consulta.
//
// Módulo de SERVIDOR (lo importan rutas de API). `better-sqlite3` entra solo como
// tipo, así que los TIPOS de este archivo sí se pueden `import type` desde un
// componente de cliente — mismo patrón que lib/panel.ts y lib/permisos.ts.
import type Database from 'better-sqlite3';
import { puede, type AdminNivel, type PermisosExtra } from './permisos';
import { normalizarLugar, lugarResumen } from './lugares';
import { TITULOS_DOCUMENTO, type TipoDocumento } from './contratos-datos';

type DB = Database.Database;

/** De dónde salió la fila. Sirve para el icono y para agrupar. */
export type FuenteBandeja =
  | 'reserva_pendiente'
  | 'documento_vehiculo'
  | 'servicio_sin_mensajero'
  | 'devolucion_hoy'
  | 'inspeccion_hallazgos'
  | 'liquidacion_por_pagar'
  | 'contrato_sin_firmar'
  | 'foto_revision'
  | 'soporte_sin_responder';

/** Chips de filtro de la vista HOY. */
export type GrupoBandeja = 'reservas' | 'documentos' | 'calle' | 'dinero' | 'soporte';

export type ItemBandeja = {
  /** Único y estable: `fuente:id`. Es la key de React y el id de la acción rápida. */
  id: string;
  fuente: FuenteBandeja;
  grupo: GrupoBandeja;
  /** Área de `AREA_NIVELES` que habilita esta fila. */
  area: string;
  /** 0 = urgente, 1 = alta, 2 = normal. Ordena la lista. */
  peso: 0 | 1 | 2;
  /** Píldora corta de estado: «Por aprobar», «Sin mensajero»… */
  etiqueta: string;
  /** Qué es. */
  titulo: string;
  /** De quién. */
  quien: string;
  /** Cuándo (ya en texto legible; el servidor conoce la zona de cada columna). */
  cuando: string;
  /** Línea secundaria con el detalle operativo. */
  detalle: string;
  /** A dónde lleva «Abrir». Ruta interna de la app. */
  destino: string;
  /** Id de la entidad de origen (reserva, vehículo, operación, contrato…). */
  entidad_id: number;
  /** Solo cuando la fila se puede resolver de un clic desde la bandeja. */
  accion?: 'aprobar_reserva';
};

export type Bandeja = {
  /** Fecha de hoy en Medellín (YYYY-MM-DD). */
  fecha: string;
  items: ItemBandeja[];
  /** Totales por grupo, ya filtrados por permisos. `todo` es el total. */
  conteos: Record<'todo' | GrupoBandeja, number>;
  /** Áreas que esta sesión NO puede ver (la UI lo dice en vez de fingir "todo listo"). */
  areas_ocultas: string[];
};

// Tope por fuente: una bandeja no es un listado. Si alguna fuente se desborda, el
// problema es de gestión, no de paginación — y el panel completo sigue estando ahí.
const TOPE_POR_FUENTE = 40;

/** Fecha de hoy en horario de Medellín (YYYY-MM-DD) — mismo helper que /api/control/resumen. */
export function hoyBogota(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

// Colombia es UTC-05:00 todo el año (sin horario de verano), así que la conversión
// es un desplazamiento fijo y no hace falta una librería de zonas.
//
// `utc` NO es decorativo: en esta base conviven las dos convenciones. `reservas`,
// `usuarios` y `vehiculos` nacieron con `datetime('now')` (UTC) y las tablas
// posteriores con `datetime('now','localtime')`. Tratarlas igual daría "hace 5
// horas" de diferencia en una bandeja donde lo que se mira es justamente la hora.
function aMilisegundos(ts: unknown, utc: boolean): number | null {
  const s = String(ts ?? '').trim();
  if (!s) return null;
  const d = new Date(`${s.replace(' ', 'T')}${utc ? 'Z' : '-05:00'}`);
  const ms = d.getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** «hace 20 minutos» / «hace 3 horas» / «12 sep». Vacío si el dato no se pudo leer. */
function haceCuanto(ts: unknown, utc: boolean): string {
  const ms = aMilisegundos(ts, utc);
  if (ms === null) return '';
  const minutos = Math.floor((Date.now() - ms) / 60_000);
  if (minutos < 1) return 'hace un momento';
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.floor(horas / 24);
  if (dias < 30) return `hace ${dias} ${dias === 1 ? 'día' : 'días'}`;
  return fechaCorta(String(ts).slice(0, 10));
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** '2026-09-16' → '16 sep'. Devuelve el original si no tiene la forma esperada. */
function fechaCorta(iso: unknown): string {
  const s = String(iso ?? '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s;
  const mes = MESES[Number(m[2]) - 1] || m[2];
  return `${Number(m[3])} ${mes}`;
}

/** «hoy» / «mañana» / «ayer» / «16 sep», comparando contra la fecha de Medellín. */
function fechaRelativa(iso: unknown, hoy: string): string {
  const s = String(iso ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return fechaCorta(s);
  if (s === hoy) return 'hoy';
  const unDia = 86_400_000;
  const base = Date.parse(`${hoy}T00:00:00Z`);
  const diff = Math.round((Date.parse(`${s}T00:00:00Z`) - base) / unDia);
  if (diff === 1) return 'mañana';
  if (diff === -1) return 'ayer';
  return fechaCorta(s);
}

function vehiculoTexto(fila: Record<string, unknown>): string {
  const nombre = `${fila.marca ?? ''} ${fila.modelo ?? ''}`.trim();
  const placa = String(fila.placa ?? '').trim();
  return placa ? `${nombre} · ${placa}` : nombre;
}

/** Hora y sitio de un tramo (reservas.recogida / reservas.entrega, JSON de `Lugar`). */
function tramoTexto(json: unknown): string {
  const lugar = normalizarLugar(safeParse(json));
  if (!lugar) return '';
  const sitio = lugarResumen(lugar);
  const hora = String(lugar.hora || '').trim();
  return [hora, sitio].filter(Boolean).join(' · ');
}

function safeParse(json: unknown): unknown {
  const s = String(json ?? '').trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function moneda(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return `$${Math.round(n).toLocaleString('es-CO')}`;
}

// ── Las nueve fuentes ────────────────────────────────────────────────────────
//
// Cada una es una función independiente: recibe la base y la fecha de hoy, y
// devuelve sus filas ya normalizadas. El orquestador de abajo decide cuáles correr
// según los permisos de la sesión.

/** Reservas que el cliente pidió y nadie ha aprobado ni rechazado. */
function reservasPendientes(db: DB, hoy: string): ItemBandeja[] {
  const filas = db.prepare(
    `SELECT r.id, r.fecha_inicio, r.fecha_fin, r.total, r.created_at, r.origen,
            COALESCE(r.documento_id_url,'') AS doc_id, COALESCE(r.licencia_url,'') AS doc_lic,
            u.nombre AS cliente,
            v.marca, v.modelo, COALESCE(v.placa,'') AS placa
     FROM reservas r
     JOIN usuarios u  ON r.usuario_id  = u.id
     JOIN vehiculos v ON r.vehiculo_id = v.id
     WHERE r.estado = 'pendiente'
     ORDER BY r.created_at ASC
     LIMIT ?`
  ).all(TOPE_POR_FUENTE) as Record<string, unknown>[];

  return filas.map(f => {
    const inicio = String(f.fecha_inicio ?? '').slice(0, 10);
    // Una reserva que empieza hoy o mañana y sigue sin aprobar es lo más urgente
    // que puede haber en esta lista: el cliente ya organizó su viaje.
    const urgente = inicio !== '' && inicio <= hoy;
    const docs = f.doc_id || f.doc_lic ? 'con documentos adjuntos' : 'sin documentos adjuntos';
    return {
      id: `reserva_pendiente:${Number(f.id)}`,
      fuente: 'reserva_pendiente' as const,
      grupo: 'reservas' as const,
      area: 'reservas',
      peso: (urgente ? 0 : 1) as 0 | 1,
      etiqueta: 'Por aprobar',
      titulo: `Reserva de ${vehiculoTexto(f)}`,
      quien: String(f.cliente ?? ''),
      // `reservas.created_at` es de las que nacieron con `datetime('now')`: UTC.
      cuando: haceCuanto(f.created_at, true),
      detalle: `${fechaRelativa(inicio, hoy)} → ${fechaCorta(f.fecha_fin)} · ${moneda(f.total)} · ${docs}`,
      destino: '/dashboard/admin?tab=reservas',
      entidad_id: Number(f.id),
      accion: 'aprobar_reserva' as const,
    };
  });
}

/** Documentos de un vehículo (del propietario) esperando revisión del equipo. */
function documentosEnRevision(db: DB): ItemBandeja[] {
  const filas = db.prepare(
    `SELECT v.id, v.marca, v.modelo, v.anio, COALESCE(v.placa,'') AS placa,
            COALESCE(v.documentos_nota,'') AS nota, u.nombre AS propietario
     FROM vehiculos v
     JOIN usuarios u ON v.propietario_id = u.id
     WHERE COALESCE(v.documentos_estado,'') = 'en_revision'
       AND COALESCE(v.archivado,0) = 0
     ORDER BY v.id DESC
     LIMIT ?`
  ).all(TOPE_POR_FUENTE) as Record<string, unknown>[];

  return filas.map(f => ({
    id: `documento_vehiculo:${Number(f.id)}`,
    fuente: 'documento_vehiculo' as const,
    grupo: 'documentos' as const,
    area: 'vehiculos',
    peso: 2 as const,
    etiqueta: 'Revisar',
    titulo: `Documentos de ${vehiculoTexto(f)}`,
    quien: `${f.propietario} · propietario`,
    cuando: '',
    detalle: String(f.nota || 'Tarjeta de propiedad, SOAT y tecnomecánica esperando revisión.'),
    // El `?vehiculo=` abre directamente el modal de documentos de ese vehículo
    // (ver app/dashboard/admin/page.tsx, efecto `urlVehiculoAplicado`).
    destino: `/dashboard/admin?tab=vehiculos&vehiculo=${Number(f.id)}`,
    entidad_id: Number(f.id),
  }));
}

/**
 * Servicios logísticos vigentes HOY sin mensajero asignado.
 *
 * "Vigente hoy" = el rango de la reserva contiene la fecha de hoy, lo que cubre
 * tanto la entrega del primer día como la devolución del último y los días
 * intermedios de una reserva en curso que nunca se asignó. Desaparece en cuanto se
 * elige mensajero (o el servicio se cierra), que es exactamente lo que hay que hacer.
 */
function serviciosSinMensajero(db: DB, hoy: string): ItemBandeja[] {
  const filas = db.prepare(
    `SELECT o.id, o.reserva_id, o.estado,
            r.fecha_inicio, r.fecha_fin,
            COALESCE(r.recogida,'{}') AS recogida, COALESCE(r.entrega,'{}') AS entrega,
            u.nombre AS cliente,
            v.marca, v.modelo, COALESCE(v.placa,'') AS placa
     FROM operaciones o
     JOIN reservas r  ON o.reserva_id  = r.id
     JOIN usuarios u  ON r.usuario_id  = u.id
     JOIN vehiculos v ON r.vehiculo_id = v.id
     WHERE o.mensajero_id IS NULL
       AND o.estado != 'finalizada'
       AND r.estado != 'cancelada'
       AND substr(r.fecha_inicio,1,10) <= ?
       AND substr(r.fecha_fin,1,10)    >= ?
     ORDER BY r.fecha_inicio ASC
     LIMIT ?`
  ).all(hoy, hoy, TOPE_POR_FUENTE) as Record<string, unknown>[];

  return filas.map(f => {
    const entrega = String(f.fecha_inicio ?? '').slice(0, 10) === hoy;
    const tramo = tramoTexto(entrega ? f.recogida : f.entrega);
    return {
      id: `servicio_sin_mensajero:${Number(f.id)}`,
      fuente: 'servicio_sin_mensajero' as const,
      grupo: 'calle' as const,
      area: 'operaciones',
      peso: 0 as const,
      etiqueta: 'Sin mensajero',
      titulo: `${entrega ? 'Entrega' : 'Servicio'} de ${vehiculoTexto(f)}`,
      quien: String(f.cliente ?? ''),
      cuando: tramo || 'hoy',
      detalle: 'Nadie tiene asignado este servicio.',
      destino: '/panel?seccion=operaciones',
      entidad_id: Number(f.id),
    };
  });
}

/** Devoluciones cuya fecha de fin es hoy y que todavía no se cerraron. */
function devolucionesDeHoy(db: DB, hoy: string): ItemBandeja[] {
  const filas = db.prepare(
    `SELECT r.id, r.fecha_fin, COALESCE(r.entrega,'{}') AS entrega,
            u.nombre AS cliente,
            v.marca, v.modelo, COALESCE(v.placa,'') AS placa,
            o.id AS operacion_id, COALESCE(o.estado,'') AS op_estado,
            m.nombre AS mensajero
     FROM reservas r
     JOIN usuarios u  ON r.usuario_id  = u.id
     JOIN vehiculos v ON r.vehiculo_id = v.id
     LEFT JOIN operaciones o ON o.reserva_id = r.id
     LEFT JOIN mensajeros  m ON o.mensajero_id = m.id
     WHERE substr(r.fecha_fin,1,10) = ?
       AND r.estado NOT IN ('cancelada','completada')
     ORDER BY r.fecha_fin ASC
     LIMIT ?`
  ).all(hoy, TOPE_POR_FUENTE) as Record<string, unknown>[];

  return filas.map(f => ({
    id: `devolucion_hoy:${Number(f.id)}`,
    fuente: 'devolucion_hoy' as const,
    grupo: 'calle' as const,
    area: 'reservas',
    peso: 1 as const,
    etiqueta: 'Devolución',
    titulo: `Devolución de ${vehiculoTexto(f)}`,
    quien: String(f.cliente ?? ''),
    cuando: tramoTexto(f.entrega) || 'hoy',
    detalle: f.mensajero
      ? `Mensajero: ${f.mensajero}`
      : (f.operacion_id ? 'Servicio creado, sin mensajero asignado.' : 'Sin servicio logístico creado.'),
    destino: '/panel?seccion=operaciones',
    entidad_id: Number(f.id),
  }));
}

/**
 * Inspecciones de la IA que encontraron daños nuevos en un servicio TODAVÍA ABIERTO.
 *
 * `inspeccion_estado` no tiene un valor "ya lo miré": se queda en 'con_danos' para
 * siempre. Por eso la fila se acota a `o.estado != 'finalizada'`: cerrar el servicio
 * (marcar la última tarea en Operaciones) es el acto que dice "esto ya se atendió", y
 * es lo que saca la fila de la bandeja. Un hallazgo de un servicio ya cerrado sigue
 * estando en Operaciones y en el acta; simplemente no reclama atención hoy.
 */
function inspeccionesConHallazgos(db: DB): ItemBandeja[] {
  const filas = db.prepare(
    `SELECT o.id, o.reserva_id, COALESCE(o.inspeccion_ia,'') AS ia,
            r.fecha_fin, u.nombre AS cliente,
            v.marca, v.modelo, COALESCE(v.placa,'') AS placa
     FROM operaciones o
     JOIN reservas r  ON o.reserva_id  = r.id
     JOIN usuarios u  ON r.usuario_id  = u.id
     JOIN vehiculos v ON r.vehiculo_id = v.id
     WHERE o.inspeccion_estado = 'con_danos'
       AND o.estado != 'finalizada'
     ORDER BY o.id DESC
     LIMIT ?`
  ).all(TOPE_POR_FUENTE) as Record<string, unknown>[];

  return filas.map(f => {
    const ia = safeParse(f.ia) as { hallazgos?: unknown[]; severidad_general?: string } | null;
    const cuantos = Array.isArray(ia?.hallazgos) ? ia.hallazgos.length : 0;
    const severidad = String(ia?.severidad_general || '').trim();
    return {
      id: `inspeccion_hallazgos:${Number(f.id)}`,
      fuente: 'inspeccion_hallazgos' as const,
      grupo: 'calle' as const,
      area: 'operaciones',
      peso: 1 as const,
      etiqueta: 'Daño detectado',
      titulo: `Inspección de ${vehiculoTexto(f)}`,
      quien: String(f.cliente ?? ''),
      cuando: `devolución ${fechaCorta(f.fecha_fin)}`,
      detalle: cuantos
        ? `${cuantos} ${cuantos === 1 ? 'hallazgo' : 'hallazgos'}${severidad ? ` · severidad ${severidad}` : ''} · hay que decidir si se cobra.`
        : 'La comparación de fotos encontró daños nuevos.',
      destino: '/panel?seccion=operaciones',
      entidad_id: Number(f.id),
    };
  });
}

/** Liquidaciones del propietario calculadas y sin pagar. */
function liquidacionesPorPagar(db: DB): ItemBandeja[] {
  const filas = db.prepare(
    `SELECT l.id, l.neto, l.created_at, l.reserva_id,
            p.nombre AS propietario,
            v.marca, v.modelo, COALESCE(v.placa,'') AS placa
     FROM liquidaciones l
     JOIN usuarios  p ON l.propietario_id = p.id
     JOIN reservas  r ON l.reserva_id     = r.id
     JOIN vehiculos v ON r.vehiculo_id    = v.id
     WHERE l.estado = 'pendiente'
     ORDER BY l.created_at ASC
     LIMIT ?`
  ).all(TOPE_POR_FUENTE) as Record<string, unknown>[];

  return filas.map(f => ({
    id: `liquidacion_por_pagar:${Number(f.id)}`,
    fuente: 'liquidacion_por_pagar' as const,
    grupo: 'dinero' as const,
    area: 'contabilidad',
    peso: 2 as const,
    etiqueta: 'Lista para pagar',
    titulo: `Liquidación de ${moneda(f.neto)}`,
    quien: `${f.propietario} · propietario`,
    // `liquidaciones.created_at` usa datetime('now','localtime').
    cuando: haceCuanto(f.created_at, false),
    detalle: `${vehiculoTexto(f)} · reserva #${Number(f.reserva_id)}`,
    destino: '/panel?seccion=contabilidad',
    entidad_id: Number(f.id),
  }));
}

/** Documentos contractuales emitidos a los que todavía les falta alguna firma. */
function contratosSinFirmar(db: DB, hoy: string): ItemBandeja[] {
  const filas = db.prepare(
    `SELECT c.id, c.reserva_id, c.tipo, c.numero, c.created_at, COALESCE(c.via_firma,'') AS via,
            u.nombre AS cliente,
            v.marca, v.modelo, COALESCE(v.placa,'') AS placa,
            r.fecha_inicio,
            (SELECT COUNT(*) FROM contrato_firmas f WHERE f.contrato_id = c.id) AS firmas_totales,
            (SELECT COUNT(*) FROM contrato_firmas f WHERE f.contrato_id = c.id AND f.firmada_en <> '') AS firmas_puestas
     FROM contratos c
     JOIN usuarios  u ON c.cliente_id  = u.id
     JOIN vehiculos v ON c.vehiculo_id = v.id
     JOIN reservas  r ON c.reserva_id  = r.id
     WHERE c.estado = 'pendiente'
       AND r.estado != 'cancelada'
     ORDER BY c.created_at ASC
     LIMIT ?`
  ).all(TOPE_POR_FUENTE) as Record<string, unknown>[];

  return filas.map(f => {
    const inicio = String(f.fecha_inicio ?? '').slice(0, 10);
    const urgente = inicio !== '' && inicio <= hoy;
    const titulo = TITULOS_DOCUMENTO[String(f.tipo) as TipoDocumento] || 'Documento contractual';
    const puestas = Number(f.firmas_puestas || 0);
    const totales = Number(f.firmas_totales || 0);
    return {
      id: `contrato_sin_firmar:${Number(f.id)}`,
      fuente: 'contrato_sin_firmar' as const,
      grupo: 'documentos' as const,
      area: 'contratos',
      peso: (urgente ? 1 : 2) as 1 | 2,
      etiqueta: 'Sin firmar',
      titulo,
      quien: String(f.cliente ?? ''),
      // `contratos.created_at` usa datetime('now','localtime').
      cuando: haceCuanto(f.created_at, false),
      detalle: `${String(f.numero || '')} · ${vehiculoTexto(f)} · ${puestas} de ${totales} firmas${f.via === 'papel' ? ' · vía papel' : ''}`,
      destino: `/panel?seccion=contratos&reserva=${Number(f.reserva_id)}`,
      entidad_id: Number(f.id),
    };
  });
}

/**
 * Publicaciones retenidas para revisión manual: la IA marcó contenido inapropiado, o
 * el tapado de placas no pudo garantizar que la placa quedara cubierta, o la
 * moderación no se pudo evaluar. Los tres caminos terminan en el mismo sitio
 * (`vehiculos.contenido_revision = 1`, ver app/api/upload/route.ts) y se resuelven
 * aprobando la publicación desde «Revisión de contenido».
 */
function fotosRetenidas(db: DB): ItemBandeja[] {
  const filas = db.prepare(
    `SELECT v.id, v.marca, v.modelo, COALESCE(v.placa,'') AS placa,
            COALESCE(v.contenido_revision_motivo,'') AS motivo,
            u.nombre AS propietario
     FROM vehiculos v
     JOIN usuarios u ON v.propietario_id = u.id
     WHERE COALESCE(v.contenido_revision,0) = 1
       AND COALESCE(v.archivado,0) = 0
     ORDER BY v.id DESC
     LIMIT ?`
  ).all(TOPE_POR_FUENTE) as Record<string, unknown>[];

  return filas.map(f => {
    const motivo = String(f.motivo || '');
    const dePlaca = /placa/i.test(motivo);
    return {
      id: `foto_revision:${Number(f.id)}`,
      fuente: 'foto_revision' as const,
      grupo: 'documentos' as const,
      area: 'vehiculos',
      peso: 1 as const,
      etiqueta: dePlaca ? 'Placa por revisar' : 'Foto retenida',
      titulo: `Fotos de ${vehiculoTexto(f)}`,
      quien: `${f.propietario} · propietario`,
      cuando: '',
      detalle: motivo || 'Publicación retenida hasta que alguien mire las fotos.',
      // La vista de "Revisión de contenido" es un interruptor dentro de la pestaña
      // Vehículos del panel actual (no tiene querystring propia todavía).
      destino: '/dashboard/admin?tab=vehiculos',
      entidad_id: Number(f.id),
    };
  });
}

/**
 * Conversaciones de soporte escaladas a una persona en las que el último mensaje NO
 * lo escribió el equipo: alguien está esperando respuesta. Responder (o cerrar la
 * conversación) saca la fila.
 */
function soporteSinResponder(db: DB): ItemBandeja[] {
  const filas = db.prepare(
    `SELECT c.id, c.solicitante_rol, COALESCE(c.motivo_escalada,'') AS motivo,
            u.nombre AS solicitante,
            (SELECT m.remitente_tipo FROM mensajes_soporte m WHERE m.conversacion_id = c.id ORDER BY m.id DESC LIMIT 1) AS ultimo_tipo,
            (SELECT m.contenido      FROM mensajes_soporte m WHERE m.conversacion_id = c.id ORDER BY m.id DESC LIMIT 1) AS ultimo_texto,
            (SELECT m.created_at     FROM mensajes_soporte m WHERE m.conversacion_id = c.id ORDER BY m.id DESC LIMIT 1) AS ultimo_at
     FROM conversaciones_soporte c
     JOIN usuarios u ON c.solicitante_id = u.id
     WHERE c.estado = 'escalada'
     ORDER BY c.actualizado_en ASC
     LIMIT ?`
  ).all(TOPE_POR_FUENTE) as Record<string, unknown>[];

  return filas
    .filter(f => String(f.ultimo_tipo || '') !== 'admin')
    .map(f => {
      const texto = String(f.ultimo_texto || f.motivo || '').replace(/\s+/g, ' ').trim();
      return {
        id: `soporte_sin_responder:${Number(f.id)}`,
        fuente: 'soporte_sin_responder' as const,
        grupo: 'soporte' as const,
        area: 'soporte',
        peso: 0 as const,
        etiqueta: 'Sin responder',
        titulo: 'Soporte esperando respuesta',
        quien: `${f.solicitante} · ${f.solicitante_rol === 'propietario' ? 'propietario' : 'cliente'}`,
        // `mensajes_soporte.created_at` usa datetime('now','localtime').
        cuando: haceCuanto(f.ultimo_at, false),
        detalle: texto.length > 160 ? `${texto.slice(0, 157)}…` : (texto || 'El asistente escaló la conversación.'),
        destino: `/panel?seccion=soporte&conv=${Number(f.id)}`,
        entidad_id: Number(f.id),
      };
    });
}

// ── Orquestador ─────────────────────────────────────────────────────────────

type Fuente = { area: string; construir: () => ItemBandeja[] };

/**
 * Arma la bandeja completa para UNA sesión concreta.
 *
 * `nivel`/`extra` son los permisos EFECTIVOS ya releídos de la base por `permisosDe`
 * (no lo que venga del JWT ni del cliente). Solo se ejecutan las consultas de las
 * áreas que esa sesión puede ver: lo demás ni se consulta, así que tampoco puede
 * filtrarse por el contador.
 */
export function construirBandeja(db: DB, nivel: AdminNivel | null, extra: PermisosExtra): Bandeja {
  const hoy = hoyBogota();

  const fuentes: Fuente[] = [
    { area: 'reservas',     construir: () => reservasPendientes(db, hoy) },
    { area: 'reservas',     construir: () => devolucionesDeHoy(db, hoy) },
    { area: 'vehiculos',    construir: () => documentosEnRevision(db) },
    { area: 'vehiculos',    construir: () => fotosRetenidas(db) },
    { area: 'operaciones',  construir: () => serviciosSinMensajero(db, hoy) },
    { area: 'operaciones',  construir: () => inspeccionesConHallazgos(db) },
    { area: 'contabilidad', construir: () => liquidacionesPorPagar(db) },
    { area: 'contratos',    construir: () => contratosSinFirmar(db, hoy) },
    { area: 'soporte',      construir: () => soporteSinResponder(db) },
  ];

  const items: ItemBandeja[] = [];
  const ocultas = new Set<string>();
  for (const f of fuentes) {
    if (!puede(nivel, f.area, extra)) { ocultas.add(f.area); continue; }
    // Una fuente rota (tabla que aún no existe en una base vieja, JSON corrupto) no
    // debe dejar sin bandeja a todo el equipo: se registra y se sigue con el resto.
    try {
      items.push(...f.construir());
    } catch (e) {
      console.error(`[bandeja] fuente "${f.area}" falló:`, e instanceof Error ? e.message : e);
    }
  }

  // Urgente primero; dentro del mismo peso, el orden en que se agregaron (que ya es
  // el cronológico de cada consulta). `sort` es estable en Node, así que basta con
  // comparar el peso.
  items.sort((a, b) => a.peso - b.peso);

  const conteos = { todo: items.length, reservas: 0, documentos: 0, calle: 0, dinero: 0, soporte: 0 };
  for (const it of items) conteos[it.grupo] += 1;

  return { fecha: hoy, items, conteos, areas_ocultas: [...ocultas] };
}
