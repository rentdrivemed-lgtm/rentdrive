import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { guardArea } from '@/lib/guard';

export const dynamic = 'force-dynamic';

function nuevoToken() { return randomBytes(16).toString('hex'); }

// Los mensajeros se crean y administran desde el panel de Operaciones: mismo área.
export async function GET() {
  const g = await guardArea('operaciones');
  if ('error' in g) return g.error;
  const { db } = g;
  // Backfill: asegura que todo mensajero tenga token de acceso.
  const sinToken = db.prepare("SELECT id FROM mensajeros WHERE token IS NULL OR token = ''").all() as { id: number }[];
  const upd = db.prepare('UPDATE mensajeros SET token = ? WHERE id = ?');
  for (const m of sinToken) upd.run(nuevoToken(), m.id);

  const mensajeros = db.prepare('SELECT id, nombre, celular, activo, token FROM mensajeros ORDER BY activo DESC, nombre').all();
  return NextResponse.json({ mensajeros });
}

export async function POST(req: NextRequest) {
  const g = await guardArea('operaciones');
  if ('error' in g) return g.error;
  const { db } = g;

  const { nombre, celular } = await req.json().catch(() => ({}));
  if (!nombre || !String(nombre).trim()) return NextResponse.json({ error: 'El nombre es obligatorio.' }, { status: 400 });
  const ins = db.prepare('INSERT INTO mensajeros (nombre, celular, token) VALUES (?, ?, ?)')
    .run(String(nombre).trim(), String(celular || '').trim(), nuevoToken());
  const mensajero = db.prepare('SELECT id, nombre, celular, activo, token FROM mensajeros WHERE id = ?').get(Number(ins.lastInsertRowid));
  return NextResponse.json({ mensajero }, { status: 201 });
}
