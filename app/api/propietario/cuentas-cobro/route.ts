// Cuentas de cobro (remisiones) del propietario autenticado: listarlas y firmarlas.
// La firma es un requisito PREVIO al pago — ver lib/contabilidad.ts → firmarCuentaCobro
// y app/api/contabilidad/liquidaciones/route.ts (el PUT que marca como pagado la rechaza
// si la remisión de esa reserva no está firmada).
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { firmarCuentaCobro, datosEmpresa, type RemisionRow } from '@/lib/contabilidad';
import { registrarAuditoria } from '@/lib/permisos';
import { ipCliente } from '@/lib/limite-tasa';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  if (user.rol !== 'propietario') return NextResponse.json({ error: 'Solo propietarios pueden ver sus cuentas de cobro.' }, { status: 403 });

  const db = getDb();
  // Solo las del propietario autenticado — nunca las de otro (filtro por propietario_id, no admin).
  // Se cruza con `liquidaciones` para saber si el pago sigue pendiente: una remisión vieja
  // (de antes de existir este requisito) cuya liquidación YA se pagó no debe aparecer como
  // "pendiente de firma" — sería confuso pedirle al propietario que autorice un pago que ya
  // se hizo. Esas quedan fuera de ambas listas (no son accionables ni una firma real).
  const remisiones = db.prepare(`
    SELECT rem.*, COALESCE(l.estado, 'pendiente') AS liquidacion_estado
    FROM remisiones rem
    LEFT JOIN liquidaciones l ON l.reserva_id = rem.reserva_id
    WHERE rem.propietario_id = ?
    ORDER BY rem.created_at DESC
  `).all(user.id) as Array<RemisionRow & { liquidacion_estado: string }>;

  const pendientes = remisiones.filter(r => !r.firmada_en && r.liquidacion_estado === 'pendiente');
  const firmadas = remisiones.filter(r => !!r.firmada_en);

  // Datos de la empresa (nombre/NIT) para armar el PDF en el cliente — no es sensible
  // (ya sale impreso en todas las facturas/remisiones) y evita exponer /api/config
  // (solo-admin) a cuentas de propietario.
  return NextResponse.json({ pendientes, firmadas, empresa: datosEmpresa(db) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  if (user.rol !== 'propietario') return NextResponse.json({ error: 'Solo propietarios pueden firmar cuentas de cobro.' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { remision_id?: number; firma_imagen?: string; nombre_confirmado?: string };
  const remisionId = Number(body.remision_id);
  if (!remisionId) return NextResponse.json({ error: 'Falta remision_id' }, { status: 400 });
  const nombreConfirmado = (body.nombre_confirmado || '').trim();
  if (!nombreConfirmado) return NextResponse.json({ error: 'Debes escribir tu nombre completo para confirmar la firma.' }, { status: 400 });

  const db = getDb();
  const resultado = firmarCuentaCobro(db, remisionId, user.id, {
    firmaImagen: body.firma_imagen || '',
    nombreConfirmado,
    ip: ipCliente(req),
    userAgent: req.headers.get('user-agent') || '',
  });

  if (!resultado.ok) return NextResponse.json({ error: resultado.error }, { status: resultado.status });

  // Bitácora: aunque no es una acción de admin, reutilizamos el mismo mecanismo de
  // auditoría (la tabla/columna `usuario_nivel` es texto libre, no exige un AdminNivel) —
  // deja constancia de quién firmó, cuándo y con qué IP/monto quedó congelado.
  registrarAuditoria(db, { id: user.id, nombre: user.nombre, correo: user.correo, nivel: 'propietario' }, {
    area: 'contabilidad', accion: 'firmar_cuenta_cobro', entidad: 'remision', entidad_id: remisionId,
    detalle: `Firmó la cuenta de cobro ${resultado.remision.numero} · neto $${resultado.remision.neto.toLocaleString('es-CO')} · IP ${ipCliente(req)}`,
  });

  return NextResponse.json({ ok: true, remision: resultado.remision });
}
