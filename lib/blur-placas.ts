import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { detectarPlacasPorColor, type CandidatoPlaca } from './detectar-placa-color';

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
   * válido) la llamada de detección/moderación a la IA (con su reintento técnico — ver
   * `detectarYDifuminarPlaca` más abajo) NO llegó a evaluar el contenido de esta foto — en
   * ese caso `contenidoInapropiado` queda en `false` en el valor que devuelve ESTA función
   * (para no inventar un resultado de moderación que nunca se produjo), pero eso NO es lo
   * mismo que "la IA revisó la foto y la encontró apropiada". Esta misma función ya deja
   * rastro distintivo en el log en cada uno de esos casos (ver los
   * `console.error(...[MODERACION-NO-EVALUADA]...)` más abajo). El call site
   * (app/api/upload/route.ts) debe leer este campo y tratarlo FAIL-CLOSED — igual que si
   * `contenidoInapropiado` fuera `true` (a revisión manual) — en vez de fail-open (aprobada
   * en silencio).
   *
   * OJO: `moderacionEvaluada === false` NO implica `difuminada === false`. Cuando la IA
   * falla técnicamente pero el detector determinístico de color (lib/detectar-placa-color.ts)
   * sí encuentra una placa amarilla clara, la placa SÍ se tapa (no tiene sentido dejar
   * expuesta una placa solo porque la IA no respondió) y aun así la foto queda marcada para
   * revisión manual, porque la moderación de contenido no se pudo evaluar.
   */
  moderacionEvaluada: boolean;
  /**
   * Por qué camino se resolvió la UBICACIÓN de la placa en esta foto. Sirve para telemetría
   * y, sobre todo, para que un consumidor pueda distinguir un tapado PRECISO (el rectángulo
   * amarillo real, vía detector de color) de uno IMPRECISO Y GRANDE (la banda de respaldo,
   * centrada en una pista sesgada). Lo usa app/api/admin/reprocesar-placas para no volver a
   * estampar una banda enorme sobre una foto que ya salió de una corrida anterior.
   *  - `color`            : candidato(s) de color que concuerdan con la pista de la IA.
   *  - `color_con_banda`  : ídem, pero se sumó además la banda — porque los candidatos tapados
 *                         eran débiles, o porque la ventana tenía más candidatos de los que
 *                         se pueden tapar y alguno de los descartados tenía forma de placa.
   *  - `color_sin_pista`  : la IA no reportó placa; se tapó un candidato de color claro.
   *  - `color_sin_ia`     : la IA no pudo opinar; se tapó un candidato de color claro.
   *  - `banda_respaldo`   : solo la banda (el color no encontró nada que concuerde).
   *  - `ninguna`          : no se tapó nada (`difuminada` es false).
   */
  via: 'color' | 'color_con_banda' | 'color_sin_pista' | 'color_sin_ia' | 'banda_respaldo' | 'ninguna';
};

