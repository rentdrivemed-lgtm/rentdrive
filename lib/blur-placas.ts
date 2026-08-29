import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';

const client = new Anthropic();

type PlacaDeteccion = {
  plate_visible: boolean;
  region?: { x_pct: number; y_pct: number; w_pct: number; h_pct: number };
  inappropriate_content: boolean;
  inappropriate_reason?: string;
};

/**
 * Normaliza la orientación EXIF de una imagen "horneando" la rotación en los
 * píxeles (sharp `.rotate()` sin argumentos usa el tag EXIF de orientación
 * del propio buffer y luego lo limpia). Debe llamarse ANTES de cualquier
 * otro procesamiento: evita que las fotos de celular (que casi siempre traen
 * orientación EXIF en vez de píxeles ya rotados) terminen "de lado" cuando
 * algún paso posterior (p. ej. `sharp().jpeg()`/`.composite()`) re-codifica
 * la imagen y descarta esa metadata sin haber aplicado la rotación real.
 *
 * Si la imagen NO trae tag de orientación EXIF (o ya es la orientación
 * normal, valor 1), no hay nada que corregir: se devuelve el buffer
 * ORIGINAL sin re-codificar, para no perder calidad en documentos legales
 * (cédulas, licencias, SOAT, tarjeta de propiedad) que dependen de nitidez
 * para la verificación automática con IA (`lib/verificacion-docs.ts`).
 * Cuando sí hay que rotar, se re-codifica preservando calidad explícita
 * según el formato de entrada (`mediaType`) en vez de usar los defaults de
 * sharp, que comprimen más de lo deseado.
 */
export async function normalizarOrientacion(
  buffer: Buffer,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' = 'image/jpeg'
): Promise<Buffer> {
  try {
    const metadata = await sharp(buffer).metadata();
    if (!metadata.orientation || metadata.orientation === 1) {
      // Sin corrección EXIF pendiente: no tocar los bytes originales.
      return buffer;
    }

    const rotada = sharp(buffer).rotate();
    const salida = mediaType === 'image/png'
      ? rotada.png()
      : mediaType === 'image/webp'
      ? rotada.webp({ quality: 95 })
      : rotada.jpeg({ quality: 95 });

    return await salida.toBuffer();
  } catch (err) {
    console.error('[blur-placas] No se pudo normalizar la orientación EXIF, se usa la imagen original:', err);
    return buffer;
  }
}

export type ResultadoDeteccion = {
  buffer: Buffer;
  difuminada: boolean;
  /** true si la IA marcó la foto como contenido sexual/explícito claramente inapropiado. */
  contenidoInapropiado: boolean;
  motivoInapropiado?: string;
  /**
   * false si, por CUALQUIER motivo (sin API key, error de red/API, o respuesta sin JSON
   * válido), la IA NO llegó a evaluar el contenido de esta foto — en ese caso
   * `contenidoInapropiado` queda en `false` en el valor que devuelve ESTA función (para no
   * inventar un resultado de moderación que nunca se produjo), pero eso NO es lo mismo que
   * "la IA revisó la foto y la encontró apropiada". Esta misma función ya deja rastro
   * distintivo en el log en cada uno de esos casos (ver los `console.error(...
   * [MODERACION-NO-EVALUADA]...)` más abajo). El call site (app/api/upload/route.ts) debe
   * leer este campo y tratarlo FAIL-CLOSED — igual que si `contenidoInapropiado` fuera
   * `true` (a revisión manual) — en vez de fail-open (aprobada en silencio).
   */
  moderacionEvaluada: boolean;
};

