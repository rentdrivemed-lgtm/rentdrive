import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

// GET — mensajes de una conversación (opcionalmente desde un ID)
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const conversacionId = Number(searchParams.get('conversacion_id'));
  const desdeId = Number(searchParams.get('desde_id') || '0');

  if (!conversacionId) return NextResponse.json({ error: 'Falta conversacion_id' }, { status: 400 });

  const db = getDb();

  // Verificar que el usuario pertenece a la conversación
  const conv = await db.prepare(
    'SELECT * FROM conversaciones WHERE id = ? AND (propietario_id = ? OR usuario_id = ?)'
  ).get(conversacionId, user.id, user.id);
  if (!conv) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  const mensajes = await db.prepare(`
    SELECT m.*, u.nombre AS remitente_nombre
    FROM mensajes m
    JOIN usuarios u ON m.remitente_id = u.id
    WHERE m.conversacion_id = ? AND m.id > ?
    ORDER BY m.id ASC
  `).all(conversacionId, desdeId);

  return NextResponse.json({ mensajes });
}

// POST — enviar un mensaje
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const { conversacion_id, contenido } = await req.json();
  if (!conversacion_id || !contenido?.trim()) {
    return NextResponse.json({ error: 'Mensaje vacío' }, { status: 400 });
  }

  const db = getDb();

  const conv = await db.prepare(
    'SELECT * FROM conversaciones WHERE id = ? AND (propietario_id = ? OR usuario_id = ?)'
  ).get(conversacion_id, user.id, user.id);
  if (!conv) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  const result = await db.prepare(
    'INSERT INTO mensajes (conversacion_id, remitente_id, contenido) VALUES (?, ?, ?)'
  ).run(conversacion_id, user.id, contenido.trim());

  const mensaje = await db.prepare(
    'SELECT m.*, u.nombre AS remitente_nombre FROM mensajes m JOIN usuarios u ON m.remitente_id = u.id WHERE m.id = ?'
  ).get(result.lastInsertRowid);

  return NextResponse.json({ mensaje }, { status: 201 });
}
