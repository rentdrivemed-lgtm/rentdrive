import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { uploadFile } from '@/lib/storage';
import { normalizarOrientacion } from '@/lib/blur-placas';

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
    const imagenTypes = ['image/jpeg', 'image/png', 'image/webp'];
    let buffer: Buffer = Buffer.from(await file.arrayBuffer());
    if (imagenTypes.includes(file.type)) {
      // Normaliza la orientación EXIF (fotos de celular) para que el
      // documento no quede "de lado" en la galería ni al mostrarlo. Si no
      // hay tag EXIF que corregir, se preservan los bytes originales sin
      // re-codificar (importante para que la verificación con IA de
      // `lib/verificacion-docs.ts` lea el documento con la máxima nitidez).
      buffer = await normalizarOrientacion(buffer, file.type as 'image/jpeg' | 'image/png' | 'image/webp');
    }
    const { url } = await uploadFile(nombre, file.type, buffer);
    return NextResponse.json({ url, tipo: ext });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error al subir';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
