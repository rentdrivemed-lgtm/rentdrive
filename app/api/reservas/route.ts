import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { calcularRecargo, lugarValido, type Lugar } from '@/lib/lugares';

export const dynamic = 'force-dynamic';

type ReservaRow = {
  id: number; vehiculo_id: number; usuario_id: number;
  marca: string; modelo: string; anio: number; tipo: string; precio_dia: number;
  propietario_id: number; usuario_nombre: string; usuario_correo: string;
  propietario_nombre: string; fecha_inicio: string; fecha_fin: string;
  total: number; estado: string; pago_estado: string;
};

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const vehiculoId   = searchParams.get('vehiculoId');
  const estado       = searchParams.get('estado');
  const pagoEstado   = searchParams.get('pagoEstado');
  const fechaDesde   = searchParams.get('fechaDesde');
  const fechaHasta   = searchParams.get('fechaHasta');
  const busqueda     = searchParams.get('busqueda');

  let query = `
    SELECT r.*,
      v.marca, v.modelo, v.anio, v.tipo, v.precio_dia,
      v.propietario_id,
      u.nombre  AS usuario_nombre,
      u.correo  AS usuario_correo,
      p.nombre  AS propietario_nombre
    FROM reservas r
    JOIN vehiculos v ON r.vehiculo_id = v.id
    JOIN usuarios  u ON r.usuario_id  = u.id
    JOIN usuarios  p ON v.propietario_id = p.id
    WHERE 1=1
  `;
  const params: unknown[] = [];

  if (user.rol === 'usuario') {
    query += ' AND r.usuario_id = ?';
    params.push(user.id);
  } else if (user.rol === 'propietario') {
    query += ' AND v.propietario_id = ?';
    params.push(user.id);
  }

  if (vehiculoId)  { query += ' AND r.vehiculo_id = ?';         params.push(Number(vehiculoId)); }
  if (estado)      { query += ' AND r.estado = ?';              params.push(estado); }
  if (pagoEstado)  { query += ' AND r.pago_estado = ?';         params.push(pagoEstado); }
  if (fechaDesde)  { query += ' AND r.fecha_inicio >= ?';       params.push(fechaDesde); }
  if (fechaHasta)  { query += ' AND r.fecha_fin   <= ?';        params.push(fechaHasta); }
  if (busqueda) {
    query += ' AND (v.marca LIKE ? OR v.modelo LIKE ? OR u.nombre LIKE ?)';
    const like = `%${busqueda}%`;
    params.push(like, like, like);
  }

  query += ' ORDER BY r.fecha_inicio DESC';

  const reservas = db.prepare(query).all(...params) as ReservaRow[];

  const stats = {
    total:       reservas.length,
    ingresos:    reservas
                   .filter(r => r.estado !== 'cancelada')
                   .reduce((s, r) => s + Number(r.total), 0),
    confirmadas: reservas.filter(r => r.estado === 'confirmada').length,
    completadas: reservas.filter(r => r.estado === 'completada').length,
    canceladas:  reservas.filter(r => r.estado === 'cancelada').length,
  };

  return NextResponse.json({ reservas, stats });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'usuario') {
    return NextResponse.json({ error: 'Solo usuarios pueden reservar' }, { status: 403 });
  }

  const { vehiculo_id, fecha_inicio, fecha_fin, documento_id_url, licencia_url, firma_contrato, recogida, entrega } = await req.json();
  if (!vehiculo_id || !fecha_inicio || !fecha_fin) {
    return NextResponse.json({ error: 'Faltan datos' }, { status: 400 });
  }
  if (!documento_id_url) return NextResponse.json({ error: 'Debes subir tu documento de identidad.' }, { status: 400 });
  if (!licencia_url) return NextResponse.json({ error: 'Debes subir tu licencia de conducción.' }, { status: 400 });
  if (!firma_contrato) return NextResponse.json({ error: 'Debes aceptar el contrato.' }, { status: 400 });

  const recogidaL = recogida as Lugar | undefined;
  const entregaL  = entrega  as Lugar | undefined;
  if (!lugarValido(recogidaL)) return NextResponse.json({ error: 'Indica el lugar y la hora de recogida.' }, { status: 400 });
  if (!lugarValido(entregaL))  return NextResponse.json({ error: 'Indica el lugar y la hora de entrega.' }, { status: 400 });

  const db = getDb();
  const vehiculo = db.prepare('SELECT * FROM vehiculos WHERE id = ? AND disponible = 1').get(Number(vehiculo_id)) as Record<string, unknown> | undefined;
  if (!vehiculo) return NextResponse.json({ error: 'Vehículo no disponible' }, { status: 400 });

  const conflicto = db.prepare(`
    SELECT id FROM reservas
    WHERE vehiculo_id = ? AND estado NOT IN ('cancelada')
    AND NOT (fecha_fin < ? OR fecha_inicio > ?)
  `).get(Number(vehiculo_id), fecha_inicio, fecha_fin);
  if (conflicto) return NextResponse.json({ error: 'Vehículo no disponible en esas fechas' }, { status: 409 });

  const dispStr = (vehiculo.dias_disponibles as string) || '[]';
  let diasDisp: string[] = [];
  try { diasDisp = JSON.parse(dispStr); } catch { diasDisp = []; }

  if (diasDisp.length > 0) {
    const dispSet = new Set(diasDisp);
    const cur = new Date(fecha_inicio);
    const fin = new Date(fecha_fin);
    while (cur < fin) {
      const str = cur.toISOString().split('T')[0];
      if (!dispSet.has(str)) {
        return NextResponse.json({ error: `El día ${str} no está disponible` }, { status: 409 });
      }
      cur.setDate(cur.getDate() + 1);
    }
  }

  const dias = Math.ceil((new Date(fecha_fin).getTime() - new Date(fecha_inicio).getTime()) / (1000 * 60 * 60 * 24));
  const recargo = calcularRecargo(recogidaL, entregaL); // autoritativo: server-side
  const total = dias * Number(vehiculo.precio_dia) + recargo;

  const result = db.prepare(`
    INSERT INTO reservas (usuario_id, vehiculo_id, fecha_inicio, fecha_fin, total, pago_estado, estado, documento_id_url, licencia_url, firma_contrato, recogida, entrega, recargo)
    VALUES (?, ?, ?, ?, ?, 'pendiente', 'pendiente', ?, ?, ?, ?, ?, ?)
  `).run(
    user.id, Number(vehiculo_id), fecha_inicio, fecha_fin, total,
    documento_id_url || '', licencia_url || '', firma_contrato || '{}',
    JSON.stringify(recogidaL), JSON.stringify(entregaL), recargo,
  );

  return NextResponse.json({ id: result.lastInsertRowid, total, recargo }, { status: 201 });
}
