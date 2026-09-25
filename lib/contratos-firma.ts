// ── Contratos digitales, fase 2: LA FIRMA ───────────────────────────────────
//
// La fase 1 (lib/contratos.ts) genera el TEXTO de los seis documentos a partir de
// una reserva. Este archivo es lo que los convierte en documentos firmables:
//
//   · los CONGELA   → el texto que se firmó se guarda palabra por palabra, junto
//                     con el snapshot de datos del que salió. Si mañana cambia la
//                     dirección del cliente o el precio del carro, el contrato
//                     firmado sigue diciendo lo que decía. Mismo criterio que
//                     `actas_servicio` (lib/operaciones.ts → congelarActa).
//   · los SELLA     → cada firma lleva un HMAC-SHA256 con `FIRMA_SECRET` que cubre
//                     EL TEXTO ÍNTEGRO del documento. Si alguien edita una cláusula
//                     en la base después de firmada, el sello deja de verificar.
//   · los reparte   → un documento no tiene «una firma», tiene varios BLOQUES de
//                     firma, de personas distintas y en momentos distintos (ver
//                     lib/contratos-bloques.ts).
//
// Se apoya en la firma electrónica simple que YA existía para las cuentas de cobro
// (lib/contabilidad.ts → firmarCuentaCobro): mismo trazo en PNG, mismo nombre
// confirmado por el firmante, misma IP y user-agent, mismo secreto de servidor
// (lib/firma-sello.ts) y la misma prohibición de firmar dos veces el mismo bloque.
// Lo único que cambia es QUÉ cubre el sello: allá los importes y el desglose; aquí
// el texto completo del documento.
//
// ⚠️ Server-only (better-sqlite3, `crypto`): no importar desde un componente
// 'use client'. Para los tipos, `import type`.

import type Database from 'better-sqlite3';
import { TITULOS_VINCULACION } from './contratos-vinculacion-texto';
import { createHash } from 'crypto';
import { igualesEnTiempoConstante, sellarHmac } from './firma-sello';
import { type OpcionesContrato, armarDatosContrato, generarDocumento } from './contratos';
import {
  TIPOS_DOCUMENTO, TITULOS_DOCUMENTO,
  type CampoFaltante, type DatosContrato, type TipoDocumento,
} from './contratos-datos';
import { bloquesDe, type DefBloqueFirma, type RolFirmante } from './contratos-bloques';
import { validarFirmaPng } from './firma-imagen';
import { registrarAuditoriaEstricta } from './permisos';

type DB = Database.Database;

// ── Estados y numeración ────────────────────────────────────────────────────

/**
 * · 'pendiente' → emitido, con bloques de firma por recoger. Es el único estado
 *                 en el que se puede firmar.
 * · 'firmado'   → TODOS sus bloques tienen trazo. Inmutable: no se edita ni se
 *                 regenera; si hay que cambiarlo se anula y se emite otro.
 * · 'anulado'   → se dejó sin efecto. No se borra nunca: conserva su texto y las
 *                 firmas que hubiera recogido (mismo criterio que
 *                 `remisiones_anuladas` en contabilidad).
 */
export type EstadoContrato = 'pendiente' | 'firmado' | 'anulado';

/**
 * Por qué vía se firmó el documento (fase 4, el mostrador).
 *
 * · ''        → todavía no se ha puesto ninguna firma por ninguna vía.
 * · 'digital' → firma electrónica por bloques, en pantalla o con imagen cargada.
 * · 'papel'   → se imprimió, se firmó a mano y se subió el escaneado.
 *
 * SON EXCLUYENTES, y esa es la decisión de diseño que resuelve «un contrato no puede
 * quedar firmado por las dos vías a la vez»: la columna se escribe con un UPDATE
 * CONDICIONADO a su valor anterior, de modo que la exclusión la garantiza la base de
 * datos y no una comprobación en memoria que dos peticiones simultáneas podrían
 * cruzar. El primero que llega fija la vía; el segundo recibe 409.
 */
export type ViaFirma = '' | 'digital' | 'papel';

/** Prefijo del consecutivo propio de cada tipo de documento. */
const PREFIJO_NUMERO: Record<TipoDocumento, string> = {
  'agencia': 'CAG',
  'otrosi-agencia': 'OAG',
  'arrendamiento': 'CAR',
  'otrosi-arrendamiento': 'OAR',
  'acta-entrega': 'ACT',
  'pagare': 'PAG',
};

/**
 * Numeración propia de la tabla `contratos`, con la misma forma que los números de
 * factura y remisión de lib/contabilidad.ts. La reemisión añade el sufijo de
 * versión, igual que REM-000012 → REM-000012-R2.
 *
 * `idRaiz` es el id de la PRIMERA versión de ese documento (no el de la fila nueva):
 * así toda la familia comparte el número base y se ve de un vistazo que CAR-000012-R2
 * reemplaza a CAR-000012. Con el id propio de cada reemisión, el número saltaría a un
 * consecutivo cualquiera y se perdería el hilo.
 *
 * OJO: es un número DISTINTO del que el texto del documento cita dentro de sus
 * cláusulas (`DatosContrato.numeros`, que se deriva de la reserva y del vehículo
 * porque así lo exige la redacción del abogado: el contrato marco de agencia se
 * numera por vehículo y su otrosí lleva el consecutivo de operaciones de ese
 * vehículo). Este es el del archivo; aquel es el del texto.
 */
export function numeroContrato(tipo: TipoDocumento, idRaiz: number, version: number): string {
  const base = `${PREFIJO_NUMERO[tipo]}-${String(idRaiz).padStart(6, '0')}`;
  return version > 1 ? `${base}-R${version}` : base;
}

