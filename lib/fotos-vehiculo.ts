// ── Fotos de un vehículo: leer, cambiar y saber qué se rompe ────────────────
//
// Un vehículo guarda sus fotos en DOS columnas con formas distintas:
//   · `fotos_detalle` — JSON OBJETO con las siete casillas etiquetadas del formulario
//     (frente, trasera, lado_izquierdo, lado_derecho, cojineria, baul, tablero). Las
//     claves son fijas: vaciar una casilla deja la clave con '' en vez de borrarla, para
//     que el formulario del propietario siga viendo las siete ranuras.
//   · `fotos` — JSON ARRAY de URLs sueltas. Su PRIMER elemento (`fotos[0]`) es la
//     PORTADA: es lo único que mira la tarjeta del catálogo (components/VehiculoCard.tsx,
//     que si no hay nada cae a `/uploads/placeholder-car.svg`). La ficha pública
//     (app/vehiculos/[id]/page.tsx) muestra la UNIÓN de ambas columnas, así que una foto
//     de casilla se ve públicamente aunque no esté en `fotos`.
//
// Este módulo es la única derivación de esas reglas para el panel de admin: cada función
// devuelve el estado que QUEDARÍA tras el cambio junto con sus consecuencias visibles
// (cambia la portada, el vehículo se queda sin fotos), para poder AVISAR ANTES de aplicar
// algo que no se puede deshacer — borrar una foto es destructivo.
//
// Módulo PURO: sin `fs`, sin `better-sqlite3`, sin `fetch`. Lo usan un componente de
// cliente (components/panel/VehiculosSeccion.tsx) y una ruta de API
// (app/api/vehiculos/[id]/route.ts, para describir el cambio en la bitácora).

/**
 * Las siete casillas de `fotos_detalle`, en ORDEN DE PRIORIDAD (no de pantalla): este es
 * el orden en el que se busca un reemplazo para la portada, y por eso «Frente» va primero
 * — es la foto que mejor representa al carro en la tarjeta del catálogo.
 */
export const CASILLAS_FOTO = [
  'frente', 'trasera', 'lado_izquierdo', 'lado_derecho', 'cojineria', 'baul', 'tablero',
] as const;

/** Nombre completo de cada casilla (el panel usa abreviaturas por el ancho de la rejilla). */
export const CASILLA_LABELS: Record<string, string> = {
  frente: 'Frente', trasera: 'Trasera',
  lado_izquierdo: 'Lado izquierdo', lado_derecho: 'Lado derecho',
  cojineria: 'Cojinería', baul: 'Baúl', tablero: 'Tablero',
};

export type FotosVehiculo = {
  /** Casillas etiquetadas. Se conservan TODAS las claves, incluidas las vacías (''). */
  detalle: Record<string, string>;
  /** Galería (`vehiculos.fotos`), sin repetidos ni vacíos. `[0]` es la portada. */
  galeria: string[];
};

/** Lo que quedaría tras un cambio, con sus consecuencias, para poder avisar antes. */
export type EfectoFotos = {
  fotos: FotosVehiculo;
  /** Portada (`fotos[0]`) antes y después. Si difieren, la tarjeta del catálogo cambia. */
  portadaAntes: string;
  portadaDespues: string;
  /** La galería se quedó vacía y hubo que ascender una foto de casilla a portada. */
  portadaPromovida: boolean;
  /** Tras el cambio no queda NINGUNA foto: la publicación se ve vacía. */
  quedaVacio: boolean;
};

const limpiar = (u: unknown): string => (typeof u === 'string' ? u.trim() : '');

/** Lee las dos columnas de un vehículo. JSON roto = vacío (nunca lanza). */
export function leerFotos(v: { fotos?: string | null; fotos_detalle?: string | null }): FotosVehiculo {
  let detalle: Record<string, string> = {};
  try {
    const obj = JSON.parse(v.fotos_detalle || '{}') as unknown;
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      detalle = Object.fromEntries(Object.entries(obj as Record<string, unknown>).map(([k, u]) => [k, limpiar(u)]));
    }
  } catch { detalle = {}; }
  let galeria: string[] = [];
  try {
    const arr = JSON.parse(v.fotos || '[]') as unknown;
    if (Array.isArray(arr)) galeria = [...new Set(arr.map(limpiar).filter(Boolean))];
  } catch { galeria = []; }
  return { detalle, galeria };
}

/** Las dos columnas listas para mandar en el PUT de /api/vehiculos/[id]. */
export function serializarFotos(f: FotosVehiculo): { fotos: string; fotos_detalle: string } {
  return { fotos: JSON.stringify(f.galeria), fotos_detalle: JSON.stringify(f.detalle) };
}

