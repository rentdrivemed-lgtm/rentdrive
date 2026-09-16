// ── Contratos digitales: de la base de datos al texto del documento ─────────
//
// Fase 1 del módulo de contratos: el MOTOR. Lee una reserva y devuelve el texto
// completo de cualquiera de los seis documentos que redactó el abogado. Todavía
// no hay firma (fase 2) ni PDF (fase 3).
//
// Reparto de responsabilidades, igual que en contabilidad y en el acta de servicio:
//   · lib/contratos-texto.ts      → conversores puros (letras, fechas, montos).
//   · lib/contratos-calculo.ts    → escala de comisión, IVA y derivados. Puro.
//   · lib/contratos-datos.ts      → la forma del snapshot y el inventario de campos. Puro.
//   · lib/contratos-plantillas.ts → las seis plantillas, palabra por palabra. Puro.
//   · ESTE archivo               → la única parte que toca la BD.
//
// Server-only (better-sqlite3 vía el tipo y `getConfig`): NO importar desde un
// componente 'use client'; para los tipos, `import type` de contratos-datos.

import type Database from 'better-sqlite3';
import { getConfig } from './operaciones';
import { calcularDiasAlquiler, getLugar, normalizarLugar, DIRECCION_PUNTO_ATENCION, MUNICIPIO_PUNTO_ATENCION, type Lugar } from './lugares';
import { leerPoliza } from './poliza-vehiculo';
import { parseFotosServicio } from './fotos-servicio';
import {
  calcularDerivados, comparacionComision, normalizarConfigIva,
  DEPOSITO_GARANTIA, IVA_TARIFA_DEFECTO,
  type ComparacionComision, type ConfigIva,
} from './contratos-calculo';
import { documentoFormateado, enMayusculas } from './contratos-texto';
import {
  AGENTE, CIUDAD_CONTRATO, LICENCIA_VACIA, PENDIENTE, faltantesDe, oPendiente,
  type CampoFaltante, type DatosContrato, type ExtremoOperacion, type Persona, type TipoDocumento,
} from './contratos-datos';
import { generarTexto } from './contratos-plantillas';

type DB = Database.Database;

// ── Configuración ───────────────────────────────────────────────────────────

/** Claves de `config` que gobiernan el IVA de los contratos. */
export const CLAVE_IVA_ACTIVO = 'iva_activo';
export const CLAVE_IVA_PCT = 'iva_pct';

/**
 * ¿Se cobra IVA y a qué tarifa? Lo pidió el dueño para poder apagarlo «mientras
 * organizamos la contabilidad». Ver el comentario largo en lib/contratos-calculo.ts:
 * la tarifa se guarda en PORCENTAJE ENTERO ('19'), no en fracción.
 */
export function configIva(db: DB): ConfigIva {
  const activo = getConfig(db, CLAVE_IVA_ACTIVO);
  const pct = getConfig(db, CLAVE_IVA_PCT);
  return normalizarConfigIva(activo, pct === '' ? IVA_TARIFA_DEFECTO : pct);
}

// ── Helpers de mapeo ────────────────────────────────────────────────────────

const TIPOS_DOC: Record<string, { texto: string; articulo: string; sigla: string }> = {
  cedula: { texto: 'cédula de ciudadanía', articulo: 'la', sigla: 'C.C.' },
  extranjeria: { texto: 'cédula de extranjería', articulo: 'la', sigla: 'C.E.' },
  pasaporte: { texto: 'pasaporte', articulo: 'el', sigla: 'Pasaporte' },
};

type FilaPersona = {
  nombre: string; correo: string; documento_identidad: string | null; tipo_documento: string | null;
  ciudad: string | null; direccion: string | null; celular: string | null; celular_indicativo: string | null;
  numero_licencia: string | null;
};

function armarPersona(f: FilaPersona): Persona {
  const tipo = TIPOS_DOC[(f.tipo_documento || 'cedula').trim()] ?? TIPOS_DOC.cedula;
  const celular = (f.celular || '').trim();
  return {
    nombre: enMayusculas(f.nombre) || PENDIENTE,
    tipoDocumento: tipo.texto,
    articulo: tipo.articulo,
    sigla: tipo.sigla,
    documento: oPendiente(documentoFormateado(f.documento_identidad || '')),
    ciudad: oPendiente(f.ciudad),
    direccion: oPendiente(f.direccion),
    correo: oPendiente(f.correo),
    celular: celular ? `${(f.celular_indicativo || '+57').trim()} ${celular}` : PENDIENTE,
    licencia: {
      ...LICENCIA_VACIA,
      numero: oPendiente(f.numero_licencia),
    },
  };
}

