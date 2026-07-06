import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

type ConvRow = { id: number; solicitante_id: number };

async function cargarConversacion(id: number, userId: number, isAdmin: boolean) {
  const db = getDb();
  const conv = db.prepare('SELECT * FROM conversaciones_soporte WHERE id = ?').get(id) as ConvRow | undefined;
  if (!conv) return null;
  if (!isAdmin && conv.solicitante_id !== userId) return null;
  return conv;
}

// GET — detalle de una conversación (mensajes). El propio solicitante o cualquier admin.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const { id } = await params;
  const conv = await cargarConversacion(Number(id), user.id, user.rol === 'admin');
  if (!conv) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

  const db = getDb();
  const mensajes = db.prepare(
    'SELECT id, remitente_tipo, remitente_admin_id, contenido, created_at FROM mensajes_soporte WHERE conversacion_id = ? ORDER BY id ASC'
  ).all(Number(id));

  return NextResponse.json({ conversacion: conv, mensajes });
}

// POST — un admin responde manualmente (nunca dispara al asistente).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const conv = db.prepare('SELECT * FROM conversaciones_soporte WHERE id = ?').get(Number(id)) as ConvRow | undefined;
  if (!conv) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const texto = String(body.mensaje || '').trim().slice(0, 2000);
  if (!texto) return NextResponse.json({ error: 'Escribe un mensaje.' }, { status: 400 });

  db.prepare('INSERT INTO mensajes_soporte (conversacion_id, remitente_tipo, remitente_admin_id, contenido) VALUES (?, ?, ?, ?)')
    .run(Number(id), 'admin', user.id, texto);
  db.prepare("UPDATE conversaciones_soporte SET estado = 'escalada', actualizado_en = datetime('now','localtime') WHERE id = ?").run(Number(id));

  const insN = db.prepare('INSERT INTO notificaciones (destinatario_id, tipo, titulo, mensaje, referencia_id, referencia_tipo) VALUES (?, ?, ?, ?, ?, ?)');
  insN.run(conv.solicitante_id, 'soporte_respuesta', '💬 Nueva respuesta de soporte', 'Un administrador de DrivePass respondió tu mensaje de soporte.', Number(id), 'soporte');

  return NextResponse.json({ ok: true });
}

// PUT — admin marca la conversación como resuelta (reactiva el modo asistente para el próximo mensaje).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const db = getDb();
  const conv = db.prepare('SELECT * FROM conversaciones_soporte WHERE id = ?').get(Number(id)) as ConvRow | undefined;
  if (!conv) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

  const nuevoEstado = body.estado === 'ia' ? 'ia' : 'resuelta';
  db.prepare("UPDATE conversaciones_soporte SET estado = ?, motivo_escalada = '', actualizado_en = datetime('now','localtime') WHERE id = ?")
    .run(nuevoEstado, Number(id));

  return NextResponse.json({ ok: true, estado: nuevoEstado });
}
