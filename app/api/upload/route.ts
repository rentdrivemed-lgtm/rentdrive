import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { uploadFile } from '@/lib/storage';
import { detectarYDifuminarPlaca } from '@/lib/blur-placas';
import { getDb } from '@/lib/db';
import { registrarFotoModeracion } from '@/lib/moderacion';
import { estandarizarFotoVehiculo } from '@/lib/estandarizar-foto';
import { consumirIntento } from '@/lib/limite-tasa';

export const runtime = 'nodejs';

// `propietario` es un rol autoregistrable (sin KYC real, ver app/api/auth/registro),
// así que restringir esta ruta por rol NO basta para acotar el gasto en la API paga
// de remove.bg — falta un tope por cuenta. 30/hora alcanza para publicar varios
// vehículos (7 fotos c/u) con margen para reintentos/rotaciones, e insuficiente para
// drenar el presupuesto si alguien crea una cuenta solo para abusar del endpoint.
const FOTO_IA_MAX_HORA = 30;
const FOTO_IA_VENTANA_MS = 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  // Los únicos dos usos legítimos de esta ruta hoy son FotoUpload.tsx (fotos de
  // vehículo, rol propietario) y OperacionesPanel.tsx (fotos de inspección, rol
  // admin). Un `usuario` normal no tiene ningún caso de uso aquí; restringirlo
  // evita que alguien golpee la ruta directo con `tipo=vehiculo` sobre una foto
  // propia (p. ej. su cédula) solo para mandarla sin razón a un servicio externo
  // (remove.bg) — ver lib/estandarizar-foto.ts.
  if (user.rol !== 'propietario' && user.rol !== 'admin') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  // Puramente cosmético: decide si además de la moderación/difuminado de placa
  // (que corren SIEMPRE, sin importar este campo) se aplica la estandarización
  // con IA (quitar fondo + mejorar calidad) de lib/estandarizar-foto.ts. Solo lo
  // manda FotoUpload.tsx.
  const tipo = formData.get('tipo') as string | null;

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
    let contenidoSospechoso = false;
    let motivoSospechoso: string | undefined;
    let seEjecutoModeracion = false;
    // Content-type real de lo que termina en `rawBuffer` — normalmente igual a
    // `file.type`, pero si la estandarización con IA corrió, el buffer final es
    // WebP aunque el archivo original fuera jpg/png (uploadFile/Cloudinary no
    // dependen de esto para detectar el formato real, pero mantenerlo coherente
    // evita un `nombre`/`public_id` "de jpg" con bytes WebP adentro).
    let contentTypeFinal = file.type;

    if (imagenTypes.includes(file.type)) {
      // La moderación de contenido (y la detección/difuminado de placa, misma llamada a
      // Claude vision) corre SIEMPRE para toda imagen subida por esta ruta — YA NO depende
      // de un flag `blurPlaca` que el propio cliente controlaba en el FormData (antes, con
      // solo omitir ese campo, cualquier foto se subía sin pasar nunca por moderación; ver
      // el modelo allow-list documentado en lib/moderacion.ts). detectarYDifuminarPlaca ya
      // normaliza la orientación EXIF internamente, así que no hace falta un paso aparte.
      const mediaType = file.type as 'image/jpeg' | 'image/png' | 'image/webp';
      const resultado = await detectarYDifuminarPlaca(rawBuffer, mediaType);
      rawBuffer            = resultado.buffer;
      difuminada           = resultado.difuminada;
      // Fail-closed ante fallo de moderación: `resultado.moderacionEvaluada === false`
      // significa que la IA NO llegó a evaluar de verdad esta foto (sin API key, error de
      // red/API, o JSON inválido — ver lib/blur-placas.ts), y en ese caso
      // `contenidoInapropiado` queda en `false` por defecto dentro de esa función. Tratar
      // eso como "aprobada" sería fail-open silencioso: la foto quedaría registrada como
      // revisada y aprobada para siempre sin que nadie la haya mirado. En vez de eso, la
      // mandamos por el mismo camino que una foto marcada por la IA como inapropiada — a la
      // cola de revisión manual del admin (contenido_revision=1 en el vehículo que la use).
      contenidoSospechoso  = resultado.contenidoInapropiado || !resultado.moderacionEvaluada;
      motivoSospechoso     = resultado.contenidoInapropiado
        ? resultado.motivoInapropiado
        : (!resultado.moderacionEvaluada
            ? 'No se pudo evaluar automáticamente el contenido de esta foto (fallo de moderación) — pendiente de revisión manual.'
            : undefined);
      seEjecutoModeracion  = true;

      // Estandarización con IA (quitar fondo + mejorar calidad) — solo fotos de
      // publicación de vehículo, y solo si la moderación no la marcó para revisión
      // manual (no tiene sentido "embellecer" una foto que puede terminar
      // rechazada, y así se evita gastar la llamada paga de remove.bg en ella).
      // Best-effort real: si falla, se sigue con `rawBuffer` tal como quedó del
      // paso anterior (ya con la placa difuminada si correspondía).
      if (tipo === 'vehiculo' && !contenidoSospechoso) {
        // Tope por cuenta antes de gastar la llamada paga a remove.bg. Si se
        // superó, NO se bloquea la subida (la foto ya moderada/difuminada se
        // sube igual, solo sin el paso cosmético) — este límite protege el
        // presupuesto, no debe impedir publicar un vehículo.
        const espera = consumirIntento(`estandarizar-foto:${user.id}`, FOTO_IA_MAX_HORA, FOTO_IA_VENTANA_MS);
        if (espera !== null) {
          console.warn(`[upload] usuario ${user.id} superó el límite de estandarización de fotos (${FOTO_IA_MAX_HORA}/hora) — se sube sin procesar`);
        } else {
          try {
            const estandarizada = await estandarizarFotoVehiculo(rawBuffer);
            if (estandarizada) {
              rawBuffer = estandarizada.buffer;
              contentTypeFinal = estandarizada.contentType;
            }
          } catch (err) {
            console.error('[upload] estandarización de foto de vehículo falló, se sube tal cual:', err);
          }
        }
      }
    }

    const { url } = await uploadFile(nombre, contentTypeFinal, rawBuffer);

    if (seEjecutoModeracion) {
      // Registro server-authoritative ALLOW-LIST (ver lib/moderacion.ts): se registra
      // TODA foto (no solo las marcadas), para que POST/PUT /api/vehiculos pueda exigir
      // que cada URL nueva tenga un registro aquí perteneciente al usuario autenticado —
      // una URL externa inventada, o que nunca pasó por esta ruta, no tiene registro y
      // por lo tanto se rechaza (antes solo se registraban las sospechosas, así que
      // cualquier URL sin registro simplemente pasaba sin ningún chequeo).
      try {
        registrarFotoModeracion(getDb(), url, user.id, contenidoSospechoso, motivoSospechoso || '');
      } catch (e) {
        console.error('[upload] No se pudo registrar la foto en fotos_moderacion (se sube igual, marcada en la respuesta):', e instanceof Error ? e.message : e);
      }
    }

    return NextResponse.json({ url, difuminada, contenidoSospechoso });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error al subir';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
