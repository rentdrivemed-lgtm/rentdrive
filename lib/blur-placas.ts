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
   * forma automática de arreglarlo. Hoy se pone en cinco situaciones, todas medidas sobre
   * fotos reales (ver los `motivosRevision.push(...)` de `detectarYDifuminarPlaca`):
   *  1. la IA reporta una placa de la que ella misma no está segura (`confidence: "low"`) y
   *     ningún píxel amarillo la confirma;
   *  2. la IA ubica una placa que dice AMARILLA en un sitio donde no hay un solo píxel
   *     amarillo, y ningún otro sello terminó cubriendo esa zona;
   *  3. el INVENTARIO DE VEHÍCULOS deja algún vehículo del encuadre con su placa sin ubicar
   *     ni descartar (ver `EstadoPlacaVehiculo`) — es el caso que cierra el hueco de la
   *     varianza del modelo con las placas chicas del fondo;
   *  4. las dos listas que devuelve la IA se contradicen (dice haber reportado más placas de
   *     las que devolvió, o reporta placas y no enumera ningún vehículo);
   *  5. el tapado calculado era tan grande que hubo que recortarlo, o había más placas que
   *     sellos disponibles.
   * En ninguno de esos casos se estampa una banda gigante "por si acaso" (ver el comentario de
   * arquitectura de `detectarYDifuminarPlaca`): se deja constancia para que la foto pase por
   * revisión manual antes de publicarse. Los call sites lo tratan igual que
   * `moderacionEvaluada:false`.
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
  /**
   * Los rectángulos que REALMENTE se estamparon, en píxeles del lienzo ya normalizado por
   * EXIF (`ancho` x `alto` de aquí abajo). Vacío cuando `difuminada` es false.
   *
   * Existe para el reproceso en lote (app/api/admin/reprocesar-placas), que necesita dos
   * cosas que el buffer solo no da:
   *  - GUARDARLOS junto a la foto sellada, para poder comparar en una corrida posterior si
   *    el resultado nuevo es el MISMO y así no volver a subir una foto idéntica (ver
   *    `placa_auto_zonas` en lib/db.ts);
   *  - REPORTARLOS en el modo simulación, donde no se sube nada y lo único que se puede
   *    mostrar de lo que habría pasado son las coordenadas.
   * El camino manual (lib/tapar-placa-imagen.ts) ya devolvía su equivalente
   * (`ResultadoTapado.rectangulos`); esto lo empareja del lado automático.
   */
  zonas: Rectangulo[];
  /** Ancho/alto del lienzo ya normalizado por EXIF sobre el que valen `zonas`. */
  ancho: number;
  alto: number;
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

SWEEP THE WHOLE PHOTO BEFORE ANSWERING
Almost every plate this system has let through was NOT on the car being advertised: it was a small plate on some other vehicle in the background — a car parked down the street, a van half hidden behind a tree, a taxi at the corner. So do not just look at the main car. Go over the photo ZONE BY ZONE (left / centre / right, crossed with top / middle / bottom: six zones) and, in your reasoning, name every vehicle you find in each zone, however small, far or partly hidden, and say where its plate is. Only after that sweep, write the JSON.

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

VEHICLE INVENTORY — as important as the plate list
After the plates, account for EVERY vehicle your sweep found: the advertised car AND every other vehicle, including the ones far in the background, behind a fence, behind a tree or only half visible. For each vehicle:
- where: a few words — what it is and roughly where it sits on the ruler.
- box: the vehicle's own bounding box on the 0-100 ruler (x_pct, y_pct, w_pct, h_pct), the same way you give a plate's box but around the WHOLE vehicle. Read it off the ruler.
- is_subject: true only for the car being advertised (the main subject of the photo).
- plate_status: EXACTLY one of
   "reported"     — this vehicle's plate is one of the entries in the plates list above.
   "covered"      — its plate is already covered by this system's sticker: an opaque dark-navy rectangle with a thick orange border and a two-arrow icon in the middle, sitting exactly where the plate would be. If you see that, the plate is handled; say "covered" and do not say "unsure".
   "not_facing"   — neither its front nor its rear faces the camera (you only see its side or its roof), so no plate panel can be seen at all.
   "out_of_frame" — a plate-bearing end does face the camera, but the plate itself falls entirely outside the photo, or is COMPLETELY hidden behind something (a wall, another vehicle, a person). If even a sliver of the plate panel shows — for instance a plate cut in half by a tree trunk or by railings — it is NOT out_of_frame: report it as a plate, or say "unsure".
   "no_plate"     — the plate area faces the camera, you see it clearly and in full, and there is plainly NO plate mounted on it (empty bracket or bare bumper).
   "unsure"       — anything else: you suspect there is a plate there but cannot locate it, it is too small or too blurry to be sure, or it is only partly visible.
