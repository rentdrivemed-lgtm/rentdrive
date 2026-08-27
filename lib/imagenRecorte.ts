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

export async function recortarImagen(imageSrc: string, pixelCrop: PixelCrop, rotacion = 0): Promise<Blob> {
  const image = await crearImagen(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo crear el contexto de canvas');

  const { width: bw, height: bh } = tamanioRotado(image.width, image.height, rotacion);
  canvas.width = bw;
  canvas.height = bh;

  ctx.translate(bw / 2, bh / 2);
  ctx.rotate(radianes(rotacion));
  ctx.translate(-image.width / 2, -image.height / 2);
  ctx.drawImage(image, 0, 0);

  const data = ctx.getImageData(pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height);
  canvas.width = pixelCrop.width;
  canvas.height = pixelCrop.height;
  ctx.putImageData(data, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('No se pudo generar la imagen')), 'image/jpeg', 0.92);
  });
}
