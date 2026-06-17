import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const countOnly = searchParams.get('count') === '1';

  if (countOnly) {
    const row = db.prepare(
      'SELECT COUNT(*) as total FROM notificaciones WHERE destinatario_id = ? AND leida = 0'
    ).get(user.id) as { total: number | string } | undefined;
    return NextResponse.json({ total: Number(row?.total ?? 0) });
  }

  const notificaciones = await db.prepare(
    'SELECT * FROM notificaciones WHERE destinatario_id = ? ORDER BY created_at DESC LIMIT 50'
  ).all(user.id);

  return NextResponse.json({ notificaciones });
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const db = getDb();
  const body = await req.json().catch(() => ({})) as { ids?: number[] };
  const ids = body.ids ?? [];

  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    await db.prepare(
      `UPDATE notificaciones SET leida = 1 WHERE id IN (${placeholders}) AND destinatario_id = ?`
    ).run(...ids, user.id);
  } else {
    await db.prepare('UPDATE notificaciones SET leida = 1 WHERE destinatario_id = ?').run(user.id);
  }

  return NextResponse.json({ ok: true });
}
