import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { analizarAmarillo, zonasAmarillasEn, type CandidatoPlaca, type MascaraAmarilla } from './detectar-placa-color';
// El prefijo del motivo de retención vive en el módulo PURO lib/tapar-placa.ts porque también
// lo lee la vía manual (app/api/admin/tapar-placa) para distinguir "puede haber una placa a la
// vista" de "la IA vio contenido inapropiado" — las dos cosas caen hoy en la misma columna.
import { PREFIJO_REVISION_PLACA } from './tapar-placa';

const client = new Anthropic();

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
   * true cuando el sistema SABE que puede haber quedado una placa sin tapar bien y no tiene
   * forma automática de arreglarlo: la IA reporta una placa del vehículo protagonista que
   * ningún píxel confirma y de la que ella misma no está segura (`confidence: "low"`), o el
   * tapado calculado era tan grande que hubo que recortarlo. En esos casos NO se estampa una
   * banda gigante "por si acaso" (ver el comentario de arquitectura de
   * `detectarYDifuminarPlaca`): se deja constancia para que la foto pase por revisión
   * manual antes de publicarse. Los call sites lo tratan igual que `moderacionEvaluada:false`.
   */
  revisionManual: boolean;
  motivoRevision?: string;
  /**
   * Por qué camino se resolvió la UBICACIÓN de las placas de esta foto. Sirve para telemetría
   * y, sobre todo, para que un consumidor pueda distinguir un tapado MEDIDO SOBRE LOS PÍXELES
   * (el rectángulo amarillo real, vía detector de color) de uno que solo se apoya en la caja
   * que devolvió la IA. Lo usa app/api/admin/reprocesar-placas para no volver a estampar
   * sellos sobre una foto que ya salió de una corrida anterior.
   *  - `color`         : todas las zonas tapadas son rectángulos amarillos medidos en los píxeles.
   *  - `color_y_ia`    : algunas medidas por color y otras solo por la caja de la IA.
   *  - `ia`            : todas las zonas salen solo de la caja de la IA (nada confirmado por píxeles).
   *  - `color_sin_ia`  : la IA no pudo opinar; se taparon candidatos de color claros.
   *  - `ninguna`       : no se tapó nada (`difuminada` es false).
   */
  via: 'color' | 'color_y_ia' | 'ia' | 'color_sin_ia' | 'ninguna';
};

// ---------------------------------------------------------------------------------------
// REGLA DE COORDENADAS IMPRESA SOBRE LA IMAGEN
// ---------------------------------------------------------------------------------------

/**
 * Margen (fracción del lado corto) que se agrega arriba y a la izquierda para dibujar la
 * regla, con un piso en píxeles para que los números sigan siendo legibles en fotos chicas.
 */
const REGLA_MARGEN_FRACCION = 0.07;
const REGLA_MARGEN_MIN_PX = 56;

/**
 * Devuelve una copia de la foto con una REGLA (0–100) impresa en un margen blanco añadido
 * arriba y a la izquierda, más líneas guía magenta tenues cada 10 unidades sobre la propia
 * foto. Esta copia es SOLO para mandársela a la IA; el sello se estampa siempre sobre la
 * imagen limpia.
 *
 * POR QUÉ EXISTE (medido, no intuición): pidiéndole a Claude la caja de la placa como
 * porcentajes "a ojo", su coordenada VERTICAL viene sistemáticamente corrida — es el sesgo
 * de 13.6–27.6 puntos porcentuales que documentaba la versión anterior de este archivo y que
 * volvió a reproducirse al reescribirlo (foto trasera 3/4 del Tucson: placa real en y≈46%, la
 * IA respondió y≈60%; foto de frente del mismo carro: placa del furgón del fondo en y≈37%, la
 * IA respondió y≈21% con un prompt que le pedía no irse hacia abajo — o sea que el error no
 * tiene ni siquiera un signo estable, solo es grande). Con la regla impresa el modelo deja de
 * estimar números y los LEE de la imagen: en esas mismas fotos el error del centro bajó de
 * 14–16 puntos porcentuales a 2–4.
 *
 * Ese cambio es lo que permite que el respaldo "no hay confirmación de píxeles" sea una caja
 * acotada alrededor de la placa y ya no la banda gigante que tapaba media foto.
 */
async function conReglaDeCoordenadas(buffer: Buffer, imgW: number, imgH: number): Promise<Buffer> {
  const margen = Math.max(REGLA_MARGEN_MIN_PX, Math.round(Math.min(imgW, imgH) * REGLA_MARGEN_FRACCION));
  const lienzoW = imgW + margen;
  const lienzoH = imgH + margen;
  const fuente = Math.round(margen * 0.42);

  const partes: string[] = [];
  for (let p = 0; p <= 100; p += 5) {
    const grande = p % 10 === 0;
    const x = margen + (p / 100) * imgW;
    const y = margen + (p / 100) * imgH;
    const largo = margen * (grande ? 0.45 : 0.22);
    partes.push(`<line x1="${x.toFixed(1)}" y1="${(margen - largo).toFixed(1)}" x2="${x.toFixed(1)}" y2="${margen}" stroke="#000" stroke-width="${grande ? 3 : 2}"/>`);
    partes.push(`<line x1="${(margen - largo).toFixed(1)}" y1="${y.toFixed(1)}" x2="${margen}" y2="${y.toFixed(1)}" stroke="#000" stroke-width="${grande ? 3 : 2}"/>`);
    if (grande) {
      partes.push(`<text x="${x.toFixed(1)}" y="${(margen - largo - 4).toFixed(1)}" fill="#000" font-size="${fuente}" font-family="sans-serif" text-anchor="middle">${p}</text>`);
      partes.push(`<text x="${(margen - largo - 4).toFixed(1)}" y="${(y + fuente * 0.35).toFixed(1)}" fill="#000" font-size="${fuente}" font-family="sans-serif" text-anchor="end">${p}</text>`);
      if (p > 0 && p < 100) {
        partes.push(`<line x1="${x.toFixed(1)}" y1="${margen}" x2="${x.toFixed(1)}" y2="${lienzoH}" stroke="#FF00FF" stroke-opacity="0.35" stroke-width="2"/>`);
        partes.push(`<line x1="${margen}" y1="${y.toFixed(1)}" x2="${lienzoW}" y2="${y.toFixed(1)}" stroke="#FF00FF" stroke-opacity="0.35" stroke-width="2"/>`);
      }
    }
  }

  const svg = Buffer.from(
    `<svg width="${lienzoW}" height="${lienzoH}" xmlns="http://www.w3.org/2000/svg">${partes.join('')}</svg>`,
  );
  return sharp({ create: { width: lienzoW, height: lienzoH, channels: 3, background: '#FFFFFF' } })
    .composite([
      { input: await sharp(buffer).jpeg({ quality: 90 }).toBuffer(), left: margen, top: margen },
      { input: svg, left: 0, top: 0 },
    ])
    .jpeg({ quality: 85 })
    .toBuffer();
}

