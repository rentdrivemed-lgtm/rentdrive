import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';

const client = new Anthropic();

type PlacaDeteccion = {
  plate_visible: boolean;
  region?: { x_pct: number; y_pct: number; w_pct: number; h_pct: number };
};

export async function detectarYDifuminarPlaca(
  buffer: Buffer,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' = 'image/jpeg'
): Promise<{ buffer: Buffer; difuminada: boolean }> {
  if (!process.env.ANTHROPIC_API_KEY) return { buffer, difuminada: false };

  // Normalizar a JPEG para base64 (menor tamaño)
  const jpegBuf = await sharp(buffer).jpeg({ quality: 85 }).toBuffer();
  const base64 = jpegBuf.toString('base64');

  let deteccion: PlacaDeteccion = { plate_visible: false };

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

    const text = resp.content[0].type === 'text' ? resp.content[0].text.trim() : '';
    const match = text.match(/\{[\s\S]*\}/);
    if (match) deteccion = JSON.parse(match[0]) as PlacaDeteccion;
  } catch {
    return { buffer, difuminada: false };
  }

  if (!deteccion.plate_visible || !deteccion.region) {
    return { buffer, difuminada: false };
  }

  // Obtener dimensiones originales
  const meta = await sharp(buffer).metadata();
  const imgW = meta.width ?? 1;
  const imgH = meta.height ?? 1;

  const r = deteccion.region;
  const left   = Math.max(0, Math.floor((r.x_pct / 100) * imgW));
  const top    = Math.max(0, Math.floor((r.y_pct / 100) * imgH));
  const width  = Math.min(imgW - left, Math.max(20, Math.floor((r.w_pct / 100) * imgW)));
  const height = Math.min(imgH - top,  Math.max(10, Math.floor((r.h_pct / 100) * imgH)));

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
