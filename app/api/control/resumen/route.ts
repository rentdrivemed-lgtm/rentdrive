import { NextResponse } from 'next/server';
import { guardArea } from '@/lib/guard';
import { esSocio } from '@/lib/permisos';

export const dynamic = 'force-dynamic';

// Fecha "hoy" en horario de Medellín, formato YYYY-MM-DD.
function hoyBogota(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

type Flota = { id: number; placa: string; vehiculo: string; estado: string; estado_key: string; responsable: string };
type Pendiente = { tipo: string; titulo: string; meta: string; solo_socios: number };

export async function GET() {
  const g = await guardArea('panel');
  if ('error' in g) return g.error;
  const { db, nivel } = g;
  const hoy = hoyBogota();
  const socio = esSocio(nivel);

  const vehiculos = db.prepare('SELECT id, marca, modelo, anio, placa, disponible FROM vehiculos ORDER BY marca, modelo').all() as Record<string, unknown>[];

  const flota: Flota[] = vehiculos.map(v => {
    const id = Number(v.id);
    const nombre = `${v.marca} ${v.modelo}`;
    const placa = String(v.placa || '') || '—';

    // ¿Operación activa (servicio logístico en curso) para este vehículo?
    const op = db.prepare(
      `SELECT o.estado, m.nombre AS mensajero
       FROM operaciones o
       JOIN reservas r ON o.reserva_id = r.id
       LEFT JOIN mensajeros m ON o.mensajero_id = m.id
       WHERE r.vehiculo_id = ? AND o.estado != 'finalizada'
       ORDER BY o.id DESC LIMIT 1`
    ).get(id) as { estado: string; mensajero: string | null } | undefined;

    // ¿Reserva confirmada que cubre hoy?
    const res = db.prepare(
      `SELECT u.nombre AS cliente FROM reservas r
       JOIN usuarios u ON r.usuario_id = u.id
       WHERE r.vehiculo_id = ? AND r.estado = 'confirmada'
         AND substr(r.fecha_inicio,1,10) <= ? AND substr(r.fecha_fin,1,10) >= ?
       ORDER BY r.id DESC LIMIT 1`
    ).get(id, hoy, hoy) as { cliente: string } | undefined;

    if (op) return { id, placa, vehiculo: nombre, estado: 'En operación', estado_key: 'ruta', responsable: op.mensajero || 'Sin mensajero' };
    if (res) return { id, placa, vehiculo: nombre, estado: 'Alquilado hoy', estado_key: 'ruta', responsable: res.cliente };
    if (Number(v.disponible) === 1) return { id, placa, vehiculo: nombre, estado: 'Disponible', estado_key: 'activo', responsable: '—' };
    return { id, placa, vehiculo: nombre, estado: 'No disponible', estado_key: 'taller', responsable: '—' };
  });

  const pendientes: Pendiente[] = [];

  // Eventos de calendario de hoy (manuales)
  const eventosHoy = db.prepare(
    `SELECT titulo, tipo, hora FROM eventos_calendario WHERE fecha = ? ${socio ? '' : 'AND solo_socios = 0'} ORDER BY hora`
  ).all(hoy) as Record<string, unknown>[];
  for (const e of eventosHoy) pendientes.push({ tipo: String(e.tipo), titulo: String(e.titulo), meta: String(e.hora || 'Hoy'), solo_socios: 0 });

  // Entregas y devoluciones de hoy (derivadas de reservas)
  const reservasHoy = db.prepare(
    `SELECT r.fecha_inicio, r.fecha_fin, v.marca, v.modelo, v.placa, u.nombre AS cliente
     FROM reservas r JOIN vehiculos v ON r.vehiculo_id = v.id JOIN usuarios u ON r.usuario_id = u.id
     WHERE r.estado != 'cancelada' AND (substr(r.fecha_inicio,1,10) = ? OR substr(r.fecha_fin,1,10) = ?)`
  ).all(hoy, hoy) as Record<string, unknown>[];
  for (const r of reservasHoy) {
    const carro = `${r.marca} ${r.modelo}${r.placa ? ` (${r.placa})` : ''}`;
    if (String(r.fecha_inicio).slice(0, 10) === hoy) pendientes.push({ tipo: 'entrega', titulo: `Entrega ${carro}`, meta: String(r.cliente), solo_socios: 0 });
    if (String(r.fecha_fin).slice(0, 10) === hoy) pendientes.push({ tipo: 'devolucion', titulo: `Devolución ${carro}`, meta: String(r.cliente), solo_socios: 0 });
  }

  // Tareas abiertas (no hechas), filtradas por nivel
  const tareas = db.prepare(
    `SELECT titulo, rol_destino, asignado_nombre, vence, solo_socios FROM tareas_equipo
     WHERE estado != 'hecho' ${socio ? '' : 'AND solo_socios = 0'} ORDER BY orden, id DESC LIMIT 12`
  ).all() as Record<string, unknown>[];
  for (const t of tareas) pendientes.push({ tipo: 'tarea', titulo: String(t.titulo), meta: `${t.asignado_nombre || t.rol_destino || 'Equipo'}${t.vence ? ' · ' + t.vence : ''}`, solo_socios: Number(t.solo_socios || 0) });

  const stats = {
    vehiculos: flota.length,
    disponibles: flota.filter(f => f.estado_key === 'activo').length,
    en_uso: flota.filter(f => f.estado_key === 'ruta').length,
    pendientes: pendientes.length,
  };

  return NextResponse.json({ fecha: hoy, stats, flota, pendientes });
}
