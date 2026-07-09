import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

function nuevoToken() { return randomBytes(16).toString('hex'); }

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const db = getDb();

  const sets: string[] = [];
  const valores: unknown[] = [];
  if (typeof body.nombre === 'string') { sets.push('nombre = ?'); valores.push(body.nombre.trim()); }
  if (typeof body.celular === 'string') { sets.push('celular = ?'); valores.push(body.celular.trim()); }
  if (body.activo !== undefined) { sets.push('activo = ?'); valores.push(body.activo ? 1 : 0); }
  // Regenerar el enlace: emite un token nuevo y anula el anterior de inmediato
  // (útil si el mensajero pierde el celular o el link se filtró).
  if (body.regenerar_token) { sets.push('token = ?'); valores.push(nuevoToken()); }
  if (sets.length === 0) return NextResponse.json({ error: 'Nada para actualizar.' }, { status: 400 });

  db.prepare(`UPDATE mensajeros SET ${sets.join(', ')} WHERE id = ?`).run(...valores, Number(id));
  const mensajero = db.prepare('SELECT id, nombre, celular, activo, token FROM mensajeros WHERE id = ?').get(Number(id));
  return NextResponse.json({ mensajero });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  // Si ya está asignado a alguna operación, lo desactivamos en vez de borrarlo (preserva historial).
  const enUso = db.prepare('SELECT COUNT(*) AS n FROM operaciones WHERE mensajero_id = ?').get(Number(id)) as { n: number };
  if (enUso.n > 0) {
    db.prepare('UPDATE mensajeros SET activo = 0 WHERE id = ?').run(Number(id));
    return NextResponse.json({ ok: true, desactivado: true });
  }
  db.prepare('DELETE FROM mensajeros WHERE id = ?').run(Number(id));
  return NextResponse.json({ ok: true, eliminado: true });
}
