import sharp from 'sharp';

/**
 * Detector DETERMINÍSTICO (sin IA) de placas colombianas por color + forma.
 *
 * POR QUÉ EXISTE
 * --------------
 * La ubicación de la placa se le pedía a Claude vision como porcentajes
 * (`x_pct,y_pct,w_pct,h_pct`) y en producción, con fotos reales, esa coordenada
 * viene SISTEMÁTICAMENTE sesgada: la `y` cae MÁS ABAJO de donde está la placa
 * real, y no por poco — los 4 sesgos medidos sobre fotos reales de clientes
 * (centro de la pista de la IA vs centro del rectángulo amarillo real) son 13.6,
 * 14.9, 21.4 y 27.6 puntos porcentuales, siempre con el mismo signo (ver
 * `SESGO_ESPERADO_PCT` en `lib/blur-placas.ts`, que es quien usa esa cifra). El
 * resultado fue que el rectángulo de tapado caía en el paragolpes, DEBAJO de la
 * placa, y placas de clientes reales quedaron 100% legibles en fotos públicas.
 *
 * Las placas colombianas de particulares son AMARILLAS con texto negro y
 * proporción ~2:1 a ~3:1, así que su ubicación se puede resolver sin IA: buscar
 * regiones amarillas compactas con esa proporción. Este módulo hace exactamente
 * eso sobre los píxeles crudos (`sharp().raw()`), y es quien decide DÓNDE está
 * la placa. La IA sigue decidiendo SI hay placa y si la foto es apropiada (ver
 * `lib/blur-placas.ts`), que es lo que sí hace bien.
 *
 * LIMITACIONES CONOCIDAS (por eso la reconciliación en `lib/blur-placas.ts` no
 * usa este detector a ciegas):
 * - Falsos positivos: otros objetos amarillos y rectangulares en la escena
 *   (taxis amarillos de fondo, señales, muros). Por eso el consumidor cruza los
 *   candidatos con la "pista" de región que devuelve la IA (que en X sí viene
 *   bien) y se queda con el que concuerda.
 * - Placas NO amarillas (oficiales, diplomáticas, algunas de carga) o placas muy
 *   sobreexpuestas/en sombra profunda pueden no entrar en la máscara. Para esas
 *   `lib/blur-placas.ts` se apoya en la caja que reporta la IA.
 * - Placas partidas por un obstáculo (una reja, una rama, otro carro delante): la
 *   máscara las ve como manchas sueltas. `fusionarFragmentos` (más abajo) vuelve a
 *   armarlas antes de aplicar los filtros de forma; sin ese paso se perdían.
 *
 * Módulo PURO respecto de la BD y de la red: solo usa `sharp`. No importa nada
 * de `@/lib/db` ni de Anthropic, así que es fácil de probar aisladamente
 * (ver `scripts/probar-deteccion-placa.ts`).
 */

/** Lado mayor (px) al que se reescala la imagen para el análisis. */
const LADO_ANALISIS = 900;

// Umbrales de la máscara "amarillo de placa", en HSV. Se trabaja en HSV y no con
// umbrales por canal RGB a propósito: la primera versión de este detector usaba
// umbrales absolutos (R>130, G>95, B<125) y fallaba con placas EN SOMBRA —
// probado contra una foto real (Tracker de frente, placa bajo la parrilla): el
// color dominante de esa placa es ≈(120,80,0), que es amarillo purísimo
// (saturación 1.0, matiz 40°) pero demasiado OSCURO para esos mínimos, así que
// la placa no entraba en la máscara y no se detectaba nada. El matiz + la
// saturación describen "amarillo" con independencia de la iluminación, y el
// mínimo de valor (brillo) solo descarta los negros donde el matiz es ruido.
//
// `VALOR_MIN = 85` es ese piso de brillo: 85/255 ≈ 33% del máximo. Está puesto
// deliberadamente BAJO porque la placa en sombra del ejemplo de arriba tiene su
// canal máximo en 120, o sea que pasa con apenas 35 niveles de margen; subirlo a
// la mitad del rango la dejaría fuera otra vez. Por debajo de 85 el matiz deja
// de ser informativo (en los tonos casi negros, 1-2 niveles de diferencia entre
// canales ya cambian el matiz por completo) y la máscara se llena de ruido.
//
// El rango de matiz [25°, 70°] es además lo que separa la placa del NARANJA del
// sello de marca DrivePass (#F25C2B → matiz ≈15°) y de los rojos de
// stops/direccionales (matiz ≈0–15°); por arriba, 70° corta antes de los verdes
// de vegetación (≈90°+). El piso de 25° (y no 33°) sale también de foto real: la
// placa del DEEPAL en un pantallazo de WhatsApp recomprimido tiene color
// dominante ≈(220,120,0) → matiz 32.7°, y otras placas fotografiadas contra el
// sol se ven aún más anaranjadas; con 33° esa placa NO se detectaba.
const MATIZ_MIN = 25;
const MATIZ_MAX = 70;
const SATURACION_MIN = 0.45;
const VALOR_MIN = 85;

