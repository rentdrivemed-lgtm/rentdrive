// ── Quién puede ver qué documento, y registro de cada acceso ────────────────
//
// Módulo de SERVIDOR (lee la base de datos). Resuelve una referencia
// `ambito/id/clave` (ver lib/documentos-ref.ts) a tres cosas:
//   1. la URL real del archivo en el storage,
//   2. de QUIÉN es ese documento (el titular, para la bitácora),
//   3. si la sesión que lo pide tiene derecho a verlo.
//
// EL MODELO DE PERMISOS NO CAMBIA. Se limita a poner en un solo sitio, explícito y
// comprobable, el mismo reparto que ya aplicaban las rutas que hoy sirven estos
// documentos:
//
//   · usuario/<id>   — la persona ve LO SUYO (GET/PUT /api/auth/me ya le devuelve
//     sus propias URLs) y el equipo con la sección «Usuarios»
//     (GET /api/admin/usuarios exige `guardArea('usuarios')`).
//   · reserva/<id>   — el CLIENTE que reservó y el PROPIETARIO del vehículo
//     reservado (GET /api/reservas hace `SELECT r.*` filtrando por
//     `r.usuario_id` o por `v.propietario_id`, así que ambos ya recibían estos
//     documentos), más el equipo con la sección «Reservas».
//   · vehiculo/<id>  — el PROPIETARIO del vehículo y el equipo con la sección
//     «Vehículos».
//
// Cualquier discrepancia con eso es un error de este archivo, no un cambio de
// política: si algo hay que estrechar (p. ej. que el propietario deje de ver la
// cédula del cliente), es una decisión aparte y se toma con el dueño.
import path from 'path';
import { readFile } from 'fs/promises';
import type Database from 'better-sqlite3';
import type { UserPayload } from './auth';
import { descargarAcotado } from './descarga-remota';
import { esUrlDeStorageValida, urlEntregaDocumento } from './storage';
import { adminTieneArea } from './guard';
import { registrarAuditoria, type ActorAuditoria } from './permisos';
import {
  type AmbitoDocumento, etiquetaDocumento, esClaveDocumento,
} from './documentos-ref';

export type Titular = { id: number | null; nombre: string };

export type ResolucionDocumento =
  | { ok: true; url: string; etiqueta: string; titular: Titular }
  | { ok: false; estado: 400 | 401 | 403 | 404; error: string };

const NO_AUTENTICADO = { ok: false, estado: 401, error: 'Inicia sesión para ver este documento.' } as const;
const SIN_PERMISO    = { ok: false, estado: 403, error: 'No tienes permiso para ver este documento.' } as const;
const NO_EXISTE      = { ok: false, estado: 404, error: 'Ese documento no existe o no está subido.' } as const;

// ── Lectura de la URL guardada ─────────────────────────────────────────────

const COLUMNA_USUARIO: Record<string, string> = {
  cedula_frente:        'cedula_url',
  cedula_dorso:         'cedula_url_dorso',
  licencia_frente:      'licencia_url',
  licencia_dorso:       'licencia_url_dorso',
  certificado_bancario: 'certificado_bancario_url',
};

const COLUMNA_RESERVA: Record<string, string> = {
  documento_frente: 'documento_id_url',
  documento_dorso:  'documento_id_url_dorso',
  licencia_frente:  'licencia_url',
  licencia_dorso:   'licencia_url_dorso',
};

// Clave de la referencia → (clave dentro del JSON `vehiculos.documentos`, campo).
const CAMPO_VEHICULO: Record<string, { clave: string; campo: 'url' | 'url_dorso' }> = {
  tarjeta_frente: { clave: 'tarjeta',     campo: 'url' },
  tarjeta_dorso:  { clave: 'tarjeta',     campo: 'url_dorso' },
  soat:           { clave: 'soat',        campo: 'url' },
  tecno:          { clave: 'tecno',       campo: 'url' },
  poliza:         { clave: 'poliza',      campo: 'url' },
  todo_riesgo:    { clave: 'todo_riesgo', campo: 'url' },
};

function texto(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Lee una URL de dentro del JSON `vehiculos.documentos` sin confiar en su forma. */
function urlEnDocumentosJson(raw: unknown, clave: string, campo: 'url' | 'url_dorso'): string {
  if (typeof raw !== 'string' || !raw) return '';
  let docs: unknown;
  try { docs = JSON.parse(raw); } catch { return ''; }
  if (!docs || typeof docs !== 'object' || Array.isArray(docs)) return '';
  const entrada = (docs as Record<string, unknown>)[clave];
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) return '';
  return texto((entrada as Record<string, unknown>)[campo]);
}

// ── Resolución + permiso ───────────────────────────────────────────────────

/**
 * Resuelve una referencia para una sesión concreta.
 *
 * El orden importa: primero se comprueba el PERMISO sobre el registro (el usuario, la
 * reserva, el vehículo) y solo después si el documento está subido. Al revés, un 404
 * frente a un 403 le confirmaría a cualquiera qué documentos tiene guardados una
 * persona ajena, que es justo lo que no debe poder averiguar.
 */
