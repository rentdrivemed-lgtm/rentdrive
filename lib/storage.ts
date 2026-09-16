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
const CLOUDINARY_HOSTNAME = 'res.cloudinary.com';

// ── Parser estricto de una URL de NUESTRO storage ───────────────────────
//
// Hasta ahora `esUrlDeStorageValida` era un `startsWith` del prefijo del cloud. Para
// lo único que existía (¿esta URL salió de nuestra cuenta?) alcanzaba, pero desde que
// los documentos de identidad pueden dejar de ser públicos hace falta saber TRES cosas
// más sobre cada URL guardada, y todas viven en su forma:
//
//   · el `resource_type` (`image` / `raw` / `video`), porque firmar o renombrar un
//     recurso en Cloudinary exige pasárselo y equivocarse da 404;
//   · el TIPO DE ENTREGA (`upload` = público para cualquiera con el enlace,
//     `authenticated` / `private` = hace falta firma del servidor);
//   · el `public_id` real, que es lo único con lo que se puede volver a construir la
//     URL firmada.
//
// Se parsea con `new URL` y se valida segmento por segmento en vez de con una regex
// sobre la cadena entera: una regex sobre texto libre es justo donde se cuelan los
// `@`, los `\`, los `..` y los host parecidos (`res.cloudinary.com.evil.tld`).
export type TipoRecursoStorage = 'image' | 'raw' | 'video';
export type EntregaStorage = 'upload' | 'authenticated' | 'private';

export type RecursoStorage = {
  cloudName: string;
  resourceType: TipoRecursoStorage;
  /** `upload` = lo abre cualquiera con el enlace. El resto exige firma del servidor. */
  entrega: EntregaStorage;
  /** Atajo legible de `entrega === 'upload'`. */
  publica: boolean;
  /** Firma `s--XXXX--` cuando la URL ya viene firmada (solo authenticated/private). */
  firma: string | null;
  /** `v1789…` si la URL trae versión explícita. */
  version: string | null;
  /** `public_id` tal y como lo conoce Cloudinary (en imagen/vídeo va SIN extensión). */
  publicId: string;
  /** Extensión de entrega (`jpg`, `webp`…). `null` en `raw`, que no lleva. */
  formato: string | null;
};

const TIPOS_RECURSO = new Set<string>(['image', 'raw', 'video']);
const TIPOS_ENTREGA = new Set<string>(['upload', 'authenticated', 'private']);
const RE_FIRMA   = /^s--[A-Za-z0-9_-]{6,}--$/;
const RE_VERSION = /^v\d{1,19}$/;
// Charset de un segmento de `public_id`. Todos los nombres los genera NUESTRO código
// (`doc-<timestamp>-<random>.<ext>`, `uploads/<timestamp>-<random>.jpg`…), así que se
// puede ser restrictivo: sin `%` (nada de doble decodificación), sin `\`, sin `:` y sin
// espacios. `.` se permite por la extensión, pero un segmento que sea exactamente `.`
// o `..` se rechaza aparte.
const RE_SEGMENTO = /^[A-Za-z0-9._@~-]+$/;
const URL_STORAGE_MAX = 1000;

/**
 * Descompone una URL de nuestro storage. Devuelve `null` — nunca lanza — ante
 * cualquier cosa que no sea, exactamente, una URL de entrega de NUESTRA cuenta de
 * Cloudinary: otro host, otro cloud, http, puerto, credenciales embebidas, query
 * string, fragmento, segmentos vacíos o con `..`, tipos de recurso/entrega
 * desconocidos…
 *
 * Falla CERRADO si falta `CLOUDINARY_CLOUD_NAME`: sin el nombre del cloud no hay
 * forma de distinguir nuestra cuenta de la de cualquier otro (mismo criterio que
 * tenía `esUrlDeStorageValida` desde siempre).
 */
