import { NextRequest, NextResponse } from 'next/server';
import { guardArea } from '@/lib/guard';

export const dynamic = 'force-dynamic';

type Competidor = {
  id: number; nombre: string; url: string; activo: number;
  ajuste_pct: number; auto_actualizar: number; ultimo_check: string | null; created_at: string;
};
type PrecioRow = {
  competidor_id: number; sedan: number | null; suv: number | null;
  compacto: number | null; pickup: number | null;
  encontrado: number; nota: string; fecha: string;
};

// GET — lista competidores + sus últimos precios
export async function GET() {
  const g = await guardArea('mercado');
  if ('error' in g) return g.error;
  const { db } = g;
  const competidores = db.prepare('SELECT * FROM competidores ORDER BY nombre').all() as Competidor[];

  const conPrecios = competidores.map(c => {
    const ultimo = db.prepare(
      'SELECT * FROM precios_mercado WHERE competidor_id = ? ORDER BY fecha DESC LIMIT 1'
    ).get(c.id) as PrecioRow | undefined;
    return { ...c, ultimo_precio: ultimo ?? null };
  });

  return NextResponse.json({ competidores: conPrecios });
}

// POST — agregar competidor
export async function POST(req: NextRequest) {
  const g = await guardArea('mercado');
  if ('error' in g) return g.error;
  const { db } = g;

  const { nombre, url, ajuste_pct = -5, auto_actualizar = 0 } = await req.json() as {
    nombre?: string; url?: string; ajuste_pct?: number; auto_actualizar?: number;
  };
  if (!nombre || !url) return NextResponse.json({ error: 'Nombre y URL son obligatorios' }, { status: 400 });

  const res = db.prepare(
    'INSERT INTO competidores (nombre, url, ajuste_pct, auto_actualizar) VALUES (?, ?, ?, ?)'
  ).run(nombre, url, ajuste_pct, auto_actualizar ? 1 : 0);

  return NextResponse.json({ id: res.lastInsertRowid }, { status: 201 });
}

// PUT — editar o activar/desactivar competidor
export async function PUT(req: NextRequest) {
  const g = await guardArea('mercado');
  if ('error' in g) return g.error;
  const { db } = g;

  const body = await req.json() as { id: number; nombre?: string; url?: string; activo?: number; ajuste_pct?: number; auto_actualizar?: number };
  const { id, ...campos } = body;
  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 });

  const allowed = ['nombre', 'url', 'activo', 'ajuste_pct', 'auto_actualizar'] as const;
  const sets = allowed.filter(k => campos[k] !== undefined).map(k => `${k} = ?`);
  const values = allowed.filter(k => campos[k] !== undefined).map(k => campos[k]);

  if (sets.length === 0) return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 });

  db.prepare(`UPDATE competidores SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
  return NextResponse.json({ ok: true });
}

// DELETE — eliminar competidor
export async function DELETE(req: NextRequest) {
  const g = await guardArea('mercado');
  if ('error' in g) return g.error;
  const { db } = g;

  const { id } = await req.json() as { id: number };
  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 });

  db.prepare('DELETE FROM precios_mercado WHERE competidor_id = ?').run(id);
  db.prepare('DELETE FROM competidores WHERE id = ?').run(id);
  return NextResponse.json({ ok: true });
}
