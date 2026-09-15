// Utilidad de canvas para producir la imagen final recortada + rotada,
// a partir de lo que reporta react-easy-crop (croppedAreaPixels).
export type PixelCrop = { x: number; y: number; width: number; height: number };

export function crearImagen(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener('load', () => resolve(img));
    img.addEventListener('error', (e) => reject(e));
    img.crossOrigin = 'anonymous';
    img.src = url;
  });
}

function radianes(grados: number) {
  return (grados * Math.PI) / 180;
}

export function tamanioRotado(width: number, height: number, rotacion: number) {
  const r = radianes(rotacion);
  return {
    width: Math.abs(Math.cos(r) * width) + Math.abs(Math.sin(r) * height),
    height: Math.abs(Math.sin(r) * width) + Math.abs(Math.cos(r) * height),
  };
}

// Lado más largo (en px) al que limitamos el canvas de salida. Las fotos de
// celulares modernos son de 12-48 megapixeles (p. ej. 4032x3024 o más), y
// varios navegadores móviles (Safari/iOS en particular) tienen límites de
// área de canvas (históricamente ~4096x4096px / ~16.7M píxeles) y de
// memoria: al superarlos, drawImage/getImageData fallan o el navegador se
// queda sin memoria — esto es lo que producía el "No pudimos procesar la
// imagen. Intenta de nuevo." al subir documentos (p. ej. el SOAT) desde el
// celular. 2200px de sobra para que un documento se lea perfectamente bien,
// y de paso reduce el peso final subido.
const MAX_LADO_CANVAS = 2200;

/**
 * Recorta (y opcionalmente rota) `imageSrc` según `pixelCrop`, que viene en el
 * sistema de coordenadas de react-easy-crop: píxeles naturales de la CAJA
 * ENVOLVENTE de la imagen ya rotada, con origen en su esquina superior
 * izquierda.
 *
 * Detalles importantes:
 *
 * - El lienzo de salida mide exactamente el recorte pedido (reducido solo si
 *   supera MAX_LADO_CANVAS). Nunca recorta por su cuenta ni amplía la imagen:
 *   la escala está topada en 1, así que jamás se interpola hacia arriba (no
 *   infla el archivo).
 * - `pixelCrop` PUEDE caer parcialmente fuera de la imagen: con
 *   `restrictPosition={false}` en el editor, al alejar el zoom por debajo del
 *   encuadre completo el recuadro es más grande que la foto. Esa zona se
 *   rellena de blanco (como el margen de un escaneo) en vez de quedar negra:
 *   se pinta el fondo primero y luego se dibuja la imagen con la transformación
 *   puesta, en lugar del viejo getImageData/putImageData — que leía fuera del
 *   lienzo (negro transparente => negro al pasar a JPEG) y además duplicaba el
 *   buffer en memoria. Blanco es también lo que ya usa el pipeline de fotos del
 *   servidor (`lib/estandarizar-foto.ts`, `.flatten({ background: '#ffffff' })`).
 */
export async function recortarImagen(imageSrc: string, pixelCrop: PixelCrop, rotacion = 0): Promise<Blob> {
  const image = await crearImagen(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo crear el contexto de canvas');

  const anchoPedido = Math.max(1, pixelCrop.width);
  const altoPedido = Math.max(1, pixelCrop.height);
  if (!Number.isFinite(anchoPedido) || !Number.isFinite(altoPedido)) {
    throw new Error('Recorte inválido');
  }

  // bw/bh: dimensiones de la caja envolvente rotada a resolución ORIGINAL — el
  // mismo sistema en el que react-easy-crop calcula `pixelCrop`.
  const { width: bw, height: bh } = tamanioRotado(image.width, image.height, rotacion);

  const escala = Math.min(1, MAX_LADO_CANVAS / Math.max(anchoPedido, altoPedido));
  const cw = Math.max(1, Math.round(anchoPedido * escala));
  const ch = Math.max(1, Math.round(altoPedido * escala));
  canvas.width = cw;
  canvas.height = ch;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cw, ch);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Del lienzo (px de salida) a la caja envolvente (px naturales) y de ahí a la
  // imagen sin rotar: escalar -> desplazar al recorte -> rotar sobre el centro.
  ctx.scale(escala, escala);
  ctx.translate(-pixelCrop.x, -pixelCrop.y);
  ctx.translate(bw / 2, bh / 2);
  ctx.rotate(radianes(rotacion));
  ctx.translate(-image.width / 2, -image.height / 2);
  ctx.drawImage(image, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('No se pudo generar la imagen')), 'image/jpeg', 0.92);
  });
}