/**
 * Área amarilla mínima (px de la imagen reescalada) de un CANDIDATO YA ARMADO (es decir, del
 * grupo de fragmentos fusionados, no de cada trozo suelto — ver `fusionarFragmentos`).
 * Es solo un corte BARATO de manchas de 1-2 píxeles antes de los cálculos que
 * siguen: NUNCA es el filtro decisivo, porque el piso efectivo lo imponen
 * `ANCHO_MIN_FRACCION` + `ASPECTO_MAX` + `RELLENO_MIN` (con el lado de análisis
 * de 900px: ancho >= 23px, alto >= 6px, relleno >= 0.45 → ~60px de área mínima
 * real). Se conserva por eso, no porque recorte casos que los otros filtros
 * dejarían pasar.
 */
const AREA_MIN_PX = 25;

// Proporción ancho:alto plausible para una placa colombiana. La placa física es
// ~2:1, pero en fotos reales aparece escorzada (3/4, ángulo) o con la máscara
// mordida por brillos, así que el rango es deliberadamente ancho.
const ASPECTO_MIN = 1.2;
const ASPECTO_MAX = 4.2;

/**
 * Ancho mínimo del candidato como fracción del LADO CORTO de la imagen.
 *
 * Era "fracción del ANCHO", y eso hacía que el mismo carro fotografiado en vertical y en
 * apaisado tuviera dos pisos distintos (en una foto de celular 3024x4032 el ancho es el lado
 * corto; girada, pasa a ser el largo, un 33% más exigente). El lado corto es la referencia
 * estable: la placa de un carro en el encuadre ocupa una fracción parecida del lado corto sin
 * importar cómo se sostuvo el teléfono.
 */
const ANCHO_MIN_FRACCION = 0.025;

/**
 * Relleno mínimo (píxeles amarillos del blob / área de su bounding box). Una
 * placa real es un rectángulo amarillo SÓLIDO con glifos negros encima, así que
 * su relleno ronda 0.6–0.85. Este filtro es el que descarta formas huecas o
 * "en anillo" con bounding box de proporción creíble — en particular el propio
 * sello de marca DrivePass que este sistema estampa (fondo navy con BORDE
 * naranja): si alguno de sus píxeles de borde llegara a entrar en la máscara
 * amarilla, el blob sería un marco hueco (relleno ≈0.1–0.2) y queda descartado
 * aquí, evitando que una foto ya procesada se "re-tape" sobre el sello anterior
 * en vez de sobre la placa.
 */
const RELLENO_MIN = 0.45;

