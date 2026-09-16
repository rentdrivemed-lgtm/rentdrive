// ── La imagen de la firma: validarla de verdad y normalizarla ───────────────
//
// El dueño pidió dos vías para firmar: «que la persona cargue su firma digital o
// que utilice el celular para firmar». La segunda (trazo en pantalla) ya existía
// para las cuentas de cobro y produce siempre un PNG limpio de un <canvas>
// (components/FirmaCanvas.tsx). La primera es la que necesita este archivo: lo
// que sube la gente es la FOTO DE UNA HOJA —con márgenes, sombra y a veces el
// escritorio de fondo—, no un trazo recortado.
//
// Dos responsabilidades, separadas a propósito:
//
//   1. `validarFirmaPng` — el portero. Lo llama SIEMPRE la ruta que escribe una
//      firma en la base, venga de donde venga. Mira los BYTES (firma mágica del
//      PNG y cabecera IHDR), nunca el `content-type` que declare el cliente, que
//      es texto libre que manda el atacante. Acota tamaño y dimensiones.
//
//   2. `normalizarFirmaSubida` — la comodidad. Recorta los márgenes, deja el
//      trazo sobre fondo TRANSPARENTE y lo reduce a un tamaño de firma. NO es un
//      control de seguridad: quien llame a la API directamente puede saltárselo y
//      mandar un PNG sin normalizar; lo peor que consigue es una firma fea, y el
//      portero del punto 1 sigue aplicando.
//
// ⚠️ Módulo de SERVIDOR (usa `Buffer` y `sharp`): no importar desde un componente
// 'use client'.

import sharp from 'sharp';

// ── Límites ─────────────────────────────────────────────────────────────────

/** Único formato que se GUARDA. Mismo prefijo que produce `canvas.toDataURL('image/png')`. */
export const FIRMA_PNG_PREFIJO = 'data:image/png;base64,';

/**
 * Techo de la imagen ya decodificada. Mismo criterio y mismo número que las
 * cuentas de cobro (lib/contabilidad.ts): 200 KB sobra para un trazo, y sin el
 * tope una firma de decenas de MB se queda en la base para siempre (una firma no
 * se puede sobrescribir).
 */
export const FIRMA_PNG_MAX_BYTES = 200 * 1024;

/** Cota rápida por longitud de cadena, antes de gastar en decodificar base64 (~4/3). */
export const FIRMA_PNG_MAX_BASE64_CHARS = Math.ceil((FIRMA_PNG_MAX_BYTES / 3) * 4) + 8;
export const FIRMA_PNG_MAX_CHARS_TOTAL = FIRMA_PNG_PREFIJO.length + FIRMA_PNG_MAX_BASE64_CHARS;

/** Dimensiones admisibles del PNG guardado. Un 1×1 no es una firma; un mural tampoco. */
export const FIRMA_PNG_MIN_LADO = 8;
export const FIRMA_PNG_MAX_LADO = 4000;

/** Techo de lo que se acepta SUBIR para normalizar (foto de celular sin comprimir). */
export const FIRMA_SUBIDA_MAX_BYTES = 8 * 1024 * 1024;
export const FIRMA_SUBIDA_MAX_BASE64_CHARS = Math.ceil((FIRMA_SUBIDA_MAX_BYTES / 3) * 4) + 64;

/** Alto y ancho máximos del PNG normalizado que se devuelve. */
const SALIDA_ALTO_MAX = 180;
const SALIDA_ANCHO_MAX = 720;

/** Lado máximo al que se reduce la imagen ANTES de analizarla (acota el costo de CPU). */
const ANALISIS_LADO_MAX = 1200;

/** Color del trazo normalizado. El mismo que dibuja components/FirmaCanvas.tsx. */
const TINTA = { r: 17, g: 24, b: 39 };

// ── 1 · El portero: ¿esto es un PNG de verdad y de un tamaño razonable? ──────

export type FirmaValida = { ok: true; bytes: Buffer; ancho: number; alto: number };
export type FirmaInvalida = { ok: false; error: string };

