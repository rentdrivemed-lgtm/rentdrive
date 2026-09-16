// El PDF de un contrato digital.
//
// GET /api/contratos/<id>/pdf            → el expediente: el texto congelado con las
//                                          imágenes de las firmas en su bloque y la
//                                          constancia de verificación del sello.
// GET /api/contratos/<id>/pdf?modo=papel → la copia del MOSTRADOR: el mismo texto con
//                                          los bloques de firma en blanco, para
//                                          imprimirla y firmarla a mano.
//
// El PDF se arma SIEMPRE desde `contratos.texto` —el texto congelado— y nunca
// regenerando la plantilla: el documento firmado es el que se firmó (ver el comentario
// de cabecera de lib/contrato-pdf.ts).
//
// ── Quién puede ──
// Ver el PDF: quien puede ver el documento (el cliente, el propietario o el equipo con
// el área `contratos`), exactamente el mismo criterio que GET /api/contratos/[id].
// La copia para firma física: además, el documento tiene que estar PENDIENTE y sin
// firmas electrónicas empezadas — imprimir «para firmar» un contrato ya firmado es
// justo el papel que no debería existir.
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { consumirIntento } from '@/lib/limite-tasa';
import { registrarAuditoria } from '@/lib/permisos';
import { getConfig } from '@/lib/operaciones';
import { accesoContrato } from '@/lib/contratos-acceso';
import {
  leerContrato, leerFirmas, parsearFaltantes, faltantesQueBloquean, tituloDocumento,
} from '@/lib/contratos-firma';
import { leerEscaneo, escaneoEsImagen } from '@/lib/contratos-papel';
import { contratoPDFBuffer, nombreArchivoContrato, type ModoContratoPdf } from '@/lib/contrato-pdf';

export const dynamic = 'force-dynamic';
// Armar el PDF es CPU (texto largo, imágenes de firma y, si lo hay, el escaneado). Mismo
// techo que las demás rutas que generan documentos.
export const maxDuration = 30;

/** Tope por cuenta. Un expediente se descarga unas cuantas veces, no cien por minuto. */
const MAX_POR_MINUTO = 10;
const VENTANA_MS = 60_000;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const { id } = await params;
  const contratoId = Number(id);
  if (!Number.isInteger(contratoId) || contratoId <= 0) {
    return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 });
  }

  const db = getDb();
  const contrato = leerContrato(db, contratoId);
  if (!contrato) return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 });

  const acceso = accesoContrato(db, user, contrato);
  // Mismo 404 que si no existiera: a quien no es parte ni tiene el área no se le
  // confirma siquiera que el documento exista.
  if (!acceso.puedeVer) return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 });

  const modo: ModoContratoPdf = req.nextUrl.searchParams.get('modo') === 'papel' ? 'papel' : 'expediente';

  if (modo === 'papel') {
    if (contrato.estado !== 'pendiente') {
      return NextResponse.json(
        { error: 'Este documento ya no está pendiente de firma: no se puede imprimir una copia para firmar.' },
        { status: 409 },
      );
    }
    if (contrato.via_firma === 'digital') {
      return NextResponse.json(
        { error: 'Este documento ya se está firmando electrónicamente. Un contrato no puede firmarse por las dos vías.' },
        { status: 409 },
      );
    }
    // El mismo bloqueo que la firma: un documento con huecos subsanables no se firma ni
    // en pantalla ni a mano, así que tampoco se imprime para firmarlo.
    const bloquean = faltantesQueBloquean(parsearFaltantes(contrato.faltantes_json));
    if (bloquean.length > 0) {
      return NextResponse.json({
        error: `El documento tiene datos pendientes que sí se pueden completar (${bloquean.map(f => f.etiqueta).join(', ')}). `
          + 'Complétalos, anula el documento y emítelo de nuevo antes de imprimirlo.',
      }, { status: 409 });
    }
  }

  const espera = consumirIntento(`contrato-pdf:${user.id}`, MAX_POR_MINUTO, VENTANA_MS);
  if (espera !== null) {
    return NextResponse.json({ error: `Demasiadas descargas seguidas. Espera ${espera} segundos.` }, { status: 429 });
  }

  // El escaneado solo se trae cuando de verdad se va a incrustar (imagen, modo
  // expediente): es la fila pesada de la base y no hay por qué cargarla para un PDF
  // que no la va a usar.
  const escaneo = modo === 'expediente' && contrato.via_firma === 'papel' && escaneoEsImagen(contrato.papel_mime)
    ? leerEscaneo(db, contratoId)
    : null;

  let pdf: ArrayBuffer;
  try {
    pdf = await contratoPDFBuffer(
      { contrato, firmas: leerFirmas(db, contratoId), escaneo },
      {
        modo,
        empresa: { nombre: getConfig(db, 'empresa_nombre') || 'DrivePass', nit: getConfig(db, 'empresa_nit') },
        generadoPara: `${user.nombre} (${user.correo})`,
      },
    );
  } catch (e) {
    console.error('[contrato-pdf] no se pudo generar el PDF:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'No pudimos generar el PDF. Intenta de nuevo.' }, { status: 500 });
  }

  // Se registra DESPUÉS de armarlo: una descarga que terminó en 500 no se llevó nada.
  // Un contrato trae la identificación completa de las dos partes: es exactamente el
  // documento que hay que poder rastrear si aparece donde no debe.
  registrarAuditoria(db, { id: user.id, nombre: user.nombre, correo: user.correo, nivel: user.rol }, {
    area: 'contratos',
    accion: modo === 'papel' ? 'descargar_contrato_para_firmar' : 'descargar_contrato_pdf',
    entidad: 'contrato',
    entidad_id: contrato.id,
    detalle: `${tituloDocumento(contrato.tipo)} ${contrato.numero} (reserva #${contrato.reserva_id})`
      + (modo === 'papel' ? ' · copia para firma física' : ''),
  });

  return new NextResponse(pdf, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      // El nombre ya viene saneado a [A-Za-z0-9._-]: no puede cerrar el valor de la
      // cabecera ni inyectar un salto de línea.
      'Content-Disposition': `attachment; filename="${nombreArchivoContrato(contrato, modo)}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
