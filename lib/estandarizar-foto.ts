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

    // `.clahe()` corre DESPUÉS del `.resize()` de arriba, así que su rejilla debe
    // calcularse sobre las dimensiones YA REDIMENSIONADAS (máx. `TARGET`px de lado
    // mayor), no sobre `w`/`h` del buffer ORIGINAL: usar las del original (bug real
    // encontrado por revisor de código) infla el tile 2-4× para cualquier foto de
    // celular moderna (>1600px), y en aspectos muy anchos/altos el tile pedido puede
    // superar directamente el lado menor de la imagen procesada y hacer que sharp
    // LANCE ("hist_local: window too large") — esa excepción, atrapada por el
    // try/catch general, descarta TODO el procesamiento (mejora + remove.bg) y
    // degrada en silencio a la foto cruda justo para esa clase de imágenes.
    // Por eso acá se materializa primero el resize (+ flatten) en un buffer real y
    // se lee su tamaño real con `info` antes de decidir el tile.
    const { data: resizedBuf, info: resizedInfo } = await pipeline
      .flatten({ background: '#ffffff' }) // por si el PNG de entrada trae alfa real
      .toBuffer({ resolveWithObject: true });
    const anchoProcesado = resizedInfo.width;
    const altoProcesado = resizedInfo.height;
    const ladoMenorProcesado = Math.min(anchoProcesado, altoProcesado);

    // Tile ~1/8 del lado mayor YA redimensionado (mínimo 64px), NO un tamaño fijo
    // pequeño: con tiles de solo 16px (el valor anterior) el realce de contraste
    // local queda hiper-granular y produce halos/posterizado tipo "HDR barato" (bug
    // real reportado por el usuario con una foto de producción, reproducido y
    // confirmado antes de este fix). Con tiles ~1/8 del lado mayor y maxSlope bajo (1,
    // el mínimo permitido por sharp), el realce de sombras/luces queda sutil e
    // imperceptible como "efecto", en vez de dominar la imagen. Se quitó `.normalise()`
    // (estiramiento global de histograma) porque competía con clahe y sumaba dureza.
    // Techo defensivo al 90% del lado MENOR real (deja margen, no el 100% exacto):
    // aunque el cálculo de arriba ya usa las dimensiones correctas, este clamp
    // garantiza en profundidad que el tile nunca pueda igualar/superar el límite que
    // hace lanzar a sharp, incluso ante algún caso borde no contemplado. Si el techo
    // quedara por debajo del piso de 64 (imagen resultante muy chica), se prefiere
    // relajar el piso hacia abajo (usar el techo) antes que arriesgar una excepción.
    const tileClaheDeseado = Math.round(Math.max(anchoProcesado, altoProcesado) / 8);
    const techoDefensivo = Math.max(1, Math.floor(ladoMenorProcesado * 0.9));
    const tileClahe = Math.min(Math.max(64, tileClaheDeseado), techoDefensivo);
    const mejorada = await sharp(resizedBuf)
      .clahe({ width: tileClahe, height: tileClahe, maxSlope: 1 })
      .modulate({ brightness: 1.02, saturation: 1.06 })
      .gamma(1.02)
      .sharpen({ sigma: 0.5 })
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

    // 3) `crop: 'false'` (más abajo, en el form-data a remove.bg) deja el recorte con
    //    RGBA en las mismas dimensiones/posición que la foto enviada — el auto puede
    //    quedar en cualquier parte del cuadro (arriba, a un lado), y componerlo tal
    //    cual sobre el fondo de estudio con una sombra a una altura fija (bug real
    //    reportado: el auto quedaba "flotando", con la sombra sin alinear a las
    //    llantas). Por eso primero se recorta al bounding box REAL del contenido no
    //    transparente (`trim`), y luego se arma un lienzo nuevo con márgenes
    //    proporcionales consistentes alrededor del auto ya recortado — así todos los
    //    vehículos quedan con el mismo encuadre tipo catálogo, y la sombra se calcula
    //    respecto al borde inferior real del auto, no a un porcentaje fijo del lienzo
    //    original.
    const { data: autoRecortado, info: autoInfo } = await sharp(cutout)
      .trim({ threshold: 10 })
      .toBuffer({ resolveWithObject: true });
    const carW = autoInfo.width;
    const carH = autoInfo.height;

    // Márgenes proporcionales al tamaño del auto ya recortado: 8% a los lados, 12%
    // arriba (aire para la cabeza), 24% abajo (espacio para que la sombra respire sin
    // quedar pegada al borde del lienzo, y para que la marca de agua del logo en la
    // esquina inferior derecha no quede encima del auto).
    const padSide = Math.round(carW * 0.08);
    const padTop = Math.round(carH * 0.12);
    const padBottom = Math.round(carH * 0.24);
    const width = carW + padSide * 2;
    const height = carH + padTop + padBottom;

    // Fondo "estudio navy corporativo" con marca de agua del logo DrivePass: Victor
    // aprobó este estilo tras ver 4 mockups reales (con un cutout real de remove.bg)
    // — reemplaza el fondo gris genérico anterior por el degradado navy de marca, y
    // agrega el ícono de la marca (flechas de intercambio, estilo del logo) como
    // marca de agua discreta en la esquina inferior derecha. El `<g transform>` del
    // ícono está calibrado visualmente (centra el viewBox 96x96 del ícono a 30px del
    // borde inferior derecho, escalado a 0.26) — no simplificar esos números.
    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="bg" cx="50%" cy="28%" r="85%">
            <stop offset="0%" stop-color="#2c4a73"/>
            <stop offset="100%" stop-color="#111f34"/>
          </radialGradient>
          <filter id="blur"><feGaussianBlur stdDeviation="${Math.round(carW * 0.02)}"/></filter>
        </defs>
        <rect width="100%" height="100%" fill="url(#bg)"/>
        <ellipse cx="${width / 2}" cy="${padTop + carH - carH * 0.02}" rx="${carW * 0.38}" ry="${carH * 0.035}" fill="#00000060" filter="url(#blur)"/>
        <g transform="translate(${width - 30 - 48 * 0.26},${height - 30 - 48 * 0.26}) scale(0.26)">
          <path d="M26 38 H63" fill="none" stroke="#F25C2B" stroke-width="8" stroke-linecap="round"/>
          <polyline points="55,29 66,38 55,47" fill="none" stroke="#F25C2B" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M70 58 H33" fill="none" stroke="#F4F6FA" stroke-width="8" stroke-linecap="round"/>
          <polyline points="41,49 30,58 41,67" fill="none" stroke="#F4F6FA" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
        </g>
      </svg>
    `;
    const fondo = await sharp(Buffer.from(svg)).png().toBuffer();

    // 4) Componer el auto recortado sobre el fondo de estudio (posicionado con los
    //    márgenes ya calculados) y codificar en WebP.
    const finalBuffer = await sharp(fondo)
      .composite([{ input: autoRecortado, left: padSide, top: padTop }])
      .webp({ quality: 90 })
      .toBuffer();

    return { buffer: finalBuffer, contentType: 'image/webp' };
  } catch (err) {
    console.error('[estandarizar-foto] fallo, se guarda la foto tal como llegó (placa ya difuminada si aplicaba):', err);
    return null;
  }
}
