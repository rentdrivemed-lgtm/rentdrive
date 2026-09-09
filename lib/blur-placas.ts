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
   * válido) en LOS 2 "slots" de detección independientes que hace esta función (cada uno con
   * su propio reintento técnico — ver `detectarYDifuminarPlaca` más abajo), la IA NO llegó a
   * evaluar el contenido de esta foto — en ese caso `contenidoInapropiado` queda en `false` en
   * el valor que devuelve ESTA función (para no inventar un resultado de moderación que nunca
   * se produjo), pero eso NO es lo mismo que "la IA revisó la foto y la encontró
   * apropiada". Basta con que UNO solo de los 2 slots tenga éxito técnico para que
   * `moderacionEvaluada` sea `true` (la moderación de esa llamada sí es un dato real), aunque
   * el otro slot haya fallado. Esta misma función ya deja rastro distintivo en el log en cada
   * uno de esos casos (ver los `console.error(...[MODERACION-NO-EVALUADA]...)` más abajo). El
   * call site (app/api/upload/route.ts) debe leer este campo y tratarlo FAIL-CLOSED — igual
   * que si `contenidoInapropiado` fuera `true` (a revisión manual) — en vez de fail-open
   * (aprobada en silencio).
   */
  moderacionEvaluada: boolean;
};

const PROMPT_DETECCION = `You are inspecting a photo of a car (this is one photo out of a set: front, back, sides, interior) to find and locate its license plate (Colombian plate, e.g. "KZR957" — yellow background with black bold characters for private cars).

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
- inappropriate_reason: a short (one sentence) explanation ONLY if inappropriate_content is true; omit or leave empty otherwise`;

/**
 * Resultado de UNA llamada a Claude para detección de placa/moderación, ya con el
 * parseo de JSON aplicado. Separado de `detectarYDifuminarPlaca` porque ahora se invoca hasta
 * 4 veces por foto (2 "slots" de detección SIEMPRE independientes, cada uno con hasta 2
 * intentos técnicos — ver esa función) con exactamente la misma lógica de llamada + parseo —
 * antes este bloque estaba duplicado sería doble mantenimiento.
 */
type LlamadaClaudeResultado =
  | { ok: true; deteccion: PlacaDeteccion }
  | { ok: false; motivo: 'api_error'; error: unknown }
  | { ok: false; motivo: 'sin_json'; stopReason: string | null | undefined; textoRespuesta: string }
  | { ok: false; motivo: 'json_invalido'; error: unknown; stopReason: string | null | undefined; textoRespuesta: string };

async function llamarClaudeDeteccionPlaca(base64: string): Promise<LlamadaClaudeResultado> {
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
            text: PROMPT_DETECCION,
          },
        ],
      }],
    });

    text = resp.content[0].type === 'text' ? resp.content[0].text.trim() : '';
    stopReason = resp.stop_reason;
  } catch (err) {
    return { ok: false, motivo: 'api_error', error: err };
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
      const deteccion = JSON.parse(jsonStr) as PlacaDeteccion;
      return { ok: true, deteccion };
    }
    // Sin JSON reconocible: no se pudo leer NI la placa NI la moderación de esta
    // respuesta puntual.
    return { ok: false, motivo: 'sin_json', stopReason, textoRespuesta: text };
  } catch (err) {
    return { ok: false, motivo: 'json_invalido', error: err, stopReason, textoRespuesta: text };
  }
}

