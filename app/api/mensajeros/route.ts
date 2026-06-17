import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

function nuevoToken() { return randomBytes(16).toString('hex'); }

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  const db = getDb();
  // Backfill: asegura que todo mensajero tenga token de acceso.
  const sinToken = db.prepare("SELECT id FROM mensajeros WHERE token IS NULL OR token = ''").all() as { id: number }[];
  const upd = db.prepare('UPDATE mensajeros SET token = ? WHERE id = ?');
  for (const m of sinToken) upd.run(nuevoToken(), m.id);

  const mensajeros = db.prepare('SELECT id, nombre, celular, activo, token FROM mensajeros ORDER BY activo DESC, nombre').all();
  return NextResponse.json({ mensajeros });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  const { nombre, celular } = await req.json().catch(() => ({}));
  if (!nombre || !String(nombre).trim()) return NextResponse.json({ error: 'El nombre es obligatorio.' }, { status: 400 });

  const db = getDb();
  const ins = db.prepare('INSERT INTO mensajeros (nombre, celular, token) VALUES (?, ?, ?)')
    .run(String(nombre).trim(), String(celular || '').trim(), nuevoToken());
  const mensajero = db.prepare('SELECT id, nombre, celular, activo, token FROM mensajeros WHERE id = ?').get(Number(ins.lastInsertRowid));
  return NextResponse.json({ mensajero }, { status: 201 });
}
