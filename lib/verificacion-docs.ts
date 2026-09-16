import sharp from 'sharp';
import { esPdfUrl } from '@/lib/documento-tipo';
import { getAnthropic } from './anthropic';
import { normalizarOrientacion } from './blur-placas';
import { descargarAcotado } from './descarga-remota';

export type ResultadoRegla = 'pasa' | 'falla' | 'no_aplica';
export type Veredicto    = 'aprobado' | 'rechazado' | 'revision';
export type Confianza    = 'alta' | 'media' | 'baja';

export type DatosExtraidos = {
  placa: string | null;
  numero_documento: string | null;
  nombre_titular: string | null;
  fecha_expedicion: string | null;
  fecha_vencimiento: string | null;
  vigente: boolean | null;
  entidad_emisora: string | null;
  categoria_licencia: string | null;
  otros: string | null;
};
export type Chequeo = { regla: string; resultado: ResultadoRegla; detalle: string };
export type DocResultado = {
  clave: string; etiqueta: string;
  es_legible: boolean; tipo_detectado: string;
  datos_extraidos: DatosExtraidos;
  verificaciones: Chequeo[];
  veredicto: Veredicto; confianza: Confianza; motivo: string;
};
export type VerificacionResultado = {
  documentos: DocResultado[];
  cruces: Chequeo[];
  resumen: string;
  veredicto_global: Veredicto;
};
export type DocEntrada = { clave: string; etiqueta: string; url: string };
export type ContextoVerificacion = {
  placa?: string;
  propietario?: { nombre?: string; documento?: string };
  arrendatario?: { nombre?: string; documento?: string; licencia?: string };
};

type MediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'application/pdf';

// Máximo tamaño por imagen que acepta la API de Anthropic (10 MB en base64,
// ver docs de visión). Lo comprobamos nosotros para dar un error claro por
// documento en vez de dejar que la llamada completa reviente.
const MAX_BASE64_BYTES = 10 * 1024 * 1024;

// Tope de lo que se baja de la red por archivo, antes de mirar nada más. Es el techo
// duro que evita que una URL apuntando a un archivo gigante se traiga el proceso
// abajo; la validación "este documento pesa demasiado para la IA" sigue siendo
// MAX_BASE64_BYTES, que es más estricta y da un mensaje con la cifra real.
const MAX_DESCARGA_BYTES = 20 * 1024 * 1024;

type ImgMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

const FORMATO_A_MEDIA_TYPE: Partial<Record<string, ImgMediaType>> = {
  jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
};

/** Traduce un fallo de decodificación de sharp al mensaje que verá la persona.
 * No todos esos fallos son un archivo dañado: si este build de sharp/libvips no
 * trae el códec (típico con HEIC/HEVC en algunos entornos), el mensaje lo delata
 * y no es culpa del archivo del usuario. Se comparte entre `stats()` y el
 * `resize` porque las dos rutas decodifican la imagen completa y fallan igual. */
function errorDeDecodificacion(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (/unsupported image format|error while loading plugin|no decoder for this format|heif.*not supported/i.test(msg)) {
    return new Error(`Este formato de imagen no está soportado por el servidor, aunque el archivo no esté dañado (${msg})`);
  }
  return new Error(`La imagen está dañada o incompleta, no se puede decodificar por completo (${msg})`);
}

