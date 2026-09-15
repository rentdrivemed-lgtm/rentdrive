// ── Acta de respaldo del servicio ───────────────────────────────────────────
//
// Qué problema resuelve: las fotos de salida/entrada de una operación se pueden
// quitar con el botón × de la miniatura y hoy no queda constancia de nada. Un
// respaldo que se puede borrar no es un respaldo. El acta es, por eso, una
// FOTOGRAFÍA CONGELADA del servicio en el momento en que se genera: los datos y
// la lista de fotos se copian a `actas_servicio` (ver lib/db.ts) y nada de lo que
// pase después con la operación los cambia.
//
// Decisiones:
//  · El PDF se arma en el SERVIDOR (no en el navegador). Dos razones: (1) no hay
//    problema de CORS al incrustar las fotos de Cloudinary, y (2) está pendiente
//    pasar los documentos de Cloudinary a entrega autenticada con URLs firmadas —
//    un PDF armado en el servidor sigue funcionando después de ese cambio, uno
//    armado en el cliente se rompería.
//  · Lo que se guarda en la BD es el SNAPSHOT, no el PDF. El PDF se re-arma al
//    vuelo desde el snapshot, así que siempre corresponde a la versión congelada.
//  · Regenerar NO pisa: cada generación es una `version` nueva (historial completo).
//
// Este archivo es la parte BARATA (síncrona, sin red): leer el servicio y congelarlo.
// El armado del PDF vive aparte, en `lib/acta-servicio-pdf.ts`, por el mismo motivo por
// el que `lib/contabilidad.ts` y `lib/contabilidad-pdf.ts` están separados: `lib/db.ts`
// importa `lib/operaciones.ts`, que a su vez importa ESTE archivo para generar el acta
// de cierre; si jsPDF y sharp colgaran de acá, quedarían cargados en el arranque de
// prácticamente cualquier ruta de la app.
//
// Server-only (better-sqlite3): NO importar desde un componente 'use client'. La
// pantalla usa `import type` para los tipos, nada más.
import type Database from 'better-sqlite3';
import { lugarResumen, type Lugar } from './lugares';
import { getConfig } from './operaciones';
import type { InspeccionResultado } from './inspeccion-vehiculo';
import {
  esCasilla, parseFotosServicio, parseOmisiones,
  type CasillaId, type FaseFoto, type OmisionFoto,
} from './fotos-servicio';

type DB = Database.Database;

// `FaseFoto` y las casillas viven en lib/fotos-servicio.ts (módulo puro, lo comparten
// las pantallas). Se re-exporta desde acá porque lib/acta-servicio-pdf.ts ya lo
// importaba de este archivo y no hay razón para tocar ese import.
export type { FaseFoto, OmisionFoto };

/**
 * Una foto congelada en el acta. `casilla` es la zona guiada del recorrido
 * (lib/fotos-servicio.ts) y permite imprimir la salida y la entrada de la MISMA zona
 * juntas en el PDF. Vale `null` en dos casos, los dos normales: actas generadas antes
 * de las casillas (el campo no existía) y fotos sueltas de operaciones viejas.
 */
export type FotoActa = { url: string; fase: FaseFoto; casilla: CasillaId | null };

/** Quién pidió el acta. 'sistema' = se generó sola al cerrarse el servicio. */
export type ActorActa = { tipo: 'sistema' | 'admin'; id?: number | null; nombre?: string };

/**
 * Los datos CONGELADOS del servicio. Se serializan tal cual a `actas_servicio.datos`
 * y son la única fuente del PDF: si mañana cambia el precio de la reserva o se
 * reasigna el mensajero, las actas ya generadas siguen diciendo lo que decían.
 */