/** Los 8 bytes con que empieza TODO archivo PNG (RFC 2083, §3.1). */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Valida el data URI que se va a GUARDAR como firma.
 *
 * Se comprueba sobre los bytes decodificados, no sobre lo que diga la cadena: el
 * prefijo `data:image/png;base64,` lo escribe el cliente y no prueba nada. Si los
 * bytes no empiezan por la firma mágica del PNG, o la cabecera IHDR no está donde
 * manda el formato, se rechaza.
 */
export function validarFirmaPng(dataUrl: string): FirmaValida | FirmaInvalida {
  const s = String(dataUrl ?? '').trim();
  if (!s) return { ok: false, error: 'Falta el trazo de la firma.' };
  if (!s.startsWith(FIRMA_PNG_PREFIJO) || s.length <= FIRMA_PNG_PREFIJO.length) {
    return { ok: false, error: 'La firma debe llegar como imagen PNG.' };
  }
  const base64 = s.slice(FIRMA_PNG_PREFIJO.length);
  if (base64.length > FIRMA_PNG_MAX_BASE64_CHARS) {
    return { ok: false, error: 'La imagen de la firma es demasiado pesada.' };
  }
  // `Buffer.from(..., 'base64')` ignora en silencio lo que no sea base64, así que
  // una cadena con basura produciría un búfer corto en vez de un error. Se valida
  // el alfabeto aparte para no tragarse entradas malformadas.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return { ok: false, error: 'La imagen de la firma no es válida.' };
  }
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length > FIRMA_PNG_MAX_BYTES) {
    return { ok: false, error: 'La imagen de la firma es demasiado pesada.' };
  }
  // 8 (magia) + 4 (largo IHDR) + 4 ('IHDR') + 8 (ancho y alto) = 24 bytes mínimos.
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_MAGIC) || bytes.subarray(12, 16).toString('ascii') !== 'IHDR') {
    return { ok: false, error: 'El archivo no es una imagen PNG válida.' };
  }
  const ancho = bytes.readUInt32BE(16);
  const alto = bytes.readUInt32BE(20);
  if (
    ancho < FIRMA_PNG_MIN_LADO || alto < FIRMA_PNG_MIN_LADO ||
    ancho > FIRMA_PNG_MAX_LADO || alto > FIRMA_PNG_MAX_LADO
  ) {
    return { ok: false, error: 'La imagen de la firma tiene un tamaño fuera de rango.' };
  }
  return { ok: true, bytes, ancho, alto };
}

// ── 2 · La comodidad: recortar márgenes y dejar solo el trazo ───────────────

/** Formatos que se aceptan SUBIR (se reconocen por sus bytes, no por el nombre). */
const MAGIAS_ENTRADA: Array<{ nombre: string; test: (b: Buffer) => boolean }> = [
  { nombre: 'png', test: b => b.subarray(0, 8).equals(PNG_MAGIC) },
  { nombre: 'jpeg', test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { nombre: 'webp', test: b => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
];

export type NormalizacionOk = { ok: true; dataUrl: string; ancho: number; alto: number };
export type NormalizacionError = { ok: false; error: string };

/** Decodifica un data URI de entrada (cualquier formato) a bytes, con tope de tamaño. */
function bytesDeSubida(dataUrl: string): Buffer | null {
  const s = String(dataUrl ?? '').trim();
  const m = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/]+={0,2})$/i.exec(s);
  if (!m) return null;
  if (m[1].length > FIRMA_SUBIDA_MAX_BASE64_CHARS) return null;
  const bytes = Buffer.from(m[1], 'base64');
  return bytes.length > 0 && bytes.length <= FIRMA_SUBIDA_MAX_BYTES ? bytes : null;
}

/**
 * Convierte la imagen que subió el firmante en un PNG de firma: fondo
 * transparente, márgenes recortados y tamaño acotado.
 *
 * Cómo decide qué es trazo y qué es papel: pasa la imagen a gris, calcula la
 * media (que en una hoja fotografiada es el papel) y toma como umbral una
 * fracción de esa media. Todo lo más oscuro que el umbral es tinta, con una
 * transparencia proporcional a cuánto más oscuro sea —así el borde suavizado del
 * trazo no queda dentado—. Es un umbral GLOBAL: con una sombra muy marcada
 * atravesando la hoja se comerá parte del papel. Se prefirió eso a un método
 * adaptativo mucho más caro, porque el resultado lo ve el firmante ANTES de
 * firmar y puede repetir la foto.
 */
