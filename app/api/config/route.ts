import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { getConfig, setConfig } from '@/lib/operaciones';

export const dynamic = 'force-dynamic';

// Claves de configuración editables desde el panel admin.
const CLAVES = [
  'admin_whatsapp', 'pico_placa', 'comision_plataforma_pct', 'empresa_nombre', 'empresa_nit',
  'referido_habilitado', 'referido_recompensa_referrer', 'referido_recompensa_referido',
] as const;

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  const db = getDb();
  const config: Record<string, string> = {};
  for (const c of CLAVES) config[c] = getConfig(db, c);
  return NextResponse.json({ config });
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const db = getDb();
  for (const c of CLAVES) {
    if (typeof body[c] === 'string') setConfig(db, c, body[c].trim());
  }
  const config: Record<string, string> = {};
  for (const c of CLAVES) config[c] = getConfig(db, c);
  return NextResponse.json({ ok: true, config });
}
