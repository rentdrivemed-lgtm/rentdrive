// ── Tapado MANUAL de placas: trabajo de imagen (SOLO SERVIDOR) ──────────────
//
// Usa `sharp` y la red: NO se puede importar desde un componente 'use client'. Las reglas
// de geometría/validación viven aparte, en el módulo PURO lib/tapar-placa.ts, justamente
// para que la vista previa del navegador use exactamente las mismas cuentas que esto.
//
// El sello que se estampa NO se vuelve a dibujar acá: se reusa `taparZonas` de
// lib/blur-placas.ts, que es la misma función que usa el camino automático (fondo navy
// #1B3356, borde naranja #F25C2B, logo de DrivePass centrado). Si el sello cambia de
// aspecto, cambia en los dos caminos a la vez y no hay dos "placas de marca" distintas
// conviviendo en el catálogo.
//
// OPACO A PROPÓSITO (no es un desenfoque): un blur puede ser parcialmente reversible
// subiendo brillo/contraste; un relleno 100% opaco reemplaza los píxeles. Ver la nota
// larga en lib/blur-placas.ts.

import sharp from 'sharp';
import { normalizarOrientacion, taparZonas } from './blur-placas';
import { descargarAcotado } from './descarga-remota';
import { esUrlFotoSegura, RUTA_FOTO_LOCAL } from './fotos-servicio';
import { prepararZonas, zonaAPixeles, type RectanguloPx, type ZonaPlaca } from './tapar-placa';

export type MediaTypeFoto = 'image/jpeg' | 'image/png' | 'image/webp';

/** Tope de peso de la foto a bajar. Una foto de celular de 12 MP ronda 3-6 MB. */
const MAX_BYTES_FOTO = 12 * 1024 * 1024;
const TIMEOUT_DESCARGA_MS = 20_000;

// ── Semáforo de tapados simultáneos ─────────────────────────────────────────
//
// Misma lección que lib/paquete-documentos.ts: el contenedor de Railway corre TODO el
// sitio. Una foto de 3024×4032 son ~36 MB de píxeles crudos dentro de sharp (más el
// buffer descargado, más el de salida). Dos pestañas dándole a "Aplicar" a la vez es
// tolerable; diez no. Contador en memoria del proceso (una sola instancia, igual que
// lib/limite-tasa.ts).
const MAX_TAPADOS_CONCURRENTES = 2;
let tapadosEnCurso = 0;

/** Pide turno. `false` = ya hay demasiados en curso (responder 503, no encolar). */
export function tomarTurnoTapado(): boolean {
  if (tapadosEnCurso >= MAX_TAPADOS_CONCURRENTES) return false;
  tapadosEnCurso++;
  return true;
}

/** Devuelve el turno. SIEMPRE en un `finally`: si no, un error deja el cupo cerrado para siempre. */
export function liberarTurnoTapado(): void {
  tapadosEnCurso = Math.max(0, tapadosEnCurso - 1);
}

function mediaTypeDe(contentType: string): MediaTypeFoto | null {
  const c = (contentType || '').toLowerCase();
  if (c.includes('png')) return 'image/png';
  if (c.includes('webp')) return 'image/webp';
  if (c.includes('jpeg') || c.includes('jpg')) return 'image/jpeg';
  return null;
}

export type FotoDescargada = { buffer: Buffer; mediaType: MediaTypeFoto };

/**
 * Baja la foto que se va a tapar.
 *
 * NO se hace `fetch` a pelo en ningún caso: la URL sale de la base de datos (y algunas
 * filas viejas se guardaron antes de que existiera cualquier validación de URL), así que
 * primero pasa por la allowlist de destino `esUrlFotoSegura` (lib/fotos-servicio.ts) y
 * después por `descargarAcotado` (lib/descarga-remota.ts), que corta redirecciones,
 * tiempo y tamaño. Sin las dos cosas, esta ruta sería un oráculo de red interna para
 * cualquier admin.
 */
export async function descargarFotoParaTapar(url: string): Promise<FotoDescargada> {
  if (!esUrlFotoSegura(url)) {
    throw new Error('La dirección de esta foto no está permitida — no se descargó nada.');
  }
  if (url.startsWith(RUTA_FOTO_LOCAL)) {
    // `esUrlFotoSegura` acepta además rutas del propio sitio bajo /uploads/ (fotos legado
    // que quedaron en el filesystem antes de Cloudinary). No se puede `fetch` una ruta
    // relativa desde el servidor, y en Railway ese directorio ni siquiera existe. Se avisa
    // con un mensaje entendible en vez de fallar con un "Invalid URL" críptico.
    throw new Error('Esta foto es de las antiguas (guardada en el propio servidor) y no se puede reprocesar automáticamente.');
  }

  const { buffer, contentType } = await descargarAcotado(url, {
    maxBytes: MAX_BYTES_FOTO,
    timeoutMs: TIMEOUT_DESCARGA_MS,
  });
  const mediaType = mediaTypeDe(contentType);
  if (!mediaType) {
    throw new Error(`Lo que hay en esa dirección no es una imagen JPG/PNG/WebP (${contentType || 'sin tipo'}).`);
  }
  return { buffer, mediaType };
}

export type ResultadoTapado = {
  buffer: Buffer;
  /** Ancho/alto de la imagen YA normalizada por EXIF — el lienzo sobre el que valen las zonas. */
  ancho: number;
  alto: number;
  /** Rectángulos realmente estampados, en píxeles. Queda en la bitácora de auditoría. */
  rectangulos: RectanguloPx[];
};

/**
 * Estampa el sello opaco de marca sobre las zonas marcadas a mano.
 *
 * Se normaliza la orientación EXIF ANTES de nada (misma razón que en el camino
 * automático): las fracciones que manda el navegador se midieron sobre la foto tal como
 * la pinta el `<img>`, o sea con la rotación EXIF ya aplicada por el navegador. Si acá se
 * compusiera sobre el buffer sin rotar, los rectángulos caerían girados 90°.
 */
export async function taparPlacasManual(
  bufferOriginal: Buffer,
  mediaType: MediaTypeFoto,
  zonas: ZonaPlaca[],
  proporcionPlaca: boolean,
): Promise<ResultadoTapado> {
  const buffer = await normalizarOrientacion(bufferOriginal, mediaType);
  const meta = await sharp(buffer).metadata();
  const ancho = meta.width ?? 0;
  const alto = meta.height ?? 0;
  if (!ancho || !alto) throw new Error('No se pudieron leer las dimensiones de la foto.');

  const finales = prepararZonas(zonas, ancho, alto, proporcionPlaca);
  const rectangulos = finales.map(z => zonaAPixeles(z, ancho, alto));

  return { buffer: await taparZonas(buffer, rectangulos), ancho, alto, rectangulos };
}
