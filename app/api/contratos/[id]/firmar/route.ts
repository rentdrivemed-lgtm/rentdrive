// Recoge el trazo de UN bloque de firma de un contrato digital.
//
// Quién puede firmar qué (el detalle vive en lib/contratos-firma.ts → puedeFirmarBloque):
//   · bloques de EL ARRENDATARIO / EL OTORGANTE → la cuenta del cliente de la reserva;
//   · bloques de EL EMPRESARIO                  → la cuenta del propietario del vehículo;
//   · bloques de EL AGENTE                      → un admin con el área `contratos_firmar_agente`.
//
// Un bloque firmado no se vuelve a firmar (lo garantiza también la BD, con el UPDATE
// condicionado a `firmada_en = ''`), igual que `firmarCuentaCobro` en contabilidad.
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { bloqueadoPorCsrf } from '@/lib/csrf';
import { ipCliente } from '@/lib/limite-tasa';
import { accesoContrato } from '@/lib/contratos-acceso';
import { firmarBloqueContrato, leerContrato, esMetodoFirma } from '@/lib/contratos-firma';
import { FIRMA_PNG_MAX_CHARS_TOTAL } from '@/lib/firma-imagen';

export const dynamic = 'force-dynamic';

const BLOQUE_MAX_CHARS = 40;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrf = bloqueadoPorCsrf(req);
  if (csrf) return csrf;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const { id } = await params;
  const contratoId = Number(id);
  if (!Number.isInteger(contratoId) || contratoId <= 0) {
    return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({})) as {
    bloque?: unknown; nombre_confirmado?: unknown; firma_imagen?: unknown;
    metodo?: unknown; acepta?: unknown; version?: unknown;
  };

  const bloque = typeof body.bloque === 'string' ? body.bloque.trim() : '';
  if (!bloque || bloque.length > BLOQUE_MAX_CHARS) {
    return NextResponse.json({ error: 'Falta indicar qué bloque se firma.' }, { status: 400 });
  }
  if (!esMetodoFirma(body.metodo)) {
    return NextResponse.json({ error: 'Indica cómo se firmó: trazo en pantalla o imagen cargada.' }, { status: 400 });
  }
  // La versión del documento es OBLIGATORIA: sin ella bastaría con no mandarla para
  // saltarse el chequeo de "este documento cambió mientras lo revisabas" y firmar a
  // ciegas un texto que el firmante nunca vio. Mismo criterio que la cuenta de cobro.
  const version = Number(body.version);
  if (!Number.isInteger(version) || version <= 0) {
    return NextResponse.json({ error: 'Falta la versión del documento. Recarga la página e inténtalo de nuevo.' }, { status: 400 });
  }
  const nombreConfirmado = typeof body.nombre_confirmado === 'string' ? body.nombre_confirmado.trim() : '';
  if (!nombreConfirmado) {
    return NextResponse.json({ error: 'Debes escribir tu nombre completo para confirmar la firma.' }, { status: 400 });
  }
  const firmaImagen = typeof body.firma_imagen === 'string' ? body.firma_imagen.trim() : '';
  if (!firmaImagen) return NextResponse.json({ error: 'Falta el trazo de la firma.' }, { status: 400 });
  // Rechazo barato por longitud de cadena antes de tocar la BD; la validación real
  // (bytes, cabecera PNG, dimensiones) vive en lib/firma-imagen.ts y la aplica igual
  // `firmarBloqueContrato`, que es la fuente de verdad.
  if (firmaImagen.length > FIRMA_PNG_MAX_CHARS_TOTAL) {
    return NextResponse.json({ error: 'La imagen de la firma es demasiado pesada.' }, { status: 400 });
  }

  const db = getDb();
  const contrato = leerContrato(db, contratoId);
  if (!contrato) return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 });

  const acceso = accesoContrato(db, user, contrato);
  // Primero el acceso de LECTURA: a quien no es parte ni tiene el área no se le
  // confirma siquiera que el documento exista (404, no 403).
  if (!acceso.puedeVer) return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 });

  const resultado = firmarBloqueContrato(db, contratoId, {
    usuarioId: user.id,
    nombre: user.nombre,
    correo: user.correo,
    rolCuenta: user.rol,
    puedeFirmarComoAgente: acceso.puedeFirmarComoAgente,
  }, {
    bloque,
    nombreConfirmado,
    firmaImagen,
    metodo: body.metodo,
    acepta: body.acepta === true,
    version,
    ip: ipCliente(req),
    userAgent: req.headers.get('user-agent') || '',
  });

  if (!resultado.ok) return NextResponse.json({ error: resultado.error }, { status: resultado.status });

  return NextResponse.json({
    ok: true,
    completo: resultado.completo,
    estado: resultado.contrato.estado,
    bloque: resultado.firma.bloque,
    firmada_en: resultado.firma.firmada_en,
  });
}