const PROMPT_DETECCION = `You are the privacy filter of a car-rental marketplace (DrivePass, Medellín, Colombia). Your job is to find EVERY licence plate visible in this photo, so the system can cover each one with an opaque sticker before publishing the photo.

READING THE COORDINATES — the image has a measuring RULER printed on it
A white margin was added on the TOP and on the LEFT of the photo, with a ruler marked from 0 to 100, and magenta guide lines are drawn across the photo every 10 units. USE THEM. To locate something, look at which magenta vertical line it sits next to (that is the horizontal coordinate: 0 at the left edge of the photo, 100 at the right edge) and which magenta horizontal line it sits next to (that is the vertical coordinate: 0 at the top edge of the photo, 100 at the bottom edge). Do NOT estimate these numbers by eye — READ them off the printed ruler and the guide lines. The photo area itself is {{W}} x {{H}} pixels; the white margins are NOT part of it and are not counted in the 0-100 scale.

WHAT COUNTS AS A PLATE
- Any vehicle registration plate physically mounted on any vehicle in the frame, front or rear.
- Include the plates of OTHER vehicles (parked cars, taxis, buses, vans, motorcycles, anything in the background), not only the car being advertised. A third party's plate is personal data too and must be covered.
- Colombian plates: private cars = yellow panel with black characters, roughly 2:1. Public-service vehicles = white panel. Motorcycles = smaller, roughly 1.3:1, with the characters on two lines. Foreign or other formats count as well.
- A plate counts even if it is small, blurry, seen at a steep angle, partially occluded by a tree or by another car, or you can only make out some of its characters. Assume the published photo is much sharper than what you are seeing, so report plates you can barely read too.
- If a plate is ALREADY covered by an opaque dark-navy rectangle with an orange border (this system's own sticker), do NOT report it — it is already handled. Report only plates whose surface is still visible.

DO NOT INVENT A PLATE
Reporting a plate that is not there is expensive: the system then covers that spot, spoiling the photo, while the real plate (if any) stays exposed. A car shot in pure side profile, a car whose bumper is out of frame, or a car with no front plate mounted (very common in Colombia) simply has no visible plate — return an empty list in that case. Never point at a fence, a wall, a sign, a reflection, a headlight or an empty patch of bumper.

FOR EVERY PLATE, reading the numbers off the ruler:
- x_pct / y_pct: the plate's LEFT edge and TOP edge on the 0-100 scale.
- w_pct / h_pct: the plate's width and its height on that same scale (width on the horizontal ruler, height on the vertical ruler). Give a TIGHT box around the plate panel's four physical edges, with no extra padding — the code adds its own safety margin afterwards.
- guides: which magenta guide lines the plate lies between, e.g. "between vertical 90 and 100, between horizontal 40 and 50". Fill this in BEFORE the numbers and make the numbers agree with it.
- anchor: a few words on what the plate is mounted on and what is immediately above and below it. If you cannot describe that, your box is a guess: lower the confidence or drop the plate.
- belongs_to: "subject_vehicle" for the car being advertised (the main subject of the photo), "other_vehicle" for any other vehicle.
- colour: the colour of the plate PANEL itself as it appears in this photo — "yellow" for the yellow panel of a Colombian private vehicle, "white" for the white panel of a public-service vehicle (taxi, bus, van, truck), "other" if it is neither or you cannot tell. Judge the panel's own colour, not the vehicle's. This matters: the code confirms yellow plates against the actual yellow pixels, and if you call a white plate yellow it will put the sticker on whatever yellow object happens to be nearby instead of on the plate.
- confidence: "high" only if you clearly see the plate panel AND you are sure of the box; "medium" if you see the plate but the box is approximate; "low" if you are not even sure it is a plate.
- legible: true if you can read at least part of the characters.

SEPARATELY, content moderation. Photos here are normal photos of a car (exterior, interior, engine bay), sometimes with a person near or inside the car (the owner showing the car, a normal selfie with the vehicle, someone in the driver's seat) — all of that is completely normal and fine. Flag the photo ONLY if it clearly and unambiguously shows sexual or explicit content that has no place in a car listing (nudity, sexually explicit poses or acts, pornography). Be conservative: a clothed person in any normal pose is NEVER inappropriate, and a false positive blocks a legitimate listing. When in doubt, do NOT flag it.

Think briefly first (which vehicles are in the frame, where each plate is on the ruler, and whether the content is appropriate), THEN respond with ONLY valid JSON, no markdown, as the very last part of your answer:
{"plates":[{"x_pct":number,"y_pct":number,"w_pct":number,"h_pct":number,"guides":"string","anchor":"string","belongs_to":"subject_vehicle"|"other_vehicle","colour":"yellow"|"white"|"other","confidence":"high"|"medium"|"low","legible":boolean}],"inappropriate_content":boolean,"inappropriate_reason":"short sentence only when inappropriate_content is true"}
If no plate is visible anywhere in the photo, return "plates": [].`;

/** Caja en porcentajes de la imagen (0–100) — mismo formato que devuelven la IA y el detector de color. */
type CajaPct = { x_pct: number; y_pct: number; w_pct: number; h_pct: number };

/** Una placa tal como la reporta la IA, ya validada. */
type PlacaIA = {
  caja: CajaPct;
  deSujeto: boolean;
  /**
   * Color del PANEL de la placa según la IA. Decide si esta placa se puede confirmar contra la
   * máscara amarilla: una placa BLANCA (servicio público — taxis, busetas, camiones, muy
   * comunes en el fondo de una foto en Medellín) es invisible para el detector de color, así
   * que cualquier amarillo que aparezca cerca es OTRA COSA. Caso real medido: en la foto de
   * frente del Tucson la IA ubicó bien la placa blanca de una buseta estacionada al fondo y el
   * sistema estampó el sello sobre el panel amarillo de la carrocería, 220 px a la derecha —
   * ensuciando la foto y dejando la placa a la vista, que es exactamente el fallo que este
   * arreglo existe para cerrar.
   */
  color: 'amarilla' | 'blanca' | 'otra';
  confianza: 'alta' | 'media' | 'baja';
  legible: boolean;
  anchor: string;
};

type PlacaDeteccion = {
  placas: PlacaIA[];
  contenidoInapropiado: boolean;
  motivoInapropiado?: string;
};

/**
 * Rectángulo final a tapar, en píxeles enteros de la imagen.
 *
 * Se exporta para el camino MANUAL (lib/tapar-placa-imagen.ts): cuando la detección
 * automática se rinde y marca la foto para revisión (`revisionManual`), un admin marca las
 * placas a mano y el servidor estampa el MISMO sello con `taparZonas` de aquí abajo.
 */
export type Rectangulo = { left: number; top: number; width: number; height: number };

/**
 * Resultado de UNA llamada a Claude para detección de placas/moderación, ya con el
 * parseo de JSON aplicado. Separado de `detectarYDifuminarPlaca` porque se invoca hasta
 * 2 veces por foto (1 llamada + 1 reintento técnico si la primera falla por API/JSON — ver
 * esa función) con exactamente la misma lógica de llamada + parseo.
 */
type LlamadaClaudeResultado =
  | { ok: true; deteccion: PlacaDeteccion }
  | { ok: false; motivo: 'api_error'; error: unknown }
  | { ok: false; motivo: 'sin_json'; stopReason: string | null | undefined; textoRespuesta: string }
  | { ok: false; motivo: 'json_invalido'; error: unknown; stopReason: string | null | undefined; textoRespuesta: string };

/**
 * ¿Los 4 números de una caja están dentro del contrato que el prompt le pide a la IA
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
 * Una caja fuera de rango no se "arregla" recortándola (no sabemos qué quiso decir el
 * modelo): se descarta esa placa y la foto se resuelve con las demás + los candidatos de
 * color, que sí son una ubicación medida sobre los píxeles.
 */
function rangoValido(r: { x_pct: number; y_pct: number; w_pct: number; h_pct: number }): boolean {
  const { x_pct, y_pct, w_pct, h_pct } = r;
  if (![x_pct, y_pct, w_pct, h_pct].every(n => typeof n === 'number' && Number.isFinite(n))) return false;
  if (x_pct < 0 || x_pct > 100 || y_pct < 0 || y_pct > 100) return false;
  if (w_pct <= 0 || w_pct > 100 || h_pct <= 0 || h_pct > 100) return false;
  return true;
}

/**
 * Proporción ancho:alto con la que se ACEPTA la caja que reporta la IA. Solo descarta
 * geometrías absurdas (una franja larguísima, o una caja mucho más alta que ancha): una caja
 * imposible no sirve ni siquiera como punto de partida.
 *
 * EL RANGO ES ANCHO A PROPÓSITO — se midió que el anterior (1.0–4.5) tiraba placas REALES:
 *  - Foto del DEEPAL del catálogo (1206x2622): la IA reportó bien la placa de un carro de
 *    terceros en el borde derecho como `{x:92,y:48,w:6,h:3}`. En píxeles eso es 72x79 →
 *    aspecto 0.92, y el filtro la descartaba EN SILENCIO: la placa se publicó a la vista.
 *    La causa es de resolución, no de criterio: el modelo lee las coordenadas de la regla
 *    impresa (marcas cada 5 unidades) y en una foto vertical una unidad vertical son 26 px,
 *    así que el alto de una placa chica se redondea hacia arriba y el aspecto sale aplastado.
 *  - Una placa vista en 3/4 (la trasera del Tucson) tiene bounding box casi cuadrado por
 *    perspectiva: 240x220 px, aspecto 1.09. También caía justo en el borde del filtro.
 * Una caja con forma rara no se tapa a ciegas por ser aceptada acá: si ningún píxel amarillo
 * la confirma, el margen que se le agrega y el techo `MAX_AREA_SELLO` acotan lo que se pinta.
 */
const ASPECTO_MIN = 0.5;
const ASPECTO_MAX = 6;

/**
 * Tamaño (en unidades de la regla, o sea puntos porcentuales del lado) a partir del cual la
 * FORMA de la caja de la IA significa algo y vale la pena filtrarla por proporción.
 *
 * El modelo devuelve las coordenadas en números enteros de la regla impresa, así que una placa
 * chica sale como `w:3, h:3` — y en una foto vertical de 1206x2622 esos dos "3" son 36 px de
 * ancho y 79 px de alto: una proporción de 0.46 que no describe la placa sino la cuadrícula
 * con la que se midió. Medido en la foto del DEEPAL del catálogo: la IA ubicó BIEN la placa de
 * un tercero en el borde derecho y el filtro de proporción la tiró dos corridas seguidas
 * (aspecto 0.92 y 0.46), dejándola publicada. Por debajo de este umbral la caja se toma como
 * lo único que de verdad aporta —un PUNTO y una escala aproximada— y la proporción se ignora;
 * por encima, la caja es lo bastante grande como para que una proporción imposible sea señal
 * de que el modelo señaló otra cosa (una valla, una ventana) y ahí sí se descarta.
 */
