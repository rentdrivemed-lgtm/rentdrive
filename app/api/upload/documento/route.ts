import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { uploadFile } from '@/lib/storage';
import { normalizarOrientacion } from '@/lib/blur-placas';
import { tipoRealDocumento, tipoRealImagen } from '@/lib/subida-imagen';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'No se recibió archivo' }, { status: 400 });

  // Marcado por el cliente (components/DocUpload.tsx, prop `soloImagen`) para
  // documentos que NUNCA son un PDF: cédula/pasaporte y licencia de conducción.
  // El `accept` del input ya restringe esto en el navegador, pero eso es
  // cosmético — no impide nada si se le pega directo al endpoint (curl, DevTools,
  // un archivo renombrado). Por eso se refuerza acá, del lado del servidor, con
  // el tipo MIME REAL (bytes mágicos vía `tipoRealImagen`, no el `file.type` que
  // declara el cliente y se falsifica trivialmente).
  const soloImagen = String(formData.get('soloImagen') || '') === 'true';

  const permitidos = soloImagen
    ? ['image/jpeg', 'image/png', 'image/webp']
    : ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (!permitidos.includes(file.type)) {
    return NextResponse.json(
      { error: soloImagen ? 'Solo se aceptan fotos en JPG, PNG o WebP para este documento.' : 'Solo JPG, PNG, WebP o PDF' },
      { status: 400 },
    );
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
      // Reforzado por bytes mágicos (no el Content-Type declarado): si esto es
      // un documento `soloImagen` (cédula/licencia) pero los bytes reales no son
      // ninguno de los 3 formatos de imagen soportados (p. ej. un PDF renombrado
      // a .jpg con Content-Type falsificado), se rechaza acá — antes de subir
      // nada a Cloudinary o de normalizar orientación sobre datos que no son
      // realmente una imagen.
      if (soloImagen && !tipoRealImagen(buffer)) {
        return NextResponse.json({ error: 'Solo se aceptan fotos en JPG, PNG o WebP para este documento.' }, { status: 400 });
      }
      // Normaliza la orientación EXIF (fotos de celular) para que el
      // documento no quede "de lado" en la galería ni al mostrarlo. Si no
      // hay tag EXIF que corregir, se preservan los bytes originales sin
      // re-codificar (importante para que la verificación con IA de
      // `lib/verificacion-docs.ts` lea el documento con la máxima nitidez).
      buffer = await normalizarOrientacion(buffer, file.type as 'image/jpeg' | 'image/png' | 'image/webp');
    } else if (file.type === 'application/pdf' && tipoRealDocumento(buffer) !== 'application/pdf') {
      // Mismo criterio que arriba, ahora también para el PDF: el Content-Type lo
      // declara el cliente y se falsifica cambiando la extensión. Sin esto se podía
      // guardar un HTML (o cualquier cosa) como si fuera un documento PDF. Quien lo
      // abriera después no lo vería como PDF, y el proxy tendría que decidir con un
      // archivo que no es lo que dice ser.
      return NextResponse.json({ error: 'El archivo no es un PDF válido.' }, { status: 400 });
    }
    const { url } = await uploadFile(nombre, file.type, buffer);
    return NextResponse.json({ url, tipo: ext });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error al subir';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
