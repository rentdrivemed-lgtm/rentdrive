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

// Lado más largo (en px) al que limitamos el canvas de trabajo. Las fotos de
// celulares modernos son de 12-48 megapixeles (p. ej. 4032x3024 o más), y
// varios navegadores móviles (Safari/iOS en particular) tienen límites de
// área de canvas (históricamente ~4096x4096px / ~16.7M píxeles) y de
// memoria: al superarlos, drawImage/getImageData fallan o el navegador se
// queda sin memoria — esto es lo que producía el "No pudimos procesar la
// imagen. Intenta de nuevo." al subir documentos (p. ej. el SOAT) desde el
// celular. 2200px de sobra para que un documento se lea perfectamente bien,
// y de paso reduce el peso final subido.
const MAX_LADO_CANVAS = 2200;

export async function recortarImagen(imageSrc: string, pixelCrop: PixelCrop, rotacion = 0): Promise<Blob> {
  const image = await crearImagen(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo crear el contexto de canvas');

  // bw/bh son las dimensiones de la caja rotada a resolución ORIGINAL — el
  // mismo sistema de coordenadas en el que react-easy-crop calcula
  // `pixelCrop` (croppedAreaPixels). Si excede el máximo, calculamos un
  // factor de escala y dibujamos ya reducida (drawImage con destino
  // escalado), y escalamos `pixelCrop` por el mismo factor para que el
  // recorte siga cayendo en el lugar correcto sobre el canvas más chico.
  const { width: bw, height: bh } = tamanioRotado(image.width, image.height, rotacion);
  const escala = Math.min(1, MAX_LADO_CANVAS / Math.max(bw, bh));
  const cw = Math.round(bw * escala);
  const ch = Math.round(bh * escala);
  canvas.width = cw;
  canvas.height = ch;

  ctx.translate(cw / 2, ch / 2);
  ctx.scale(escala, escala);
  ctx.rotate(radianes(rotacion));
  ctx.translate(-image.width / 2, -image.height / 2);
  ctx.drawImage(image, 0, 0);

  const sx = Math.round(pixelCrop.x * escala);
  const sy = Math.round(pixelCrop.y * escala);
  const sw = Math.max(1, Math.round(pixelCrop.width * escala));
  const sh = Math.max(1, Math.round(pixelCrop.height * escala));

  const data = ctx.getImageData(sx, sy, sw, sh);
  canvas.width = sw;
  canvas.height = sh;
  ctx.putImageData(data, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('No se pudo generar la imagen')), 'image/jpeg', 0.92);
  });
}
