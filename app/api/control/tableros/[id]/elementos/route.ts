import { NextRequest, NextResponse } from 'next/server';
import { guardArea } from '@/lib/guard';
import { puedeVerTablero } from '@/lib/panel';

export const dynamic = 'force-dynamic';

const TIPOS = ['sticky', 'text', 'rect', 'circle', 'link', 'path'];

async function acceso(params: Promise<{ id: string }>) {
  const g = await guardArea('tableros');
  if ('error' in g) return { error: g.error };
  const id = Number((await params).id);
  if (!puedeVerTablero(g.db, id, g.user.id)) return { error: NextResponse.json({ error: 'Sin acceso.' }, { status: 403 }) };
  return { db: g.db, user: g.user, tableroId: id };
}

function tocar(db: import('better-sqlite3').Database, tableroId: number) {
  db.prepare("UPDATE tableros SET updated_at = datetime('now','localtime') WHERE id = ?").run(tableroId);
}

// POST — agregar un elemento.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await acceso(params);
  if ('error' in a) return a.error;
  const { db, user, tableroId } = a;

  const body = await req.json().catch(() => ({}));
  if (!TIPOS.includes(body.tipo)) return NextResponse.json({ error: 'Tipo inválido' }, { status: 400 });
  const info = db.prepare(
    `INSERT INTO tablero_elementos (tablero_id, tipo, x, y, w, h, contenido, color, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    tableroId, body.tipo, Number(body.x) || 0, Number(body.y) || 0, Number(body.w) || 0, Number(body.h) || 0,
    String(body.contenido || ''), String(body.color || ''), user.id,
  );
  tocar(db, tableroId);
  const elemento = db.prepare('SELECT * FROM tablero_elementos WHERE id = ?').get(Number(info.lastInsertRowid));
  return NextResponse.json({ ok: true, elemento });
}

// PUT — actualizar posición/tamaño/contenido de un elemento.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await acceso(params);
  if ('error' in a) return a.error;
  const { db, tableroId } = a;

  const body = await req.json().catch(() => ({}));
  const elId = Number(body.id);
  const el = db.prepare('SELECT tablero_id FROM tablero_elementos WHERE id = ?').get(elId) as { tablero_id: number } | undefined;
  if (!el || el.tablero_id !== tableroId) return NextResponse.json({ error: 'Elemento no encontrado' }, { status: 404 });

  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const campo of ['x', 'y', 'w', 'h'] as const) {
    if (body[campo] !== undefined) { sets.push(`${campo} = ?`); vals.push(Number(body[campo]) || 0); }
  }
  if (body.contenido !== undefined) { sets.push('contenido = ?'); vals.push(String(body.contenido)); }
  if (body.color !== undefined) { sets.push('color = ?'); vals.push(String(body.color)); }
  if (!sets.length) return NextResponse.json({ error: 'Nada para actualizar' }, { status: 400 });
  sets.push("updated_at = datetime('now','localtime')");
  db.prepare(`UPDATE tablero_elementos SET ${sets.join(', ')} WHERE id = ?`).run(...vals, elId);
  tocar(db, tableroId);
  return NextResponse.json({ ok: true });
}

// DELETE ?el=<id> — eliminar un elemento.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await acceso(params);
  if ('error' in a) return a.error;
  const { db, tableroId } = a;
  const elId = Number(new URL(req.url).searchParams.get('el'));
  const el = db.prepare('SELECT tablero_id FROM tablero_elementos WHERE id = ?').get(elId) as { tablero_id: number } | undefined;
  if (!el || el.tablero_id !== tableroId) return NextResponse.json({ error: 'Elemento no encontrado' }, { status: 404 });
  db.prepare('DELETE FROM tablero_elementos WHERE id = ?').run(elId);
  tocar(db, tableroId);
  return NextResponse.json({ ok: true });
}