export type CandidatoPlaca = {
  /** Esquina superior izquierda y tamaño del candidato, en % de la imagen (0–100). */
  x_pct: number;
  y_pct: number;
  w_pct: number;
  h_pct: number;
  /** Proporción ancho:alto del candidato. */
  aspecto: number;
  /** Píxeles amarillos del candidato / área de su bounding box (0–1). */
  relleno: number;
  /**
   * Píxeles amarillos del candidato / suma de las cajas de CADA FRAGMENTO que lo compone
   * (0–1). Para un candidato de una sola pieza es idéntico a `relleno`; la diferencia aparece
   * cuando el candidato se armó fusionando trozos (ver `fusionarFragmentos`), porque `relleno`
   * castiga el hueco que deja el obstáculo (el barrote de la reja) y `solidez` no.
   *
   * Es el campo que distingue "placa partida por una reja" de "mancha amarillenta con forma
   * casual de placa": medido sobre las fotos reales del banco, la placa detrás de la reja da
   * relleno 0.60 pero solidez 0.93 (sus dos trozos son amarillo macizo), mientras que las
   * manchas de follaje/ladrillo que aparecen en la foto trasera del Tucson dan 0.46–0.57 en
   * las DOS métricas. Con un umbral sobre `relleno` no se podía separar una de otra sin
   * perder la placa.
   */
  solidez: number;
  /** Área del blob en píxeles de la imagen reescalada a `LADO_ANALISIS`. */
  areaPx: number;
};

/**
 * Máscara binaria "píxel amarillo de placa" sobre la imagen reescalada a `LADO_ANALISIS`.
 * Se calcula UNA sola vez por foto y se reutiliza para las dos preguntas que el consumidor
 * hace sobre los mismos píxeles: "¿qué rectángulos amarillos con forma de placa hay en toda
 * la foto?" (`detectarPlacasPorColor`) y "¿hay amarillo justo acá, donde la IA dice que está
 * la placa?" (`zonasAmarillasEn`).
 */
export type MascaraAmarilla = { mascara: Uint8Array; ancho: number; alto: number };

/**
 * Un blob de la máscara EN PÍXELES DE LA MÁSCARA (no en %). La fusión de fragmentos de abajo
 * razona sobre distancias y alturas reales, y hacerlo en "% del ancho" contra "% del alto"
 * mezclaría dos unidades distintas en cuanto la foto no es cuadrada — que es la clase de
 * error que produjo la barra gigante en las fotos verticales.
 */
type Fragmento = {
  x0: number; y0: number; x1: number; y1: number;
  /** Píxeles amarillos. Al fusionar se suman los de todos los miembros del grupo. */
  area: number;
  /** Suma del área de los bounding boxes de cada fragmento del grupo (ver `solidez`). */
  areaCajas: number;
};

/** Pasa un fragmento (px de la máscara) al formato público en % de la imagen. */
function aCandidato(f: Fragmento, ancho: number, alto: number): CandidatoPlaca {
  const w = f.x1 - f.x0 + 1;
  const h = f.y1 - f.y0 + 1;
  return {
    x_pct: (f.x0 / ancho) * 100,
    y_pct: (f.y0 / alto) * 100,
    w_pct: (w / ancho) * 100,
    h_pct: (h / alto) * 100,
    aspecto: w / h,
    relleno: f.area / (w * h),
    solidez: f.area / Math.max(1, f.areaCajas),
    areaPx: f.area,
  };
}