export function esTipoDocumento(v: unknown): v is TipoDocumento {
  return typeof v === 'string' && (TIPOS_DOCUMENTO as readonly string[]).includes(v);
}

/** Reservas sobre las que tiene sentido emitir documentos. */
const ESTADOS_RESERVA_CONTRATABLES = ['confirmada', 'en_curso', 'completada'];

// ── Filas ───────────────────────────────────────────────────────────────────

export type ContratoRow = {
  id: number;
  reserva_id: number;
  vehiculo_id: number;
  propietario_id: number;
  cliente_id: number;
  tipo: TipoDocumento;
  numero: string;
  version: number;
  estado: EstadoContrato;
  /** Texto íntegro CONGELADO. Es lo que se firma y lo que cubre el sello. */
  texto: string;
  /** Snapshot `DatosContrato` con el que se generó el texto (JSON). */
  datos_json: string;
  /** Campos que quedaron en blanco al emitirlo (JSON de `CampoFaltante` reducido). */
  faltantes_json: string;
  // ── Edición de DATOS (no del texto) ──
  /**
   * Parche de datos de ESTA operación: canon, depósito, kilometraje, horas, lugares,
   * conductores autorizados y fecha de suscripción (JSON de `OverridesContrato`).
   * Lo que es del vehículo o de la persona NO está aquí: está en su ficha.
   */
  overrides_json: string;
  /** Sube +1 en cada edición de datos. Ver `firmarBloqueContrato`. */
  datos_revision: number;
  datos_editados_en: string;
  datos_editados_por: number | null;
  datos_editados_por_nombre: string;
  generado_por: number | null;
  generado_por_nombre: string;
  firmado_en: string;
  anulado_en: string;
  anulado_por: number | null;
  anulado_por_nombre: string;
  motivo_anulacion: string;
  // ── Fase 4: el mostrador ──
  /**
   * '' = sin decidir · 'digital' = firma electrónica por bloques · 'papel' = se
   * imprimió, se firmó a mano y se subió el escaneado. Las dos vías son EXCLUYENTES
   * (ver `firmarBloqueContrato` y lib/contratos-papel.ts → registrarFirmaEnPapel).
   */
  via_firma: ViaFirma;
  papel_subido_en: string;
  papel_subido_por: number | null;
  papel_subido_por_nombre: string;
  papel_nombre_archivo: string;
  papel_mime: string;
  papel_bytes: number;
  /** SHA-256 (hex) de los bytes del escaneado. Los bytes viven en `contrato_escaneos`. */
  papel_sha256: string;
  /** Sello HMAC del acto de firma en papel ('cp1:<hex>'). Ver lib/contratos-papel.ts. */
  papel_sello: string;
  created_at: string;
};

export type FirmaContratoRow = {
  id: number;
  contrato_id: number;
  bloque: string;
  etiqueta: string;
  rol: RolFirmante;
  momento: string;
  orden: number;
  /** Quién DEBE firmar. NULL para el agente (cualquier admin con el permiso) y codeudores. */
  usuario_esperado_id: number | null;
  nombre_esperado: string;
  documento_esperado: string;
  firmada_en: string;
  firmada_por_id: number | null;
  firma_nombre_confirmado: string;
  firma_imagen: string;
  firma_metodo: string;
  firma_ip: string;
  firma_user_agent: string;
  firma_hash: string;
  created_at: string;
};

/** Cómo llegó el trazo. Las dos vías que pidió el dueño. */
export type MetodoFirma = 'trazo' | 'carga';
export function esMetodoFirma(v: unknown): v is MetodoFirma {
  return v === 'trazo' || v === 'carga';
}

// ── Huecos del documento ────────────────────────────────────────────────────

/** Versión reducida de `CampoFaltante` que se congela con el contrato. */
export type FaltanteCongelado = { ruta: string; etiqueta: string; fuente: string; enBD: boolean };

export function faltantesCongelados(faltantes: readonly CampoFaltante[]): FaltanteCongelado[] {
  return faltantes.map(f => ({ ruta: f.ruta, etiqueta: f.etiqueta, fuente: f.fuente, enBD: f.enBD }));
}

export function parsearFaltantes(json: string | null | undefined): FaltanteCongelado[] {
  try {
    const v: unknown = JSON.parse(json || '[]');
    if (!Array.isArray(v)) return [];
    return v.flatMap(x => {
      if (!x || typeof x !== 'object') return [];
      const o = x as Record<string, unknown>;
      return [{
        ruta: String(o.ruta || ''), etiqueta: String(o.etiqueta || ''),
        fuente: String(o.fuente || ''), enBD: o.enBD === true,
      }];
    });
  } catch {
    return [];
  }
}

/**
 * Los huecos que SÍ se pueden llenar hoy y que por tanto BLOQUEAN la firma.
 *
 * ⚠️ Decisión importante, y hay que entenderla antes de tocarla. `faltantesDe()`
 * (lib/contratos-datos.ts) mezcla dos cosas muy distintas:
 *
 *   · `enBD: true`  → el dato TIENE dónde vivir y está vacío: al cliente le falta
 *                     la cédula, al propietario la dirección. Es subsanable en dos
 *                     minutos desde el panel, así que firmar con ese hueco sería
 *                     descuido: se BLOQUEA.
 *   · `enBD: false` → el dato NO TIENE dónde vivir todavía en la plataforma (el
 *                     número de motor, el chasis, los datos de la carátula de la
 *                     póliza…). Es el inventario que la fase 1 dejó documentado
 *                     para el dueño. Bloquear por estos dejaría los SEIS documentos
 *                     imposibles de firmar hasta que se agreguen esas columnas, o
 *                     sea, la fase 2 entera muerta.
 *
 * Por eso los estructurales NO bloquean, pero quedan congelados en el contrato
 * (`faltantes_json`), salen en la API y se le muestran al firmante ANTES de firmar:
 * el documento que ve en pantalla es exactamente el que tiene los espacios en
 * blanco, con su marca visible. Lo que no se hace es esconderlos.
 */
