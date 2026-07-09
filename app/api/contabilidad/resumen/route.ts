import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { comisionPlataforma } from '@/lib/contabilidad';
import { dataicoHabilitado } from '@/lib/dataico';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const desde = searchParams.get('desde') || '0000-01-01';
  const hasta = searchParams.get('hasta') || '9999-12-31';

  const reservasPeriodo = db.prepare(`
    SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS bruto
    FROM reservas WHERE estado != 'cancelada' AND fecha_inicio >= ? AND fecha_inicio <= ?
  `).get(desde, hasta) as { n: number; bruto: number };

  const liquidaciones = db.prepare(`
    SELECT l.estado, COALESCE(SUM(l.neto), 0) AS neto, COALESCE(SUM(l.comision_valor), 0) AS comision, COUNT(*) AS n
    FROM liquidaciones l JOIN reservas r ON l.reserva_id = r.id
    WHERE r.fecha_inicio >= ? AND r.fecha_inicio <= ?
    GROUP BY l.estado
  `).all(desde, hasta) as Array<{ estado: string; neto: number; comision: number; n: number }>;

  const pagadoPropietarios = liquidaciones.find(l => l.estado === 'pagado')?.neto || 0;
  const pendientePropietarios = liquidaciones.find(l => l.estado === 'pendiente')?.neto || 0;
  const comisionTotal = liquidaciones.reduce((s, l) => s + l.comision, 0);

  const facturas = db.prepare(`
    SELECT f.estado AS estado, COUNT(*) AS n, COALESCE(SUM(f.total), 0) AS total
    FROM facturas f JOIN reservas r ON f.reserva_id = r.id
    WHERE r.fecha_inicio >= ? AND r.fecha_inicio <= ?
    GROUP BY f.estado
  `).all(desde, hasta) as Array<{ estado: string; n: number; total: number }>;

  const cotizaciones = db.prepare(`
    SELECT c.estado AS estado, COUNT(*) AS n FROM cotizaciones c JOIN reservas r ON c.reserva_id = r.id
    WHERE r.fecha_inicio >= ? AND r.fecha_inicio <= ? GROUP BY c.estado
  `).all(desde, hasta) as Array<{ estado: string; n: number }>;

  const gastos = db.prepare(`
    SELECT categoria, COUNT(*) AS n, COALESCE(SUM(total), 0) AS total
    FROM gastos WHERE fecha >= ? AND fecha <= ? GROUP BY categoria
  `).all(desde, hasta) as Array<{ categoria: string; n: number; total: number }>;
  const gastosTotal = gastos.reduce((s, g) => s + g.total, 0);

  return NextResponse.json({
    periodo: { desde, hasta },
    reservas: reservasPeriodo,
    comision_pct_actual: comisionPlataforma(db),
    comision_total: comisionTotal,
    pagado_propietarios: pagadoPropietarios,
    pendiente_propietarios: pendientePropietarios,
    gastos,
    gastos_total: gastosTotal,
    utilidad_estimada: comisionTotal - gastosTotal,
    facturas,
    cotizaciones,
    dataico_activo: dataicoHabilitado(),
  });
}