async function construirMascara(buffer: Buffer): Promise<MascaraAmarilla | null> {
  const { data, info } = await sharp(buffer)
    .resize(LADO_ANALISIS, LADO_ANALISIS, { fit: 'inside', withoutEnlargement: true })
    // `toColourspace('srgb')` explícito ANTES del `raw()`: el bucle de abajo asume que los
    // 3 primeros bytes de cada píxel son R,G,B, y una entrada en escala de grises (`b-w`,
    // 1 canal) o CMYK (4 canales, los que produce algún software de edición/escáner) no
    // cumpliría esa suposición — con CMYK sería lo PEOR de los dos casos, porque se leerían
    // cian/magenta/amarillo como si fueran rojo/verde/azul y el matiz resultante no
    // significaría nada (candidatos amarillos inventados, no solo no detectados).
    // MEDIDO con el sharp instalado (0.35.2 / libvips 8.18.3): el pipeline por defecto YA
    // convierte a sRGB antes de la salida `raw()` — un JPEG `b-w` y uno `cmyk` salen los dos
    // con `channels === 3` y el píxel amarillo de prueba se lee (241,195,0) en ambos. O sea
    // que hoy esta línea es un no-op. Se pone igual porque esa conversión es un detalle de
    // implementación de sharp/libvips, no un contrato documentado, y este módulo depende de
    // ella para que su aritmética de matiz sea correcta: declararla explícitamente cuesta
    // nada y la deja atada a la versión que sea.
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const ancho = info.width;
  const alto = info.height;
  // Con el `toColourspace('srgb')` + `removeAlpha()` de arriba esto es siempre 3
  // (verificado con el sharp instalado para entradas sRGB, `b-w` y `cmyk`), así
  // que hoy este `return null` no se alcanza. Se conserva como RED DE SEGURIDAD y
  // no se borra: si por cualquier motivo (cambio de versión de sharp, perfil de
  // color exótico, imagen corrupta) llegaran menos de 3 canales, el bucle de
  // abajo leería `data[p+1]`/`data[p+2]` de los PÍXELES VECINOS (no de los
  // canales G/B, que no existirían) y el "matiz" resultante sería ruido puro —
  // peor que no detectar nada, porque produciría candidatos INVENTADOS. Se corta
  // aquí y el consumidor cae a su camino de respaldo (ver `lib/blur-placas.ts`).
  const canales = info.channels;
  if (canales < 3) return null;
  const total = ancho * alto;

  const mascara = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const p = i * canales;
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];

    const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
    if (max < VALOR_MIN) continue;
    const min = r < g ? (r < b ? r : b) : (g < b ? g : b);
    const delta = max - min;
    if (delta / max < SATURACION_MIN) continue;

    // Matiz en grados (0–360). Solo interesa la rama amarilla, pero se calcula
    // completo para no tener que asumir cuál canal es el máximo.
    let matiz: number;
    if (max === r) matiz = 60 * (((g - b) / delta) % 6);
    else if (max === g) matiz = 60 * ((b - r) / delta + 2);
    else matiz = 60 * ((r - g) / delta + 4);
    if (matiz < 0) matiz += 360;

    if (matiz >= MATIZ_MIN && matiz <= MATIZ_MAX) mascara[i] = 1;
  }

  return { mascara, ancho, alto };
}

/**
 * Todas las componentes conexas (4-vecindad) de la máscara con área >= `areaMin`, SIN aplicar
 * todavía ningún filtro de forma. Iterativo a propósito: una recursión sobre ~810k píxeles
 * desbordaría la pila.
 *
 * `region` (en píxeles de la máscara) acota el barrido: `zonasAmarillasEn` solo mira la
 * vecindad de la placa que reportó la IA, y restringir el barrido evita además que una mancha
 * amarilla que empieza dentro de la ventana y sigue por media foto (un muro, un taxi) se
 * devuelva entera.
 */
function componentes(
  m: MascaraAmarilla,
  areaMin: number,
  region?: { x0: number; y0: number; x1: number; y1: number },
): Fragmento[] {
  const { mascara, ancho, alto } = m;
  const x0 = Math.max(0, region ? Math.floor(region.x0) : 0);
  const y0 = Math.max(0, region ? Math.floor(region.y0) : 0);
  const x1 = Math.min(ancho - 1, region ? Math.ceil(region.x1) : ancho - 1);
  const y1 = Math.min(alto - 1, region ? Math.ceil(region.y1) : alto - 1);
  if (x1 < x0 || y1 < y0) return [];

  const total = ancho * alto;
  const etiquetas = new Int32Array(total).fill(-1);
  const cola = new Int32Array((x1 - x0 + 1) * (y1 - y0 + 1));
  const blobs: Fragmento[] = [];

  for (let sy = y0; sy <= y1; sy++) {
    for (let sx = x0; sx <= x1; sx++) {
      const inicio = sy * ancho + sx;
      if (mascara[inicio] !== 1 || etiquetas[inicio] !== -1) continue;

      let cabeza = 0;
      let fin = 0;
      cola[fin++] = inicio;
      etiquetas[inicio] = 1;

      let minX = ancho, maxX = 0, minY = alto, maxY = 0, area = 0;

      while (cabeza < fin) {
        const idx = cola[cabeza++];
        const x = idx % ancho;
        const y = (idx - x) / ancho;
        area++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;

        if (x > x0) {
          const v = idx - 1;
          if (mascara[v] === 1 && etiquetas[v] === -1) { etiquetas[v] = 1; cola[fin++] = v; }
        }
        if (x < x1) {
          const v = idx + 1;
          if (mascara[v] === 1 && etiquetas[v] === -1) { etiquetas[v] = 1; cola[fin++] = v; }
        }
        if (y > y0) {
          const v = idx - ancho;
          if (mascara[v] === 1 && etiquetas[v] === -1) { etiquetas[v] = 1; cola[fin++] = v; }
        }
        if (y < y1) {
          const v = idx + ancho;
          if (mascara[v] === 1 && etiquetas[v] === -1) { etiquetas[v] = 1; cola[fin++] = v; }
        }
      }

      if (area < areaMin) continue;

      blobs.push({
        x0: minX, y0: minY, x1: maxX, y1: maxY, area,
        areaCajas: (maxX - minX + 1) * (maxY - minY + 1),
      });
    }
  }
  return blobs;
}