/**
 * Dirección del lugar tal como la escribe el otrosí: «Calle 42 A No. 68 A 10 de
 * Medellín, Antioquia». Los lugares del catálogo que no piden dirección (punto de
 * atención y aeropuertos) se nombran por su nombre propio.
 *
 * Todos los municipios del catálogo (lib/lugares.ts) están en Antioquia, por eso
 * el departamento va fijo.
 */
function direccionLugar(l: Lugar | null): string {
  if (!l || !l.municipio) return PENDIENTE;
  const cat = getLugar(l.municipio);
  if (!cat) return PENDIENTE;
  if (l.municipio === MUNICIPIO_PUNTO_ATENCION) return `${DIRECCION_PUNTO_ATENCION} de Medellín, Antioquia`;
  if (!cat.pideDireccion) return cat.nombre;
  const direccion = (l.direccion || '').trim();
  if (!direccion) return PENDIENTE;
  const barrio = (l.barrio || '').trim();
  return `${direccion}${barrio ? `, barrio ${barrio},` : ''} de ${cat.nombre}, Antioquia`;
}

function leerLugar(json: string | null | undefined): Lugar | null {
  try {
    return normalizarLugar(JSON.parse(json || '{}'));
  } catch {
    return null;
  }
}

function extremo(fechaISO: string, l: Lugar | null): ExtremoOperacion {
  return {
    fecha: fechaISO,
    hora: (l?.hora || '').trim() || PENDIENTE,
    lugar: direccionLugar(l),
  };
}

function hoyISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function consecutivo(prefijo: string, id: number): string {
  // Misma forma que los números de factura/remisión de lib/contabilidad.ts.
  return `${prefijo}-${String(id).padStart(6, '0')}`;
}

// ── Armado del snapshot ─────────────────────────────────────────────────────

type FilaContrato = {
  reserva_id: number; fecha_inicio: string; fecha_fin: string; total: number; recargo: number;
  creditos_usados: number; recogida: string; entrega: string;
  vehiculo_id: number; marca: string; modelo: string; anio: number; placa: string; documentos: string;
  propietario_id: number; cliente_id: number;
  p_nombre: string; p_correo: string; p_documento: string | null; p_tipo_doc: string | null;
  p_ciudad: string | null; p_direccion: string | null; p_celular: string | null; p_indicativo: string | null;
  p_licencia: string | null;
  c_nombre: string; c_correo: string; c_documento: string | null; c_tipo_doc: string | null;
  c_ciudad: string | null; c_direccion: string | null; c_celular: string | null; c_indicativo: string | null;
  c_licencia: string | null;
  fotos_salida: string | null; fotos_entrada: string | null;
};

export type OpcionesContrato = {
  /** Fecha de suscripción (ISO). Por defecto, hoy. La fase 2 la congelará al firmar. */
  fecha?: string;
  /** Permite forzar el IVA (pruebas y vista previa); si no, se lee de `config`. */
  iva?: ConfigIva;
};

/**
 * Lee la reserva y devuelve el snapshot con TODO lo que los seis documentos
 * necesitan. `null` si la reserva no existe.
 *
 * Lo que no está en la base queda en `PENDIENTE` (ver lib/contratos-datos.ts):
 * jamás se inventa un número de motor ni un dato de la póliza.
 */
