// El estado del vehículo tal como quedó anotado, para que el CLIENTE lo confirme.
//
//   GET  → lo que se anotó y las fotos que se tomaron, por momento
//   PUT  → el cliente confirma lo que ve
//
// Solo el cliente de la reserva y el equipo. El propietario NO: la conformidad sobre el
// estado del vehículo la da quien lo recibe, y mostrarle a un tercero las fotos y el
// inventario de una operación ajena no aporta nada que él necesite.
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { bloqueadoPorCsrf } from '@/lib/csrf';
import { adminTieneArea } from '@/lib/guard';
import { parseFotosServicio } from '@/lib/fotos-servicio';
import { ITEMS_ESTADO_VEHICULO } from '@/lib/contratos-datos';
import {
  leerReporte, leerIntervenciones, confirmarCliente, combustibleTexto,
  ETIQUETA_FASE, type FaseReporte,
} from '@/lib/reporte-entrega';

export const dynamic = 'force-dynamic';

function esFase(v: unknown): v is FaseReporte {
  return v === 'salida' || v === 'entrada';
}

type Contexto = { operacionId: number; clienteId: number; esCliente: boolean };

async function contexto(req: NextRequest, id: string): Promise<
  { ok: true; ctx: Contexto; userId: number; nombre: string } | { ok: false; res: NextResponse }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, res: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };

  const reservaId = Number(id);
  if (!Number.isInteger(reservaId) || reservaId <= 0) {
    return { ok: false, res: NextResponse.json({ error: 'Reserva inválida' }, { status: 400 }) };
  }

  const db = getDb();
  const fila = db.prepare(`
    SELECT o.id AS operacion_id, r.usuario_id
    FROM reservas r LEFT JOIN operaciones o ON o.reserva_id = r.id
    WHERE r.id = ?
  `).get(reservaId) as { operacion_id: number | null; usuario_id: number } | undefined;

  const esCliente = !!fila && Number(fila.usuario_id) === Number(user.id);
  const esEquipo = user.rol === 'admin' && adminTieneArea(db, user.id, 'operaciones');

  // 404 y no 403 cuando no le corresponde: no se confirma la existencia de reservas ajenas.
  if (!fila || (!esCliente && !esEquipo)) {
    return { ok: false, res: NextResponse.json({ error: 'La reserva no existe.' }, { status: 404 }) };
  }
  if (fila.operacion_id === null) {
    return { ok: false, res: NextResponse.json({ error: 'Esta reserva todavía no tiene reporte.' }, { status: 409 }) };
  }

  return {
    ok: true,
    ctx: { operacionId: fila.operacion_id, clienteId: fila.usuario_id, esCliente },
    userId: user.id,
    nombre: user.nombre,
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await contexto(req, id);
  if (!c.ok) return c.res;

  const db = getDb();
  const op = db.prepare('SELECT fotos_salida, fotos_entrada FROM operaciones WHERE id = ?')
    .get(c.ctx.operacionId) as { fotos_salida: string; fotos_entrada: string };

  const momento = (fase: FaseReporte) => {
    const r = leerReporte(db, c.ctx.operacionId, fase)!;
    return {
      fase,
      etiqueta: ETIQUETA_FASE[fase],
      kilometraje: r.kilometraje,
      // Ya formateado: la pantalla no tiene por qué saber que son octavos.
      combustible: combustibleTexto(r.combustible),
      inventario: r.inventario,
      fotos: parseFotosServicio(fase === 'salida' ? op.fotos_salida : op.fotos_entrada),
      completo: r.completo,
      confirmadoEn: r.confirmadoEn,
      constancia: r.constancia,
      // Para que la pantalla explique qué falta en vez de un botón apagado sin motivo.
      itemsFaltantes: r.itemsFaltantes,
    };
  };

  return NextResponse.json({
    items: ITEMS_ESTADO_VEHICULO,
    entrega: momento('salida'),
    devolucion: momento('entrada'),
    intervenciones: leerIntervenciones(db, c.ctx.operacionId),
    puedeConfirmar: c.ctx.esCliente,
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrf = bloqueadoPorCsrf(req);
  if (csrf) return csrf;

  const { id } = await params;
  const c = await contexto(req, id);
  if (!c.ok) return c.res;

  // La conformidad la da el CLIENTE y nadie más. Ni el equipo ni el mensajero pueden
  // confirmar en su nombre: eso convertiría la constancia en una firma falsa, que es
  // justo lo que la vía de «dejar constancia» existe para evitar.
  if (!c.ctx.esCliente) {
    return NextResponse.json(
      { error: 'Solo el cliente de la reserva puede confirmar el estado del vehículo.' },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => ({})) as { fase?: unknown };
  if (!esFase(body.fase)) return NextResponse.json({ error: 'Momento inválido' }, { status: 400 });

  const db = getDb();
  const r = confirmarCliente(db, c.ctx.operacionId, body.fase, c.userId, c.nombre);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  return NextResponse.json({ ok: true });
}
