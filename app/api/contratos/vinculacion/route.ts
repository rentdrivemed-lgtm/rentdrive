// Contratos de vinculación — estado y emisión.
//
//   GET  /api/contratos/vinculacion              → mi propio estado
//   GET  /api/contratos/vinculacion?usuario_id=N → el de otra cuenta (equipo)
//   POST /api/contratos/vinculacion              → emitir/habilitar el de una cuenta
//
// Ruta COMPARTIDA entre la persona y el equipo, igual que /api/contratos: la rama del
// titular mira su propia cuenta, la del equipo exige el área `contratos_vinculacion`
// (que sí incluye a secretaría — ver lib/permisos.ts).
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { adminTieneArea, sinPermisoArea } from '@/lib/guard';
import {
  estadoVinculacion, emitirYNotificarVinculacion, vinculacionQueLeToca, puedeEmitirVinculacion,
} from '@/lib/contratos-vinculacion';
import { VINCULACION_REVISADA_POR_ABOGADO } from '@/lib/contratos-vinculacion-texto';

/** Área del panel para gestionar estos documentos. Ver lib/permisos.ts. */
const AREA = 'contratos_vinculacion';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const db = getDb();
  const pedido = Number(req.nextUrl.searchParams.get('usuario_id') || 0);

  // Sin `usuario_id`, o pidiendo el propio, cualquiera consulta lo suyo. Para consultar
  // el de OTRA cuenta hace falta ser del equipo con el área.
  const esPropio = !pedido || pedido === Number(user.id);
  if (!esPropio) {
    if (user.rol !== 'admin' || !adminTieneArea(db, user.id, AREA)) return sinPermisoArea();
  }

  const objetivoId = esPropio ? Number(user.id) : pedido;
  const fila = db.prepare('SELECT id, nombre, rol FROM usuarios WHERE id = ?')
    .get(objetivoId) as { id: number; nombre: string; rol: string } | undefined;
  if (!fila) return NextResponse.json({ error: 'La cuenta no existe.' }, { status: 404 });

  return NextResponse.json({
    usuario: { id: fila.id, nombre: fila.nombre, rol: fila.rol },
    estado: estadoVinculacion(db, fila.id, fila.rol),
    // La pantalla lo usa para mostrar el aviso de borrador sobre el texto.
    borradorSinRevisar: !VINCULACION_REVISADA_POR_ABOGADO,
  });
}

/**
 * Emite (o reemite el aviso de) el contrato de vinculación de una cuenta.
 *
 * Dos usos:
 *   · el equipo lo habilita para una cuenta concreta (`usuario_id`), que es el
 *     «lo gestiono desde admin o secretaría»;
 *   · el titular lo pide para sí mismo si por lo que sea no se le emitió al
 *     registrarse (la emisión del registro no bloquea la creación de la cuenta).
 *
 * Es idempotente: si ya hay uno vigente lo devuelve en vez de emitir otro.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const db = getDb();
  const body = await req.json().catch(() => ({})) as {
    usuario_id?: unknown;
    autoriza_datos?: unknown; autoriza_datos_sensibles?: unknown; autoriza_comerciales?: unknown;
  };
  const pedido = Number(body.usuario_id || 0);
  const esPropio = !pedido || pedido === Number(user.id);

  if (!esPropio) {
    if (user.rol !== 'admin' || !adminTieneArea(db, user.id, AREA)) return sinPermisoArea();
  }

  const objetivoId = esPropio ? Number(user.id) : pedido;
  const fila = db.prepare('SELECT id, nombre, rol FROM usuarios WHERE id = ?')
    .get(objetivoId) as { id: number; nombre: string; rol: string } | undefined;
  if (!fila) return NextResponse.json({ error: 'La cuenta no existe.' }, { status: 404 });

  if (!vinculacionQueLeToca(fila.rol)) {
    return NextResponse.json({ error: 'A esta cuenta no le corresponde un contrato de vinculación.' }, { status: 409 });
  }

  // Puerta del borrador: se comprueba ANTES para poder devolver el motivo real en vez
  // de un genérico. Ver lib/contratos-vinculacion-texto.ts.
  const puerta = puedeEmitirVinculacion();
  if (!puerta.ok) return NextResponse.json({ error: puerta.error }, { status: puerta.status });

  // Los consentimientos los marca la PERSONA. Cuando esta ruta la usa el equipo para
  // una cuenta ajena (mostrador), lo que hace es DEJAR CONSTANCIA de lo que el titular
  // acaba de autorizar delante de quien lo atiende — de ahí que también acá haya que
  // mandarlos explícitamente y no se asuman. Quién los registró queda en la bitácora.
  if (body.autoriza_datos !== true || body.autoriza_datos_sensibles !== true) {
    return NextResponse.json({
      error: 'Falta la autorización de tratamiento de datos, incluidas las imágenes de los documentos de identidad.',
    }, { status: 400 });
  }

  const r = emitirYNotificarVinculacion(db, fila.id, fila.rol, {
    id: user.id, nombre: user.nombre, correo: user.correo,
  }, {
    general: true,
    datosSensibles: true,
    comunicacionesComerciales: body.autoriza_comerciales === true,
  });
  if (!r) return NextResponse.json({ error: 'No se pudo emitir el contrato.' }, { status: 500 });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  return NextResponse.json({
    ok: true,
    contrato_id: r.contratoId,
    numero: r.numero,
    ya_existia: r.yaExistia,
    estado: estadoVinculacion(db, fila.id, fila.rol),
  });
}
