import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { adminTieneArea, sinPermisoArea } from '@/lib/guard';
import { obtenerTokensAceptacion, crearTransaccion, esperarResultadoTransaccion } from '@/lib/pagos';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  if (!adminTieneArea(getDb(), user.id, 'reservas')) return sinPermisoArea();

  const { id } = await params;
  const db = getDb();
  const cargos = db.prepare('SELECT * FROM cargos_extra WHERE reserva_id = ? ORDER BY created_at DESC').all(Number(id));
  return NextResponse.json({ cargos });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') return NextResponse.json({ error: 'Solo un administrador puede registrar cargos extra' }, { status: 403 });
  if (!adminTieneArea(getDb(), user.id, 'reservas')) return sinPermisoArea();

  const { id } = await params;
  const { tipo, descripcion, monto } = await req.json();
  if (!['multa', 'dano', 'otro'].includes(tipo)) return NextResponse.json({ error: 'Tipo de cargo inválido' }, { status: 400 });
  if (!descripcion?.trim()) return NextResponse.json({ error: 'Describe el motivo del cargo' }, { status: 400 });
  if (!monto || Number(monto) <= 0) return NextResponse.json({ error: 'El monto debe ser mayor a cero' }, { status: 400 });

  const db = getDb();
  const reserva = db.prepare('SELECT usuario_id FROM reservas WHERE id = ?').get(Number(id)) as { usuario_id: number } | undefined;
  if (!reserva) return NextResponse.json({ error: 'Reserva no encontrada' }, { status: 404 });

  const cliente = db.prepare('SELECT correo FROM usuarios WHERE id = ?').get(reserva.usuario_id) as { correo: string } | undefined;
  const fuente = db.prepare('SELECT wompi_fuente_id FROM fuentes_pago WHERE usuario_id = ? ORDER BY id DESC LIMIT 1').get(reserva.usuario_id) as { wompi_fuente_id: number } | undefined;
  if (!cliente || !fuente) {
    return NextResponse.json({ error: 'El cliente no tiene una tarjeta guardada para cobrar este cargo' }, { status: 400 });
  }

  let estado: 'pendiente' | 'cobrado' | 'fallido' = 'pendiente';
  let transaccionId = '';
  try {
    const { acceptanceToken } = await obtenerTokensAceptacion();
    const transaccion = await crearTransaccion({
      montoEnCentavos: Math.round(Number(monto) * 100),
      referencia: `cargo-${id}-${Date.now()}`,
      correo: cliente.correo,
      acceptanceToken,
      fuentePagoId: fuente.wompi_fuente_id,
      recurrente: false,
    });
    const final = transaccion.status === 'PENDING'
      ? await esperarResultadoTransaccion(transaccion.id)
      : transaccion;

    transaccionId = final.id;
    if (final.status === 'APPROVED') estado = 'cobrado';
    else if (final.status === 'DECLINED' || final.status === 'ERROR' || final.status === 'VOIDED') estado = 'fallido';
  } catch (e) {
    console.error('[pagos] Error al cobrar cargo extra:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'No se pudo procesar el cobro con la pasarela' }, { status: 502 });
  }

  const result = db.prepare(`
    INSERT INTO cargos_extra (reserva_id, tipo, descripcion, monto, estado, wompi_transaccion_id, creado_por)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(Number(id), tipo, descripcion.trim(), Number(monto), estado, transaccionId, user.id);

  return NextResponse.json({ id: result.lastInsertRowid, estado }, { status: 201 });
}
