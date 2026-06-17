import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { uploadFile } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 8) return NextResponse.json({ error: 'Enlace inválido' }, { status: 404 });

  const db = getDb();
  const m = db.prepare('SELECT id FROM mensajeros WHERE token = ?').get(token);
  if (!m) return NextResponse.json({ error: 'Enlace inválido' }, { status: 404 });

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'No se recibió archivo' }, { status: 400 });

  const permitidos = ['image/jpeg', 'image/png', 'image/webp'];
  if (!permitidos.includes(file.type)) return NextResponse.json({ error: 'Solo JPG, PNG o WebP' }, { status: 400 });
  if (file.size > 12 * 1024 * 1024) return NextResponse.json({ error: 'Máximo 12 MB por imagen' }, { status: 400 });

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const nombre = `insp-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  try {
    const { url } = await uploadFile(nombre, file.type, await file.arrayBuffer());
    return NextResponse.json({ url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error al subir';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