export function faltantesQueBloquean(faltantes: readonly FaltanteCongelado[]): FaltanteCongelado[] {
  return faltantes.filter(f => f.enBD);
}

// ── Sello de integridad de la firma de un contrato ──────────────────────────
//
// Mismo mecanismo que el de las cuentas de cobro (HMAC-SHA256 con `FIRMA_SECRET`,
// prefijo de versión en el propio valor guardado, comparación en tiempo constante)
// y distinta BASE CANÓNICA, porque lo que hay que proteger es otra cosa.
//
// No hay esquema heredado que aceptar: la tabla `contrato_firmas` nace con el
// sello, así que un valor sin prefijo `cf1:` no es «legado», es una fila escrita
// por fuera del código.

const SELLO_PREFIJO = 'cf1:';

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/**
 * Huella del TEXTO congelado del documento, en hexadecimal.
 *
 * Es el mismo digest que entra en la base canónica del sello, y se publica a
 * propósito: sirve para comprobar por fuera del sistema que un PDF impreso hace seis
 * meses corresponde al texto que sigue en la base. Publicarla no debilita nada — el
 * sello es un HMAC con secreto de servidor, y ese NUNCA sale.
 */
export function huellaDocumento(c: Pick<ContratoRow, 'texto'>): string {
  return sha256(String(c.texto || ''));
}

/**
 * Lo que cubre el sello de una firma de contrato.
 *
 * La pieza central es `texto_sha256`: el digest del TEXTO ÍNTEGRO del documento tal
 * como se firmó. Cambiar una coma de una cláusula en la base cambia el digest y el
 * sello deja de verificar. Se guarda el digest y no el texto entero para que la
 * base canónica quede corta y estable; criptográficamente es equivalente, porque el
 * digest va DENTRO del HMAC.
 *
 * Lo demás ata la firma a ESTE documento, a ESTE bloque y a ESTE acto de firma:
 *   · `contrato_id`, `reserva_id`, `tipo`, `numero`, `version` → la firma no es
 *     trasplantable a otro contrato ni a otra reemisión moviendo filas en la BD;
 *   · `datos_sha256` → el snapshot congelado del que salió el texto;
 *   · `bloque`, `rol`, `etiqueta`, `usuario_esperado_id`, `nombre_esperado`,
 *     `documento_esperado` → quién tenía que firmar ese bloque;
 *   · `firmada_por_id`, `firma_nombre_confirmado`, `firma_metodo`, `firmada_en` y
 *     el digest del trazo → el acto concreto. Incluir la fecha impide retrodatar
 *     una firma editando la columna.
 */
function baseCanonicaFirma(c: ContratoRow, f: FirmaContratoRow): string {
  return JSON.stringify({
    v: 1,
    doc: 'contrato-firma',
    contrato_id: Number(c.id) || 0,
    reserva_id: Number(c.reserva_id) || 0,
    tipo: String(c.tipo || ''),
    numero: String(c.numero || ''),
    version: Number(c.version) || 1,
    texto_sha256: sha256(String(c.texto || '')),
    datos_sha256: sha256(String(c.datos_json || '')),
    bloque: String(f.bloque || ''),
    rol: String(f.rol || ''),
    etiqueta: String(f.etiqueta || ''),
    usuario_esperado_id: f.usuario_esperado_id === null ? null : Number(f.usuario_esperado_id),
    nombre_esperado: String(f.nombre_esperado || ''),
    documento_esperado: String(f.documento_esperado || ''),
    firmada_en: String(f.firmada_en || ''),
    firmada_por_id: f.firmada_por_id === null ? null : Number(f.firmada_por_id),
    firma_nombre_confirmado: String(f.firma_nombre_confirmado || ''),
    firma_metodo: String(f.firma_metodo || ''),
    firma_imagen_sha256: sha256(String(f.firma_imagen || '')),
  });
}

export function calcularSelloFirma(c: ContratoRow, f: FirmaContratoRow): string {
  return SELLO_PREFIJO + sellarHmac(baseCanonicaFirma(c, f));
}

export type VerificacionSello = { ok: boolean; motivo: string };

/**
 * Verifica el sello de una firma ya recogida. Se usa al leer el contrato (para que
 * la manipulación se vea en pantalla y no solo en un log) y al firmar el siguiente
 * bloque: si el texto ya fue alterado, no se le añaden más firmas encima.
 */
export function verificarSelloFirma(c: ContratoRow, f: FirmaContratoRow): VerificacionSello {
  const guardado = String(f.firma_hash || '').trim();
  if (!guardado) return { ok: false, motivo: 'la firma no tiene sello de integridad' };
  if (!guardado.startsWith(SELLO_PREFIJO)) {
    return { ok: false, motivo: 'el sello de integridad usa un esquema desconocido' };
  }
  let esperado: string;
  try {
    esperado = calcularSelloFirma(c, f);
  } catch {
    // Falta FIRMA_SECRET en producción. No se puede afirmar que el documento esté
    // bien NI que esté manipulado: se reporta el problema real (configuración del
    // servidor) en vez de una sospecha de fraude.
    return { ok: false, motivo: 'no se pudo verificar el sello: falta configurar FIRMA_SECRET en el servidor' };
  }
  return igualesEnTiempoConstante(guardado, esperado)
    ? { ok: true, motivo: '' }
    : { ok: false, motivo: 'el sello no corresponde al texto ni a los datos actuales del documento firmado' };
}

// ── Utilidades ──────────────────────────────────────────────────────────────

