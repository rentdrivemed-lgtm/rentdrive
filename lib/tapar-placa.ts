// ── Tapado MANUAL de placas: reglas puras (cliente + servidor) ───────────────
//
// ⚠️ Módulo PURO: sin `fs`, sin `sharp`, sin `better-sqlite3`, sin nada de servidor.
// Se importa desde un componente 'use client' (components/TaparPlacaManual.tsx) y
// desde la ruta de API (app/api/admin/tapar-placa/route.ts), igual que lib/lugares.ts
// o lib/pico-placa.ts.
//
// POR QUÉ EXISTE
// --------------
// La detección automática (lib/blur-placas.ts) falla a veces: devuelve `via: 'ninguna'`
// y la foto se publica con la placa a la vista, o tapa donde no es. En el catálogo real
// eso dejó visibles la placa del propio carro Y las de dos terceros (un vehículo detrás
// de una reja y otro estacionado al lado) en fotos públicas. Esta es la red de seguridad
// manual: el admin marca los rectángulos con el dedo o el mouse y el servidor estampa
// encima el sello opaco de marca DrivePass.
//
// LAS COORDENADAS VIENEN DEL NAVEGADOR
// ------------------------------------
// O sea: no son de fiar. Todo lo que valida el servidor está ACÁ, y el cliente usa las
// MISMAS funciones para (a) no ofrecer algo que el servidor va a rechazar y (b) que la
// vista previa muestre exactamente el rectángulo que se va a estampar (ver
// `prepararZonas`, que es la única fuente de verdad de la geometría final).
//
// Las zonas van en FRACCIONES de la imagen (0..1), no en píxeles: la pantalla muestra la
// foto escalada (y con zoom), así que píxeles de pantalla no significan nada del lado del
// servidor. Fracciones sobre la imagen ya normalizada por EXIF sí.

/** Rectángulo a tapar, en fracciones de la imagen (0..1). `x`/`y` = esquina superior izquierda. */
export type ZonaPlaca = { x: number; y: number; w: number; h: number };

// ── Topes ───────────────────────────────────────────────────────────────────
//
// El caso real que motivó esta función tiene TRES placas en una misma foto (la del carro,
// la de un tercero detrás de una reja y la de un camión al fondo). 8 deja margen de sobra
// para una foto con varios carros sin volverse una vía para pintarrajear la imagen entera.
export const MAX_ZONAS = 8;

/**
 * Lado mínimo, en fracción del lado correspondiente de la imagen. La placa más chica del
 * caso real ocupa ~1% de la imagen, así que el piso tiene que ser bastante más bajo que
 * eso: 0,4% de 3024 px son ~12 px de ancho. Por debajo de esto es un toque accidental,
 * no una placa marcada a propósito.
 */
export const MIN_LADO_FRAC = 0.004;

/** Lado máximo por zona. Un rectángulo de 100%×100% NO puede tapar la foto entera. */
export const MAX_LADO_FRAC = 0.7;

/** Área máxima de UNA zona (fracción del área de la imagen). */
export const MAX_AREA_ZONA_FRAC = 0.25;

/** Área máxima SUMADA de todas las zonas (sin descontar solapes: el tope es deliberadamente burdo). */
export const MAX_AREA_TOTAL_FRAC = 0.5;

/**
 * Proporción ancho:alto de una placa colombiana (330 × 165 mm = 2:1). Cuando el rectángulo
 * que marcó la persona ya se le parece, el sello se ajusta a esta proporción para que
 * parezca una placa de marca y no un parche cualquiera (ver `ajustarAProporcionPlaca`).
 */
export const ASPECTO_PLACA = 2;

/**
 * Cuánto se puede AGRANDAR un rectángulo al llevarlo a proporción de placa. El ajuste solo
 * agranda (nunca encoge): encoger destaparía píxeles que la persona marcó a propósito. Con
 * un tope de 1,5× un rectángulo razonablemente parecido a una placa queda clavado, y uno
 * con forma rara (una franja larguísima, o una caja más alta que ancha) se deja tal cual en
 * vez de inflarse hasta comerse media foto.
 */
export const CRECIMIENTO_MAX_PROPORCION = 1.5;

