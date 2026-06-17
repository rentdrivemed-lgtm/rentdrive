import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { cargarDetalleServicio, mensajeMensajero, mensajeAdmin, getConfig, recomputarEstadoOperacion, ejecutarInspeccion, appBaseUrl } from '@/lib/operaciones';
import { enviarWhatsapp } from '@/lib/whatsapp';
import { tieneClaveAnthropic } from '@/lib/anthropic';

export const dynamic = 'force-dynamic';

type Op = { id: number; reserva_id: number; mensajero_id: number | null; estado: string; notas: string };

const ESTADOS_OP = ['pendiente', 'asignada', 'en_proceso', 'finalizada'];

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  const { id } = await params;
  const opId = Number(id);
  const body = await req.json().catch(() => ({}));
  const db = getDb();

  const op = db.prepare('SELECT id, reserva_id, mensajero_id, estado, notas FROM operaciones WHERE id = ?').get(opId) as Op | undefined;
  if (!op) return NextResponse.json({ error: 'Operación no encontrada' }, { status: 404 });

  switch (body.accion) {
    // ── Asignar mensajero y notificarlo por WhatsApp ──
    case 'asignar': {
      const mensajeroId = body.mensajero_id ? Number(body.mensajero_id) : null;
      let wa = '';
      if (mensajeroId) {
        const m = db.prepare('SELECT nombre, celular, token FROM mensajeros WHERE id = ?').get(mensajeroId) as { nombre: string; celular: string; token: string } | undefined;
        if (!m) return NextResponse.json({ error: 'Mensajero no encontrado' }, { status: 404 });
        db.prepare("UPDATE operaciones SET mensajero_id = ?, estado = CASE WHEN estado = 'pendiente' THEN 'asignada' ELSE estado END WHERE id = ?").run(mensajeroId, opId);

        const det = cargarDetalleServicio(db, op.reserva_id);
        const tareas = db.prepare('SELECT titulo, detalle FROM operacion_tareas WHERE operacion_id = ? ORDER BY orden, id').all(opId) as { titulo: string; detalle: string }[];
        const enlace = m.token ? `${appBaseUrl()}/m/${m.token}` : undefined;
        wa = det
          ? (await enviarWhatsapp(m.celular, mensajeMensajero(det, tareas, enlace))).detalle
          : 'no enviado: sin detalle del servicio';
        if (!m.celular) wa = 'no enviado: el mensajero no tiene celular registrado';
        db.prepare('UPDATE operaciones SET wa_mensajero = ? WHERE id = ?').run(wa, opId);
      } else {
        db.prepare("UPDATE operaciones SET mensajero_id = NULL, wa_mensajero = '' WHERE id = ?").run(opId);
      }
      break;
    }

    // ── Cambiar estado de la operación manualmente ──
    case 'estado': {
      if (!ESTADOS_OP.includes(body.estado)) return NextResponse.json({ error: 'Estado inválido' }, { status: 400 });
      db.prepare('UPDATE operaciones SET estado = ? WHERE id = ?').run(body.estado, opId);
      break;
    }

    // ── Marcar/desmarcar una tarea ──
    case 'tarea': {
      const tareaId = Number(body.tarea_id);
      const estadoTarea = body.estado === 'hecho' ? 'hecho' : 'pendiente';
      const t = db.prepare('SELECT id FROM operacion_tareas WHERE id = ? AND operacion_id = ?').get(tareaId, opId);
      if (!t) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 });
      db.prepare('UPDATE operacion_tareas SET estado = ? WHERE id = ?').run(estadoTarea, tareaId);
      recomputarEstadoOperacion(db, opId, op.mensajero_id);
      break;
    }

    // ── Notas internas ──
    case 'notas': {
      db.prepare('UPDATE operaciones SET notas = ? WHERE id = ?').run(String(body.notas ?? ''), opId);
      break;
    }

    // ── Guardar fotos de inspección (salida o entrada) ──
    case 'fotos': {
      const col = body.fase === 'entrada' ? 'fotos_entrada' : 'fotos_salida';
      const urls = Array.isArray(body.urls) ? body.urls.filter((u: unknown) => typeof u === 'string') : [];
      db.prepare(`UPDATE operaciones SET ${col} = ? WHERE id = ?`).run(JSON.stringify(urls), opId);
      break;
    }

    // ── Ejecutar inspección de daños con IA ──
    case 'inspeccion': {
      if (!tieneClaveAnthropic()) {
        return NextResponse.json({ error: 'La inspección con IA no está configurada: falta ANTHROPIC_API_KEY.' }, { status: 503 });
      }
      try {
        await ejecutarInspeccion(db, opId);
      } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Error en la inspección' }, { status: 400 });
      }
      break;
    }

    // ── Reenviar WhatsApp (al mensajero o al administrador) ──
    case 'reenviar': {
      const det = cargarDetalleServicio(db, op.reserva_id);
      if (!det) return NextResponse.json({ error: 'Sin detalle del servicio' }, { status: 400 });
      if (body.destino === 'admin') {
        const adminWa = getConfig(db, 'admin_whatsapp');
        const r = adminWa ? (await enviarWhatsapp(adminWa, mensajeAdmin(det))).detalle : 'no enviado: falta el WhatsApp del administrador';
        db.prepare('UPDATE operaciones SET wa_admin = ? WHERE id = ?').run(r, opId);
      } else {
        if (!op.mensajero_id) return NextResponse.json({ error: 'No hay mensajero asignado' }, { status: 400 });
        const m = db.prepare('SELECT celular, token FROM mensajeros WHERE id = ?').get(op.mensajero_id) as { celular: string; token: string } | undefined;
        const tareas = db.prepare('SELECT titulo, detalle FROM operacion_tareas WHERE operacion_id = ? ORDER BY orden, id').all(opId) as { titulo: string; detalle: string }[];
        const enlace = m?.token ? `${appBaseUrl()}/m/${m.token}` : undefined;
        const r = m?.celular ? (await enviarWhatsapp(m.celular, mensajeMensajero(det, tareas, enlace))).detalle : 'no enviado: el mensajero no tiene celular';
        db.prepare('UPDATE operaciones SET wa_mensajero = ? WHERE id = ?').run(r, opId);
      }
      break;
    }

    default:
      return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 });
  }

  // Devolver la operación actualizada (con detalle, tareas y mensajero).
  const actualizada = db.prepare(`
    SELECT o.*, m.nombre AS mensajero_nombre, m.celular AS mensajero_celular
    FROM operaciones o LEFT JOIN mensajeros m ON o.mensajero_id = m.id WHERE o.id = ?
  `).get(opId) as Record<string, unknown>;
  const tareas = db.prepare('SELECT id, tipo, titulo, detalle, estado, orden FROM operacion_tareas WHERE operacion_id = ? ORDER BY orden, id').all(opId);
  return NextResponse.json({ operacion: { ...actualizada, detalle: cargarDetalleServicio(db, op.reserva_id) || null, tareas } });
}
