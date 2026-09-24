// ── Sello institucional de DRIVEPASS COL S.A.S. ─────────────────────────────
//
// Suscribe automáticamente los bloques que le corresponden a EL AGENTE, sin que un
// administrador tenga que firmar documento por documento.
//
// POR QUÉ UN SELLO Y NO UNA FIRMA GUARDADA
// La alternativa evidente era guardar un PNG con el trazo del representante legal y
// estamparlo en cada documento. Se descartó: esa imagen sería un activo peligroso
// —quien la obtenga puede suscribir cualquier cosa a nombre de la sociedad— y, sobre
// todo, afirmaría algo falso, que una persona trazó su firma en ese momento.
//
// Lo que se registra es lo que de verdad ocurre: la sociedad suscribe el documento por
// regla, no por un acto individual. De ahí que:
//   · `firmada_por_id` quede en NULL — no firmó ninguna persona;
//   · `firma_imagen` quede vacía — no hay trazo que mostrar, y el sello no lo finge;
//   · `firma_metodo` sea 'sello-institucional', un valor que `esMetodoFirma` RECHAZA,
//     de modo que ninguna petición HTTP puede producirlo: solo el servidor lo escribe.
//
// La integridad no se debilita: el sello HMAC (`cf1:`) se calcula con la MISMA función
// que las firmas de personas, sobre el texto íntegro del documento. Si alguien altera
// el contrato después, el sello deja de verificar igual que cualquier otra firma.
//
// ⚠️ Server-only.

import type Database from 'better-sqlite3';
import { AGENTE } from './contratos-datos';
import { registrarAuditoriaEstricta } from './permisos';
import {
  ahoraLocalContrato, calcularSelloFirma, leerContrato, leerFirmas, tituloDocumento,
  verificarSelloFirma, type FirmaContratoRow,
} from './contratos-firma';

type DB = Database.Database;

/**
 * Valor de `contrato_firmas.firma_metodo` para los bloques suscritos por la sociedad.
 * Deliberadamente fuera de `MetodoFirma`: el guardia de la ruta de firma no lo admite.
 */
export const METODO_SELLO_INSTITUCIONAL = 'sello-institucional';

/** Cómo se identifica a la sociedad en el bloque sellado. */
export const NOMBRE_INSTITUCIONAL = AGENTE.razonSocial;

export type SelloResultado =
  | { ok: true; sellados: number; yaEstaban: number }
  | { ok: false; status: number; error: string };

function err(status: number, error: string): SelloResultado {
  return { ok: false, status, error };
}

/** Los bloques de EL AGENTE que este momento deja listos para sellar. */
function bloquesAgentePendientes(firmas: FirmaContratoRow[], momento?: string): FirmaContratoRow[] {
  return firmas.filter(f =>
    f.rol === 'agente'
    && !f.firmada_en
    && (momento === undefined || f.momento === momento)
  );
}

/**
 * Sella los bloques de EL AGENTE de un documento.
 *
 * `momento` acota a una fase concreta del acta de entrega y devolución, donde la
 * sociedad suscribe dos veces en momentos distintos: sin acotar, sellar al entregar
 * dejaría también suscrita la devolución de un vehículo que todavía no ha vuelto.
 * Los demás documentos tienen un único bloque de agente en 'suscripcion'.
 *
 * IDEMPOTENTE: si ya estaban sellados no falla, los cuenta en `yaEstaban`. El registro
 * puede reintentarse y la confirmación de una reserva también.
 *
 * NO lanza por ausencia de bloques: un documento sin bloque de agente pendiente es un
 * resultado válido (0 sellados), no un error.
 */