const PROMPT_DETECCION = `You are inspecting a photo of a car (this is one photo out of a set: front, back, sides, interior) to find and locate its license plate (Colombian plate, e.g. "ABC123" — yellow background with black bold characters for private cars).

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
 * parseo de JSON aplicado. Separado de `detectarYDifuminarPlaca` porque se invoca hasta
 * 2 veces por foto (1 llamada + 1 reintento técnico si la primera falla por API/JSON — ver
 * esa función) con exactamente la misma lógica de llamada + parseo.
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

/**
 * Log final para un fallo técnico de tipo API/JSON, ya agotados los dos intentos.
 *
 * OJO con lo que este log DICE, porque es el que se lee en un incidente: que la IA no
 * haya podido responder NO significa ni que la foto se publique sin moderar ni que la
 * placa quede sin tapar.
 *  - Moderación: es FAIL-CLOSED en los call sites — `moderacionEvaluada:false` manda la
 *    foto/el vehículo a revisión manual (ver app/api/upload/route.ts y
 *    app/api/admin/reprocesar-placas/route.ts). No se trata como "apropiada por defecto".
 *  - Placa: sigue el camino determinístico de color (`resolverSinIA`), que SÍ puede
 *    taparla sin ninguna ayuda de la IA.
 * El texto anterior afirmaba lo contrario en las dos cosas ("fail-open", "ni difuminar
 * placa") y era simplemente falso.
 */
function logFalloDefinitivo(r: Extract<LlamadaClaudeResultado, { ok: false }>) {
  const cola = 'la foto queda marcada para revisión manual (fail-closed en el call site) y la placa se resuelve solo con el detector determinístico de color';
  if (r.motivo === 'api_error') {
    console.error(`[blur-placas][MODERACION-NO-EVALUADA] Error llamando a la API de Anthropic (tras agotar reintento) — ${cola}:`, r.error);
  } else if (r.motivo === 'sin_json') {
    console.error(`[blur-placas][MODERACION-NO-EVALUADA] Respuesta de Claude sin JSON reconocible (tras agotar reintento) — ${cola}. stop_reason:`, r.stopReason, 'Respuesta:', r.textoRespuesta.slice(0, 300));
  } else {
    console.error(`[blur-placas][MODERACION-NO-EVALUADA] JSON inválido en la respuesta de Claude (tras agotar reintento) — ${cola}:`, r.error, 'stop_reason:', r.stopReason, 'Respuesta:', r.textoRespuesta.slice(0, 300));
  }
}

/** Caja en porcentajes de la imagen (0–100) — mismo formato que devuelven la IA y el detector de color. */
type CajaPct = { x_pct: number; y_pct: number; w_pct: number; h_pct: number };

/** Rectángulo final a tapar, en píxeles enteros de la imagen. */
type Rectangulo = { left: number; top: number; width: number; height: number };

/**
 * Proporción ancho:alto plausible para la PISTA de la IA. Solo se usa para descartar
 * regiones geométricamente absurdas (una caja más alta que ancha, o una franja larguísima):
 * una pista con forma imposible no sirve ni siquiera como centro aproximado.
 */
const ASPECTO_MIN = 1.0;
const ASPECTO_MAX = 4.5;

type EvaluacionRegion =
  | { valida: true; caja: CajaPct; aspecto: number }
  | { valida: false; motivo: 'no_visible' }
  | { valida: false; motivo: 'fuera_de_rango' }
  | { valida: false; motivo: 'aspecto_invalido'; aspecto: number };

/**
 * ¿Los 4 números de la región están dentro del contrato que el prompt le pide a la IA
 * (porcentajes 0–100, con tamaño estrictamente positivo)?
 *
 * Es una salida de MODELO, no un dato de confianza: puede venir con `null`, un string,
 * `NaN`, un porcentaje > 100 o negativo (alucinación o unidades equivocadas). Sin este
 * chequeo esos valores se propagaban hasta `rectanguloDesdeCaja` y de ahí a `sharp`:
 *  - `y_pct:140, h_pct:4` en una imagen 1200x900 producía `{width:264, height:-63}` y
 *    `generarRectanguloMarca` lanzaba ("Input buffer has corrupt header: svgload_buffer:
 *    bad dimensions"); ese error sube sin try/catch y app/api/upload/route.ts respondía
 *    500 al usuario.
 *  - `y_pct:-20` era peor en silencio: tapaba una tira de 10px en el borde superior y
 *    devolvía `difuminada:true, moderacionEvaluada:true`, o sea una placa perfectamente
 *    visible reportada como foto ya procesada.
 * Una región fuera de rango no se "arregla" recortándola (no sabemos qué quiso decir el
 * modelo): se descarta como pista y la foto cae al camino de candidatos fuertes de color
 * (el mismo que `no_visible`), que sí es una ubicación medida sobre los píxeles.
 */
function rangoValido(r: { x_pct: number; y_pct: number; w_pct: number; h_pct: number }): boolean {
  const { x_pct, y_pct, w_pct, h_pct } = r;
  if (![x_pct, y_pct, w_pct, h_pct].every(n => typeof n === 'number' && Number.isFinite(n))) return false;
  if (x_pct < 0 || x_pct > 100 || y_pct < 0 || y_pct > 100) return false;
  if (w_pct <= 0 || w_pct > 100 || h_pct <= 0 || h_pct > 100) return false;
  return true;
}

/**
 * Evalúa la región que devolvió la IA como PISTA aproximada de dónde está la placa: la IA
 * debe haber dicho que hay placa visible y la caja debe tener forma plausible (en píxeles
 * reales de la imagen, no sobre los `%_pct` crudos, porque un % de ancho y un % de alto no
 * son la misma cantidad de píxeles salvo en imágenes cuadradas).
 *
 * IMPORTANTE: que esta región sea "válida" NO significa que esté bien UBICADA — ese es
 * justamente el bug documentado arriba de `detectarYDifuminarPlaca` (la `y` viene entre 13.6
 * y 27.6 puntos porcentuales más abajo de la placa real; ver `SESGO_ESPERADO_PCT`). Por eso
 * el resultado de esta función ya no se tapa directamente: se usa como pista para
 * elegir/centrar, no como verdad.
 */
function evaluarRegion(deteccion: PlacaDeteccion, imgW: number, imgH: number): EvaluacionRegion {
  if (!deteccion.plate_visible || !deteccion.region) {
    return { valida: false, motivo: 'no_visible' };
  }
  const r = deteccion.region;
  if (!rangoValido(r)) {
    console.warn('[blur-placas] La IA devolvió una región con valores fuera de rango (se descarta como pista y se resuelve solo por color):', r);
    return { valida: false, motivo: 'fuera_de_rango' };
  }
  const caja: CajaPct = { x_pct: r.x_pct, y_pct: r.y_pct, w_pct: r.w_pct, h_pct: r.h_pct };
  const aspecto = ((caja.w_pct / 100) * imgW) / ((caja.h_pct / 100) * imgH);
  if (!Number.isFinite(aspecto) || aspecto < ASPECTO_MIN || aspecto > ASPECTO_MAX) {
    return { valida: false, motivo: 'aspecto_invalido', aspecto };
  }
  return { valida: true, caja, aspecto };
}

/** Centro de una caja en porcentajes. */
function centro(caja: CajaPct): { cx: number; cy: number } {
  return { cx: caja.x_pct + caja.w_pct / 2, cy: caja.y_pct + caja.h_pct / 2 };
}

/**
 * Convierte una caja en % a un rectángulo en píxeles enteros, recortado a los límites de la
 * imagen y expandido con un margen proporcional al TAMAÑO DE LA CAJA (no al de la imagen).
 *
 * `margen` es la fracción del ancho/alto de la caja que se agrega por lado. Para el camino
 * del detector de color se usa un margen modesto (la caja es precisa); la banda de respaldo
 * ya viene expandida por `bandaRespaldo` y por eso se compone con margen 0.
 */
function rectanguloDesdeCaja(caja: CajaPct, imgW: number, imgH: number, margen: number): Rectangulo {
  const boxLeft = (caja.x_pct / 100) * imgW;
  const boxTop  = (caja.y_pct / 100) * imgH;
  const boxW    = (caja.w_pct / 100) * imgW;
  const boxH    = (caja.h_pct / 100) * imgH;

  // `Math.max(4, ...)` evita un margen ridículamente chico en cajas casi de 0px.
  const padX = margen > 0 ? Math.max(4, Math.round(boxW * margen)) : 0;
  const padY = margen > 0 ? Math.max(4, Math.round(boxH * margen)) : 0;

  // El origen se acota a `imgW-1`/`imgH-1` (no solo a >= 0): `rangoValido` valida cada
  // porcentaje POR SEPARADO y por lo tanto admite cajas que NO caben en la imagen (p. ej.
  // `y_pct:100`, o `y_pct:95 + h_pct:100`). Sin este tope, `top` podía salir exactamente
  // igual a `imgH` y entonces `composite` NO lanza y tampoco pinta un solo píxel: el
  // llamador devolvía `difuminada:true` sobre una foto intacta, o sea una placa legible
  // reportada como ya procesada — el peor de los dos fallos posibles aquí.
  const left   = Math.min(imgW - 1, Math.max(0, Math.floor(boxLeft - padX)));
  const top    = Math.min(imgH - 1, Math.max(0, Math.floor(boxTop - padY)));
  const right  = Math.min(imgW, Math.ceil(boxLeft + boxW + padX));
  const bottom = Math.min(imgH, Math.ceil(boxTop + boxH + padY));
  // El `Math.max(1, ...)` final es una red de seguridad, no el filtro principal. OJO: NO es
  // cierto que "con una caja en rango estas cantidades ya salen positivas" (lo que decía el
  // comentario anterior), porque `rangoValido` no exige que la caja quepa en la imagen —
  // para una caja que se sale por abajo/derecha, `right - left` o `bottom - top` pueden ser
  // <= 0 y es el clamp de `left`/`top` de arriba + este `Math.max(1, ...)` lo que garantiza
  // un rectángulo de al menos 1px REAL dentro del lienzo, en vez de un `composite` que no
  // pinta nada (falso `difuminada:true`) o que lanza y convierte la subida en un 500.
  const width  = Math.max(1, Math.min(imgW - left, Math.max(20, right - left)));
  const height = Math.max(1, Math.min(imgH - top,  Math.max(10, bottom - top)));

  return { left, top, width, height };
}

/**
 * Margen (fracción del tamaño de la caja) que se agrega alrededor del candidato del detector
 * de color. Es MODESTO a propósito: ese candidato es el bounding box de los píxeles amarillos
 * reales de la placa, así que ya está donde debe estar; este 12% solo cubre el marco/borde
 * negro de la placa y el par de píxeles que la máscara de color pierde en los bordes por
 * antialiasing y por el reescalado a 900px del análisis.
 */
const MARGEN_CANDIDATO_COLOR = 0.12;

// ---------------------------------------------------------------------------------------
// Reconciliación entre la PISTA de la IA (buena en X, sesgada en Y) y los candidatos del
// detector determinístico de color (precisos, pero sin saber cuál de los objetos amarillos
// de la escena es la placa del carro que se está publicando).
// ---------------------------------------------------------------------------------------

/**
 * Tolerancia horizontal (en puntos porcentuales del ancho de la imagen) entre el centro del
 * candidato amarillo y el centro de la pista de la IA. En X la IA sí acierta (lo verificado
 * sobre fotos reales: el error grande es SOLO vertical), así que esta tolerancia puede ser
 * relativamente estrecha — y es la que descarta el clásico falso positivo del taxi amarillo
 * estacionado al fondo, que casi nunca cae en la misma columna que la placa del carro.
 */
const TOLERANCIA_X_PCT = 20;

/**
 * SESGO VERTICAL SISTEMÁTICO de la pista de la IA, en puntos porcentuales del alto de la
 * imagen: cuánto MÁS ABAJO pone Claude el centro de la placa respecto del centro real
 * (medido con el detector de color sobre los píxeles amarillos).
 *
 * Medido sobre las 4 fotos reales de producción con las que se calibró este módulo, en dos
 * corridas distintas (la pista de la IA no es determinística, varía algo entre llamadas):
 * 13.6 / 14.9 / 21.4 / 27.6 en una, y 14.6 / 15.1 / 19.4 / 26.9 en la otra. Rango observado
 * 13.6–27.6 y SIEMPRE con el mismo signo (la pista nunca apareció por encima de la placa).
 * Promedio ≈ 19 en ambas corridas.
 *
 * Se usa como CORRECCIÓN al puntuar candidatos: el centro esperado de la placa no es el
 * centro de la pista, sino ese centro desplazado 19 puntos hacia ARRIBA. Sin esta
 * corrección el puntaje era simétrico en Y (`Math.abs(cy - pcy)`) y por lo tanto premiaba
 * a cualquier objeto amarillo pegado a la pista o justo debajo de ella — el taxi/valla
 * amarilla del fondo, que cae en la franja de `VENTANA_ABAJO_PCT` con |dy| chico — y
 * castigaba a la placa real, que por definición está lejos hacia arriba (|dy| grande).
 * Con el puntaje simétrico anterior el umbral era el sesgo COMPLETO, no su mitad: la placa
 * real puntuaba |dy| = sesgo, así que con el sesgo mínimo medido (13.6) cualquier amarillo a
 * menos de 13.6 puntos por debajo de la pista le ganaba a la placa; con el peor (27.6), a
 * menos de 27.6 puntos.
 */
const SESGO_ESPERADO_PCT = 19;

/**
 * Ventana vertical ASIMÉTRICA (en puntos porcentuales del alto de la imagen) alrededor del
 * centro de la pista de la IA. Es asimétrica porque el sesgo de arriba es sistemático y
 * tiene signo conocido: el candidato correcto casi siempre está ARRIBA de la pista.
 *
 * Hacia arriba se aceptan 45 puntos = ~1.6x el PEOR sesgo realmente medido (27.6). El
 * valor anterior era 35 con el comentario "el doble del peor sesgo observado (10–18)":
 * ese "peor sesgo" estaba desactualizado, así que 35 en realidad era 1.27x — un margen
 * demasiado apretado para el uso real de esta constante, que además es el techo de los
 * DOS caminos (`BANDA_ARRIBA_PCT` la reusa tal cual).
 * Hacia abajo se aceptan 15: el sesgo nunca se observó invertido, pero una pista bien
 * centrada sobre una placa grande puede dejar el centro del candidato algo por debajo.
 */
const VENTANA_ARRIBA_PCT = 45;
const VENTANA_ABAJO_PCT = 15;

/**
 * Tope de rectángulos de tapado que se estampan por foto (sin contar la banda de respaldo,
 * que se suma aparte cuando hace falta). Es el mismo número en los tres caminos que tapan
 * por color; antes el caso "la IA no ve placa" usaba 2 y el caso "la IA no pudo opinar" 3,
 * sin ninguna razón documentada. 3 alcanza para una escena con la placa + un par de
 * objetos amarillos y acota cuánta foto se puede llegar a tapar en el peor caso.
 */
const MAX_ZONAS_TAPADAS = 3;

/**
 * Elige, entre los candidatos amarillos, TODOS los que concuerdan con la pista de la IA
 * (ordenados del que mejor concuerda al que peor, recortados a `MAX_ZONAS_TAPADAS`).
 *
 * POR QUÉ DEVUELVE VARIOS Y NO SOLO "EL MEJOR": el puntaje es una heurística construida
 * sobre una pista que se sabe sesgada, y equivocarse aquí no cuesta un poco, cuesta todo —
 * si se tapa un único rectángulo y era el equivocado (el taxi amarillo del fondo), la placa
 * real queda 100% legible Y ADEMÁS el camino de la banda de respaldo ya no corre, porque el
 * flujo retorna al haber "tapado algo". Es exactamente el incidente que este módulo existe
 * para cerrar. Tapar todos los candidatos plausibles de la ventana aplica el mismo criterio
 * que el archivo ya usa en el caso "la IA no ve placa": tapar de más un objeto amarillo es,
 * como mucho, un problema estético; dejar legible la placa de un cliente no.
 *
 * PUNTAJE: distancia en X con peso doble (es el eje en el que la IA sí es confiable) más
 * la distancia en Y medida contra el centro ESPERADO de la placa (`cy` de la pista menos
 * `SESGO_ESPERADO_PCT`), no contra el centro crudo de la pista.
 *
 * DEVUELVE TAMBIÉN LOS `descartados` por el recorte a `MAX_ZONAS_TAPADAS`, y eso no es
 * cosmético: si en la ventana caen más candidatos de los que se pueden tapar, la placa real
 * PUEDE ser uno de los que quedaron afuera (el puntaje es una heurística sobre una pista que
 * se sabe sesgada, no una medición de "esto es una placa"), y basta con que uno de los 3
 * elegidos pase el listón de calidad para que el llamador crea que ya tapó la placa y no
 * agregue la banda — publicando `via:'color'` sobre una foto con la placa legible. El
 * llamador inspecciona los descartados para decidir si necesita la banda, y el log imprime el
 * conteo real de la ventana (antes se logueaba `elegidos.length`, que ya viene truncado a 3 y
 * por lo tanto borraba justo el rastro que haría falta para detectar esto en producción).
 */
function elegirCandidatosConPista(
  candidatos: CandidatoPlaca[],
  pista: CajaPct,
): { elegidos: CandidatoPlaca[]; descartados: CandidatoPlaca[] } {
  const { cx: pcx, cy: pcy } = centro(pista);
  const cyEsperado = pcy - SESGO_ESPERADO_PCT;

  const dentro: { candidato: CandidatoPlaca; puntaje: number }[] = [];
  for (const c of candidatos) {
    const { cx, cy } = centro(c);
    const dx = Math.abs(cx - pcx);
    const dy = cy - pcy; // negativo = el candidato está ARRIBA de la pista (lo esperado)
    if (dx > TOLERANCIA_X_PCT) continue;
    if (dy < -VENTANA_ARRIBA_PCT || dy > VENTANA_ABAJO_PCT) continue;
    dentro.push({ candidato: c, puntaje: dx * 2 + Math.abs(cy - cyEsperado) });
  }

  dentro.sort((a, b) => a.puntaje - b.puntaje);
  return {
    elegidos: dentro.slice(0, MAX_ZONAS_TAPADAS).map(d => d.candidato),
    descartados: dentro.slice(MAX_ZONAS_TAPADAS).map(d => d.candidato),
  };
}

/**
 * Ancho mínimo que debe tener un candidato de color, como fracción del ancho de la pista de
 * la IA, para aceptar que "ya está la placa tapada" y NO estampar además la banda de
 * respaldo. Un candidato mucho más angosto que la pista suele ser un jirón de la placa (un
 * reflejo, una placa en sombra que la máscara solo atrapa a medias), y tapar el jirón deja
 * el resto legible.
 */
const FRACCION_ANCHO_PISTA_MIN = 0.5;

/**
 * Filtro extra para usar un candidato de color SIN pista de la IA que lo respalde (porque la
 * IA falló técnicamente, o porque dijo que no hay placa). En ese caso nadie descarta el taxi
 * amarillo del fondo, así que se exige que el candidato se parezca de verdad a una placa:
 * relleno alto (rectángulo amarillo sólido, no una mancha irregular), proporción cercana a la
 * de una placa real y un tamaño mínimo en la foto.
 *
 * El piso de relleno (0.62) está calibrado con fotos reales: las placas reales medidas dan
 * 0.70–0.92, mientras que el emblema dorado de Chevrolet en el frente de un Tracker —que es
 * amarillo y con proporción ~3:1, y por eso pasaba los demás filtros— da 0.55 y aquí queda
 * descartado.
 */
function esCandidatoFuerte(c: CandidatoPlaca): boolean {
  return c.relleno >= 0.62 && c.aspecto >= 1.5 && c.aspecto <= 3.6 && c.w_pct >= 4;
}

/**
 * ¿Este candidato alcanza, POR SÍ SOLO, para dar por tapada la placa que la IA dice que hay
 * en `pista`? Es el listón del Caso B y se usa en las DOS direcciones, que es justo lo que le
 * da sentido:
 *  - sobre los candidatos TAPADOS: si ninguno lo pasa, no se puede afirmar que se tapó la
 *    placa (se tapó un jirón o un objeto amarillo cualquiera) → hace falta la banda.
 *  - sobre los candidatos DESCARTADOS por `MAX_ZONAS_TAPADAS`: si alguno lo pasa, ese que se
 *    dejó afuera podía ser la placa → hace falta la banda igual.
 * Usar el MISMO criterio en ambos lados es deliberado: no tendría sentido aceptar "ya está
 * tapada" por un candidato que cumple X y, a la vez, ignorar un descartado que cumple X.
 */
function esSolidoParaPista(c: CandidatoPlaca, pista: CajaPct): boolean {
  return esCandidatoFuerte(c) && c.w_pct >= pista.w_pct * FRACCION_ANCHO_PISTA_MIN;
}

/**
 * Banda de respaldo: se usa cuando la IA dice que SÍ hay placa pero el detector de color NO
 * encontró ningún candidato (placa no amarilla, quemada por el sol, en sombra extrema,
 * comida por la compresión de un pantallazo de WhatsApp, o ya parcialmente tapada por un
 * sello de una corrida anterior).
 *
 * POR QUÉ ES TAN GRANDE — leer antes de "optimizarla": en este escenario la ÚNICA ubicación
 * disponible es la pista de la IA, y esa pista es justo la que se sabe SESGADA (la `y` cae
 * sistemáticamente por debajo de la placa real: 13.6 / 14.9 / 21.4 / 27.6 puntos en las 4
 * fotos reales de producción medidas — ver `SESGO_ESPERADO_PCT`). Tapar ahí una caja ajustada
 * es exactamente lo que falló en producción y dejó placas de clientes 100% legibles. Por eso
 * NO se tapa una caja ajustada: se tapa una banda deliberadamente generosa, expandida hacia
 * ARRIBA lo suficiente para absorber ese sesgo y un poco hacia abajo por si el sesgo se
 * invierte. Sí, tapa bastante más foto de lo necesario — es intencional: es el respaldo
 * seguro, y la telemetría `[PLACA-VIA-BANDA-RESPALDO]` permite medir qué tan seguido se cae
 * aquí.
 *
 * LOS DOS LÍMITES ESTÁN ATADOS A LA VENTANA DE RECONCILIACIÓN A PROPÓSITO (no son números
 * sueltos): esa ventana declara qué rango vertical el sistema considera plausible para la
 * placa (`VENTANA_ARRIBA_PCT` / `VENTANA_ABAJO_PCT`). Si la banda cubriera menos que eso
 * quedaría una franja ciega — un rango donde el sistema admite que puede estar la placa pero
 * el respaldo no tapa. Eso no es teórico: con la expansión anterior (22 pts hacia arriba) y
 * la pista real de producción de la foto trasera del DEEPAL (cy=79%, placa real en y
 * 54.2–56.5%), la banda arrancaba en 57% y la placa quedaba ÍNTEGRA y legible justo encima
 * del tapado — verificado mirando la imagen de salida del pipeline completo. El lado de
 * abajo tenía el mismo defecto al revés: 8 pts contra los 15 de la ventana dejaban 7 puntos
 * ciegos.
 *
 * Hacia abajo, además, el mínimo se compara contra el ALTO de la propia pista: en una foto
 * de primer plano la placa ocupa mucho alto (`h_pct` ~20) y, si el sesgo de esa foto es
 * chico, `cy + 8` cortaba antes del borde inferior de la placa.
 */
const BANDA_ARRIBA_PCT = VENTANA_ARRIBA_PCT;
const BANDA_ABAJO_PCT = VENTANA_ABAJO_PCT;
// El ancho también se expande (60% del ancho de la pista por lado, con un piso del 20% del
// ancho de la imagen): la IA acierta en X mucho mejor que en Y, pero un desvío horizontal de
// unos pocos puntos deja asomar un pedazo de placa por el costado de la banda — probado con
// foto real (Kia con sello previo: con la banda más angosta quedaba visible el borde amarillo
// con "SABANETA" a la derecha del tapado).
const BANDA_ANCHO_EXTRA_FRACCION = 0.6;
const BANDA_ANCHO_MIN_PCT = 20;

function bandaRespaldo(pista: CajaPct): CajaPct {
  const { cx, cy } = centro(pista);
  // El centro de la pista se acota al lienzo ANTES de expandir. `rangoValido` valida cada
  // porcentaje por separado y por lo tanto admite pistas que no caben en la imagen (p. ej.
  // `y_pct:95, h_pct:100` → `cy = 145`): sin este tope, `arriba = 100` y `abajo = 100`
  // daban una banda de alto 1 apoyada en el borde inferior — un rectángulo que `composite`
  // ni siquiera alcanza a pintar, devolviendo `difuminada:true` sobre la foto intacta. Con
  // el tope, la banda siempre cae dentro de la imagen y mide al menos `BANDA_ABAJO_PCT` de
  // alto. (`cx` ya estaba acotado por el `Math.min(100 - ancho, ...)` de abajo.)
  const cyLienzo = Math.min(100, Math.max(0, cy));

  const ancho = Math.max(BANDA_ANCHO_MIN_PCT, pista.w_pct * (1 + 2 * BANDA_ANCHO_EXTRA_FRACCION));
  const x = Math.max(0, Math.min(100 - Math.min(ancho, 100), cx - ancho / 2));

  const arriba = Math.max(0, cyLienzo - BANDA_ARRIBA_PCT);
  const abajo = Math.min(100, cyLienzo + Math.max(BANDA_ABAJO_PCT, pista.h_pct * 0.75));

  return {
    x_pct: x,
    y_pct: arriba,
    w_pct: Math.min(ancho, 100 - x),
    h_pct: Math.max(1, abajo - arriba),
  };
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
 * puede invocarse 1 o N veces por foto, una por cada zona a tapar (ver la reconciliación en
 * `detectarYDifuminarPlaca`), y no queríamos duplicar este bloque de SVG.
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

/**
 * Compone los rectángulos de marca (100% opacos) sobre la imagen, todos en la MISMA llamada
 * a `sharp().composite([...])`.
 */
async function taparZonas(buffer: Buffer, rectangulos: Rectangulo[]): Promise<Buffer> {
  const capas = await Promise.all(
    rectangulos.map(async (r) => ({
      input: await generarRectanguloMarca(r.width, r.height),
      left: r.left,
      top: r.top,
    }))
  );
  return sharp(buffer).composite(capas).jpeg({ quality: 90 }).toBuffer();
}

/**
 * Camino de respaldo cuando la IA NO pudo opinar (sin API key, o fallo técnico tras agotar el
 * reintento). No se deja la placa expuesta solo porque la IA no respondió: si el detector
 * determinístico de color encontró candidatos claramente con forma de placa
 * (`esCandidatoFuerte`, criterio más estricto justamente porque aquí no hay pista de la IA que
 * descarte el taxi amarillo del fondo), se tapan igual.
 *
 * En todos los casos devuelve `moderacionEvaluada: false` — la moderación de contenido NO se
 * pudo evaluar, así que la foto debe ir a revisión manual (fail-closed en el call site), tape
 * o no tape placa.
 */
async function resolverSinIA(
  buffer: Buffer,
  candidatos: CandidatoPlaca[],
  imgW: number,
  imgH: number,
): Promise<ResultadoDeteccion> {
  const fuertes = candidatos.filter(esCandidatoFuerte).slice(0, MAX_ZONAS_TAPADAS);
  if (fuertes.length === 0) {
    console.warn('[blur-placas][PLACA-NO-TAPADA] La IA no pudo evaluar la foto y el detector de color no encontró ninguna placa amarilla clara — foto sin tapar y marcada para revisión manual');
    return { buffer, difuminada: false, contenidoInapropiado: false, moderacionEvaluada: false, via: 'ninguna' };
  }

  const rectangulos = fuertes.map(c => rectanguloDesdeCaja(c, imgW, imgH, MARGEN_CANDIDATO_COLOR));
  console.warn(
    `[blur-placas][PLACA-VIA-COLOR-SIN-IA] La IA no pudo evaluar la foto, pero el detector de color encontró ${fuertes.length} placa(s) amarilla(s) clara(s) — se tapan igual (la foto queda además marcada para revisión manual porque no hubo moderación de contenido)`,
    rectangulos,
  );
  const resultado = await taparZonas(buffer, rectangulos);
  return { buffer: resultado, difuminada: true, contenidoInapropiado: false, moderacionEvaluada: false, via: 'color_sin_ia' };
}

/**
 * Detecta la placa de una foto de vehículo y la tapa con el sello opaco de marca DrivePass,
 * y de paso obtiene la moderación de contenido de la foto.
 *
 * ARQUITECTURA HÍBRIDA (IA decide SI, detector de color decide DÓNDE)
 * ------------------------------------------------------------------
 * 1. Claude vision responde `plate_visible` / `inappropriate_content` y una región
 *    aproximada. Eso es lo que la IA hace bien.
 * 2. `detectarPlacasPorColor` (lib/detectar-placa-color.ts, determinístico, sin red) dice
 *    DÓNDE está la placa buscando el rectángulo amarillo real en los píxeles.
 * 3. Se reconcilian: se tapa el candidato amarillo que concuerda con la pista de la IA.
 *
 * POR QUÉ SE CAMBIÓ EL DISEÑO ANTERIOR (2 llamadas independientes → 1 sola llamada)
 * --------------------------------------------------------------------------------
 * El diseño anterior hacía SIEMPRE 2 llamadas independientes a Claude y tapaba las 2 regiones
 * devueltas, con la idea de que si una se equivocaba la otra cubriera el hueco. Ese diseño se
 * abandona porque la evidencia de producción demostró que NO protege contra el fallo real:
 * la coordenada vertical de Claude viene SISTEMÁTICAMENTE sesgada hacia abajo (13.6 a 27.6
 * puntos porcentuales por debajo de la placa real en las 4 fotos medidas, ver
 * `SESGO_ESPERADO_PCT` — Tracker trasera: placa en y≈51%, las DOS llamadas devolvieron
 * y=63.5%; DEEPAL frente: placa en y≈55%, las dos llamadas devolvieron 72.5% y 73.5%).
 * Como las 2 llamadas cometen el MISMO error y coinciden entre sí, el chequeo de
 * divergencia nunca se disparaba y los 2 rectángulos se estampaban en el mismo lugar
 * equivocado (el paragolpes, debajo de la placa), dejando placas de clientes reales 100%
 * legibles en fotos públicas. Duplicar una llamada sesgada no corrige un sesgo sistemático:
 * solo duplica el costo. Por eso ahora es 1 sola llamada (con su reintento técnico) y la
 * ubicación la resuelve el detector de color.
 *
 * Costo por foto: 1 llamada a la API en el caso normal (2 como máximo si la primera falla por
 * un problema técnico), contra las 2–4 del diseño anterior.
 */
export async function detectarYDifuminarPlaca(
  bufferOriginal: Buffer,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' = 'image/jpeg'
): Promise<ResultadoDeteccion> {
  // Corregir orientación EXIF primero: tanto la imagen que ve Claude como la
  // región que recortamos/componemos deben trabajar sobre los mismos píxeles
  // "derechos", si no el % de región que calcula Claude (sobre la imagen ya
  // rotada) no coincide con las coordenadas de un buffer sin rotar. El detector
  // de color trabaja sobre ESE mismo buffer ya normalizado.
  const buffer = await normalizarOrientacion(bufferOriginal, mediaType);

  const meta = await sharp(buffer).metadata();
  const imgW = meta.width ?? 1;
  const imgH = meta.height ?? 1;

  // Detector determinístico de placa amarilla: corre SIEMPRE (es local, sin red, ~10–90ms) y
  // es quien decide DÓNDE tapar. Si llegara a fallar, se sigue sin candidatos (la banda de
  // respaldo cubre el caso) en vez de tumbar toda la subida de la foto.
  let candidatos: CandidatoPlaca[] = [];
  try {
    candidatos = await detectarPlacasPorColor(buffer);
  } catch (err) {
    console.error('[blur-placas] El detector de placa por color falló — se continúa solo con la pista de la IA:', err);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('[blur-placas][MODERACION-NO-EVALUADA] ANTHROPIC_API_KEY no configurada — foto subida SIN evaluar contenido (fail-closed en el call site: va a revisión manual)');
    return resolverSinIA(buffer, candidatos, imgW, imgH);
  }

  // Normalizar a JPEG para base64 (menor tamaño)
  const jpegBuf = await sharp(buffer).jpeg({ quality: 85 }).toBuffer();
  const base64 = jpegBuf.toString('base64');

  // UNA llamada a Claude, con UN reintento solo si falla por un problema técnico (error de
  // API o respuesta sin JSON válido). Ver el comentario de arquitectura arriba para por qué
  // ya no son 2 llamadas independientes.
  let llamada = await llamarClaudeDeteccionPlaca(base64);
  if (!llamada.ok) {
    console.warn(`[blur-placas] Intento 1/2 falló (motivo: ${llamada.motivo}) — reintentando una vez más antes de rendirse`);
    llamada = await llamarClaudeDeteccionPlaca(base64);
  }

  if (!llamada.ok) {
    // Fallo técnico tras agotar el reintento: no hay moderación de contenido, pero la placa
    // igual se tapa si el detector de color la encontró.
    logFalloDefinitivo(llamada);
    return resolverSinIA(buffer, candidatos, imgW, imgH);
  }

  const deteccion = llamada.deteccion;

  const contenidoInapropiado = deteccion.inappropriate_content === true;
  const motivoInapropiado = contenidoInapropiado
    ? (deteccion.inappropriate_reason || 'Contenido marcado como inapropiado por la IA')
    : undefined;

  if (contenidoInapropiado) {
    console.warn('[blur-placas] Foto marcada por la IA como contenido inapropiado:', motivoInapropiado);
  }

  const ev = evaluarRegion(deteccion, imgW, imgH);

  // --- Caso A: la IA dice que NO hay placa (o devolvió una pista con forma imposible) ---
  if (!ev.valida) {
    const fuertes = candidatos.filter(esCandidatoFuerte).slice(0, MAX_ZONAS_TAPADAS);
    if (fuertes.length === 0) {
      console.warn(`[blur-placas][PLACA-NO-TAPADA] La IA no reporta placa visible (motivo: ${ev.motivo}) y el detector de color tampoco encontró una placa amarilla clara — foto publicada sin tapar`);
      return { buffer, difuminada: false, contenidoInapropiado, motivoInapropiado, moderacionEvaluada: true, via: 'ninguna' };
    }
    // La IA dijo que no, pero hay un rectángulo amarillo con forma inequívoca de placa. Se
    // tapa igual: una placa legible de un cliente es un problema de privacidad real, mientras
    // que tapar de más un objeto amarillo es, como mucho, un problema estético.
    const rectangulos = fuertes.map(c => rectanguloDesdeCaja(c, imgW, imgH, MARGEN_CANDIDATO_COLOR));
    console.warn(
      `[blur-placas][PLACA-VIA-COLOR-SIN-PISTA] La IA no reporta placa visible (motivo: ${ev.motivo}) pero el detector de color encontró ${fuertes.length} placa(s) amarilla(s) clara(s) — se tapan por privacidad`,
      rectangulos,
    );
    const resultado = await taparZonas(buffer, rectangulos);
    return { buffer: resultado, difuminada: true, contenidoInapropiado, motivoInapropiado, moderacionEvaluada: true, via: 'color_sin_pista' };
  }

  // --- Caso B: la IA dice que SÍ hay placa y el detector de color concuerda con la pista ---
  // Se tapan los candidatos que caen en la ventana (no solo el mejor puntuado): ver
  // `elegirCandidatosConPista` para por qué elegir uno solo es un riesgo asimétrico. Si
  // caben más de `MAX_ZONAS_TAPADAS` en la ventana, los que sobran NO se ignoran en
  // silencio: se revisan uno por uno y, si alguno pudo ser la placa, se cubre la ventana
  // entera con la banda de respaldo (ver `descartadoSolido` abajo).
  const { elegidos, descartados } = elegirCandidatosConPista(candidatos, ev.caja);
  const dentroEnVentana = elegidos.length + descartados.length;
  if (elegidos.length > 0) {
    const { cx: pcx, cy: pcy } = centro(ev.caja);
    const rectangulos = elegidos.map(c => rectanguloDesdeCaja(c, imgW, imgH, MARGEN_CANDIDATO_COLOR));

    // CALIDAD MÍNIMA: este camino es el único de los tres que tiene una alternativa segura a
    // mano (la banda), así que no puede ser el más permisivo. Si ninguno de los candidatos
    // tapados parece de verdad una placa (`esSolidoParaPista`: el mismo `esCandidatoFuerte`
    // de los otros dos caminos MÁS un ancho comparable al de la pista), lo más probable es
    // que se haya tapado un jirón (placa en sombra que la máscara atrapa a medias) o un
    // objeto amarillo cualquiera — y devolver `difuminada:true` ahí publicaría como
    // "procesada" una foto con la placa aún legible. En ese caso se estampa TAMBIÉN la banda
    // de respaldo, en la misma composición.
    const hayCandidatoSolido = elegidos.some(c => esSolidoParaPista(c, ev.caja));
    // SEGUNDA razón para forzar la banda, independiente de la calidad de los que SÍ se
    // taparon: en la ventana cayeron más candidatos de los que se pueden tapar
    // (`MAX_ZONAS_TAPADAS`), y alguno de los que el `slice` dejó afuera habría contado él
    // solo como "placa tapada" (`esSolidoParaPista`). El orden lo decide un puntaje
    // heurístico sobre una pista que se sabe sesgada, no una medición de "esto es una
    // placa": si la placa real quedó 4ª y uno de los 3 elegidos es un amarillo bien formado
    // (un taxi, una valla) que pasa el mismo listón, `hayCandidatoSolido` da true y la foto
    // saldría con `via:'color'` — reportada como tapado preciso, con la placa legible.
    //
    // POR QUÉ SE MIRA *QUÉ* SE DESCARTÓ Y NO SOLO *CUÁNTOS* (medido con fotos reales): la
    // versión que forzaba la banda con solo `descartados.length > 0` degradaba fotos que ya
    // funcionaban bien. En `v16_trasera.jpg` de producción (9 candidatos, 5 en la ventana) la
    // placa es el candidato #1 y ya quedaba tapada con precisión; los descartados son motas
    // amarillas de la calle de ~35-150px con relleno 0.47-0.59, que no pueden ser una placa.
    // Con el conteo pelado esa foto pasaba de 0.5% a 14.9% de superficie tapada — una banda
    // que se come casi todo el carro en la foto principal del anuncio. El listón
    // `esSolidoParaPista` sí distingue: una placa real (o el taxi/valla del escenario de
    // riesgo) lo pasa y dispara la banda; una mota de la calle no.
    //
    // HUECO CONOCIDO (aceptado, y es el mismo que ya existía): si el candidato descartado
    // fuera la placa real pero llegara DÉBIL (un jirón angosto, placa en sombra) y además
    // uno de los 3 tapados fuera un amarillo sólido, no se agrega banda. Ese caso no es
    // detectable con la información disponible; lo que sí se cerró es el caso donde el
    // descartado tiene forma y tamaño de placa.
    const descartadoSolido = descartados.find(c => esSolidoParaPista(c, ev.caja));
    const necesitaBanda = !hayCandidatoSolido || descartadoSolido !== undefined;
    if (necesitaBanda) {
      const banda = bandaRespaldo(ev.caja);
      rectangulos.push(rectanguloDesdeCaja(banda, imgW, imgH, 0));
      const motivo = !hayCandidatoSolido
        ? `los ${elegidos.length} candidato(s) de color que concuerdan con la pista no llegan al listón de "placa clara" ` +
          `(relleno>=0.62, aspecto 1.5–3.6, ancho>=4% y >=${(FRACCION_ANCHO_PISTA_MIN * 100).toFixed(0)}% del ancho de la pista)`
        : `cayeron ${dentroEnVentana} candidatos en la ventana, solo se pueden tapar ${MAX_ZONAS_TAPADAS} ` +
          `(MAX_ZONAS_TAPADAS) y al menos uno de los ${descartados.length} descartado(s) tiene forma y tamaño de placa — puede ser la placa real`;
      console.warn(
        `[blur-placas][PLACA-VIA-COLOR-DEBIL] Se agrega la BANDA de respaldo además de tapar los candidatos porque ${motivo}.`,
        { candidatos: elegidos, dentroEnVentana, descartados, descartadoSolido, banda },
      );
    } else if (descartados.length > 0) {
      // No se agrega banda, pero el descarte queda registrado: es el dato que haría falta
      // para detectar en producción una placa que se esté yendo por este camino.
      console.warn(
        `[blur-placas][PLACA-DESCARTADOS-EN-VENTANA] ${dentroEnVentana} candidatos en la ventana, se tapan ${MAX_ZONAS_TAPADAS} ` +
        `(MAX_ZONAS_TAPADAS) y los ${descartados.length} restantes NO llegan al listón de "placa clara", así que no se agrega banda.`,
        { descartados },
      );
    }

    const { cx, cy } = centro(elegidos[0]);
    if (cy > pcy) {
      // Contradice el sesgo sistemático documentado (la placa real está ARRIBA de la pista,
      // nunca debajo): es la firma típica de un falso positivo amarillo (taxi, valla, luz).
      // Se tapa igual — junto con el resto de candidatos de la ventana — pero queda el rastro.
      console.warn(
        `[blur-placas][PLACA-CANDIDATO-DEBAJO-DE-PISTA] El candidato mejor puntuado está ${(cy - pcy).toFixed(1)} puntos DEBAJO del centro de la pista de la IA, ` +
        `cuando el sesgo medido dice que la placa debería estar ~${SESGO_ESPERADO_PCT} puntos por ENCIMA — posible falso positivo amarillo. Revisar si se repite.`,
      );
    }

    console.warn(
      `[blur-placas][PLACA-VIA-COLOR] Placa ubicada por el detector de color (${candidatos.length} candidato(s) amarillo(s) en la foto, ` +
      `${dentroEnVentana} dentro de la ventana, se tapan ${elegidos.length}${descartados.length > 0 ? ` — ${descartados.length} candidato(s) quedaron fuera por MAX_ZONAS_TAPADAS` : ' (todos)'}). ` +
      `Pista de la IA: centro (${pcx.toFixed(1)}%, ${pcy.toFixed(1)}%) — mejor candidato: centro (${cx.toFixed(1)}%, ${cy.toFixed(1)}%), ` +
      `desvío de la IA en Y: ${(pcy - cy).toFixed(1)} puntos porcentuales.`,
      rectangulos,
    );
    const resultado = await taparZonas(buffer, rectangulos);
    return {
      buffer: resultado, difuminada: true, contenidoInapropiado, motivoInapropiado, moderacionEvaluada: true,
      via: necesitaBanda ? 'color_con_banda' : 'color',
    };
  }

  // --- Caso C: la IA dice que SÍ hay placa pero el color no encontró (o no concuerda) ---
  // Banda de respaldo generosa centrada en la pista — ver `bandaRespaldo` para la
  // justificación de por qué aquí se tapa MÁS foto a propósito.
  const banda = bandaRespaldo(ev.caja);
  const rect = rectanguloDesdeCaja(banda, imgW, imgH, 0);
  console.warn(
    `[blur-placas][PLACA-VIA-BANDA-RESPALDO] La IA reporta placa visible pero ningún candidato del detector de color concuerda con su pista (${candidatos.length} candidato(s) amarillo(s) en la foto, ninguno dentro de la ventana de reconciliación) — se tapa una BANDA generosa centrada en la pista para absorber el sesgo vertical conocido de la IA. Monitorear frecuencia en producción.`,
    { pista: ev.caja, banda, rect },
  );
  const resultado = await taparZonas(buffer, [rect]);
  return { buffer: resultado, difuminada: true, contenidoInapropiado, motivoInapropiado, moderacionEvaluada: true, via: 'banda_respaldo' };
}