/**
 * FUSIÓN DE FRAGMENTOS — por qué existe (fallo real de producción, medido)
 * ------------------------------------------------------------------------
 * Una placa amarilla partida por un obstáculo deja de ser UNA componente conexa y pasa a ser
 * varias manchas sueltas, cada una demasiado angosta para pasar `ANCHO_MIN_FRACCION`. Caso
 * medido: en la foto de frente del Tucson hay un carro estacionado DETRÁS DE UNA REJA y los
 * barrotes cortan su placa en dos manchas de 10x11 y 5x8 px (a lado de análisis 900). El
 * detector devolvía 2 candidatos para esa foto y ninguno era esa placa: quedó publicada y
 * legible en el catálogo público. Fusionadas, las dos manchas dan un rectángulo de 18x11 px
 * con proporción 1.64 y relleno 0.70 — inconfundiblemente una placa.
 *
 * El criterio es el de agrupar una LÍNEA DE TEXTO, no "todo lo amarillo que esté cerca":
 * dos fragmentos se unen solo si están a la MISMA ALTURA (se solapan verticalmente), tienen
 * alturas comparables y el hueco horizontal entre ellos es chico comparado con esa altura.
 * Un barrote de reja, una rama o un brillo dejan huecos de ese orden; un objeto amarillo
 * distinto de la escena (un taxi al fondo, un muro) no cumple las tres condiciones a la vez.
 * Todas las cantidades van en PÍXELES DE LA MÁSCARA, así que el criterio se comporta igual en
 * una foto vertical y en una apaisada.
 */

// --- Regla A: fragmentos uno AL LADO del otro (la placa cortada por barrotes verticales) ---
/** Solape vertical mínimo entre dos fragmentos, como fracción del MENOR de sus altos. */
const FUSION_SOLAPE_Y = 0.4;
/** Relación máxima entre el alto del fragmento más alto y el del más bajo. */
const FUSION_RAZON_ALTO_MAX = 3;
/** Hueco horizontal máximo entre dos fragmentos, en múltiplos del MAYOR de sus altos. */
const FUSION_HUECO_MAX = 1.0;

