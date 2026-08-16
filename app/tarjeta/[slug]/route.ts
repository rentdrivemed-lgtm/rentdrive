import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { renderizarTarjeta } from '@/lib/tarjetas';

// Ruta pública para las tarjetas de presentación virtual (NFC). Sirve el HTML
// del creador tal cual fue diseñado — este NO es un page.tsx a propósito: un
// page.tsx quedaría envuelto por el layout raíz (fuentes, Navbar, PWA) y
// podría chocar con los estilos autocontenidos de la tarjeta. Un Route
// Handler devuelve los bytes crudos, sin pasar por React. Esta es la URL
// corta y estable que se programa en el tag NFC físico.
export const dynamic = 'force-dynamic';

type Tarjeta = { id: number; slug: string; estado: string; audio_manifest: string };

function paginaNoDisponible(): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Tarjeta no disponible — DrivePass</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { height:100%; }
  body {
    display:flex; align-items:center; justify-content:center; text-align:center;
    background:#0A1422; color:#F5F1E8; font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;
    padding:24px;
  }
  .card { max-width:360px; }
  .mark { font-size:40px; margin-bottom:16px; }
  h1 { font-size:18px; margin-bottom:8px; }
  p { font-size:14px; color:#A9A6A0; line-height:1.5; }
</style>
</head>
<body>
  <div class="card">
    <div class="mark">🔒</div>
    <h1>Esta tarjeta no está disponible</h1>
    <p>Si crees que esto es un error, contacta a DrivePass.</p>
  </div>
</body>
</html>`;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = getDb();
  const tarjeta = db.prepare('SELECT id, slug, estado, audio_manifest FROM nfc_cards WHERE slug = ?').get(slug) as Tarjeta | undefined;

  if (!tarjeta || tarjeta.estado !== 'activa') {
    return new NextResponse(paginaNoDisponible(), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  let html: string;
  try {
    html = await renderizarTarjeta(tarjeta.slug, tarjeta.audio_manifest);
  } catch {
    return new NextResponse(paginaNoDisponible(), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  try {
    db.prepare('UPDATE nfc_cards SET visitas = visitas + 1 WHERE id = ?').run(tarjeta.id);
  } catch { /* no bloquea la carga de la tarjeta */ }

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