/**
 * Marca de tiempo local con el MISMO formato que `datetime('now','localtime')` de
 * SQLite. Se calcula en JavaScript —y no en el SQL del UPDATE— porque la fecha de
 * la firma entra en el sello y para eso hay que conocerla antes de escribirla.
 */
export function ahoraLocalContrato(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
const ahoraLocal = ahoraLocalContrato;

export type ErrorOperacion = { ok: false; status: number; error: string };
const err = (status: number, error: string): ErrorOperacion => ({ ok: false, status, error });

// ── Emisión ─────────────────────────────────────────────────────────────────

export type ActorContrato = { id: number; nombre: string; correo?: string; nivel?: string };

export type GenerarOk = { ok: true; contrato: ContratoRow; firmas: FirmaContratoRow[]; faltantes: FaltanteCongelado[] };

/**
 * Emite un documento a partir de una reserva: congela su texto, congela el
 * snapshot del que salió y abre los bloques de firma que le corresponden.
 *
 * NO reemplaza nada: si ya hay un documento vigente de ese tipo para esa reserva,
 * se rechaza. Para cambiarlo hay que anularlo primero (`anularContrato`), y la
 * emisión siguiente queda como versión +1 conservando la anterior íntegra.
 */
/**
 * Tipos que son MARCO: se suscriben una vez y muchas operaciones cuelgan de ellos.
 *
 * Lo dicen las propias plantillas del abogado: `contratoAgencia` y
 * `contratoArrendamiento` nombran la placa pero NO llevan fechas ni canon, mientras
 * los dos otrosíes sí. O sea, el marco fija la relación y cada otrosí documenta una
 * operación concreta bajo aquel.
 *
 * Su alcance no es la reserva, así que se guardan con `reserva_id` en NULL:
 *   · agencia       → uno por VEHÍCULO (propietario ↔ DrivePass);
 *   · arrendamiento → uno por vehículo y CLIENTE (el marco nombra la placa, así que
 *     un cliente que alquile dos carros suscribe dos marcos).
 */
export const TIPOS_MARCO: readonly TipoDocumento[] = ['agencia', 'arrendamiento'];

export function esTipoMarco(tipo: TipoDocumento): boolean {
  return TIPOS_MARCO.includes(tipo);
}

export type OpcionesGenerar = {
  /**
   * Emitir como MARCO: sin reserva, identificado por vehículo (y cliente, en el
   * arrendamiento). La reserva que se pasa sigue siendo la fuente del snapshot —de ahí
   * salen el vehículo, el propietario y el cliente— pero no queda atada al documento.
   */
  marco?: boolean;
  /** Marcos ya suscritos a los que encadenar este documento. Ver OpcionesContrato. */
  marcos?: OpcionesContrato['marcos'];
};

export function generarContrato(
  db: DB, tipo: TipoDocumento, reservaId: number, actor: ActorContrato,
  opts: OpcionesGenerar = {},
): GenerarOk | ErrorOperacion {
  const reserva = db.prepare(`
    SELECT r.id, r.estado, r.usuario_id, r.vehiculo_id, v.propietario_id
    FROM reservas r JOIN vehiculos v ON v.id = r.vehiculo_id
    WHERE r.id = ?
  `).get(reservaId) as { id: number; estado: string; usuario_id: number; vehiculo_id: number; propietario_id: number } | undefined;
  if (!reserva) return err(404, 'La reserva no existe.');
  if (!ESTADOS_RESERVA_CONTRATABLES.includes(reserva.estado)) {
    return err(409, 'Solo se pueden emitir documentos de reservas confirmadas, en curso o completadas.');
  }

  // Un MARCO no pertenece a la reserva: se identifica por vehículo (y por cliente, en
  // el arrendamiento). La reserva solo aporta el snapshot del que sale el texto.
  const comoMarco = !!opts.marco;
  if (comoMarco && !esTipoMarco(tipo)) {
    return err(409, 'Este tipo de documento no es un contrato marco.');
  }
  const ambito = comoMarco
    ? { where: `reserva_id IS NULL AND vehiculo_id = ? AND ${tipo === 'arrendamiento' ? 'cliente_id = ?' : 'propietario_id = ?'}`,
        params: [reserva.vehiculo_id, tipo === 'arrendamiento' ? reserva.usuario_id : reserva.propietario_id] }
    : { where: 'reserva_id = ?', params: [reservaId] };

  const vigente = db.prepare(
    `SELECT id, numero FROM contratos WHERE ${ambito.where} AND tipo = ? AND estado <> 'anulado' ORDER BY version DESC LIMIT 1`
  ).get(...ambito.params, tipo) as { id: number; numero: string } | undefined;
  if (vigente) {
    return err(409, comoMarco
      ? `Ya existe un contrato marco vigente de este tipo (${vigente.numero}). Anúlalo antes de emitir otro.`
      : `Ya existe un documento vigente de este tipo para la reserva (${vigente.numero}). Anúlalo antes de emitir otro.`);
  }

  const datos = armarDatosContrato(db, reservaId, { marcos: opts.marcos });
  // Solo devuelve null si la reserva no existe, y eso ya se comprobó arriba.
  if (!datos) return err(404, 'La reserva no existe.');
  const doc = generarDocumento(tipo, datos);
  const faltantes = faltantesCongelados(doc.faltantes);
  const previa = db.prepare(`SELECT MAX(version) AS v FROM contratos WHERE ${ambito.where} AND tipo = ?`)
    .get(...ambito.params, tipo) as { v: number | null };
  const version = (Number(previa?.v) || 0) + 1;

  const bloques = bloquesDe(tipo, doc.datos.operacion.conductores.map(c => c.nombre));

  const crear = db.transaction(() => {
    const res = db.prepare(`
      INSERT INTO contratos (
        reserva_id, vehiculo_id, propietario_id, cliente_id, tipo, numero, version, estado,
        texto, datos_json, faltantes_json, generado_por, generado_por_nombre
      ) VALUES (?, ?, ?, ?, ?, '', ?, 'pendiente', ?, ?, ?, ?, ?)
    `).run(
      // Un marco NO pertenece a la reserva: se identifica por vehículo (y por cliente,
      // en el arrendamiento). La reserva solo aportó el snapshot del que salió el texto.
      comoMarco ? null : reservaId,
      reserva.vehiculo_id, reserva.propietario_id, reserva.usuario_id, tipo, version,
      doc.texto, JSON.stringify(doc.datos), JSON.stringify(faltantes),
      actor.id, actor.nombre || '',
    );
    const id = Number(res.lastInsertRowid);
    // La raíz de la familia: en la versión 1 es esta misma fila; en una reemisión, la
    // del original anulado.
    const raiz = db.prepare(`SELECT id FROM contratos WHERE ${ambito.where} AND tipo = ? ORDER BY version ASC LIMIT 1`)
      .get(...ambito.params, tipo) as { id: number };
    const numero = numeroContrato(tipo, Number(raiz?.id) || id, version);
    db.prepare('UPDATE contratos SET numero = ? WHERE id = ?').run(numero, id);

    const insFirma = db.prepare(`
      INSERT INTO contrato_firmas (
        contrato_id, bloque, etiqueta, rol, momento, orden,
        usuario_esperado_id, nombre_esperado, documento_esperado
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const b of bloques) {
      const quien = firmanteEsperado(doc.datos, b);
      insFirma.run(id, b.clave, b.etiqueta, b.rol, b.momento, b.orden, quien.usuarioId, quien.nombre, quien.documento);
    }
    // Bitácora ESTRICTA (dentro de la transacción): un documento contractual que se
    // emite sin dejar rastro es peor que no emitirlo. Si el INSERT de auditoría falla,
    // se revierte la emisión entera.
    registrarAuditoriaEstricta(db, { id: actor.id, nombre: actor.nombre, correo: actor.correo, nivel: actor.nivel }, {
      area: 'contratos', accion: 'emitir_contrato', entidad: 'contrato', entidad_id: id,
      detalle: `Emitió ${TITULOS_DOCUMENTO[tipo]} ${numero} `
        + (comoMarco ? `como MARCO del vehículo #${reserva.vehiculo_id}` : `de la reserva #${reservaId}`)
        + (faltantes.length ? ` · ${faltantes.length} campo(s) en blanco` : ''),
    });
    return id;
  })();

  const contrato = leerContrato(db, crear)!;
  return { ok: true, contrato, firmas: leerFirmas(db, crear), faltantes };
}