// --- Regla B: fragmentos uno ENCIMA del otro (la placa cortada por una sombra o un reflejo) ---
// Existe por un caso real: en la foto del DEEPAL del catálogo, la placa de un carro del borde
// derecho —vista casi de canto— llega a la máscara partida en dos mitades apiladas (29x38 y
// 26x32 px) que se solapan horizontalmente casi por completo. Sin esta regla se tapaba una
// mitad y la otra quedaba a la vista. Es más estricta que la regla A (más solape exigido, hueco
// más chico) porque apilar verticalmente es justo lo que hay que evitar con el paragolpes y las
// franjas amarillas de la carrocería, que también están alineadas con la placa.
/** Solape horizontal mínimo entre dos fragmentos, como fracción del MENOR de sus anchos. */
const FUSION_SOLAPE_X = 0.6;
/** Relación máxima entre el ancho del fragmento más ancho y el del más angosto. */
const FUSION_RAZON_ANCHO_MAX = 2.5;
/** Hueco vertical máximo entre dos fragmentos, en múltiplos del MAYOR de sus altos. */
const FUSION_HUECO_Y_MAX = 0.4;
/**
 * Tope de fragmentos que entran a la fusión (la comparación es O(n²)). Se quedan los de mayor
 * área. Con el lado de análisis de 900 px y el piso `AREA_MIN_FRAGMENTO`, las fotos reales del
 * banco dan entre 0 y 115 fragmentos, así que este tope no se alcanza nunca en la práctica:
 * está para que una foto patológica (un mural amarillo salpicado) no dispare el costo.
 */
const MAX_FRAGMENTOS_FUSION = 600;

/**
 * Une los fragmentos que parecen trozos de una misma placa y devuelve un fragmento por grupo
 * (un grupo de uno = el fragmento tal cual). El `area` del grupo es la suma de las áreas
 * amarillas REALES de sus miembros, no el área del bounding box: así el `relleno` que se
 * calcula después sigue midiendo "qué tan sólido es el rectángulo" y una unión forzada de
 * manchas lejanas queda con relleno bajo y la descartan los filtros de forma.
 */
function fusionarFragmentos(fragmentos: Fragmento[]): Fragmento[] {
  const fs = fragmentos.length > MAX_FRAGMENTOS_FUSION
    ? [...fragmentos].sort((a, b) => b.area - a.area).slice(0, MAX_FRAGMENTOS_FUSION)
    : fragmentos;

  const padre = fs.map((_, i) => i);
  const raiz = (i: number): number => {
    while (padre[i] !== i) { padre[i] = padre[padre[i]]; i = padre[i]; }
    return i;
  };

  for (let i = 0; i < fs.length; i++) {
    for (let j = i + 1; j < fs.length; j++) {
      const a = fs[i], b = fs[j];
      const altoA = a.y1 - a.y0 + 1, altoB = b.y1 - b.y0 + 1;
      const anchoA = a.x1 - a.x0 + 1, anchoB = b.x1 - b.x0 + 1;
      const altoMax = Math.max(altoA, altoB), altoMin = Math.min(altoA, altoB);
      const anchoMax = Math.max(anchoA, anchoB), anchoMin = Math.min(anchoA, anchoB);
      const solapeY = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + 1;
      const solapeX = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1;
      const huecoX = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1) - 1;
      const huecoY = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1) - 1;

      const ladoALado = altoMax <= altoMin * FUSION_RAZON_ALTO_MAX
        && solapeY >= altoMin * FUSION_SOLAPE_Y
        && huecoX <= altoMax * FUSION_HUECO_MAX;
      const apilados = anchoMax <= anchoMin * FUSION_RAZON_ANCHO_MAX
        && solapeX >= anchoMin * FUSION_SOLAPE_X
        && huecoY <= altoMax * FUSION_HUECO_Y_MAX;
      if (!ladoALado && !apilados) continue;
      const ra = raiz(i), rb = raiz(j);
      if (ra !== rb) padre[ra] = rb;
    }
  }

  const grupos = new Map<number, Fragmento>();
  fs.forEach((f, i) => {
    const r = raiz(i);
    const g = grupos.get(r);
    if (!g) grupos.set(r, { ...f });
    else {
      g.x0 = Math.min(g.x0, f.x0); g.y0 = Math.min(g.y0, f.y0);
      g.x1 = Math.max(g.x1, f.x1); g.y1 = Math.max(g.y1, f.y1);
      g.area += f.area;
      g.areaCajas += f.areaCajas;
    }
  });
  return absorberContenidos([...grupos.values()]);
}

