import { NextRequest, NextResponse } from 'next/server';
import { guardArea } from '@/lib/guard';
import { renderizarTarjeta } from '@/lib/tarjetas';

export const dynamic = 'force-dynamic';

// Vista previa admin-only: sirve el HTML renderizado (con los audios ya
// resueltos a Cloudinary) sin importar el estado de la tarjeta, para que se
// pueda revisar antes de publicar.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await guardArea('nfc');
  if ('error' in g) return g.error;
  const { db } = g;
  const { id } = await params;
  const tarjeta = db.prepare('SELECT slug, audio_manifest FROM nfc_cards WHERE id = ?').get(Number(id)) as
    { slug: string; audio_manifest: string } | undefined;
  if (!tarjeta) return NextResponse.json({ error: 'Tarjeta no encontrada' }, { status: 404 });

  try {
    const html = await renderizarTarjeta(tarjeta.slug, tarjeta.audio_manifest);
    return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'No se pudo cargar el HTML de la tarjeta' }, { status: 500 });
  }
}
