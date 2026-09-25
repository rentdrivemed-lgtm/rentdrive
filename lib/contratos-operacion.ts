// ── Documentos de la operación, emitidos solos al confirmar la reserva ──────
//
// Antes los emitía una persona, uno por uno, desde el panel. Eso dejaba operaciones sin
// papeles si alguien se distraía, y hacía que el orden —que aquí importa— dependiera de
// quién pulsara qué.
//
// EL ORDEN IMPORTA. Los otrosíes no son documentos sueltos: dicen «el [fecha] las partes
// celebraron EL CONTRATO» y modifican aquel. Así que primero tiene que existir el marco,
// y solo después el otrosí que lo cita por su número y su fecha reales.
//
//   1. agencia        (marco, por VEHÍCULO)            → si el vehículo no lo tiene
//   2. arrendamiento  (marco, por vehículo y CLIENTE)  → si ese par no lo tiene
//   3. otrosi-agencia       (por reserva) → encadenado a 1
//   4. otrosi-arrendamiento (por reserva) → encadenado a 2
//
// La sociedad suscribe sus bloques en el acto con el sello institucional
// (lib/contratos-sello-agente.ts). Al propietario y al cliente les queda su firma
// pendiente, y se les avisa por su campana, no por el chat que comparten.
//
// ⚠️ Server-only.

import type Database from 'better-sqlite3';
import { registrarAuditoriaEstricta } from './permisos';
import { notificarUsuarios } from './panel';
import { sellarBloquesDelAgente } from './contratos-sello-agente';
import {
  generarContrato, leerContrato, leerFirmas, tituloDocumento,
  type ActorContrato, type ContratoRow,
} from './contratos-firma';
import type { TipoDocumento } from './contratos-datos';

type DB = Database.Database;

/**
 * Los documentos de una operación, en el orden en que deben emitirse.
 *
 * El PAGARÉ va al final y solo lo firma el cliente: no lleva bloque de la sociedad
 * (una promesa de pago es unilateral) ni se encadena a ningún marco. Sus dos bloques
 * —el pagaré y la carta de instrucciones— se recogen con UNA sola confirmación; ver
 * `firmarBloquesDeUnaVez` en lib/contratos-firma.ts.
 *
 * Los CODEUDORES no aparecen: `bloquesCodeudor([])` devuelve vacío mientras la
 * plataforma no los registre, así que el pagaré no espera firmas que nadie puede poner
 * y la operación no se traba. Si más adelante hay que añadir uno, se anula el documento
 * y se reemite con su bloque desde el panel.
 */
export const SECUENCIA_OPERACION: readonly { tipo: TipoDocumento; marco: boolean }[] = [
  { tipo: 'agencia', marco: true },
  { tipo: 'arrendamiento', marco: true },
  { tipo: 'otrosi-agencia', marco: false },
  { tipo: 'otrosi-arrendamiento', marco: false },
  { tipo: 'pagare', marco: false },
];

type Reserva = { id: number; vehiculo_id: number; usuario_id: number; propietario_id: number };

function leerReserva(db: DB, reservaId: number): Reserva | undefined {
  return db.prepare(`
    SELECT r.id, r.vehiculo_id, r.usuario_id, v.propietario_id
    FROM reservas r JOIN vehiculos v ON v.id = r.vehiculo_id WHERE r.id = ?
  `).get(reservaId) as Reserva | undefined;
}

/**
 * El contrato marco vigente de un tipo, si existe.
 *
 * `agencia` se busca por vehículo; `arrendamiento` por vehículo Y cliente, porque el
 * marco de arrendamiento nombra la placa: un cliente que alquile dos carros suscribe
 * dos marcos, no uno.
 */
export function marcoVigente(db: DB, tipo: 'agencia' | 'arrendamiento', r: Reserva): ContratoRow | null {
  const columna = tipo === 'arrendamiento' ? 'cliente_id' : 'propietario_id';
  const valor = tipo === 'arrendamiento' ? r.usuario_id : r.propietario_id;
  const fila = db.prepare(`
    SELECT id FROM contratos
    WHERE reserva_id IS NULL AND tipo = ? AND vehiculo_id = ? AND ${columna} = ? AND estado <> 'anulado'
    ORDER BY version DESC LIMIT 1
  `).get(tipo, r.vehiculo_id, valor) as { id: number } | undefined;
  return fila ? leerContrato(db, fila.id) : null;
}

/** El documento vigente de un tipo para ESTA reserva, si existe. */
function documentoDeReserva(db: DB, tipo: TipoDocumento, reservaId: number): ContratoRow | null {
  const fila = db.prepare(
    "SELECT id FROM contratos WHERE reserva_id = ? AND tipo = ? AND estado <> 'anulado' ORDER BY version DESC LIMIT 1"
  ).get(reservaId, tipo) as { id: number } | undefined;
  return fila ? leerContrato(db, fila.id) : null;
}