export type DatosActa = {
  generada_en: string;
  generada_por: 'sistema' | 'admin';
  generada_por_nombre: string;
  operacion: { id: number; estado: string; notas: string };
  reserva: {
    id: number; estado: string; pago_estado: string;
    fecha_inicio: string; fecha_fin: string;
    entrega_lugar: string; devolucion_lugar: string;
    total: number; recargo: number;
  };
  vehiculo: { marca: string; modelo: string; anio: number; placa: string };
  cliente: { nombre: string; celular: string; documento: string; tipo_documento: string };
  atendio: { mensajero_nombre: string; mensajero_celular: string };
  inspeccion: { estado: string; resultado: InspeccionResultado | null };
  /**
   * Casillas del recorrido de fotos que NO se pudieron tomar, con el motivo escrito a
   * mano, quién lo escribió y cuándo. Van dentro del snapshot (y no se releen de la
   * operación al imprimir) por la misma razón que todo lo demás: el acta dice lo que
   * había cuando se generó. Opcional porque las actas anteriores a las casillas
   * guiadas no lo traen.
   */
  omisiones?: OmisionFoto[];
  empresa: { nombre: string; nit: string };
};

export type ActaGuardada = {
  id: number;
  operacion_id: number;
  reserva_id: number;
  version: number;
  datos: DatosActa;
  fotos: FotoActa[];
  generada_por: string;
  generada_por_nombre: string;
  created_at: string;
};

type ActaRow = {
  id: number; operacion_id: number; reserva_id: number; version: number;
  datos: string; fotos: string; generada_por: string; generada_por_nombre: string; created_at: string;
};

// ── Helpers de lectura tolerante ────────────────────────────────────────────

function parseInspeccion(json: string | null | undefined): InspeccionResultado | null {
  if (!json) return null;
  try {
    const o = JSON.parse(json);
    return o && typeof o === 'object' ? (o as InspeccionResultado) : null;
  } catch {
    return null;
  }
}

function resumenLugar(json: string | null | undefined): string {
  try {
    const o = JSON.parse(json || '{}') as Lugar;
    return lugarResumen(o && o.municipio ? o : null);
  } catch {
    return '—';
  }
}

/**
 * Lee `actas_servicio.fotos`. Tolera las actas generadas ANTES de las casillas, que
 * no traen el campo `casilla` (queda en `null`): un acta vieja se sigue leyendo y se
 * sigue imprimiendo. Nunca lanza — la usa lib/limpieza-documentos.ts para decidir qué
 * NO se puede borrar de Cloudinary, y ahí un throw distinto del suyo sería un borrado
 * mal decidido.
 */
export function parseFotosActa(json: string | null | undefined): FotoActa[] {
  try {
    const a = JSON.parse(json || '[]');
    if (!Array.isArray(a)) return [];
    return a.flatMap((f): FotoActa[] => {
      if (!f || typeof f !== 'object') return [];
      const { url, fase, casilla } = f as { url?: unknown; fase?: unknown; casilla?: unknown };
      if (typeof url !== 'string' || !url) return [];
      return [{ url, fase: fase === 'entrada' ? 'entrada' : 'salida', casilla: esCasilla(casilla) ? casilla : null }];
    });
  } catch {
    return [];
  }
}

/**
 * Las casillas omitidas congeladas en el acta. Las actas anteriores a las casillas no
 * tienen el campo: devuelve lista vacía y el PDF simplemente no imprime esa sección.
 */
export function omisionesDeActa(datos: DatosActa | null | undefined): OmisionFoto[] {
  return parseOmisiones(datos?.omisiones);
}

