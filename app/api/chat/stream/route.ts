import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response('No autorizado', { status: 401 });

  const { searchParams } = new URL(req.url);
  const conversacionId = Number(searchParams.get('conversacion_id'));
  if (!conversacionId) return new Response('Falta conversacion_id', { status: 400 });

  const db = getDb();

  const conv = await db.prepare(
    'SELECT * FROM conversaciones WHERE id = ? AND (propietario_id = ? OR usuario_id = ?)'
  ).get(conversacionId, user.id, user.id);
  if (!conv) return new Response('No autorizado', { status: 403 });

  let lastId = Number(searchParams.get('desde_id') || '0');
  let closed = false;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Heartbeat inicial
      controller.enqueue(encoder.encode(': keep-alive\n\n'));

      const tick = async () => {
        if (closed) return;
        try {
          const mensajes = db.prepare(`
            SELECT m.*, u.nombre AS remitente_nombre
            FROM mensajes m
            JOIN usuarios u ON m.remitente_id = u.id
            WHERE m.conversacion_id = ? AND m.id > ?
            ORDER BY m.id ASC
          `).all(conversacionId, lastId) as { id: number }[];

          if (mensajes.length > 0) {
            lastId = Number(mensajes[mensajes.length - 1].id);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(mensajes)}\n\n`));
          } else {
            controller.enqueue(encoder.encode(': ping\n\n'));
          }
        } catch {
          if (!closed) {
            closed = true;
            try { controller.close(); } catch { /* */ }
          }
          return;
        }
        if (!closed) setTimeout(tick, 1500);
      };

      // arrancar loop
      tick();

      req.signal.addEventListener('abort', () => {
        closed = true;
        try { controller.close(); } catch { /* */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