/**
 * Quién tiene que poner el trazo de este bloque, según el snapshot congelado.
 *
 * Se exporta porque al editar los DATOS de un contrato todavía sin firmar hay que
 * volver a abrir sus bloques con el nombre y el documento actualizados (si al cliente
 * le acaban de escribir la cédula, el bloque tiene que esperar ESA cédula). Ver
 * lib/contratos-edicion.ts → `resincronizarBloques`.
 */
export function firmanteEsperado(d: DatosContrato, b: DefBloqueFirma): { usuarioId: number | null; nombre: string; documento: string } {
  switch (b.rol) {
    case 'agente':
      // Cualquier administrador con `contratos_firmar_agente` puede suscribir por
      // DrivePass, así que no hay un id de usuario esperado: lo que se espera es el
      // representante legal que nombra el documento.
      return { usuarioId: null, nombre: d.agente.representante, documento: d.agente.representanteCedula };
    case 'cliente':
      return { usuarioId: d.origen.clienteId, nombre: d.cliente.nombre, documento: d.cliente.documento };
    case 'propietario':
      return { usuarioId: d.origen.propietarioId, nombre: d.propietario.nombre, documento: d.propietario.documento };
    case 'codeudor': {
      const i = Number(b.clave.split('-').pop()) - 1;
      const c = d.operacion.conductores[i];
      return { usuarioId: null, nombre: c?.nombre || '', documento: c?.documento || '' };
    }
  }
}

// ── Lectura ─────────────────────────────────────────────────────────────────

export function leerContrato(db: DB, id: number): ContratoRow | null {
  return (db.prepare('SELECT * FROM contratos WHERE id = ?').get(id) as ContratoRow | undefined) ?? null;
}

export function leerFirmas(db: DB, contratoId: number): FirmaContratoRow[] {
  return db.prepare('SELECT * FROM contrato_firmas WHERE contrato_id = ? ORDER BY orden, id')
    .all(contratoId) as FirmaContratoRow[];
}

/**
 * Documentos de una reserva, el vigente y los anulados, más recientes primero.
 *
 * Incluye también los dos contratos MARCO que rigen esa operación —la agencia del
 * vehículo y el arrendamiento de ese vehículo con ese cliente—, aunque no cuelguen de
 * la reserva. Sin ellos la ficha mostraría los otrosíes pero no los contratos que
 * modifican, que es justo lo que alguien busca cuando abre la lista: ver TODO lo que
 * ampara este alquiler. Se filtran por vehículo y por las partes de ESTA reserva, así
 * que no aparece el marco de otro cliente.
 */
export function listarContratosDeReserva(db: DB, reservaId: number): ContratoRow[] {
  return db.prepare(`
    SELECT c.* FROM contratos c
    WHERE c.reserva_id = ?
       OR (
         c.reserva_id IS NULL
         AND c.tipo IN ('agencia', 'arrendamiento')
         AND EXISTS (
           SELECT 1 FROM reservas r JOIN vehiculos v ON v.id = r.vehiculo_id
           WHERE r.id = ?
             AND c.vehiculo_id = r.vehiculo_id
             AND (c.tipo = 'agencia' OR c.cliente_id = r.usuario_id)
             AND (c.tipo = 'arrendamiento' OR c.propietario_id = v.propietario_id)
         )
       )
    ORDER BY c.id DESC
  `).all(reservaId, reservaId) as ContratoRow[];
}