function ahora(): string {
  // Mismo formato legible que usa el resto del panel (hora local, sin zona).
  return new Date().toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

// ── Armar el snapshot ────────────────────────────────────────────────────

type FilaServicio = {
  id: number; estado: string; notas: string; reserva_id: number;
  fotos_salida: string; fotos_entrada: string; fotos_omitidas: string;
  inspeccion_ia: string; inspeccion_estado: string;
  mensajero_nombre: string | null; mensajero_celular: string | null;
  fecha_inicio: string; fecha_fin: string; total: number; recargo: number;
  recogida: string; entrega: string; reserva_estado: string; pago_estado: string;
  marca: string; modelo: string; anio: number; placa: string;
  cliente_nombre: string; cliente_celular: string; cliente_documento: string; cliente_tipo_doc: string;
};

/**
 * Lee el estado ACTUAL del servicio y lo convierte en el par (datos, fotos) que se
 * va a congelar. Devuelve `null` si la operación no existe.
 */
export function armarDatosActa(db: DB, operacionId: number, actor: ActorActa): { datos: DatosActa; fotos: FotoActa[] } | null {
  const row = db.prepare(`
    SELECT o.id, o.estado, COALESCE(o.notas,'') AS notas, o.reserva_id,
           COALESCE(o.fotos_salida,'[]') AS fotos_salida, COALESCE(o.fotos_entrada,'[]') AS fotos_entrada,
           COALESCE(o.fotos_omitidas,'[]') AS fotos_omitidas,
           COALESCE(o.inspeccion_ia,'') AS inspeccion_ia, COALESCE(o.inspeccion_estado,'') AS inspeccion_estado,
           m.nombre AS mensajero_nombre, COALESCE(m.celular,'') AS mensajero_celular,
           r.fecha_inicio, r.fecha_fin, r.total, COALESCE(r.recargo,0) AS recargo,
           COALESCE(r.recogida,'{}') AS recogida, COALESCE(r.entrega,'{}') AS entrega,
           r.estado AS reserva_estado, COALESCE(r.pago_estado,'') AS pago_estado,
           v.marca, v.modelo, v.anio, COALESCE(v.placa,'') AS placa,
           u.nombre AS cliente_nombre, COALESCE(u.celular,'') AS cliente_celular,
           COALESCE(u.documento_identidad,'') AS cliente_documento,
           COALESCE(u.tipo_documento,'') AS cliente_tipo_doc
    FROM operaciones o
    JOIN reservas r  ON o.reserva_id = r.id
    JOIN vehiculos v ON r.vehiculo_id = v.id
    JOIN usuarios u  ON r.usuario_id = u.id
    LEFT JOIN mensajeros m ON o.mensajero_id = m.id
    WHERE o.id = ?
  `).get(operacionId) as FilaServicio | undefined;
  if (!row) return null;

  // `parseFotosServicio` lee los DOS formatos de la columna (ver lib/fotos-servicio.ts):
  // el legado `["url", …]` de las operaciones viejas y el actual `[{casilla, url}, …]`.
  // La casilla se congela junto con la URL para que el PDF pueda imprimir la foto de
  // salida y la de entrada de la misma zona una debajo de la otra.
  const fotos: FotoActa[] = [
    ...parseFotosServicio(row.fotos_salida).map((f): FotoActa => ({ url: f.url, fase: 'salida', casilla: f.casilla })),
    ...parseFotosServicio(row.fotos_entrada).map((f): FotoActa => ({ url: f.url, fase: 'entrada', casilla: f.casilla })),
  ];
  const omisiones = parseOmisiones(row.fotos_omitidas);

  const datos: DatosActa = {
    generada_en: ahora(),
    generada_por: actor.tipo,
    generada_por_nombre: actor.nombre || (actor.tipo === 'sistema' ? 'Cierre automático del servicio' : ''),
    operacion: { id: row.id, estado: row.estado, notas: row.notas },
    reserva: {
      id: row.reserva_id,
      estado: row.reserva_estado,
      pago_estado: row.pago_estado,
      fecha_inicio: row.fecha_inicio,
      fecha_fin: row.fecha_fin,
      entrega_lugar: resumenLugar(row.recogida),
      devolucion_lugar: resumenLugar(row.entrega),
      total: Number(row.total) || 0,
      recargo: Number(row.recargo) || 0,
    },
    vehiculo: { marca: row.marca, modelo: row.modelo, anio: row.anio, placa: row.placa },
    cliente: {
      nombre: row.cliente_nombre,
      celular: row.cliente_celular,
      documento: row.cliente_documento,
      tipo_documento: row.cliente_tipo_doc,
    },
    atendio: {
      mensajero_nombre: row.mensajero_nombre || '',
      mensajero_celular: row.mensajero_celular || '',
    },
    inspeccion: {
      estado: row.inspeccion_estado,
      resultado: parseInspeccion(row.inspeccion_ia),
    },
    omisiones,
    empresa: {
      nombre: getConfig(db, 'empresa_nombre') || 'DrivePass',
      nit: getConfig(db, 'empresa_nit') || '',
    },
  };

  return { datos, fotos };
}

// ── Guardar una versión nueva ────────────────────────────────────────────

/**
 * Congela el servicio en una fila nueva de `actas_servicio`. NUNCA pisa una versión
 * anterior: si ya había actas para esa operación, esta queda con la versión siguiente.
 * Devuelve `null` si la operación no existe.
 *
 * Es SÍNCRONA y barata a propósito (solo copia datos, no arma el PDF ni descarga
 * imágenes): así se puede llamar dentro del flujo normal de "marcar la última tarea"
 * sin frenar la respuesta ni depender de que Cloudinary conteste.
 */
export function generarActa(db: DB, operacionId: number, actor: ActorActa): ActaGuardada | null {
  const snapshot = armarDatosActa(db, operacionId, actor);
  if (!snapshot) return null;

  const insertar = db.transaction((): number => {
    const max = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM actas_servicio WHERE operacion_id = ?')
      .get(operacionId) as { v: number };
    const version = Number(max?.v || 0) + 1;
    const res = db.prepare(`
      INSERT INTO actas_servicio (operacion_id, reserva_id, version, datos, fotos, generada_por, generada_por_id, generada_por_nombre)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      operacionId,
      snapshot.datos.reserva.id,
      version,
      JSON.stringify(snapshot.datos),
      JSON.stringify(snapshot.fotos),
      actor.tipo,
      actor.id ?? null,
      snapshot.datos.generada_por_nombre,
    );
    return Number(res.lastInsertRowid);
  });

  const id = insertar();
  return leerActa(db, id);
}

/**
 * Genera el acta de cierre automáticamente, una sola vez por cierre: si la última
 * acta de esa operación ya se generó con el MISMO material de respaldo, no crea una
 * versión duplicada (evita llenar el historial cuando se marca y desmarca una tarea).
 */
export function generarActaCierre(db: DB, operacionId: number): ActaGuardada | null {
  const snapshot = armarDatosActa(db, operacionId, { tipo: 'sistema' });
  if (!snapshot) return null;
  const ultima = db.prepare('SELECT fotos, datos FROM actas_servicio WHERE operacion_id = ? ORDER BY version DESC LIMIT 1')
    .get(operacionId) as { fotos: string; datos: string } | undefined;
  if (ultima) {
    // Se comparan las tres cosas que SON el respaldo:
    //  · las fotos;
    //  · las casillas omitidas (si cambió el motivo de una omisión, eso es material
    //    nuevo y merece su versión aunque las fotos sean las mismas);
    //  · el veredicto de la inspección con IA. Un servicio se puede reabrir justo
    //    porque el veredicto era de un carro equivocado: al reabrir se limpia (ver
    //    `limpiarInspeccion` en lib/operaciones.ts), y si al cerrarlo de nuevo esto no
    //    contara, no se generaría ninguna versión y la última palabra del historial
    //    seguiría siendo el veredicto malo. La versión anterior NO se toca: sigue
    //    diciendo lo que decía, que es para lo que existe.
    let datosPrevios: DatosActa | null = null;
    try { datosPrevios = JSON.parse(ultima.datos) as DatosActa; } catch { datosPrevios = null; }
    const igualFotos = JSON.stringify(parseFotosActa(ultima.fotos)) === JSON.stringify(snapshot.fotos);
    const igualOmisiones = JSON.stringify(omisionesDeActa(datosPrevios)) === JSON.stringify(snapshot.datos.omisiones ?? []);
    const igualInspeccion = JSON.stringify(datosPrevios?.inspeccion ?? null) === JSON.stringify(snapshot.datos.inspeccion ?? null);
    if (igualFotos && igualOmisiones && igualInspeccion) return null;
  }
  return generarActa(db, operacionId, { tipo: 'sistema' });
}

function filaAActa(row: ActaRow): ActaGuardada {
  let datos: DatosActa;
  try {
    datos = JSON.parse(row.datos) as DatosActa;
  } catch {
    datos = {} as DatosActa;
  }
  return {
    id: row.id,
    operacion_id: row.operacion_id,
    reserva_id: row.reserva_id,
    version: row.version,
    datos,
    fotos: parseFotosActa(row.fotos),
    generada_por: row.generada_por,
    generada_por_nombre: row.generada_por_nombre,
    created_at: row.created_at,
  };
}

export function leerActa(db: DB, actaId: number): ActaGuardada | null {
  const row = db.prepare('SELECT * FROM actas_servicio WHERE id = ?').get(actaId) as ActaRow | undefined;
  return row ? filaAActa(row) : null;
}

export function listarActas(db: DB, operacionId: number): ActaGuardada[] {
  const rows = db.prepare('SELECT * FROM actas_servicio WHERE operacion_id = ? ORDER BY version DESC').all(operacionId) as ActaRow[];
  return rows.map(filaAActa);
}

/**
 * Lo que se le manda a la interfaz por cada acta: metadatos para listarlas y
 * descargarlas, SIN el snapshot completo (que incluye datos personales del cliente y
 * solo tiene sentido dentro del PDF).
 */
export type ActaResumen = {
  id: number;
  version: number;
  numero: string;
  created_at: string;
  generada_por: string;
  generada_por_nombre: string;
  fotos_total: number;
  tiene_inspeccion: boolean;
};

export function resumenActa(a: ActaGuardada): ActaResumen {
  return {
    id: a.id,
    version: a.version,
    numero: numeroActa(a),
    created_at: a.created_at,
    generada_por: a.generada_por,
    generada_por_nombre: a.generada_por_nombre,
    fotos_total: a.fotos.length,
    tiene_inspeccion: !!a.datos?.inspeccion?.resultado,
  };
}

/**
 * Los resúmenes de TODAS las actas, agrupados por operación, en UNA sola consulta.
 *
 * Existe para el tablero de Operaciones (GET /api/operaciones), que antes llamaba a
 * `listarActas` una vez por servicio: N consultas con `SELECT *`, trayendo el snapshot
 * completo de cada acta —los datos del cliente, la inspección, la lista de fotos— para
 * mostrar cuatro campos. Acá no se selecciona `datos`: de esa columna solo se pregunta
 * en SQL si hay inspección.
 *
 * `json_valid` protege el listado entero de una fila con JSON corrupto: sin él,
 * `json_extract` lanzaría y el tablero se quedaría sin cargar por un acta mala.
 */
export function resumenActasPorOperacion(db: DB): Map<number, ActaResumen[]> {
  type Fila = {
    id: number; operacion_id: number; version: number; fotos: string;
    generada_por: string; generada_por_nombre: string; created_at: string;
    tiene_inspeccion: number;
  };
  const filas = db.prepare(`
    SELECT id, operacion_id, version, fotos, generada_por, generada_por_nombre, created_at,
           CASE WHEN json_valid(datos) AND json_extract(datos, '$.inspeccion.resultado') IS NOT NULL
                THEN 1 ELSE 0 END AS tiene_inspeccion
    FROM actas_servicio
    ORDER BY operacion_id, version DESC
  `).all() as Fila[];

  const porOperacion = new Map<number, ActaResumen[]>();
  for (const f of filas) {
    const lista = porOperacion.get(f.operacion_id) ?? [];
    lista.push({
      id: f.id,
      version: f.version,
      numero: numeroActa(f),
      created_at: f.created_at,
      generada_por: f.generada_por,
      generada_por_nombre: f.generada_por_nombre,
      fotos_total: parseFotosActa(f.fotos).length,
      tiene_inspeccion: f.tiene_inspeccion === 1,
    });
    porOperacion.set(f.operacion_id, lista);
  }
  return porOperacion;
}

/** Nombre del archivo y número visible del acta: ACTA-000012-V2. */
export function numeroActa(acta: { operacion_id: number; version: number }): string {
  return `ACTA-${String(acta.operacion_id).padStart(6, '0')}-V${acta.version}`;
}