export function sellarBloquesDelAgente(
  db: DB,
  contratoId: number,
  opts: { momento?: string; motivo: string },
): SelloResultado {
  const contrato = leerContrato(db, contratoId);
  if (!contrato) return err(404, 'El documento no existe.');
  if (contrato.estado === 'anulado') return err(409, 'El documento está anulado.');

  // Un documento que se firmó en papel no recibe sellos digitales: las dos vías son
  // excluyentes y la de papel ya recogió la suscripción de la sociedad en el escaneado.
  if (contrato.via_firma === 'papel') {
    return err(409, 'Este documento se firmó en papel: no se le aplica el sello digital.');
  }

  const firmas = leerFirmas(db, contratoId);

  // Si alguna firma previa ya no verifica, el texto se tocó después de firmarse. No se
  // apilan sellos sobre un documento manipulado — mismo criterio que firmarBloqueContrato.
  for (const previa of firmas) {
    if (!previa.firmada_en) continue;
    if (!verificarSelloFirma(contrato, previa).ok) {
      return err(409, 'El documento no supera la verificación de integridad de sus firmas anteriores. No se le aplica el sello.');
    }
  }

  const pendientes = bloquesAgentePendientes(firmas, opts.momento);
  const yaEstaban = firmas.filter(f =>
    f.rol === 'agente' && !!f.firmada_en && (opts.momento === undefined || f.momento === opts.momento)
  ).length;

  if (pendientes.length === 0) return { ok: true, sellados: 0, yaEstaban };

  const selladaEn = ahoraLocalContrato();

  // El sello se calcula ANTES de abrir la transacción: si falta `FIRMA_SECRET` se
  // prefiere no sellar a sellar sin sello, igual que en la firma de personas.
  const conSello: { firma: FirmaContratoRow; sello: string }[] = [];
  for (const f of pendientes) {
    const candidata: FirmaContratoRow = {
      ...f,
      firmada_en: selladaEn,
      firmada_por_id: null,
      firma_nombre_confirmado: NOMBRE_INSTITUCIONAL,
      firma_imagen: '',
      firma_metodo: METODO_SELLO_INSTITUCIONAL,
    };
    try {
      conSello.push({ firma: f, sello: calcularSelloFirma(contrato, candidata) });
    } catch {
      return err(500, 'No se puede sellar: falta configurar el secreto de firma en el servidor.');
    }
  }

  const aplicado = db.transaction(() => {
    // Misma exclusión de vías que la firma de personas, cerrada en la BD: si el
    // mostrador registró el papel mientras esto corría, aquí no se actualiza ninguna
    // fila y la transacción entera se revierte.
    const via = db.prepare("UPDATE contratos SET via_firma = 'digital' WHERE id = ? AND via_firma IN ('', 'digital')")
      .run(contratoId);
    if (via.changes !== 1) return 'papel' as const;

    const upd = db.prepare(`
      UPDATE contrato_firmas SET
        firmada_en = ?, firmada_por_id = NULL, firma_nombre_confirmado = ?, firma_imagen = '',
        firma_metodo = ?, firma_ip = '', firma_user_agent = ?, firma_hash = ?
      WHERE id = ? AND firmada_en = ''
    `);
    let sellados = 0;
    for (const { firma, sello } of conSello) {
      const r = upd.run(
        selladaEn, NOMBRE_INSTITUCIONAL, METODO_SELLO_INSTITUCIONAL,
        `sello institucional · ${opts.motivo}`.slice(0, 300), sello, firma.id,
      );
      sellados += r.changes;
    }

    const faltan = db.prepare("SELECT COUNT(*) AS n FROM contrato_firmas WHERE contrato_id = ? AND firmada_en = ''")
      .get(contratoId) as { n: number };
    const completo = (Number(faltan?.n) || 0) === 0;
    if (completo) {
      db.prepare("UPDATE contratos SET estado = 'firmado', firmado_en = ? WHERE id = ?").run(selladaEn, contratoId);
    }

    // Bitácora estricta dentro de la transacción: o queda el rastro de que la sociedad
    // suscribió automáticamente y por qué, o no hay sello.
    registrarAuditoriaEstricta(
      db,
      { id: null, nombre: NOMBRE_INSTITUCIONAL, nivel: 'sistema' },
      {
        area: 'contratos', accion: 'sellar_agente_automatico', entidad: 'contrato', entidad_id: contratoId,
        detalle: `Suscribió automáticamente ${sellados} bloque(s) de EL AGENTE en ${contrato.numero}`
          + ` (${tituloDocumento(contrato.tipo)}) con el sello institucional de ${NOMBRE_INSTITUCIONAL}`
          + ` · motivo: ${opts.motivo}`
          + (completo ? ' · documento COMPLETO' : ''),
      },
    );
    return sellados;
  })();

  if (aplicado === 'papel') {
    return err(409, 'Este documento acaba de quedar firmado en papel. Un contrato no puede suscribirse por las dos vías.');
  }
  return { ok: true, sellados: aplicado, yaEstaban };
}

/** ¿Este bloque lo suscribió la sociedad automáticamente? Para pintarlo distinto. */
export function esSelloInstitucional(f: Pick<FirmaContratoRow, 'firma_metodo'>): boolean {
  return String(f.firma_metodo || '') === METODO_SELLO_INSTITUCIONAL;
}
