import { NextRequest, NextResponse } from 'next/server';
import { guardArea } from '@/lib/guard';
import { registrarAuditoria } from '@/lib/permisos';
import { notificarUsuarios } from '@/lib/panel';

export const dynamic = 'force-dynamic';

// GET — tableros donde el usuario es creador o colaborador (no todos ven todos).
export async function GET() {
  const g = await guardArea('tableros');
  if ('error' in g) return g.error;
  const { db, user } = g;

  const tableros = db.prepare(
    `SELECT t.*,
       (SELECT COUNT(*) FROM tablero_elementos e WHERE e.tablero_id = t.id) AS elementos,
       (SELECT COUNT(*) FROM tablero_colaboradores c WHERE c.tablero_id = t.id) AS colaboradores
     FROM tableros t
     WHERE t.created_by = ?
        OR EXISTS (SELECT 1 FROM tablero_colaboradores c WHERE c.tablero_id = t.id AND c.usuario_id = ?)
     ORDER BY t.updated_at DESC, t.id DESC`
  ).all(user.id, user.id);
  return NextResponse.json({ tableros });
}

// POST — crear tablero (el creador queda como colaborador implícito).
export async function POST(req: NextRequest) {
  const g = await guardArea('tableros');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const body = await req.json().catch(() => ({}));
  const titulo = String(body.titulo || '').trim() || 'Tablero sin título';
  const info = db.prepare('INSERT INTO tableros (titulo, created_by, created_by_nombre) VALUES (?, ?, ?)').run(titulo, user.id, user.nombre || '');
  const id = Number(info.lastInsertRowid);
  db.prepare('INSERT OR IGNORE INTO tablero_colaboradores (tablero_id, usuario_id) VALUES (?, ?)').run(id, user.id);

  registrarAuditoria(db, { id: user.id, nombre: user.nombre, correo: user.correo, nivel }, {
    area: 'tableros', accion: 'crear_tablero', entidad: 'tablero', entidad_id: id, detalle: `Creó el tablero "${titulo}"`,
  });

  // Invitar colaboradores iniciales (opcional)
  if (Array.isArray(body.colaboradores)) {
    const ins = db.prepare('INSERT OR IGNORE INTO tablero_colaboradores (tablero_id, usuario_id) VALUES (?, ?)');
    const invitados: number[] = [];
    for (const uid of body.colaboradores) {
      const n = Number(uid);
      if (n && n !== user.id && db.prepare("SELECT 1 FROM usuarios WHERE id = ? AND rol = 'admin'").get(n)) { ins.run(id, n); invitados.push(n); }
    }
    if (invitados.length) notificarUsuarios(db, invitados, { tipo: 'tablero_invitacion', titulo: 'Te invitaron a un tablero', mensaje: titulo, referencia_id: id, referencia_tipo: 'tablero' });
  }

  const tablero = db.prepare('SELECT * FROM tableros WHERE id = ?').get(id);
  return NextResponse.json({ ok: true, tablero });
}