/**
 * Absorbe todo grupo cuya caja quede ÍNTEGRAMENTE dentro de la caja de otro grupo.
 *
 * Los grupos que salen de la fusión son conjuntos de píxeles disjuntos, pero sus cajas SÍ se
 * pueden anidar: un pedacito amarillo suelto en medio de un panel amarillo grande (un brillo
 * que partió un carácter, un tornillo) queda como grupo propio aunque esté físicamente dentro
 * del panel. Devolverlos por separado no es teórico y cuesta caro: en la foto trasera del
 * Tucson recortada a apaisado, la placa entera salía como una zona de 215x202 px y un trocito
 * suyo de 84x64 px salía como OTRA zona; el consumidor puntúa por proporción y el trocito
 * —más alargado— le ganaba a la placa entera, así que el sello se estampaba en el MEDIO de la
 * placa y "KZR 957" seguía leyéndose alrededor. Un tapado parcial es tan malo como ninguno.
 */
function absorberContenidos(grupos: Fragmento[]): Fragmento[] {
  const orden = [...grupos].sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0));
  const salida: Fragmento[] = [];
  for (const g of orden) {
    const contenedor = salida.find(c => g.x0 >= c.x0 && g.x1 <= c.x1 && g.y0 >= c.y0 && g.y1 <= c.y1);
    if (contenedor) {
      contenedor.area += g.area;
      contenedor.areaCajas += g.areaCajas;
      continue;
    }
    salida.push({ ...g });
  }
  return salida;
}

/**
 * Área mínima (px de la máscara) de un fragmento para que entre en la fusión. Es MÁS BAJA que
 * `AREA_MIN_PX` a propósito: `AREA_MIN_PX` es el piso del candidato YA ARMADO, mientras que un
 * trozo suelto de placa entre dos barrotes puede ser de 35 px o menos. Por debajo de 8 px la
 * máscara es ruido de compresión.
 */
const AREA_MIN_FRAGMENTO = 8;

/**
 * Construye la máscara amarilla de la foto y devuelve, de una sola pasada sobre los píxeles,
 * los candidatos "con forma de placa" de TODA la imagen. La máscara se devuelve también para
 * que el consumidor pueda hacerle preguntas locales después (`zonasAmarillasEn`) sin
 * volver a decodificar y reescalar la imagen.
 *
 * Si la imagen no se pudo leer como RGB, devuelve `{ mascara: null, candidatos: [] }`.
 */
export async function analizarAmarillo(buffer: Buffer): Promise<{ mascara: MascaraAmarilla | null; candidatos: CandidatoPlaca[] }> {
  const m = await construirMascara(buffer);
  if (!m) return { mascara: null, candidatos: [] };

  // Los filtros de forma se aplican SOBRE EL GRUPO FUSIONADO, nunca sobre el fragmento suelto:
  // una placa partida por una reja no pasa ninguno de ellos trozo a trozo.
  const anchoMin = Math.min(m.ancho, m.alto) * ANCHO_MIN_FRACCION;
  const candidatos = fusionarFragmentos(componentes(m, AREA_MIN_FRAGMENTO))
    .filter(f => f.area >= AREA_MIN_PX && (f.x1 - f.x0 + 1) >= anchoMin)
    .map(f => aCandidato(f, m.ancho, m.alto))
    .filter(c => Number.isFinite(c.aspecto) && c.aspecto >= ASPECTO_MIN && c.aspecto <= ASPECTO_MAX && c.relleno >= RELLENO_MIN);

  candidatos.sort((a, b) => b.areaPx - a.areaPx);
  return { mascara: m, candidatos };
}

/**
 * Área mínima (px de la imagen reescalada) de una mancha amarilla para que el REFINADO local
 * la tome en serio. Mucho más baja que `AREA_MIN_PX`+filtros de forma porque acá no hace falta
 * que la mancha se defienda sola: la IA ya dijo que en esa ventana hay una placa, y lo único
 * que se está preguntando es dónde exactamente. 12 px a 900 de lado es una placa de ~6x2 px.
 */
const AREA_MIN_REFINO = 12;

/** Cuántas manchas de la ventana se devuelven como zonas candidatas (de mayor a menor área). */
const MAX_ZONAS_REFINO = 6;

