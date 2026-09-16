import { v2 as cloudinary } from 'cloudinary';
import { writeFile, mkdir, rm, readFile } from 'fs/promises';
import path from 'path';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export type UploadResult = { url: string; path: string };

// ── Validación de URLs de documentos ────────────────────────────────────────
// `documentos` (vehículos) guarda URLs de archivos ya subidos por uploadFile()
// de arriba, es decir SIEMPRE deben apuntar a Cloudinary bajo nuestro cloud_name.
// Sin esta validación, POST /api/vehiculos y PUT /api/vehiculos/[id] aceptaban
// cualquier string como si fuera un documento subido de verdad (ej. una URL a
// un sitio externo, o un dato inventado), sin que nunca haya pasado por el
// storage real ni por revisión. Basta validar el dominio/prefijo real que
// genera Cloudinary — no hace falta un sistema de tokens firmados para esto.
const CLOUDINARY_HOST = 'https://res.cloudinary.com/';

export function esUrlDeStorageValida(url: unknown): boolean {
  if (typeof url !== 'string' || !url) return false;
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  // Falla CERRADO si falta la env var: sin `cloudName` no hay forma de restringir el
  // prefijo a NUESTRA cuenta, y aceptar el host genérico dejaría pasar URLs de
  // cualquier cuenta de Cloudinary (no solo la nuestra). Mejor rechazar todo documento
  // en ese escenario (un problema de configuración visible) que aceptar de más.
  if (!cloudName) return false;
  const prefijo = `${CLOUDINARY_HOST}${cloudName}/`;
  return url.startsWith(prefijo);
}

/**
 * Extrae los valores crudos de `url` / `url_dorso` que haya dentro de un JSON de
 * `documentos`. Devuelve `null` si el JSON no se puede parsear o no es un objeto.
 * Los valores van SIN filtrar por tipo a propósito: un `url` que no sea string
 * (número, objeto, null) tiene que llegar hasta la validación y ser rechazado ahí,
 * no desaparecer silenciosamente de la lista.
 */
function urlsDeDocumentos(documentosJson: string | undefined | null): unknown[] | null {
  if (!documentosJson) return [];
  let docs: unknown;
  try {
    docs = JSON.parse(documentosJson);
  } catch {
    return null;
  }
  // `typeof [] === 'object'`, así que sin `Array.isArray` un `documentos: "[]"` pasaba por
  // objeto válido y `[].every(...)` daba `true`: el JSON que BORRA todos los documentos se
  // consideraba válido. Un array (o un número, o `null`) no es un JSON de documentos: se
  // rechaza igual que un JSON roto, fallando cerrado.
  if (!docs || typeof docs !== 'object' || Array.isArray(docs)) return null;
  const urls: unknown[] = [];
  for (const valor of Object.values(docs as Record<string, unknown>)) {
    if (!valor || typeof valor !== 'object') continue;
    const doc = valor as Record<string, unknown>;
    if (doc.url !== undefined) urls.push(doc.url);
    if (doc.url_dorso !== undefined) urls.push(doc.url_dorso);
  }
  return urls;
}

/**
 * Valida que las URLs presentes dentro de un JSON de `documentos` (ej.
 * `{ soat: { url }, tecno: { url }, tarjeta: { url, url_dorso }, ... }`)
 * provengan de una subida real a nuestro storage. Cualquier clave `url` o
 * `url_dorso` con un valor que no calce el prefijo real se considera inválida.
 * Un JSON vacío/sin URLs es válido (no hay nada que validar).
 *
 * `documentosActualesJson` (opcional) es el JSON que HOY está guardado en la BD para ese
 * mismo vehículo. Sus URLs se consideran ya aceptadas y NO se vuelven a validar: se valida
 * solo lo que CAMBIA en este request. Es el mismo criterio de la allow-list de fotos en
 * PUT /api/vehiculos/[id] (solo las URLs nuevas deben tener registro de subida).
 *
 * Por qué (sep-2026): antes se revalidaba TODO el JSON en cada guardado, así que un
 * documento legado con una URL previa a Cloudinary (rutas `/uploads/...`) hacía fallar con
 * 400 cualquier guardado de la sección Documentos — aunque ese documento no se estuviera
 * tocando. Mientras el campo era visible el propietario podía re-subirlo y limpiar la URL
 * mala; al retirar el bloque "Seguro todo riesgo" del formulario (DrivePass expide la
 * póliza) esa clave legada quedó sin ninguna forma de arreglarse desde la interfaz, y el
 * vehículo se quedaba sin poder guardar documentos NUNCA más.
 *
 * NO debilita nada para URLs nuevas: la lista de exentas sale de la BASE DE DATOS, no del
 * body, así que el cliente no puede declarar una URL como "ya guardada". Cualquier URL que
 * no esté literalmente persistida en ese vehículo sigue teniendo que pasar
 * `esUrlDeStorageValida`. (La exención es por valor de URL, no por clave: reutilizar en
 * otra clave una URL que este mismo vehículo ya tenía guardada está permitido y no da
 * acceso a nada que el propietario no tuviera ya.)
 */
