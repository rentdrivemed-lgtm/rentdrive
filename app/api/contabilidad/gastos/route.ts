import { NextRequest, NextResponse } from 'next/server';
import { guardArea } from '@/lib/guard';
import { registrarAuditoria } from '@/lib/permisos';

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

const CAMPOS = `id, categoria, proveedor, nit_proveedor, descripcion, numero_factura, fecha,
  subtotal, iva, total, metodo_pago, pagos, abonado, recurrente, comprobante_url, comprobante_pago_url,
  extraido_ia, notas, estado, anulado_en, motivo_anulacion, created_at`;

function sanitizarPagos(body: Record<string, unknown>) {
  const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };
  const pagosRaw: Array<{ metodo?: unknown; valor?: unknown }> = Array.isArray(body.pagos) ? body.pagos : [];
  const pagos = pagosRaw
    .map((p) => ({ metodo: typeof p?.metodo === 'string' ? p.metodo.slice(0, 30) : '', valor: num(p?.valor) }))
    .filter((p) => p.valor > 0)
    .slice(0, 20);
  const abonado = pagos.reduce((s, p) => s + p.valor, 0);
  return { pagos, abonado };
}

export async function GET(req: NextRequest) {
  const g = await guardArea('contabilidad');
  if ('error' in g) return g.error;
  const { db } = g;

  const { searchParams } = new URL(req.url);
  const desde = searchParams.get('desde') || '0000-01-01';
  const hasta = searchParams.get('hasta') || '9999-12-31';
  const categoria = searchParams.get('categoria') || '';
  const estado = searchParams.get('estado') === 'anulado' ? 'anulado' : 'activo';

  const filtros: string[] = ['fecha >= ?', 'fecha <= ?', 'estado = ?'];
  const params: unknown[] = [desde, hasta, estado];
  if (categoria && (CATEGORIAS as readonly string[]).includes(categoria)) {
    filtros.push('categoria = ?');
    params.push(categoria);
  }
  const where = `WHERE ${filtros.join(' AND ')}`;

  const rows = db.prepare(
    `SELECT ${CAMPOS} FROM gastos ${where} ORDER BY fecha DESC, id DESC`
  ).all(...params) as GastoRow[];
  const gastos = rows.map((row) => ({ ...row, pagos: parsePagos(row.pagos) }));

  const porCategoria = db.prepare(
    `SELECT categoria, COUNT(*) AS n, COALESCE(SUM(total), 0) AS total
     FROM gastos ${where} GROUP BY categoria`
  ).all(...params) as Array<{ categoria: string; n: number; total: number }>;

  const tot = db.prepare(
    `SELECT COALESCE(SUM(total), 0) AS total, COALESCE(SUM(abonado), 0) AS abonado FROM gastos ${where}`
  ).get(...params) as { total: number; abonado: number };

  const anuladosCount = (db.prepare(
    "SELECT COUNT(*) AS n FROM gastos WHERE estado = 'anulado'"
  ).get() as { n: number }).n;

  return NextResponse.json({
    gastos,
    por_categoria: porCategoria,
    total_general: tot.total,
    abonado_general: tot.abonado,
    pendiente_general: tot.total - tot.abonado,
    anulados_count: anuladosCount,
  });
}