export function recursoDeUrlStorage(url: unknown): RecursoStorage | null {
  if (typeof url !== 'string') return null;
  const u = url.trim();
  if (!u || u.length > URL_STORAGE_MAX) return null;
  // Caracteres de control y `\`: parten la URL o la reinterpretan (el parser WHATWG
  // trata `\` igual que `/`). Se descartan antes de llegar al parser.
  if (/[\u0000-\u001f\u007f\\]/.test(u)) return null;

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  if (!cloudName) return null;

  let parsed: URL;
  try { parsed = new URL(u); } catch { return null; }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.hostname.toLowerCase() !== CLOUDINARY_HOSTNAME) return null;
  if (parsed.port) return null;
  if (parsed.username || parsed.password) return null;
  // Las URLs que devuelve Cloudinary (`secure_url`) no traen ni query ni fragmento.
  // Aceptarlos sería aceptar sufijos que ningún consumidor mira pero que sí cambian
  // lo que ve un navegador o un CDN intermedio.
  if (parsed.search || parsed.hash) return null;

  const segs = parsed.pathname.split('/').filter(s => s !== '');
  // Debe quedar al menos: <cloud>/<resource_type>/<entrega>/<public_id>
  if (segs.length < 4) return null;
  if (segs.some(s => s === '.' || s === '..')) return null;
  if (segs[0] !== cloudName) return null;
  const resourceType = segs[1];
  const entrega = segs[2];
  if (!TIPOS_RECURSO.has(resourceType) || !TIPOS_ENTREGA.has(entrega)) return null;

  let i = 3;
  let firma: string | null = null;
  if (RE_FIRMA.test(segs[i])) {
    // Una firma sobre entrega `upload` no significa nada: se rechaza en vez de
    // ignorarla en silencio (sería una URL que no pudimos haber generado nosotros).
    if (entrega === 'upload') return null;
    firma = segs[i];
    i += 1;
  }
  let version: string | null = null;
  if (i < segs.length && RE_VERSION.test(segs[i])) {
    version = segs[i];
    i += 1;
  }

  const resto = segs.slice(i);
  if (resto.length === 0) return null;
  if (!resto.every(s => RE_SEGMENTO.test(s))) return null;
  // Ningún `public_id` que genere este proyecto contiene un segmento con forma de
  // versión (`v1789…`): las carpetas son `docs`, `uploads`, `registro-temp`,
  // `tarjetas/...` y el nombre es `doc-<ts>-<random>`. Si aparece uno aquí dentro es
  // que lo que se saltó antes NO era una firma ni una versión sino una
  // TRANSFORMACIÓN (`fl_attachment`, `w_100,h_100`, …), y entonces el `public_id`
  // que se deduciría sería falso. Fallar cerrado: una URL con transformaciones no la
  // generó `uploadFile()`, así que no es una URL guardada legítima.
  if (resto.some(s => RE_VERSION.test(s))) return null;

  const ruta = resto.join('/');
  let publicId = ruta;
  let formato: string | null = null;
  if (resourceType !== 'raw') {
    // En imagen/vídeo Cloudinary añade la extensión de ENTREGA a la URL, pero el
    // `public_id` (lo que hace falta para firmar o renombrar) va sin ella.
    // Hasta 8 caracteres de extensión, no 5: entre los archivos reales de la cuenta
    // hay uno subido con extensión `.unknown` (de una prueba de seguridad) y con el
    // tope en 5 el `public_id` deducido se quedaba con la extensión pegada, que es
    // justo el dato con el que se firma o se renombra. Nunca hay un punto dentro del
    // `public_id` real: `uploadFile()` le quita SIEMPRE la última extensión al nombre.
    const m = /^(.*)\.([A-Za-z0-9]{2,8})$/.exec(ruta);
    if (m && m[1]) { publicId = m[1]; formato = m[2].toLowerCase(); }
  }
  if (!publicId) return null;

  return {
    cloudName,
    resourceType: resourceType as TipoRecursoStorage,
    entrega: entrega as EntregaStorage,
    publica: entrega === 'upload',
    firma, version, publicId, formato,
  };
}