/** Log final (fail-open, agotados ambos intentos) para un fallo de tipo API/JSON. */
function logFalloDefinitivo(r: Extract<LlamadaClaudeResultado, { ok: false }>) {
  if (r.motivo === 'api_error') {
    console.error('[blur-placas][MODERACION-NO-EVALUADA] Error llamando a la API de Anthropic (tras agotar reintento) — foto subida SIN evaluar contenido ni difuminar placa (fail-open: se trata como apropiada por defecto):', r.error);
  } else if (r.motivo === 'sin_json') {
    console.error('[blur-placas][MODERACION-NO-EVALUADA] Respuesta de Claude sin JSON reconocible (tras agotar reintento) — foto subida SIN evaluar contenido ni difuminar placa (fail-open: se trata como apropiada por defecto). stop_reason:', r.stopReason, 'Respuesta:', r.textoRespuesta.slice(0, 300));
  } else {
    console.error('[blur-placas][MODERACION-NO-EVALUADA] JSON inválido en la respuesta de Claude (tras agotar reintento) — foto subida SIN evaluar contenido ni difuminar placa (fail-open: se trata como apropiada por defecto):', r.error, 'stop_reason:', r.stopReason, 'Respuesta:', r.textoRespuesta.slice(0, 300));
  }
}

/**
 * Evalúa si una detección tiene una placa "aceptable para difuminar": visible según la IA
 * Y con una región cuya proporción ancho:alto (en píxeles reales de la imagen, `imgW`/
 * `imgH`) cae dentro del rango plausible para una placa colombiana real. Requiere las
 * dimensiones de la imagen porque el aspecto se calcula sobre el box en píxeles, no sobre
 * los `%_pct` crudos (ver comentario extenso más abajo, en el uso original de este cálculo).
 */
const ASPECTO_MIN = 1.0;
const ASPECTO_MAX = 4.5;

type EvaluacionRegion =
  | { valida: true; boxLeft: number; boxTop: number; boxW: number; boxH: number; aspecto: number }
  | { valida: false; motivo: 'no_visible' }
  | { valida: false; motivo: 'aspecto_invalido'; aspecto: number; boxW: number; boxH: number };

function evaluarRegion(deteccion: PlacaDeteccion, imgW: number, imgH: number): EvaluacionRegion {
  if (!deteccion.plate_visible || !deteccion.region) {
    return { valida: false, motivo: 'no_visible' };
  }
  const r = deteccion.region;
  const boxLeft = (r.x_pct / 100) * imgW;
  const boxTop  = (r.y_pct / 100) * imgH;
  const boxW    = (r.w_pct / 100) * imgW;
  const boxH    = (r.h_pct / 100) * imgH;
  const aspecto = boxW / boxH;
  if (!Number.isFinite(aspecto) || aspecto < ASPECTO_MIN || aspecto > ASPECTO_MAX) {
    return { valida: false, motivo: 'aspecto_invalido', aspecto, boxW, boxH };
  }
  return { valida: true, boxLeft, boxTop, boxW, boxH, aspecto };
}

/** Región ya confirmada como válida por `evaluarRegion` (rama `valida: true` del union). */
type RegionValida = Extract<EvaluacionRegion, { valida: true }>;

/**
 * A partir de una región válida (ya evaluada por `evaluarRegion`) calcula el rectángulo final
 * (en píxeles enteros, recortado a los límites de la imagen) que se va a tapar, aplicando el
 * margen proporcional del 6% descrito en el comentario extenso más abajo. Extraída a función
 * propia porque ahora puede invocarse hasta 2 veces por foto — una por cada región válida de
 * las 2 detecciones independientes (ver reconciliación en `detectarYDifuminarPlaca`) — en vez
 * de una sola vez como antes.
 */