export function resolverDocumento(
  db: Database.Database,
  viewer: UserPayload | null,
  ambito: AmbitoDocumento,
  id: number,
  clave: string,
): ResolucionDocumento {
  if (!viewer) return NO_AUTENTICADO;
  if (!Number.isInteger(id) || id <= 0) return { ok: false, estado: 400, error: 'Referencia inválida.' };
  if (!esClaveDocumento(ambito, clave)) return { ok: false, estado: 400, error: 'Referencia inválida.' };
  const etiqueta = etiquetaDocumento(ambito, clave);
  const esAdmin = viewer.rol === 'admin';

  if (ambito === 'usuario') {
    const fila = db.prepare(
      `SELECT id, nombre, ${COLUMNA_USUARIO[clave]} AS valor FROM usuarios WHERE id = ?`
    ).get(id) as { id: number; nombre: string; valor: unknown } | undefined;
    // Sin fila no hay a quién pedirle permiso: se responde igual que "no lo puedes ver"
    // salvo que sea su propia cuenta (imposible: el JWT sale de una fila que existía).
    if (!fila) return SIN_PERMISO;
    const propio = viewer.id === fila.id;
    if (!propio && !(esAdmin && adminTieneArea(db, viewer.id, 'usuarios'))) return SIN_PERMISO;
    const url = texto(fila.valor);
    if (!url) return NO_EXISTE;
    return { ok: true, url, etiqueta, titular: { id: fila.id, nombre: fila.nombre || '' } };
  }

  if (ambito === 'reserva') {
    const fila = db.prepare(
      `SELECT r.id, r.usuario_id, v.propietario_id, u.nombre AS titular_nombre,
              r.${COLUMNA_RESERVA[clave]} AS valor
         FROM reservas r
         JOIN vehiculos v ON v.id = r.vehiculo_id
         JOIN usuarios  u ON u.id = r.usuario_id
        WHERE r.id = ?`
    ).get(id) as { id: number; usuario_id: number; propietario_id: number; titular_nombre: string; valor: unknown } | undefined;
    if (!fila) return SIN_PERMISO;
    const propio = viewer.id === fila.usuario_id;
    // El propietario del vehículo reservado: hoy `GET /api/reservas` ya le entrega
    // estos campos (`SELECT r.*` filtrado por `v.propietario_id`). Se conserva.
    const esPropietarioDelCarro = viewer.rol === 'propietario' && viewer.id === fila.propietario_id;
    if (!propio && !esPropietarioDelCarro && !(esAdmin && adminTieneArea(db, viewer.id, 'reservas'))) return SIN_PERMISO;
    const url = texto(fila.valor);
    if (!url) return NO_EXISTE;
    return { ok: true, url, etiqueta, titular: { id: fila.usuario_id, nombre: fila.titular_nombre || '' } };
  }

  // ambito === 'vehiculo'
  const campo = CAMPO_VEHICULO[clave];
  const fila = db.prepare(
    `SELECT v.id, v.propietario_id, v.documentos, u.nombre AS titular_nombre
       FROM vehiculos v
       JOIN usuarios  u ON u.id = v.propietario_id
      WHERE v.id = ?`
  ).get(id) as { id: number; propietario_id: number; documentos: unknown; titular_nombre: string } | undefined;
  if (!fila) return SIN_PERMISO;
  const esDueno = viewer.id === fila.propietario_id;
  if (!esDueno && !(esAdmin && adminTieneArea(db, viewer.id, 'vehiculos'))) return SIN_PERMISO;
  const url = urlEnDocumentosJson(fila.documentos, campo.clave, campo.campo);
  if (!url) return NO_EXISTE;
  return { ok: true, url, etiqueta, titular: { id: fila.propietario_id, nombre: fila.titular_nombre || '' } };
}

// ── Bitácora de accesos ────────────────────────────────────────────────────
//
// Requisito explícito: cada vez que alguien abre un documento de identidad queda
// registrado QUIÉN lo abrió, DE QUIÉN era y CUÁNDO. Se escribe en la tabla
// `auditoria` que ya existe (y que ya se ve en la pestaña «Bitácora» del panel, que
// lista las áreas que encuentre) en vez de en una tabla nueva: así el dueño lo ve en
// el sitio donde ya mira todo lo demás, sin pantalla nueva que mantener.
export const AREA_AUDITORIA_DOCUMENTOS = 'documentos_id';

/**
 * Ventana de deduplicación. Abrir la ficha de una persona en el panel dispara una
 * petición por documento, y el navegador puede repetirlas (recarga, volver atrás,
 * el visor a pantalla completa vuelve a pedir la misma imagen). Sin esto la
 * bitácora se llenaría de líneas idénticas y dejaría de ser legible, que es la
 * forma más práctica de que un registro de auditoría no sirva para nada.
 *
 * Lo que se pierde es solo la REPETICIÓN inmediata del mismo par (quién, qué); el
 * primer acceso de cada persona a cada documento queda siempre.
 */
const VENTANA_DEDUPE_MIN = 10;

function entidadDe(ambito: AmbitoDocumento, clave: string): string {
  return `documento:${ambito}:${clave}`;
}

