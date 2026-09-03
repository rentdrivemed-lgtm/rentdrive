// Fuerza la descarga real (header `Content-Disposition: attachment`) de un
// documento ya subido a Cloudinary (ver `uploadFile()` en `lib/storage.ts`),
// en vez de abrirlo inline en el navegador. Cloudinary soporta esto agregando
// el flag de transformación `fl_attachment` justo después del segmento
// `/upload/` de la URL — funciona cross-origin, a diferencia del atributo
// HTML `download`, que la mayoría de navegadores ignora en links a otro
// origen (por eso se combinan los dos: este flag para forzar el header real,
// y `download` en el <a> como buena práctica adicional).
//
// Módulo PURO (sin imports de Node/DB/Cloudinary SDK) para poder usarse
// directo desde componentes 'use client' (paneles de admin/propietario),
// igual que `lib/pico-placa.ts` o `lib/lugares.ts`.
const CLOUDINARY_HOST = 'https://res.cloudinary.com/';
const UPLOAD_SEGMENT = '/upload/';
const ATTACHMENT_FLAG = 'fl_attachment/';

/**
 * Dada una URL de un documento subido a Cloudinary, devuelve la misma URL
 * con `fl_attachment` insertado para forzar la descarga. Si la URL no es de
 * Cloudinary (o no tiene la forma esperada), la devuelve tal cual sin
 * romper nada — nunca lanza.
 */
export function urlDescarga(url: string): string {
  if (!url || typeof url !== 'string') return url;
  if (!url.startsWith(CLOUDINARY_HOST)) return url;
  if (url.includes(ATTACHMENT_FLAG)) return url; // ya la tiene, no duplicar
  const i = url.indexOf(UPLOAD_SEGMENT);
  if (i === -1) return url;
  const corte = i + UPLOAD_SEGMENT.length;
  return url.slice(0, corte) + ATTACHMENT_FLAG + url.slice(corte);
}
