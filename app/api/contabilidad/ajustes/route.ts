// Ajustes pendientes por propietario (regla C del diseño de liquidaciones editables):
// cuando un costo aparece DESPUÉS de que la liquidación ya se pagó, lo pagado no se toca —
// es constancia histórica— y el costo se registra aquí. `generarLiquidacion` lo consume
// automáticamente al crear la SIGUIENTE liquidación de ese propietario
// (lib/contabilidad.ts → consumirAjustesPendientes), una sola vez.
//
// Mismo gating que el resto de contabilidad: guardArea('contabilidad').
import { NextRequest, NextResponse } from 'next/server';
import { guardArea } from '@/lib/guard';
import { crearAjustePendiente, anularAjustePendiente, listarAjustesPendientes, type CrearAjusteInput } from '@/lib/contabilidad';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const g = await guardArea('contabilidad');
  if ('error' in g) return g.error;
  const { db } = g;

  const { searchParams } = new URL(req.url);
  const propietarioId = Number(searchParams.get('propietario_id')) || undefined;

  return NextResponse.json({ ajustes: listarAjustesPendientes(db, propietarioId) });
}

export async function POST(req: NextRequest) {
  const g = await guardArea('contabilidad');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const body = await req.json().catch(() => ({})) as Partial<CrearAjusteInput>;
  // `monto` y `concepto` viajan CRUDOS: la validación estricta vive en crearAjustePendiente
  // (lib/liquidacion-calculo.ts → valorNumerico), y coercionarlos aquí con Number()/String()
  // volvería a colar `true` como $1 o un objeto como "[object Object]".
  let r: ReturnType<typeof crearAjustePendiente>;
  try {
    r = crearAjustePendiente(db, { ...user, nivel }, {
      propietario_id: Number(body.propietario_id),
      tipo: body.tipo === 'adicional' ? 'adicional' : 'descuento',
      concepto: body.concepto,
      monto: body.monto,
      motivo: body.motivo,
      reserva_origen_id: body.reserva_origen_id ?? null,
    });
  } catch (e) {
    console.error('[ajustes] no se pudo crear el ajuste:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'No se pudo registrar el ajuste. No se guardó nada.' }, { status: 500 });
  }
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  return NextResponse.json({ ok: true, ajuste: r.ajuste }, { status: 201 });
}

// Anular un ajuste que ya no aplica (se cobró por fuera, se acordó con el propietario…).
// No se borra: queda con estado 'anulado', su motivo y su rastro en la bitácora.
export async function DELETE(req: NextRequest) {
  const g = await guardArea('contabilidad');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const body = await req.json().catch(() => ({})) as { id?: unknown; motivo?: unknown };
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Falta el id del ajuste' }, { status: 400 });

  let r: ReturnType<typeof anularAjustePendiente>;
  try {
    r = anularAjustePendiente(db, { ...user, nivel }, id, body.motivo);
  } catch (e) {
    console.error('[ajustes] no se pudo anular el ajuste:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'No se pudo anular el ajuste. No se guardó nada.' }, { status: 500 });
  }
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  return NextResponse.json({ ok: true });
}