/**
 * ¿Qué manchas amarillas hay dentro de `ventana`, sin exigirles que tengan forma de placa?
 *
 * Es el complemento de `analizarAmarillo` para el caso que más falla: una placa que la máscara
 * SÍ ve pero que los filtros de forma globales descartan. Medido sobre fotos reales: la placa
 * trasera del Tucson en una toma 3/4 sale con bounding box casi cuadrado (aspecto 1.04) porque
 * la placa está girada en la foto, y `ASPECTO_MIN = 1.2` la tiraba — dejando la placa del carro
 * que se estaba publicando a la vista. Aflojar ese umbral GLOBAL habría llenado de falsos
 * positivos el camino "tapar amarillos que la IA no reportó"; acotarlo a la ventana que la IA
 * señaló no, porque ahí la IA ya puso la restricción de que eso es una placa.
 *
 * Cada mancha se devuelve UNIDA con los fragmentos vecinos que caen dentro de su bounding box
 * ampliado un 30% (una placa en sombra o con brillos se parte en varias manchas). Se descartan
 * las uniones que ocupan casi toda la ventana, porque eso ya no es una placa sino el fondo (un
 * muro, un toldo, un taxi entero).
 *
 * NO decide cuál de las manchas es la placa: devuelve la lista ordenada de mayor a menor área
 * y es el consumidor (lib/blur-placas.ts) quien la puntúa contra la caja que reportó la IA —
 * ahí está la geometría (distancia + proporción esperada) que permite distinguir la placa de
 * una columna o un ladrillo amarillento que caiga en la misma ventana.
 */
export function zonasAmarillasEn(
  m: MascaraAmarilla,
  ventana: { x_pct: number; y_pct: number; w_pct: number; h_pct: number },
): CandidatoPlaca[] {
  const region = {
    x0: (ventana.x_pct / 100) * m.ancho,
    y0: (ventana.y_pct / 100) * m.alto,
    x1: ((ventana.x_pct + ventana.w_pct) / 100) * m.ancho,
    y1: ((ventana.y_pct + ventana.h_pct) / 100) * m.alto,
  };
  const grupos = fusionarFragmentos(componentes(m, AREA_MIN_REFINO, region));
  grupos.sort((a, b) => b.area - a.area);

  const anchoVentana = ((ventana.w_pct / 100) * m.ancho);
  const altoVentana = ((ventana.h_pct / 100) * m.alto);
  const zonas: CandidatoPlaca[] = [];
  for (const g of grupos.slice(0, MAX_ZONAS_REFINO)) {
    // Si el amarillo ocupa casi toda la ventana no es una placa: es el fondo (un muro, un
    // toldo, el costado de un furgón). Devolver eso haría que el sello tapara la ventana
    // entera, que es justo lo que este archivo existe para no hacer.
    const w = g.x1 - g.x0 + 1;
    const h = g.y1 - g.y0 + 1;
    if (w > anchoVentana * 0.75 && h > altoVentana * 0.75) continue;
    zonas.push(aCandidato(g, m.ancho, m.alto));
  }
  return zonas;
}

/**
 * Busca regiones amarillas con forma de placa en una imagen.
 *
 * El `buffer` debe venir YA con la orientación EXIF normalizada (ver
 * `normalizarOrientacion` en `lib/blur-placas.ts`): los porcentajes que devuelve
 * esta función se refieren a los píxeles tal cual están en ese buffer.
 *
 * Devuelve 0..N candidatos ordenados de mayor a menor área (el más grande
 * primero); NO decide cuál es "la" placa — esa reconciliación (cruzar con lo que
 * reporta la IA para descartar el taxi amarillo del fondo) es responsabilidad del
 * consumidor. Envoltorio fino sobre `analizarAmarillo` para los usos que solo
 * quieren la lista (p. ej. `scripts/probar-deteccion-placa.ts`).
 */
export async function detectarPlacasPorColor(buffer: Buffer): Promise<CandidatoPlaca[]> {
  return (await analizarAmarillo(buffer)).candidatos;
}