export function armarDatosContrato(db: DB, reservaId: number, op: OpcionesContrato = {}): DatosContrato | null {
  const row = db.prepare(`
    SELECT r.id AS reserva_id, r.fecha_inicio, r.fecha_fin, r.total,
           COALESCE(r.recargo, 0) AS recargo, COALESCE(r.creditos_usados, 0) AS creditos_usados,
           COALESCE(r.recogida, '{}') AS recogida, COALESCE(r.entrega, '{}') AS entrega,
           v.id AS vehiculo_id, v.marca, v.modelo, v.anio, COALESCE(v.placa, '') AS placa,
           COALESCE(v.documentos, '{}') AS documentos,
           v.propietario_id, r.usuario_id AS cliente_id,
           p.nombre AS p_nombre, p.correo AS p_correo, p.documento_identidad AS p_documento,
           p.tipo_documento AS p_tipo_doc, p.ciudad AS p_ciudad, p.direccion AS p_direccion,
           p.celular AS p_celular, p.celular_indicativo AS p_indicativo, p.numero_licencia AS p_licencia,
           c.nombre AS c_nombre, c.correo AS c_correo, c.documento_identidad AS c_documento,
           c.tipo_documento AS c_tipo_doc, c.ciudad AS c_ciudad, c.direccion AS c_direccion,
           c.celular AS c_celular, c.celular_indicativo AS c_indicativo, c.numero_licencia AS c_licencia,
           o.fotos_salida, o.fotos_entrada
    FROM reservas r
    JOIN vehiculos v ON v.id = r.vehiculo_id
    JOIN usuarios p ON p.id = v.propietario_id
    JOIN usuarios c ON c.id = r.usuario_id
    LEFT JOIN operaciones o ON o.reserva_id = r.id
    WHERE r.id = ?
  `).get(reservaId) as FilaContrato | undefined;
  if (!row) return null;

  const dias = calcularDiasAlquiler(row.fecha_inicio, row.fecha_fin);

  // El canon del contrato es lo que se recauda POR EL ALQUILER: el total de la
  // reserva menos el recargo de traslado (que es un servicio distinto y, hoy, no
  // tiene cláusula en ninguno de los seis documentos — ver el reporte).
  // `reservas.total` ya viene con los créditos de referido descontados, así que
  // el canon corresponde a lo efectivamente cobrado, que es la base sobre la que
  // la cláusula cuarta liquida la comisión («canon efectivamente recaudado»).
  const canonRecaudado = Math.max(0, Math.round(Number(row.total) - Number(row.recargo)));
  const canonDiario = Math.round(canonRecaudado / dias);

  const derivados = calcularDerivados({
    dias,
    canonDiario,
    iva: op.iva ?? configIva(db),
    deposito: DEPOSITO_GARANTIA,
  });

  const poliza = leerPoliza(row.documentos);
  const fecha = op.fecha ?? hoyISO();

  // Numeración provisional (no hay tabla `contratos` todavía, ver el inventario):
  // el marco de arrendamiento se numera por reserva, el de agencia por vehículo, y
  // el otrosí de agencia lleva el consecutivo de operaciones de ese vehículo.
  const previas = db.prepare(`
    SELECT COUNT(*) AS n FROM reservas
    WHERE vehiculo_id = ? AND id < ? AND estado IN ('confirmada','en_curso','completada')
  `).get(row.vehiculo_id, row.reserva_id) as { n: number };

  return {
    fecha,
    fechaContratoArrendamiento: fecha,
    fechaContratoAgencia: fecha,
    ciudad: CIUDAD_CONTRATO,
    propietario: armarPersona({
      nombre: row.p_nombre, correo: row.p_correo, documento_identidad: row.p_documento,
      tipo_documento: row.p_tipo_doc, ciudad: row.p_ciudad, direccion: row.p_direccion,
      celular: row.p_celular, celular_indicativo: row.p_indicativo, numero_licencia: row.p_licencia,
    }),
    cliente: armarPersona({
      nombre: row.c_nombre, correo: row.c_correo, documento_identidad: row.c_documento,
      tipo_documento: row.c_tipo_doc, ciudad: row.c_ciudad, direccion: row.c_direccion,
      celular: row.c_celular, celular_indicativo: row.c_indicativo, numero_licencia: row.c_licencia,
    }),
    agente: AGENTE,
    vehiculo: {
      placa: oPendiente(row.placa),
      marca: enMayusculas(row.marca) || PENDIENTE,
      // ⚠️ En la BD la columna `modelo` guarda la LÍNEA (Corolla, CX-5) y `anio` el
      // modelo. Los documentos usan la nomenclatura de la matrícula.
      linea: enMayusculas(row.modelo) || PENDIENTE,
      anio: Number(row.anio) || 0,
      color: PENDIENTE,
      motor: PENDIENTE,
      chasis: PENDIENTE,
      servicio: 'particular',
      valorAsegurado: 0,
    },
    poliza: {
      numero: PENDIENTE,
      aseguradora: PENDIENTE,
      aseguradoraNit: PENDIENTE,
      // Las fechas van con la marca de pendiente (no vacías) para que el hueco se
      // VEA en el documento en vez de dejar una frase con dos espacios seguidos.
      expedidaEl: PENDIENTE,
      vigenciaDesde: PENDIENTE,
      vigenciaHasta: poliza?.vence || PENDIENTE,
      codigoClausulado: PENDIENTE,
      notaTecnica: PENDIENTE,
      deducible: PENDIENTE,
    },
    operacion: {
      entrega: extremo(row.fecha_inicio, leerLugar(row.recogida)),
      restitucion: extremo(row.fecha_fin, leerLugar(row.entrega)),
      // Política actual de DrivePass; el otrosí trae el texto de kilometraje
      // ilimitado fijo (ver el reporte).
      kilometraje: 'ilimitado',
      costoKmExceso: 'no aplica',
      // La plataforma no guarda conductores autorizados distintos del cliente.
      conductores: [],
      fotosEntrega: parseFotosServicio(row.fotos_salida).length,
      fotosDevolucion: parseFotosServicio(row.fotos_entrada).length,
    },
    numeros: {
      contratoArrendamiento: consecutivo('AR', row.reserva_id),
      otrosiArrendamiento: '1',
      contratoAgencia: consecutivo('AG', row.vehiculo_id),
      otrosiAgencia: String((Number(previas?.n) || 0) + 1),
      acta: consecutivo('AC', row.reserva_id),
    },
    iva: derivados.iva,
    derivados,
    origen: {
      reservaId: row.reserva_id,
      vehiculoId: row.vehiculo_id,
      propietarioId: row.propietario_id,
      clienteId: row.cliente_id,
      canonRecaudado,
      // Si el canon recaudado no es múltiplo exacto de los días (pasa cuando el
      // cliente usó créditos de referido), el canon diario se redondea y aparece
      // esta diferencia. Quien firme tiene que resolverla antes: el documento no
      // puede decir un total distinto del que se cobró.
      ajusteRedondeoCanon: canonRecaudado - derivados.canonTotal,
    },
  };
}

