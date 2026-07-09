import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const CATEGORIAS = ['fijo', 'variable', 'servicio', 'producto', 'otro'] as const;
type Categoria = (typeof CATEGORIAS)[number];

type GastoRow = { pagos?: string | null; [k: string]: unknown };

function parsePagos(raw: unknown): Array<{ metodo: string; valor: number }> {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const a = JSON.parse(raw);
    if (!Array.isArray(a)) return [];
    return a
      .map((p) => ({ metodo: typeof p?.metodo === 'string' ? p.metodo : '', valor: Number(p?.valor) || 0 }))
      .filter((p) => p.valor > 0);
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const desde = searchParams.get('desde') || '0000-01-01';
  const hasta = searchParams.get('hasta') || '9999-12-31';
  const categoria = searchParams.get('categoria') || '';

  const filtros: string[] = ['fecha >= ?', 'fecha <= ?'];
  const params: unknown[] = [desde, hasta];
  if (categoria && (CATEGORIAS as readonly string[]).includes(categoria)) {
    filtros.push('categoria = ?');
    params.push(categoria);
  }
  const where = `WHERE ${filtros.join(' AND ')}`;

  const rows = db.prepare(
    `SELECT id, categoria, proveedor, nit_proveedor, descripcion, numero_factura, fecha,
            subtotal, iva, total, metodo_pago, pagos, abonado, recurrente, comprobante_url, extraido_ia, notas, created_at
     FROM gastos ${where} ORDER BY fecha DESC, id DESC`
  ).all(...params) as GastoRow[];
  const gastos = rows.map((g) => ({ ...g, pagos: parsePagos(g.pagos) }));

  const porCategoria = db.prepare(
    `SELECT categoria, COUNT(*) AS n, COALESCE(SUM(total), 0) AS total
     FROM gastos ${where} GROUP BY categoria`
  ).all(...params) as Array<{ categoria: string; n: number; total: number }>;

  const tot = db.prepare(
    `SELECT COALESCE(SUM(total), 0) AS total, COALESCE(SUM(abonado), 0) AS abonado FROM gastos ${where}`
  ).get(...params) as { total: number; abonado: number };

  return NextResponse.json({
    gastos,
    por_categoria: porCategoria,
    total_general: tot.total,
    abonado_general: tot.abonado,
    pendiente_general: tot.total - tot.abonado,
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const categoria: Categoria = (CATEGORIAS as readonly string[]).includes(body.categoria) ? body.categoria : 'variable';
  const fecha = typeof body.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.fecha)
    ? body.fecha : new Date().toISOString().slice(0, 10);
  const total = Number(body.total);
  if (!Number.isFinite(total) || total <= 0) {
    return NextResponse.json({ error: 'El total del gasto debe ser un número mayor a 0.' }, { status: 400 });
  }
  const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };
  const str = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 300) : '');

  // Pago mixto: cada línea {metodo, valor}. abonado = suma de valores.
  const pagosRaw: Array<{ metodo?: unknown; valor?: unknown }> = Array.isArray(body.pagos) ? body.pagos : [];
  const pagos = pagosRaw
    .map((p) => ({ metodo: typeof p?.metodo === 'string' ? p.metodo.slice(0, 30) : '', valor: num(p?.valor) }))
    .filter((p) => p.valor > 0)
    .slice(0, 20);
  const abonado = pagos.reduce((s, p) => s + p.valor, 0);
  if (abonado > total + 1) {
    return NextResponse.json({ error: 'Los abonos por medio de pago no pueden superar el total del gasto.' }, { status: 400 });
  }
  const metodoPago = pagos.map((p) => p.metodo).filter(Boolean).join(', ') || str(body.metodo_pago);

  const db = getDb();
  const info = db.prepare(
    `INSERT INTO gastos
      (categoria, proveedor, nit_proveedor, descripcion, numero_factura, fecha,
       subtotal, iva, total, metodo_pago, pagos, abonado, recurrente, comprobante_url, extraido_ia, notas, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    categoria,
    str(body.proveedor),
    str(body.nit_proveedor),
    str(body.descripcion),
    str(body.numero_factura),
    fecha,
    num(body.subtotal),
    num(body.iva),
    total,
    metodoPago,
    JSON.stringify(pagos),
    abonado,
    body.recurrente ? 1 : 0,
    str(body.comprobante_url),
    body.extraido_ia ? 1 : 0,
    str(body.notas),
    user.id,
  );

  const row = db.prepare('SELECT * FROM gastos WHERE id = ?').get(info.lastInsertRowid) as GastoRow;
  const gasto = { ...row, pagos: parsePagos(row.pagos) };
  return NextResponse.json({ gasto }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const id = Number(searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'ID inválido' }, { status: 400 });

  const db = getDb();
  const info = db.prepare('DELETE FROM gastos WHERE id = ?').run(id);
  if (info.changes === 0) return NextResponse.json({ error: 'Gasto no encontrado' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