export function documentosConUrlsValidas(
  documentosJson: string | undefined | null,
  documentosActualesJson?: string | undefined | null,
): boolean {
  const urls = urlsDeDocumentos(documentosJson);
  if (urls === null) return false;
  // Si el JSON guardado está corrupto, `urlsDeDocumentos` devuelve null → no se exenta
  // nada (falla cerrado) y se valida todo como antes.
  const yaGuardadas = new Set(
    (urlsDeDocumentos(documentosActualesJson) ?? []).filter((u): u is string => typeof u === 'string' && u !== ''),
  );
  return urls.every(u => (typeof u === 'string' && yaGuardadas.has(u)) || esUrlDeStorageValida(u));
}

export type UploadOpts = {
  /**
   * Sobrescribe la carpeta de Cloudinary donde queda la subida (por defecto se deriva
   * de `contentType`/`filename`, ver abajo). Se usa hoy para etiquetar de forma
   * identificable las fotos subidas ANTES de que exista una cuenta (atajo de OCR del
   * registro, `app/api/registro/extraer-documento/route.ts`, carpeta `registro-temp`):
   * esas fotos pueden quedar huérfanas si la persona abandona el registro, y necesitan
   * poder distinguirse de una subida normal ya asociada a una cuenta para que
   * `POST /api/admin/limpiar-documentos-huerfanos` sepa qué prefijo revisar/borrar sin
   * arriesgar tocar documentos de cuentas reales (que siguen en `docs`/`uploads`).
   */
  folder?: string;
};

export async function uploadFile(filename: string, contentType: string, data: ArrayBuffer | Buffer, opts?: UploadOpts): Promise<UploadResult> {
  const buffer = data instanceof ArrayBuffer ? Buffer.from(data) : data;
  const esPdfSubida = contentType === 'application/pdf';
  const folder = opts?.folder || (esPdfSubida ? 'docs' : filename.startsWith('doc-') ? 'docs' : 'uploads');

  const result = await new Promise<{ secure_url: string; public_id: string }>((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: esPdfSubida ? 'raw' : 'image',
        // Las imágenes van SIN extensión (Cloudinary la añade según el formato que entrega).
        // Los PDF la CONSERVAN: son `raw`, y sin extensión la URL entregada no termina en
        // `.pdf`, que era justo lo que hacía que la app no los reconociera como PDF y los
        // pintara como imagen rota. Los 8 archivos ya subidos siguen sin extensión y se
        // detectan por el segmento `/raw/upload/` (ver lib/documento-tipo.ts).
        public_id: esPdfSubida ? filename : filename.replace(/\.[^.]+$/, ''),
      },
      (err, res) => { if (err || !res) reject(err ?? new Error('Upload failed')); else resolve(res); }
    ).end(buffer);
  });

  return { url: result.secure_url, path: result.public_id };
}

// ── Limpieza de documentos huérfanos (registro-temp) ────────────────────────
// Helpers de la Admin API de Cloudinary, usados por
// POST /api/admin/limpiar-documentos-huerfanos. Se centralizan acá (en vez de
// importar `cloudinary` de nuevo en la ruta) para no duplicar la configuración
// del cliente y mantener todo el uso del SDK de Cloudinary en un solo archivo.

export type RecursoCloudinary = { public_id: string; secure_url: string; created_at: string };

// Los rechazos de la Admin API de Cloudinary NO son `instanceof Error` (son un
// objeto plano `{ message, name, http_code }`, ver `UploadApiErrorResponse` del
// SDK) — `err instanceof Error ? err.message : String(err)` los convertía en el
// inútil "[object Object]". Este helper cubre ambos casos.
export function mensajeErrorCloudinary(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return String(err);
}