const LADO_MIN_PARA_FILTRAR_FORMA = 5;

/** Proporción que descarta una caja de la IA SIEMPRE, por chica que sea: no es un panel. */
const ASPECTO_ABSURDO_MIN = 0.15;
const ASPECTO_ABSURDO_MAX = 10;

/** Convierte el JSON crudo de la IA en placas validadas, descartando las cajas imposibles. */
function leerPlacas(bruto: unknown, imgW: number, imgH: number): PlacaIA[] {
  if (!bruto || typeof bruto !== 'object') return [];
  const lista = (bruto as { plates?: unknown }).plates;
  if (!Array.isArray(lista)) return [];

  const placas: PlacaIA[] = [];
  for (const cruda of lista) {
    if (!cruda || typeof cruda !== 'object') continue;
    const p = cruda as Record<string, unknown>;
    const caja = {
      x_pct: Number(p.x_pct), y_pct: Number(p.y_pct),
      w_pct: Number(p.w_pct), h_pct: Number(p.h_pct),
    };
    if (!rangoValido(caja)) {
      console.warn('[blur-placas] La IA devolvió una placa con coordenadas fuera de rango (se descarta esa placa):', p);
      continue;
    }
    const aspecto = ((caja.w_pct / 100) * imgW) / ((caja.h_pct / 100) * imgH);
    if (!Number.isFinite(aspecto) || aspecto < ASPECTO_ABSURDO_MIN || aspecto > ASPECTO_ABSURDO_MAX) {
      console.warn(`[blur-placas] La IA devolvió una placa con forma imposible (aspecto ${aspecto.toFixed(2)}, fuera de ${ASPECTO_ABSURDO_MIN}–${ASPECTO_ABSURDO_MAX}) — se descarta esa placa:`, p);
      continue;
    }
    const cajaGrande = caja.w_pct >= LADO_MIN_PARA_FILTRAR_FORMA && caja.h_pct >= LADO_MIN_PARA_FILTRAR_FORMA;
    if (cajaGrande && (aspecto < ASPECTO_MIN || aspecto > ASPECTO_MAX)) {
      console.warn(`[blur-placas] La IA devolvió una placa GRANDE con forma imposible (aspecto ${aspecto.toFixed(2)}, fuera de ${ASPECTO_MIN}–${ASPECTO_MAX}) — se descarta esa placa:`, p);
      continue;
    }
    const confianzaCruda = String(p.confidence ?? '').toLowerCase();
    const colorCrudo = String(p.colour ?? '').toLowerCase();
    placas.push({
      caja,
      deSujeto: String(p.belongs_to ?? '') === 'subject_vehicle',
      // Sin dato (respuesta vieja o campo ausente) se asume 'otra', que NO bloquea la
      // confirmación por color: se conserva el comportamiento anterior en vez de dejar de
      // confirmar placas amarillas por un campo que el modelo omitió.
      color: colorCrudo === 'yellow' ? 'amarilla' : colorCrudo === 'white' ? 'blanca' : 'otra',
      confianza: confianzaCruda === 'high' ? 'alta' : confianzaCruda === 'low' ? 'baja' : 'media',
      legible: p.legible === true,
      anchor: typeof p.anchor === 'string' ? p.anchor.slice(0, 120) : '',
    });
  }
  return placas;
}