/** URLs de casilla, en el orden dado, sin vacíos. */
function urlsDeCasillas(detalle: Record<string, string>, orden: readonly string[]): string[] {
  const claves = [...orden, ...Object.keys(detalle).filter(k => !orden.includes(k))];
  return claves.map(k => limpiar(detalle[k])).filter(Boolean);
}

/**
 * Cierra un cambio: normaliza la galería y garantiza que siga habiendo PORTADA.
 *
 * Decisión (sep-2026): si la galería se queda vacía pero el vehículo todavía tiene fotos
 * en las casillas, se asciende la primera casilla con foto (en el orden del formulario,
 * o sea «Frente» primero) a portada. Sin esto, borrar la única foto de la galería dejaba
 * la tarjeta del catálogo con la silueta genérica aunque el carro siguiera teniendo siete
 * fotos perfectamente publicables — y nada en la interfaz explicaba por qué.
 */
function cerrar(antes: FotosVehiculo, detalle: Record<string, string>, galeria: string[], orden: readonly string[]): EfectoFotos {
  const limpia = [...new Set(galeria.map(limpiar).filter(Boolean))];
  const deCasillas = urlsDeCasillas(detalle, orden);
  let portadaPromovida = false;
  if (limpia.length === 0 && deCasillas.length > 0) {
    limpia.push(deCasillas[0]);
    portadaPromovida = true;
  }
  return {
    fotos: { detalle, galeria: limpia },
    portadaAntes: antes.galeria[0] || '',
    portadaDespues: limpia[0] || '',
    portadaPromovida,
    quedaVacio: limpia.length === 0 && deCasillas.length === 0,
  };
}

/**
 * Pone (o reemplaza) la foto de una casilla. `url` vacía = vaciar la casilla.
 *
 * La casilla se vacía con '' en vez de borrar la clave (claves fijas, ver cabecera). Si la
 * foto anterior también estaba en la galería se reemplaza EN SU MISMA POSICIÓN (así un
 * reemplazo de la foto de portada sigue siendo la portada) o se quita de ahí al vaciar
 * (si no, una foto "borrada" seguiría publicándose desde la otra columna).
 */
export function conCasilla(f: FotosVehiculo, clave: string, url: string, orden: readonly string[]): EfectoFotos {
  const nueva = limpiar(url);
  const anterior = limpiar(f.detalle[clave]);
  const detalle = { ...f.detalle, [clave]: nueva };
  let galeria = [...f.galeria];
  if (anterior && anterior !== nueva) {
    const i = galeria.indexOf(anterior);
    if (i !== -1) {
      if (nueva) galeria[i] = nueva;
      else galeria = galeria.filter(u => u !== anterior);
    }
  }
  return cerrar(f, detalle, galeria, orden);
}

/** Agrega una foto suelta a la galería (al final; si ya estaba, no cambia nada). */
export function conSuelta(f: FotosVehiculo, url: string, orden: readonly string[]): EfectoFotos {
  const nueva = limpiar(url);
  const galeria = nueva && !f.galeria.includes(nueva) ? [...f.galeria, nueva] : [...f.galeria];
  return cerrar(f, { ...f.detalle }, galeria, orden);
}

/** Quita una foto suelta de la galería. No toca las casillas. */
export function sinSuelta(f: FotosVehiculo, url: string, orden: readonly string[]): EfectoFotos {
  const objetivo = limpiar(url);
  return cerrar(f, { ...f.detalle }, f.galeria.filter(u => u !== objetivo), orden);
}

// ── Descripción de un cambio (bitácora) ─────────────────────────────────────

/**
 * Mapa `url → etiqueta de dónde está` (nombre de casilla, o 'galería' si es suelta).
 * Es lo que permite decir en la bitácora QUÉ foto se agregó o se borró y de qué ranura,
 * no solo cuántas. La clave del mapa es la URL tal cual; el cruce entre el antes y el
 * después lo hace quien llame, con la normalización que use (ver `normalizarUrlFoto`).
 */
export function ubicacionesDeFotos(f: FotosVehiculo, etiquetas: Record<string, string> = {}): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const [clave, url] of Object.entries(f.detalle)) {
    const u = limpiar(url);
    if (u && !mapa.has(u)) mapa.set(u, etiquetas[clave] || clave);
  }
  for (const url of f.galeria) {
    const u = limpiar(url);
    if (u && !mapa.has(u)) mapa.set(u, 'galería');
  }
  return mapa;
}
