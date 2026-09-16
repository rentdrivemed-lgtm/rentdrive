// ── ¿Esta URL apunta a un PDF? ──────────────────────────────────────────────
//
// Módulo PURO (sin Node, sin BD, sin el SDK de Cloudinary) para poder importarse
// tanto desde componentes 'use client' como desde el servidor, igual que
// `lib/cloudinary-descarga.ts` o `lib/pico-placa.ts`.
//
// POR QUÉ EXISTE. El criterio estaba repetido en cinco sitios y en todos era el
// mismo: `url.toLowerCase().endsWith('.pdf')`. Con los PDF de este proyecto ese
// criterio SIEMPRE da falso, así que ninguno funcionaba:
//
//   `uploadFile` sube los PDF con `resource_type: 'raw'` y, hasta este cambio,
//   con `public_id: filename.replace(/\.[^.]+$/, '')` — o sea quitándoles la
//   extensión. Cloudinary entrega entonces:
//
//     https://res.cloudinary.com/<cloud>/raw/upload/v1789566513/docs/doc-1789…
//
//   sin `.pdf` al final. Comprobado contra la cuenta real: los 8 archivos raw
//   que hay NO terminan en `.pdf`. Resultado: cada PDF se renderizaba como
//   `<img>` y el usuario veía un cuadro de imagen rota. El dueño lo reportó como
//   "ningún documento en pdf lo está leyendo", y tenía razón: eran todos.
//
// LAS DOS SEÑALES. Se miran las dos porque conviven dos generaciones de archivos:
//   · `/raw/upload/`  → lo que Cloudinary usa para todo lo que no es imagen ni
//     vídeo. Es la señal fiable para los que YA están subidos sin extensión, y no
//     depende de que el nombre diga nada.
//   · extensión `.pdf` → para los nuevos (ahora sí la conservan) y para cualquier
//     URL ajena a Cloudinary (`/uploads/...` legado en disco, por ejemplo).
//
// Se ignora la query (`?v=2`) y el fragmento (`#x`) antes de mirar la extensión:
// una URL firmada o versionada sigue siendo un PDF.

const SEGMENTO_RAW = '/raw/upload/';

/**
 * `true` si `url` apunta a un PDF. Tolerante: cualquier cosa que no sea un string
 * no vacío devuelve `false` en vez de lanzar, porque estos valores vienen de JSON
 * guardado en base de datos y pueden ser `null`, un número o basura.
 */
export function esPdfUrl(url: unknown): boolean {
  if (typeof url !== 'string' || !url) return false;
  const limpia = url.split('?')[0].split('#')[0].toLowerCase();
  return limpia.includes(SEGMENTO_RAW) || limpia.endsWith('.pdf');
}

/**
 * Nombre de archivo con el que ofrecer una descarga, cuando la URL no trae uno
 * legible (el caso de los raw sin extensión: `doc-1789566512859-4ggb51upshp`).
 * `base` debe venir ya saneado por quien llama.
 */
export function nombreDescargaDocumento(url: unknown, base: string): string {
  const limpio = base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'documento';
  const conExtension = /\.[A-Za-z0-9]{2,5}$/.test(limpio);
  if (conExtension) return limpio;
  if (esPdfUrl(url)) return `${limpio}.pdf`;
  const m = typeof url === 'string' ? url.split('?')[0].match(/\.([A-Za-z0-9]{2,5})$/) : null;
  return m ? `${limpio}.${m[1].toLowerCase()}` : limpio;
}