export function tituloDocumento(tipo: TipoDocumento | string): string {
  // Los contratos de VINCULACIÓN viven en la misma tabla pero no son de operación, así
  // que su título no está en TITULOS_DOCUMENTO. Se resuelven aquí para que las rutas y
  // pantallas compartidas (detalle, firma, PDF) los nombren bien sin tener que saber de
  // qué familia es cada documento. Ver lib/contratos-vinculacion-texto.ts.
  const vinculacion = (TITULOS_VINCULACION as Record<string, string>)[tipo];
  if (vinculacion) return vinculacion;
  return (TITULOS_DOCUMENTO as Record<string, string>)[tipo] || String(tipo);
}

// ── Firma de un bloque ──────────────────────────────────────────────────────

export type QuienFirma = {
  usuarioId: number;
  nombre: string;
  correo?: string;
  /** Rol de la cuenta (`usuarios.rol`), no el papel en el contrato. */
  rolCuenta: 'admin' | 'propietario' | 'usuario';
  /** ¿Tiene el permiso administrativo para suscribir como EL AGENTE? */
  puedeFirmarComoAgente: boolean;
};

export type FirmarOpciones = {
  bloque: string;
  nombreConfirmado: string;
  firmaImagen: string;
  metodo: MetodoFirma;
  /** Casilla de aceptación explícita: sin ella no hay firma. */
  acepta: boolean;
  /** Versión del documento que el firmante tenía en pantalla. */
  version: number;
  /**
   * Revisión de DATOS que el firmante tenía en pantalla (`contratos.datos_revision`).
   *
   * La `version` solo cambia al anular y reemitir, así que no detecta lo que sí puede
   * pasar mientras alguien lee: que el equipo complete el número de chasis o corrija el
   * canon y el texto se vuelva a generar. Este contador sí.
   *
   * Es OPCIONAL por compatibilidad con una pestaña abierta desde antes de que existiera:
   * cuando no llega, no se comprueba. Omitirlo no le sirve a nadie para colar nada —el
   * sello cubre igual el texto que efectivamente se firma— y quien se arriesga a firmar
   * un texto que no leyó es quien lo omite.
   */
  revision?: number;
  ip: string;
  userAgent: string;
};

export type FirmarOk = {
  ok: true;
  contrato: ContratoRow;
  firma: FirmaContratoRow;
  /** ¿Con esta firma quedó completo el documento? */
  completo: boolean;
};

/**
 * Recoge el trazo de UN bloque.
 *
 * Controles, en este orden (el orden importa: nunca se filtra información de un
 * documento a quien no debería poder ni verlo):
 *   1. el documento existe y no está anulado;
 *   2. el bloque existe en ese documento;
 *   3. QUIEN pide firmar es quien corresponde a ese bloque;
 *   4. el bloque no está firmado ya;
 *   5. el documento no cambió de versión mientras lo revisaba;
 *   6. no quedan huecos subsanables en el texto;
 *   7. las firmas que ya tenga el documento siguen verificando su sello;
 *   8. hay aceptación explícita, nombre confirmado y un PNG de firma válido.
 */
