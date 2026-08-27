import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';

const client = new Anthropic();

type PlacaDeteccion = {
  plate_visible: boolean;
  region?: { x_pct: number; y_pct: number; w_pct: number; h_pct: number };
};

/**
 * Normaliza la orientación EXIF de una imagen "horneando" la rotación en los
 * píxeles (sharp `.rotate()` sin argumentos usa el tag EXIF de orientación
 * del propio buffer y luego lo limpia). Debe llamarse ANTES de cualquier
 * otro procesamiento: evita que las fotos de celular (que casi siempre traen
 * orientación EXIF en vez de píxeles ya rotados) terminen "de lado" cuando
 * algún paso posterior (p. ej. `sharp().jpeg()`/`.composite()`) re-codifica
 * la imagen y descarta esa metadata sin haber aplicado la rotación real.
 *
 * Si la imagen NO trae tag de orientación EXIF (o ya es la orientación
 * normal, valor 1), no hay nada que corregir: se devuelve el buffer
 * ORIGINAL sin re-codificar, para no perder calidad en documentos legales
 * (cédulas, licencias, SOAT, tarjeta de propiedad) que dependen de nitidez
 * para la verificación automática con IA (`lib/verificacion-docs.ts`).
 * Cuando sí hay que rotar, se re-codifica preservando calidad explícita
 * según el formato de entrada (`mediaType`) en vez de usar los defaults de
 * sharp, que comprimen más de lo deseado.
 */
export async function normalizarOrientacion(
  buffer: Buffer,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' = 'image/jpeg'
): Promise<Buffer> {
  try {
    const metadata = await sharp(buffer).metadata();
    if (!metadata.orientation || metadata.orientation === 1) {
      // Sin corrección EXIF pendiente: no tocar los bytes originales.
      return buffer;
    }

    const rotada = sharp(buffer).rotate();
    const salida = mediaType === 'image/png'
      ? rotada.png()
      : mediaType === 'image/webp'
      ? rotada.webp({ quality: 95 })
      : rotada.jpeg({ quality: 95 });

    return await salida.toBuffer();
  } catch (err) {
    console.error('[blur-placas] No se pudo normalizar la orientación EXIF, se usa la imagen original:', err);
    return buffer;
  }
}

export async function detectarYDifuminarPlaca(
  bufferOriginal: Buffer,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' = 'image/jpeg'
): Promise<{ buffer: Buffer; difuminada: boolean }> {
  // Corregir orientación EXIF primero: tanto la imagen que ve Claude como la
  // región que recortamos/componemos deben trabajar sobre los mismos píxeles
  // "derechos", si no el % de región que calcula Claude (sobre la imagen ya
  // rotada) no coincide con las coordenadas de un buffer sin rotar.
  const buffer = await normalizarOrientacion(bufferOriginal, mediaType);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[blur-placas] ANTHROPIC_API_KEY no configurada — se sube la foto sin difuminar la placa');
    return { buffer, difuminada: false };
  }

  // Normalizar a JPEG para base64 (menor tamaño)
  const jpegBuf = await sharp(buffer).jpeg({ quality: 85 }).toBuffer();
  const base64 = jpegBuf.toString('base64');

  let deteccion: PlacaDeteccion = { plate_visible: false };

  let text = '';
  try {
    const resp = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
          },
          {
            type: 'text',
            text: `Detect vehicle license plates in this photo. Return ONLY valid JSON, no markdown:
{"plate_visible":boolean,"region":{"x_pct":number,"y_pct":number,"w_pct":number,"h_pct":number}}
Rules:
- x_pct, y_pct = top-left corner of the plate as % of image width/height (0–100)
- w_pct, h_pct = plate size as % of image width/height
- If no plate is visible, set plate_visible to false and omit region
- Be generous with the bounding box (add ~10% padding around the plate)`,
          },
        ],
      }],
    });

    text = resp.content[0].type === 'text' ? resp.content[0].text.trim() : '';
  } catch (err) {
    console.error('[blur-placas] Error llamando a la API de Anthropic — se sube la foto sin difuminar la placa:', err);
    return { buffer, difuminada: false };
  }

  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) deteccion = JSON.parse(match[0]) as PlacaDeteccion;
    else console.warn('[blur-placas] Respuesta de Claude sin JSON reconocible — se sube la foto sin difuminar la placa. Respuesta:', text.slice(0, 300));
  } catch (err) {
    console.error('[blur-placas] JSON inválido en la respuesta de Claude — se sube la foto sin difuminar la placa:', err, 'Respuesta:', text.slice(0, 300));
    return { buffer, difuminada: false };
  }

  if (!deteccion.plate_visible || !deteccion.region) {
    console.warn('[blur-placas] Claude no detectó una placa visible en la foto (plate_visible=false)');
    return { buffer, difuminada: false };
  }

  // Obtener dimensiones (ya con orientación normalizada, igual que lo que vio Claude)
  const meta = await sharp(buffer).metadata();
  const imgW = meta.width ?? 1;
  const imgH = meta.height ?? 1;

  const r = deteccion.region;
  // Margen extra (además del que ya se le pide a Claude) para tolerar
  // bounding boxes ligeramente desalineados y no dejar un borde de placa
  // visible sin difuminar: expandimos la caja un 2% del ancho/alto de la
  // imagen hacia cada lado y luego recortamos contra los bordes reales.
  const padX = Math.round(imgW * 0.02);
  const padY = Math.round(imgH * 0.02);

  const boxLeft = (r.x_pct / 100) * imgW;
  const boxTop  = (r.y_pct / 100) * imgH;
  const boxW    = (r.w_pct / 100) * imgW;
  const boxH    = (r.h_pct / 100) * imgH;

  const left   = Math.max(0, Math.floor(boxLeft - padX));
  const top    = Math.max(0, Math.floor(boxTop - padY));
  const right  = Math.min(imgW, Math.ceil(boxLeft + boxW + padX));
  const bottom = Math.min(imgH, Math.ceil(boxTop + boxH + padY));
  const width  = Math.min(imgW - left, Math.max(20, right - left));
  const height = Math.min(imgH - top,  Math.max(10, bottom - top));

  // Extraer región de la placa → pixelar fuertemente → componer de vuelta
  const placaRegion = await sharp(buffer)
    .extract({ left, top, width, height })
    .resize(Math.max(1, Math.floor(width / 6)), Math.max(1, Math.floor(height / 6))) // reducir 6x
    .resize(width, height, { kernel: 'nearest' })                                     // ampliar sin suavizado
    .blur(8)                                                                           // blur adicional
    .toBuffer();

  const resultado = await sharp(buffer)
    .composite([{ input: placaRegion, left, top }])
    .jpeg({ quality: 90 })
    .toBuffer();

  return { buffer: resultado, difuminada: true };
}