function finito(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function recortar(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export type ResultadoValidacion =
  | { ok: true; zonas: ZonaPlaca[] }
  | { ok: false; error: string };

/**
 * Valida la lista de zonas tal como llega del navegador (JSON sin tipar).
 *
 * Rechaza, con un mensaje que se le puede mostrar a la persona: lista vacía o no-lista,
 * más de `MAX_ZONAS`, campos que no son números finitos, rectángulos que se salen del
 * lienzo, demasiado chicos (toque accidental), demasiado grandes, y la suma de áreas por
 * encima del tope.
 */
export function validarZonas(entrada: unknown): ResultadoValidacion {
  if (!Array.isArray(entrada)) return { ok: false, error: 'No se recibió ninguna zona para tapar.' };
  if (entrada.length === 0) return { ok: false, error: 'Marca al menos una placa antes de aplicar.' };
  if (entrada.length > MAX_ZONAS) {
    return { ok: false, error: `Máximo ${MAX_ZONAS} zonas por foto (llegaron ${entrada.length}).` };
  }

  const zonas: ZonaPlaca[] = [];
  let areaTotal = 0;

  for (const cruda of entrada) {
    if (!cruda || typeof cruda !== 'object') return { ok: false, error: 'Zona con formato inválido.' };
    const { x, y, w, h } = cruda as Record<string, unknown>;
    if (!finito(x) || !finito(y) || !finito(w) || !finito(h)) {
      return { ok: false, error: 'Zona con coordenadas inválidas.' };
    }
    if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.0001 || y + h > 1.0001) {
      return { ok: false, error: 'Hay una zona fuera de los límites de la foto.' };
    }
    if (w < MIN_LADO_FRAC || h < MIN_LADO_FRAC) {
      return { ok: false, error: 'Hay una zona demasiado pequeña — dibuja un rectángulo un poco más grande sobre la placa.' };
    }
    if (w > MAX_LADO_FRAC || h > MAX_LADO_FRAC) {
      return { ok: false, error: `Hay una zona demasiado grande (máximo ${Math.round(MAX_LADO_FRAC * 100)}% de la foto por lado).` };
    }
    const area = w * h;
    if (area > MAX_AREA_ZONA_FRAC) {
      return { ok: false, error: `Hay una zona que cubre más del ${Math.round(MAX_AREA_ZONA_FRAC * 100)}% de la foto.` };
    }
    areaTotal += area;
    // `x + w` puede haber quedado en 1.0000004 por el redondeo del navegador (por eso la
    // tolerancia de arriba); acá se recorta de verdad para que el servidor nunca componga
    // un rectángulo que se sale de la imagen.
    const xr = recortar(x, 0, 1);
    const yr = recortar(y, 0, 1);
    zonas.push({ x: xr, y: yr, w: recortar(w, 0, 1 - xr), h: recortar(h, 0, 1 - yr) });
  }

  if (areaTotal > MAX_AREA_TOTAL_FRAC) {
    return { ok: false, error: `Entre todas, las zonas cubren más del ${Math.round(MAX_AREA_TOTAL_FRAC * 100)}% de la foto.` };
  }

  return { ok: true, zonas };
}

/**
 * Lleva un rectángulo a proporción de placa (2:1) SIN encogerlo: agranda el lado que falte
 * alrededor del mismo centro. `aspectoImagen` = ancho/alto de la imagen en píxeles, porque
 * las zonas van en fracciones y una fracción cuadrada NO es un cuadrado en una foto 3:4.
 *
 * Se devuelve el rectángulo ORIGINAL, sin tocar, si:
 *  · habría que agrandarlo más de `CRECIMIENTO_MAX_PROPORCION` (forma demasiado distinta
 *    a una placa: el sello se quedaría con media puerta del carro), o
 *  · el resultado no cabe dentro de la foto ni corriéndolo, o
 *  · pasaría los topes de lado/área de `validarZonas`.
 */
export function ajustarAProporcionPlaca(z: ZonaPlaca, aspectoImagen: number): ZonaPlaca {
  if (!finito(aspectoImagen) || aspectoImagen <= 0) return z;

  // Proporción REAL en pantalla/píxeles del rectángulo marcado.
  const visual = (z.w * aspectoImagen) / z.h;
  if (!Number.isFinite(visual) || visual <= 0) return z;

  let w = z.w;
  let h = z.h;
  if (visual < ASPECTO_PLACA) {
    w = (z.h * ASPECTO_PLACA) / aspectoImagen;   // ensanchar
  } else if (visual > ASPECTO_PLACA) {
    h = (z.w * aspectoImagen) / ASPECTO_PLACA;   // estirar a lo alto
  } else {
    return z;
  }

  const crecimiento = Math.max(w / z.w, h / z.h);
  if (!Number.isFinite(crecimiento) || crecimiento > CRECIMIENTO_MAX_PROPORCION) return z;
  if (w > MAX_LADO_FRAC || h > MAX_LADO_FRAC || w * h > MAX_AREA_ZONA_FRAC) return z;
  if (w > 1 || h > 1) return z;

  // Mismo centro, y si se sale por un borde se corre hacia adentro (no se recorta: recortar
  // volvería a romper la proporción que acabamos de imponer).
  const cx = z.x + z.w / 2;
  const cy = z.y + z.h / 2;
  const x = recortar(cx - w / 2, 0, 1 - w);
  const y = recortar(cy - h / 2, 0, 1 - h);
  return { x, y, w, h };
}

/**
 * Geometría FINAL de las zonas que se van a estampar. Única fuente de verdad, compartida:
 * el servidor la usa para componer y el cliente para dibujar la vista previa — si cada uno
 * calculara lo suyo, la vista previa mentiría.
 *
 * `proporcionPlaca` lo decide la persona con una casilla en la interfaz: casi siempre
 * conviene (el sello parece una placa de marca), pero si marcó algo que no es una placa
 * —un adhesivo con un teléfono, un número de puerta— puede apagarlo y que se estampe
 * exactamente lo que dibujó.
 */
export function prepararZonas(
  zonas: ZonaPlaca[],
  anchoImagen: number,
  altoImagen: number,
  proporcionPlaca: boolean,
): ZonaPlaca[] {
  if (!proporcionPlaca) return zonas;
  if (!finito(anchoImagen) || !finito(altoImagen) || anchoImagen <= 0 || altoImagen <= 0) return zonas;
  const aspecto = anchoImagen / altoImagen;
  return zonas.map(z => ajustarAProporcionPlaca(z, aspecto));
}

/** Lado mínimo en píxeles del rectángulo estampado (por debajo de esto el sello no se ve como tal). */
export const MIN_LADO_PX = 8;

/** Rectángulo final en píxeles enteros de la imagen — lo que espera `sharp().composite()`. */
export type RectanguloPx = { left: number; top: number; width: number; height: number };

/**
 * Pasa una zona en fracciones a píxeles enteros, garantizando que el rectángulo cabe
 * ENTERO dentro de la imagen (sharp lanza si una capa se sale del lienzo) y que no queda
 * degenerado (0 px) por el redondeo de una zona muy pequeña.
 */
export function zonaAPixeles(z: ZonaPlaca, anchoImagen: number, altoImagen: number): RectanguloPx {
  const width = recortar(Math.round(z.w * anchoImagen), MIN_LADO_PX, anchoImagen);
  const height = recortar(Math.round(z.h * altoImagen), MIN_LADO_PX, altoImagen);
  const left = recortar(Math.round(z.x * anchoImagen), 0, anchoImagen - width);
  const top = recortar(Math.round(z.y * altoImagen), 0, altoImagen - height);
  return { left, top, width, height };
}

// ── Enganche con la RETENCIÓN de la detección automática ────────────────────
//
// Desde el arreglo del detector (lib/blur-placas.ts), cuando el sistema SABE que pudo
// quedar una placa sin tapar bien y no tiene forma automática de arreglarlo, ya NO estampa
// una banda gigante "por si acaso": devuelve `revisionManual: true` con un motivo, y
// app/api/upload/route.ts lo trata fail-closed — la foto queda registrada en
// `fotos_moderacion` con `contenido_inapropiado = 1` y ese motivo.
//
// O sea que esa columna mezcla hoy DOS cosas muy distintas: "la IA vio contenido sexual"
// y "puede haber una placa a la vista". Para el admin no son lo mismo en absoluto: lo
// segundo se resuelve con esta herramienta en treinta segundos, lo primero es un rechazo.
// El motivo es lo único que las separa, así que el prefijo se declara UNA vez acá y lo
// usan tanto quien lo escribe (lib/blur-placas.ts) como quien lo lee
// (app/api/admin/tapar-placa) — si fuera un literal suelto en cada lado, el día que alguien
// reformule el mensaje las fotos retenidas dejarían de aparecer marcadas y nadie se
// enteraría.
export const PREFIJO_REVISION_PLACA = 'Foto pendiente de revisión manual de placas:';

/** true si esta foto quedó retenida porque el tapado automático de placa no se pudo garantizar. */
export function esRetencionPorPlaca(motivo: unknown): boolean {
  return typeof motivo === 'string' && motivo.startsWith(PREFIJO_REVISION_PLACA);
}
