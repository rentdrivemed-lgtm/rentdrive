import { NextRequest, NextResponse } from 'next/server';
import { guardArea } from '@/lib/guard';
import { registrarAuditoria } from '@/lib/permisos';

export const dynamic = 'force-dynamic';

const CATEGORIAS = ['', 'fijo', 'variable', 'servicio', 'producto', 'otro'] as const;

export async function GET() {
  const g = await guardArea('contabilidad');
  if ('error' in g) return g.error;
  const { db } = g;
  const proveedores = db.prepare(
    'SELECT id, nombre, nit, categoria_habitual, notas, created_at, updated_at FROM proveedores ORDER BY nombre COLLATE NOCASE'
  ).all();
  return NextResponse.json({ proveedores });
}

// Alta manual — el guardado automático (al registrar un gasto) pasa por
// upsertProveedor en lib/contabilidad.ts, no por aquí.
export async function POST(req: NextRequest) {
  const g = await guardArea('contabilidad');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const body = await req.json().catch(() => ({}));
  const nombre = typeof body.nombre === 'string' ? body.nombre.trim().slice(0, 200) : '';
  if (!nombre) return NextResponse.json({ error: 'Falta el nombre del proveedor' }, { status: 400 });
  const nit = typeof body.nit === 'string' ? body.nit.trim().slice(0, 60) : '';
  const categoriaHabitual = (CATEGORIAS as readonly string[]).includes(body.categoria_habitual) ? body.categoria_habitual : '';
  const notas = typeof body.notas === 'string' ? body.notas.trim().slice(0, 500) : '';

  const existe = db.prepare('SELECT id FROM proveedores WHERE nombre = ?').get(nombre);
  if (existe) return NextResponse.json({ error: 'Ya existe un proveedor con ese nombre' }, { status: 409 });

  const info = db.prepare(
    'INSERT INTO proveedores (nombre, nit, categoria_habitual, notas, created_by) VALUES (?, ?, ?, ?, ?)'
  ).run(nombre, nit, categoriaHabitual, notas, user.id);
  const id = Number(info.lastInsertRowid);

  registrarAuditoria(db, { ...user, nivel }, {
    area: 'contabilidad', accion: 'crear_proveedor', entidad: 'proveedor', entidad_id: id, detalle: nombre,
  });

  const row = db.prepare('SELECT * FROM proveedores WHERE id = ?').get(id);
  return NextResponse.json({ proveedor: row }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const g = await guardArea('contabilidad');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'ID inválido' }, { status: 400 });
  const existe = db.prepare('SELECT id FROM proveedores WHERE id = ?').get(id);
  if (!existe) return NextResponse.json({ error: 'Proveedor no encontrado' }, { status: 404 });

  const nombre = typeof body.nombre === 'string' ? body.nombre.trim().slice(0, 200) : '';
  if (!nombre) return NextResponse.json({ error: 'Falta el nombre del proveedor' }, { status: 400 });
  const nit = typeof body.nit === 'string' ? body.nit.trim().slice(0, 60) : '';
  const categoriaHabitual = (CATEGORIAS as readonly string[]).includes(body.categoria_habitual) ? body.categoria_habitual : '';
  const notas = typeof body.notas === 'string' ? body.notas.trim().slice(0, 500) : '';

  const duplicado = db.prepare('SELECT id FROM proveedores WHERE nombre = ? AND id != ?').get(nombre, id);
  if (duplicado) return NextResponse.json({ error: 'Ya existe otro proveedor con ese nombre' }, { status: 409 });

  db.prepare(
    "UPDATE proveedores SET nombre = ?, nit = ?, categoria_habitual = ?, notas = ?, updated_at = datetime('now','localtime') WHERE id = ?"
  ).run(nombre, nit, categoriaHabitual, notas, id);

  registrarAuditoria(db, { ...user, nivel }, {
    area: 'contabilidad', accion: 'editar_proveedor', entidad: 'proveedor', entidad_id: id, detalle: nombre,
  });

  const row = db.prepare('SELECT * FROM proveedores WHERE id = ?').get(id);
  return NextResponse.json({ proveedor: row });
}

export async function DELETE(req: NextRequest) {
  const g = await guardArea('contabilidad');
  if ('error' in g) return g.error;
  const { db, user, nivel } = g;

  const { searchParams } = new URL(req.url);
  const id = Number(searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'ID inválido' }, { status: 400 });

  const existe = db.prepare('SELECT nombre FROM proveedores WHERE id = ?').get(id) as { nombre: string } | undefined;
  const info = db.prepare('DELETE FROM proveedores WHERE id = ?').run(id);
  if (info.changes === 0) return NextResponse.json({ error: 'Proveedor no encontrado' }, { status: 404 });

  registrarAuditoria(db, { ...user, nivel }, {
    area: 'contabilidad', accion: 'eliminar_proveedor', entidad: 'proveedor', entidad_id: id, detalle: existe?.nombre || '',
  });
  // Nota: los gastos ya registrados guardan el nombre del proveedor como texto
  // (no una referencia), así que borrarlo del catálogo no afecta gastos existentes.
  return NextResponse.json({ ok: true });
}