/**
 * Descarga un documento y lo deja listo para mandarlo a Claude, validando los
 * bytes REALES con `sharp` en vez de confiar ciegamente en el `content-type`
 * que reporte el CDN (Cloudinary). Esto es clave porque el error
 * `400 "Could not process image"` de la API de Anthropic ocurre justamente
 * cuando el `media_type` declarado no coincide con los bytes, o cuando el
 * archivo está corrupto/truncado — si eso pasa acá, se lanza un error que el
 * llamador (`verificarDocumentos`) captura POR DOCUMENTO, así que un solo
 * archivo dañado no tumba la verificación completa de los demás.
 *
 * De paso, aplica `normalizarOrientacion` (misma función que usa la subida de
 * fotos) como defensa adicional para documentos que se subieron ANTES del fix
 * de orientación EXIF y siguen rotados en Cloudinary.
 *
 * Se exporta porque la inspección de daños (lib/inspeccion-vehiculo.ts) descarga
 * fotos de Cloudinary con exactamente los mismos riesgos (archivo truncado,
 * content-type mentiroso, foto de celular rotada) y duplicar estas defensas
 * garantizaría que una de las dos copias se quede atrás.
 *
 * `opts.ladoMaxPx` (opcional) reescala la imagen a ese lado largo ANTES de
 * devolverla. No es cosmético: reescalar aparte obligaba a decodificar la foto
 * dos veces (una acá para validarla, otra para reducirla) y con 16 fotos de
 * celular de 12 MP en vuelo eso es un pico de memoria capaz de tumbar el
 * contenedor entero. Haciéndolo acá, el propio `resize` hace de validación
 * (decodifica la imagen completa igual que `stats()`) y se decodifica UNA vez.
 * Sin la opción, el comportamiento es exactamente el de antes.
 */
