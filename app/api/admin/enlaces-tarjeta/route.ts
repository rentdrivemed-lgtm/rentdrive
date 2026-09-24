import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { adminTieneArea, sinPermisoArea } from '@/lib/guard';
import { appBaseUrl } from '@/lib/operaciones';

export const dynamic = 'force-dynamic';

const VIGENCIA_HORAS = 48;

/**
 * Genera un enlace de un solo uso para que un cliente guarde su tarjeta SIN
 * cobrarle nada (típico caso: llegó presencial al punto de atención). El admin
 * copia el link resultante y lo manda por su cuenta (WhatsApp, SMS, etc.) —
 * este endpoint no envía nada, solo lo crea.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.rol !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  if (!adminTieneArea(getDb(), user.id, 'usuarios')) return sinPermisoArea();

  const { usuario_id } = await req.json();
  if (!usuario_id) return NextResponse.json({ error: 'Falta el cliente' }, { status: 400 });

  const db = getDb();
  const cliente = db.prepare("SELECT id, nombre, rol FROM usuarios WHERE id = ?").get(Number(usuario_id)) as { id: number; nombre: string; rol: string } | undefined;
  if (!cliente) return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 });
  if (cliente.rol !== 'usuario') return NextResponse.json({ error: 'Solo se le puede guardar tarjeta a un arrendatario (rol usuario).' }, { status: 400 });

  const token = randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + VIGENCIA_HORAS * 3600_000).toISOString();
  db.prepare(`
    INSERT INTO enlaces_tarjeta (token, usuario_id, creado_por, expira_at)
    VALUES (?, ?, ?, ?)
  `).run(token, cliente.id, user.id, expira);

  const base = appBaseUrl() || 'http://localhost:3100';
  return NextResponse.json({ link: `${base}/guardar-tarjeta/${token}`, expira_at: expira });
}
