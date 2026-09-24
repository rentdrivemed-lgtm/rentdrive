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

  // El `accept` del input del navegador es cosmético: no impide nada si se le pega
  // directo al endpoint (curl, DevTools, un archivo renombrado). Lo que de verdad
  // valida es lo de abajo, con el tipo MIME REAL leído de los bytes mágicos — nunca
  // el `file.type`, que lo declara el cliente y se falsifica trivialmente.
  // TODOS los documentos aceptan PDF, incluidos cédula, pasaporte y licencia.
  //
  // Antes la cédula y la licencia lo rechazaban (`soloImagen`), y se daban dos razones
  // que ya no se sostienen:
  //
  //  · «la verificación con IA necesita ver el documento» — `lib/verificacion-docs.ts`
  //    procesa PDF de forma nativa: comprueba la cabecera `%PDF-` y se lo manda a Claude
  //    como `type: 'document'`. Lee un PDF igual de bien que una foto.
  //  · «en móvil, un accept mixto esconde la cámara» — cierto, pero eso se arregla con
  //    un botón de cámara aparte (lo que ya hacía este mismo flujo para el SOAT), no
  //    prohibiendo el formato. Ver `preferirCamara` en components/DocUpload.tsx.
  //
  // Mucha gente descarga su cédula o su licencia en PDF y no tiene por qué convertirla
  // a foto para poder reservar. Lo que sí se sigue exigiendo, más abajo, es que el
  // archivo SEA de verdad lo que dice ser: eso se comprueba por bytes mágicos.
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
      // Dice ser imagen: que lo sea. Si los bytes reales no son ninguno de los 3
      // formatos soportados (p. ej. un PDF renombrado a .jpg con el Content-Type
      // falsificado), se rechaza acá — antes de subir nada a Cloudinary o de
      // normalizar la orientación sobre datos que no son una imagen. El caso
      // simétrico, «dice ser PDF pero no lo es», se comprueba justo debajo.
      if (!tipoRealImagen(buffer)) {
        return NextResponse.json({ error: 'El archivo no es una imagen válida en JPG, PNG o WebP.' }, { status: 400 });
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
