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
  type ReporteImpreso,
} from './contratos-datos';
import { generarTexto } from './contratos-plantillas';
import type { OverridesContrato } from './contratos-campos';
import { combustibleTexto, leerIntervenciones, leerReporte } from './reporte-entrega';

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
  /** Columnas nuevas (ver lib/db.ts → crearColumnasDatosContrato): el acta las exige. */
  licencia_categoria: string | null;
  licencia_vence: string | null;
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
      categoria: oPendiente(f.licencia_categoria),
      vigenciaHasta: oPendiente(f.licencia_vence),
    },
  };
}

/**
 * La misma `Persona` de los contratos de operación, pero armada desde UNA CUENTA y sin
 * pasar por una reserva. La necesitan los contratos de vinculación (lib/contratos-
 * vinculacion.ts), que se firman al registrarse, cuando todavía no existe ni reserva ni
 * vehículo de los que sacar las partes.
 *
 * Devuelve `null` solo si la cuenta no existe. Los campos que la persona todavía no ha
 * completado salen como PENDIENTE, igual que en el resto del módulo; quién decide si eso
 * bloquea la firma es `faltantesVinculacion()`.
 */
export function personaDeUsuario(db: DB, usuarioId: number): Persona | null {
  const f = db.prepare(`
    SELECT nombre, correo, documento_identidad, tipo_documento, ciudad, direccion,
           celular, celular_indicativo, numero_licencia, licencia_categoria, licencia_vence
    FROM usuarios WHERE id = ?
  `).get(Number(usuarioId)) as FilaPersona | undefined;
  return f ? armarPersona(f) : null;
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

/**
 * Aplica el parche de la operación a un extremo (entrega/restitución): la hora y el
 * lugar tal como van IMPRESOS. La fecha nunca se parcha (ver `armarDatosContrato`).
 * Un parche vacío deja el valor que salió de la reserva.
 */
function conParche(base: ExtremoOperacion, hora?: string, lugar?: string): ExtremoOperacion {
  return {
    fecha: base.fecha,
    hora: (hora || '').trim() || base.hora,
    lugar: (lugar || '').trim() || base.lugar,
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
  // Datos de la matrícula y de la carátula de la póliza. Antes NO existían en la
  // base (se imprimían en blanco); hoy viven en la ficha del vehículo y se llenan
  // desde la pantalla de datos del contrato (lib/contratos-edicion.ts).
  color: string; numero_motor: string; numero_chasis: string; valor_asegurado: number;
  poliza_numero: string; poliza_aseguradora: string; poliza_aseguradora_nit: string;
  poliza_expedida_el: string; poliza_vigencia_desde: string; poliza_vigencia_hasta: string;
  poliza_codigo_clausulado: string; poliza_nota_tecnica: string; poliza_deducible: string;
  propietario_id: number; cliente_id: number;
  p_nombre: string; p_correo: string; p_documento: string | null; p_tipo_doc: string | null;
  p_ciudad: string | null; p_direccion: string | null; p_celular: string | null; p_indicativo: string | null;
  p_licencia: string | null; p_licencia_categoria: string | null; p_licencia_vence: string | null;
  c_nombre: string; c_correo: string; c_documento: string | null; c_tipo_doc: string | null;
  c_ciudad: string | null; c_direccion: string | null; c_celular: string | null; c_indicativo: string | null;
  c_licencia: string | null; c_licencia_categoria: string | null; c_licencia_vence: string | null;
  operacion_id: number | null;
  fotos_salida: string | null; fotos_entrada: string | null;
};

export type OpcionesContrato = {
  /** Fecha de suscripción (ISO). Por defecto, hoy. La fase 2 la congelará al firmar. */
  fecha?: string;
  /** Permite forzar el IVA (pruebas y vista previa); si no, se lee de `config`. */
  iva?: ConfigIva;
  /**
   * Parche de datos de ESTA operación (`contratos.overrides_json`), lo que se edita
   * desde la pantalla de datos del contrato y no tiene ficha propia donde vivir.
   * Ver lib/contratos-campos.ts y lib/contratos-edicion.ts.
   */
  overrides?: OverridesContrato;
  /**
   * Los contratos MARCO ya suscritos a los que este documento se encadena.
   *
   * Los otrosíes no son documentos sueltos: dicen «el [fecha] las partes celebraron EL
   * CONTRATO» y modifican aquel. Sin esto, la fecha citada era la de HOY y el número un
   * consecutivo calculado a partir de la reserva —o sea, el otrosí afirmaba que su
   * contrato padre se firmó el mismo día, y citaba un número que no era el de ningún
   * documento existente—. Lo rellena `lib/contratos-operacion.ts`, que es quien
   * localiza o emite los marcos antes de los otrosíes.
   */
  marcos?: {
    agencia?: { numero: string; fecha: string };
    arrendamiento?: { numero: string; fecha: string };
  };
};

/**
 * Lee la reserva y devuelve el snapshot con TODO lo que los seis documentos
 * necesitan. `null` si la reserva no existe.
 *
 * Lo que no está en la base queda en `PENDIENTE` (ver lib/contratos-datos.ts):
 * jamás se inventa un número de motor ni un dato de la póliza.
 */
/**
 * Pasa el reporte de la operación a la forma que el acta imprime.
 *
 * Solo traduce: no decide nada y no inventa valores. Un dato que no se tomó sale vacío,
 * y la plantilla lo pinta con su raya — el acta no puede afirmar un kilometraje que
 * nadie leyó.
 */
function armarReporteImpreso(db: DB, operacionId: number): DatosContrato['operacion']['reporte'] {
  const deFase = (fase: 'salida' | 'entrada'): ReporteImpreso => {
    const r = leerReporte(db, operacionId, fase);
    if (!r) return { kilometraje: '', combustible: '', inventario: {}, confirmadoEn: '', constancia: '' };
    return {
      kilometraje: r.kilometraje === null ? '' : String(r.kilometraje),
      combustible: combustibleTexto(r.combustible),
      inventario: r.inventario,
      confirmadoEn: r.confirmadoEn,
      constancia: r.constancia,
    };
  };

  return {
    entrega: deFase('salida'),
    devolucion: deFase('entrada'),
    intervenciones: leerIntervenciones(db, operacionId).map(i => ({
      nombre: i.nombre, rol: i.rol, accion: i.accion, fase: i.fase, cuando: i.cuando,
    })),
  };
}

export function armarDatosContrato(db: DB, reservaId: number, op: OpcionesContrato = {}): DatosContrato | null {
  const row = db.prepare(`
    SELECT r.id AS reserva_id, r.fecha_inicio, r.fecha_fin, r.total,
           COALESCE(r.recargo, 0) AS recargo, COALESCE(r.creditos_usados, 0) AS creditos_usados,
           COALESCE(r.recogida, '{}') AS recogida, COALESCE(r.entrega, '{}') AS entrega,
           v.id AS vehiculo_id, v.marca, v.modelo, v.anio, COALESCE(v.placa, '') AS placa,
           COALESCE(v.documentos, '{}') AS documentos,
           COALESCE(v.color, '') AS color, COALESCE(v.numero_motor, '') AS numero_motor,
           COALESCE(v.numero_chasis, '') AS numero_chasis, COALESCE(v.valor_asegurado, 0) AS valor_asegurado,
           COALESCE(v.poliza_numero, '') AS poliza_numero,
           COALESCE(v.poliza_aseguradora, '') AS poliza_aseguradora,
           COALESCE(v.poliza_aseguradora_nit, '') AS poliza_aseguradora_nit,
           COALESCE(v.poliza_expedida_el, '') AS poliza_expedida_el,
           COALESCE(v.poliza_vigencia_desde, '') AS poliza_vigencia_desde,
           COALESCE(v.poliza_vigencia_hasta, '') AS poliza_vigencia_hasta,
           COALESCE(v.poliza_codigo_clausulado, '') AS poliza_codigo_clausulado,
           COALESCE(v.poliza_nota_tecnica, '') AS poliza_nota_tecnica,
           COALESCE(v.poliza_deducible, '') AS poliza_deducible,
           v.propietario_id, r.usuario_id AS cliente_id,
           p.nombre AS p_nombre, p.correo AS p_correo, p.documento_identidad AS p_documento,
           p.tipo_documento AS p_tipo_doc, p.ciudad AS p_ciudad, p.direccion AS p_direccion,
           p.celular AS p_celular, p.celular_indicativo AS p_indicativo, p.numero_licencia AS p_licencia,
           p.licencia_categoria AS p_licencia_categoria, p.licencia_vence AS p_licencia_vence,
           c.nombre AS c_nombre, c.correo AS c_correo, c.documento_identidad AS c_documento,
           c.tipo_documento AS c_tipo_doc, c.ciudad AS c_ciudad, c.direccion AS c_direccion,
           c.celular AS c_celular, c.celular_indicativo AS c_indicativo, c.numero_licencia AS c_licencia,
           c.licencia_categoria AS c_licencia_categoria, c.licencia_vence AS c_licencia_vence,
           o.id AS operacion_id, o.fotos_salida, o.fotos_entrada
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

  // El PARCHE de esta operación (lib/contratos-campos.ts). Es lo único que puede
  // apartarse de lo que dice la base, y solo en los datos que no tienen ficha propia:
  // canon, depósito, kilometraje, horas, lugares, conductores y fecha de suscripción.
  // Nunca toca el texto: el texto se vuelve a generar con estos datos.
  const ov = op.overrides ?? {};
  const canonDiario = ov.canonDiario !== undefined && ov.canonDiario > 0
    ? Math.round(ov.canonDiario)
    : Math.round(canonRecaudado / dias);

  const derivados = calcularDerivados({
    dias,
    canonDiario,
    iva: op.iva ?? configIva(db),
    deposito: ov.deposito !== undefined && ov.deposito >= 0 ? ov.deposito : DEPOSITO_GARANTIA,
  });

  const poliza = leerPoliza(row.documentos);
  const fecha = ov.fecha || op.fecha || hoyISO();

  // Numeración provisional (no hay tabla `contratos` todavía, ver el inventario):
  // el marco de arrendamiento se numera por reserva, el de agencia por vehículo, y
  // el otrosí de agencia lleva el consecutivo de operaciones de ese vehículo.
  const previas = db.prepare(`
    SELECT COUNT(*) AS n FROM reservas
    WHERE vehiculo_id = ? AND id < ? AND estado IN ('confirmada','en_curso','completada')
  `).get(row.vehiculo_id, row.reserva_id) as { n: number };

  return {
    fecha,
    // La fecha del marco, cuando se conoce; si no, hoy — que es lo que había siempre y
    // sigue siendo lo correcto para una vista previa sin marcos todavía emitidos.
    fechaContratoArrendamiento: op.marcos?.arrendamiento?.fecha || fecha,
    fechaContratoAgencia: op.marcos?.agencia?.fecha || fecha,
    ciudad: CIUDAD_CONTRATO,
    propietario: armarPersona({
      nombre: row.p_nombre, correo: row.p_correo, documento_identidad: row.p_documento,
      tipo_documento: row.p_tipo_doc, ciudad: row.p_ciudad, direccion: row.p_direccion,
      celular: row.p_celular, celular_indicativo: row.p_indicativo, numero_licencia: row.p_licencia,
      licencia_categoria: row.p_licencia_categoria, licencia_vence: row.p_licencia_vence,
    }),
    cliente: armarPersona({
      nombre: row.c_nombre, correo: row.c_correo, documento_identidad: row.c_documento,
      tipo_documento: row.c_tipo_doc, ciudad: row.c_ciudad, direccion: row.c_direccion,
      celular: row.c_celular, celular_indicativo: row.c_indicativo, numero_licencia: row.c_licencia,
      licencia_categoria: row.c_licencia_categoria, licencia_vence: row.c_licencia_vence,
    }),
    agente: AGENTE,
    vehiculo: {
      placa: oPendiente(row.placa),
      marca: enMayusculas(row.marca) || PENDIENTE,
      // ⚠️ En la BD la columna `modelo` guarda la LÍNEA (Corolla, CX-5) y `anio` el
      // modelo. Los documentos usan la nomenclatura de la matrícula.
      linea: enMayusculas(row.modelo) || PENDIENTE,
      anio: Number(row.anio) || 0,
      color: oPendiente(row.color),
      motor: oPendiente(row.numero_motor),
      chasis: oPendiente(row.numero_chasis),
      servicio: 'particular',
      valorAsegurado: Math.max(0, Math.round(Number(row.valor_asegurado) || 0)),
    },
    poliza: {
      numero: oPendiente(row.poliza_numero),
      aseguradora: oPendiente(row.poliza_aseguradora),
      aseguradoraNit: oPendiente(row.poliza_aseguradora_nit),
      // Las fechas van con la marca de pendiente (no vacías) para que el hueco se
      // VEA en el documento en vez de dejar una frase con dos espacios seguidos.
      expedidaEl: oPendiente(row.poliza_expedida_el),
      vigenciaDesde: oPendiente(row.poliza_vigencia_desde),
      // DOS orígenes, y el orden importa: manda la columna que se escribe desde la
      // pantalla de datos del contrato y, si está vacía, se usa la fecha que se cargó
      // junto con el archivo de la carátula (`documentos.poliza.vence`), que es la que
      // ya existía. Así el dato que alguien escribió a mano nunca se pisa en silencio.
      vigenciaHasta: oPendiente(row.poliza_vigencia_hasta || poliza?.vence || ''),
      codigoClausulado: oPendiente(row.poliza_codigo_clausulado),
      notaTecnica: oPendiente(row.poliza_nota_tecnica),
      deducible: oPendiente(row.poliza_deducible),
    },
    operacion: {
      // Las FECHAS no admiten parche a propósito: salen de la reserva y de ellas
      // dependen los días, el canon y la disponibilidad. Cambiarlas desde el contrato
      // dejaría el documento diciendo una cosa y la reserva otra.
      entrega: conParche(extremo(row.fecha_inicio, leerLugar(row.recogida)), ov.entregaHora, ov.entregaLugar),
      restitucion: conParche(extremo(row.fecha_fin, leerLugar(row.entrega)), ov.restitucionHora, ov.restitucionLugar),
      // Política actual de DrivePass; el otrosí trae el texto de kilometraje
      // ilimitado fijo (ver el reporte).
      kilometraje: ov.kilometraje || 'ilimitado',
      costoKmExceso: ov.costoKmExceso || 'no aplica',
      // Los conductores autorizados no tienen tabla propia (no son cuentas de la
      // plataforma): son de ESTA operación y viven en el parche del contrato.
      conductores: (ov.conductores ?? []).map(c => ({
        nombre: enMayusculas(c.nombre) || PENDIENTE,
        documento: oPendiente(documentoFormateado(c.documento || '')),
        licencia: {
          numero: oPendiente(c.licenciaNumero),
          categoria: oPendiente(c.licenciaCategoria),
          vigenciaHasta: oPendiente(c.licenciaVence),
        },
      })),
      // Lo que se anotó con el vehículo delante, para que el acta lo IMPRIMA en vez de
      // dejar rayas. Ver lib/reporte-entrega.ts.
      reporte: row.operacion_id ? armarReporteImpreso(db, Number(row.operacion_id)) : undefined,
      fotosEntrega: parseFotosServicio(row.fotos_salida).length,
      fotosDevolucion: parseFotosServicio(row.fotos_entrada).length,
    },
    numeros: {
      // Los dos marcos citan su número REAL cuando ya existen. El consecutivo calculado
      // queda solo como respaldo para la vista previa de un documento que todavía no
      // tiene marco emitido.
      contratoArrendamiento: op.marcos?.arrendamiento?.numero || consecutivo('AR', row.reserva_id),
      otrosiArrendamiento: '1',
      contratoAgencia: op.marcos?.agencia?.numero || consecutivo('AG', row.vehiculo_id),
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