// ── Generación del texto ────────────────────────────────────────────────────

export type DocumentoGenerado = {
  tipo: TipoDocumento;
  texto: string;
  datos: DatosContrato;
  /** Campos que quedaron en blanco en ESTE documento. La fase 2 no debe dejar firmar si hay alguno. */
  faltantes: CampoFaltante[];
};

/** Texto de un documento a partir de un snapshot ya armado. */
export function generarDocumento(tipo: TipoDocumento, datos: DatosContrato): DocumentoGenerado {
  return { tipo, texto: generarTexto(tipo, datos), datos, faltantes: faltantesDe(datos, tipo) };
}

/** Texto de un documento a partir de una reserva. `null` si la reserva no existe. */
export function generarDocumentoDeReserva(
  db: DB, tipo: TipoDocumento, reservaId: number, op: OpcionesContrato = {},
): DocumentoGenerado | null {
  const datos = armarDatosContrato(db, reservaId, op);
  return datos ? generarDocumento(tipo, datos) : null;
}

// ── Diagnóstico: escala del contrato vs. porcentaje único de hoy ────────────

export type ComparacionLiquidacion = ComparacionComision & {
  liquidacionId: number;
  reservaId: number;
  /** Lo que se le descontó REALMENTE al propietario en esa liquidación. */
  comisionLiquidada: number;
};

/**
 * Para cada liquidación existente, cuánto habría sido la comisión con la ESCALA
 * del contrato de agencia frente a lo que se descontó de verdad. Solo lee: no
 * corrige nada (esa decisión es del dueño).
 */
export function compararComisionLiquidaciones(db: DB, pctGlobalFraccion: number): ComparacionLiquidacion[] {
  const filas = db.prepare(`
    SELECT l.id AS liquidacion_id, l.reserva_id, l.bruto, l.comision_pct, l.comision_valor,
           r.fecha_inicio, r.fecha_fin
    FROM liquidaciones l
    JOIN reservas r ON r.id = l.reserva_id
    ORDER BY l.id
  `).all() as Array<{
    liquidacion_id: number; reserva_id: number; bruto: number;
    comision_pct: number; comision_valor: number; fecha_inicio: string; fecha_fin: string;
  }>;

  return filas.map(f => {
    const dias = calcularDiasAlquiler(f.fecha_inicio, f.fecha_fin);
    const base = comparacionComision(dias, f.bruto, Number(f.comision_pct) || pctGlobalFraccion);
    return {
      ...base,
      liquidacionId: f.liquidacion_id,
      reservaId: f.reserva_id,
      comisionLiquidada: Math.round(Number(f.comision_valor) || 0),
    };
  });
}
