import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { uploadFile } from '@/lib/storage';
import { detectarYDifuminarPlaca, normalizarOrientacion } from '@/lib/blur-placas';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  const blurPlaca = formData.get('blurPlaca') === '1';

  if (!file) return NextResponse.json({ error: 'No se recibió archivo' }, { status: 400 });

  const imagenTypes = ['image/jpeg', 'image/png', 'image/webp'];
  const docTypes    = ['application/pdf'];
  const permitidos  = [...imagenTypes, ...docTypes];

  if (!permitidos.includes(file.type)) {
    return NextResponse.json({ error: 'Solo JPG, PNG, WebP o PDF' }, { status: 400 });
  }
  if (file.size > 8 * 1024 * 1024) {
    return NextResponse.json({ error: 'Máximo 8 MB por archivo' }, { status: 400 });
  }

  const ext = file.type === 'image/png' ? 'png'
    : file.type === 'image/webp' ? 'webp'
    : file.type === 'application/pdf' ? 'pdf'
    : 'jpg';
  const nombre = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  try {
    const arrayBuf = await file.arrayBuffer();
    let rawBuffer: Buffer = Buffer.allocUnsafe(arrayBuf.byteLength);
    Buffer.from(arrayBuf).copy(rawBuffer);
    let difuminada = false;

    if (imagenTypes.includes(file.type)) {
      if (blurPlaca) {
        // Difuminar placa si la foto es de un vehículo y la API key está disponible.
        // detectarYDifuminarPlaca ya normaliza la orientación EXIF internamente.
        const mediaType = file.type as 'image/jpeg' | 'image/png' | 'image/webp';
        const resultado = await detectarYDifuminarPlaca(rawBuffer, mediaType);
        rawBuffer   = resultado.buffer;
        difuminada  = resultado.difuminada;
      } else {
        // Aunque no se pida difuminar placa, normalizamos la orientación EXIF
        // para que la foto no quede "de lado" en la galería (fotos de celular).
        rawBuffer = await normalizarOrientacion(rawBuffer, file.type as 'image/jpeg' | 'image/png' | 'image/webp');
      }
    }

    const { url } = await uploadFile(nombre, file.type, rawBuffer);
    return NextResponse.json({ url, difuminada });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error al subir';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
