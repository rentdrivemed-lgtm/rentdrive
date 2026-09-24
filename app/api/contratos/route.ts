// Contratos digitales de una reserva: listarlos y emitirlos.
//
// GET  /api/contratos?reserva_id=N  → qué documentos hay, en qué estado y qué firmas
//                                     faltan. Lo consultan el equipo, el cliente y el
//                                     propietario (cada uno solo lo suyo).
// POST /api/contratos               → emite un documento congelando su texto.
//
// El texto íntegro NO viaja en el listado: se pide documento por documento en
// GET /api/contratos/[id]. Un listado de seis contratos completos son cientos de KB
// por vuelta y nadie los lee de esa forma.
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { bloqueadoPorCsrf } from '@/lib/csrf';
import { accesoReserva } from '@/lib/contratos-acceso';
import {
  generarContrato, esTipoDocumento, leerFirmas, listarContratosDeReserva, parsearFaltantes,
  tituloDocumento, faltantesQueBloquean,
} from '@/lib/contratos-firma';
import { TIPOS_DOCUMENTO, TITULOS_DOCUMENTO } from '@/lib/contratos-datos';
import { nivelDe } from '@/lib/permisos';

export const dynamic = 'force-dynamic';

/**
 * Resumen de un documento para el listado. Deja fuera el texto, el snapshot y —sobre
 * todo— `firma_hash`: el sello es un MAC interno, al usuario le sirve el veredicto de
 * integridad (que se calcula en el detalle), no el valor del MAC.
 */
function resumen(db: ReturnType<typeof getDb>, c: ReturnType<typeof listarContratosDeReserva>[number]) {
  const firmas = leerFirmas(db, c.id);
  const faltantes = parsearFaltantes(c.faltantes_json);
  return {
    id: c.id,
    reserva_id: c.reserva_id,
    tipo: c.tipo,
    titulo: tituloDocumento(c.tipo),
    numero: c.numero,
    version: c.version,
    estado: c.estado,
    // '' | 'digital' | 'papel'. El panel lo necesita para no mostrar «0 de 2 firmas» en
    // un documento que se firmó a mano y sí tiene su ejemplar registrado.
    via_firma: c.via_firma,
    papel_subido_en: c.papel_subido_en,
    created_at: c.created_at,
    firmado_en: c.firmado_en,
    anulado_en: c.anulado_en,
    motivo_anulacion: c.motivo_anulacion,
    firmas_totales: firmas.length,
    firmas_puestas: firmas.filter(f => !!f.firmada_en).length,
    faltantes_bloqueantes: faltantesQueBloquean(faltantes).length,
    faltantes_estructurales: faltantes.length - faltantesQueBloquean(faltantes).length,
  };
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const reservaId = Number(req.nextUrl.searchParams.get('reserva_id'));
  if (!Number.isInteger(reservaId) || reservaId <= 0) {
    return NextResponse.json({ error: 'Falta reserva_id' }, { status: 400 });
  }

  const db = getDb();
  const acceso = accesoReserva(db, user, reservaId);
  // Mismo 404 para "no existe" y para "no es tuya": si no se puede ver, tampoco se
  // puede averiguar cuáles reservas existen probando ids.
  if (!acceso || !acceso.puedeVer) return NextResponse.json({ error: 'Reserva no encontrada.' }, { status: 404 });

  const contratos = listarContratosDeReserva(db, reservaId).map(c => resumen(db, c));
  return NextResponse.json({
    contratos,
    // Catálogo para que el panel pueda ofrecer los que faltan sin duplicar la lista.
    tipos: TIPOS_DOCUMENTO.map(t => ({ tipo: t, titulo: TITULOS_DOCUMENTO[t] })),
    permisos: { gestionar: acceso.puedeGestionar, firmar_agente: acceso.puedeFirmarComoAgente, parte: acceso.parte },
  });
}

export async function POST(req: NextRequest) {
  // CSRF: emitir un documento contractual es al menos tan consecuente como crear una
  // reserva de mostrador, que es la otra ruta del proyecto que lo aplica. SameSite=Lax
  // no basta (cualquier subdominio es "same-site") y el chequeo de Content-Type cierra
  // el bypass clásico de JSON-CSRF vía <form enctype="text/plain">.
  const csrf = bloqueadoPorCsrf(req);
  if (csrf) return csrf;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { reserva_id?: unknown; tipo?: unknown };
  const reservaId = Number(body.reserva_id);
  if (!Number.isInteger(reservaId) || reservaId <= 0) {
    return NextResponse.json({ error: 'Falta reserva_id' }, { status: 400 });
  }
  if (!esTipoDocumento(body.tipo)) {
    return NextResponse.json({ error: 'Tipo de documento no válido.' }, { status: 400 });
  }

  const db = getDb();
  const acceso = accesoReserva(db, user, reservaId);
  if (!acceso) return NextResponse.json({ error: 'Reserva no encontrada.' }, { status: 404 });
  if (!acceso.puedeGestionar) {
    return NextResponse.json({ error: 'No tienes permiso para emitir contratos.' }, { status: 403 });
  }

  const resultado = generarContrato(db, body.tipo, reservaId, {
    id: user.id, nombre: user.nombre, correo: user.correo,
    // El NIVEL, no la palabra 'admin': la bitácora tiene que distinguir si anuló
    // el principal, un socio o la secretaría. Mismo patrón que el proxy de documentos.
    nivel: user.rol === 'admin' ? (nivelDe(db, user.id) || 'admin') : user.rol,
  });
  if (!resultado.ok) return NextResponse.json({ error: resultado.error }, { status: resultado.status });

  return NextResponse.json({
    ok: true,
    contrato: resumen(db, resultado.contrato),
    // Los huecos se devuelven de una vez: quien emite tiene que saber en el acto si el
    // documento salió con espacios en blanco y de qué tipo son.
    faltantes: resultado.faltantes,
  }, { status: 201 });
}
