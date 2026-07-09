import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { cargarDetalleServicio, recomputarEstadoOperacion, ejecutarInspeccion } from '@/lib/operaciones';
import { tieneClaveAnthropic } from '@/lib/anthropic';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Mensajero = { id: number; nombre: string };

// Solo resuelve mensajeros ACTIVOS: al desactivar (o dar de baja) a un mensajero
// su enlace deja de funcionar de inmediato.
function resolverMensajero(token: string): Mensajero | undefined {
  if (!token || token.length < 8) return undefined;
  const db = getDb();
  return db.prepare('SELECT id, nombre FROM mensajeros WHERE token = ? AND activo = 1').get(token) as Mensajero | undefined;
}

function serializarOperacion(opId: number) {
  const db = getDb();
  const op = db.prepare('SELECT * FROM operaciones WHERE id = ?').get(opId) as Record<string, unknown>;
  const tareas = db.prepare('SELECT id, tipo, titulo, detalle, estado, orden FROM operacion_tareas WHERE operacion_id = ? ORDER BY orden, id').all(opId);
  return { ...op, detalle: cargarDetalleServicio(db, Number(op.reserva_id)) || null, tareas };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const m = resolverMensajero(token);
  if (!m) return NextResponse.json({ error: 'Enlace inválido' }, { status: 404 });

  const db = getDb();
  const ops = db.prepare('SELECT id FROM operaciones WHERE mensajero_id = ? ORDER BY created_at DESC, id DESC').all(m.id) as { id: number }[];
  const operaciones = ops.map(o => serializarOperacion(o.id));
  return NextResponse.json({ mensajero: { nombre: m.nombre }, operaciones, ia_disponible: tieneClaveAnthropic() });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const m = resolverMensajero(token);
  if (!m) return NextResponse.json({ error: 'Enlace inválido' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const opId = Number(body.operacion_id);
  const db = getDb();

  // La operación debe pertenecer a este mensajero.
  const op = db.prepare('SELECT id, mensajero_id FROM operaciones WHERE id = ?').get(opId) as { id: number; mensajero_id: number | null } | undefined;
  if (!op || op.mensajero_id !== m.id) return NextResponse.json({ error: 'Servicio no encontrado' }, { status: 404 });

  switch (body.accion) {
    case 'tarea': {
      const tareaId = Number(body.tarea_id);
      const estado = body.estado === 'hecho' ? 'hecho' : 'pendiente';
      const t = db.prepare('SELECT id FROM operacion_tareas WHERE id = ? AND operacion_id = ?').get(tareaId, opId);
      if (!t) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 });
      db.prepare('UPDATE operacion_tareas SET estado = ? WHERE id = ?').run(estado, tareaId);
      recomputarEstadoOperacion(db, opId, m.id);
      break;
    }
    case 'fotos': {
      const col = body.fase === 'entrada' ? 'fotos_entrada' : 'fotos_salida';
      const urls = Array.isArray(body.urls) ? body.urls.filter((u: unknown) => typeof u === 'string') : [];
      db.prepare(`UPDATE operaciones SET ${col} = ? WHERE id = ?`).run(JSON.stringify(urls), opId);
      break;
    }
    case 'inspeccion': {
      if (!tieneClaveAnthropic()) {
        return NextResponse.json({ error: 'La inspección con IA no está configurada (falta ANTHROPIC_API_KEY).' }, { status: 503 });
      }
      try {
        await ejecutarInspeccion(db, opId);
      } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Error en la inspección' }, { status: 400 });
      }
      break;
    }
    default:
      return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 });
  }

  return NextResponse.json({ operacion: serializarOperacion(opId) });
}
