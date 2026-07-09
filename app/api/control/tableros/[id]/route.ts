import { NextRequest, NextResponse } from 'next/server';
import { guardArea } from '@/lib/guard';
import { registrarAuditoria } from '@/lib/permisos';
import { puedeVerTablero, notificarUsuarios } from '@/lib/panel';

export const dynamic = 'force-dynamic';

// GET — tablero + colaboradores + elementos (solo si el usuario tiene acceso).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await guardArea('tableros');
  if ('error' in g) return g.error;
  const { db, user } = g;
  const id = Number((await params).id);
  if (!puedeVerTablero(db, id, user.id)) return NextResponse.json({ error: 'No tienes acceso a este tablero.' }, { status: 403 });

  const tablero = db.prepare('SELECT * FROM tableros WHERE id = ?').get(id);
  const colaboradores = db.prepare(
    `SELECT u.id, u.nombre FROM tablero_colaboradores c JOIN usuarios u ON c.usuario_id = u.id WHERE c.tablero_id = ? ORDER BY u.nombre`
  ).all(id);
  const elementos = db.prepare('SELECT * FROM tablero_elementos WHERE tablero_id = ? ORDER BY id').all(id);
  return NextResponse.json({ tablero, colaboradores, elementos });
}

// PUT — renombrar tablero.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await guardArea('tableros');
  if ('error' in g) return g.error;
  const { db, user } = g;
  const id = Number((await params).id);
  if (!puedeVerTablero(db, id, user.id)) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const titulo = String(body.titulo || '').trim();
  if (!titulo) return NextResponse.json({ error: 'Falta el título' }, { status: 400 });
  db.prepare("UPDATE tableros SET titulo = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(titulo, id);
  return NextResponse.json({ ok: true });
}

// POST — invitar un colaborador.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await guardArea('tableros');
  if ('error' in g) return g.error;
  const { db, user } = g;
  const id = Number((await params).id);
  if (!puedeVerTablero(db, id, user.id)) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const uid = Number(body.usuario_id);
  const objetivo = db.prepare("SELECT id, nombre FROM usuarios WHERE id = ? AND rol = 'admin'").get(uid) as { id: number; nombre: string } | undefined;
  if (!objetivo) return NextResponse.json({ error: 'Esa persona no está en el equipo.' }, { status: 404 });
  db.prepare('INSERT OR IGNORE INTO tablero_colaboradores (tablero_id, usuario_id) VALUES (?, ?)').run(id, uid);
  const tablero = db.prepare('SELECT titulo FROM tableros WHERE id = ?').get(id) as { titulo: string };
  notificarUsuarios(db, [uid], { tipo: 'tablero_invitacion', titulo: 'Te invitaron a un tablero', mensaje: tablero.titulo, referencia_id: id, referencia_tipo: 'tablero' });

  const colaboradores = db.prepare(`SELECT u.id, u.nombre FROM tablero_colaboradores c JOIN usuarios u ON c.usuario_id = u.id WHERE c.tablero_id = ? ORDER BY u.nombre`).all(id);
  return NextResponse.json({ ok: true, colaboradores });
}

// DELETE — eliminar tablero (solo el creador).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await guardArea('tableros');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;
  const id = Number((await params).id);
  const t = db.prepare('SELECT created_by, titulo FROM tableros WHERE id = ?').get(id) as { created_by: number; titulo: string } | undefined;
  if (!t) return NextResponse.json({ error: 'Tablero no encontrado' }, { status: 404 });
  if (Number(t.created_by) !== user.id) return NextResponse.json({ error: 'Solo quien creó el tablero puede eliminarlo.' }, { status: 403 });

  db.prepare('DELETE FROM tablero_elementos WHERE tablero_id = ?').run(id);
  db.prepare('DELETE FROM tablero_colaboradores WHERE tablero_id = ?').run(id);
  db.prepare('DELETE FROM tableros WHERE id = ?').run(id);
  registrarAuditoria(db, { id: user.id, nombre: user.nombre, correo: user.correo, nivel }, {
    area: 'tableros', accion: 'eliminar_tablero', entidad: 'tablero', entidad_id: id, detalle: `Eliminó el tablero "${t.titulo}"`,
  });
  return NextResponse.json({ ok: true });
}