/**
 * ¿Esta URL salió de una subida real a NUESTRO storage?
 *
 * Mismo contrato de siempre (y mismos llamadores), ahora apoyado en el parser de
 * arriba en vez de en un `startsWith`. Es ESTRICTAMENTE MÁS CERRADO que antes: todo
 * lo que aceptaba el `startsWith` y ya no pasa — `…/<cloud>/` a secas, rutas con
 * `..`, con query o con segmentos raros — no era una URL que Cloudinary pudiera
 * habernos devuelto. Lo único que se AÑADE es el tipo de entrega `authenticated` /
 * `private`, que es la forma que tendrán los documentos cuando dejen de ser públicos:
 * sin esto, migrar un documento a privado lo volvería inválido para siempre.
 */
export function esUrlDeStorageValida(url: unknown): boolean {
  return recursoDeUrlStorage(url) !== null;
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
        // SIN extensión, también para los PDF. Se intentó conservarla para que la URL
        // terminara en `.pdf`, y hubo que revertirlo: esta cuenta de Cloudinary tiene
        // restringida la entrega de archivos reconocidos como PDF, así que el mismo
        // archivo servía 200 sin extensión y pasaba a 401 con ella. Comprobado subiendo
        // uno de prueba contra producción. La app reconoce los PDF por el segmento
        // `/raw/upload/` (ver lib/documento-tipo.ts), que no depende del nombre.
        public_id: filename.replace(/\.[^.]+$/, ''),
      },
      (err, res) => { if (err || !res) reject(err ?? new Error('Upload failed')); else resolve(res); }
    ).end(buffer);
  });

  return { url: result.secure_url, path: result.public_id };
}

// ── Entrega de un documento desde el SERVIDOR ──────────────────────────────
//
// Punto único por el que el servidor obtiene una dirección DESCARGABLE de un
// documento guardado. Es lo que permite que la verificación con IA, el ZIP de
// documentos, el acta y los contratos sigan funcionando igual antes y después de
// que un documento pase de público a privado en Cloudinary: el JSON/columna sigue
// guardando la URL canónica, y quien necesite los bytes pasa por acá.
//
// POR QUÉ NO SE LE ENTREGA ESTO AL NAVEGADOR. La firma de Cloudinary (`s--xxx--`)
// NO caduca: es un HMAC del public_id y la transformación, sin componente temporal.
// Solo caducan los enlaces construidos con `auth_token` (función de plan Advanced,
// hay que habilitarla en la cuenta) o los `private_download_url` de recursos
// `private`. Mandarle al navegador una URL firmada corriente sería, entonces,
// repetir exactamente el problema que se quiere resolver: un enlace permanente que
// abre el documento sin sesión y que no se puede revocar. Por eso las pantallas van
// por `/api/documentos/...` (ver lib/documentos-acceso.ts) y esta función se queda
// del lado del servidor.
export function urlEntregaDocumento(url: string): string {
  const rec = recursoDeUrlStorage(url);
  // No es una URL de nuestro storage (p. ej. las legado en disco `/uploads/...`):
  // se devuelve intacta. Quién puede o no descargarla lo decide la allowlist del
  // llamador, igual que antes de este cambio.
  if (!rec) return url;
  // Entrega pública: la URL guardada ya sirve tal cual. No se firma de más.
  if (rec.publica) return url;
  return cloudinary.url(rec.publicId, {
    resource_type: rec.resourceType,
    type: rec.entrega,
    secure: true,
    sign_url: true,
    // Sin el sufijo `?_a=` de analítica: la URL solo la usa el servidor para bajar
    // los bytes y una query de más solo estorba al depurar.
    analytics: false,
    ...(rec.version ? { version: rec.version.slice(1) } : {}),
    ...(rec.formato ? { format: rec.formato } : {}),
  });
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
