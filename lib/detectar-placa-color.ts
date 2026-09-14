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
 *   sobreexpuestas/en sombra profunda pueden no entrar en la máscara. Para eso
 *   existe la banda de respaldo en `lib/blur-placas.ts`.
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
 * Área mínima (px de la imagen reescalada) para considerar una mancha amarilla.
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

/** Ancho mínimo del candidato como fracción del ancho de la imagen. */
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
  /** Píxeles amarillos del blob / área de su bounding box (0–1). */
  relleno: number;
  /** Área del blob en píxeles de la imagen reescalada a `LADO_ANALISIS`. */
  areaPx: number;
};

/**
 * Busca regiones amarillas con forma de placa en una imagen.
 *
 * El `buffer` debe venir YA con la orientación EXIF normalizada (ver
 * `normalizarOrientacion` en `lib/blur-placas.ts`): los porcentajes que devuelve
 * esta función se refieren a los píxeles tal cual están en ese buffer.
 *
 * Devuelve 0..N candidatos ordenados de mayor a menor área (el más grande
 * primero); NO decide cuál es "la" placa — esa reconciliación (cruzar con la
 * pista de la IA para descartar el taxi amarillo del fondo) es responsabilidad
 * del consumidor.
 */
export async function detectarPlacasPorColor(buffer: Buffer): Promise<CandidatoPlaca[]> {
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
  // que hoy este `return []` no se alcanza. Se conserva como RED DE SEGURIDAD y
  // no se borra: si por cualquier motivo (cambio de versión de sharp, perfil de
  // color exótico, imagen corrupta) llegaran menos de 3 canales, el bucle de
  // abajo leería `data[p+1]`/`data[p+2]` de los PÍXELES VECINOS (no de los
  // canales G/B, que no existirían) y el "matiz" resultante sería ruido puro —
  // peor que no detectar nada, porque produciría candidatos INVENTADOS. Se corta
  // aquí y el consumidor cae a su camino de respaldo (ver `lib/blur-placas.ts`).
  const canales = info.channels;
  if (canales < 3) return [];
  const total = ancho * alto;

  // Máscara binaria de "píxel amarillo de placa" (matiz/saturación/valor).
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

  // Componentes conexas (4-vecindad) con BFS iterativo sobre una cola de índices.
  // Iterativo a propósito: una recursión sobre ~810k píxeles desbordaría la pila.
  const etiquetas = new Int32Array(total).fill(-1);
  const cola = new Int32Array(total);
  const candidatos: CandidatoPlaca[] = [];
  let etiqueta = 0;

  for (let inicio = 0; inicio < total; inicio++) {
    if (mascara[inicio] !== 1 || etiquetas[inicio] !== -1) continue;

    let cabeza = 0;
    let fin = 0;
    cola[fin++] = inicio;
    etiquetas[inicio] = etiqueta;

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

      if (x > 0) {
        const v = idx - 1;
        if (mascara[v] === 1 && etiquetas[v] === -1) { etiquetas[v] = etiqueta; cola[fin++] = v; }
      }
      if (x < ancho - 1) {
        const v = idx + 1;
        if (mascara[v] === 1 && etiquetas[v] === -1) { etiquetas[v] = etiqueta; cola[fin++] = v; }
      }
      if (y > 0) {
        const v = idx - ancho;
        if (mascara[v] === 1 && etiquetas[v] === -1) { etiquetas[v] = etiqueta; cola[fin++] = v; }
      }
      if (y < alto - 1) {
        const v = idx + ancho;
        if (mascara[v] === 1 && etiquetas[v] === -1) { etiquetas[v] = etiqueta; cola[fin++] = v; }
      }
    }
    etiqueta++;

    if (area < AREA_MIN_PX) continue;

    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const aspecto = w / h;
    if (!Number.isFinite(aspecto) || aspecto < ASPECTO_MIN || aspecto > ASPECTO_MAX) continue;
    if (w < ancho * ANCHO_MIN_FRACCION) continue;

    const relleno = area / (w * h);
    if (relleno < RELLENO_MIN) continue;

    candidatos.push({
      x_pct: (minX / ancho) * 100,
      y_pct: (minY / alto) * 100,
      w_pct: (w / ancho) * 100,
      h_pct: (h / alto) * 100,
      aspecto,
      relleno,
      areaPx: area,
    });
  }

  candidatos.sort((a, b) => b.areaPx - a.areaPx);
  return candidatos;
}
