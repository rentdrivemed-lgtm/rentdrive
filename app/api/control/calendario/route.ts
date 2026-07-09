import { NextRequest, NextResponse } from 'next/server';
import { guardArea } from '@/lib/guard';
import { esSocio, registrarAuditoria } from '@/lib/permisos';
import { notificarEquipo } from '@/lib/panel';

export const dynamic = 'force-dynamic';

const TIPOS = ['entrega', 'devolucion', 'vencimiento', 'reunion', 'general'];

type EventoUnificado = {
  id: string; titulo: string; tipo: string; fecha: string; hora: string; nota: string;
  fuente: 'manual' | 'reserva'; referencia_id: number | null; solo_socios: number;
};

// GET ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD — eventos manuales + entregas/devoluciones
// derivadas de reservas, dentro del rango.
export async function GET(req: NextRequest) {
  const g = await guardArea('calendario');
  if ('error' in g) return g.error;
  const { db, nivel } = g;

  const { searchParams } = new URL(req.url);
  const desde = (searchParams.get('desde') || '2000-01-01').slice(0, 10);
  const hasta = (searchParams.get('hasta') || '2999-12-31').slice(0, 10);
  const socio = esSocio(nivel);

  const eventos: EventoUnificado[] = [];

  // 1) Eventos manuales
  const manuales = db.prepare(
    `SELECT * FROM eventos_calendario
     WHERE fecha >= ? AND fecha <= ? ${socio ? '' : 'AND solo_socios = 0'}
     ORDER BY fecha, hora`
  ).all(desde, hasta) as Record<string, unknown>[];
  for (const e of manuales) {
    eventos.push({
      id: `m${e.id}`, titulo: String(e.titulo), tipo: String(e.tipo), fecha: String(e.fecha),
      hora: String(e.hora || ''), nota: String(e.nota || ''), fuente: 'manual',
      referencia_id: Number(e.id), solo_socios: Number(e.solo_socios || 0),
    });
  }

  // 2) Entregas y devoluciones derivadas de reservas activas (no canceladas)
  const reservas = db.prepare(
    `SELECT r.id, r.fecha_inicio, r.fecha_fin, r.estado, v.marca, v.modelo, v.placa, u.nombre AS cliente
     FROM reservas r
     JOIN vehiculos v ON r.vehiculo_id = v.id
     JOIN usuarios u ON r.usuario_id = u.id
     WHERE r.estado NOT IN ('cancelada')
       AND ( (r.fecha_inicio >= ? AND r.fecha_inicio <= ?) OR (r.fecha_fin >= ? AND r.fecha_fin <= ?) )`
  ).all(desde, hasta, desde, hasta) as Record<string, unknown>[];
  for (const r of reservas) {
    const carro = `${r.marca} ${r.modelo}${r.placa ? ` (${r.placa})` : ''}`;
    const ini = String(r.fecha_inicio).slice(0, 10);
    const fin = String(r.fecha_fin).slice(0, 10);
    if (ini >= desde && ini <= hasta) {
      eventos.push({ id: `re${r.id}`, titulo: `Entrega ${carro}`, tipo: 'entrega', fecha: ini, hora: '', nota: `Cliente: ${r.cliente}`, fuente: 'reserva', referencia_id: Number(r.id), solo_socios: 0 });
    }
    if (fin >= desde && fin <= hasta) {
      eventos.push({ id: `rd${r.id}`, titulo: `Devolución ${carro}`, tipo: 'devolucion', fecha: fin, hora: '', nota: `Cliente: ${r.cliente}`, fuente: 'reserva', referencia_id: Number(r.id), solo_socios: 0 });
    }
  }

  eventos.sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
  return NextResponse.json({ eventos });
}

// POST — crear evento manual.
export async function POST(req: NextRequest) {
  const g = await guardArea('calendario');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const body = await req.json().catch(() => ({}));
  const titulo = String(body.titulo || '').trim();
  const fecha = String(body.fecha || '').slice(0, 10);
  if (!titulo || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return NextResponse.json({ error: 'Necesitas un título y una fecha válida (YYYY-MM-DD).' }, { status: 400 });
  }
  const tipo = TIPOS.includes(body.tipo) ? body.tipo : 'general';
  const solo_socios = esSocio(nivel) && body.solo_socios ? 1 : 0;

  const info = db.prepare(
    `INSERT INTO eventos_calendario (titulo, tipo, fecha, hora, nota, solo_socios, created_by, created_by_nombre)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(titulo, tipo, fecha, String(body.hora || '').trim(), String(body.nota || '').trim(), solo_socios, user.id, user.nombre || '');
  const id = Number(info.lastInsertRowid);

  registrarAuditoria(db, { id: user.id, nombre: user.nombre, correo: user.correo, nivel }, {
    area: 'calendario', accion: 'crear_evento', entidad: 'evento', entidad_id: id, detalle: `Agregó "${titulo}" al ${fecha}`,
  });
  notificarEquipo(db, { tipo: 'evento_nuevo', titulo: 'Nuevo evento en el calendario', mensaje: `${titulo} · ${fecha}`, excepto: user.id, soloSocios: solo_socios === 1, referencia_id: id, referencia_tipo: 'evento' });

  const evento = db.prepare('SELECT * FROM eventos_calendario WHERE id = ?').get(id);
  return NextResponse.json({ ok: true, evento });
}

// DELETE ?id= — eliminar evento manual (los derivados de reservas no se pueden borrar aquí).
export async function DELETE(req: NextRequest) {
  const g = await guardArea('calendario');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const id = Number(new URL(req.url).searchParams.get('id'));
  const ev = db.prepare('SELECT titulo, solo_socios FROM eventos_calendario WHERE id = ?').get(id) as { titulo: string; solo_socios: number } | undefined;
  if (!ev) return NextResponse.json({ error: 'Evento no encontrado' }, { status: 404 });
  if (Number(ev.solo_socios) === 1 && !esSocio(nivel)) return NextResponse.json({ error: 'Sin permiso.' }, { status: 403 });
  db.prepare('DELETE FROM eventos_calendario WHERE id = ?').run(id);
  registrarAuditoria(db, { id: user.id, nombre: user.nombre, correo: user.correo, nivel }, {
    area: 'calendario', accion: 'eliminar_evento', entidad: 'evento', entidad_id: id, detalle: `Eliminó "${ev.titulo}"`,
  });
  return NextResponse.json({ ok: true });
}
