import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { uploadFile } from '@/lib/storage';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'No se recibió archivo' }, { status: 400 });

  const permitidos = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (!permitidos.includes(file.type)) {
    return NextResponse.json({ error: 'Solo JPG, PNG, WebP o PDF' }, { status: 400 });
  }
  if (file.size > 15 * 1024 * 1024) {
    return NextResponse.json({ error: 'Máximo 15 MB' }, { status: 400 });
  }

  const ext = file.type === 'application/pdf' ? 'pdf'
    : file.type === 'image/png' ? 'png'
    : file.type === 'image/webp' ? 'webp' : 'jpg';
  const nombre = `doc-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  try {
    const { url } = await uploadFile(nombre, file.type, await file.arrayBuffer());
    return NextResponse.json({ url, tipo: ext });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error al subir';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