export async function fetchAsBase64(url: string, opts?: { ladoMaxPx?: number }): Promise<{ data: string; mediaType: MediaType }> {
  // `descargarAcotado` (lib/descarga-remota.ts) en vez de un `fetch` a pelo: no sigue
  // redirecciones —un CDN que responda 302 hacia una IP interna sería una petición del
  // servidor contra su propia red— y corta el cuerpo en `maxBytes` leyendo por trozos,
  // en vez de meter en memoria lo que sea que responda el otro lado. El tope va algo
  // por encima de MAX_BASE64_BYTES para que los archivos que solo se pasan "un poco"
  // sigan dando el mensaje de tamaño de siempre, con su cifra real.
  const { buffer: buf, contentType: ct } = await descargarAcotado(url, {
    timeoutMs: 20000,
    maxBytes: MAX_DESCARGA_BYTES,
  });

  // `esPdfUrl` mira TAMBIÉN el segmento `/raw/upload/`: los PDF subidos antes de que se
  // conservara la extensión no terminan en `.pdf` y, sin esa señal, se trataban como imagen.
  const esPdf = ct === 'application/pdf' || (!ct && esPdfUrl(url));
  if (esPdf) {
    if (buf.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new Error('El archivo se declara como PDF pero no tiene una cabecera PDF válida (posible descarga corrupta)');
    }
    const dataPdf = buf.toString('base64');
    if (dataPdf.length > MAX_BASE64_BYTES) {
      throw new Error(`El PDF pesa demasiado para procesarlo (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
    }
    return { data: dataPdf, mediaType: 'application/pdf' };
  }

  const img = sharp(buf);
  const meta = await img.metadata().catch((e: unknown) => {
    throw new Error(`No se pudo leer la imagen — archivo corrupto o formato no reconocido (${e instanceof Error ? e.message : String(e)})`);
  });
  // `metadata()` solo lee la cabecera (dimensiones/formato) y NO detecta un
  // archivo truncado a mitad de los datos de píxeles — justo el caso real
  // (subida interrumpida / bug de recorte viejo) que produce el 400 "Could
  // not process image" de Anthropic. Hace falta una decodificación COMPLETA:
  // `stats()` es la forma más barata de forzarla... salvo que ya vayamos a
  // reescalar, en cuyo caso el `resize` decodifica igual y hacer las dos cosas
  // sería pagar el doble de CPU y de memoria por la misma foto.
  const ladoMax = opts?.ladoMaxPx ?? 0;
  const ladoLargo = Math.max(meta.width ?? 0, meta.height ?? 0);
  // El GIF puede ser animado: reescalarlo se comería los cuadros, así que se
  // deja intacto (igual que hace la normalización de orientación de abajo).
  const reducir = ladoMax > 0 && ladoLargo > ladoMax && meta.format !== 'gif';

  let reducida: Buffer | null = null;
  if (reducir) {
    reducida = await sharp(buf)
      .rotate() // aplica la orientación EXIF, igual que normalizarOrientacion
      .resize({ width: ladoMax, height: ladoMax, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer()
      .catch((e: unknown): never => { throw errorDeDecodificacion(e); });
  } else {
    await img.stats().catch((e: unknown): never => { throw errorDeDecodificacion(e); });
  }

  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w < 10 || h < 10) {
    throw new Error(`La imagen tiene dimensiones inválidas (${w}x${h}px) — probablemente esté corrupta o truncada`);
  }

  if (reducida) {
    // Ya viene rotada y en JPEG (formato que la API de visión acepta siempre),
    // así que no hay que pasar por normalizarOrientacion ni por el fallback de
    // recodificación de más abajo.
    const dataRed = reducida.toString('base64');
    if (dataRed.length > MAX_BASE64_BYTES) {
      throw new Error(`La imagen pesa demasiado para procesarla (${(reducida.length / 1024 / 1024).toFixed(1)} MB)`);
    }
    return { data: dataRed, mediaType: 'image/jpeg' };
  }

  const mediaTypeReal = meta.format ? FORMATO_A_MEDIA_TYPE[meta.format] : undefined;

  let bufferFinal: Buffer = buf;
  if (mediaTypeReal && mediaTypeReal !== 'image/gif') {
    // normalizarOrientacion solo re-codifica si de verdad hay una rotación
    // EXIF pendiente; si no, devuelve el buffer original intacto.
    bufferFinal = await normalizarOrientacion(buf, mediaTypeReal);
  }

  if (mediaTypeReal) {
    const dataImg = bufferFinal.toString('base64');
    if (dataImg.length > MAX_BASE64_BYTES) {
      throw new Error(`La imagen pesa demasiado para procesarla (${(bufferFinal.length / 1024 / 1024).toFixed(1)} MB)`);
    }
    return { data: dataImg, mediaType: mediaTypeReal };
  }

  // Formato que Claude no acepta directamente (heic, tiff, bmp, ...): en vez
  // de perder el documento completo, lo recodificamos a JPEG con sharp.
  try {
    const jpegBuf = await sharp(buf).rotate().jpeg({ quality: 92 }).toBuffer();
    const dataJpeg = jpegBuf.toString('base64');
    if (dataJpeg.length > MAX_BASE64_BYTES) {
      throw new Error(`La imagen pesa demasiado para procesarla (${(jpegBuf.length / 1024 / 1024).toFixed(1)} MB)`);
    }
    return { data: dataJpeg, mediaType: 'image/jpeg' };
  } catch (e) {
    throw new Error(`Formato de imagen no soportado (${meta.format ?? 'desconocido'}) y no se pudo convertir: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Duck-typing en vez de `instanceof Anthropic.APIError`: nos basta con la
 * forma del error (más robusto ante posibles duplicados del módulo del SDK
 * en distintos bundles, y no ata este código a una clase concreta del SDK).
 *
 * Antes filtrábamos por `/image|imagen/i` en el mensaje, pero los PDFs se
 * mandan como bloque `document`, no `image`, así que un rechazo de un PDF
 * corrupto usa otro vocabulario ("document", "pdf", etc.) y no entraba a
 * este fallback — tumbando el batch completo con un 502 crudo, el mismo bug
 * que este fallback existe para prevenir. Cualquier 400 de la API en esta
 * llamada (que solo envía texto + imágenes/documentos) es, en la práctica,
 * un rechazo del contenido visual, así que basta con el status.*/
function esErrorDeImagenAnthropic(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as { status?: unknown };
  return err.status === 400;
}

const DATOS_VACIOS: DatosExtraidos = {
  placa: null, numero_documento: null, nombre_titular: null,
  fecha_expedicion: null, fecha_vencimiento: null, vigente: null,
  entidad_emisora: null, categoria_licencia: null, otros: null,
};

export async function verificarDocumentos(
  ctx: ContextoVerificacion,
  docs: DocEntrada[],
): Promise<VerificacionResultado> {
  const anthropic = getAnthropic();

  // Descargar todas las imágenes en paralelo
  const archivos = await Promise.all(
    docs.map(async doc => {
      try {
        const { data, mediaType } = await fetchAsBase64(doc.url);
        return { doc, data, mediaType, ok: true };
      } catch (e) {
        return { doc, data: '', mediaType: 'image/jpeg' as MediaType, ok: false, error: String(e) };
      }
    })
  );

  // Contexto textual
  const ctxLines: string[] = ['Contexto del propietario/vehículo:'];
  if (ctx.placa)                    ctxLines.push(`- Placa registrada: ${ctx.placa}`);
  if (ctx.propietario?.nombre)      ctxLines.push(`- Nombre propietario: ${ctx.propietario.nombre}`);
  if (ctx.propietario?.documento)   ctxLines.push(`- Documento propietario: ${ctx.propietario.documento}`);
  if (ctx.arrendatario?.nombre)     ctxLines.push(`- Nombre arrendatario: ${ctx.arrendatario.nombre}`);
  if (ctx.arrendatario?.documento)  ctxLines.push(`- Documento arrendatario: ${ctx.arrendatario.documento}`);
  if (ctx.arrendatario?.licencia)   ctxLines.push(`- Licencia registrada: ${ctx.arrendatario.licencia}`);

  // Construir contenido del mensaje
  type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'base64'; media_type: MediaType; data: string } }
    | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } };

  const content: ContentBlock[] = [];

  content.push({ type: 'text', text: ctxLines.join('\n') });

  for (const a of archivos) {
    content.push({ type: 'text', text: `\n--- ${a.doc.etiqueta} (clave: ${a.doc.clave}) ---` });
    if (!a.ok) {
      content.push({ type: 'text', text: `[Error al cargar: ${a.error}]` });
      continue;
    }
    if (a.mediaType === 'application/pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data } });
    } else {
      content.push({ type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.data } });
    }
  }

  content.push({
    type: 'text',
    text: `
Eres un experto verificador de documentos para una plataforma colombiana de alquiler de vehículos (DrivePass, Medellín).

Analiza cada documento presentado arriba y devuelve un JSON con EXACTAMENTE esta estructura (sin markdown, sin texto adicional):

{
  "documentos": [
    {
      "clave": "<igual a la clave indicada>",
      "etiqueta": "<nombre del documento>",
      "es_legible": <true|false>,
      "tipo_detectado": "<SOAT|Tecno-mecánica|Tarjeta de propiedad|Seguro todo riesgo|Cédula|Licencia de conducción|Desconocido>",
      "datos_extraidos": {
        "placa": "<placa o null>",
        "numero_documento": "<número o null>",
        "nombre_titular": "<nombre o null>",
        "fecha_expedicion": "<YYYY-MM-DD o null>",
        "fecha_vencimiento": "<YYYY-MM-DD o null>",
        "vigente": <true si no ha vencido al ${new Date().toISOString().split('T')[0]}, false si venció, null si no aplica>,
        "entidad_emisora": "<aseguradora/entidad o null>",
        "categoria_licencia": "<B1, B2, C1, etc. o null>",
        "otros": "<nota adicional relevante o null>"
      },
      "verificaciones": [
        { "regla": "<nombre de la regla>", "resultado": "<pasa|falla|no_aplica>", "detalle": "<explicación>" }
      ],
      "veredicto": "<aprobado|rechazado|revision>",
      "confianza": "<alta|media|baja>",
      "motivo": "<resumen breve del veredicto>"
    }
  ],
  "cruces": [
    { "regla": "<nombre del cruce>", "resultado": "<pasa|falla|no_aplica>", "detalle": "<explicación>" }
  ],
  "resumen": "<resumen global de 1-2 oraciones>",
  "veredicto_global": "<aprobado|rechazado|revision>"
}

Reglas de verificación por tipo de documento:
- SOAT: vigente, placa coincide con el contexto, nombre del propietario o aseguradora visible
- Tecno-mecánica: vigente, placa coincide, emitida por el RUNT o CDA autorizado
- Tarjeta de propiedad: placa coincide, nombre del titular coincide con el propietario del contexto
- Seguro todo riesgo: vigente, placa o nombre del titular visible
- Cédula: número coincide con el documento del contexto, legible, no manipulada
- Licencia de conducción: número coincide con el contexto, vigente, categoría visible

Cruces entre documentos (si hay más de uno):
- La placa en SOAT debe coincidir con la placa en la tarjeta de propiedad
- El nombre del titular en la tarjeta de propiedad debe coincidir con la cédula del propietario
- La fecha de vigencia del SOAT debe cubrir el período actual

Usa "revision" cuando algo es legible pero no puedes confirmar con certeza.
Usa "rechazado" solo cuando hay un problema claro (vencido, datos no coinciden, documento falso/manipulado).
Usa confianza "alta" solo cuando puedes leer claramente los datos y todo cuadra.
Si en vez de una imagen o documento ves un texto "[Error al cargar: ...]" para alguno de los documentos, significa que no se pudo procesar ese archivo: para ese documento en particular, devuelve "es_legible": false y "veredicto": "revision", con el motivo indicando que el archivo no se pudo cargar.`,
  });

  type AnthropicContent = Parameters<typeof anthropic.messages.create>[0]['messages'][0]['content'];

  let resp;
  try {
    resp = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 4000,
      messages: [{ role: 'user', content: content as AnthropicContent }],
    });
  } catch (e) {
    // Defensa adicional: la validación de arriba (sharp) descarta la gran
    // mayoría de imágenes corruptas/truncadas ANTES de llegar aquí, pero si
    // la API igual rechaza el lote completo por un problema de imagen que no
    // detectamos localmente, reintentamos UNA vez sin ningún bloque
    // image/document (solo texto) para no tumbar con un 502 crudo la
    // verificación de los documentos que sí eran válidos — Claude no podrá
    // leer ninguna imagen en este reintento, pero al menos deja un veredicto
    // "revisión" explicando qué pasó en vez de reventar toda la respuesta.
    const hayBloquesVisuales = content.some(b => b.type !== 'text');
    if (!esErrorDeImagenAnthropic(e) || !hayBloquesVisuales) throw e;

    const contentSoloTexto = content.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text');
    contentSoloTexto.push({
      type: 'text',
      text: '\n[Aviso del sistema: la API de IA rechazó procesar las imágenes/documentos de este lote. No pudiste ver ninguna imagen en este intento — marca TODOS los documentos anteriores con "es_legible": false, "veredicto": "revision" y "motivo": "No se pudo procesar la imagen con la IA; vuelve a subir el documento e intenta de nuevo."]',
    });
    resp = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 4000,
      messages: [{ role: 'user', content: contentSoloTexto as AnthropicContent }],
    });
  }

  const text = resp.content[0].type === 'text' ? resp.content[0].text.trim() : '';

  // Extraer JSON de la respuesta
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('La IA no devolvió JSON válido');

  let resultado: VerificacionResultado;
  try {
    resultado = JSON.parse(match[0]) as VerificacionResultado;
  } catch {
    throw new Error('No se pudo parsear la respuesta de la IA');
  }

  // Rellenar campos faltantes defensivamente
  for (const d of resultado.documentos) {
    d.datos_extraidos = { ...DATOS_VACIOS, ...d.datos_extraidos };
    d.verificaciones  = d.verificaciones ?? [];
  }
  resultado.cruces          = resultado.cruces ?? [];
  resultado.resumen         = resultado.resumen ?? '';
  resultado.veredicto_global = resultado.veredicto_global ?? 'revision';

  return resultado;
}

export function decisionHibrida(doc: DocResultado): 'auto_aprobado' | 'revision_humana' {
  const sinFallas = doc.verificaciones.every(v => v.resultado !== 'falla');
  if (doc.veredicto === 'aprobado' && doc.confianza === 'alta' && doc.es_legible && sinFallas) {
    return 'auto_aprobado';
  }
  return 'revision_humana';
}