"unsure" is for a vehicle whose plate area you CANNOT rule out — not for every vehicle you cannot read a plate on. If what you can see of a vehicle plainly contains no plate panel at all (only its roof, only its side, only a corner of it at the edge of the photo, only the part of it that sticks out from behind another car), then answer "not_facing" or "out_of_frame": those are the honest answers and they let a perfectly good photo be published. Use "unsure" whenever you are not certain about the PLATE. It is the SAFE answer: the system then holds the photo for a human to look at instead of publishing it. Do NOT answer "no_plate" merely because you cannot make a plate out — "no_plate" is only for a plate area you can see clearly and completely.
ONLY LIST THINGS THAT ARE CLEARLY VEHICLES. This list is about vehicles you can actually recognise as a car, van, bus, truck, motorcycle or similar. If some dark shape behind a fence, under a tarpaulin or deep inside a garage might be a vehicle but you cannot tell, LEAVE IT OUT — something you cannot even identify as a vehicle cannot be showing a readable plate either, and listing it as "unsure" would hold back a perfectly fine photo for no reason. Apart from that, never leave a vehicle out and never invent one. If the photo has no vehicle at all (an interior shot, an engine bay, a close-up of a wheel or a document), return an empty list.

SEPARATELY, content moderation. Photos here are normal photos of a car (exterior, interior, engine bay), sometimes with a person near or inside the car (the owner showing the car, a normal selfie with the vehicle, someone in the driver's seat) — all of that is completely normal and fine. Flag the photo ONLY if it clearly and unambiguously shows sexual or explicit content that has no place in a car listing (nudity, sexually explicit poses or acts, pornography). Be conservative: a clothed person in any normal pose is NEVER inappropriate, and a false positive blocks a legitimate listing. When in doubt, do NOT flag it.

Think first, in prose: do the zone-by-zone sweep naming every vehicle, then say where each plate sits on the ruler, then judge whether the content is appropriate. THEN respond with ONLY valid JSON, no markdown, as the very last part of your answer:
{"plates":[{"x_pct":number,"y_pct":number,"w_pct":number,"h_pct":number,"guides":"string","anchor":"string","belongs_to":"subject_vehicle"|"other_vehicle","colour":"yellow"|"white"|"other","confidence":"high"|"medium"|"low","legible":boolean}],"vehicles":[{"where":"string","box":{"x_pct":number,"y_pct":number,"w_pct":number,"h_pct":number},"is_subject":boolean,"plate_status":"reported"|"covered"|"not_facing"|"out_of_frame"|"no_plate"|"unsure"}],"inappropriate_content":boolean,"inappropriate_reason":"short sentence only when inappropriate_content is true"}
If no plate is visible anywhere in the photo, return "plates": []. Both "plates" and "vehicles" must always be present.`;

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

/**
 * Estado de la placa de UN vehículo del encuadre, según el INVENTARIO que la IA devuelve
 * además de la lista de placas.
 *
 * POR QUÉ EXISTE ESTE INVENTARIO (el último hueco por el que salía una placa al catálogo)
 * ------------------------------------------------------------------------------------
 * Pidiéndole solo "la lista de placas", el modelo NO es fiable con las placas chicas del fondo.
 * Medido sobre la foto del banco que tiene una placa BLANCA de 57x37 px visibles (a 82% / 37.4%
 * del lienzo, partida por el tronco de un árbol): en una tanda de seis corridas de la MISMA
 * foto la reportó en cuatro y en dos no, y en las doce corridas que se hicieron para verificar
 * este cambio no la reportó NINGUNA vez. O sea que no es solo varianza: con una placa así de
 * chica el modelo falla más de lo que acierta. Y una placa blanca es además invisible para el
 * detector determinístico de color (busca amarillo), así que ahí no había ninguna red debajo.
 * El sistema tampoco tenía forma de NOTARLO, porque "no reportó esa placa" y "no hay esa placa"
 * llegaban exactamente igual: una lista de placas sin esa entrada.
 *
 * El inventario rompe ese empate sin gastar una segunda llamada: ENUMERAR los vehículos del
 * encuadre es una tarea mucho más fácil y estable que localizar un panel de 57 px, y para cada
 * vehículo el modelo tiene que decir qué pasó con su placa. Cuando no puede dar cuenta de una
 * (`unsure`), la foto se RETIENE para revisión manual en vez de publicarse. Retener no bloquea
 * a nadie desde que existe la vía manual (app/api/admin/tapar-placa), y es el criterio que el
 * dueño aprobó: vale más una foto retenida que una placa publicada.
 *
 *  - `reportada`    : su placa está en la lista de placas (se tapa por el camino normal).
 *  - `tapada`       : ya tiene encima el sello de este sistema (foto reprocesada).
 *  - `sin_frente`   : no se ve ni el frente ni la cola del vehículo, así que no hay panel que tapar.
 *  - `fuera`        : el panel mira a la cámara pero queda fuera del encuadre o totalmente oculto.
 *  - `sin_placa`    : el panel se ve entero y NO tiene placa montada.
 *  - `incierta`     : cualquier otra cosa. Es la respuesta segura y la que fuerza revisión manual.
 *  - `desconocida`  : el modelo devolvió un valor que no es ninguno de los anteriores; se trata
 *                     igual que `incierta` (no se inventa un estado benigno).
 */
type EstadoPlacaVehiculo = 'reportada' | 'tapada' | 'sin_frente' | 'fuera' | 'sin_placa' | 'incierta' | 'desconocida';

type VehiculoIA = {
  donde: string;
  /**
   * Caja del VEHÍCULO entero (no de su placa) en la escala de la regla. Sirve para una sola
   * cosa, pero importante: saber si alguno de los sellos que el sistema SÍ estampó cayó sobre
   * ESTE vehículo. Sin eso, el inventario retiene de más — caso real medido en la foto del
   * banco con tres placas: la IA reportó UNA sola placa (la del carro publicado) y marcó como
   * `incierta` la del carro estacionado detrás de la reja... que el detector determinístico de
   * color ya había tapado por su cuenta (99% del panel cubierto). Retener esa foto no aporta
   * nada y sí llena la cola del admin.
   *
   * Es opcional: si el modelo no la devuelve o la devuelve fuera de rango, el vehículo
   * simplemente no se puede "rescatar" por geometría y, si su placa quedó sin explicar, la
   * foto se retiene (fail-closed).
   */
  caja?: CajaPct;
  deSujeto: boolean;
  estado: EstadoPlacaVehiculo;
};

/**
 * ¿El estado que la IA le puso a este vehículo EXPLICA qué pasó con su placa, o deja una placa
 * posiblemente visible sin resolver?
 *
 * `sin_placa` (el panel se ve entero y no hay placa montada) se acepta solo para el VEHÍCULO
 * PROTAGONISTA, y es una decisión medida, no un capricho: el carro que se publica ocupa media
 * foto y ahí sí se distingue un soporte vacío de un panel que no se alcanza a ver. En un carro
 * del fondo, que en la imagen que la IA mira (la API reescala a ~1.15 MPx) puede ser una mancha
 * de 30 px, "no tiene placa" y "no le veo la placa" son indistinguibles — y esa segunda es
 * exactamente la que hay que retener. Sin esta asimetría, `sin_placa` sería la puerta por la
 * que el modelo se escapa de declarar `incierta` y volveríamos al hueco que esto cierra.
 */
function estadoExplicaLaPlaca(v: VehiculoIA): boolean {
  switch (v.estado) {
    case 'reportada':
    case 'tapada':
    case 'sin_frente':
    case 'fuera':
      return true;
    case 'sin_placa':
      return v.deSujeto;
    default:
      return false;
  }
}

type PlacaDeteccion = {
  placas: PlacaIA[];
  vehiculos: VehiculoIA[];
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

/** Traduce el `plate_status` del JSON al estado interno; lo que no reconoce cae en `desconocida`. */
function leerEstadoVehiculo(crudo: unknown): EstadoPlacaVehiculo {
  switch (String(crudo ?? '').toLowerCase()) {
    case 'reported': return 'reportada';
    case 'covered': return 'tapada';
    case 'not_facing': return 'sin_frente';
    case 'out_of_frame': return 'fuera';
    case 'no_plate': return 'sin_placa';
    case 'unsure': return 'incierta';
    default: return 'desconocida';
  }
}

/** Convierte el inventario de vehículos del JSON crudo en la lista tipada. */
function leerVehiculos(bruto: unknown): VehiculoIA[] {
  const lista = (bruto as { vehicles?: unknown })?.vehicles;
  if (!Array.isArray(lista)) return [];
  const vehiculos: VehiculoIA[] = [];
  for (const crudo of lista) {
    if (!crudo || typeof crudo !== 'object') {
      // Una entrada basura NO se ignora: se cuenta como un vehículo del que no sabemos nada,
      // que es justo lo que debe forzar revisión manual.
      vehiculos.push({ donde: '(entrada ilegible)', deSujeto: false, estado: 'desconocida' });
      continue;
    }
    const v = crudo as Record<string, unknown>;
    const cajaCruda = v.box && typeof v.box === 'object' ? (v.box as Record<string, unknown>) : null;
    const caja = cajaCruda
      ? {
          x_pct: Number(cajaCruda.x_pct), y_pct: Number(cajaCruda.y_pct),
          w_pct: Number(cajaCruda.w_pct), h_pct: Number(cajaCruda.h_pct),
        }
      : null;
    vehiculos.push({
      donde: typeof v.where === 'string' ? v.where.slice(0, 120) : '',
      caja: caja && rangoValido(caja) ? caja : undefined,
      deSujeto: v.is_subject === true,
      estado: leerEstadoVehiculo(v.plate_status),
    });
  }
  return vehiculos;
}

async function llamarClaudeDeteccionPlaca(base64: string, imgW: number, imgH: number): Promise<LlamadaClaudeResultado> {
  let text = '';
  let stopReason: string | null | undefined;
  try {
    const resp = await client.messages.create({
      model: 'claude-opus-4-8',
      // Se pide razonar en prosa antes del JSON final (ver prompt más arriba): un barrido por
      // zonas nombrando cada vehículo, y después VARIAS placas con sus descripciones más el
      // inventario de vehículos. Hace falta margen para que el JSON no se trunque antes de
      // cerrar (era 2048 cuando se pedía una sola región, 3000 con varias placas). Subir el
      // techo no cuesta dinero: solo se pagan los tokens que el modelo llega a escribir.
      max_tokens: 4000,
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
    // Consumo real de ESTA llamada. Es el único gasto recurrente de todo el subsistema (una
    // llamada por foto subida), y el prompt pide razonamiento en prosa antes del JSON, así que
    // el costo depende de cuánto escriba el modelo y no solo del tamaño de la foto. Dejarlo en
    // el log permite ver en producción si una foto rara dispara el gasto, sin tener que
    // reconstruirlo desde la factura.
    console.warn(
      `[blur-placas][PLACA-TOKENS] entrada ${resp.usage.input_tokens} · salida ${resp.usage.output_tokens} (stop: ${resp.stop_reason})`,
    );
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
      // `vehicles` ausente se trata igual de estricto, y por el mismo motivo: el inventario de
      // vehículos es la red que atrapa la placa chica que el modelo no listó (ver
      // `EstadoPlacaVehiculo`). Sin él, una respuesta incompleta se leería como "no hay nada
      // que revisar" y volveríamos al hueco que este cambio cierra. Cae en el reintento y, si
      // la segunda respuesta tampoco lo trae, en `resolverSinIA` — que retiene la foto.
      if (!Array.isArray(bruto.vehicles)) {
        return { ok: false, motivo: 'json_invalido', error: new Error('la respuesta no trae el arreglo "vehicles"'), stopReason, textoRespuesta: text };
      }
      const contenidoInapropiado = bruto.inappropriate_content === true;
      return {
        ok: true,
        deteccion: {
          placas: leerPlacas(bruto, imgW, imgH),
          vehiculos: leerVehiculos(bruto),
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

// ─────────────────────────────────────────────────────────────────────────────────────────
// ¿ESTA ZONA YA LLEVA UN SELLO DE ESTE MISMO SISTEMA? (determinístico, sin IA)
// ─────────────────────────────────────────────────────────────────────────────────────────
//
// EL FALLO QUE CIERRA. Reprocesar una foto YA SELLADA le apilaba sellos: pasó en producción
// con el vehículo 13 (KIA Seltos), que terminó con tres logos superpuestos sobre la misma
// placa. La causa de fondo es que el sistema no tenía forma de saber que la foto ya estaba
// tapada, y NO basta con mirar el nombre del archivo ni la base de datos:
//
//   · `POST /api/upload` estampa el sello ANTES de subir la foto, así que la única copia que
//     existe en Cloudinary ya viene sellada, con nombre de subida normal (`<ts>-<rand>.jpg`)
//     y sin ninguna marca en `fotos_moderacion` que lo diga. Comprobado sobre el catálogo
//     real: las fotos traseras del KIA Sportage, del Mazda 3 y del Nivus, que por nombre y
//     por base parecen originales intactas, traen el sello horneado en los píxeles.
//   · O sea que la mayoría de las fotos publicadas son "ya selladas sin original", y un
//     reproceso que las trate como limpias vuelve a estampar encima.
//
// LA COMPROBACIÓN. No hace falta reconocer el sello en toda la foto (los hay de 10x5 px, que
// ninguna detección de formas resuelve de verdad): basta con mirar EL RECTÁNGULO QUE SE
// ESTÁ A PUNTO DE PINTAR. Si esa superficie ya es, en su mayor parte, el navy #1B3356 de la
// marca Y además tiene algo del naranja #F25C2B del borde/las flechas, ahí ya hay un sello
// nuestro y volver a pintar solo apila. Es una MEDICIÓN sobre los píxeles de un color que
// ponemos nosotros, no una heurística: una placa real es amarilla o blanca con caracteres
// negros, nunca navy con naranja.
//
// Se aplica en el ÚNICO sitio por el que pasan las dos vías automáticas (con IA y sin IA),
// justo antes de componer, así que ninguna de las dos puede apilar.

/** Escala de análisis de la máscara del sello. Barata y suficiente para un sello de 20 px. */
const LADO_MASCARA_SELLO = 1400;

/** Fracción del rectángulo que debe ser navy de marca para darlo por ya sellado. */
const SELLO_NAVY_MIN = 0.45;
/**
 * Fracción de naranja de marca exigida además. Es baja (el borde y las flechas son una parte
 * chica de la superficie) pero imprescindible: sin ella, el capó azul oscuro de un carro o
 * una sombra fría podrían pasar por sello.
 */
const SELLO_NARANJA_MIN = 0.015;

/** Píxeles del navy de fondo del sello (#1B3356 = 27,51,86), con tolerancia de JPEG. */
function esNavyDeMarca(r: number, g: number, b: number): boolean {
  return r <= 95 && g <= 110 && b >= 40 && b <= 170 && b - r >= 18 && b - g >= 10;
}

/** Píxeles del naranja de acento del sello (#F25C2B = 242,92,43). */
function esNaranjaDeMarca(r: number, g: number, b: number): boolean {
  return r >= 165 && g >= 40 && g <= 150 && b <= 120 && r - g >= 65 && g - b >= 10;
}

type MascaraSello = { navy: Uint8Array; naranja: Uint8Array; w: number; h: number };

/**
 * Máscara de los dos colores del sello sobre la imagen ya normalizada. Se calcula UNA vez por
 * foto. Devuelve `null` si la imagen no se pudo decodificar: el llamador entonces no filtra
 * nada (no se deja una placa sin tapar por no haber podido hacer esta comprobación).
 */
async function mascaraDelSello(buffer: Buffer): Promise<MascaraSello | null> {
  try {
    const { data, info } = await sharp(buffer)
      .resize({ width: LADO_MASCARA_SELLO, height: LADO_MASCARA_SELLO, fit: 'inside', withoutEnlargement: true })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const w = info.width, h = info.height, c = info.channels;
    if (!w || !h || c < 3) return null;
    const navy = new Uint8Array(w * h);
    const naranja = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < w * h; i++, p += c) {
      const r = data[p], g = data[p + 1], b = data[p + 2];
      if (esNaranjaDeMarca(r, g, b)) naranja[i] = 1;
      else if (esNavyDeMarca(r, g, b)) navy[i] = 1;
    }
    return { navy, naranja, w, h };
  } catch (err) {
    console.error('[blur-placas] No se pudo calcular la máscara del sello (no se filtrarán zonas ya selladas):', err);
    return null;
  }
}

/** ¿El rectángulo `r` (en píxeles de la imagen `imgW x imgH`) ya está cubierto por un sello nuestro? */
function zonaYaSellada(m: MascaraSello, imgW: number, imgH: number, r: Rectangulo): boolean {
  const sx = m.w / imgW;
  const sy = m.h / imgH;
  const x0 = Math.max(0, Math.floor(r.left * sx));
  const y0 = Math.max(0, Math.floor(r.top * sy));
  const x1 = Math.min(m.w - 1, Math.ceil((r.left + r.width) * sx) - 1);
  const y1 = Math.min(m.h - 1, Math.ceil((r.top + r.height) * sy) - 1);
  if (x1 < x0 || y1 < y0) return false;
  let navy = 0, naranja = 0, total = 0;
  for (let y = y0; y <= y1; y++) {
    const fila = y * m.w;
    for (let x = x0; x <= x1; x++) {
      total++;
      if (m.navy[fila + x]) navy++;
      else if (m.naranja[fila + x]) naranja++;
    }
  }
  if (total === 0) return false;
  return navy / total >= SELLO_NAVY_MIN && naranja / total >= SELLO_NARANJA_MIN;
}

/**
 * Descarta las zonas que ya están tapadas por un sello de este mismo sistema. Es la red que
 * impide APILAR sellos, y corre en las dos vías automáticas.
 */
async function sinZonasYaSelladas(
  buffer: Buffer, rectangulos: Rectangulo[], imgW: number, imgH: number,
): Promise<Rectangulo[]> {
  if (rectangulos.length === 0) return rectangulos;
  const m = await mascaraDelSello(buffer);
  if (!m) return rectangulos;
  const salida = rectangulos.filter(r => {
    if (!zonaYaSellada(m, imgW, imgH, r)) return true;
    console.warn(
      '[blur-placas][SELLO-YA-PUESTO] Esta zona ya está cubierta por un sello de DrivePass — no se vuelve a estampar (evita apilar sellos sobre una foto ya procesada).',
      r,
    );
    return false;
  });
  return salida;
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
    return { buffer, difuminada: false, contenidoInapropiado: false, moderacionEvaluada: false, revisionManual: true, motivoRevision: 'La IA no pudo evaluar la foto.', via: 'ninguna', zonas: [], ancho: imgW, alto: imgH };
  }

  // Se descartan las zonas que ya llevan un sello de este sistema: si esta foto ya pasó por
  // acá antes, volver a estampar solo apila logos (ver `sinZonasYaSelladas`).
  const rectangulos = await sinZonasYaSelladas(buffer, fuertes.map(c => rectanguloDeCandidato(c, imgW, imgH)), imgW, imgH);
  if (rectangulos.length === 0) {
    console.warn('[blur-placas][PLACA-NO-TAPADA] La IA no pudo evaluar la foto y lo único que encontró el detector de color ya estaba cubierto por un sello previo — no se toca la foto.');
    return { buffer, difuminada: false, contenidoInapropiado: false, moderacionEvaluada: false, revisionManual: true, motivoRevision: 'La IA no pudo evaluar la foto.', via: 'ninguna', zonas: [], ancho: imgW, alto: imgH };
  }
  console.warn(
    `[blur-placas][PLACA-VIA-COLOR-SIN-IA] La IA no pudo evaluar la foto, pero el detector de color encontró ${fuertes.length} placa(s) amarilla(s) clara(s) — se tapan igual (la foto queda además marcada para revisión manual porque no hubo moderación de contenido)`,
    rectangulos,
  );
  const resultado = await taparZonas(buffer, rectangulos);
  return {
    buffer: resultado, difuminada: true, contenidoInapropiado: false, moderacionEvaluada: false,
    revisionManual: true, motivoRevision: 'La IA no pudo evaluar la foto.', via: 'color_sin_ia',
    zonas: rectangulos, ancho: imgW, alto: imgH,
  };
}

/**
 * Detecta TODAS las placas visibles de una foto de vehículo y las tapa con el sello opaco de
 * marca DrivePass, y de paso obtiene la moderación de contenido de la foto.
 *
 * ARQUITECTURA (IA decide QUÉ y CUÁNTAS, los píxeles deciden DÓNDE)
 * ----------------------------------------------------------------
 * 1. A Claude vision se le manda la foto CON UNA REGLA DE COORDENADAS IMPRESA
 *    (`conReglaDeCoordenadas`) y responde DOS listas: las placas visibles —las del carro que
 *    se publica y las de CUALQUIER otro vehículo del encuadre— con su caja, de quién es, qué
 *    tan seguro está y si se lee; y el INVENTARIO DE VEHÍCULOS del encuadre, donde para cada
 *    vehículo tiene que decir qué pasó con su placa (ver `EstadoPlacaVehiculo`). Más la
 *    moderación de contenido. Todo en la MISMA llamada.
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
 * QUÉ AGREGA EL INVENTARIO DE VEHÍCULOS (el último hueco, medido)
 * --------------------------------------------------------------
 * Con lo anterior quedaba UNA vía por la que una placa podía salir publicada: que la IA
 * simplemente NO LISTARA una placa chica del fondo. Medido sobre la foto del banco que tiene
 * una placa BLANCA de 57x37 px a 82%/37.4% del lienzo, partida por el tronco de un árbol: en
 * una tanda de seis corridas la reportó en cuatro y en dos no; en las doce corridas de
 * verificación de este cambio, en ninguna. Una placa blanca además es invisible para el
 * detector de color (que busca amarillo), así que ahí no había red debajo: esa foto salía
 * publicada con la placa de un tercero a la vista.
 *
 * La red que lo cierra no es detectar mejor, es NOTARLO: enumerar los vehículos del encuadre
 * es una tarea mucho más estable para el modelo que localizar un panel de 57 px, y si para
 * algún vehículo no puede decir dónde está su placa (ni descartarla), la foto se RETIENE
 * (`revisionManual`) en vez de publicarse. Sobre el banco de pruebas eso llevó esa foto de
 * "placa publicada 5 de 5 corridas" a "retenida 5 de 5", sin un solo sello nuevo sobre la
 * foto. Retener no bloquea a nadie desde que existe la vía manual
 * (app/api/admin/tapar-placa): es el criterio que el dueño aprobó — vale más una foto
 * retenida que una placa publicada.
 *
 * Costo por foto: 1 llamada a la API en el caso normal (2 como máximo si la primera falla por
 * un problema técnico), igual que la versión anterior. El inventario y el barrido por zonas se
 * piden en esa MISMA llamada; lo que sube es el tamaño del prompt y el de la respuesta.
 * Medido sobre el banco (log `[PLACA-TOKENS]`, contra la versión anterior de este archivo):
 * entrada 6699 -> 7985 tokens (el prompt más largo; la foto pesa igual) y salida 469 -> ~900
 * tokens en una foto con varios vehículos, 109 -> ~530 en una foto simple. Es del orden de un
 * 35-45% más caro por foto, y compra la única señal que distingue "no hay placa" de "no vi la
 * placa".
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

  const { placas, vehiculos, contenidoInapropiado, motivoInapropiado } = llamada.deteccion;
  // Telemetría de lo que REPORTÓ la IA, antes de reconciliar. Es el dato que hace falta para
  // diagnosticar en producción si un sello quedó mal puesto: sin esto solo se ve el rectángulo
  // final y no se puede distinguir "la IA se equivocó de lugar" de "la reconciliación eligió
  // mal el amarillo". Son coordenadas y descripciones, no datos personales.
  console.warn(
    `[blur-placas][PLACA-IA] La IA reporta ${placas.length} placa(s) en una foto de ${imgW}x${imgH}.`,
    placas.map(p => ({ ...p.caja, deSujeto: p.deSujeto, color: p.color, confianza: p.confianza, legible: p.legible, anchor: p.anchor })),
  );
  console.warn(
    `[blur-placas][PLACA-VEHICULOS] Inventario: ${vehiculos.length} vehículo(s) en el encuadre.`,
    vehiculos.map(v => ({ estado: v.estado, deSujeto: v.deSujeto, donde: v.donde, caja: v.caja })),
  );
  if (contenidoInapropiado) {
    console.warn('[blur-placas] Foto marcada por la IA como contenido inapropiado:', motivoInapropiado);
  }

  // ── Reconciliación placa por placa ────────────────────────────────────────────────────
  const zonas: Zona[] = [];
  const motivosRevision: string[] = [];
  const candidatosUsados = new Set<CandidatoPlaca>();
  /**
   * Placas AMARILLAS que la IA ubicó donde no hay amarillo. No se tapan a ciegas (ver el
   * comentario del caso (2) más abajo): se deja la decisión para el final, cuando el barrido
   * de "amarillos que la IA no reclamó" ya corrió y se puede comprobar si alguno de esos
   * sellos cayó dentro de la ventana de esta placa.
   */
  const pendientes: { placa: PlacaIA; ventana: CajaPct }[] = [];

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
      // Retener la foto para revisión humana SIEMPRE que se llegue hasta acá, sin mirar de
      // quién es la placa ni si se lee.
      //
      // Antes se retenía solo si la placa era del vehículo publicado o si la IA decía que se
      // alcanzaba a LEER, con el argumento de no llenar la cola del admin con panelitos
      // ilegibles del fondo. Ese argumento no se sostiene con lo medido: `legible` es una
      // opinión del modelo sobre una miniatura (la API reescala la foto a ~1.15 MPx antes de
      // que él la vea, así que una placa de 57 px del original le llega en 20), la foto
      // publicada es mucho más nítida que lo que él miró, y justamente en las placas chicas es
      // donde su respuesta cambia de una corrida a otra. Publicar apoyándose en ese campo es
      // apostar a que la placa "no se lee" con la evidencia más débil que hay. Acá el sistema
      // ya sabe dos cosas: que la IA cree ver una placa, y que no puede ubicarla — eso es
      // exactamente el caso para el que existe la vía manual.
      motivosRevision.push(
        placa.deSujeto
          ? 'La IA cree ver la placa del vehículo pero no está segura de dónde, y el detector de color no la encuentra.'
          : 'La IA cree ver la placa de otro vehículo pero no está segura de dónde, y el detector de color no la encuentra.',
      );
      continue;
    }

    // Acá llegan las placas que la IA ve con seguridad (confianza media/alta) y que ningún
    // píxel confirmó. Hay dos situaciones muy distintas, y hasta ahora se trataban igual:
    //
    //  (1) La IA dice que el panel es BLANCO (servicio público: taxis, busetas, camiones) u
    //      OTRO (placa extranjera, o no sabe de qué color es). El detector de color no puede
    //      confirmar ninguna de esas NUNCA: no hay amarillo debajo por definición. La caja de
    //      la IA es la única información que existe, y se tapa con ella (más abajo).
    //
    //  (2) La IA dice que el panel es AMARILLO y aun así no hay UN SOLO rectángulo amarillo
    //      aceptable en toda la ventana de búsqueda. Eso ya no es "la máscara no la agarró":
    //      es que la caja está en otra parte. Caso real medido en la foto trasera del banco de
    //      pruebas: el modelo puso la placa del Nissan del borde derecho en y=61 cuando está en
    //      y=46, el amarillo real quedó a 2.27 tolerancias (tope 2.0), y el sistema estampó un
    //      sello de 485x445 px SOBRE EL ANDÉN mientras la placa la terminaba tapando —de
    //      casualidad— el barrido final de "amarillos que la IA no reclamó". Un sello gigante
    //      en el pavimento es justo el defecto que esta reescritura vino a eliminar. Así que
    //      acá no se tapa a ciegas: se anota la placa como PENDIENTE y se resuelve al final,
    //      cuando ya se sabe si el barrido de amarillos sueltos la cubrió. Si no la cubrió, la
    //      foto se retiene para revisión manual en vez de ensuciarse con un sello al azar.
    if (placa.color === 'amarilla') {
      console.warn(
        `[blur-placas][PLACA-AMARILLA-SIN-AMARILLO] La IA reporta con confianza ${placa.confianza} una placa AMARILLA ${placa.deSujeto ? 'del vehículo' : 'de un tercero'} y no hay ningún rectángulo amarillo aceptable en su ventana — no se tapa a ciegas; queda pendiente de que el barrido de amarillos sueltos la cubra.`,
        { caja: placa.caja, anchor: placa.anchor },
      );
      pendientes.push({ placa, ventana });
      continue;
    }

    // Placa blanca / de color desconocido: se tapa la caja de la IA con un margen por eje — la
    // mitad del lado de la caja para cubrir un panel algo más grande de lo que el modelo
    // dibujó, y como PISO el error residual de la regla (`ERROR_IA_FRACCION_LADO` de cada lado
    // de la imagen), que es lo que domina cuando la placa es chica y está lejos.
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

  // ── Placas amarillas que quedaron pendientes ──────────────────────────────────────────
  // Ya corrió todo lo que puede tapar algo. Para cada placa amarilla que la IA ubicó donde no
  // había amarillo, se mira si ALGÚN sello terminó cayendo dentro de su ventana de búsqueda
  // (que es la misma vecindad con la que se buscó el amarillo, no "la foto entera"): eso pasa
  // cuando el amarillo real estaba ahí cerca pero un poco más lejos del tope, y el barrido de
  // amarillos sueltos lo tapó por su cuenta. Si nada la cubrió, la foto se retiene.
  for (const { placa, ventana } of pendientes) {
    const cubierta = zonas.some(z => dentroDe(
      { x_pct: (z.rect.left / imgW) * 100, y_pct: (z.rect.top / imgH) * 100, w_pct: (z.rect.width / imgW) * 100, h_pct: (z.rect.height / imgH) * 100 },
      ventana,
    ));
    if (cubierta) {
      console.warn(
        '[blur-placas][PLACA-AMARILLA-RESUELTA] La placa amarilla que la IA había ubicado mal quedó cubierta por un sello del barrido de amarillos sueltos — no hace falta retener la foto.',
        { caja: placa.caja, anchor: placa.anchor },
      );
      continue;
    }
    motivosRevision.push(
      placa.deSujeto
        ? 'La IA ubica la placa amarilla del vehículo en un sitio donde no hay ni un píxel amarillo, y ningún otro sello la cubre.'
        : 'La IA ubica la placa amarilla de otro vehículo en un sitio donde no hay ni un píxel amarillo, y ningún otro sello la cubre.',
    );
  }

  // ── Inventario de vehículos: ¿quedó alguna placa sin explicación? ──────────────────────
  // Es la red que atrapa el hueco de la varianza (ver `EstadoPlacaVehiculo`): la IA puede no
  // listar una placa chica del fondo, pero enumerar los vehículos del encuadre sí lo hace de
  // forma estable, y para cada uno tiene que decir qué pasó con su placa.
  //
  // Antes de retener por un vehículo, se comprueba si alguno de los sellos ya estampados cayó
  // ENCIMA de ese vehículo: pasa cuando el detector de color tapó una placa que la IA nunca
  // llegó a listar (y que por eso su vehículo quedó como `incierta`). En ese caso la placa está
  // tapada y retener la foto no aportaría nada.
  const sinExplicar = vehiculos.filter(v => {
    if (estadoExplicaLaPlaca(v)) return false;
    if (!v.caja) return true;
    const margenX = v.caja.w_pct * 0.15;
    const margenY = v.caja.h_pct * 0.15;
    const ampliada: CajaPct = {
      x_pct: Math.max(0, v.caja.x_pct - margenX),
      y_pct: Math.max(0, v.caja.y_pct - margenY),
      w_pct: v.caja.w_pct + 2 * margenX,
      h_pct: v.caja.h_pct + 2 * margenY,
    };
    const tapado = zonas.some(z => dentroDe(
      { x_pct: (z.rect.left / imgW) * 100, y_pct: (z.rect.top / imgH) * 100, w_pct: (z.rect.width / imgW) * 100, h_pct: (z.rect.height / imgH) * 100 },
      ampliada,
    ));
    if (tapado) {
      console.warn(
        '[blur-placas][PLACA-VEHICULO-RESUELTO] La IA no supo dar cuenta de la placa de este vehículo, pero uno de los sellos estampados cae sobre él — no hace falta retener la foto.',
        { estado: v.estado, donde: v.donde, caja: v.caja },
      );
    }
    return !tapado;
  });
  if (sinExplicar.length > 0) {
    console.warn(
      `[blur-placas][PLACA-VEHICULO-SIN-EXPLICAR] ${sinExplicar.length} vehículo(s) del encuadre con una placa de la que la IA no da cuenta — la foto va a revisión manual.`,
      sinExplicar.map(v => ({ estado: v.estado, deSujeto: v.deSujeto, donde: v.donde })),
    );
    motivosRevision.push(
      sinExplicar.length === 1
        ? 'Hay un vehículo en la foto cuya placa la IA no pudo ubicar ni descartar.'
        : `Hay ${sinExplicar.length} vehículos en la foto cuya placa la IA no pudo ubicar ni descartar.`,
    );
  }
  // Coherencia entre las dos listas. Un inventario VACÍO con placas en la lista es una
  // contradicción: si hay placas, hay vehículos. Se retiene porque no se puede saber qué más
  // quedó sin mirar.
  if (vehiculos.length === 0 && placas.length > 0) {
    console.warn(
      `[blur-placas][PLACA-INVENTARIO-INCOHERENTE] La IA devolvió ${placas.length} placa(s) y un inventario de vehículos VACÍO — la foto va a revisión manual.`,
    );
    motivosRevision.push('La IA reportó placas pero no enumeró ningún vehículo en la foto.');
  }
  // Y por el otro lado: si más vehículos dicen "mi placa está reportada" que placas hay en la
  // lista, alguna placa se perdió entre el razonamiento y el JSON. No se puede saber CUÁL, así
  // que la foto se retiene.
  const dicenReportada = vehiculos.filter(v => v.estado === 'reportada').length;
  if (dicenReportada > placas.length) {
    console.warn(
      `[blur-placas][PLACA-INVENTARIO-INCOHERENTE] ${dicenReportada} vehículo(s) dicen tener su placa en la lista, pero la lista trae ${placas.length} — la foto va a revisión manual.`,
    );
    motivosRevision.push('La IA dice haber reportado más placas de las que devolvió.');
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
    return { buffer, difuminada: false, contenidoInapropiado, motivoInapropiado, moderacionEvaluada: true, revisionManual, motivoRevision, via: 'ninguna', zonas: [], ancho: imgW, alto: imgH };
  }

  // Última red ANTES de pintar: nada de lo que se estampe puede caer sobre un sello que ya
  // está ahí. Es lo que impide que un reproceso apile logos sobre una foto que `POST
  // /api/upload` ya selló al subirla (ver `sinZonasYaSelladas` para por qué no alcanza con
  // mirar el nombre del archivo ni la base de datos).
  const rectangulos = await sinZonasYaSelladas(buffer, zonas.map(z => z.rect), imgW, imgH);
  if (rectangulos.length === 0) {
    console.warn(
      '[blur-placas][PLACA-NO-TAPADA] Todo lo que se iba a tapar ya estaba cubierto por un sello previo de DrivePass — la foto se deja intacta.',
    );
    return { buffer, difuminada: false, contenidoInapropiado, motivoInapropiado, moderacionEvaluada: true, revisionManual, motivoRevision, via: 'ninguna', zonas: [], ancho: imgW, alto: imgH };
  }

  // `via` y la superficie se calculan sobre lo que DE VERDAD se va a pintar: entre medio
  // pudo caerse alguna zona por estar ya sellada.
  const pintadas = zonas.filter(z => rectangulos.includes(z.rect));
  const porColor = pintadas.filter(z => z.origen === 'color').length;
  const via: ResultadoDeteccion['via'] = porColor === pintadas.length ? 'color' : porColor === 0 ? 'ia' : 'color_y_ia';
  const superficie = rectangulos.reduce((acc, r) => acc + r.width * r.height, 0) / (imgW * imgH);
  console.warn(
    `[blur-placas][PLACA-TAPADA] ${rectangulos.length} zona(s) tapada(s) en una foto de ${imgW}x${imgH} (via: ${via}, ${(superficie * 100).toFixed(1)}% de la superficie). ` +
    `La IA reportó ${placas.length} placa(s); el detector de color, ${candidatos.length} candidato(s).`,
    pintadas.map(z => ({ ...z.rect, origen: z.origen, detalle: z.detalle })),
  );

  const resultado = await taparZonas(buffer, rectangulos);
  return { buffer: resultado, difuminada: true, contenidoInapropiado, motivoInapropiado, moderacionEvaluada: true, revisionManual, motivoRevision, via, zonas: rectangulos, ancho: imgW, alto: imgH };
}
