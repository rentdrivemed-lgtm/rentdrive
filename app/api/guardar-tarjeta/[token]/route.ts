import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { obtenerTokensAceptacion, crearFuentePago, marcaPorBin } from '@/lib/pagos';

export const dynamic = 'force-dynamic';

type EnlaceRow = {
  id: number; usuario_id: number; usado: number; expira_at: string;
};

function cargarEnlaceValido(db: ReturnType<typeof getDb>, token: string): EnlaceRow | null {
  const fila = db.prepare('SELECT id, usuario_id, usado, expira_at FROM enlaces_tarjeta WHERE token = ?').get(token) as EnlaceRow | undefined;
  if (!fila) return null;
  if (fila.usado) return null;
  if (new Date(fila.expira_at).getTime() < Date.now()) return null;
  return fila;
}

/** El cliente abre el link: solo confirma que sirve y a nombre de quién es, sin exponer nada sensible. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = getDb();
  const enlace = cargarEnlaceValido(db, token);
  if (!enlace) return NextResponse.json({ error: 'Este enlace ya no es válido. Pide uno nuevo.' }, { status: 410 });

  const cliente = db.prepare('SELECT nombre FROM usuarios WHERE id = ?').get(enlace.usuario_id) as { nombre: string } | undefined;
  return NextResponse.json({ nombre: cliente?.nombre || '' });
}

/** El cliente ya tokenizó su tarjeta en el widget de Wompi: la guardamos SIN cobrar nada. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = getDb();
  const enlace = cargarEnlaceValido(db, token);
  if (!enlace) return NextResponse.json({ error: 'Este enlace ya no es válido. Pide uno nuevo.' }, { status: 410 });

  const { card_token } = await req.json();
  if (!card_token) return NextResponse.json({ error: 'Falta el token de la tarjeta.' }, { status: 400 });

  const cliente = db.prepare('SELECT correo FROM usuarios WHERE id = ?').get(enlace.usuario_id) as { correo: string } | undefined;
  if (!cliente) return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 });

  try {
    const { acceptanceToken, personalAuthToken } = await obtenerTokensAceptacion();
    const fuente = await crearFuentePago({
      token: card_token, correo: cliente.correo, acceptanceToken, personalAuthToken,
    });

    db.prepare(`
      INSERT INTO fuentes_pago (usuario_id, wompi_fuente_id, marca, ultimos4)
      VALUES (?, ?, ?, ?)
    `).run(enlace.usuario_id, fuente.id, marcaPorBin(fuente.bin), fuente.ultimos4);

    // De un solo uso: el mismo link no vuelve a servir aunque alguien lo reabra.
    db.prepare('UPDATE enlaces_tarjeta SET usado = 1 WHERE id = ?').run(enlace.id);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[pagos] No se pudo guardar la tarjeta desde el enlace:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'No se pudo guardar la tarjeta. Intenta de nuevo.' }, { status: 502 });
  }
}
