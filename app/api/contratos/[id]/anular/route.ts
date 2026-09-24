// Anula un contrato digital.
//
// Es el ÚNICO camino para cambiar un documento ya emitido: no hay edición ni
// regeneración en sitio. La fila NO se borra —conserva su texto, su snapshot y las
// firmas que hubiera recogido— y la reemisión siguiente queda como versión +1. Mismo
// criterio que las cuentas de cobro anuladas de contabilidad.
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { bloqueadoPorCsrf } from '@/lib/csrf';
import { accesoContrato } from '@/lib/contratos-acceso';
import { anularContrato, leerContrato, MOTIVO_ANULACION_MAX } from '@/lib/contratos-firma';
import { nivelDe } from '@/lib/permisos';

export const dynamic = 'force-dynamic';

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

  const body = await req.json().catch(() => ({})) as { motivo?: unknown };
  const motivo = typeof body.motivo === 'string' ? body.motivo.trim() : '';
  if (motivo.length > MOTIVO_ANULACION_MAX) {
    return NextResponse.json({ error: 'El motivo de la anulación es demasiado largo.' }, { status: 400 });
  }

  const db = getDb();
  const contrato = leerContrato(db, contratoId);
  if (!contrato) return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 });

  const acceso = accesoContrato(db, user, contrato);
  if (!acceso.puedeVer) return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 });
  if (!acceso.puedeGestionar) {
    return NextResponse.json({ error: 'No tienes permiso para anular contratos.' }, { status: 403 });
  }

  const resultado = anularContrato(db, contratoId, {
    id: user.id, nombre: user.nombre, correo: user.correo,
    // El NIVEL, no la palabra 'admin': la bitácora tiene que distinguir si anuló
    // el principal, un socio o la secretaría. Mismo patrón que el proxy de documentos.
    nivel: user.rol === 'admin' ? (nivelDe(db, user.id) || 'admin') : user.rol,
  }, motivo);
  if (!resultado.ok) return NextResponse.json({ error: resultado.error }, { status: resultado.status });

  return NextResponse.json({
    ok: true,
    contrato: {
      id: resultado.contrato.id,
      numero: resultado.contrato.numero,
      estado: resultado.contrato.estado,
      anulado_en: resultado.contrato.anulado_en,
      motivo_anulacion: resultado.contrato.motivo_anulacion,
    },
  });
}
