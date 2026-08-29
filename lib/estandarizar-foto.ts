import sharp from 'sharp';

// ── Estandarización de fotos de PUBLICACIÓN de vehículo con IA ──
//
// Alcance: SOLO las fotos que el propietario sube al publicar un carro
// (`FotoUpload.tsx` → `POST /api/upload` con `tipo=vehiculo`, y solo si el
// usuario es propietario/admin — ver el chequeo de rol en `app/api/upload/
// route.ts`). Es puramente COSMÉTICO: a diferencia del flag `blurPlaca` que
// existió antes y se eliminó por inseguro (dejaba saltar la moderación con
// solo omitirlo), este `tipo` NUNCA gatea moderación ni difuminado de placa
// — esos corren siempre, para toda imagen, sin importar este campo.
//
// Por qué se llama DESPUÉS de `detectarYDifuminarPlaca` (en el caller) y no
// antes: esa función ya deja el buffer con la orientación EXIF normalizada
// y, si corresponde, la placa cubierta con el rectángulo 100% opaco de marca
// (navy + borde naranja + logo) — el color/diseño exacto puede cambiar, lo
// único que importa acá es que el relleno sigue siendo 100% opaco.
// Como esa cobertura queda pintada sobre la carrocería (dentro de la
// silueta real del carro), viaja intacta al recorte de fondo de acá abajo:
// remove.bg no puede "revelar" la placa tapada porque ya no existe en los
// píxeles que recibe. Si esta función corriera ANTES, el orden se invierte
// y ya no hay garantía de que el recorte conserve exactamente esos píxeles.
//
// Por qué NO debe tocar nada más:
// - Documentos (cédulas, licencias, SOAT, tarjeta de propiedad): son evidencia
//   legal/identidad que el verificador de IA (`lib/verificacion-docs.ts`) lee
//   tal cual; alterar la imagen (fondo, nitidez, color) podría distorsionar
//   texto o datos y arruinar la verificación. Usan `/api/upload/documento`,
//   que ni siquiera importa este archivo.
// - Fotos de inspección de salida/entrada (`OperacionesPanel.tsx` /
//   `/api/m/[token]/upload`): son EVIDENCIA de daños del vehículo que compara
//   `lib/inspeccion-vehiculo.ts`. Quitar el fondo o "mejorar" la imagen podría
//   ocultar o distorsionar un rayón/abolladura real. `OperacionesPanel` llama
//   a `/api/upload` sin mandar `tipo`, así que nunca entra a este branch.
//
// Motor: remove.bg (decisión tomada con el dueño del proyecto, con Cloudinary
// ya integrado como storage — Cloudinary también ofrece un add-on propio de
// quitado de fondo, pero se mantiene remove.bg tal como se decidió). Es
// 100% best-effort: si falta la clave, si remove.bg falla, da timeout, o
// sharp truena en cualquier paso, se retorna `null` y quien llama debe seguir
// guardando la foto tal como llegó (ya con placa difuminada). Esta función
// NUNCA lanza (throw) hacia afuera de su propio try/catch.

export type FotoEstandarizada = { buffer: Buffer; contentType: string };

const TARGET = 1600; // px del lado mayor, tamaño "de catálogo" estándar

export async function estandarizarFotoVehiculo(
  original: Buffer
): Promise<FotoEstandarizada | null> {
  // Función opcional apagada por defecto: sin clave no hay nada que hacer,
  // y no es un error (no logueamos), simplemente el caller usa el buffer tal cual.
  if (!process.env.REMOVE_BG_API_KEY) return null;

  try {
    // 1) Mejora de calidad (contraste, brillo, sombras/luces, nitidez) antes de
    //    mandar a remove.bg. `.rotate()` es un no-op de defensa en profundidad:
    //    el buffer que llega acá ya pasó por `normalizarOrientacion` en
    //    lib/blur-placas.ts, así que normalmente no queda tag EXIF pendiente.
    const base = sharp(original).rotate();
    const meta = await base.clone().metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    const ladoMayor = Math.max(w, h);

    // `fit: 'inside'` preserva el aspecto sin recortar ni distorsionar. Fotos
    // minúsculas (<400px) no se fuerzan a 1600 (se verían artificiales), solo
    // se evita agrandarlas de más.
    const pipeline = base.clone().resize({
      width: TARGET,
      height: TARGET,
      fit: 'inside',
      withoutEnlargement: ladoMayor < 400 || ladoMayor > TARGET,
      kernel: sharp.kernel.lanczos3,
    });

    const mejorada = await pipeline
      .flatten({ background: '#ffffff' }) // por si el PNG de entrada trae alfa real
      .normalise()
      .clahe({ width: 16, height: 16, maxSlope: 3 }) // recupera detalle en sombras/luces
      .modulate({ brightness: 1.02, saturation: 1.07 })
      .gamma(1.04)
      .sharpen({ sigma: 0.6 })
      .jpeg({ quality: 92 })
      .toBuffer();

    // 2) Quitar el fondo con remove.bg (motor ya decidido, no cambiar).
    const form = new FormData();
    // `new Uint8Array(mejorada)` copia a un ArrayBuffer "puro" (no ArrayBufferLike):
    // el tipo de Buffer no encaja con BlobPart en este TS/lib.dom tan estricto.
    form.append('image_file', new Blob([new Uint8Array(mejorada)], { type: 'image/jpeg' }), 'foto.jpg');
    form.append('size', 'auto');
    form.append('type', 'car');
    form.append('format', 'png');
    form.append('crop', 'false');

    const res = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: { 'X-Api-Key': process.env.REMOVE_BG_API_KEY },
      body: form,
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) {
      let detalle: string;
      try {
        detalle = JSON.stringify(await res.json());
      } catch {
        detalle = await res.text().catch(() => '');
      }
      throw new Error(`remove.bg respondió ${res.status}: ${detalle}`);
    }

    const cutout = Buffer.from(await res.arrayBuffer()); // PNG RGBA, fondo transparente

    // 3) Fondo de estudio gris claro con sombra suave, del mismo tamaño real
    //    que devolvió remove.bg (no asumimos que coincide con lo enviado).
    const cutoutMeta = await sharp(cutout).metadata();
    const width = cutoutMeta.width ?? 1600;
    const height = cutoutMeta.height ?? 1600;

    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="bg" cx="50%" cy="35%" r="75%">
            <stop offset="0%" stop-color="#f4f4f5"/>
            <stop offset="100%" stop-color="#dcdde0"/>
          </radialGradient>
          <filter id="blur"><feGaussianBlur stdDeviation="${Math.round(width * 0.02)}"/></filter>
        </defs>
        <rect width="100%" height="100%" fill="url(#bg)"/>
        <ellipse cx="${width / 2}" cy="${height * 0.92}" rx="${width * 0.35}" ry="${height * 0.05}" fill="#00000030" filter="url(#blur)"/>
      </svg>
    `;
    const fondo = await sharp(Buffer.from(svg)).png().toBuffer();

    // 4) Componer el recorte sobre el fondo de estudio y codificar en WebP.
    const finalBuffer = await sharp(fondo)
      .composite([{ input: cutout }])
      .webp({ quality: 90 })
      .toBuffer();

    return { buffer: finalBuffer, contentType: 'image/webp' };
  } catch (err) {
    console.error('[estandarizar-foto] fallo, se guarda la foto tal como llegó (placa ya difuminada si aplicaba):', err);
    return null;
  }
}