export async function POST(req: NextRequest) {
  const g = await guardArea('contabilidad');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

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

  const { pagos, abonado } = sanitizarPagos(body);
  if (abonado > total + 1) {
    return NextResponse.json({ error: 'Los abonos por medio de pago no pueden superar el total del gasto.' }, { status: 400 });
  }
  const metodoPago = pagos.map((p) => p.metodo).filter(Boolean).join(', ') || str(body.metodo_pago);

  const info = db.prepare(
    `INSERT INTO gastos
      (categoria, proveedor, nit_proveedor, descripcion, numero_factura, fecha,
       subtotal, iva, total, metodo_pago, pagos, abonado, recurrente, comprobante_url, comprobante_pago_url,
       extraido_ia, notas, estado, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'activo', ?)`
  ).run(
    categoria, str(body.proveedor), str(body.nit_proveedor), str(body.descripcion), str(body.numero_factura), fecha,
    num(body.subtotal), num(body.iva), total, metodoPago, JSON.stringify(pagos), abonado,
    body.recurrente ? 1 : 0, str(body.comprobante_url), str(body.comprobante_pago_url),
    body.extraido_ia ? 1 : 0, str(body.notas), user.id,
  );
  const id = Number(info.lastInsertRowid);
  registrarAuditoria(db, { ...user, nivel }, {
    area: 'contabilidad', accion: 'crear_gasto', entidad: 'gasto', entidad_id: id,
    detalle: `${str(body.proveedor) || 'Gasto'} · ${categoria} · total $${total.toLocaleString('es-CO')}`,
  });

  const row = db.prepare(`SELECT ${CAMPOS} FROM gastos WHERE id = ?`).get(id) as GastoRow;
  return NextResponse.json({ gasto: { ...row, pagos: parsePagos(row.pagos) } }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const g = await guardArea('contabilidad');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'ID inválido' }, { status: 400 });

  const existe = db.prepare('SELECT id FROM gastos WHERE id = ?').get(id);
  if (!existe) return NextResponse.json({ error: 'Gasto no encontrado' }, { status: 404 });

  const categoria: Categoria = (CATEGORIAS as readonly string[]).includes(body.categoria) ? body.categoria : 'variable';
  const fecha = typeof body.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.fecha)
    ? body.fecha : new Date().toISOString().slice(0, 10);
  const total = Number(body.total);
  if (!Number.isFinite(total) || total <= 0) {
    return NextResponse.json({ error: 'El total del gasto debe ser un número mayor a 0.' }, { status: 400 });
  }
  const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };
  const str = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 300) : '');

  const { pagos, abonado } = sanitizarPagos(body);
  if (abonado > total + 1) {
    return NextResponse.json({ error: 'Los abonos por medio de pago no pueden superar el total del gasto.' }, { status: 400 });
  }
  const metodoPago = pagos.map((p) => p.metodo).filter(Boolean).join(', ') || str(body.metodo_pago);

  db.prepare(
    `UPDATE gastos SET categoria = ?, proveedor = ?, nit_proveedor = ?, descripcion = ?, numero_factura = ?, fecha = ?,
       subtotal = ?, iva = ?, total = ?, metodo_pago = ?, pagos = ?, abonado = ?, recurrente = ?,
       comprobante_url = ?, comprobante_pago_url = ?, notas = ?
     WHERE id = ?`
  ).run(
    categoria, str(body.proveedor), str(body.nit_proveedor), str(body.descripcion), str(body.numero_factura), fecha,
    num(body.subtotal), num(body.iva), total, metodoPago, JSON.stringify(pagos), abonado,
    body.recurrente ? 1 : 0, str(body.comprobante_url), str(body.comprobante_pago_url), str(body.notas), id,
  );
  registrarAuditoria(db, { ...user, nivel }, {
    area: 'contabilidad', accion: 'editar_gasto', entidad: 'gasto', entidad_id: id,
    detalle: `${str(body.proveedor) || 'Gasto'} · total $${total.toLocaleString('es-CO')}`,
  });

  const row = db.prepare(`SELECT ${CAMPOS} FROM gastos WHERE id = ?`).get(id) as GastoRow;
  return NextResponse.json({ gasto: { ...row, pagos: parsePagos(row.pagos) } });
}

// Anular (mover a "anulados") o restaurar un gasto — no lo borra.
export async function PATCH(req: NextRequest) {
  const g = await guardArea('contabilidad');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'ID inválido' }, { status: 400 });
  const accion = body.accion === 'restaurar' ? 'restaurar' : 'anular';
  const motivo = typeof body.motivo === 'string' ? body.motivo.trim().slice(0, 300) : '';

  const existe = db.prepare('SELECT proveedor, total FROM gastos WHERE id = ?').get(id) as { proveedor: string; total: number } | undefined;
  if (!existe) return NextResponse.json({ error: 'Gasto no encontrado' }, { status: 404 });

  if (accion === 'anular') {
    db.prepare("UPDATE gastos SET estado = 'anulado', anulado_en = datetime('now','localtime'), motivo_anulacion = ? WHERE id = ?")
      .run(motivo, id);
  } else {
    db.prepare("UPDATE gastos SET estado = 'activo', anulado_en = '', motivo_anulacion = '' WHERE id = ?").run(id);
  }
  registrarAuditoria(db, { ...user, nivel }, {
    area: 'contabilidad', accion: accion === 'anular' ? 'anular_gasto' : 'restaurar_gasto', entidad: 'gasto', entidad_id: id,
    detalle: `${existe.proveedor || 'Gasto'} · $${(existe.total || 0).toLocaleString('es-CO')}${motivo ? ` · motivo: ${motivo}` : ''}`,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const g = await guardArea('contabilidad');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const { searchParams } = new URL(req.url);
  const id = Number(searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'ID inválido' }, { status: 400 });

  const existe = db.prepare('SELECT proveedor, total FROM gastos WHERE id = ?').get(id) as { proveedor: string; total: number } | undefined;
  const info = db.prepare('DELETE FROM gastos WHERE id = ?').run(id);
  if (info.changes === 0) return NextResponse.json({ error: 'Gasto no encontrado' }, { status: 404 });
  registrarAuditoria(db, { ...user, nivel }, {
    area: 'contabilidad', accion: 'eliminar_gasto', entidad: 'gasto', entidad_id: id,
    detalle: `${existe?.proveedor || 'Gasto'} · $${(existe?.total || 0).toLocaleString('es-CO')} (eliminado definitivamente)`,
  });
  return NextResponse.json({ ok: true });
}