export function firmarBloqueContrato(
  db: DB, contratoId: number, quien: QuienFirma, opts: FirmarOpciones,
): FirmarOk | ErrorOperacion {
  const contrato = leerContrato(db, contratoId);
  if (!contrato) return err(404, 'El documento no existe.');
  if (contrato.estado === 'anulado') return err(409, 'Este documento está anulado y no se puede firmar.');
  // Un contrato no puede quedar firmado por las dos vías. Este es el rechazo AMABLE —
  // el que de verdad cierra la puerta es el UPDATE condicionado de más abajo, que es
  // atómico frente a dos peticiones simultáneas.
  if (contrato.via_firma === 'papel') {
    return err(409, 'Este documento se firmó en papel en el mostrador: ya tiene su escaneado registrado y no admite firma electrónica.');
  }

  const bloque = (opts.bloque || '').trim();
  const firma = db.prepare('SELECT * FROM contrato_firmas WHERE contrato_id = ? AND bloque = ?')
    .get(contratoId, bloque) as FirmaContratoRow | undefined;
  if (!firma) return err(404, 'Ese bloque de firma no existe en el documento.');

  const permiso = puedeFirmarBloque(firma, quien);
  if (!permiso.ok) return err(permiso.status, permiso.error);

  if (firma.firmada_en) return err(409, 'Este bloque ya fue firmado.');

  if (Number(opts.version) !== Number(contrato.version)) {
    return err(409, 'Este documento cambió mientras lo revisabas. Recárgalo y vuelve a leerlo antes de firmar.');
  }

  // Los DATOS se pueden completar mientras el documento esté sin firmar, y al hacerlo el
  // texto se vuelve a generar. Si eso pasó después de que el firmante cargó la pantalla,
  // lo que tiene delante ya no es lo que está en la base: hay que releerlo.
  if (opts.revision !== undefined && Number(opts.revision) !== Number(contrato.datos_revision || 0)) {
    return err(409, 'Los datos de este documento se completaron mientras lo revisabas. Recárgalo y vuelve a leerlo antes de firmar.');
  }

  const bloquean = faltantesQueBloquean(parsearFaltantes(contrato.faltantes_json));
  if (bloquean.length > 0) {
    return err(409, `El documento tiene datos pendientes que sí se pueden completar (${bloquean.map(f => f.etiqueta).join(', ')}). Complétalos, anula el documento y emítelo de nuevo.`);
  }

  // La firma de la DEVOLUCIÓN del acta se recoge días después de la entrega. No se
  // puede recoger antes: firmaría el estado de un vehículo que todavía no volvió.
  if (firma.momento === 'devolucion') {
    const pendientesEntrega = db.prepare(
      "SELECT COUNT(*) AS n FROM contrato_firmas WHERE contrato_id = ? AND momento = 'entrega' AND firmada_en = ''"
    ).get(contratoId) as { n: number };
    if ((Number(pendientesEntrega?.n) || 0) > 0) {
      return err(409, 'Primero hay que completar las firmas de la entrega.');
    }
  }

  // Si alguna firma previa ya no verifica, el texto se tocó después de firmarse: no
  // se apilan firmas nuevas sobre un documento manipulado.
  for (const previa of leerFirmas(db, contratoId)) {
    if (!previa.firmada_en) continue;
    const v = verificarSelloFirma(contrato, previa);
    if (!v.ok) return err(409, 'El documento no supera la verificación de integridad de sus firmas anteriores. No se pueden añadir más firmas.');
  }

  if (opts.acepta !== true) return err(400, 'Debes aceptar expresamente el contenido del documento para firmarlo.');

  const nombreConfirmado = (opts.nombreConfirmado || '').trim();
  if (!nombreConfirmado) return err(400, 'Debes escribir tu nombre completo para confirmar la firma.');
  if (nombreConfirmado.length > 120) return err(400, 'El nombre confirmado es demasiado largo.');

  const imagen = validarFirmaPng(opts.firmaImagen);
  if (!imagen.ok) return err(400, imagen.error);

  const firmadaEn = ahoraLocal();
  const candidata: FirmaContratoRow = {
    ...firma,
    firmada_en: firmadaEn,
    firmada_por_id: quien.usuarioId,
    firma_nombre_confirmado: nombreConfirmado,
    firma_imagen: opts.firmaImagen.trim(),
    firma_metodo: opts.metodo,
  };
  let sello: string;
  try {
    sello = calcularSelloFirma(contrato, candidata);
  } catch {
    // Solo pasa en producción sin `FIRMA_SECRET`: se prefiere no firmar a firmar sin sello.
    return err(500, 'No se puede firmar: falta configurar el secreto de firma en el servidor.');
  }

  const aplicar = db.transaction(() => {
    // ── Exclusión de vías, cerrada en la BD ──
    // Fija la vía en 'digital' con un UPDATE condicionado a que NO sea ya 'papel'. Si
    // el mostrador registró el escaneado mientras esta petición estaba en curso, aquí
    // no se actualiza ninguna fila y la transacción entera se revierte. Cuando ya era
    // 'digital' (segunda, tercera… firma del documento) la fila se cuenta igual como
    // modificada, así que la condición no estorba al camino normal.
    const via = db.prepare("UPDATE contratos SET via_firma = 'digital' WHERE id = ? AND via_firma IN ('', 'digital')")
      .run(contratoId);
    if (via.changes !== 1) return 'papel' as const;

    // La condición `firma_imagen = ''` es la garantía a nivel de BD de que dos
    // peticiones simultáneas no firman el mismo bloque dos veces: la segunda no
    // actualiza ninguna fila.
    const upd = db.prepare(`
      UPDATE contrato_firmas SET
        firmada_en = ?, firmada_por_id = ?, firma_nombre_confirmado = ?, firma_imagen = ?,
        firma_metodo = ?, firma_ip = ?, firma_user_agent = ?, firma_hash = ?
      WHERE id = ? AND firmada_en = ''
    `).run(
      firmadaEn, quien.usuarioId, nombreConfirmado, candidata.firma_imagen,
      opts.metodo, opts.ip || '', (opts.userAgent || '').slice(0, 300), sello, firma.id,
    );
    if (upd.changes !== 1) return 'repetida' as const;

    const faltan = db.prepare("SELECT COUNT(*) AS n FROM contrato_firmas WHERE contrato_id = ? AND firmada_en = ''")
      .get(contratoId) as { n: number };
    const completo = (Number(faltan?.n) || 0) === 0;
    if (completo) {
      db.prepare("UPDATE contratos SET estado = 'firmado', firmado_en = ? WHERE id = ?").run(firmadaEn, contratoId);
    }

    // Bitácora ESTRICTA, dentro de la misma transacción: o queda el rastro de quién
    // firmó, con qué IP y por qué vía, o no hay firma. Mismo criterio que los
    // movimientos de plata de contabilidad (ver lib/permisos.ts).
    registrarAuditoriaEstricta(db, { id: quien.usuarioId, nombre: quien.nombre, correo: quien.correo, nivel: quien.rolCuenta }, {
      area: 'contratos', accion: 'firmar_contrato', entidad: 'contrato', entidad_id: contratoId,
      detalle: `Firmó el bloque «${firma.etiqueta}» de ${contrato.numero} (${TITULOS_DOCUMENTO[contrato.tipo]})`
        + ` · vía ${opts.metodo === 'carga' ? 'imagen cargada' : 'trazo en pantalla'} · IP ${opts.ip || 'desconocida'}`
        + (completo ? ' · documento COMPLETO' : ''),
    });
    return 'ok' as const;
  })();

  if (aplicar === 'papel') {
    return err(409, 'Este documento acaba de quedar firmado en papel en el mostrador. Un contrato no puede firmarse por las dos vías.');
  }
  if (aplicar === 'repetida') return err(409, 'Este bloque ya fue firmado.');

  const actualizado = leerContrato(db, contratoId)!;
  return {
    ok: true,
    contrato: actualizado,
    firma: db.prepare('SELECT * FROM contrato_firmas WHERE id = ?').get(firma.id) as FirmaContratoRow,
    completo: actualizado.estado === 'firmado',
  };
}

