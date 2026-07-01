import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

type PagoRow = {
  reserva_id: number;
  fecha_inicio: string; fecha_fin: string;
  total: number; recargo: number; pago_estado: string; estado: string;
  created_at: string;
  marca: string; modelo: string; anio: number;
  propietario_id: number; propietario_nombre: string; propietario_correo: string;
  banco: string; numero_cuenta: string;
  usuario_nombre: string;
};

// GET /api/pagos — solo admin; lista reservas con pago pendiente o historial
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const soloEstado = searchParams.get('pago_estado') || 'pendiente';

  const db = getDb();
  const pagos = db.prepare(`
    SELECT
      r.id  AS reserva_id,
      r.fecha_inicio, r.fecha_fin, r.total, r.recargo,
      r.pago_estado, r.estado, r.created_at,
      v.marca, v.modelo, v.anio,
      p.id   AS propietario_id,
      p.nombre  AS propietario_nombre,
      p.correo  AS propietario_correo,
      COALESCE(p.banco, '')         AS banco,
      COALESCE(p.numero_cuenta, '') AS numero_cuenta,
      u.nombre  AS usuario_nombre
    FROM reservas r
    JOIN vehiculos v ON r.vehiculo_id = v.id
    JOIN usuarios  p ON v.propietario_id = p.id
    JOIN usuarios  u ON r.usuario_id     = u.id
    WHERE r.pago_estado = ? AND r.estado != 'cancelada'
    ORDER BY r.fecha_fin DESC
  `).all(soloEstado) as PagoRow[];

  // Agrupar por propietario para mostrar total por dueño
  const porPropietario: Record<number, {
    propietario_id: number; propietario_nombre: string; propietario_correo: string;
    banco: string; numero_cuenta: string;
    total_pendiente: number; reservas: PagoRow[];
  }> = {};

  for (const p of pagos) {
    if (!porPropietario[p.propietario_id]) {
      porPropietario[p.propietario_id] = {
        propietario_id: p.propietario_id,
        propietario_nombre: p.propietario_nombre,
        propietario_correo: p.propietario_correo,
        banco: p.banco,
        numero_cuenta: p.numero_cuenta,
        total_pendiente: 0,
        reservas: [],
      };
    }
    porPropietario[p.propietario_id].total_pendiente += p.total;
    porPropietario[p.propietario_id].reservas.push(p);
  }

  return NextResponse.json({
    pagos,
    por_propietario: Object.values(porPropietario),
    total_general: pagos.reduce((s, p) => s + p.total, 0),
  });
}

// PUT /api/pagos — admin marca uno o varios pagos como realizados
export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const body = await req.json() as { reserva_ids?: number[]; reserva_id?: number; comprobante?: string };
  const ids: number[] = body.reserva_ids || (body.reserva_id ? [body.reserva_id] : []);
  if (ids.length === 0) {
    return NextResponse.json({ error: 'Se requiere al menos un reserva_id' }, { status: 400 });
  }

  const db = getDb();

  // Agrupar por propietario para enviar una notificación por dueño
  type ResProp = { reserva_id: number; propietario_id: number; total: number; marca: string; modelo: string; fecha_inicio: string; fecha_fin: string };
  const rows = db.prepare(`
    SELECT r.id AS reserva_id, v.propietario_id, r.total, v.marca, v.modelo, r.fecha_inicio, r.fecha_fin
    FROM reservas r JOIN vehiculos v ON r.vehiculo_id = v.id
    WHERE r.id IN (${ids.map(() => '?').join(',')})
  `).all(...ids) as ResProp[];

  // Actualizar pago_estado
  db.prepare(`UPDATE reservas SET pago_estado = 'pagado' WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);

  // Notificar a cada propietario afectado
  const comprobante = body.comprobante ? ` Comprobante: ${body.comprobante}.` : '';
  const propGrupos: Record<number, ResProp[]> = {};
  for (const r of rows) {
    if (!propGrupos[r.propietario_id]) propGrupos[r.propietario_id] = [];
    propGrupos[r.propietario_id].push(r);
  }

  const insNotif = db.prepare(
    'INSERT INTO notificaciones (destinatario_id, tipo, titulo, mensaje, referencia_id, referencia_tipo) VALUES (?, ?, ?, ?, ?, ?)'
  );

  for (const [pidStr, reservasDeProp] of Object.entries(propGrupos)) {
    const pid = Number(pidStr);
    const totalPagado = reservasDeProp.reduce((s, r) => s + r.total, 0);
    const n = reservasDeProp.length;
    const titulo = n === 1
      ? `💰 Pago recibido: ${reservasDeProp[0].marca} ${reservasDeProp[0].modelo}`
      : `💰 ${n} pagos realizados`;
    const mensaje = n === 1
      ? `DrivePass transfirió $${totalPagado.toLocaleString('es-CO')} por el alquiler del ${reservasDeProp[0].fecha_inicio} al ${reservasDeProp[0].fecha_fin}.${comprobante}`
      : `DrivePass transfirió $${totalPagado.toLocaleString('es-CO')} por ${n} alquileres completados.${comprobante}`;

    insNotif.run(pid, 'pago_realizado', titulo, mensaje, reservasDeProp[0].reserva_id, 'reserva');
  }

  return NextResponse.json({ ok: true, actualizados: ids.length });
}