/**
 * La fecha que un otrosí debe citar como la de suscripción de su marco.
 *
 * Se prefiere `firmado_en` —cuando de verdad quedó suscrito— y se cae a `created_at`
 * mientras las firmas estén pendientes. Nunca «hoy», que es lo que se citaba antes y
 * hacía que el otrosí afirmara que su contrato padre se celebró el mismo día.
 */
function fechaDeSuscripcion(c: ContratoRow): string {
  return String(c.firmado_en || c.created_at || '').trim();
}

export type DocumentoEmitido = {
  tipo: TipoDocumento;
  contratoId: number;
  numero: string;
  yaExistia: boolean;
  sellado: boolean;
};

export type EmisionOperacion =
  | { ok: true; documentos: DocumentoEmitido[] }
  | { ok: false; status: number; error: string; documentos: DocumentoEmitido[] };

/**
 * Emite (o encuentra) los cuatro documentos de una operación y suscribe los bloques de
 * la sociedad. IDEMPOTENTE: lo que ya exista se reutiliza, no se duplica.
 *
 * NO es transaccional a propósito. Si el tercero falla, los dos primeros quedan
 * emitidos y válidos, y una segunda llamada continúa donde se quedó. Envolverlo todo en
 * una transacción convertiría un fallo parcial en «esta reserva no tiene ningún
 * papel», que es peor y además obliga a rehacer las firmas ya recogidas.
 */
export function emitirDocumentosDeLaOperacion(
  db: DB, reservaId: number, actor: ActorContrato,
): EmisionOperacion {
  const r = leerReserva(db, reservaId);
  if (!r) return { ok: false, status: 404, error: 'La reserva no existe.', documentos: [] };

  const emitidos: DocumentoEmitido[] = [];
  const marcos: { agencia?: { numero: string; fecha: string }; arrendamiento?: { numero: string; fecha: string } } = {};

  for (const paso of SECUENCIA_OPERACION) {
    const existente = paso.marco
      ? marcoVigente(db, paso.tipo as 'agencia' | 'arrendamiento', r)
      : documentoDeReserva(db, paso.tipo, reservaId);

    let contrato = existente;
    let yaExistia = true;

    if (!contrato) {
      const res = generarContrato(db, paso.tipo, reservaId, actor, {
        marco: paso.marco,
        // Los otrosíes se emiten CON los marcos ya localizados, de modo que su texto
        // cite el número y la fecha verdaderos y no un consecutivo calculado.
        marcos: paso.marco ? undefined : marcos,
      });
      if (!res.ok) {
        return { ok: false, status: res.status, error: `${tituloDocumento(paso.tipo)}: ${res.error}`, documentos: emitidos };
      }
      contrato = res.contrato;
      yaExistia = false;
    }

    // La sociedad suscribe su bloque en el acto. Si falla, el documento sigue siendo
    // válido y su bloque se puede sellar después desde el panel: no se aborta la
    // secuencia por eso.
    const sello = sellarBloquesDelAgente(db, contrato.id, {
      momento: 'suscripcion',
      motivo: `emisión automática al confirmar la reserva #${reservaId}`,
    });
    if (!sello.ok) {
      console.error('[operacion] Emitido sin sello de la sociedad:', contrato.numero, sello.error);
    }

    if (paso.marco) {
      marcos[paso.tipo as 'agencia' | 'arrendamiento'] = {
        numero: contrato.numero,
        fecha: fechaDeSuscripcion(contrato),
      };
    }

    emitidos.push({
      tipo: paso.tipo, contratoId: contrato.id, numero: contrato.numero,
      yaExistia, sellado: sello.ok && sello.sellados > 0,
    });
  }

  return { ok: true, documentos: emitidos };
}

// ── Qué falta por firmar ────────────────────────────────────────────────────

export type FirmaPendiente = {
  contratoId: number;
  numero: string;
  titulo: string;
  bloque: string;
  etiqueta: string;
  rol: string;
  /** Cuenta que debe poner el trazo. `null` en los bloques de la sociedad. */
  usuarioEsperadoId: number | null;
};

/**
 * Firmas de SUSCRIPCIÓN que le faltan a una operación.
 *
 * Solo el momento 'suscripcion': las del acta de entrega y devolución se recogen en la
 * entrega y en la restitución, que son después, y exigirlas aquí impediría entregar el
 * vehículo por no tener firmada su propia devolución.
 */
export function firmasPendientesDeLaOperacion(db: DB, reservaId: number): FirmaPendiente[] {
  const r = leerReserva(db, reservaId);
  if (!r) return [];

  const documentos: ContratoRow[] = [];
  for (const paso of SECUENCIA_OPERACION) {
    const c = paso.marco
      ? marcoVigente(db, paso.tipo as 'agencia' | 'arrendamiento', r)
      : documentoDeReserva(db, paso.tipo, reservaId);
    if (c) documentos.push(c);
  }

  const pendientes: FirmaPendiente[] = [];
  for (const c of documentos) {
    for (const f of leerFirmas(db, c.id)) {
      if (f.firmada_en) continue;
      if (f.momento !== 'suscripcion') continue;
      pendientes.push({
        contratoId: c.id, numero: c.numero, titulo: tituloDocumento(c.tipo),
        bloque: f.bloque, etiqueta: f.etiqueta, rol: f.rol,
        usuarioEsperadoId: f.usuario_esperado_id === null ? null : Number(f.usuario_esperado_id),
      });
    }
  }
  return pendientes;
}