/**
 * ¿Esta cuenta puede poner ESTE trazo?
 *
 * Se responde 403 —y no 404— a propósito cuando el bloque existe pero es de otro:
 * a esta altura quien pregunta ya puede VER el documento (lo comprueba la ruta
 * antes de llamar aquí), así que no hay nada que ocultarle.
 */
export function puedeFirmarBloque(f: FirmaContratoRow, quien: QuienFirma): { ok: true } | { ok: false; status: number; error: string } {
  switch (f.rol) {
    case 'agente':
      if (quien.rolCuenta !== 'admin' || !quien.puedeFirmarComoAgente) {
        return { ok: false, status: 403, error: 'Solo un administrador autorizado puede suscribir en nombre de DrivePass.' };
      }
      return { ok: true };
    case 'cliente':
    case 'propietario':
      if (f.usuario_esperado_id === null || Number(f.usuario_esperado_id) !== Number(quien.usuarioId)) {
        return { ok: false, status: 403, error: 'Esta firma solo la puede poner la persona a cuyo nombre está el bloque.' };
      }
      return { ok: true };
    case 'codeudor':
      // La plataforma todavía no registra codeudores (no hay cuenta a la que atarlos),
      // así que hoy este caso no se produce: ver lib/contratos-bloques.ts.
      return { ok: false, status: 409, error: 'Todavía no se pueden recoger firmas de codeudores solidarios.' };
    default:
      return { ok: false, status: 403, error: 'Bloque de firma no reconocido.' };
  }
}

// ── Anulación ───────────────────────────────────────────────────────────────

export const MOTIVO_ANULACION_MIN = 5;
export const MOTIVO_ANULACION_MAX = 500;

export type AnularOk = { ok: true; contrato: ContratoRow };

/**
 * Deja un documento sin efecto conservándolo íntegro: su texto, su snapshot y las
 * firmas que hubiera recogido siguen en la base. Es el ÚNICO camino para cambiar un
 * documento ya emitido —no hay edición ni regeneración en sitio— y el mismo criterio
 * que usan las cuentas de cobro anuladas de contabilidad.
 */
export function anularContrato(
  db: DB, contratoId: number, actor: ActorContrato, motivo: string,
): AnularOk | ErrorOperacion {
  const contrato = leerContrato(db, contratoId);
  if (!contrato) return err(404, 'El documento no existe.');
  if (contrato.estado === 'anulado') return err(409, 'Este documento ya está anulado.');

  const m = (motivo || '').trim();
  if (m.length < MOTIVO_ANULACION_MIN) return err(400, 'Escribe el motivo de la anulación.');
  if (m.length > MOTIVO_ANULACION_MAX) return err(400, 'El motivo de la anulación es demasiado largo.');

  const aplicado = db.transaction(() => {
    const upd = db.prepare(`
      UPDATE contratos SET estado = 'anulado', anulado_en = ?, anulado_por = ?, anulado_por_nombre = ?, motivo_anulacion = ?
      WHERE id = ? AND estado <> 'anulado'
    `).run(ahoraLocal(), actor.id, actor.nombre || '', m, contratoId);
    if (upd.changes !== 1) return false;
    registrarAuditoriaEstricta(db, { id: actor.id, nombre: actor.nombre, correo: actor.correo, nivel: actor.nivel }, {
      area: 'contratos', accion: 'anular_contrato', entidad: 'contrato', entidad_id: contratoId,
      detalle: `Anuló ${contrato.numero} (${TITULOS_DOCUMENTO[contrato.tipo]}, estado «${contrato.estado}») · motivo: ${m}`,
    });
    return true;
  })();
  if (!aplicado) return err(409, 'Este documento ya está anulado.');

  return { ok: true, contrato: leerContrato(db, contratoId)! };
}

// ── Varios bloques con una sola confirmación ────────────────────────────────

export type FirmarVariosOk = {
  ok: true;
  firmados: string[];
  completo: boolean;
  contrato: ContratoRow;
};

/**
 * Recoge VARIOS bloques del mismo documento en un solo acto de la persona.
 *
 * Existe por el pagaré, que pide dos trazos al mismo cliente: el del pagaré y el de la
 * carta de instrucciones. Son dos bloques distintos porque son dos declaraciones
 * distintas —y cada uno conserva su propio sello—, pero pedirle a alguien que repita el
 * mismo gesto dos veces seguidas no añade ninguna garantía: lo que lo hace consciente
 * es haber leído y aceptado, y eso ocurre una vez.
 *
 * Cada bloque pasa por `firmarBloqueContrato` ENTERA, con sus trece comprobaciones y su
 * propia entrada en la bitácora. No se relaja nada: lo único que se comparte es el
 * gesto en pantalla.
 *
 * Si uno falla, los anteriores quedan firmados y se devuelve el error con la lista de
 * los que sí entraron. Es recuperable: son bloques del mismo documento y de la misma
 * persona, así que la pantalla vuelve a ofrecer los que falten.
 */
export function firmarBloquesDeUnaVez(
  db: DB, contratoId: number, quien: QuienFirma, bloques: readonly string[],
  opts: Omit<FirmarOpciones, 'bloque'>,
): FirmarVariosOk | (ErrorOperacion & { firmados: string[] }) {
  const firmados: string[] = [];
  let ultimo: FirmarOk | null = null;

  for (const bloque of bloques) {
    const r = firmarBloqueContrato(db, contratoId, quien, { ...opts, bloque });
    if (!r.ok) return { ...r, firmados };
    firmados.push(bloque);
    ultimo = r;
  }

  if (!ultimo) return { ok: false, status: 400, error: 'No se indicó ningún bloque que firmar.', firmados };
  return { ok: true, firmados, completo: ultimo.completo, contrato: ultimo.contrato };
}