/**
 * Deja constancia de un acceso. Nunca lanza: perder una línea de bitácora no debe
 * impedir que el equipo vea un documento (mismo criterio que `registrarAuditoria`).
 */
export function registrarAccesoDocumento(
  db: Database.Database,
  actor: ActorAuditoria & { rol?: string },
  ambito: AmbitoDocumento,
  id: number,
  clave: string,
  titular: Titular,
  accion: 'ver' | 'descargar',
): void {
  const entidad = entidadDe(ambito, clave);
  try {
    const desde = new Date(Date.now() - VENTANA_DEDUPE_MIN * 60_000);
    // `auditoria.created_at` se guarda con `datetime('now','localtime')`, o sea hora
    // local en formato `YYYY-MM-DD HH:MM:SS`. Se compara como texto, que en ese
    // formato ordena igual que en el tiempo.
    const corte = new Date(desde.getTime() - desde.getTimezoneOffset() * 60_000)
      .toISOString().slice(0, 19).replace('T', ' ');
    const repetido = db.prepare(
      `SELECT 1 FROM auditoria
        WHERE area = ? AND accion = ? AND entidad = ? AND entidad_id = ?
          AND (usuario_id IS ?) AND created_at >= ?
        LIMIT 1`
    ).get(AREA_AUDITORIA_DOCUMENTOS, `${accion}_documento`, entidad, id, actor.id ?? null, corte);
    if (repetido) return;
  } catch { /* si el dedupe falla se registra igual: mejor de más que de menos */ }

  const deQuien = titular.nombre
    ? `de ${titular.nombre}${titular.id ? ` (#${titular.id})` : ''}`
    : 'de titular desconocido';
  registrarAuditoria(db, actor, {
    area: AREA_AUDITORIA_DOCUMENTOS,
    accion: `${accion}_documento`,
    entidad,
    entidad_id: id,
    detalle: `${accion === 'descargar' ? 'Descargó' : 'Abrió'} ${etiquetaDocumento(ambito, clave)} ${deQuien} (${ambito} #${id})`,
  });
}

// ── Bytes del archivo ──────────────────────────────────────────────────────

/** Tope por documento. Una cédula ronda 1-3 MB; un PDF escaneado, unos pocos más. */
const MAX_BYTES_DOCUMENTO = 20 * 1024 * 1024;
const TIMEOUT_DESCARGA_MS = 20_000;

/**
 * Trae el contenido de un documento guardado, venga de donde venga:
 *
 *   · storage actual (Cloudinary) — pasa por `urlEntregaDocumento`, que FIRMA la
 *     petición si el archivo ya no es de entrega pública. Es la pieza que hace que
 *     esto siga funcionando igual antes y después de migrar los documentos a
 *     privados: la columna guarda la misma URL canónica y aquí se resuelve.
 *   · legado en disco (`/uploads/...`) — documentos anteriores a Cloudinary que
 *     todavía aparecen en algunas filas. Se leen del filesystem, con el mismo
 *     cuidado de no salirse de `public/` que ya tiene lib/paquete-documentos.ts.
 *
 * Nunca lanza: devuelve `{ error }` con un texto apto para enseñar, sin rutas del
 * servidor ni detalles del CDN.
 */
export async function bytesDeDocumento(
  url: string,
): Promise<{ buffer: Buffer; contentType: string } | { error: string }> {
  if (url.startsWith('/')) {
    if (!url.startsWith('/uploads/') || url.includes('..')) {
      return { error: 'La dirección guardada de este documento no es válida.' };
    }
    const rel = url.split('?')[0].split('#')[0].replace(/^\/+/, '');
    const base = path.join(process.cwd(), 'public');
    const abs = path.join(base, rel);
    if (!abs.startsWith(base + path.sep)) return { error: 'La dirección guardada de este documento no es válida.' };
    try {
      const buffer = await readFile(abs);
      if (buffer.length > MAX_BYTES_DOCUMENTO) return { error: 'El archivo pesa más de lo permitido.' };
      return { buffer, contentType: '' };
    } catch {
      // A propósito sin el mensaje de `fs`: trae la ruta absoluta del servidor.
      return { error: 'El archivo antiguo ya no está disponible en el servidor.' };
    }
  }

  // Cualquier cosa que no sea una URL de NUESTRO storage se rechaza aquí, no se
  // intenta descargar: si una fila tuviera guardada una dirección externa, esta ruta
  // sería un proxy de peticiones salientes del servidor a donde diga la base de datos.
  if (!esUrlDeStorageValida(url)) {
    return { error: 'La dirección guardada de este documento no es de nuestro almacenamiento.' };
  }

  try {
    const { buffer, contentType } = await descargarAcotado(urlEntregaDocumento(url), {
      timeoutMs: TIMEOUT_DESCARGA_MS,
      maxBytes: MAX_BYTES_DOCUMENTO,
    });
    if (!buffer.length) return { error: 'El archivo llegó vacío desde el almacenamiento.' };
    return { buffer, contentType };
  } catch {
    return { error: 'No se pudo traer el documento del almacenamiento.' };
  }
}