/**
 * ¿Puede esta reserva pasar a «en curso» (entregarse el vehículo)?
 *
 * Entregar un carro con los papeles de la operación sin firmar es justo lo que estos
 * documentos existen para evitar. Devuelve el motivo para que el panel lo muestre y no
 * un botón que falla sin explicar por qué.
 */
export function bloqueoParaEntregar(db: DB, reservaId: number): { motivo: string; pendientes: FirmaPendiente[] } | null {
  const pendientes = firmasPendientesDeLaOperacion(db, reservaId);
  if (pendientes.length === 0) return null;

  const porDocumento = new Map<string, string[]>();
  for (const p of pendientes) {
    const lista = porDocumento.get(p.numero) ?? [];
    lista.push(p.etiqueta);
    porDocumento.set(p.numero, lista);
  }
  const detalle = [...porDocumento.entries()]
    .map(([numero, bloques]) => `${numero} (falta ${bloques.join(' y ')})`)
    .join('; ');

  return {
    motivo: `No se puede entregar el vehículo: faltan firmas de la operación — ${detalle}.`,
    pendientes,
  };
}

// ── Aviso a cada parte ──────────────────────────────────────────────────────

/**
 * Avisa a propietario y cliente de lo que cada uno tiene pendiente.
 *
 * Por la campana de CADA PERSONA (tabla `notificaciones`) y no por el chat, que en esta
 * plataforma es una conversación COMPARTIDA entre propietario y cliente: decirle ahí a
 * uno que le faltan firmas se lo cuenta también al otro.
 *
 * Un solo aviso por persona aunque le falten varios documentos, con un enlace único a
 * la pantalla que los lista en orden.
 */
export function avisarFirmasPendientes(db: DB, reservaId: number): { avisados: number[] } {
  const pendientes = firmasPendientesDeLaOperacion(db, reservaId);
  const porPersona = new Map<number, FirmaPendiente[]>();
  for (const p of pendientes) {
    if (p.usuarioEsperadoId === null) continue;   // los bloques de la sociedad no se avisan
    const lista = porPersona.get(p.usuarioEsperadoId) ?? [];
    lista.push(p);
    porPersona.set(p.usuarioEsperadoId, lista);
  }

  for (const [usuarioId, suyas] of porPersona) {
    const documentos = new Set(suyas.map(s => s.numero));
    const cuantos = documentos.size;
    notificarUsuarios(db, [usuarioId], {
      tipo: 'contratos_operacion',
      titulo: cuantos === 1 ? 'Tienes un documento pendiente de firma' : `Tienes ${cuantos} documentos pendientes de firma`,
      mensaje: `De tu reserva #${reservaId}. ${cuantos === 1 ? 'Es' : 'Son'} ${[...documentos].join(', ')}. `
        + `Puedes firmarlos desde tu celular, uno tras otro, en /firmar/${reservaId}.`,
      referencia_id: reservaId,
      referencia_tipo: 'reserva',
    });
  }

  return { avisados: [...porPersona.keys()] };
}

/**
 * Lo que se llama al confirmar una reserva: emitir, sellar y avisar.
 *
 * NUNCA lanza. Una confirmación que se revierte porque un documento no se pudo emitir
 * sería peor que una confirmación con papeles a medias: la reserva ya está cobrada y la
 * emisión se puede reintentar desde el panel. Devuelve el resultado para reportarlo.
 */
export function documentarOperacionConfirmada(
  db: DB, reservaId: number, actor: ActorContrato,
): EmisionOperacion {
  let resultado: EmisionOperacion;
  try {
    resultado = emitirDocumentosDeLaOperacion(db, reservaId, actor);
  } catch (e) {
    const error = e instanceof Error ? e.message : 'No se pudieron emitir los documentos.';
    console.error('[operacion] Emisión fallida en la reserva', reservaId, error);
    return { ok: false, status: 500, error, documentos: [] };
  }

  try {
    avisarFirmasPendientes(db, reservaId);
  } catch (e) {
    console.error('[operacion] No se pudo avisar de las firmas pendientes:', e instanceof Error ? e.message : e);
  }

  try {
    registrarAuditoriaEstricta(db, { id: actor.id, nombre: actor.nombre, correo: actor.correo, nivel: actor.nivel }, {
      area: 'contratos', accion: 'documentar_operacion', entidad: 'reserva', entidad_id: reservaId,
      detalle: resultado.ok
        ? `Documentó la operación: ${resultado.documentos.map(d => `${d.numero}${d.yaExistia ? ' (ya existía)' : ''}`).join(', ')}`
        : `Emisión incompleta: ${resultado.error}`,
    });
  } catch (e) {
    console.error('[operacion] No se pudo registrar la bitácora:', e instanceof Error ? e.message : e);
  }

  return resultado;
}