async function llamarClaudeDeteccionPlaca(base64: string, imgW: number, imgH: number): Promise<LlamadaClaudeResultado> {
  let text = '';
  let stopReason: string | null | undefined;
  try {
    const resp = await client.messages.create({
      model: 'claude-opus-4-8',
      // Se pide razonar en prosa antes del JSON final (ver prompt más arriba) y ahora la
      // respuesta puede traer VARIAS placas con sus descripciones, así que hace falta más
      // margen que el 2048 anterior para que el JSON no se trunque antes de cerrar.
      max_tokens: 3000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
          },
          {
            type: 'text',
            text: PROMPT_DETECCION.replace('{{W}}', String(imgW)).replace('{{H}}', String(imgH)),
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
    // "plates" (no la primera): si el razonamiento incluye un JSON de borrador
    // descartado antes de la corrección final, la primera ocurrencia apuntaría a
    // ese borrador con coordenadas equivocadas. Balanceamos llaves desde ahí hacia
    // adelante en vez de un simple "primer { … último }" (que se rompería si el
    // razonamiento previo contuviera alguna llave suelta).
    // TODO: el balanceo de llaves no es JSON-aware (no ignora llaves dentro de
    // strings); hoy los campos de texto libre que devuelve el modelo (`anchor`,
    // `guides`, `inappropriate_reason`) son frases cortas sin llaves, pero es el
    // punto a revisar si alguna vez aparece un JSON que no se pueda leer.
    const claveIdx = text.lastIndexOf('"plates"');
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
      const bruto = JSON.parse(jsonStr) as Record<string, unknown>;
      // `plates` ausente NO es "sin placas": es una respuesta que no cumple el contrato, y
      // tratarla como lista vacía publicaría la foto sin tapar nada. Se trata como JSON
      // inválido para que corra el reintento y, si tampoco sirve, el camino sin IA.
      if (!Array.isArray(bruto.plates)) {
        return { ok: false, motivo: 'json_invalido', error: new Error('la respuesta no trae el arreglo "plates"'), stopReason, textoRespuesta: text };
      }
      const contenidoInapropiado = bruto.inappropriate_content === true;
      return {
        ok: true,
        deteccion: {
          placas: leerPlacas(bruto, imgW, imgH),
          contenidoInapropiado,
          motivoInapropiado: contenidoInapropiado
            ? (typeof bruto.inappropriate_reason === 'string' && bruto.inappropriate_reason
                ? bruto.inappropriate_reason
                : 'Contenido marcado como inapropiado por la IA')
            : undefined,
        },
      };
    }
    // Sin JSON reconocible: no se pudo leer NI las placas NI la moderación de esta
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

/** Centro de una caja en porcentajes. */
function centro(caja: CajaPct): { cx: number; cy: number } {
  return { cx: caja.x_pct + caja.w_pct / 2, cy: caja.y_pct + caja.h_pct / 2 };
}

/**
 * Convierte una caja en % a un rectángulo en píxeles enteros, recortado a los límites de la
 * imagen y expandido con un margen en PÍXELES por lado (`padX`/`padY`).
 *
 * El margen entra en píxeles y no en "% de la imagen" a propósito, y es el cambio que
 * arregla el fallo que motivó esta reescritura: todo lo que se expresaba como porcentaje del
 * lienzo cambiaba de tamaño real según la orientación de la foto (los mismos 45 puntos
 * porcentuales de alto son 1361 px en una foto apaisada de 3024x4032... y 1814 px en la misma
 * foto en vertical). Los llamadores calculan `padX`/`padY` a partir del tamaño estimado de la
 * PLACA, que es la única escala con sentido físico acá.
 */
function rectanguloDesdeCaja(caja: CajaPct, imgW: number, imgH: number, padX: number, padY: number): Rectangulo {
  const boxLeft = (caja.x_pct / 100) * imgW;
  const boxTop  = (caja.y_pct / 100) * imgH;
  const boxW    = (caja.w_pct / 100) * imgW;
  const boxH    = (caja.h_pct / 100) * imgH;

  const px = Math.max(0, Math.round(padX));
  const py = Math.max(0, Math.round(padY));

  // El origen se acota a `imgW-1`/`imgH-1` (no solo a >= 0): `rangoValido` valida cada
  // porcentaje POR SEPARADO y por lo tanto admite cajas que NO caben en la imagen (p. ej.
  // `y_pct:100`, o `y_pct:95 + h_pct:100`). Sin este tope, `top` podía salir exactamente
  // igual a `imgH` y entonces `composite` NO lanza y tampoco pinta un solo píxel: el
  // llamador devolvía `difuminada:true` sobre una foto intacta, o sea una placa legible
  // reportada como ya procesada — el peor de los dos fallos posibles aquí.
  const left   = Math.min(imgW - 1, Math.max(0, Math.floor(boxLeft - px)));
  const top    = Math.min(imgH - 1, Math.max(0, Math.floor(boxTop - py)));
  const right  = Math.min(imgW, Math.ceil(boxLeft + boxW + px));
  const bottom = Math.min(imgH, Math.ceil(boxTop + boxH + py));
  // El `Math.max(1, ...)` final es una red de seguridad, no el filtro principal: `rangoValido`
  // no exige que la caja quepa en la imagen, así que para una caja que se sale por
  // abajo/derecha `right - left` o `bottom - top` pueden ser <= 0, y es el clamp de
  // `left`/`top` de arriba + este `Math.max(1, ...)` lo que garantiza un rectángulo de al
  // menos 1px REAL dentro del lienzo, en vez de un `composite` que no pinta nada (falso
  // `difuminada:true`) o que lanza y convierte la subida en un 500.
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

function rectanguloDeCandidato(c: CandidatoPlaca, imgW: number, imgH: number): Rectangulo {
  const w = (c.w_pct / 100) * imgW;
  const h = (c.h_pct / 100) * imgH;
  return rectanguloDesdeCaja(c, imgW, imgH, Math.max(4, w * MARGEN_CANDIDATO_COLOR), Math.max(4, h * MARGEN_CANDIDATO_COLOR));
}

// ---------------------------------------------------------------------------------------
// Reconciliación entre las cajas que reporta la IA y los candidatos del detector
// determinístico de color. TODAS las tolerancias de acá se miden en píxeles y en unidades
// del TAMAÑO ESTIMADO DE LA PLACA, nunca en porcentaje del lienzo: un porcentaje del lienzo
// significa cosas distintas en una foto vertical y en una horizontal, y ese fue exactamente
// el defecto que produjo las barras gigantes en las fotos verticales del Tucson.
// ---------------------------------------------------------------------------------------

/**
 * Escala de referencia de una placa, en PÍXELES: el lado LARGO del panel tal como se ve en la
 * foto, estimado desde la caja de la IA. Se toma el mayor entre su ancho y su alto (y no
 * "ancho o el doble del alto", como en un primer intento): una placa colombiana es ~2:1 de
 * frente, pero en una toma 3/4 o con la cámara inclinada su bounding box llega a ser casi
 * cuadrado, y multiplicar el alto por 2 en ese caso sobreestimaba la placa un 50% y hacía
 * sellos innecesariamente grandes. El piso del 2% del lado corto evita tolerancias de 3 px
 * cuando el modelo devuelve una caja diminuta.
 */
function escalaPlacaPx(caja: CajaPct, imgW: number, imgH: number): number {
  const w = (caja.w_pct / 100) * imgW;
  const h = (caja.h_pct / 100) * imgH;
  return Math.max(w, h, 0.02 * Math.min(imgW, imgH));
}

/**
 * Error residual de la caja de la IA, como fracción de CADA lado de la imagen. Se aplica por
 * eje (no como un porcentaje único del lienzo) justamente porque el modelo lee cada
 * coordenada de SU propia regla: un error de media marca menor de la regla horizontal son
 * ~2.5 puntos del ancho, y de la vertical, ~2.5 puntos del alto. Medido sobre el banco de
 * fotos reales, el error del centro quedó entre 1.6 y 5.7 puntos por eje, así que 3 puntos de
 * margen por lado cubren el caso típico y `MAX_AREA_SELLO` acota el peor.
 *
 * Es el reemplazo del término que antes vivía en `bandaRespaldo` como 45 puntos de alto: la
 * diferencia de escala (3 contra 45) es exactamente lo que aporta la regla impresa.
 */
const ERROR_IA_FRACCION_LADO = 0.03;

/** Margen del sello respecto del tamaño de la propia caja, por lado. */
const MARGEN_IA_FRACCION_CAJA = 0.5;

/**
 * TOLERANCIA DE UBICACIÓN de la caja de la IA, POR EJE, como fracción de cada lado de la
 * imagen. Es la vara con la que se mide "¿este rectángulo amarillo está donde la IA dijo?".
 *
 * Va por eje y no como una distancia isotrópica en "escalas de placa" porque el modelo lee
 * cada coordenada de SU PROPIA regla: el error en X se mide contra el ancho y el error en Y
 * contra el alto, y en una foto vertical esos dos lados difieren en un 33%. Un radio único en
 * píxeles trata los dos ejes como si fueran el mismo, que es la misma confusión de unidades
 * que produjo la barra gigante.
 *
 * 0.08 sale de medir el error real del centro sobre el banco de fotos (placa confirmada por
 * píxeles contra caja de la IA): 0.2, 0.6, 2.4, 3.3, 4.5 y 6.7 puntos porcentuales. Las placas
 * grandes y de frente caen por debajo de 1; las chicas del fondo, en 4–7. Con 8 puntos de
 * tolerancia entran todas las correctas del banco (distancia normalizada 0.71 a 1.34) y queda
 * afuera el falso positivo que motivó este cambio: en la foto del KIA Seltos del catálogo, un
 * matorral amarillento del borde izquierdo estaba a 3.9 tolerancias en X y 3.3 en Y de la
 * placa (distancia normalizada 5.1) y el sistema le estampaba el sello encima mientras la
 * placa seguía legible.
 *
 * OJO: esto NO es el margen del sello. El sello se dibuja del tamaño del amarillo MEDIDO (ver
 * `rectanguloDeCandidato`); esta constante solo decide qué amarillo se acepta como la placa.
 * El margen del tapado a ciegas sigue siendo `ERROR_IA_FRACCION_LADO`, que es mucho más chico
 * porque ahí sí se pinta sobre la foto.
 */
const TOLERANCIA_IA_FRACCION_LADO = 0.08;

/**
 * Distancia normalizada máxima (en tolerancias, ver arriba) para aceptar que un rectángulo
 * amarillo ES la placa que la IA reporta. La ventana de búsqueda usa este mismo número, así
 * que un candidato que pasa el filtro de la ventana pasa también el de la distancia: son la
 * misma condición escrita dos veces (una barata, sobre los candidatos ya calculados, y otra
 * exacta).
 *
 * Hay dos valores según lo que la IA haya dicho del COLOR del panel:
 *  - `AMARILLA`: la IA afirma que la placa es amarilla Y hay amarillo cerca; las dos cosas
 *    apuntan al mismo sitio y se acepta con la tolerancia completa.
 *  - `OTRA` (la IA no sabe de qué color es): el amarillo cercano bien puede ser otro objeto, y
 *    la caja de la IA es mejor apuesta, así que se exige que el amarillo esté mucho más pegado.
 * (Una placa `BLANCA` ni llega hasta acá: no se busca amarillo para ella — ver `PlacaIA.color`.)
 */
const DISTANCIA_MAX_AMARILLA = 2.0;
const DISTANCIA_MAX_OTRA = 1.0;

/**
 * El candidato de color tiene que ser además de un tamaño COMPARABLE al de la caja de la IA.
 * Sin esto, un muro amarillo o el toldo de una tienda detrás del carro podía "confirmar" la
 * placa por estar cerca, y el sello se estampaba sobre el muro (grande) en vez de sobre la
 * placa.
 */
const FACTOR_TAMANO_MIN = 0.25;
const FACTOR_TAMANO_MAX = 3.5;

/** ¿El centro de esta caja cae dentro de la ventana? */
function dentroDe(caja: CajaPct, ventana: CajaPct): boolean {
  const { cx, cy } = centro(caja);
  return cx >= ventana.x_pct && cx <= ventana.x_pct + ventana.w_pct
      && cy >= ventana.y_pct && cy <= ventana.y_pct + ventana.h_pct;
}

/** Tolerancia de ubicación en PÍXELES por eje: media caja, con el piso de la regla. */
function toleranciaPx(caja: CajaPct, imgW: number, imgH: number): { tolX: number; tolY: number } {
  return {
    tolX: Math.max(((caja.w_pct / 100) * imgW) / 2, TOLERANCIA_IA_FRACCION_LADO * imgW),
    tolY: Math.max(((caja.h_pct / 100) * imgH) / 2, TOLERANCIA_IA_FRACCION_LADO * imgH),
  };
}

/**
 * Distancia entre el centro del candidato y el de la caja de la IA, medida en TOLERANCIAS de
 * cada eje (una elipse, no un círculo). 1 = justo en el borde de lo tolerable.
 */
function distanciaNormalizada(c: CajaPct, caja: CajaPct, imgW: number, imgH: number): number {
  const { tolX, tolY } = toleranciaPx(caja, imgW, imgH);
  const a = centro(caja);
  const b = centro(c);
  const dx = (((b.cx - a.cx) / 100) * imgW) / Math.max(1, tolX);
  const dy = (((b.cy - a.cy) / 100) * imgH) / Math.max(1, tolY);
  return Math.hypot(dx, dy);
}

/** La ventana (en %) donde se busca el amarillo que confirma la placa que reporta la IA. */
function ventanaDeBusqueda(caja: CajaPct, imgW: number, imgH: number): CajaPct {
  const { tolX, tolY } = toleranciaPx(caja, imgW, imgH);
  const dx = ((tolX * DISTANCIA_MAX_AMARILLA) / imgW) * 100;
  const dy = ((tolY * DISTANCIA_MAX_AMARILLA) / imgH) * 100;
  const x = Math.max(0, caja.x_pct - dx);
  const y = Math.max(0, caja.y_pct - dy);
  return {
    x_pct: x,
    y_pct: y,
    w_pct: Math.min(100 - x, caja.w_pct + 2 * dx),
    h_pct: Math.min(100 - y, caja.h_pct + 2 * dy),
  };
}

/**
 * Proporción ancho:alto de una placa colombiana vista de frente. Se usa solo como referencia
 * para puntuar: cuanto más se aleja un rectángulo amarillo de esta proporción, menos parece una
 * placa. NO es un filtro — una placa fotografiada en 3/4 o con la cámara inclinada llega a tener
 * bounding box casi cuadrado, y descartarla por eso fue justamente el fallo que dejó sin tapar
 * la placa trasera del Tucson.
 */
const ASPECTO_PLACA_IDEAL = 2.0;

/**
 * Peso de la penalización por proporción frente a la distancia, en el puntaje de ubicación.
 *
 * Con 0 (elegir siempre el amarillo más cercano al centro de la caja de la IA) el sistema se
 * equivocaba en un caso real medido: la placa de una moto estacionada al fondo ("EMU 24H") está
 * a 1.7 escalas del centro de la caja de la IA, mientras que una columna de ladrillo amarillento
 * a 0.7 escalas le ganaba — el sello terminaba en el andén y la placa quedaba legible. Con 2, la
 * penalización por proporción (la columna tiene aspecto 1.12; la placa, 2.00) da vuelta el
 * resultado. Es deliberadamente moderado: un peso alto volvería a descartar las placas giradas.
 */
const PESO_ASPECTO = 2;

/**
 * Puntaje de "qué tan probable es que ESTE rectángulo amarillo sea la placa que la IA reporta
 * en `caja`": distancia entre centros medida en escalas de placa, más una penalización
 * logarítmica por alejarse de la proporción de una placa. Menor es mejor.
 */
function puntajeUbicacion(c: CandidatoPlaca, caja: CajaPct, imgW: number, imgH: number): number {
  const distancia = distanciaNormalizada(c, caja, imgW, imgH);
  const anchoPx = (c.w_pct / 100) * imgW;
  const altoPx = Math.max(1, (c.h_pct / 100) * imgH);
  const aspecto = anchoPx / altoPx;
  const penalizacion = aspecto > 0 ? Math.abs(Math.log(aspecto / ASPECTO_PLACA_IDEAL)) : 10;
  return distancia + PESO_ASPECTO * penalizacion;
}

/** ¿Este rectángulo amarillo tiene un tamaño compatible con la placa que la IA reporta? */
function tamanoCompatible(c: CandidatoPlaca, caja: CajaPct, imgW: number, imgH: number): boolean {
  const escalaC = Math.max((c.w_pct / 100) * imgW, (c.h_pct / 100) * imgH);
  const escalaIA = escalaPlacaPx(caja, imgW, imgH);
  return escalaC >= escalaIA * FACTOR_TAMANO_MIN && escalaC <= escalaIA * FACTOR_TAMANO_MAX;
}

/**
 * Techo de superficie que puede ocupar UN sello, como fracción del área de la imagen. Un
 * tapado que se pasa de acá ya no es "una placa tapada", es un borrón que arruina la foto: se
 * recorta al techo (manteniendo el centro) y la foto se manda a revisión manual.
 *
 * Referencias medidas: las barras que motivaron este arreglo ocupaban 12.7% y 14.8% del
 * lienzo; un sello sobre una placa real ronda 0.1–3.3% en el banco de fotos, y el máximo
 * legítimo observado es el primer plano del frente de un Ford Explorer, donde la placa sola
 * ocupa 3.2% y con su margen llega a 4.9%. Por eso el techo es 7% y no 4%: con 4% ese caso
 * legítimo se recortaba (dejando asomar el borde de la placa) y encima mandaba la foto a
 * revisión manual sin motivo.
 */
const MAX_AREA_SELLO = 0.07;

/**
 * Tope de sellos por foto. Sube de 3 a 6 respecto de la versión anterior porque ahora el
 * objetivo declarado incluye las placas de TERCEROS (una calle de Medellín con el carro
 * publicado + tres carros estacionados detrás son 4 placas legítimas), y el riesgo de tapar de
 * más está acotado por `MAX_AREA_SELLO` y por lo chico que es cada sello.
 */
const MAX_ZONAS_TAPADAS = 6;

/**
 * Ancho mínimo de un candidato de color para taparlo SIN que la IA lo respalde, como fracción
 * del LADO CORTO de la imagen.
 *
 * Antes era `c.w_pct >= 4`, o sea 4% del ANCHO, y ahí hay dos problemas medidos:
 *  - No es invariante a la orientación: en una foto de celular vertical (3024x4032) son 121 px
 *    y en esa misma foto apaisada, 161 px. El mismo carro, dos varas distintas.
 *  - Era demasiado grande para una placa de TERCEROS, que es justamente la que aparece chica en
 *    el encuadre. La placa del carro detrás de la reja en la foto de frente del Tucson mide
 *    81 px de ancho (2.7% del ancho): tenía forma y relleno de placa y aun así quedaba fuera.
 * Con el lado corto como referencia el piso es el mismo tape la foto como la tape, y 2.5%
 * coincide con el piso que el propio detector ya aplica (`ANCHO_MIN_FRACCION`), así que este
 * filtro deja de ser un segundo umbral de tamaño y queda como lo que dice ser: un filtro de
 * FORMA (relleno + proporción).
 */
const ANCHO_MIN_SIN_IA_FRACCION = 0.025;

/**
 * Filtro para tapar un candidato de color que NINGUNA placa de la IA reclama (porque la IA
 * falló técnicamente, o porque no lo vio). En ese caso nadie descarta el taxi amarillo del
 * fondo, así que se exige que el candidato se parezca de verdad a una placa: relleno alto
 * (rectángulo amarillo sólido, no una mancha irregular), proporción cercana a la de una placa
 * real y un tamaño mínimo en la foto.
 *
 * El piso de 0.62 se mide sobre `solidez` (amarillo / suma de las cajas de cada fragmento) y
 * no sobre `relleno` (amarillo / caja del candidato entero), y esa diferencia es la que
 * permite tapar una placa PARTIDA por un obstáculo sin abrirle la puerta al follaje: la placa
 * detrás de la reja da relleno 0.60 (el barrote le come el medio) pero solidez 0.93, mientras
 * que las manchas de árboles/ladrillo de la foto trasera del Tucson dan 0.46–0.57 en ambas.
 * Está calibrado con fotos reales: las placas medidas dan 0.66–0.93 de solidez, mientras que
 * el emblema dorado de Chevrolet en el frente de un Tracker —que es amarillo y con proporción
 * ~3:1, y por eso pasaba los demás filtros— da 0.55 y aquí queda descartado. El `relleno`
 * sigue exigiéndose, pero solo como piso de cordura: un grupo cuya caja está medio vacía no es
 * un panel. El rango de proporción 1.5–3.6 es el que descarta el REFLECTOR del paragolpes (una
 * franja amarilla de 206x49 px, proporción 4.18, en la foto trasera del Tucson): tapar ahí
 * ensucia el paragolpes y deja la placa a la vista, que es el peor de los dos errores.
 */
function esCandidatoFuerte(c: CandidatoPlaca, imgW: number, imgH: number): boolean {
  const anchoPx = (c.w_pct / 100) * imgW;
  return c.solidez >= 0.62
    && c.relleno >= 0.5
    && c.aspecto >= 1.5 && c.aspecto <= 3.6
    && anchoPx >= ANCHO_MIN_SIN_IA_FRACCION * Math.min(imgW, imgH);
}

/** Recorta un rectángulo que se pasó de `MAX_AREA_SELLO`, conservando su centro. */
function acotarSello(r: Rectangulo, imgW: number, imgH: number): { rect: Rectangulo; recortado: boolean } {
  const maxArea = MAX_AREA_SELLO * imgW * imgH;
  const area = r.width * r.height;
  if (area <= maxArea) return { rect: r, recortado: false };
  const factor = Math.sqrt(maxArea / area);
  const width = Math.max(20, Math.round(r.width * factor));
  const height = Math.max(10, Math.round(r.height * factor));
  const left = Math.min(imgW - width, Math.max(0, Math.round(r.left + (r.width - width) / 2)));
  const top = Math.min(imgH - height, Math.max(0, Math.round(r.top + (r.height - height) / 2)));
  return { rect: { left, top, width, height }, recortado: true };
}

/**
 * Fracción MÍNIMA de la caja de la IA que debe medir el sello cuando la ubicación la puso el
 * detector de color. Red de seguridad contra el TAPADO PARCIAL: los píxeles amarillos dicen
 * muy bien DÓNDE está la placa, pero pueden describir solo un pedazo de ella (media placa en
 * sombra, un panel que el brillo parte en dos y la fusión no llega a unir). Si el rectángulo
 * medido resulta mucho más chico que lo que la IA dibujó, se agranda —manteniendo el centro
 * medido— hasta este porcentaje del tamaño de la caja de la IA.
 *
 * Es 0.75 y no 1.0 porque la caja de la IA tiende a ser algo generosa y no queremos que el
 * sello crezca de más cuando el rectángulo medido ya cubre la placa entera: medido sobre el
 * banco, los tapados correctos por color miden entre 0.9 y 1.4 veces la caja de la IA, así que
 * 0.75 no los toca y solo actúa sobre los casos degenerados (0.44 y 0.51 veces la caja, que
 * son justo los dos tapados parciales que aparecieron: la placa de la foto trasera del Tucson y
 * la del carro del borde derecho del DEEPAL).
 */
const FRACCION_MIN_CAJA_IA = 0.75;

/** Agranda un rectángulo hasta `minW` x `minH` conservando su centro, sin salirse de la imagen. */
function alMenos(r: Rectangulo, minW: number, minH: number, imgW: number, imgH: number): Rectangulo {
  const width = Math.min(imgW, Math.max(r.width, Math.round(minW)));
  const height = Math.min(imgH, Math.max(r.height, Math.round(minH)));
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const left = Math.min(imgW - width, Math.max(0, Math.round(cx - width / 2)));
  const top = Math.min(imgH - height, Math.max(0, Math.round(cy - height / 2)));
  return { left, top, width, height };
}

/** Fracción del área de `a` que queda dentro de `b` (0–1). */
function solapeRelativo(a: Rectangulo, b: Rectangulo): number {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.max(1, a.width * a.height);
}

/** Una zona a tapar, con el rastro de cómo se decidió. */
type Zona = {
  rect: Rectangulo;
  origen: 'color' | 'ia';
  detalle: string;
};
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
export async function taparZonas(buffer: Buffer, rectangulos: Rectangulo[]): Promise<Buffer> {
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
 * (`esCandidatoFuerte`, criterio más estricto justamente porque aquí no hay ninguna caja de la
 * IA que descarte el taxi amarillo del fondo), se tapan igual.
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
  const fuertes = candidatos.filter(c => esCandidatoFuerte(c, imgW, imgH)).slice(0, MAX_ZONAS_TAPADAS);
  if (fuertes.length === 0) {
    console.warn('[blur-placas][PLACA-NO-TAPADA] La IA no pudo evaluar la foto y el detector de color no encontró ninguna placa amarilla clara — foto sin tapar y marcada para revisión manual');
    return { buffer, difuminada: false, contenidoInapropiado: false, moderacionEvaluada: false, revisionManual: true, motivoRevision: 'La IA no pudo evaluar la foto.', via: 'ninguna' };
  }

  const rectangulos = fuertes.map(c => rectanguloDeCandidato(c, imgW, imgH));
  console.warn(
    `[blur-placas][PLACA-VIA-COLOR-SIN-IA] La IA no pudo evaluar la foto, pero el detector de color encontró ${fuertes.length} placa(s) amarilla(s) clara(s) — se tapan igual (la foto queda además marcada para revisión manual porque no hubo moderación de contenido)`,
    rectangulos,
  );
  const resultado = await taparZonas(buffer, rectangulos);
  return {
    buffer: resultado, difuminada: true, contenidoInapropiado: false, moderacionEvaluada: false,
    revisionManual: true, motivoRevision: 'La IA no pudo evaluar la foto.', via: 'color_sin_ia',
  };
}

/**
 * Detecta TODAS las placas visibles de una foto de vehículo y las tapa con el sello opaco de
 * marca DrivePass, y de paso obtiene la moderación de contenido de la foto.
 *
 * ARQUITECTURA (IA decide QUÉ y CUÁNTAS, los píxeles deciden DÓNDE)
 * ----------------------------------------------------------------
 * 1. A Claude vision se le manda la foto CON UNA REGLA DE COORDENADAS IMPRESA
 *    (`conReglaDeCoordenadas`) y responde la lista de placas visibles —las del carro que se
 *    publica y las de CUALQUIER otro vehículo del encuadre— con su caja, de quién es, qué tan
 *    seguro está y si se lee; más la moderación de contenido.
 * 2. `detectarPlacasPorColor` (lib/detectar-placa-color.ts, determinístico, sin red) mide
 *    DÓNDE están los rectángulos amarillos reales en los píxeles.
 * 3. Se reconcilian placa por placa: si un candidato amarillo concuerda con la caja de la IA,
 *    se tapa ESE (preciso, medido sobre los píxeles); si no, se tapa la caja de la IA
 *    ampliada un poco. Y los candidatos amarillos claros que la IA no reclamó se tapan
 *    también, por privacidad.
 *
 * QUÉ CAMBIÓ RESPECTO DE LA VERSIÓN ANTERIOR, Y POR QUÉ (incidente real)
 * ---------------------------------------------------------------------
 * La versión anterior pedía UNA sola región y, cuando el color no confirmaba nada, estampaba
 * una BANDA de respaldo expresada en porcentajes del LIENZO (45 puntos de alto hacia arriba,
 * 15 hacia abajo, ancho mínimo 20 puntos). En las fotos verticales del Hyundai Tucson (3024 x
 * 4032) eso da una barra de 605 x 2419 px: el 13–15% de la foto, una columna opaca que arruina
 * el anuncio. Y como esa barra se centra en una caja de la IA que se sabía sesgada, además
 * dejaba a la vista la placa de un tercero (un Nissan estacionado al lado, con su placa
 * perfectamente legible) porque el detector de color SÍ la había encontrado pero la
 * reconciliación la descartaba por no concordar con la única región reportada.
 *
 * Los cambios de fondo son:
 *  - La regla impresa: el error de la caja de la IA baja de 13–28 puntos porcentuales del alto
 *    a 2–4, lo que hace innecesaria la banda.
 *  - Todas las tolerancias y márgenes pasan a medirse en píxeles y en unidades del tamaño
 *    estimado de la PLACA, no en porcentaje del lienzo (que cambia de significado según la
 *    orientación de la foto).
 *  - Se piden y se tapan TODAS las placas, no solo la del carro protagonista.
 *  - El detector de color vuelve a armar las placas PARTIDAS por un obstáculo antes de
 *    filtrarlas por forma (`fusionarFragmentos` en lib/detectar-placa-color.ts): sin eso, la
 *    placa de un carro detrás de una reja no existía para el sistema.
 *  - La IA dice de qué COLOR es cada panel, y solo las placas amarillas se confirman contra la
 *    máscara amarilla: si no, el sello de una placa blanca de servicio público terminaba sobre
 *    el objeto amarillo más cercano (ver `PlacaIA.color`).
 * Y cuando el sistema no puede ubicar una placa con certeza razonable ya NO pinta una barra
 * "por si acaso": marca la foto para revisión manual (`revisionManual`), que es la única de
 * las dos opciones que no arruina la foto Y deja la placa expuesta a la vez.
 *
 * Costo por foto: 1 llamada a la API en el caso normal (2 como máximo si la primera falla por
 * un problema técnico), igual que la versión anterior.
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
  // es quien mide DÓNDE están las placas amarillas. Además de la lista de candidatos con forma
  // de placa se guarda la MÁSCARA amarilla cruda, para poder preguntarle después "¿hay amarillo
  // justo acá?" en la vecindad de cada placa que reporte la IA (`refinarZonaAmarilla`) sin
  // volver a decodificar la imagen. Si llegara a fallar, se sigue sin candidatos (las cajas de
  // la IA cubren el caso) en vez de tumbar toda la subida de la foto.
  let candidatos: CandidatoPlaca[] = [];
  let mascaraAmarilla: MascaraAmarilla | null = null;
  try {
    const analisis = await analizarAmarillo(buffer);
    candidatos = analisis.candidatos;
    mascaraAmarilla = analisis.mascara;
  } catch (err) {
    console.error('[blur-placas] El detector de placa por color falló — se continúa solo con las cajas de la IA:', err);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('[blur-placas][MODERACION-NO-EVALUADA] ANTHROPIC_API_KEY no configurada — foto subida SIN evaluar contenido (fail-closed en el call site: va a revisión manual)');
    return resolverSinIA(buffer, candidatos, imgW, imgH);
  }

  // La imagen que ve la IA lleva la regla de coordenadas impresa; el sello se estampa siempre
  // sobre `buffer`, que es la foto limpia. Si por lo que sea no se pudiera dibujar la regla
  // (SVG/librsvg), se manda la foto tal cual: la IA seguirá respondiendo y el detector de
  // color sigue siendo quien ubica las placas amarillas.
  let paraIA: Buffer;
  try {
    paraIA = await conReglaDeCoordenadas(buffer, imgW, imgH);
  } catch (err) {
    console.error('[blur-placas] No se pudo dibujar la regla de coordenadas — se manda la foto sin regla (la caja de la IA será menos precisa):', err);
    paraIA = await sharp(buffer).jpeg({ quality: 85 }).toBuffer();
  }
  const base64 = paraIA.toString('base64');

  // UNA llamada a Claude, con UN reintento solo si falla por un problema técnico (error de
  // API o respuesta sin JSON válido).
  let llamada = await llamarClaudeDeteccionPlaca(base64, imgW, imgH);
  if (!llamada.ok) {
    console.warn(`[blur-placas] Intento 1/2 falló (motivo: ${llamada.motivo}) — reintentando una vez más antes de rendirse`);
    llamada = await llamarClaudeDeteccionPlaca(base64, imgW, imgH);
  }

  if (!llamada.ok) {
    // Fallo técnico tras agotar el reintento: no hay moderación de contenido, pero las placas
    // igual se tapan si el detector de color las encontró.
    logFalloDefinitivo(llamada);
    return resolverSinIA(buffer, candidatos, imgW, imgH);
  }

  const { placas, contenidoInapropiado, motivoInapropiado } = llamada.deteccion;
  // Telemetría de lo que REPORTÓ la IA, antes de reconciliar. Es el dato que hace falta para
  // diagnosticar en producción si un sello quedó mal puesto: sin esto solo se ve el rectángulo
  // final y no se puede distinguir "la IA se equivocó de lugar" de "la reconciliación eligió
  // mal el amarillo". Son coordenadas y descripciones, no datos personales.
  console.warn(
    `[blur-placas][PLACA-IA] La IA reporta ${placas.length} placa(s) en una foto de ${imgW}x${imgH}.`,
    placas.map(p => ({ ...p.caja, deSujeto: p.deSujeto, color: p.color, confianza: p.confianza, legible: p.legible, anchor: p.anchor })),
  );
  if (contenidoInapropiado) {
    console.warn('[blur-placas] Foto marcada por la IA como contenido inapropiado:', motivoInapropiado);
  }

  // ── Reconciliación placa por placa ────────────────────────────────────────────────────
  const zonas: Zona[] = [];
  const motivosRevision: string[] = [];
  const candidatosUsados = new Set<CandidatoPlaca>();

  for (const placa of placas) {
    const ventana = ventanaDeBusqueda(placa.caja, imgW, imgH);

    // (a) Todo el amarillo disponible en esa ventana, de las dos fuentes:
    //     - los candidatos "con forma de placa" que el barrido global ya validó (los más
    //       fiables: pasaron los filtros de forma sobre toda la foto);
    //     - las manchas amarillas locales de la ventana, SIN filtro de forma
    //       (`zonasAmarillasEn`), que es lo que rescata las placas giradas en tomas 3/4 cuyo
    //       bounding box sale casi cuadrado y el barrido global descarta.
    //     De todo eso se elige por `puntajeUbicacion` (distancia a la caja de la IA + parecido
    //     a la proporción de una placa), no por área: el amarillo más grande de la vecindad
    //     suele ser una columna o un muro, no la placa.
    //
    //     EXCEPCIÓN: una placa que la IA describe como BLANCA no se puede confirmar contra la
    //     máscara amarilla — por definición no hay amarillo debajo, así que el amarillo más
    //     cercano es otro objeto (ver el comentario de `PlacaIA.color`). Para esas no se busca
    //     nada y se va derecho al camino de la caja de la IA.
    const buscarAmarillo = placa.color !== 'blanca';
    const globales = buscarAmarillo
      ? candidatos.filter(c => !candidatosUsados.has(c) && dentroDe(c, ventana) && tamanoCompatible(c, placa.caja, imgW, imgH))
      : [];
    const locales = buscarAmarillo && mascaraAmarilla
      ? zonasAmarillasEn(mascaraAmarilla, ventana).filter(z => tamanoCompatible(z, placa.caja, imgW, imgH))
      : [];
    const opciones = [...globales, ...locales];

    // Se ELIGE por puntaje (distancia + parecido a una placa) pero se ACEPTA por distancia
    // sola: la penalización por proporción sirve para desempatar entre varios amarillos, no
    // para decidir si el ganador está donde la IA dijo. Mezclar las dos cosas en un único tope
    // descartaba placas bien ubicadas por verse escorzadas — la del borde derecho del DEEPAL
    // está a 3 px en X de la caja de la IA y su proporción de 0.57 le sumaba 2.5 puntos de
    // castigo, suficiente para tirarla.
    let medido: CandidatoPlaca | null = null;
    let mejor = Infinity;
    let distanciaMedido = Infinity;
    for (const o of opciones) {
      const p = puntajeUbicacion(o, placa.caja, imgW, imgH);
      if (p < mejor) { mejor = p; medido = o; distanciaMedido = distanciaNormalizada(o, placa.caja, imgW, imgH); }
    }
    // Se guarda el mejor amarillo ANTES del corte por puntaje: si la placa termina en el
    // camino "no se tapa nada" (confianza baja), ese amarillo es mejor que nada — ver abajo.
    const mejorAmarillo = medido;
    const distanciaMejorAmarillo = distanciaMedido;
    const tope = placa.color === 'amarilla' ? DISTANCIA_MAX_AMARILLA : DISTANCIA_MAX_OTRA;
    if (medido && distanciaMedido > tope) {
      console.warn(
        `[blur-placas][PLACA-AMARILLO-DESCARTADO] El mejor rectángulo amarillo de la ventana está a ${distanciaMedido.toFixed(2)} tolerancias del centro que reportó la IA (tope ${tope} para una placa ${placa.color}) — demasiado lejos. Se tapa por la caja de la IA en vez de sobre ese amarillo.`,
        { caja: placa.caja, anchor: placa.anchor },
      );
      medido = null;
    }

    if (medido) {
      // Solo se marca como "usado" si el ganador vino del barrido global: los `candidatosUsados`
      // existen para no tapar dos veces el mismo rectángulo (y para saber cuáles quedaron sin
      // reclamar al final), y las manchas locales no están en esa lista.
      if (globales.includes(medido)) candidatosUsados.add(medido);
      // Si el ganador es una mancha local, igual se marcan como usados los candidatos globales
      // de la ventana: son amarillos de la misma placa/vecindad y volver a taparlos en el
      // barrido final de "amarillos que la IA no reclamó" solo agregaría sellos redundantes.
      else for (const g of globales) candidatosUsados.add(g);

      const medidoRect = alMenos(
        rectanguloDeCandidato(medido, imgW, imgH),
        (placa.caja.w_pct / 100) * imgW * FRACCION_MIN_CAJA_IA,
        (placa.caja.h_pct / 100) * imgH * FRACCION_MIN_CAJA_IA,
        imgW, imgH,
      );
      const { rect, recortado } = acotarSello(medidoRect, imgW, imgH);
      if (recortado) motivosRevision.push('Un tapado medido sobre los píxeles salió más grande de lo razonable y hubo que recortarlo.');
      zonas.push({
        rect,
        origen: 'color',
        detalle: `placa ${placa.deSujeto ? 'del vehículo' : 'de un tercero'} (${placa.confianza}) ubicada sobre los píxeles amarillos (puntaje ${mejor.toFixed(2)}, distancia ${distanciaMedido.toFixed(2)}): ${placa.anchor}`,
      });
      continue;
    }

    // (c) Sin ningún amarillo debajo. La caja de la IA es lo único que hay.
    if (placa.confianza === 'baja') {
      // La IA no está segura de que eso sea una placa y el amarillo de la zona (si lo hay) no
      // llegó al listón de distancia (`DISTANCIA_MAX_AMARILLA` / `DISTANCIA_MAX_OTRA`).
      //
      // RESCATE: si SÍ había amarillo en la ventana, se tapa ESE en vez de no tapar nada. El
      // listón existe para preferir la caja de la IA cuando el amarillo de la vecindad es
      // sospechoso (una placa blanca de servicio público con un balde amarillo al lado), pero
      // en esta rama la alternativa no es la caja de la IA: es no tapar NADA. Con "la IA cree
      // ver una placa acá" + "hay amarillo acá" el saldo se inclina claramente a tapar, y el
      // sello es del tamaño del amarillo medido, o sea chico. Caso real: la placa de un carro
      // de terceros en el borde derecho de la foto del DEEPAL, vista casi de canto — la IA la
      // reportó con confianza baja, el amarillo estaba ahí mismo y quedaba publicada.
      // El rescate no es "tapar cualquier amarillo de la ventana": se exige la misma distancia
      // que para una placa amarilla confirmada (`DISTANCIA_MAX_AMARILLA`). La ventana es un
      // rectángulo y admite centros algo más lejos que esa elipse, y ahí ya no se está tapando
      // la placa sino lo que haya al lado.
      if (mejorAmarillo && distanciaMejorAmarillo <= DISTANCIA_MAX_AMARILLA) {
        const rescate = acotarSello(
          alMenos(
            rectanguloDeCandidato(mejorAmarillo, imgW, imgH),
            (placa.caja.w_pct / 100) * imgW * FRACCION_MIN_CAJA_IA,
            (placa.caja.h_pct / 100) * imgH * FRACCION_MIN_CAJA_IA,
            imgW, imgH,
          ),
          imgW, imgH,
        );
        if (rescate.recortado) motivosRevision.push('Un tapado medido sobre los píxeles salió más grande de lo razonable y hubo que recortarlo.');
        for (const g of globales) candidatosUsados.add(g);
        console.warn(
          `[blur-placas][PLACA-BAJA-CON-AMARILLO] La IA reporta con confianza BAJA una placa ${placa.deSujeto ? 'del vehículo' : 'de un tercero'} y el amarillo más cercano no llega al listón (distancia ${distanciaMejorAmarillo.toFixed(2)} > ${tope} tolerancias) — se tapa ese amarillo igual, que es mejor que no tapar nada.`,
          { caja: placa.caja, anchor: placa.anchor, rect: rescate.rect },
        );
        zonas.push({
          rect: rescate.rect,
          origen: 'color',
          detalle: `placa ${placa.deSujeto ? 'del vehículo' : 'de un tercero'} (baja) tapada sobre el amarillo más cercano: ${placa.anchor}`,
        });
        continue;
      }
      // Sin ningún amarillo debajo: estampar un sello acá es, con más probabilidad que no,
      // ensuciar la foto sobre una reja o un faro. No se tapa; si era la placa del propio
      // carro publicado, la foto va a revisión manual (una placa del vehículo que se publica
      // es justo la que no puede quedar expuesta por descuido).
      console.warn(
        `[blur-placas][PLACA-IA-DESCARTADA] La IA reporta con confianza BAJA una placa ${placa.deSujeto ? 'del vehículo' : 'de un tercero'} que ningún píxel amarillo confirma — no se tapa.`,
        { caja: placa.caja, anchor: placa.anchor },
      );
      // Retener la foto para revisión humana en los dos casos en que "no tapamos nada" duele
      // de verdad: la placa del propio carro que se publica, y cualquier placa que la IA diga
      // que se alcanza a LEER (una placa legible es un dato personal expuesto, sea de quien
      // sea). Un panel de fondo ilegible no manda la foto a revisión: hacerlo llenaría la cola
      // del admin de fotos perfectamente publicables.
      if (placa.deSujeto) {
        motivosRevision.push('La IA cree ver la placa del vehículo pero no está segura de dónde, y el detector de color no la encuentra.');
      } else if (placa.legible) {
        motivosRevision.push('La IA cree ver la placa legible de otro vehículo pero no está segura de dónde, y el detector de color no la encuentra.');
      }
      continue;
    }

    // Placa que la IA sí ve con seguridad pero que no es amarilla (placa blanca de servicio
    // público, placa extranjera) o está tan quemada/en sombra que la máscara no la agarra. Se
    // tapa la caja de la IA con un margen por eje: la mitad del lado de la caja para cubrir un
    // panel algo más grande de lo que el modelo dibujó, y como PISO el error residual de la
    // regla (`ERROR_IA_FRACCION_LADO` de cada lado de la imagen), que es lo que domina cuando
    // la placa es chica y está lejos.
    const cajaW = (placa.caja.w_pct / 100) * imgW;
    const cajaH = (placa.caja.h_pct / 100) * imgH;
    const padX = Math.max(cajaW * MARGEN_IA_FRACCION_CAJA, imgW * ERROR_IA_FRACCION_LADO);
    const padY = Math.max(cajaH * MARGEN_IA_FRACCION_CAJA, imgH * ERROR_IA_FRACCION_LADO);
    const { rect, recortado } = acotarSello(rectanguloDesdeCaja(placa.caja, imgW, imgH, padX, padY), imgW, imgH);
    if (recortado) motivosRevision.push('El tapado calculado desde la caja de la IA era desproporcionado y hubo que recortarlo.');
    zonas.push({
      rect,
      origen: 'ia',
      detalle: `placa ${placa.deSujeto ? 'del vehículo' : 'de un tercero'} (${placa.confianza}) SIN confirmación de píxeles: ${placa.anchor}`,
    });
  }

  // ── Candidatos amarillos que la IA no reclamó ─────────────────────────────────────────
  // Una placa amarilla inequívoca que la IA pasó por alto se tapa igual: dejar legible la
  // placa de un cliente es un problema de privacidad real, mientras que tapar de más un objeto
  // amarillo con forma y tamaño de placa es, como mucho, un problema estético.
  for (const c of candidatos) {
    if (candidatosUsados.has(c)) continue;
    if (!esCandidatoFuerte(c, imgW, imgH)) continue;
    candidatosUsados.add(c);
    const { rect } = acotarSello(rectanguloDeCandidato(c, imgW, imgH), imgW, imgH);
    // Un candidato que cae encima de una zona ya resuelta no agrega privacidad y sí ensucia:
    // son dos sellos superpuestos sobre la misma placa (pasa cuando el ganador de la ventana
    // fue una mancha local y este candidato global es otro pedazo del mismo panel amarillo).
    if (zonas.some(z => solapeRelativo(rect, z.rect) > 0.5)) continue;
    zonas.push({ rect, origen: 'color', detalle: 'rectángulo amarillo con forma de placa que la IA no reportó' });
  }

  if (zonas.length > MAX_ZONAS_TAPADAS) {
    console.warn(
      `[blur-placas][PLACA-DEMASIADAS-ZONAS] Se calcularon ${zonas.length} zonas a tapar y el tope es ${MAX_ZONAS_TAPADAS} — se tapan las ${MAX_ZONAS_TAPADAS} primeras y la foto va a revisión manual.`,
      zonas.map(z => z.detalle),
    );
    motivosRevision.push(`Se detectaron ${zonas.length} placas y solo se taparon ${MAX_ZONAS_TAPADAS}.`);
    zonas.length = MAX_ZONAS_TAPADAS;
  }

  const revisionManual = motivosRevision.length > 0;
  const motivoRevision = revisionManual
    ? `${PREFIJO_REVISION_PLACA} ${[...new Set(motivosRevision)].join(' ')}`
    : undefined;

  if (zonas.length === 0) {
    console.warn(
      `[blur-placas][PLACA-NO-TAPADA] No se tapó nada en esta foto (la IA reportó ${placas.length} placa(s), el detector de color ${candidatos.length} candidato(s) amarillo(s)).`,
    );
    return { buffer, difuminada: false, contenidoInapropiado, motivoInapropiado, moderacionEvaluada: true, revisionManual, motivoRevision, via: 'ninguna' };
  }

  const porColor = zonas.filter(z => z.origen === 'color').length;
  const via: ResultadoDeteccion['via'] = porColor === zonas.length ? 'color' : porColor === 0 ? 'ia' : 'color_y_ia';
  const superficie = zonas.reduce((s, z) => s + z.rect.width * z.rect.height, 0) / (imgW * imgH);
  console.warn(
    `[blur-placas][PLACA-TAPADA] ${zonas.length} zona(s) tapada(s) en una foto de ${imgW}x${imgH} (via: ${via}, ${(superficie * 100).toFixed(1)}% de la superficie). ` +
    `La IA reportó ${placas.length} placa(s); el detector de color, ${candidatos.length} candidato(s).`,
    zonas.map(z => ({ ...z.rect, origen: z.origen, detalle: z.detalle })),
  );

  const resultado = await taparZonas(buffer, zonas.map(z => z.rect));
  return { buffer: resultado, difuminada: true, contenidoInapropiado, motivoInapropiado, moderacionEvaluada: true, revisionManual, motivoRevision, via };
}
