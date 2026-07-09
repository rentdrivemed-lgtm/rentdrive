import { NextRequest, NextResponse } from 'next/server';
import { guardArea } from '@/lib/guard';

export const dynamic = 'force-dynamic';

// Bitácora: registro de acciones sensibles (quién, qué, cuándo).
export async function GET(req: NextRequest) {
  const g = await guardArea('auditoria');
  if ('error' in g) return g.error;
  const { db } = g;

  const { searchParams } = new URL(req.url);
  const area = searchParams.get('area') || '';
  const limit = Math.min(500, Math.max(1, Number(searchParams.get('limit')) || 200));

  const filtros: string[] = [];
  const params: unknown[] = [];
  if (area) { filtros.push('area = ?'); params.push(area); }
  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';

  const eventos = db.prepare(
    `SELECT id, usuario_id, usuario_nombre, usuario_correo, usuario_nivel, area, accion, detalle, entidad, entidad_id, created_at
     FROM auditoria ${where} ORDER BY id DESC LIMIT ?`
  ).all(...params, limit);

  const areas = db.prepare('SELECT DISTINCT area FROM auditoria ORDER BY area').all() as Array<{ area: string }>;

  return NextResponse.json({ eventos, areas: areas.map(a => a.area).filter(Boolean) });
}
