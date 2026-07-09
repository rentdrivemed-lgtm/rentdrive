import { NextRequest, NextResponse } from 'next/server';
import { guardArea } from '@/lib/guard';
import { esSocio, registrarAuditoria } from '@/lib/permisos';
import { notificarEquipo, notificarUsuarios } from '@/lib/panel';

export const dynamic = 'force-dynamic';

const ESTADOS = ['todo', 'proceso', 'hecho'];
const ROLES = ['', 'mensajero', 'secretaria', 'socio'];

// GET — lista de tareas visibles para el nivel del usuario.
export async function GET() {
  const g = await guardArea('tareas');
  if ('error' in g) return g.error;
  const { db, nivel } = g;

  const filtroSocios = esSocio(nivel) ? '' : 'WHERE solo_socios = 0';
  const tareas = db.prepare(
    `SELECT * FROM tareas_equipo ${filtroSocios} ORDER BY orden ASC, id DESC`
  ).all();
  return NextResponse.json({ tareas });
}

// POST — crear tarea.
export async function POST(req: NextRequest) {
  const g = await guardArea('tareas');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const body = await req.json().catch(() => ({}));
  const titulo = String(body.titulo || '').trim();
  if (!titulo) return NextResponse.json({ error: 'La tarea necesita un título.' }, { status: 400 });

  const estado = ESTADOS.includes(body.estado) ? body.estado : 'todo';
  const rol_destino = ROLES.includes(body.rol_destino) ? body.rol_destino : '';
  // Solo dueño/socios pueden marcar una tarea como "solo socios".
  const solo_socios = esSocio(nivel) && body.solo_socios ? 1 : 0;

  let asignadoId: number | null = null;
  let asignadoNombre = '';
  if (body.asignado_id) {
    const m = db.prepare("SELECT id, nombre FROM usuarios WHERE id = ? AND rol = 'admin'").get(Number(body.asignado_id)) as { id: number; nombre: string } | undefined;
    if (m) { asignadoId = m.id; asignadoNombre = m.nombre; }
  }

  const info = db.prepare(
    `INSERT INTO tareas_equipo (titulo, descripcion, estado, rol_destino, asignado_id, asignado_nombre, solo_socios, vence, created_by, created_by_nombre)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    titulo, String(body.descripcion || '').trim(), estado, rol_destino,
    asignadoId, asignadoNombre, solo_socios, String(body.vence || '').trim(),
    user.id, user.nombre || '',
  );
  const id = Number(info.lastInsertRowid);

  registrarAuditoria(db, { id: user.id, nombre: user.nombre, correo: user.correo, nivel }, {
    area: 'tareas', accion: 'crear_tarea', entidad: 'tarea', entidad_id: id,
    detalle: `Creó la tarea "${titulo}"${asignadoNombre ? ` para ${asignadoNombre}` : ''}`,
  });

  // Avisar: al asignado directo (si lo hay) y al resto del equipo.
  if (asignadoId) {
    notificarUsuarios(db, [asignadoId], {
      tipo: 'tarea_asignada', titulo: 'Nueva tarea asignada', mensaje: titulo, referencia_id: id, referencia_tipo: 'tarea',
    });
  }
  notificarEquipo(db, {
    tipo: 'tarea_nueva', titulo: 'Nueva tarea en el tablero', mensaje: titulo,
    excepto: user.id, soloSocios: solo_socios === 1, referencia_id: id, referencia_tipo: 'tarea',
  });

  const tarea = db.prepare('SELECT * FROM tareas_equipo WHERE id = ?').get(id);
  return NextResponse.json({ ok: true, tarea });
}

// PUT — editar campos de una tarea.
export async function PUT(req: NextRequest) {
  const g = await guardArea('tareas');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  const actual = db.prepare('SELECT * FROM tareas_equipo WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!actual) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 });
  // La secretaría no puede tocar tareas reservadas a socios.
  if (Number(actual.solo_socios) === 1 && !esSocio(nivel)) {
    return NextResponse.json({ error: 'No tienes permiso sobre esta tarea.' }, { status: 403 });
  }

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (typeof body.titulo === 'string' && body.titulo.trim()) { sets.push('titulo = ?'); vals.push(body.titulo.trim()); }
  if (typeof body.descripcion === 'string') { sets.push('descripcion = ?'); vals.push(body.descripcion.trim()); }
  if (ROLES.includes(body.rol_destino)) { sets.push('rol_destino = ?'); vals.push(body.rol_destino); }
  if (typeof body.vence === 'string') { sets.push('vence = ?'); vals.push(body.vence.trim()); }
  if (esSocio(nivel) && body.solo_socios !== undefined) { sets.push('solo_socios = ?'); vals.push(body.solo_socios ? 1 : 0); }
  if (body.asignado_id !== undefined) {
    if (body.asignado_id) {
      const m = db.prepare("SELECT id, nombre FROM usuarios WHERE id = ? AND rol = 'admin'").get(Number(body.asignado_id)) as { id: number; nombre: string } | undefined;
      if (m) {
        sets.push('asignado_id = ?', 'asignado_nombre = ?'); vals.push(m.id, m.nombre);
        if (Number(actual.asignado_id) !== m.id) {
          notificarUsuarios(db, [m.id], { tipo: 'tarea_asignada', titulo: 'Te asignaron una tarea', mensaje: String(actual.titulo), referencia_id: id, referencia_tipo: 'tarea' });
        }
      }
    } else {
      sets.push('asignado_id = NULL', 'asignado_nombre = ?'); vals.push('');
    }
  }
  if (!sets.length) return NextResponse.json({ error: 'Nada para actualizar.' }, { status: 400 });

  sets.push("updated_at = datetime('now','localtime')");
  db.prepare(`UPDATE tareas_equipo SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  registrarAuditoria(db, { id: user.id, nombre: user.nombre, correo: user.correo, nivel }, {
    area: 'tareas', accion: 'editar_tarea', entidad: 'tarea', entidad_id: id, detalle: `Editó la tarea "${actual.titulo}"`,
  });
  const tarea = db.prepare('SELECT * FROM tareas_equipo WHERE id = ?').get(id);
  return NextResponse.json({ ok: true, tarea });
}

// PATCH — mover de columna (Kanban) y/o reordenar.
export async function PATCH(req: NextRequest) {
  const g = await guardArea('tareas');
  if ('error' in g) return g.error;
  const { db, nivel } = g;

  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  const nuevoEstado = body.estado;
  if (!ESTADOS.includes(nuevoEstado)) return NextResponse.json({ error: 'Estado inválido' }, { status: 400 });

  const actual = db.prepare('SELECT solo_socios, titulo FROM tareas_equipo WHERE id = ?').get(id) as { solo_socios: number; titulo: string } | undefined;
  if (!actual) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 });
  if (Number(actual.solo_socios) === 1 && !esSocio(nivel)) {
    return NextResponse.json({ error: 'No tienes permiso sobre esta tarea.' }, { status: 403 });
  }

  const orden = Number.isFinite(Number(body.orden)) ? Number(body.orden) : 0;
  db.prepare("UPDATE tareas_equipo SET estado = ?, orden = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(nuevoEstado, orden, id);
  return NextResponse.json({ ok: true });
}

// DELETE — eliminar tarea.
export async function DELETE(req: NextRequest) {
  const g = await guardArea('tareas');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const id = Number(new URL(req.url).searchParams.get('id'));
  const actual = db.prepare('SELECT titulo, solo_socios FROM tareas_equipo WHERE id = ?').get(id) as { titulo: string; solo_socios: number } | undefined;
  if (!actual) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 });
  if (Number(actual.solo_socios) === 1 && !esSocio(nivel)) {
    return NextResponse.json({ error: 'No tienes permiso sobre esta tarea.' }, { status: 403 });
  }
  db.prepare('DELETE FROM tareas_equipo WHERE id = ?').run(id);
  registrarAuditoria(db, { id: user.id, nombre: user.nombre, correo: user.correo, nivel }, {
    area: 'tareas', accion: 'eliminar_tarea', entidad: 'tarea', entidad_id: id, detalle: `Eliminó la tarea "${actual.titulo}"`,
  });
  return NextResponse.json({ ok: true });
}