/**
 * Lista TODOS los recursos de imagen bajo un prefijo/carpeta de Cloudinary,
 * paginando con `next_cursor` hasta agotar el listado. Pensado para un job de
 * limpieza ocasional (no para una ruta de alto tráfico ni para carpetas con
 * volúmenes enormes de archivos).
 */
export async function listarRecursosPorPrefijo(prefijo: string): Promise<RecursoCloudinary[]> {
  const recursos: RecursoCloudinary[] = [];
  let cursor: string | undefined;
  do {
    const resp = await cloudinary.api.resources({
      type: 'upload',
      resource_type: 'image',
      prefix: prefijo,
      max_results: 500,
      next_cursor: cursor,
    });
    for (const r of resp.resources as Array<{ public_id: string; secure_url: string; created_at: string }>) {
      recursos.push({ public_id: r.public_id, secure_url: r.secure_url, created_at: r.created_at });
    }
    cursor = resp.next_cursor;
  } while (cursor);
  return recursos;
}

/**
 * Borra recursos de Cloudinary por `public_id`, en lotes de 100 (límite de la
 * Admin API para `delete_resources`). Tolerante por lote: si un lote falla, se
 * sigue intentando con los siguientes (no se aborta el resto por un error
 * puntual) y se reporta el último error visto.
 */
export async function borrarRecursos(publicIds: string[]): Promise<{ borrados: string[]; error?: string }> {
  const borrados: string[] = [];
  let error: string | undefined;
  for (let i = 0; i < publicIds.length; i += 100) {
    const lote = publicIds.slice(i, i + 100);
    try {
      await cloudinary.api.delete_resources(lote, { resource_type: 'image' });
      borrados.push(...lote);
    } catch (e) {
      error = mensajeErrorCloudinary(e);
    }
  }
  return { borrados, error };
}

// ── Tarjetas NFC ──────────────────────────────────────────────────────────
// El HTML autocontenido (pequeño, <8MB) se guarda en el volumen persistente
// de Railway — mismo criterio que rentdrive.db en lib/db.ts (fuera del
// volumen, cualquier redeploy borra el filesystem del contenedor). Los
// audios (binarios más pesados, pensados para CDN) van a Cloudinary como el
// resto de los uploads, bajo resource_type "video" (así maneja Cloudinary
// audio: mp3/wav/etc.).
const TARJETAS_DIR = process.env.NODE_ENV === 'production'
  ? '/app/data/tarjetas'
  : path.join(process.cwd(), 'data', 'tarjetas');

function slugDir(slug: string): string {
  // Defensa en profundidad: el slug ya se valida antes de llegar aquí, pero
  // no debe poder escapar del directorio.
  const limpio = slug.replace(/[^a-z0-9-]/g, '');
  if (!limpio || limpio !== slug) throw new Error('Slug inválido');
  return path.join(TARJETAS_DIR, limpio);
}

export async function guardarTarjetaHtml(slug: string, data: ArrayBuffer | Buffer): Promise<void> {
  const dir = slugDir(slug);
  await mkdir(dir, { recursive: true });
  const buffer = data instanceof ArrayBuffer ? Buffer.from(data) : data;
  await writeFile(path.join(dir, 'index.html'), buffer);
}

export async function leerTarjetaHtml(slug: string): Promise<string> {
  return readFile(path.join(slugDir(slug), 'index.html'), 'utf-8');
}

export async function eliminarTarjetaHtml(slug: string): Promise<void> {
  try { await rm(slugDir(slug), { recursive: true, force: true }); } catch { /* si no existe, no pasa nada */ }
}

export type TarjetaAudio = { nombre: string; url: string; public_id: string };

export async function subirAudioTarjeta(slug: string, filename: string, data: ArrayBuffer | Buffer): Promise<TarjetaAudio> {
  const nombre = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const buffer = data instanceof ArrayBuffer ? Buffer.from(data) : data;

  const result = await new Promise<{ secure_url: string; public_id: string }>((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      { folder: `tarjetas/${slug}/audio`, resource_type: 'video', public_id: nombre.replace(/\.[^.]+$/, '') },
      (err, res) => { if (err || !res) reject(err ?? new Error('Upload failed')); else resolve(res); }
    ).end(buffer);
  });

  return { nombre, url: result.secure_url, public_id: result.public_id };
}

export async function eliminarAudioTarjeta(publicId: string): Promise<void> {
  try { await cloudinary.uploader.destroy(publicId, { resource_type: 'video' }); } catch { /* no bloquea */ }
}