function calcularRectanguloTapado(
  ev: RegionValida,
  imgW: number,
  imgH: number
): { left: number; top: number; width: number; height: number } {
  const { boxLeft, boxTop, boxW, boxH } = ev;

  // Margen extra (además del pequeño ~5% que ya se le pide a Claude) para tolerar
  // bounding boxes ligeramente desalineados y no dejar un borde de placa visible sin
  // cubrir: expandimos la caja un 6% del ANCHO/ALTO DE LA PLACA DETECTADA (boxW/boxH),
  // no de la imagen completa. Antes esto era `imgW * 0.08` / `imgH * 0.08` — un 8% del
  // tamaño TOTAL de la foto, que en una imagen de ~1200px de ancho agrega ~96px de
  // margen por lado a una placa que puede medir solo 150-250px de ancho: el rectángulo
  // final terminaba siendo 2-3x más grande que la placa real y tapaba buena parte del
  // paragolpes (bug reportado por el usuario con foto real). Además ese margen del
  // código se sumaba al ~15% de padding que el prompt ya le pedía a Claude sobre la
  // región devuelta — dos márgenes generosos que se componían. Ahora solo uno de los
  // dos es generoso (el del código, proporcional a la placa) y el otro (el del prompt)
  // se bajó a ~5%, solo para tolerar imprecisión del propio estimado de Claude.
  // Se bajó de 10% a 6% tras un segundo reporte del usuario con foto real en producción
  // (Ford Explorer): incluso con el ajuste anterior, el tapado se seguía viendo más
  // grande de lo necesario sobre el paragolpes — este 6% es solo el colchón para
  // imprecisión del bounding box, no para "cubrir de más" a propósito.
  // `Math.max(4, ...)` evita un margen ridículamente chico en cajas casi de 0px.
  const padX = Math.max(4, Math.round(boxW * 0.06));
  const padY = Math.max(4, Math.round(boxH * 0.06));

  const left   = Math.max(0, Math.floor(boxLeft - padX));
  const top    = Math.max(0, Math.floor(boxTop - padY));
  const right  = Math.min(imgW, Math.ceil(boxLeft + boxW + padX));
  const bottom = Math.min(imgH, Math.ceil(boxTop + boxH + padY));
  const width  = Math.min(imgW - left, Math.max(20, right - left));
  const height = Math.min(imgH - top,  Math.max(10, bottom - top));

  return { left, top, width, height };
}

/**
 * Genera el rectángulo 100% OPACO de marca DrivePass (fondo navy `#1B3356` + borde de acento
 * naranja `#F25C2B` + el ícono del logo centrado) rasterizado como PNG a las dimensiones
 * `width x height` exactas — listo para usarse como una capa más de `sharp().composite([...])`.
 * Se usa este tapado de marca en vez de un bloque plano o un blur a propósito: un blur puede
 * en teoría ser parcialmente reversible ajustando brillo/contraste sobre la imagen resultante,
 * mientras que un relleno 100% opaco (sin canal alfa parcial) reemplaza los píxeles originales
 * por completo, sin importar su contraste/tamaño de fuente — garantía de ilegibilidad más
 * fuerte.
 *
 * Extraída a función propia (antes vivía inline al final de `detectarYDifuminarPlaca`) porque
 * ahora puede invocarse 1 o 2 veces por foto, una por cada región de placa válida detectada
 * (ver reconciliación de las 2 llamadas independientes a Claude en `detectarYDifuminarPlaca`),
 * y no queríamos duplicar este bloque de SVG.
 */
