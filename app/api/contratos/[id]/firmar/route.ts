// Recoge el trazo de uno o VARIOS bloques de firma de un contrato digital.
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
import { firmarBloquesDeUnaVez, leerContrato, esMetodoFirma } from '@/lib/contratos-firma';
import { FIRMA_PNG_MAX_CHARS_TOTAL } from '@/lib/firma-imagen';

export const dynamic = 'force-dynamic';

const BLOQUE_MAX_CHARS = 40;
// Tope defensivo: el documento con más bloques de una misma persona es el pagaré, con
// dos. Un número alto aquí solo serviría para pedir trabajo inútil al servidor.
const BLOQUES_MAX = 6;

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
    bloque?: unknown; bloques?: unknown; nombre_confirmado?: unknown; firma_imagen?: unknown;
    metodo?: unknown; acepta?: unknown; version?: unknown; revision?: unknown;
  };

  // `bloques` (varios) o `bloque` (uno). Lo de varios existe por el pagaré, que pide
  // dos trazos al mismo cliente —el del pagaré y el de la carta de instrucciones— y no
  // tiene sentido hacerle repetir el mismo gesto seguido. Cada bloque pasa igual por
  // todas las comprobaciones y conserva su propio sello; lo único que se comparte es el
  // gesto. Se mantiene `bloque` porque es lo que manda la pantalla de firma de siempre.
  const crudos = Array.isArray(body.bloques)
    ? body.bloques
    : (typeof body.bloque === 'string' ? [body.bloque] : []);
  const bloques = crudos
    .filter((b): b is string => typeof b === 'string')
    .map(b => b.trim())
    .filter(b => b.length > 0 && b.length <= BLOQUE_MAX_CHARS);

  if (bloques.length === 0) {
    return NextResponse.json({ error: 'Falta indicar qué bloque se firma.' }, { status: 400 });
  }
  if (bloques.length > BLOQUES_MAX) {
    return NextResponse.json({ error: 'Demasiados bloques en una sola firma.' }, { status: 400 });
  }
  if (new Set(bloques).size !== bloques.length) {
    return NextResponse.json({ error: 'Hay bloques repetidos en la solicitud.' }, { status: 400 });
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
  // Revisión de DATOS que el firmante tenía en pantalla. La `version` solo cambia al
  // anular y reemitir; esto detecta lo otro que puede pasar mientras alguien lee: que el
  // equipo complete un dato pendiente y el texto se vuelva a generar. Es opcional por
  // compatibilidad (ver `FirmarOpciones.revision`), pero la pantalla siempre la manda.
  const revision = body.revision === undefined ? undefined : Number(body.revision);
  if (revision !== undefined && (!Number.isInteger(revision) || revision < 0)) {
    return NextResponse.json({ error: 'La revisión del documento no es válida. Recarga la página e inténtalo de nuevo.' }, { status: 400 });
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

  const resultado = firmarBloquesDeUnaVez(db, contratoId, {
    usuarioId: user.id,
    nombre: user.nombre,
    correo: user.correo,
    rolCuenta: user.rol,
    puedeFirmarComoAgente: acceso.puedeFirmarComoAgente,
  }, bloques, {
    nombreConfirmado,
    firmaImagen,
    metodo: body.metodo,
    acepta: body.acepta === true,
    version,
    revision,
    ip: ipCliente(req),
    userAgent: req.headers.get('user-agent') || '',
  });

  if (!resultado.ok) {
    // `firmados` dice cuáles SÍ entraron antes del fallo: sin eso, la pantalla volvería
    // a ofrecer bloques ya firmados y el segundo intento daría «este bloque ya fue
    // firmado» sin que nadie entienda por qué.
    return NextResponse.json(
      { error: resultado.error, firmados: resultado.firmados },
      { status: resultado.status },
    );
  }

  return NextResponse.json({
    ok: true,
    completo: resultado.completo,
    estado: resultado.contrato.estado,
    bloques: resultado.firmados,
    // Compatibilidad con la pantalla de firma de siempre, que espera un solo bloque.
    bloque: resultado.firmados[0],
  });
}