export async function detectarYDifuminarPlaca(
  bufferOriginal: Buffer,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' = 'image/jpeg'
): Promise<ResultadoDeteccion> {
  // Corregir orientación EXIF primero: tanto la imagen que ve Claude como la
  // región que recortamos/componemos deben trabajar sobre los mismos píxeles
  // "derechos", si no el % de región que calcula Claude (sobre la imagen ya
  // rotada) no coincide con las coordenadas de un buffer sin rotar.
  const buffer = await normalizarOrientacion(bufferOriginal, mediaType);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('[blur-placas][MODERACION-NO-EVALUADA] ANTHROPIC_API_KEY no configurada — foto subida SIN evaluar contenido ni difuminar placa (fail-open: se trata como apropiada por defecto)');
    return { buffer, difuminada: false, contenidoInapropiado: false, moderacionEvaluada: false };
  }

  // Normalizar a JPEG para base64 (menor tamaño)
  const jpegBuf = await sharp(buffer).jpeg({ quality: 85 }).toBuffer();
  const base64 = jpegBuf.toString('base64');

  let deteccion: PlacaDeteccion = { plate_visible: false, inappropriate_content: false };

  let text = '';
  let stopReason: string | null | undefined;
  try {
    const resp = await client.messages.create({
      model: 'claude-opus-4-8',
      // Se pide razonar en prosa antes del JSON final (ver prompt más abajo),
      // así que dejamos margen extra sobre el mínimo previo (1024) para que
      // ese razonamiento no trunque la respuesta antes de cerrar el JSON.
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
          },
          {
            type: 'text',
            text: `You are inspecting a photo of a car (this is one photo out of a set: front, back, sides, interior) to find and locate its license plate (Colombian plate, e.g. "KZR957" — yellow background with black bold characters for private cars).

IMPORTANT: search actively for the plate at ANY angle the photo happens to show — do NOT assume the car is facing front. Colombian plates can appear:
- On the FRONT of the car, usually mounted below the grille/logo, above or on the front bumper.
- On the BACK of the car, usually mounted above or below the tail lights, on the trunk/bumper area.
- At a 3/4 or side angle, partially foreshortened, smaller, or at a slant — still look for it.
- Sometimes partially obscured, reflective, small in the frame, or off-center — still try to find it if any part of it is legible or even just visible.

EXCEPTION — full/pure side-profile photos: if the photo shows a full lateral profile of the car (the entire side of the vehicle, doors/wheels/side panels) and NEITHER the front bumper/grille NOR the rear bumper/trunk is actually visible in the frame, then the plate is physically NOT in the shot in most such photos — set plate_visible to false in that case. Only set it to true for a side-profile-looking photo if you can genuinely see a sliver of the front or rear of the car at a 3/4 angle (even a small corner of the bumper/grille/tail lights) AND the plate itself is visible on that sliver — do not infer a plate's location just because "a car should have one somewhere".

CONFIDENCE: this rule exists ONLY to stop you from pointing at a BACKGROUND object (a building, sign, billboard, window, graffiti, storefront, or anything not physically attached to the car) and mistaking it for a plate — never mark plate_visible true just because "there should be a plate somewhere in this scene". It is NOT a reason to discard a plate that is genuinely mounted on the car's own bodywork just because it is small, blurry, partially cut off, reflective, or seen at a steep angle — for that case, keep applying the "search actively at ANY angle" instruction above: if you can tell that what you're looking at is a real plate panel on the vehicle itself (even if you can only make out a sliver of it, or can't read every character), set plate_visible to true with your best-estimate region rather than requiring full legibility. Only set plate_visible to false here when you cannot tell it is the vehicle's actual plate panel at all (i.e. it's ambiguous or looks like a background object) — not merely because the plate itself is hard to see clearly.

SELF-CHECK before answering: re-examine the region you are about to return and confirm it sits physically ON the vehicle's own bodywork (bumper/grille/trunk/tailgate), not on the background (building, street, another object) — if the region would fall outside the car's body, set plate_visible to false instead.

SEPARATELY, also check the photo for content moderation: this platform is a car rental marketplace (DrivePass, Medellín) and photos here are supposed to be regular photos of a car (exterior, interior, engine bay, etc.), sometimes with a person standing near/in the car (owner showing off the car, a normal selfie with the vehicle, someone sitting in the driver's seat, etc. — all of that is completely normal and fine). Only flag it as inappropriate if the photo clearly, unambiguously shows sexual or explicit content that has no place on a car rental listing — e.g. nudity, sexually explicit poses/acts, or pornographic material. Be conservative: a normal photo of a person (clothed, in any normal pose) near/in/around the car is NEVER inappropriate, even if they're not the main subject. When in doubt, do NOT flag it — false positives here are costly (they block a legitimate car listing), so only flag content that is obviously, unambiguously explicit.

Think step by step first (reason briefly about which side of the car is shown and where the plate would be, and separately whether the content is appropriate), THEN respond with ONLY valid JSON, no markdown, as the very last part of your answer:
{"plate_visible":boolean,"region":{"x_pct":number,"y_pct":number,"w_pct":number,"h_pct":number},"inappropriate_content":boolean,"inappropriate_reason":string}
Rules:
- x_pct, y_pct = top-left corner of the plate bounding box, as % of image width/height (0–100)
- w_pct, h_pct = plate bounding box size, as % of image width/height
- If genuinely no plate is visible anywhere in the photo (e.g. interior shot, extreme close-up of a body panel), set plate_visible to false and omit region
- If a plate IS visible, return a TIGHT bounding box around the plate's actual edges, with only a small ~5% padding on every side to account for imprecision in your own estimate — do NOT return a box much larger than the plate itself (e.g. do not include large parts of the bumper/grille around it). The code that consumes this region adds its own additional safety margin afterward, so your box should track the plate closely, not be generous
- Do not skip the back of the car just because it's not the "obvious" angle — the plate is just as often on the back as on the front
- inappropriate_content: true ONLY for clearly explicit/sexual content as described above; false for every normal car/interior/person photo (this should be false the vast majority of the time)
- inappropriate_reason: a short (one sentence) explanation ONLY if inappropriate_content is true; omit or leave empty otherwise`,
          },
        ],
      }],
    });

    text = resp.content[0].type === 'text' ? resp.content[0].text.trim() : '';
    stopReason = resp.stop_reason;
  } catch (err) {
    console.error('[blur-placas][MODERACION-NO-EVALUADA] Error llamando a la API de Anthropic — foto subida SIN evaluar contenido ni difuminar placa (fail-open: se trata como apropiada por defecto):', err);
    return { buffer, difuminada: false, contenidoInapropiado: false, moderacionEvaluada: false };
  }

  try {
    // El modelo puede razonar en prosa antes del JSON final (se le pidió pensar
    // primero). El prompt es explícito en que el JSON final es la ÚLTIMA parte
    // de la respuesta, así que anclamos en la ÚLTIMA ocurrencia de la clave
    // "plate_visible" (no la primera): si el razonamiento incluye un JSON de
    // borrador descartado antes de la corrección final, la primera ocurrencia
    // apuntaría a ese borrador con coordenadas equivocadas. Balanceamos llaves
    // desde ahí hacia adelante en vez de un simple "primer { … último }" (que se
    // rompería si el razonamiento previo contuviera alguna llave suelta).
    // TODO: el balanceo de llaves no es JSON-aware (no ignora llaves dentro de
    // strings); no bloqueante hoy porque la respuesta es JSON simple sin texto
    // libre embebido en los valores, pero podría revisarse a futuro.
    const claveIdx = text.lastIndexOf('"plate_visible"');
    let jsonStr: string | null = null;
    if (claveIdx !== -1) {
      const inicio = text.lastIndexOf('{', claveIdx);
      if (inicio !== -1) {
        let profundidad = 0;
        for (let i = inicio; i < text.length; i++) {
          if (text[i] === '{') profundidad++;
          else if (text[i] === '}') {
            profundidad--;
            if (profundidad === 0) { jsonStr = text.slice(inicio, i + 1); break; }
          }
        }
      }
    }
    if (!jsonStr) {
      const match = text.match(/\{[\s\S]*\}/);
      jsonStr = match ? match[0] : null;
    }
    if (jsonStr) {
      deteccion = JSON.parse(jsonStr) as PlacaDeteccion;
    } else {
      // Sin JSON reconocible: no se pudo leer NI la placa NI la moderación de esta
      // respuesta — tratamos ambas como no evaluadas (fail-open), y lo marcamos
      // distintivo porque, a diferencia del resto de los warn de este módulo, este
      // caso específicamente deja la foto sin evaluación real de contenido.
      console.error('[blur-placas][MODERACION-NO-EVALUADA] Respuesta de Claude sin JSON reconocible — foto subida SIN evaluar contenido ni difuminar placa (fail-open: se trata como apropiada por defecto). stop_reason:', stopReason, 'Respuesta:', text.slice(0, 300));
      return { buffer, difuminada: false, contenidoInapropiado: false, moderacionEvaluada: false };
    }
  } catch (err) {
    console.error('[blur-placas][MODERACION-NO-EVALUADA] JSON inválido en la respuesta de Claude — foto subida SIN evaluar contenido ni difuminar placa (fail-open: se trata como apropiada por defecto):', err, 'stop_reason:', stopReason, 'Respuesta:', text.slice(0, 300));
    return { buffer, difuminada: false, contenidoInapropiado: false, moderacionEvaluada: false };
  }

  // El chequeo de contenido inapropiado es independiente del de la placa: aplica
  // sin importar si se encontró o no una placa visible en la foto. Si llegamos hasta
  // acá, la IA sí devolvió un JSON válido con `inappropriate_content`, así que la
  // moderación SÍ se evaluó de verdad (a diferencia de los casos fail-open de arriba).
  const contenidoInapropiado = deteccion.inappropriate_content === true;
  const motivoInapropiado = contenidoInapropiado ? (deteccion.inappropriate_reason || 'Contenido marcado como inapropiado por la IA') : undefined;
  if (contenidoInapropiado) {
    console.warn('[blur-placas] Foto marcada por la IA como contenido inapropiado:', motivoInapropiado);
  }

  if (!deteccion.plate_visible || !deteccion.region) {
    console.warn('[blur-placas] Claude no detectó una placa visible en la foto (plate_visible=false)');
    return { buffer, difuminada: false, contenidoInapropiado, motivoInapropiado, moderacionEvaluada: true };
  }

  // Obtener dimensiones (ya con orientación normalizada, igual que lo que vio Claude)
  const meta = await sharp(buffer).metadata();
  const imgW = meta.width ?? 1;
  const imgH = meta.height ?? 1;

  const r = deteccion.region;
  const boxLeft = (r.x_pct / 100) * imgW;
  const boxTop  = (r.y_pct / 100) * imgH;
  const boxW    = (r.w_pct / 100) * imgW;
  const boxH    = (r.h_pct / 100) * imgH;

  // Segunda capa de seguridad (defensa en profundidad) además del prompt: una
  // placa colombiana real es un rectángulo horizontal con una proporción
  // ancho:alto de aproximadamente 2:1 a 2.5:1. Si el box que devolvió Claude
  // está muy lejos de esa forma, es más probable que haya apuntado a un objeto
  // de fondo (edificio, aviso, ventana) que a una placa real — no lo dibujamos.
  // Usamos el ratio en PÍXELES REALES del box (boxW/boxH), no el de x_pct/y_pct
  // crudo: estos últimos están expresados como % del ancho/alto de la imagen
  // por separado, así que su cociente queda sesgado por el aspect-ratio de la
  // FOTO (p. ej. una foto vertical de celular, muy común, no es cuadrada) y no
  // refleja la proporción física real del rectángulo detectado. El rango
  // [1.0, 4.5] es deliberadamente amplio (conservador) para no rechazar
  // detecciones válidas con perspectiva/ángulo pronunciado.
  const ASPECTO_MIN = 1.0;
  const ASPECTO_MAX = 4.5;
  const aspecto = boxW / boxH;
  if (!Number.isFinite(aspecto) || aspecto < ASPECTO_MIN || aspecto > ASPECTO_MAX) {
    console.warn(
      '[blur-placas] Región descartada por proporción implausible para una placa',
      { x_pct: r.x_pct, y_pct: r.y_pct, w_pct: r.w_pct, h_pct: r.h_pct, boxW, boxH, aspecto }
    );
    return { buffer, difuminada: false, contenidoInapropiado, motivoInapropiado, moderacionEvaluada: true };
  }

  // Margen extra (además del pequeño ~5% que ya se le pide a Claude) para tolerar
  // bounding boxes ligeramente desalineados y no dejar un borde de placa visible sin
  // cubrir: expandimos la caja un 10% del ANCHO/ALTO DE LA PLACA DETECTADA (boxW/boxH),
  // no de la imagen completa. Antes esto era `imgW * 0.08` / `imgH * 0.08` — un 8% del
  // tamaño TOTAL de la foto, que en una imagen de ~1200px de ancho agrega ~96px de
  // margen por lado a una placa que puede medir solo 150-250px de ancho: el rectángulo
  // final terminaba siendo 2-3x más grande que la placa real y tapaba buena parte del
  // paragolpes (bug reportado por el usuario con foto real). Además ese margen del
  // código se sumaba al ~15% de padding que el prompt ya le pedía a Claude sobre la
  // región devuelta — dos márgenes generosos que se componían. Ahora solo uno de los
  // dos es generoso (el del código, proporcional a la placa) y el otro (el del prompt)
  // se bajó a ~5%, solo para tolerar imprecisión del propio estimado de Claude.
  // `Math.max(4, ...)` evita un margen ridículamente chico en cajas casi de 0px.
  const padX = Math.max(4, Math.round(boxW * 0.10));
  const padY = Math.max(4, Math.round(boxH * 0.10));

  const left   = Math.max(0, Math.floor(boxLeft - padX));
  const top    = Math.max(0, Math.floor(boxTop - padY));
  const right  = Math.min(imgW, Math.ceil(boxLeft + boxW + padX));
  const bottom = Math.min(imgH, Math.ceil(boxTop + boxH + padY));
  const width  = Math.min(imgW - left, Math.max(20, right - left));
  const height = Math.min(imgH - top,  Math.max(10, bottom - top));

  // Tapar la región de la placa con un rectángulo AMARILLO SÓLIDO (con un borde
  // negro delgado), imitando el fondo real de una placa colombiana de vehículo
  // particular — así el resultado se ve como una placa genérica tapada a
  // propósito (intencional), no como un agujero negro que parece un bug.
  //
  // El pipeline anterior pixelaba fuerte + blur y ENCIMA componía un rectángulo
  // negro al 90% de opacidad. Con relleno 100% opaco (sin canal alfa parcial) los
  // píxeles originales quedan completamente reemplazados sin importar su
  // contraste/tamaño de fuente — no hace falta pixelado/blur por debajo como capa
  // de respaldo, así que se simplificó a solo el rectángulo sólido: el resultado
  // es idéntico en garantía de ilegibilidad y más limpio/intencional visualmente,
  // y además evita el costo de las dos operaciones de resize+blur por foto.
  const AMARILLO_PLACA = { r: 244, g: 196, b: 0, alpha: 1 };
  const BORDE_NEGRO = { r: 0, g: 0, b: 0, alpha: 1 };
  // Borde ~6% del lado más chico del rectángulo (con un piso de 2px) para que se
  // note como un borde de placa incluso en cajas pequeñas, sin comerse el relleno.
  const borde = Math.max(2, Math.round(Math.min(width, height) * 0.06));
  const anchoRelleno = Math.max(1, width - borde * 2);
  const altoRelleno = Math.max(1, height - borde * 2);

  const fondoConBorde = await sharp({
    create: { width, height, channels: 4, background: BORDE_NEGRO },
  }).png().toBuffer();

  const relleno = await sharp({
    create: { width: anchoRelleno, height: altoRelleno, channels: 4, background: AMARILLO_PLACA },
  }).png().toBuffer();

  const placaRegion = await sharp(fondoConBorde)
    .composite([{ input: relleno, left: borde, top: borde }])
    .toBuffer();

  const resultado = await sharp(buffer)
    .composite([{ input: placaRegion, left, top }])
    .jpeg({ quality: 90 })
    .toBuffer();

  return { buffer: resultado, difuminada: true, contenidoInapropiado, motivoInapropiado, moderacionEvaluada: true };
}