async function generarRectanguloMarca(width: number, height: number): Promise<Buffer> {
  const NAVY_MARCA = '#1B3356';
  const NARANJA_MARCA = '#F25C2B';
  const BLANCO_ICONO = '#F4F6FA';

  // Esquinas redondeadas: ~18% del lado más chico del rectángulo (piso 4px) —
  // notoriamente redondeado (estilo ícono de app) sin llegar a verse una
  // píldora/óvalo completo en rectángulos muy alargados (placas 2:1–2.5:1).
  const radio = Math.max(4, Math.round(Math.min(width, height) * 0.18));

  // Borde de acento ~6% del lado más chico del rectángulo (piso 2px) — mismo
  // criterio de proporcionalidad que ya usaba el borde del diseño anterior, para
  // que siga notándose incluso en cajas pequeñas sin comerse el fondo.
  const borde = Math.max(2, Math.round(Math.min(width, height) * 0.06));

  // Ícono del logo de DrivePass (solo las flechas, SIN el fondo navy redondeado
  // del logo original en `public/brand/logo-mark.svg` — ese fondo ya lo pone el
  // propio rectángulo del tapado, repetirlo duplicaría el marco). Paths copiados
  // TAL CUAL del archivo real, en su mismo `viewBox="0 0 96 96"`.
  const ICONO_PATHS = `
    <path d="M26 38 H63" fill="none" stroke="${NARANJA_MARCA}" stroke-width="8" stroke-linecap="round"/>
    <polyline points="55,29 66,38 55,47" fill="none" stroke="${NARANJA_MARCA}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M70 58 H33" fill="none" stroke="${BLANCO_ICONO}" stroke-width="8" stroke-linecap="round"/>
    <polyline points="41,49 30,58 41,67" fill="none" stroke="${BLANCO_ICONO}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  `;
  // Bounding box REAL de esos paths (con su stroke incluido) dentro del
  // `viewBox 0 0 96 96`, medido rasterizando el ícono solo y recortando el
  // área no transparente (`sharp().trim()`): x:[22,74] y:[25,71], es decir
  // ancho 52 x alto 46, centrado en (48,48) — que además coincide con el
  // centro del propio viewBox de 96x96 por el diseño simétrico del ícono.
  const ICONO_ANCHO = 52;
  const ICONO_ALTO = 46;
  const ICONO_CENTRO_X = 48;
  const ICONO_CENTRO_Y = 48;

  // Escalamos el ícono para que su lado más grande (52, el ancho de su bbox
  // real) ocupe ~60% del lado MÁS CHICO del rectángulo de tapado (dentro del
  // rango pedido de 55–65%), y lo centramos en ambos ejes con un solo
  // `translate(...) scale(...)` sobre el grupo de paths — sin recalcular cada
  // coordenada a mano.
  const escala = Number(((Math.min(width, height) * 0.60) / Math.max(ICONO_ANCHO, ICONO_ALTO)).toFixed(4));
  const tx = Number((width / 2 - escala * ICONO_CENTRO_X).toFixed(2));
  const ty = Number((height / 2 - escala * ICONO_CENTRO_Y).toFixed(2));

  // El borde se dibuja como `stroke` centrado en el contorno del `rect`, con el
  // propio `rect` inset `borde/2` por lado (x/y/width/height ajustados): así el
  // trazo queda íntegramente dentro del lienzo `width x height` sin desbordarse
  // ni recortarse, y el resultado es un borde de grosor exacto `borde`.
  const rectX = Number((borde / 2).toFixed(2));
  const rectY = Number((borde / 2).toFixed(2));
  const rectW = Number(Math.max(1, width - borde).toFixed(2));
  const rectH = Number(Math.max(1, height - borde).toFixed(2));

  const svgPlaca = `<svg width="${Number(width)}" height="${Number(height)}" viewBox="0 0 ${Number(width)} ${Number(height)}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="${Number(width)}" height="${Number(height)}" fill="${NAVY_MARCA}"/>
    <rect x="${rectX}" y="${rectY}" width="${rectW}" height="${rectH}" rx="${Number(radio)}" fill="${NAVY_MARCA}" stroke="${NARANJA_MARCA}" stroke-width="${Number(borde)}"/>
    <g transform="translate(${tx},${ty}) scale(${escala})">
      ${ICONO_PATHS}
    </g>
  </svg>`;

  return sharp(Buffer.from(svgPlaca)).png().toBuffer();
}

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

  // Se hacen SIEMPRE 2 llamadas INDEPENDIENTES a Claude por foto (mismo prompt, misma
  // imagen) — ya NO depende de si la primera detección "tuvo éxito". Esto reemplaza el
  // diseño anterior (que solo reintentaba ante `plate_visible:false` o proporción inválida)
  // porque ese diseño no cerraba un hueco de seguridad real encontrado en producción (foto
  // real, ejemplo ilustrativo: placa ABC123, foto trasera): la IA puede devolver una región
  // con forma geométricamente creíble (que pasa el filtro de proporción de `evaluarRegion`)
  // pero ubicada en el lugar EQUIVOCADO del paragolpes — no sobre la placa real —, lo que
  // antes se aceptaba como éxito en la primera llamada y JAMÁS disparaba un reintento (una
  // región "creíble pero mal ubicada" pasaba como éxito, no como "no hay placa").
  //
  // Con 2 consultas siempre independientes: si ambas aciertan el mismo lugar (caso normal)
  // los 2 rectángulos quedan prácticamente superpuestos y se ve igual que taparlo una vez; si
  // difieren (el bug real), se tapan AMBAS zonas, cubriendo ambas posibilidades. Esto duplica
  // el costo de la llamada a la API en TODAS las fotos — decisión de producto aprobada
  // explícitamente por Victor a cambio de cerrar este hueco de seguridad.
  //
  // Cada una de las 2 llamadas ("slots") puede a su vez reintentarse UNA vez si falla por un
  // problema técnico (error de API o respuesta sin JSON válido) — cada slot tiene hasta 2
  // intentos técnicos, así que el máximo teórico son 4 llamadas a la API por foto, pero el
  // caso normal (sin fallos técnicos) son exactamente 2.
  async function ejecutarSlot(numeroSlot: 1 | 2): Promise<LlamadaClaudeResultado> {
    const intento1 = await llamarClaudeDeteccionPlaca(base64);
    if (intento1.ok) return intento1;
    console.warn(`[blur-placas] Slot ${numeroSlot}/2: intento 1/2 falló (motivo: ${intento1.motivo}) — reintentando este slot una vez más antes de rendirse`);
    return llamarClaudeDeteccionPlaca(base64);
  }

  const [slot1, slot2] = await Promise.all([ejecutarSlot(1), ejecutarSlot(2)]);

  if (!slot1.ok && !slot2.ok) {
    // Ninguno de los 2 slots tuvo éxito técnico tras agotar su reintento — mismo
    // comportamiento fail-closed de siempre: no se evaluó moderación ni se difuminó nada.
    logFalloDefinitivo(slot1);
    logFalloDefinitivo(slot2);
    return { buffer, difuminada: false, contenidoInapropiado: false, moderacionEvaluada: false };
  }

  // Al menos uno de los 2 slots sí tuvo éxito técnico: la moderación de contenido de ESTA
  // foto sí llegó a evaluarse, aunque el otro slot haya fallado por un problema técnico.
  if (!slot1.ok) {
    console.warn(`[blur-placas] Slot 1/2 falló por un problema técnico (motivo: ${slot1.motivo}) pero el slot 2 sí tuvo éxito — se continúa solo con la detección del slot 2 (moderación igual evaluada)`);
  }
  if (!slot2.ok) {
    console.warn(`[blur-placas] Slot 2/2 falló por un problema técnico (motivo: ${slot2.motivo}) pero el slot 1 sí tuvo éxito — se continúa solo con la detección del slot 1 (moderación igual evaluada)`);
  }

  const detecciones: PlacaDeteccion[] = [];
  if (slot1.ok) detecciones.push(slot1.deteccion);
  if (slot2.ok) detecciones.push(slot2.deteccion);

  // Moderación: "OR" entre todas las llamadas que sí tuvieron éxito técnico — si CUALQUIERA
  // marcó contenido inapropiado, se respeta esa señal (mismo criterio que el diseño anterior).
  const inapropiada = detecciones.find(d => d.inappropriate_content === true);
  const contenidoInapropiado = inapropiada !== undefined;
  const motivoInapropiado = inapropiada
    ? (inapropiada.inappropriate_reason || 'Contenido marcado como inapropiado por la IA')
    : undefined;

  if (contenidoInapropiado) {
    console.warn('[blur-placas] Foto marcada por la IA como contenido inapropiado:', motivoInapropiado);
  }

  // Dimensiones reales (ya con orientación normalizada, igual que lo que vio Claude), para
  // evaluar la proporción de cada región candidata.
  const meta = await sharp(buffer).metadata();
  const imgW = meta.width ?? 1;
  const imgH = meta.height ?? 1;

  // Recolectar las regiones VÁLIDAS (pasaron `evaluarRegion`) de las llamadas que sí
  // tuvieron éxito técnico — puede haber 0, 1, o 2.
  const regionesValidas = detecciones
    .map(d => evaluarRegion(d, imgW, imgH))
    .filter((ev): ev is RegionValida => ev.valida);

  if (regionesValidas.length === 0) {
    console.warn(`[blur-placas] Ninguna de las ${detecciones.length} detección(es) exitosa(s) arrojó una placa aceptable — foto publicada sin tapar (no hay placa visible o proporción implausible en todas)`);
    return { buffer, difuminada: false, contenidoInapropiado, motivoInapropiado, moderacionEvaluada: true };
  }

  // Se tapa CADA región válida como un rectángulo de marca independiente (no se calcula una
  // "unión" de cajas ni se intenta fusionarlas geométricamente). Si las 2 regiones casi
  // coinciden (caso normal, ambas llamadas acertaron el mismo lugar) los 2 rectángulos quedan
  // superpuestos casi exactos y se ve igual que taparla una sola vez. Si difieren (el caso del
  // bug real) quedan 2 rectángulos en 2 lugares distintos, cubriendo ambas posibilidades.
  const rectangulos = regionesValidas.map(ev => calcularRectanguloTapado(ev, imgW, imgH));

  if (rectangulos.length === 1) {
    console.warn('[blur-placas] 1 región válida de placa (de 2 llamadas independientes) — se tapa 1 zona:', rectangulos[0]);
  } else {
    const [r1, r2] = rectangulos;
    const c1x = r1.left + r1.width / 2, c1y = r1.top + r1.height / 2;
    const c2x = r2.left + r2.width / 2, c2y = r2.top + r2.height / 2;
    const distancia = Math.hypot(c1x - c2x, c1y - c2y);
    const diagonal = Math.hypot(imgW, imgH);
    const distanciaRelativa = diagonal > 0 ? distancia / diagonal : 0;
    console.warn(
      `[blur-placas] Las 2 llamadas independientes arrojaron región válida — se tapan ambas zonas. Distancia entre centros: ${Math.round(distancia)}px (${(distanciaRelativa * 100).toFixed(1)}% de la diagonal de la imagen).`,
      { rect1: r1, rect2: r2 }
    );
    // Umbral simple (10% de la diagonal de la imagen) solo para fines de LOG/monitoreo: por
    // debajo de esto, las 2 detecciones se consideran "el mismo lugar" (imprecisión normal del
    // estimado de Claude); por encima, se consideran genuinamente discrepantes (el caso del
    // bug real de producción que motivó este rediseño). En ambos casos se tapan las 2 zonas
    // igual — este umbral NO cambia el comportamiento, solo deja rastro para que Victor pueda
    // monitorear qué tan seguido pasa el caso divergente en producción.
    const UMBRAL_DISCREPANCIA_RELATIVA = 0.10;
    if (distanciaRelativa > UMBRAL_DISCREPANCIA_RELATIVA) {
      console.warn('[blur-placas][DOBLE-DETECCION-DIVERGENTE] Las 2 llamadas independientes de detección de placa NO coincidieron en la ubicación de la placa — se cubrieron AMBAS zonas por seguridad. Monitorear frecuencia en producción.');
    }
  }

  // Tapar cada región con un rectángulo 100% OPACO de marca DrivePass (ver
  // `generarRectanguloMarca` para el detalle de diseño/justificación) — 1 o 2 capas
  // independientes, compuestas en la MISMA llamada a `sharp().composite([...])`.
  const capas = await Promise.all(
    rectangulos.map(async (r) => ({
      input: await generarRectanguloMarca(r.width, r.height),
      left: r.left,
      top: r.top,
    }))
  );

  const resultado = await sharp(buffer)
    .composite(capas)
    .jpeg({ quality: 90 })
    .toBuffer();

  return { buffer: resultado, difuminada: true, contenidoInapropiado, motivoInapropiado, moderacionEvaluada: true };
}