export async function normalizarFirmaSubida(dataUrl: string): Promise<NormalizacionOk | NormalizacionError> {
  const entrada = bytesDeSubida(dataUrl);
  if (!entrada) return { ok: false, error: 'La imagen no es válida o es demasiado pesada.' };
  if (!MAGIAS_ENTRADA.some(f => f.test(entrada))) {
    return { ok: false, error: 'El archivo no es una imagen PNG, JPG o WEBP.' };
  }

  try {
    // `rotate()` sin argumentos aplica la orientación EXIF: sin esto, la foto de un
    // celular llega acostada y el recorte se calcula sobre la imagen girada.
    const gris = sharp(entrada)
      .rotate()
      .resize({ width: ANALISIS_LADO_MAX, height: ANALISIS_LADO_MAX, fit: 'inside', withoutEnlargement: true })
      // Aplana sobre blanco: si la imagen ya venía con transparencia (un PNG de firma
      // recortado), el canal alfa se convierte en papel y el umbral lo descarta solo.
      .flatten({ background: '#ffffff' })
      .greyscale();

    const { data, info } = await gris.raw().toBuffer({ resolveWithObject: true });
    const total = info.width * info.height;
    if (total === 0) return { ok: false, error: 'La imagen no es válida.' };

    let suma = 0;
    for (let i = 0; i < total; i++) suma += data[i];
    const media = suma / total;
    const umbral = Math.max(40, Math.min(225, media * 0.82));

    const alfa = new Uint8Array(total);
    let minX = info.width, minY = info.height, maxX = -1, maxY = -1, tinta = 0;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const i = y * info.width + x;
        const g = data[i];
        if (g >= umbral) continue;
        const a = Math.round((255 * (umbral - g)) / umbral);
        if (a < 16) continue;
        alfa[i] = a;
        tinta++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    if (maxX < 0) return { ok: false, error: 'No se detectó ningún trazo en la imagen. Usa una foto de la firma sobre papel claro.' };
    // Una imagen casi entera "tinta" no es una firma: es una foto oscura, una pantalla
    // fotografiada o un fondo de color. Mejor decirlo que guardar un borrón.
    if (tinta / total > 0.7) {
      return { ok: false, error: 'La imagen es demasiado oscura para separar la firma del fondo. Toma la foto con más luz, sobre papel blanco.' };
    }

    const margen = Math.max(2, Math.round(Math.max(maxX - minX, maxY - minY) * 0.04));
    const x0 = Math.max(0, minX - margen);
    const y0 = Math.max(0, minY - margen);
    const x1 = Math.min(info.width - 1, maxX + margen);
    const y1 = Math.min(info.height - 1, maxY + margen);
    const ancho = x1 - x0 + 1;
    const alto = y1 - y0 + 1;

    // RGBA del recorte: tinta de color fijo, transparencia = la calculada arriba.
    const rgba = Buffer.alloc(ancho * alto * 4);
    for (let y = 0; y < alto; y++) {
      for (let x = 0; x < ancho; x++) {
        const origen = (y + y0) * info.width + (x + x0);
        const destino = (y * ancho + x) * 4;
        rgba[destino] = TINTA.r;
        rgba[destino + 1] = TINTA.g;
        rgba[destino + 2] = TINTA.b;
        rgba[destino + 3] = alfa[origen];
      }
    }

    const png = await sharp(rgba, { raw: { width: ancho, height: alto, channels: 4 } })
      .resize({ width: SALIDA_ANCHO_MAX, height: SALIDA_ALTO_MAX, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true });

    if (png.data.length > FIRMA_PNG_MAX_BYTES) {
      return { ok: false, error: 'La firma normalizada quedó demasiado pesada. Recorta la foto y vuelve a intentarlo.' };
    }
    return {
      ok: true,
      dataUrl: FIRMA_PNG_PREFIJO + png.data.toString('base64'),
      ancho: png.info.width,
      alto: png.info.height,
    };
  } catch (e) {
    console.error('[firma-imagen] no se pudo normalizar la firma subida:', e instanceof Error ? e.message : e);
    return { ok: false, error: 'No se pudo procesar la imagen. Intenta con otra foto.' };
  }
}
